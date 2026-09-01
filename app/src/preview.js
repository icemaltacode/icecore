/* Preview mode - the UI/UX workbench.
 *
 * `icecore dev --as student` runs the player exactly as a signed-in student sees it,
 * against no AWS at all: no Cognito, no API Gateway, no signed cookies. Without it the
 * local server runs *open*, and open is not the same view - the tutor button, the course
 * filter, sign-out and the admin panel are all hidden when there is no session, so the
 * screens that matter most for design work are the ones you cannot see locally.
 *
 * Everything here is a stand-in, and says so where a student could otherwise mistake it
 * for the real thing (the tutor reply is labelled). Progress is the exception: it goes to
 * localStorage, which is what an open deployment does anyway, so it survives a reload.
 *
 * It cannot reach production. The role is read from an env var *and* gated on
 * import.meta.env.DEV, which is false in `icecore bundle` - the only thing that ships the
 * app - so a stray VITE_ICECORE_PREVIEW in a build environment does nothing.
 */
import { loadManifest } from './content.js';
/* The same localStorage record `progress.js` keeps, through the same module: this
 * stands in for the API, so it writes what the offline backing writes. */
import * as store from './progress-store.js';

const ROLES = ['student', 'admin', 'signin'];

/** 'student' | 'admin' | 'signin', or null when this is a normal run. */
export const previewRole = () => {
  if (!import.meta.env.DEV) return null;
  const role = import.meta.env.VITE_ICECORE_PREVIEW;
  return ROLES.includes(role) ? role : null;
};

const wait = ms => new Promise(r => setTimeout(r, ms));

/* Seeded so the user table has something in it - an empty table tells you nothing about how
 * a full one looks, and every state the screen draws differently needs an example: invited,
 * active, suspended, admin, and somebody on no course at all. In memory only: it resets on
 * reload, deliberately.
 *
 * `ada@example.com` is the signed-in preview user - see PREVIEW_TOKEN in auth.js - so the
 * self-editing rules have somebody to apply to. */
let nextSub = 100;
const people = [
  { sub: 'preview-1', email: 'ada@example.com', name: 'Ada Lovelace',
    status: 'CONFIRMED', enabled: true, admin: true, courses: [] },
  { sub: 'preview-2', email: 'grace@example.com', name: 'Grace Hopper',
    status: 'FORCE_CHANGE_PASSWORD', enabled: true, admin: false, courses: [] },
  { sub: 'preview-3', email: 'katherine@example.com', name: 'Katherine Johnson',
    status: 'CONFIRMED', enabled: true, admin: false, courses: [] },
  { sub: 'preview-4', email: 'margaret@example.com', name: 'Margaret Hamilton',
    status: 'CONFIRMED', enabled: false, admin: false, courses: [] },
  { sub: 'preview-5', email: 'joan@example.com', name: '',
    status: 'FORCE_CHANGE_PASSWORD', enabled: true, admin: false, courses: [] },
];
/* The seeded enrolments cannot be written above: they are course ids, and which courses
 * exist depends on what `icecore dev` was pointed at. Done once, on the first listing. */
let seeded = false;
async function seed() {
  if (seeded) return people;
  seeded = true;
  const ids = (await loadManifest()).map(c => c.id);
  people[0].courses = ids.slice(0, 2);
  people[2].courses = ids.slice(0, 1);
  people[3].courses = ids.slice(0, 1);
  return people;
}
const find = sub => people.find(p => p.sub === sub);

/**
 * Stands in for `api()`. Same contract: resolves to the parsed body, throws an Error
 * carrying the message the real service would have put in `error`.
 */
export async function previewApi(path, { method = 'GET', body } = {}) {
  const [route, query] = path.split('?');
  const q = new URLSearchParams(query || '');
  const role = previewRole();

  if (route === 'session') {
    const courses = (await loadManifest()).map(c => c.id);
    /* The admin role is deliberately enrolled on NOTHING. An admin sees every course
     * because App.vue derives that from the admin flag, and handing this role a full
     * enrolment list would let the grid look right while that rule was broken - the
     * ordinary student path would be carrying it. Empty is the only value that tests it. */
    return {
      courses: role === 'admin' ? [] : courses,
      admin: role === 'admin',
      expires: Date.now() + 12 * 3600 * 1000,
    };
  }

  if (route === 'progress') {
    /* XP earned today, over every course. The stub keeps a counter where the real handler
     * filters the rows' own `at`, because localStorage cannot be asked a question - so
     * `since` is honoured only in the sense that the counter is already today's. */
    if (method === 'GET' && !q.get('course') && q.get('since')) return { xp: store.dayXp() };

    const course = method === 'GET' ? q.get('course') : body.course;
    const rec = store.earned(course);
    const codeRec = store.code(course);
    if (method === 'GET')
      return { solved: Object.keys(rec), last: store.place(course), xp: store.xpIn(rec), code: codeRec };
    // The place-marker and a solved exercise are separate PUT shapes, told apart the same
    // way the real handler tells them apart.
    if (body.last) { store.setPlace(course, body.last); return { ok: true }; }
    const first = body.solved && !(body.exercise in rec);
    // Only what the call carries, exactly as the real handler does: a re-solve sends the
    // code without an amount and must not restate what was earned.
    if (!body.solved) delete rec[body.exercise];
    else if (body.xp != null) rec[body.exercise] = Number(body.xp) || 0;
    else rec[body.exercise] = rec[body.exercise] ?? 0;
    store.saveEarned(course, rec);
    if (first) store.addDayXp(body.xp);
    if (!body.solved) delete codeRec[body.exercise];
    else if (body.code) codeRec[body.exercise] = body.code;
    store.saveCode(course, codeRec);
    return { ok: true };
  }

  if (route === 'hint') {
    // Slow on purpose: "Thinking…" is a state worth being able to look at, and it is over
    // too fast to design against if the stub answers instantly.
    await wait(900);
    return {
      hint: `Look again at what the question is asking you to group by, and check that every
column in your \`SELECT\` is either grouped or aggregated. You are close.

*Preview stub — the real tutor answers only on the deployed stack.*`,
      remaining: 19,
    };
  }

  if (route === 'admin/users') {
    const users = await seed();
    if (method === 'GET') return { users: users.map(u => ({ ...u })), truncated: false };

    if (method === 'POST') {
      const email = String(body.email || '').trim().toLowerCase();
      const known = users.find(u => u.email === email);
      if (known) {
        if (body.resend && known.status !== 'FORCE_CHANGE_PASSWORD')
          throw new Error('That person has already chosen a password - there is nothing to reissue.');
        // Additive, exactly as the real POST is: a course left out is not a course removed.
        known.courses = [...new Set([...known.courses, ...(body.courses || [])])];
        if (body.admin) known.admin = true;
        return { sub: known.sub, invited: false, resent: !!body.resend };
      }
      const made = {
        sub: `preview-${nextSub++}`, email, name: body.name || '',
        status: 'FORCE_CHANGE_PASSWORD', enabled: true,
        admin: !!body.admin, courses: [...(body.courses || [])],
      };
      users.push(made);
      return { sub: made.sub, invited: true, resent: false };
    }

    if (method === 'PUT') {
      const who = find(body.sub);
      if (!who) throw new Error('no such user');
      // The same two refusals the real handler makes, so the disabled controls and the
      // messages behind them can both be looked at locally.
      if (who.email === 'ada@example.com' && body.admin === false)
        throw new Error('you cannot remove your own admin rights');
      if (who.email === 'ada@example.com' && body.enabled === false)
        throw new Error('you cannot disable your own account');
      if (body.name !== undefined) who.name = body.name;
      if (body.courses !== undefined) who.courses = [...body.courses];
      if (body.admin !== undefined) who.admin = body.admin;
      if (body.enabled !== undefined) who.enabled = body.enabled;
      return { ok: true, sub: who.sub };
    }

    if (method === 'DELETE') {
      const i = users.findIndex(u => u.sub === q.get('sub'));
      if (i === -1) throw new Error('no such user');
      users.splice(i, 1);
      return { ok: true, removed: 7 };
    }
  }

  throw new Error(`No preview stub for ${method} /api/${path}`);
}
