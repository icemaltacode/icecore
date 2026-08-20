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

const ROLES = ['student', 'admin', 'signin'];

/** 'student' | 'admin' | 'signin', or null when this is a normal run. */
export const previewRole = () => {
  if (!import.meta.env.DEV) return null;
  const role = import.meta.env.VITE_ICECORE_PREVIEW;
  return ROLES.includes(role) ? role : null;
};

const wait = ms => new Promise(r => setTimeout(r, ms));

/* Seeded so the enrolment table has something in it - an empty table tells you nothing
 * about how a full one looks. In memory only: it resets on reload, deliberately. */
const enrolments = new Map();
const seed = course => {
  if (!enrolments.has(course)) enrolments.set(course, [
    { sub: 'preview-1', email: 'ada@example.com', name: 'Ada Lovelace', status: 'CONFIRMED' },
    { sub: 'preview-2', email: 'grace@example.com', name: 'Grace Hopper', status: 'FORCE_CHANGE_PASSWORD' },
  ]);
  return enrolments.get(course);
};

const progressKey = course => `ice-platform-progress:${course}`;
const placeKey = course => `ice-platform-place:${course}`;

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
    return { courses, admin: role === 'admin', expires: Date.now() + 12 * 3600 * 1000 };
  }

  if (route === 'progress') {
    const course = method === 'GET' ? q.get('course') : body.course;
    const solved = new Set(JSON.parse(localStorage.getItem(progressKey(course)) || '[]'));
    if (method === 'GET')
      return { solved: [...solved], last: localStorage.getItem(placeKey(course)) || null };
    // The place-marker and a solved exercise are separate PUT shapes, told apart the same
    // way the real handler tells them apart.
    if (body.last) { localStorage.setItem(placeKey(course), body.last); return { ok: true }; }
    body.solved ? solved.add(body.exercise) : solved.delete(body.exercise);
    localStorage.setItem(progressKey(course), JSON.stringify([...solved]));
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

  if (route === 'admin/enrolments') {
    const course = method === 'POST' ? body.course : q.get('course');
    const users = seed(course);
    if (method === 'GET') return { users };
    if (method === 'POST') {
      if (users.some(u => u.email === body.email)) throw new Error(`${body.email} is already on this course.`);
      users.push({ sub: `preview-${users.length + 1}`, email: body.email, name: body.name || '', status: 'FORCE_CHANGE_PASSWORD' });
      return { invited: true };
    }
    if (method === 'DELETE') {
      enrolments.set(course, users.filter(u => u.sub !== q.get('sub')));
      return { ok: true };
    }
  }

  throw new Error(`No preview stub for ${method} /api/${path}`);
}
