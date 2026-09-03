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
 * active, suspended, admin, and somebody in no cohort at all - which is now the same thing
 * as somebody on no course. In memory only: it resets on reload, deliberately.
 *
 * NOBODY CARRIES A `courses` ARRAY. It is derived from their cohorts by `coursesOf`, the way
 * the real listing derives it - a stub that stored what the real thing computes would go on
 * working after somebody broke the computation.
 *
 * `ada@example.com` is the signed-in preview user - see PREVIEW_TOKEN in auth.js - so the
 * self-editing rules have somebody to apply to. */
let nextSub = 100;
const people = [
  { sub: 'preview-1', email: 'ada@example.com', name: 'Ada Lovelace',
    status: 'CONFIRMED', enabled: true, admin: true, cohorts: [] },
  { sub: 'preview-2', email: 'grace@example.com', name: 'Grace Hopper',
    status: 'FORCE_CHANGE_PASSWORD', enabled: true, admin: false, cohorts: ['sept-2026-evening'] },
  { sub: 'preview-3', email: 'katherine@example.com', name: 'Katherine Johnson',
    status: 'CONFIRMED', enabled: true, admin: false, cohorts: ['sept-2026-evening', 'data-team'] },
  { sub: 'preview-4', email: 'margaret@example.com', name: 'Margaret Hamilton',
    status: 'CONFIRMED', enabled: false, admin: false, cohorts: ['jan-2026', 'data-team'] },
  { sub: 'preview-5', email: 'joan@example.com', name: '',
    status: 'FORCE_CHANGE_PASSWORD', enabled: true, admin: false, cohorts: [] },
  /* Alone in the cohort that takes every course there is - which is what makes the course
   * PICKER reachable. It only appears when a cohort takes more than one, so it needs a run
   * with more than one content directory:
   *   icecore dev ../a/content ../b/content --as admin
   * With one course the picker is correctly skipped, which is a different thing worth
   * seeing and not a substitute for seeing this. */
  { sub: 'preview-6', email: 'dorothy@example.com', name: 'Dorothy Vaughan',
    status: 'CONFIRMED', enabled: true, admin: false, cohorts: ['oct-2026-morning'] },
];
/* ONE OF EACH STATE THE COHORT SCREEN DRAWS DIFFERENTLY, which since the Live button means
 * one per reason that button can be off - four of them, none guessable from the row:
 *
 *   sept-2026-evening  takes no course                "not taking any course yet"
 *   jan-2026           archived                       "restore it before delivering"
 *   data-team          somebody else is delivering    the refusal, naming them
 *   new-intake         nobody in it                   "there is nobody to deliver to"
 *   oct-2026-morning   ready, and takes several       the course picker
 *
 * An empty cohort has to exist here for the reason it has to exist at all: you name a class
 * before you import it, and that is exactly the case a list derived from membership could
 * not represent. A cohort taking NO COURSE is the same argument one level along - it is the
 * ordinary state of a class between being named and being set up, it is what an import
 * creates, and it is the one state where everybody in it signs in to an empty grid. */
const classes = [
  { id: 'sept-2026-evening', title: 'Sept 2026 evening', created: '2026-09-01T09:00:00Z', archived: false, courses: [] },
  { id: 'oct-2026-morning', title: 'Oct 2026 morning', created: '2026-10-01T09:00:00Z', archived: false, courses: [] },
  { id: 'jan-2026', title: 'Jan 2026', created: '2026-01-08T09:00:00Z', archived: true, courses: [] },
  { id: 'data-team', title: 'Data team', created: '2026-08-20T09:00:00Z', archived: false, courses: [] },
  { id: 'new-intake', title: 'New intake', created: '2026-09-02T09:00:00Z', archived: false, courses: [] },
];

/* Live delivery, standing in for the session rows and the socket.
 *
 * `data-team` is SEEDED AS ALREADY RUNNING, and by somebody else. That is the state the
 * cohort screen draws differently and cannot be reached here otherwise - a preview where
 * every Live button is enabled is a preview in which the refusal, its tooltip and the
 * `Rejoin` label are all messages nobody reads before shipping. It is deliberately held by
 * a name that is not the preview user's, because `Rejoin` and the refusal differ only by
 * whose sub is on the row.
 *
 * There is no socket in preview - `socketUrl()` is null with no auth.json, so `live.js`
 * never attempts one - which means nothing here can stand in for what a second browser
 * would say. What it CAN do is make every screen and every refusal reachable, which is what
 * the rule asks of it.
 */
let sessions = [
  { cohort: 'data-team', title: 'Data team', course: null, by: 'preview-9',
    name: 'Sarah Mifsud', at: new Date(Date.now() - 34 * 60000).toISOString(),
    sharing: false, position: null },
];
/* The cohort bookmarks, keyed `<cohort>#<course>`. Empty to start with, so the picker's
 * "never delivered live" line is the first thing seen - and then filled by ending a
 * session, which is the only way it is filled on the stack either. That round trip is the
 * whole point of keeping them here: a stub that seeded a mark would show the badge working
 * without anything having written one. */
const cohortMarks = {};
const marksFor = cohort => Object.fromEntries(
  Object.entries(cohortMarks)
    .filter(([k]) => k.startsWith(`${cohort}#`))
    .map(([k, v]) => [k.slice(cohort.length + 1), v]));

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
    /* A cohort invented here takes NOTHING, exactly as one invented by the real API does -
     * which is what makes the import's "these people will be on nothing yet" warning
     * reachable without a stack behind it. */
    const made = { id: slug(name) || 'cohort', title: name, created: new Date().toISOString(),
                   archived: false, courses: [] };
    classes.push(made);
    if (!ids.includes(made.id)) ids.push(made.id);
  }
  return ids;
}
/* THE COURSES GO ON THE COHORTS, and they cannot be written above: they are course ids, and
 * which courses exist depends on what `icecore dev` was pointed at. Done once, on the first
 * listing.
 *
 * `sept-2026-evening` is deliberately left empty. It used to be the cohort whose members
 * shared no course, which was the intersection's way of disabling the Live button; the same
 * refusal is now "this intake takes no course", and this is the row that reaches it. */
let seeded = false;
async function seed() {
  if (seeded) return people;
  seeded = true;
  const ids = (await loadManifest()).map(c => c.id);
  byId('oct-2026-morning').courses = ids;
  byId('data-team').courses = ids.slice(0, 1);
  byId('jan-2026').courses = ids.slice(0, 1);
  return people;
}
const byId = id => classes.find(c => c.id === id);

/**
 * A person's courses, derived exactly as the API derives them.
 *
 * THE STUB HAS TO DERIVE IT TOO, rather than keeping a `courses` array beside the cohorts.
 * A stub that stored what the real thing computes is a stub that would go on working after
 * somebody broke the computation - which is the one failure a local run exists to catch.
 */
const coursesOf = who => [...new Set((who.cohorts || []).flatMap(c => byId(c)?.courses || []))];
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
  controller: { name: 'ICE Campus (Institute of Computer Education Ltd.)', contact: 'student@icecampus.com' },
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
    'Rectification: you can change your name on this page. Ask your educator about anything else.',
    'Erasure: ask, and your account and everything above is deleted.',
    'Restriction and objection: ask.',
    'Portability: the download on this page is machine-readable JSON.',
  ],
  complaint: 'You can complain to the Information and Data Protection Commissioner in Malta'
    + ' - idpc.org.mt - if you think we have got this wrong.',
  source: 'From you, and from the educator who created your account and enrolled you.',
  automated: 'Nothing here makes an automated decision about you with legal or similarly'
    + ' significant effects. Your exercises are marked automatically, but that marking is'
    + ' formative - it tells you whether an answer is right, and nothing else follows from it.',
};

const NAME_KEY = 'ice-preview-name';
/* The uploaded avatar, as a data: URL. Session-scoped like the name, and for the same
 * reason - preview state should not outlive the tab. */
const AVATAR_KEY = 'ice-preview-avatar';
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
      /* Whatever the last upload left, so the top bar shows a picture on reload exactly as
       * it does on a deployment. A data: URL rather than a key: there is no bucket here, and
       * the top bar simply prefixes BASE_URL onto whatever this is - which a data: URL
       * survives, because it is absolute. */
      avatar: sessionStorage.getItem(AVATAR_KEY) || '',
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

  /* The avatar. The real one stores bytes and hands back a key; this stores the same bytes
   * as a data: URL, so everything downstream - the chip, the fallback, the delete - is
   * exercised on the real code path. */
  if (route === 'account/avatar') {
    if (method === 'DELETE') { sessionStorage.removeItem(AVATAR_KEY); return { ok: true, avatar: null }; }
    const url = `data:${body?.type || 'image/webp'};base64,${body?.data || ''}`;
    /* sessionStorage is a few megabytes and a normalised avatar is ~15KB, so this only
     * fails if something upstream stopped normalising - which is worth failing loudly for
     * rather than swallowing. */
    sessionStorage.setItem(AVATAR_KEY, url);
    return { ok: true, avatar: url };
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
      avatar: sessionStorage.getItem(AVATAR_KEY) || null,
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
      const made = { id: slug(title) || 'cohort', title, created: new Date().toISOString(),
                     archived: false, courses: [...(body.courses || [])] };
      classes.push(made);
      return { cohort: made, created: true };
    }
    if (method === 'PUT') {
      const c = classes.find(x => x.id === body.id);
      if (!c) throw new Error('no such cohort');
      if (body.title !== undefined) c.title = String(body.title).trim();
      // The whole desired set, as the real one is: unticking is withdrawing.
      if (body.courses !== undefined) c.courses = [...body.courses];
      if (body.archived !== undefined) c.archived = !!body.archived;
      return { ok: true, id: c.id };
    }
    if (method === 'DELETE') {
      const id = q.get('id');
      const i = classes.findIndex(c => c.id === id);
      if (i === -1) throw new Error('no such cohort');
      classes.splice(i, 1);
      /* The membership rows and none of the people, exactly as the real handler does it -
       * which now also takes the cohort's courses away from every one of them, because
       * there is no other row saying they were on it. */
      let removed = 0;
      for (const p of people) {
        const was = p.cohorts.length;
        p.cohorts = p.cohorts.filter(c => c !== id);
        removed += was - p.cohorts.length;
      }
      return { ok: true, removed };
    }
  }

  /* Starting, ending, and who is live. The course on the seeded session is filled in on
   * first read rather than in the literal above, because the manifest is loaded lazily and
   * a hard-coded course id would name a course this checkout may not have. */
  if (route === 'live/session') {
    const first = (await loadManifest())[0]?.id || 'course';
    for (const s of sessions) if (!s.course) s.course = first;

    if (method === 'GET') {
      const cohort = q.get('cohort');
      /* NOT FILTERED, and the real one is. Filtering is a membership question, and the only
       * membership this file has is the admin panel's user list - a different fiction, in
       * which the preview identity is an admin with no cohorts at all. Reproducing it here
       * would hide the seeded session from `--as student` and take the invitation band with
       * it, which is the one thing this stub exists to make reachable.
       *
       * What the real route does with it is checked in test/live.mjs, where there are real
       * rows to be a member of. */
      if (!cohort) return { running: sessions.map(x => ({ ...x })) };
      return {
        session: sessions.find(x => x.cohort === cohort) || null,
        marks: marksFor(cohort),
      };
    }
    if (method === 'POST') {
      const { cohort, course } = body || {};
      const held = sessions.find(s => s.cohort === cohort);
      // The conditional write's refusal, in the words the real one uses.
      if (held) { const e = new Error(`${held.name} is already delivering to this cohort.`); throw e; }
      const made = {
        cohort, title: classes.find(c => c.id === cohort)?.title || cohort, course,
        by: 'preview-1', name: PREVIEW_NAME(), at: new Date().toISOString(),
        sharing: false, position: null,
      };
      sessions.push(made);
      return { session: made, marks: marksFor(cohort) };
    }
    if (method === 'DELETE') {
      const cohort = q.get('cohort');
      const held = sessions.find(s => s.cohort === cohort);
      const where = q.get('exercise');
      // Missing means missing, exactly as the real one has it: no position leaves the
      // previous mark standing rather than replacing it with nothing.
      if (held && where) {
        cohortMarks[`${cohort}#${held.course}`] = {
          exercise: where, title: q.get('title') || '', at: new Date().toISOString(),
        };
      }
      /* The takeover rule, and preview is the only place it can be SEEN: another admin's
       * session with nobody connected may be ended by anyone, and there are never any
       * connections here. Refusing would make an unreachable dead end of a cohort. */
      sessions = sessions.filter(s => s.cohort !== cohort);
      /* THE SUMMARY, which is otherwise unreachable without running a real lesson: the
       * tallies behind it are accumulated on the session row by four different socket
       * handlers, and preview has no socket. Seeded with the shapes that are easy to get
       * wrong rather than with a tidy example - somebody who attended eight minutes of an
       * hour, an exercise the class could not run, and a bookmark that is missing when the
       * ending carried no position. */
      const startedAt = held?.at || new Date(Date.now() - 52 * 60000).toISOString();
      const summary = !held ? null : {
        mark: where ? { exercise: where, title: q.get('title') || '' } : null,
        minutes: Math.max(1, Math.round((Date.now() - Date.parse(startedAt)) / 60000)),
        covered: (rowsForSummary() || []).slice(0, 5)
          .map(r => ({ exercise: r.at, title: r.title })),
        people: [
          { sub: 'preview-2', name: 'Grace Hopper', minutes: 51,
            first: new Date(Date.parse(startedAt) + 60000).toISOString() },
          { sub: 'preview-3', name: 'Katherine Johnson', minutes: 48,
            first: new Date(Date.parse(startedAt) + 3 * 60000).toISOString() },
          { sub: 'preview-6', name: 'Dorothy Vaughan', minutes: 8,
            first: new Date(Date.parse(startedAt) + 40 * 60000).toISOString() },
        ],
        said: 14,
        worst: [
          { exercise: 'x1', title: 'Joining three tables', tried: 11, right: 3, wrong: 6, err: 2 },
          { exercise: 'x2', title: 'Counting with GROUP BY', tried: 9, right: 6, wrong: 3, err: 0 },
        ],
        cohort: held.title, course: held.course,
        at: startedAt, endedAt: new Date().toISOString(),
      };
      return { ok: true, ended: !!held, marked: !!(held && where), summary };
    }
  }

  /* A ticket is minted and never spent: there is no socket to spend it on. It answers at
   * all so that a caller which asks for one before connecting behaves the same here. */
  if (route === 'live/ticket' && method === 'POST') {
    return { ticket: 'preview', expires: new Date(Date.now() + 60000).toISOString() };
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
      const on = coursesOf(who);
      const mine = on.length ? on : ids.slice(0, 1);
      const course = q.get('course');
      if (!course) {
        return {
          sub: who.sub, email: who.email, name: who.name,
          // What they are enrolled on, which is what a watched session draws its grid from.
          enrolled: on, cohorts: [...who.cohorts],
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
      const on = users.filter(u => coursesOf(u).includes(course));
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
      return {
        // `courses` derived on the way out, exactly as the real listing derives it.
        users: users.map(u => ({ ...u, courses: coursesOf(u) })),
        cohorts: classes.map(c => ({ ...c })),
        truncated: false,
      };

    if (method === 'POST') {
      const email = String(body.email || '').trim().toLowerCase();
      const known = users.find(u => u.email === email);
      if (known) {
        if (body.resend && known.status !== 'FORCE_CHANGE_PASSWORD')
          throw new Error('That person has already chosen a password - there is nothing to reissue.');
        // Additive, exactly as the real POST is: a cohort left out is not one removed.
        known.cohorts = [...new Set([...known.cohorts, ...resolveCohorts(body.cohorts)])];
        if (body.admin) known.admin = true;
        return { sub: known.sub, invited: false, resent: !!body.resend,
                 cohorts: [...known.cohorts], enrolled: coursesOf(known) };
      }
      const made = {
        sub: `preview-${nextSub++}`, email, name: body.name || '',
        status: 'FORCE_CHANGE_PASSWORD', enabled: true,
        admin: !!body.admin,
        cohorts: resolveCohorts(body.cohorts),
      };
      users.push(made);
      return { sub: made.sub, invited: true, resent: false,
               cohorts: [...made.cohorts], enrolled: coursesOf(made) };
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

/* ---- the room, as a script -------------------------------------------------
 *
 * There is no socket in preview and there cannot be one: nothing local has another browser
 * in it to be the other end. What there CAN be is every state the participants panel draws
 * differently, which is what the rule actually asks for - a state nobody can reach locally
 * is a state nobody sees before shipping, and this panel has four of them plus an empty
 * room and a reconnection.
 *
 * It plays the REAL MESSAGES at the real handlers. `emit` here is delivery.js's own
 * `receive`, so what is exercised is the parsing, the per-person connection counting and
 * the presence derivation - not a second drawing of the same list. Anything less would test
 * the stub.
 *
 * The timeline is short on purpose: a tutor opening this screen should see it move within a
 * few seconds rather than wonder whether it is broken.
 */
/* The open course's rows, for the summary's "covered" list. Registered by delivery.js like
 * the scripted walk's, and read at the moment it is asked rather than captured - a session is
 * ended long after this file was loaded. */
let rowsForSummary = () => [];
export const previewSummaryRows = fn => { rowsForSummary = fn; };

let roomTimers = [];
/* The scripted class's answering chain, held apart from `roomTimers` because it re-arms
 * itself rather than being scheduled once. */
let answering = null;

export function previewRoom(session, emit, rows = () => [], whereAmI = () => null) {
  stopPreviewRoom();
  const at = ms => new Date(Date.now() - ms).toISOString();
  /* ROWS ARE ASKED FOR WHEN THEY ARE USED, not now. Joining a session happens BEFORE its
   * course is opened - the join is what tells the player which course to open - so reading
   * the walk here returns the previous course's rows, or none at all. The scripted tutor
   * would then walk through ids that do not exist in the course on screen, nothing would
   * move, and it would look exactly like following being broken. */
  const start = { exercise: null, title: '', slide: null };
  /* Is the preview user the tutor here, or a student following one? Both are reachable -
   * starting a session from the cohort screen makes you the tutor, and opening
   * `#/live/data-team` by hand joins the seeded one somebody else is running. The second is
   * the only way to see the student's half of the band, the Catch up nudge and the
   * following itself without a second browser. */
  const leading = (session.by || 'preview-1') === 'preview-1';

  const members = [
    { sub: 'preview-2', name: 'Grace Hopper' },
    { sub: 'preview-3', name: 'Katherine Johnson' },
    { sub: 'preview-4', name: 'Margaret Hamilton' },
    { sub: 'preview-6', name: 'Dorothy Vaughan' },
  ];
  const conn = (sub, name, extra = {}) => ({
    sub, name, role: 'student', seen: at(0), position: start, ...extra,
  });

  /* The tutor is deliberately NOT in `members` - an admin has no membership row, which is
   * the case that would otherwise leave them missing from the panel of the room they are
   * running. */
  const tutor = { sub: session.by || 'preview-1', name: session.name || PREVIEW_NAME(),
                  role: 'tutor', seen: at(0), position: start };
  // Following, the preview user is one of the students and needs a connection of their own.
  const self = leading ? null : conn('preview-1', PREVIEW_NAME());

  const play = (ms, msg) => roomTimers.push(setTimeout(() => emit(msg), ms));

  // Two here to begin with, two yet to arrive.
  emit({ type: 'roster', members,
         here: [tutor, conn('preview-2', 'Grace Hopper'), ...(self ? [self] : [])] });

  /* THE TUTOR WALKS THE COURSE, when somebody else is the tutor. This is the whole of the
   * student side: the screen moves on its own, navigating stops it, and Catch up comes
   * back. Every three seconds, through real rows of the real course - a made-up id would
   * resolve to nothing and the screen would sit still, which is what "following is broken"
   * looks like. */
  if (!leading) {
    for (let i = 0; i < 7; i++) {
      roomTimers.push(setTimeout(() => {
        const row = rows()[i];
        if (!row) return;   // a shorter course simply stops walking
        emit({
          type: 'moved', sub: tutor.sub,
          position: { exercise: row.at, title: row.title, slide: null },
          at: new Date().toISOString(),
        });
      }, 3000 * (i + 1)));
    }
  }

  play(2500, { type: 'joined', who: conn('preview-3', 'Katherine Johnson') });
  play(4500, { type: 'joined', who: conn('preview-6', 'Dorothy Vaughan') });

  /* Somewhere else: connected, attentive, and not where the tutor is. The position is a
   * made-up id on purpose - it only has to DIFFER from the leader's for the group to
   * split, and the title is what the panel actually shows. */
  play(7000, { type: 'moved', sub: 'preview-3',
               position: { exercise: 'elsewhere', title: 'Reading ahead — 2.4.3' },
               at: new Date().toISOString() });

  /* Idle, sent as a fresh roster with one `seen` backdated past the threshold. A roster is
   * what a real reconnection sends, so this exercises the idempotent path as well. */
  roomTimers.push(setTimeout(() => emit({
    type: 'roster',
    members,
    here: [
      tutor,
      ...(self ? [self] : []),
      conn('preview-2', 'Grace Hopper', { seen: at(20 * 60000) }),
      conn('preview-3', 'Katherine Johnson',
           { position: { exercise: 'elsewhere', title: 'Reading ahead — 2.4.3' } }),
      conn('preview-6', 'Dorothy Vaughan'),
    ],
  }), 10000));

  // And somebody drops out, which is the only way `Not here` is reached with people in it.
  play(14000, { type: 'left', sub: 'preview-6' });

  /* ---- and somebody's screen being driven -----------------------------------
   *
   * The student's two halves of remote control, neither of which is reachable on one
   * machine: an educator taking over YOUR screen, and the class being pointed at a
   * CLASSMATE's. They are different bands saying different things and both are easy to get
   * wrong, so the script plays them in that order and releases in between - a mode that only
   * ever appears is a mode whose exit nobody tries.
   *
   * The educator's own half needs no script: `--as admin` reaches it by taking control from
   * the panel, which the echo in delivery.js makes work without a socket. */
  if (!leading) {
    const driver = { by: tutor.sub, byName: tutor.name };
    // A classmate's screen, shared with the room. Screen 12.
    play(17000, { type: 'controlling',
                  control: { ...driver, sub: 'preview-2', name: 'Grace Hopper',
                             sharing: true, at: new Date().toISOString() } });
    play(25000, { type: 'controlling', control: null });
    // Then your own. Screen 10.
    play(29000, { type: 'controlling',
                  control: { ...driver, sub: 'preview-1', name: PREVIEW_NAME(),
                             sharing: false, at: new Date().toISOString() } });
    roomTimers.push(setTimeout(() => {
      const row = rows()[2] || rows()[0];
      if (row) {
        emit({ type: 'driven', position: { exercise: row.at, title: row.title, slide: null },
               at: new Date().toISOString() });
      }
    }, 32000));
    play(40000, { type: 'controlling', control: null });

    /* ---- and the educator writing in your editor -------------------------------
     *
     * The student's half of Share editor, which is the half nobody sees while building it:
     * the educator's is a switch they press, and this is a read-only editor with somebody
     * else's caret moving in it and a band explaining why. It is played AFTER control has
     * been released, because the two must not overlap - control outranks sync deliberately,
     * and a script that ran them together would be exercising that rule rather than this
     * screen.
     *
     * Switched off at the end, so the restore is reachable too: a mode that only ever
     * arrives is a mode whose exit nobody tries.
     */
    /* A ROW WITH AN EDITOR ON IT, because a push names the exercise it belongs to and is
     * applied nowhere else - aimed anywhere the student is not, the whole episode would
     * arrive and do nothing at all. Slides rows are skipped: there is no editor on one. */
    const demoAt = () => rows().slice(0, 7).reverse()
      .find(r => !String(r.at).startsWith('slides:'));
    /* And the class is moved onto it first. Following is what carries a student there, and
     * the last thing that moved them was a drive to somewhere else entirely. */
    roomTimers.push(setTimeout(() => {
      const row = demoAt();
      if (row) {
        emit({ type: 'moved', sub: tutor.sub,
               position: { exercise: row.at, title: row.title, slide: null },
               at: new Date().toISOString() });
      }
    }, 43000));
    play(44000, { type: 'syncing', on: true });
    const DEMO = 'SELECT title, released\nFROM films\nWHERE released > 2000\nORDER BY released;';
    for (let i = 1; i <= DEMO.length; i += 3) {
      roomTimers.push(setTimeout(() => {
        const row = demoAt();
        if (!row) return;
        emit({ type: 'synced', at: row.at, code: DEMO.slice(0, i), cursor: i,
               when: new Date().toISOString() });
      }, 45000 + i * 60));
    }
    play(45000 + DEMO.length * 60 + 6000, { type: 'syncing', on: false });
  }

  /* ---- and the conversation -------------------------------------------------
   *
   * Two things a local run could not otherwise reach: a backlog that was already there when
   * you arrived, and a message whose ORIGIN is somewhere other than where you are. The
   * second is most of what chat is for - a question asked from inside an exercise can be
   * opened rather than located - and it is invisible without another browser in the room.
   *
   * The origin is a REAL row of the real course, asked for when the timer fires for the same
   * reason the walk above is: joining happens before the course is opened, so reading it now
   * gives the previous course's rows and a button that goes nowhere. */
  const chatAt = ms => new Date(Date.now() - ms).toISOString();
  emit({
    type: 'history',
    messages: [
      { id: 'pv-1', sub: tutor.sub, from: tutor.name, role: 'tutor',
        text: 'Morning everyone. We are picking up where we left off last week.',
        at: chatAt(9 * 60000), where: null },
      { id: 'pv-2', sub: 'preview-2', from: 'Grace Hopper', role: 'student',
        text: 'Sorry, my train was late — catching up now.', at: chatAt(7 * 60000), where: null },
    ],
  });

  roomTimers.push(setTimeout(() => {
    const row = rows()[3] || rows()[0];
    emit({
      type: 'said', id: 'pv-3', sub: 'preview-3', from: 'Katherine Johnson', role: 'student',
      text: 'This one returns nothing for me — have I misread the join?',
      at: new Date().toISOString(),
      where: row ? { exercise: row.at, title: row.title } : null,
    });
  }, 6000));

  roomTimers.push(setTimeout(() => emit({
    type: 'said', id: 'pv-4', sub: tutor.sub, from: tutor.name, role: 'tutor',
    text: 'Good question — hold that one and we will do it together in a minute.',
    at: new Date().toISOString(), where: null,
  }), 12000));

  /* ---- and the class answering ----------------------------------------------
   *
   * The tutor's half, and the one that cannot be reached locally at all otherwise: nothing
   * on this machine is a second person pressing Check. It follows the tutor's OWN position
   * rather than a fixed row, because the results view is about the exercise on screen -
   * scripted against a made-up id it would be permanently empty, which is what the feature
   * looks like when it is broken.
   *
   * Answers are coherent with the exercise: whoever is marked correct chose the correct
   * option, and the one who is wrong chose a different real one. A stand-in that contradicts
   * itself is one you stop reading.
   *
   * The class REFILLS when the tutor moves on, which is the whole rhythm of the screen -
   * a panel that stayed full would never show the "working on it" state it exists to show.
   */
  if (leading) {
    const answered = new Set();
    let watching = null;
    const answer = () => {
      const at = whereAmI()?.at;
      if (at != null) {
        if (String(at) !== String(watching)) { watching = String(at); answered.clear(); }
        const i = members.findIndex(m => !answered.has(m.sub));
        if (i >= 0) {
          const who = members[i];
          answered.add(who.sub);
          const row = rows().find(r => String(r.at) === String(at));
          const options = row?.options || 0;
          const right = row?.answer ?? null;
          // One wrong, one that would not run, and the rest correct.
          const pass = i !== 1 && i !== 3;
          const error = i === 3 && !options;
          emit({
            type: 'marked', sub: who.sub,
            mark: {
              exercise: at, step: null,
              choice: !options ? null
                : pass ? right
                  : (Number(right ?? 0) + 1) % options,
              pass, error, at: new Date().toISOString(),
            },
          });
        }
      }
      /* One slot, re-armed, rather than a timer pushed onto the list each round: this chain
       * runs for as long as the lesson does, and a list that grows a number every four
       * seconds is a leak however small each one is. */
      answering = setTimeout(answer, 4000);
    };
    answering = setTimeout(answer, 3500);
  }
}

export function stopPreviewRoom() {
  for (const t of roomTimers) clearTimeout(t);
  roomTimers = [];
  clearTimeout(answering);
  answering = null;
}
