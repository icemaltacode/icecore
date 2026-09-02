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
import { loadManifest, loadCourse } from './content.js';
import { walkCourse, gradable } from './walk.js';
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
    status: 'CONFIRMED', enabled: true, admin: true, courses: [], cohorts: [] },
  { sub: 'preview-2', email: 'grace@example.com', name: 'Grace Hopper',
    status: 'FORCE_CHANGE_PASSWORD', enabled: true, admin: false, courses: [], cohorts: ['sept-2026-evening'] },
  { sub: 'preview-3', email: 'katherine@example.com', name: 'Katherine Johnson',
    status: 'CONFIRMED', enabled: true, admin: false, courses: [], cohorts: ['sept-2026-evening'] },
  { sub: 'preview-4', email: 'margaret@example.com', name: 'Margaret Hamilton',
    status: 'CONFIRMED', enabled: false, admin: false, courses: [], cohorts: ['jan-2026'] },
  { sub: 'preview-5', email: 'joan@example.com', name: '',
    status: 'FORCE_CHANGE_PASSWORD', enabled: true, admin: false, courses: [], cohorts: [] },
];
/* One of each state the cohort screens draw differently: a live intake with people in it, a
 * finished one that is archived, and an empty one - which exists because a cohort is named
 * before it is filled, and is the case a list derived from membership could not show at
 * all. */
const classes = [
  { id: 'sept-2026-evening', title: 'Sept 2026 evening', created: '2026-09-01T09:00:00Z', archived: false },
  { id: 'jan-2026', title: 'Jan 2026', created: '2026-01-08T09:00:00Z', archived: true },
  { id: 'data-team', title: 'Data team', created: '2026-08-20T09:00:00Z', archived: false },
];

/* Resolve as the real API does - id, then title, then create - so that inventing a cohort
 * from the dialog or the import behaves here the way it will on the stack. */
const slug = t => String(t).trim().toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
function resolveCohorts(names) {
  const ids = [];
  for (const raw of names || []) {
    const name = String(raw ?? '').trim();
    if (!name) continue;
    const hit = classes.find(c =>
      c.id === name || c.title.trim().toLowerCase() === name.toLowerCase());
    if (hit) { if (!ids.includes(hit.id)) ids.push(hit.id); continue; }
    const made = { id: slug(name) || 'cohort', title: name, created: new Date().toISOString(), archived: false };
    classes.push(made);
    if (!ids.includes(made.id)) ids.push(made.id);
  }
  return ids;
}
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

  if (route === 'admin/cohorts') {
    if (method === 'POST') {
      const title = String(body.title || '').trim();
      const hit = classes.find(c => c.title.trim().toLowerCase() === title.toLowerCase());
      if (hit) return { cohort: hit, created: false };
      const made = { id: slug(title) || 'cohort', title, created: new Date().toISOString(), archived: false };
      classes.push(made);
      return { cohort: made, created: true };
    }
    if (method === 'PUT') {
      const c = classes.find(x => x.id === body.id);
      if (!c) throw new Error('no such cohort');
      if (body.title !== undefined) c.title = String(body.title).trim();
      if (body.archived !== undefined) c.archived = !!body.archived;
      return { ok: true, id: c.id };
    }
    if (method === 'DELETE') {
      const id = q.get('id');
      const i = classes.findIndex(c => c.id === id);
      if (i === -1) throw new Error('no such cohort');
      classes.splice(i, 1);
      // The grouping and none of the people, exactly as the real handler does it.
      let removed = 0;
      for (const p of people) {
        const was = p.cohorts.length;
        p.cohorts = p.cohorts.filter(c => c !== id);
        removed += was - p.cohorts.length;
      }
      return { ok: true, removed };
    }
  }

  if (route === 'admin/users') {
    const users = await seed();
    /* One person, and one of their courses. Invented rather than read: nothing local holds
     * another student's progress, and the screen is about the shape of an answer - a
     * course with work in it, a course barely started, and an exercise solved with nothing
     * saved beside it, because that is what an exercise finished before any of this
     * existed looks like. The code says out loud that it is a stand-in, the way the tutor
     * reply does. */
    if (method === 'GET' && q.get('sub')) {
      const who = find(q.get('sub'));
      if (!who) throw new Error('no such user');
      const ids = (await loadManifest()).map(c => c.id);
      const mine = who.courses.length ? who.courses : ids.slice(0, 1);
      const course = q.get('course');
      if (!course) {
        return {
          sub: who.sub, email: who.email, name: who.name,
          courses: mine.map((id, i) => ({
            course: id, solved: 12 - i * 7, xp: 240 - i * 140,
            first: '2026-08-04T09:12:00Z', last: i ? '2026-08-19T16:02:00Z' : '2026-09-01T11:40:00Z',
            place: { exercise: '2.3.1', at: '2026-09-01T11:40:00Z' },
          })),
        };
      }
      // Real ids here too, for the same reason as the course stub below: an invented id
      // resolves to no title, and the screen quietly reads "Exercise 3" for everything.
      const walk = gradable(walkCourse(await loadCourse(course).catch(() => null)))
        .map(r => String(r.id));
      const solved = walk.slice(0, 5).map((id, i) => ({
        exercise: id,
        xp: 20,
        at: `2026-08-0${i + 1}T10:00:00Z`,
        code: i === 2 ? undefined : {
          0: `-- Preview stub: not a real submission.\nSELECT title, release_year\nFROM films\nWHERE release_year > 2000;`,
        },
      }));
      return {
        sub: who.sub, email: who.email, name: who.name, course,
        solved, xp: solved.reduce((n, e) => n + e.xp, 0),
        place: { exercise: walk[2] || '', at: '2026-08-03T10:00:00Z' },
        clipped: false,
      };
    }
    /* One course. Built from the seeded people, so the cohort filter on that screen has
     * something real to filter - the point of the stub is the shape of the screen, and a
     * cohort column that never varies would not exercise it. Spread across started,
     * half-done, finished and not-started, because those are four different rows. */
    if (method === 'GET' && q.get('course')) {
      const course = q.get('course');
      const on = users.filter(u => u.courses.includes(course));
      /* THE REAL EXERCISE IDS, read out of the course being previewed.
       *
       * Invented ones do not work here and the failure is silent: an id is a DataCamp
       * integer like 1418943, so a stub numbering its exercises 1, 2, 3 matches nothing on
       * the screen it exists to fill and every tally draws a truthful zero. The rule the
       * rest of the app follows applies to the stand-in too - one spelling of an id. */
      const rows = walkCourse(await loadCourse(course).catch(() => null));
      const walk = gradable(rows).map(r => String(r.id));
      // Somebody parked on a topic's slides, because that is where most topics start and
      // it is the state the roster and the stall list both draw differently.
      const decks = rows.filter(r => r.kind === 'slides').map(r => String(r.id));
      const students = on.map((u, i) => {
        const n = Math.min([14, 0, 31, 6][i % 4], walk.length);
        const solved = walk.slice(0, n);
        return {
          sub: u.sub, name: u.name, email: u.email,
          solved, xp: n * 20,
          last: n ? `2026-08-${String(10 + (i % 18)).padStart(2, '0')}T10:00:00Z` : null,
          place: n
            ? { exercise: (i % 2 ? decks[i % decks.length] : null) || walk[n - 1],
                at: '2026-08-20T10:00:00Z' }
            : null,
        };
      });
      // A few exercises that drew help, so that panel is not permanently empty locally.
      const hints = {};
      for (const [k, n] of [[6, 5], [11, 9], [14, 2], [30, 7]])
        if (walk[k]) hints[walk[k]] = n;
      return { course, students, hints };
    }
    if (method === 'GET')
      return { users: users.map(u => ({ ...u })), cohorts: classes.map(c => ({ ...c })), truncated: false };

    if (method === 'POST') {
      const email = String(body.email || '').trim().toLowerCase();
      const known = users.find(u => u.email === email);
      if (known) {
        if (body.resend && known.status !== 'FORCE_CHANGE_PASSWORD')
          throw new Error('That person has already chosen a password - there is nothing to reissue.');
        // Additive, exactly as the real POST is: a course left out is not a course removed.
        known.courses = [...new Set([...known.courses, ...(body.courses || [])])];
        known.cohorts = [...new Set([...known.cohorts, ...resolveCohorts(body.cohorts)])];
        if (body.admin) known.admin = true;
        return { sub: known.sub, invited: false, resent: !!body.resend };
      }
      const made = {
        sub: `preview-${nextSub++}`, email, name: body.name || '',
        status: 'FORCE_CHANGE_PASSWORD', enabled: true,
        admin: !!body.admin, courses: [...(body.courses || [])],
        cohorts: resolveCohorts(body.cohorts),
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
      if (body.cohorts !== undefined) who.cohorts = resolveCohorts(body.cohorts);
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
