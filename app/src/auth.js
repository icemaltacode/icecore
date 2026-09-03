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
/* A real-shaped id token, so the name in the top bar comes from the same code path it will
 * on a deployment rather than from a preview-only special case. Header and signature are
 * junk on purpose: nothing here verifies it, and nothing here should be able to. */
const PREVIEW_TOKEN = `x.${btoa(JSON.stringify({ sub: 'preview-1', name: 'Ada Lovelace', email: 'ada@example.com' }))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}.x`;

let config = null;   // { userPoolId, clientId } or null when auth is switched off
let pool = null;
let pending = null;  // the CognitoUser mid-way through a first-login password change
let token = null;    // the current id token, for calls to /api/*

/**
 * Session facts the UI cares about: which courses, and whether this is an admin.
 * Reactive because components read it through computed(); as a plain object the admin
 * flag was read once as false before sign-in and never looked at again.
 */
/* `sub` is here because something has to be able to ask "is that mine?" about a row written
 * by somebody. A live session names the admin who started it, and the difference between
 * Rejoin and a refusal is exactly that comparison. Read from the token, never used to grant
 * anything - every check that matters happens server-side against the token itself. */
export const session = reactive({ courses: null, admin: false, expires: null, sub: '', name: '', email: '', avatar: '' });

/**
 * The display name and email out of the id token.
 *
 * Read, not verified: this is the token Cognito just handed us and it is only being used
 * to write a name in the corner. Anything that grants access is checked server-side by the
 * API's JWT authorizer, which is where verification belongs.
 */
function claims(jwt) {
  try {
    const body = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(decodeURIComponent(escape(atob(body))));
  } catch {
    return {};
  }
}

export const isEnabled = () => !!config || !!PREVIEW;

/**
 * Where the live channel is, or null when this deployment has no socket.
 *
 * The ONE thing the app talks to that is not same-origin. Everything else goes through the
 * distribution; a WebSocket API's URL is `wss://<host>/<stage>` with nothing below it, so
 * putting it behind a path would need a rewrite on every connection to buy a same-origin
 * property that a handshake - no CORS, no cookies - makes no use of. So it is deployed
 * config like the user pool, and its absence means the feature is simply not there.
 */
export const socketUrl = () => config?.live || null;

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
    PREVIEW === 'signin' || sessionStorage.getItem(PREVIEW_OUT) ? null : PREVIEW_TOKEN);
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
    return Promise.resolve(password === 'temp' ? { challenge: 'NEW_PASSWORD' } : PREVIEW_TOKEN);
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

/**
 * Start a password reset: Cognito emails a six-digit code to the address, if it has an
 * account. Resolves when the code is on its way; the caller then collects it and calls
 * `confirmPassword`.
 *
 * NOTHING HERE MAY REVEAL WHETHER THE ADDRESS EXISTS, and it does not have to try:
 * `preventUserExistenceErrors: true` is set on the web client, so Cognito answers an
 * unknown address with a plausible delivery result rather than UserNotFoundException. What
 * this side has to get right is the copy - see SignIn.vue, which promises a code only
 * conditionally. A screen that says "check your inbox" outright is a promise to a student
 * who mistyped their address, and they will sit waiting for mail nobody sent.
 */
export function forgotPassword(email) {
  if (PREVIEW) {
    /* The refusal below is the whole reason this is interesting, and it is unreachable
     * locally without a sentinel - the same trick `password === 'temp'` plays for the
     * first-login challenge. An address whose local part is `unopened` is treated as an
     * invitation nobody has opened. */
    if (email.split('@')[0] === 'unopened')
      return Promise.reject(new Error(UNOPENED));
    return Promise.resolve({ sent: true });
  }
  const user = new CognitoUser({ Username: email, Pool: pool });
  return new Promise((resolve, reject) => {
    /* Two callbacks for one outcome: this library calls `inputVerificationCode` when a code
     * was delivered and `onSuccess` when the flow needed none. Either means "go and collect
     * the code", so both resolve the same way rather than the caller learning which. */
    const done = () => resolve({ sent: true });
    user.forgotPassword({
      inputVerificationCode: done,
      onSuccess: done,
      onFailure: err => reject(new Error(friendly(err, 'recover'))),
    });
  });
}

/** Finish a reset: the emailed code plus the password to set. */
export function confirmPassword(email, code, password) {
  if (PREVIEW) {
    // A wrong code has to be reachable too, or its message ships unread.
    if (code === '000000') return Promise.reject(new Error('That code is not right. Check the email again, or send yourself another.'));
    return Promise.resolve();
  }
  const user = new CognitoUser({ Username: email, Pool: pool });
  return new Promise((resolve, reject) => {
    user.confirmPassword(code, password, {
      onSuccess: () => resolve(),
      onFailure: err => reject(new Error(friendly(err, 'recover'))),
    });
  });
}

export function completeNewPassword(password) {
  if (PREVIEW) return Promise.resolve(PREVIEW_TOKEN);
  return new Promise((resolve, reject) => {
    // Cognito rejects the challenge if the attributes it just handed us are echoed back,
    // so send none - the pool requires nothing the invitation didn't already set.
    pending.completeNewPasswordChallenge(password, {}, {
      onSuccess: s => { pending = null; resolve(idToken(s)); },
      onFailure: err => reject(new Error(friendly(err))),
    });
  });
}

/* The signed-in user, with a session actually loaded onto it.
 *
 * `getCurrentUser()` builds a fresh CognitoUser out of localStorage every time it is
 * called, and that object's `signInUserSession` is null until `getSession` fills it in - so
 * anything needing an authenticated call fails on a user who is plainly signed in. The
 * failure is worth the helper: it comes back as "no session" from a screen that could only
 * be reached with one.
 */
function withSession() {
  const user = pool?.getCurrentUser();
  if (!user) return Promise.reject(new Error('You are not signed in.'));
  return new Promise((resolve, reject) => {
    user.getSession((err, s) => (err || !s?.isValid()
      ? reject(new Error('Your session has expired - sign in again.'))
      : resolve(user)));
  });
}

/** Change the password of the person already signed in. */
export async function changePassword(current, next) {
  if (PREVIEW) {
    // The refusal has to be reachable locally, like `temp` and `unopened` on the sign-in card.
    if (current === 'wrong') return Promise.reject(new Error('That is not your current password.'));
    return Promise.resolve();
  }
  const user = await withSession();
  return new Promise((resolve, reject) => {
    user.changePassword(current, next, err => (err ? reject(new Error(friendly(err, 'change'))) : resolve()));
  });
}

/**
 * Revoke every refresh token this account has, then sign out here.
 *
 * IT IS NOT IMMEDIATE ANYWHERE ELSE, and the screen says so rather than implying otherwise.
 * Cognito revokes refresh tokens; the id and access tokens already issued stay valid until
 * they expire, which is 12 hours. Another device therefore keeps working until then and only
 * fails when it next needs to refresh - `restore()` reads a cached token and checks it
 * locally, so even a reload over there will not notice sooner. Promising an instant
 * disconnection would be the one claim a person actually relies on this for.
 */
export async function signOutEverywhere() {
  if (PREVIEW) return signOut();
  const user = await withSession();
  await new Promise((resolve, reject) => {
    user.globalSignOut({ onSuccess: resolve, onFailure: err => reject(new Error(friendly(err, 'change'))) });
  });
  signOut();
}

/** Trade the token for signed cookies. Returns the caller's courses and admin flag. */
export async function startSession(idJwt) {
  token = idJwt;
  const who = claims(idJwt);
  session.sub = who.sub || '';
  session.name = who.name || '';
  session.email = who.email || '';
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
  session.sub = ''; session.name = ''; session.email = ''; session.avatar = '';
  location.reload();   // drops in-memory state and the stale cookies with it
}

/* The message a student gets when they try to reset a password they never set.
 *
 * This is the confusing case rather than an edge case: an invitation's temporary password
 * expires after seven days, the site then reads as broken, and Forgot password is exactly
 * what they reach for. Cognito refuses because there is no password to reset - which is
 * correct and says nothing a student can act on. The fix is an admin resending the
 * invitation, so the message names it. */
const UNOPENED = 'Your invitation has not been opened yet, so there is no password to reset.'
  + ' Ask your educator to send the invitation again.';

function friendly(err, context = 'signin') {
  const code = err?.code || err?.name;
  const message = err?.message || '';

  /* NotAuthorizedException means two entirely different things depending on where it came
   * from, and only the message text tells them apart. Matched loosely and with a safe
   * fallback: Cognito does not give these distinct codes, so the string is all there is,
   * and a reworded one should degrade to "ask your educator" rather than to nonsense. */
  if (code === 'NotAuthorizedException' && context === 'recover') {
    if (/cannot be reset/i.test(message)) return UNOPENED;
    if (/disabled/i.test(message)) return 'That account is suspended. Ask your educator.';
    return 'That account cannot be reset here. Ask your educator.';
  }
  /* Same code again, a third meaning: from the account screen it is the CURRENT password
   * being wrong, which is neither a failed sign-in nor an unopened invitation. */
  if (code === 'NotAuthorizedException' && context === 'change')
    return 'That is not your current password.';
  if (code === 'CodeMismatchException')
    return 'That code is not right. Check the email again, or send yourself another.';
  if (code === 'ExpiredCodeException')
    return 'That code has expired. Send yourself another one.';
  if (code === 'LimitExceededException')
    return 'Too many attempts. Wait a few minutes and try again.';

  if (code === 'NotAuthorizedException') return 'That email and password combination was not recognised.';
  if (code === 'UserNotFoundException') return 'That email and password combination was not recognised.';
  if (code === 'PasswordResetRequiredException') return 'Your password needs resetting - ask your educator.';
  if (code === 'InvalidPasswordException') return message.replace(/^.*: /, '');
  return message || (context === 'signin' ? 'Sign-in failed.' : 'That did not work.');
}
