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
/* The preview user's name, and the one place a rename is remembered.
 *
 * Session-scoped rather than a module `let`: the real rename does not reload, but the real
 * SIGN-OUT does, and preview state that outlived the tab would be a name still changed
 * after signing out and in again as somebody notionally else. `Ada Lovelace` is the name in
 * PREVIEW_TOKEN in auth.js, so an untouched preview and the top bar agree. */
/* The Article 15 statement, copied from infra/lambda/account/index.mjs.
 *
 * THE ONE PLACE IN PREVIEW WHERE COPYING IS THE POINT. Everything else here stands in for a
 * shape; this stands in for the WORDS, and words are what this feature is - a screen that
 * rendered plausible placeholder prose would let us ship a statement nobody had read. If the
 * two ever disagree, the Lambda is right and this is stale: it is the copy that gets sent to
 * a person. */
const ABOUT = {
  controller: { name: 'ICE Campus (Institute of Computer Education Ltd.)', contact: 'keith@icecampus.com' },
  purposes: [
    'Giving you access to the courses you are enrolled on.',
    'Recording what you have solved, so that your progress and XP survive between sessions'
      + ' and across devices.',
    'Answering your requests for a hint, which sends your code to an AI service.',
    'Administering accounts - inviting you, enrolling you, and grouping you into a class.',
  ],
  categories: [
    'Identity: your name and the email address you sign in with.',
    'Enrolment: which courses you are on and which class you are in.',
    'Learning record: which exercises you have solved, when, what XP each earned, where you'
      + ' left off, and the code you wrote to solve them.',
    'Hint usage: how many hints you asked for, on which day and which course, and the size'
      + ' of each request.',
  ],
  recipients: [
    'Amazon Web Services, which hosts this platform. Your data is stored in the EU'
      + ' (eu-south-1, Milan).',
    'OpenAI, when you ask for a hint. THE CODE YOU WROTE IS SENT WITH THE REQUEST, because'
      + ' that is what the hint is about. OpenAI is in the United States, so this is a'
      + ' transfer outside the EU.',
  ],
  retention: [
    'Your account and your learning record are kept for as long as your account exists.',
    'The daily hint counter is deleted automatically after three days - it is a limit rather'
      + ' than history.',
    'Operational logs, which record that you signed in but not what you did, are kept for one'
      + ' month and then deleted automatically.',
  ],
  rights: [
    'Rectification: you can change your name on this page. Ask your tutor about anything else.',
    'Erasure: ask, and your account and everything above is deleted.',
    'Restriction and objection: ask.',
    'Portability: the download on this page is machine-readable JSON.',
  ],
  complaint: 'You can complain to the Information and Data Protection Commissioner in Malta'
    + ' - idpc.org.mt - if you think we have got this wrong.',
  source: 'From you, and from the tutor who created your account and enrolled you.',
  automated: 'Nothing here makes an automated decision about you with legal or similarly'
    + ' significant effects. Your exercises are marked automatically, but that marking is'
    + ' formative - it tells you whether an answer is right, and nothing else follows from it.',
};

const NAME_KEY = 'ice-preview-name';
const PREVIEW_NAME = () => sessionStorage.getItem(NAME_KEY) || 'Ada Lovelace';

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

  /* The account screen, standing in for a Cognito pool and a partition read.
   *
   * The name lives in sessionStorage rather than in a `let`, so that a rename survives the
   * reload the real one causes and reads as having worked. Session-scoped on purpose - it
   * is preview state, and it should not outlive the tab any more than the fake sign-out
   * does. */
  /* The reset, which in preview is the local half doing ALL the work - there being no
   * DynamoDB behind it. That makes it the honest stand-in: the thing this stub clears is
   * exactly the thing the real one has to remember to clear as well as its rows. */
  if (route === 'account/progress' && method === 'DELETE') {
    const course = q.get('course');
    if (!course) throw new Error('course is required');
    const removed = Object.keys(store.earned(course)).length;
    store.forget(course);
    return { ok: true, course, removed };
  }

  /* The access request. Shaped exactly like the real one - both halves, grouped the same
   * way - so that the screen's rendering of it, and the file a tutor is shown before this
   * goes anywhere near a student, are the real thing rather than an approximation. */
  if (route === 'account/export') {
    const courses = (await loadManifest()).map(c => c.id);
    const mine = role === 'admin' ? [] : courses;
    const progress = [];
    for (const id of mine) {
      const rec = store.earned(id);
      const codes = store.code(id);
      for (const [exercise, xp] of Object.entries(rec))
        progress.push({ course: id, exercise, xp, at: new Date().toISOString(),
                        ...(codes[exercise] ? { code: codes[exercise] } : {}) });
    }
    return {
      generated: new Date().toISOString(),
      about: ABOUT,
      identity: {
        name: PREVIEW_NAME(), email: 'ada@example.com',
        accountCreated: '2026-01-14T09:12:00.000Z', lastChanged: new Date().toISOString(),
        enabled: true, status: 'CONFIRMED', administrator: role === 'admin',
      },
      data: {
        enrolments: mine.map(course => ({ course, email: 'ada@example.com', name: PREVIEW_NAME() })),
        cohorts: [{ cohort: 'sept-2026-evening', email: 'ada@example.com', name: PREVIEW_NAME() }],
        progress,
        place: mine.filter(id => store.place(id)).map(course => ({ course, exercise: store.place(course) })),
        /* Present, and not empty. The whole argument about this file was whether hint spend
         * belongs in it, so a preview that shows none is a preview of the version we
         * decided against. */
        hintsAsked: [
          { day: '2026-09-01', course: mine[0] || 'a-course', n: 4, in: 5120, out: 890, model: 'gpt-5.6-luna' },
          { day: '2026-09-02', course: mine[0] || 'a-course', n: 2, in: 2460, out: 410, model: 'gpt-5.6-luna' },
        ],
        hintCounters: [{ day: '2026-09-02', n: 6 }],
      },
    };
  }

  if (route === 'account') {
    const courses = (await loadManifest()).map(c => c.id);
    const mine = role === 'admin' ? [] : courses;
    if (method === 'PUT') {
      const next = String(body?.name || '').trim();
      if (!next) return { ok: true, name: PREVIEW_NAME() };
      if (next.length > 100) throw new Error('That name is too long.');
      sessionStorage.setItem(NAME_KEY, next);
      return { ok: true, name: next };
    }
    /* Real XP out of the same local record the player writes, so the figure here and the
     * figure on the course card cannot disagree - which is the bug this screen would
     * otherwise be the first place to show. */
    const byCourse = {};
    let total = 0;
    for (const id of mine) {
      const rec = store.earned(id);
      const solved = Object.keys(rec).length;
      if (!solved) continue;
      byCourse[id] = { solved, xp: store.xpIn(rec) };
      total += byCourse[id].xp;
    }
    return {
      sub: 'preview-sub',
      name: PREVIEW_NAME(),
      email: role === 'admin' ? 'ada@example.com' : 'ada@example.com',
      admin: role === 'admin',
      courses: mine,
      /* One archived, because a cohort that has ended still names a student's class and is
       * a state the picker has to survive - the same reason the seeded cohort list holds
       * an empty one. */
      cohorts: [
        { id: 'sept-2026-evening', title: 'Sept 2026 evening', archived: false },
        { id: 'jan-2026-day', title: 'Jan 2026 day', archived: true },
      ],
      xp: { total, byCourse },
      /* Not zero. Zero is the state where nothing has been spent, which is the one state
       * that shows none of the wording this section exists to get right. */
      hints: { used: 6, limit: 40, left: 34 },
      about: ABOUT,
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
          // What they are enrolled on, which is what a watched session draws its grid from.
          enrolled: [...who.courses], cohorts: [...who.cohorts],
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
