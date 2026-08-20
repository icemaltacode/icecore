/* Authentication, and the session that unlocks private content.
 *
 * It is optional by design. The app fetches `auth.json` at boot; when that file isn't
 * there — which is the case for `icecore dev`, and for any static host you point at a
 * content directory — the platform runs open, exactly as it always has. Authoring a
 * course needs no AWS account.
 *
 * When it *is* there, signing in does two things: authenticate against Cognito, then
 * trade the resulting token for CloudFront signed cookies at POST /api/session. Those
 * cookies are HttpOnly and same-origin, so every later request for content and slides
 * carries them without this module being involved again.
 *
 * `icecore dev --as <role>` stands in for the whole of that - see preview.js. Every branch
 * marked PREVIEW below is dev-only and cannot survive a build.
 */
import { reactive } from 'vue';
import { CognitoUserPool, CognitoUser, AuthenticationDetails } from 'amazon-cognito-identity-js';
import { previewRole, previewApi } from './preview.js';

const BASE = import.meta.env.BASE_URL;
const PREVIEW = previewRole();
/* Preview's sign-out has to be remembered somewhere, or reloading signs you straight back
 * in and the button looks broken. Session-scoped: closing the tab forgets it. */
const PREVIEW_OUT = 'ice-preview-signed-out';

let config = null;   // { userPoolId, clientId } or null when auth is switched off
let pool = null;
let pending = null;  // the CognitoUser mid-way through a first-login password change
let token = null;    // the current id token, for calls to /api/*

/**
 * Session facts the UI cares about: which courses, and whether this is an admin.
 * Reactive because components read it through computed(); as a plain object the admin
 * flag was read once as false before sign-in and never looked at again.
 */
export const session = reactive({ courses: null, admin: false, expires: null });

export const isEnabled = () => !!config || !!PREVIEW;

/** Read auth.json. A 404 means "no auth on this deployment", not an error. */
export async function loadAuthConfig() {
  if (PREVIEW) return { preview: PREVIEW };   // no auth.json, no user pool, no network
  try {
    const r = await fetch(`${BASE}auth.json`, { cache: 'no-store' });
    // A dev server answers unknown paths with the index page rather than a 404, so a 200
    // is not enough - insist on actual JSON before believing auth is configured.
    if (!r.ok || !r.headers.get('content-type')?.includes('json')) return null;
    config = await r.json();
    pool = new CognitoUserPool({ UserPoolId: config.userPoolId, ClientId: config.clientId });
    return config;
  } catch {
    return null;   // offline, or a dev server answering with the index page
  }
}

const idToken = cognitoSession => cognitoSession.getIdToken().getJwtToken();

/** An already-signed-in user returning to the tab. Resolves to a token or null. */
export function restore() {
  // 'signin' is the one preview role that starts logged out: it exists so the sign-in and
  // choose-a-password screens can be looked at without a real user pool behind them.
  if (PREVIEW) return Promise.resolve(
    PREVIEW === 'signin' || sessionStorage.getItem(PREVIEW_OUT) ? null : 'preview-token');
  const user = pool?.getCurrentUser();
  if (!user) return Promise.resolve(null);
  return new Promise(resolve => {
    user.getSession((err, s) => resolve(err || !s?.isValid() ? null : idToken(s)));
  });
}

/**
 * Resolves to a token, or to { challenge: 'NEW_PASSWORD' } when Cognito wants the
 * invitation's temporary password replaced. Invited students always hit that on first
 * sign-in, so it is a normal path rather than an edge case.
 */
export function signIn(email, password) {
  if (PREVIEW) {
    sessionStorage.removeItem(PREVIEW_OUT);
    // Any password signs you in, except the literal `temp`, which raises the first-login
    // password challenge. That screen is otherwise unreachable locally, and it is the one
    // every invited student meets first.
    return Promise.resolve(password === 'temp' ? { challenge: 'NEW_PASSWORD' } : 'preview-token');
  }
  const user = new CognitoUser({ Username: email, Pool: pool });
  return new Promise((resolve, reject) => {
    user.authenticateUser(new AuthenticationDetails({ Username: email, Password: password }), {
      onSuccess: s => resolve(idToken(s)),
      onFailure: err => reject(new Error(friendly(err))),
      newPasswordRequired: () => { pending = user; resolve({ challenge: 'NEW_PASSWORD' }); },
    });
  });
}

export function completeNewPassword(password) {
  if (PREVIEW) return Promise.resolve('preview-token');
  return new Promise((resolve, reject) => {
    // Cognito rejects the challenge if the attributes it just handed us are echoed back,
    // so send none - the pool requires nothing the invitation didn't already set.
    pending.completeNewPasswordChallenge(password, {}, {
      onSuccess: s => { pending = null; resolve(idToken(s)); },
      onFailure: err => reject(new Error(friendly(err))),
    });
  });
}

/** Trade the token for signed cookies. Returns the caller's courses and admin flag. */
export async function startSession(idJwt) {
  token = idJwt;
  // The session endpoint cannot work out which site to sign cookies for — CloudFront gives
  // API Gateway origins its own Host header — so tell it.
  const body = await api('session', { method: 'POST', body: { origin: location.origin } });
  Object.assign(session, body);
  return session;
}

/**
 * Call an /api/* route with the current token. Refreshes it once through Cognito on a
 * 401, which is what happens when a tab has been left open past the token's lifetime.
 */
export async function api(path, { method = 'GET', body, retry = true } = {}) {
  if (PREVIEW) return previewApi(path, { method, body });
  const r = await fetch(`${BASE}api/${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 401 && retry) {
    const fresh = await restore();
    if (!fresh) throw new Error('Your session has expired - sign in again.');
    token = fresh;
    return api(path, { method, body, retry: false });
  }
  if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || `HTTP ${r.status}`);
  return r.json();
}

export function signOut() {
  if (PREVIEW) sessionStorage.setItem(PREVIEW_OUT, '1');
  pool?.getCurrentUser()?.signOut();
  token = null;
  session.courses = null; session.admin = false; session.expires = null;
  location.reload();   // drops in-memory state and the stale cookies with it
}

function friendly(err) {
  const code = err?.code || err?.name;
  if (code === 'NotAuthorizedException') return 'That email and password combination was not recognised.';
  if (code === 'UserNotFoundException') return 'That email and password combination was not recognised.';
  if (code === 'PasswordResetRequiredException') return 'Your password needs resetting - ask your tutor.';
  if (code === 'InvalidPasswordException') return err.message.replace(/^.*: /, '');
  return err?.message || 'Sign-in failed.';
}
