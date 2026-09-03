/* Live delivery, end to end, against the real deployment.
 *
 *   AWS_PROFILE=ice npm run test:live [cohortId]
 *
 * Steps 1 and 2 of LIVE.md: a session and its lock, then two people signing in, opening
 * sockets and talking to each other. Worth a real test rather than a green deploy, because
 * every part of it - the conditional write that IS the one-admin rule, spending a ticket,
 * the connection row, the fan-out query, the `$disconnect` cleanup, the bookmark - is
 * invisible from the console and silent when wrong.
 *
 * IT WORKS IN A COHORT IT CREATES AND DELETES. The session half writes a bookmark, and a
 * bookmark is where a real class resumes next term - a test that left one behind would move
 * somebody's lesson. The throwaway is removed in a `finally`, so a failure half way through
 * does not leave one lying in the cohort picker.
 *
 * A cohort id may still be passed, and then the SOCKET half uses it: that is the only way
 * to exercise the ticket route's membership check with a real student, who is in a real
 * cohort and not in a throwaway one.
 *
 * IT DOES NOT USE THE PUBLISHED auth.json, and cannot: the socket URL is a stack output
 * that only reaches the site when `just deploy` next runs. It reads the outputs directly,
 * so the backend can be proved before any of it is wired to a screen.
 *
 * Credentials are typed at the prompt rather than passed as arguments or environment
 * variables - a password in a shell history or a process list is a password that has left
 * the room. Nothing is stored.
 *
 * The second account has to be in the cohort. The first does not, if it is an admin: an
 * admin may deliver to any cohort, which is exactly the asymmetry the ticket route
 * enforces and this test exercises from both sides.
 */
import { execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { CognitoUserPool, CognitoUser, AuthenticationDetails } from 'amazon-cognito-identity-js';

/* Optional. Given, the socket half runs in that cohort so a second account can be a real
 * member of it; omitted, everything runs in the throwaway, which an admin may reach. */
const given = process.argv[2] || null;

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `  -- ${detail}` : ''}`);
  if (!ok) failures++;
};
const skip = (label, why) => console.log(`SKIP  ${label}  -- ${why}`);

// ---------------------------------------------------------------- the deployment
const outputs = () => {
  const raw = execFileSync('aws', ['cloudformation', 'describe-stacks', '--stack-name', 'Icecore',
    '--query', 'Stacks[0].Outputs', '--output', 'json'], { encoding: 'utf8' });
  return Object.fromEntries(JSON.parse(raw).map(o => [o.OutputKey, o.OutputValue]));
};

// ---------------------------------------------------------------- signing in
/* The pool object wants somewhere to keep a session and reaches for `window.localStorage`.
 * A plain in-memory map is the honest stand-in here: this process signs in twice and must
 * not let the second sign-in inherit anything from the first. */
const memory = () => {
  const store = new Map();
  return {
    setItem: (k, v) => store.set(k, String(v)),
    getItem: k => (store.has(k) ? store.get(k) : null),
    removeItem: k => store.delete(k),
    clear: () => store.clear(),
  };
};

function signIn({ UserPoolId, ClientId }, Username, Password) {
  const pool = new CognitoUserPool({ UserPoolId, ClientId, Storage: memory() });
  const user = new CognitoUser({ Username, Pool: pool, Storage: memory() });
  return new Promise((resolve, reject) => {
    user.authenticateUser(new AuthenticationDetails({ Username, Password }), {
      onSuccess: s => resolve(s.getIdToken().getJwtToken()),
      onFailure: reject,
      // An account that has never been opened cannot be used here, and says so plainly
      // rather than hanging on a callback nothing implements.
      newPasswordRequired: () => reject(new Error(
        `${Username} has never signed in - open the invitation and set a password first`)),
    });
  });
}

// ---------------------------------------------------------------- the socket
/**
 * A socket plus a queue of what arrived on it, so a test can wait for one message type
 * without racing whatever else the server sent first.
 */
function listen(ws) {
  const seen = [];
  const waiters = [];
  ws.addEventListener('message', e => {
    const msg = JSON.parse(e.data);
    seen.push(msg);
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i].type === msg.type) {
        waiters.splice(i, 1)[0].resolve(msg);
        seen.pop();   // handed straight to a waiter, so it is not also left in the queue
        break;
      }
    }
  });
  return {
    seen,
    /* Resolves with the next message of that type, or null after `ms`.
     *
     * CONSUMING, deliberately: two waits for `delivered` are two different deliveries, and
     * a peeking version would answer the second with the first and pass a test that had
     * not happened. */
    next: (type, ms = 5000) => new Promise(resolve => {
      const at = seen.findIndex(m => m.type === type);
      if (at >= 0) return resolve(seen.splice(at, 1)[0]);
      const waiter = { type, resolve };
      waiters.push(waiter);
      setTimeout(() => {
        const at = waiters.indexOf(waiter);
        if (at >= 0) { waiters.splice(at, 1); resolve(null); }
      }, ms);
    }),
  };
}

/**
 * Open a socket, and hand back a promise for its eventual close alongside it.
 *
 * THE CLOSE LISTENER IS ATTACHED HERE, before anything awaits. A refused handshake emits
 * `error` and then `close` in the SAME tick, while the caller is still suspended on the
 * await that resolves this promise - so a listener attached afterwards is attached to a
 * socket that has already finished closing, and waits forever. That is not a hypothetical:
 * it hung the first run of this test on its first passing assertion.
 */
const opened = url => new Promise(resolve => {
  const ws = new WebSocket(url);
  let shut;
  const done = new Promise(r => { shut = r; });
  ws.addEventListener('close', () => shut(), { once: true });
  ws.addEventListener('open', () => resolve({ ws, ok: true, done }));
  // A refused handshake arrives as an error followed by a close, never as an HTTP status.
  ws.addEventListener('error', () => resolve({ ws, ok: false, done }));
});

/** Close one, and wait for it to finish. Never hangs: a dead socket is already done. */
const closed = ({ ws, done }) => {
  if (ws.readyState < WebSocket.CLOSING) ws.close();
  return Promise.race([done, new Promise(r => setTimeout(r, 3000))]);
};

/** Any /api/* call as a signed-in person. Never throws on a non-2xx: several of the things
 *  being tested here ARE non-2xx, and a refusal is a result rather than a failure. */
async function call(site, token, path, { method = 'GET', body } = {}) {
  const r = await fetch(`${site}/api/${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`,
               ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

const ticketFor = (site, token, forCohort) =>
  call(site, token, 'live/ticket', { method: 'POST', body: { cohort: forCohort } });

// ---------------------------------------------------------------- the run
const rl = createInterface({ input: process.stdin, output: process.stdout });
/* Echo off for the password. `output.write` is overridden rather than the stream muted,
 * because readline still has to draw the prompt itself. */
async function secret(prompt) {
  const write = rl.output.write.bind(rl.output);
  // THE PROMPT GOES OUT FIRST. `rl.output` is stdout, so writing it after the override
  // sends it through the muted method and the prompt never appears - which reads as the
  // test having hung rather than as it waiting for a password.
  write(prompt);
  rl.output.write = () => {};
  const answer = await rl.question('');
  rl.output.write = write;
  write('\n');
  return answer;
}

const out = outputs();
const pool = { UserPoolId: out.UserPoolId, ClientId: out.UserPoolClientId };
const site = out.SiteUrl;
const socketUrl = out.LiveSocketUrl;
console.log(`pool ${pool.UserPoolId} · site ${site}\nsocket ${socketUrl}\n`);
if (!socketUrl) {
  console.error('the stack has no LiveSocketUrl output - deploy the infra first');
  process.exit(1);
}

console.log('The tutor (an admin may use any cohort):');
const emailA = await rl.question('  email: ');
const passA = await secret('  password: ');
/* The second account is optional, and the same account twice is a real test rather than a
 * degraded one: two sockets are two connections whatever sub is behind them, so fan-out,
 * single-use tickets and `$disconnect` are all exercised either way. What only a second
 * ACCOUNT can prove is the membership check on the ticket route, and that is reported as
 * skipped rather than quietly passed. */
console.log(given
  ? `\nA student who is IN ${given} - or Enter to use the same account twice:`
  : '\nA second account - or Enter to use the same one twice:');
const emailB = (await rl.question('  email: ')).trim() || emailA;
const passB = emailB === emailA ? passA : await secret('  password: ');
rl.close();
console.log(emailB === emailA ? '\nusing one account for both sockets\n' : '');

const tokenA = await signIn(pool, emailA, passA);
const tokenB = await signIn(pool, emailB, passB);
check('both accounts signed in', !!tokenA && !!tokenB);

/* ================================================================= sessions
 *
 * In a cohort of its own, created here and deleted in the `finally` below. Named rather
 * than random so that a run killed between the two leaves something obviously disposable in
 * the picker instead of a mystery. */
const TITLE = 'zz icecore test cohort';
let throwaway = null;
let madeIt = false;
/* A session we started only so that chat has a row to be kept on. Held out here so the
 * `finally` can end it: an abandoned session holds its cohort's lock for a day. */
let chatIn = null;
/* Whether either socket was actually a STUDENT's. Two halves of the summary - who attended,
 * and what each exercise cost - are deliberately recorded for students only: an educator is
 * the person reading the summary, not somebody whose attendance is in question. So with one
 * admin account used twice they are correctly empty, and asserting on them would fail a run
 * in which nothing is wrong. */
let sawStudent = false;
try {
  const made = await call(site, tokenA, 'admin/cohorts', { method: 'POST', body: { title: TITLE } });
  if (made.status !== 200) {
    console.log(`FAIL  could not make a test cohort  -- HTTP ${made.status} `
      + `${JSON.stringify(made.body)}`);
    console.log('\nthe first account has to be an admin');
    process.exit(1);
  }
  throwaway = made.body.cohort.id;
  madeIt = made.body.created;
  console.log(`session tests in ${throwaway}${madeIt ? '' : ' (already existed - kept)'}\n`);

  /* A made-up course id, deliberately. Nothing on this path resolves one - a session names
   * a course, a bookmark is keyed by it, and neither reads the catalogue - and the real
   * catalogue is behind the signed-cookie key group anyway, so fetching it here would 403
   * and fall back to something invented in any case. Better to invent it on purpose. */
  const course = 'zz-test-course';

  // ---- starting one ---------------------------------------------------------
  const started = await call(site, tokenA, 'live/session',
    { method: 'POST', body: { cohort: throwaway, course } });
  check('a session starts', started.status === 200,
        `HTTP ${started.status} ${JSON.stringify(started.body)}`);
  check('it carries the cohort title', started.body.session?.title === TITLE,
        `title=${started.body.session?.title}`);

  // ---- and only one --------------------------------------------------------
  /* THE POINT OF THIS ONE. The lock is a conditional write, which is exactly the kind of
   * thing that goes on passing every other test after it stops working. */
  const again = await call(site, tokenA, 'live/session',
    { method: 'POST', body: { cohort: throwaway, course } });
  check('a second start is refused', again.status === 409, `HTTP ${again.status}`);
  check('the refusal names who holds it', /\S/.test(again.body.error || '')
        && again.body.session?.by === started.body.session?.by, again.body.error);

  // ---- it shows up in the listing ------------------------------------------
  const list = await call(site, tokenA, 'live/session');
  check('it is in the running list',
        (list.body.running || []).some(x => x.cohort === throwaway));

  /* ---- what a student may LEARN, which is a different question from what they may do ----
   *
   * The listing has always been open to any signed-in caller, because a student's client has
   * to know a session exists before it can offer to join one. Until the invitation existed
   * nothing but the admin screen called it - and an unfiltered answer hands every student the
   * id and title of every class in the school and the name of whoever is teaching it.
   *
   * Both halves need a real student: an admin is entitled to all of it, so running this with
   * one account proves nothing and says so. */
  if (emailB === emailA) {
    skip('a student sees only their own classes', 'only one account was given');
    skip('and cannot ask about a class they are not in', 'only one account was given');
  } else {
    const theirs = await call(site, tokenB, 'live/session');
    if ((theirs.body.running || []).some(x => x.cohort === throwaway)) {
      // Either they are an admin, or they really are in the throwaway - both make the
      // assertion meaningless rather than failed.
      skip('a student sees only their own classes', 'that account can see this cohort');
    } else {
      check('a student sees only their own classes',
            theirs.status === 200 && !(theirs.body.running || []).some(x => x.cohort === throwaway),
            JSON.stringify(theirs.body.running));
    }
    const one = await call(site, tokenB,
      `live/session?cohort=${encodeURIComponent(throwaway)}`);
    if (one.status === 200 && one.body.session) {
      skip('and cannot ask about a class they are not in', 'that account is an admin');
    } else {
      check('and cannot ask about a class they are not in', one.status === 403,
            `HTTP ${one.status} ${JSON.stringify(one.body)}`);
    }
  }

  // ---- a student may not start one -----------------------------------------
  if (emailB === emailA) {
    skip('a non-admin cannot start one', 'only one account was given');
  } else {
    const theirs = await call(site, tokenB, 'live/session',
      { method: 'POST', body: { cohort: throwaway, course } });
    if (theirs.status === 409) skip('a non-admin cannot start one', 'that account is an admin');
    else check('a non-admin cannot start one', theirs.status === 403, `HTTP ${theirs.status}`);
  }

  /* ---- and the summary comes back with the ending --------------------------
   *
   * Checked at the end of the SOCKET half rather than here, because the tallies it is built
   * from are accumulated by socket handlers - attendance on connect and disconnect, what was
   * covered on the educator's moves, what each exercise cost on every mark. Ending a session
   * nobody ever joined would prove only that the shape is right, which is the least
   * interesting half. */

  // ---- ending it writes the bookmark ---------------------------------------
  const where = { exercise: '4321', title: 'A test exercise' };
  const ended = await call(site, tokenA,
    `live/session?cohort=${encodeURIComponent(throwaway)}`
    + `&exercise=${where.exercise}&title=${encodeURIComponent(where.title)}`,
    { method: 'DELETE' });
  check('it ends', ended.status === 200 && ended.body.ended === true,
        `HTTP ${ended.status} ${JSON.stringify(ended.body)}`);

  const gone = await call(site, tokenA, `live/session?cohort=${encodeURIComponent(throwaway)}`);
  check('the session is gone', gone.body.session === null);
  check('the bookmark is where it left off',
        gone.body.marks?.[course]?.exercise === where.exercise
        && gone.body.marks?.[course]?.title === where.title,
        JSON.stringify(gone.body.marks));

  // ---- ending one that is not running ---------------------------------------
  const twice = await call(site, tokenA,
    `live/session?cohort=${encodeURIComponent(throwaway)}`, { method: 'DELETE' });
  check('ending nothing is not an error', twice.status === 200 && twice.body.ended === false,
        `HTTP ${twice.status} ${JSON.stringify(twice.body)}`);

  /* MISSING MEANS MISSING. A tutor whose browser died sends no position, and that must
   * leave the mark standing rather than blanking it - the case where losing the mark would
   * be least noticed and most annoying. */
  await call(site, tokenA, 'live/session',
    { method: 'POST', body: { cohort: throwaway, course } });
  await call(site, tokenA, `live/session?cohort=${encodeURIComponent(throwaway)}`,
    { method: 'DELETE' });
  const kept = await call(site, tokenA, `live/session?cohort=${encodeURIComponent(throwaway)}`);
  check('ending with no position keeps the old mark',
        kept.body.marks?.[course]?.exercise === where.exercise,
        JSON.stringify(kept.body.marks));

  console.log('');

  // ================================================================== the channel
  const cohort = given || throwaway;
  console.log(`socket tests in ${cohort}\n`);

  /* CHAT IS KEPT ON THE SESSION ROW, so the backlog half needs one running. A fresh one
   * rather than the session above, which was deliberately ended to prove the bookmark. If
   * somebody is already delivering to a cohort passed on the command line the start is
   * refused, and then the backlog is SKIPPED rather than reported as broken - the fan-out
   * half needs no session at all and still runs. */
  {
    const r = await call(site, tokenA, 'live/session',
      { method: 'POST', body: { cohort, course } });
    if (r.status === 200) chatIn = cohort;
    else console.log(`  (not delivering to ${cohort}: ${r.body?.error || `HTTP ${r.status}`}`
      + ' - the chat backlog is not checked)\n');
  }

  // ---- a socket with no ticket is refused ------------------------------------
  {
  const nil = await opened(socketUrl);
  check('a socket with no ticket is refused', !nil.ok);
  await closed(nil);
  }

  // ---- both connect ----------------------------------------------------------
  const a = await ticketFor(site, tokenA, cohort);
  check('the tutor gets a ticket', a.status === 200, `HTTP ${a.status} ${JSON.stringify(a.body)}`);
  const b = await ticketFor(site, tokenB, cohort);
  check('the student gets a ticket', b.status === 200, `HTTP ${b.status} ${JSON.stringify(b.body)}`);
  /* Thrown, not `process.exit` - that would skip the `finally` and leave the throwaway
   * cohort behind. The whole point of the cleanup is that it survives a bad run. */
  if (!a.body.ticket || !b.body.ticket) throw new Error('no ticket - cannot continue');

  const A = await opened(`${socketUrl}?ticket=${a.body.ticket}`);
  check('the tutor connects', A.ok);
  const heardA = listen(A.ws);
  const B = await opened(`${socketUrl}?ticket=${b.body.ticket}`);
  check('the student connects', B.ok);
  const heardB = listen(B.ws);

  // ---- a spent ticket is worth nothing ---------------------------------------
  {
  const again = await opened(`${socketUrl}?ticket=${a.body.ticket}`);
  check('a ticket cannot be spent twice', !again.ok);
  await closed(again);
  }

  // ---- a cohort you are not in ------------------------------------------------
  {
  const nowhere = `no-such-cohort-${Math.random().toString(36).slice(2, 8)}`;
  const r = await ticketFor(site, tokenB, nowhere);
  if (r.status === 200) {
    console.log('SKIP  a cohort you are not in is refused'
      + '  -- that account is an admin, and an admin may deliver to any cohort');
  } else {
    check('a cohort you are not in is refused', r.status === 403, `HTTP ${r.status}`);
  }
  }

  // ---- the room ---------------------------------------------------------------
  /* The client asks on open, because the server CANNOT push it from `$connect`: a
   * connection does not exist until that handler returns, so a post from inside it comes
   * back GoneException and is swallowed. This is the ask. */
  B.ws.send(JSON.stringify({ type: 'roster' }));
  const roster = await heardB.next('roster');
  check('a roster can be had on connecting', !!roster, 'nothing within 5s');
  check('it lists everyone, not only who is here', Array.isArray(roster?.members),
        JSON.stringify(roster?.members));
  check('it lists who is connected', (roster?.here || []).length >= 2,
        `here=${(roster?.here || []).length}`);

  /* The tutor connected first, so B's arrival is what A should have heard. */
  const arrival = await heardA.next('joined');
  check('the room is told when somebody joins', !!arrival?.who?.sub,
        JSON.stringify(arrival));

  // ---- being present is not the same as being connected -----------------------
  /* THE DISTINCTION THE WHOLE OF PRESENCE RESTS ON. A ping keeps the socket open and must
   * NOT count as the person being there, or a tab left open on a train reads as attentive
   * for the whole lesson. Only `active` moves `seen`, and only a change of place is
   * broadcast. */
  A.ws.send(JSON.stringify({ type: 'active', at: '101', title: 'Somewhere' }));
  const moved = await heardB.next('moved');
  check('a move reaches the room', moved?.position?.exercise === '101',
        JSON.stringify(moved?.position));

  A.ws.send(JSON.stringify({ type: 'active', at: '101', title: 'Somewhere' }));
  const again2 = await heardB.next('moved', 1500);
  check('staying put is not broadcast', again2 === null,
        `got ${JSON.stringify(again2?.position)}`);

  /* A slides step is a RANGE, so paging within one is a real move even though the row has
   * not changed - a follower sent only the row lands at the top of a topic the tutor is
   * nine slides into, which looks exactly like following being broken. */
  A.ws.send(JSON.stringify({ type: 'active', at: '101', title: 'Somewhere', slide: 15 }));
  const paged = await heardB.next('moved');
  check('paging within a slides step is a move', paged?.position?.slide === 15,
        JSON.stringify(paged?.position));

  A.ws.send(JSON.stringify({ type: 'roster' }));
  const asked = await heardA.next('roster');
  check('a roster can be asked for again', !!asked,
        'nothing within 5s - a reconnected client could not catch up');
  check('it carries the position that was reported',
        (asked?.here || []).some(p => p.position?.exercise === '101'),
        JSON.stringify(asked?.here));

  /* ---- how the class answered ------------------------------------------------
   *
   * THE ONE MESSAGE WITH AN AUDIENCE OF ITS OWN. Everything else on this socket goes to the
   * whole room; a mark goes to the tutors and to nobody else, because a class watching each
   * other's answers land during a question is a different activity from the one being run.
   * So this is checked in both directions: the tutor hears B's, and B does not hear the
   * tutor's. */
  B.ws.send(JSON.stringify({
    type: 'marked', at: '101', step: 0, choice: 2, pass: false, error: false,
  }));
  const mark = await heardA.next('marked');
  check('a mark reaches the tutor', mark?.mark?.exercise === '101', JSON.stringify(mark));
  check('it carries the answer that was given', mark?.mark?.choice === 2
        && mark?.mark?.pass === false, JSON.stringify(mark?.mark));

  /* And the pull side obeys the same rule as the push. A tutor reloading mid-lesson gets
   * back what everybody currently connected last did; a student asking gets a roster with
   * nobody's mark on it. */
  A.ws.send(JSON.stringify({ type: 'roster' }));
  const forTutor = await heardA.next('roster');
  check('a roster carries marks to a tutor',
        (forTutor?.here || []).some(p => p.mark?.exercise === '101'),
        JSON.stringify((forTutor?.here || []).map(p => p.mark)));

  /* BOTH HALVES OF THE RULE NEED A REAL STUDENT'S SOCKET, and the common way to run this
   * is with one admin account twice - which connects as a tutor on both sides, and is then
   * ENTITLED to every mark. Asserting otherwise fails a run in which nothing is wrong. So
   * the role is read off the roster we just fetched rather than assumed, and both checks
   * say SKIP when the second socket is not a student's. */
  const bSub = mark?.sub;
  const bRole = (forTutor?.here || []).find(p => p.sub === bSub)?.role;
  sawStudent = bRole === 'student';
  const notAStudent = `the second account connects as ${bRole || 'an unknown role'}`;

  B.ws.send(JSON.stringify({ type: 'roster' }));
  const forStudent = await heardB.next('roster');
  if (bRole === 'student') {
    check('and carries none to a student',
          (forStudent?.here || []).every(p => p.mark === undefined),
          JSON.stringify((forStudent?.here || []).map(p => p.mark)));
  } else {
    skip('and carries none to a student', notAStudent);
  }

  A.ws.send(JSON.stringify({ type: 'marked', at: '101', pass: true }));
  if (bRole === 'student') {
    check('a student is not told how anybody else answered',
          (await heardB.next('marked', 1500)) === null,
          'the room was sent a mark it should never see');
  } else {
    skip('a student is not told how anybody else answered', notAStudent);
  }

  // ---- what one says, the other hears ----------------------------------------
  const text = `hello from the test at ${new Date().toISOString()}`;
  A.ws.send(JSON.stringify({ type: 'say', text }));

  const atB = await heardB.next('said');
  check('the student hears the tutor', atB?.text === text,
      atB ? `got ${JSON.stringify(atB.text)}` : 'nothing arrived within 5s');
  check('it says who said it', !!atB?.from && ['tutor', 'student'].includes(atB?.role),
      `from=${atB?.from} role=${atB?.role}`);

  const delivered = await heardA.next('delivered');
  check('it reached both sockets', delivered?.heard === 2, `heard=${delivered?.heard}`);

  /* WHERE IT WAS SENT FROM, stamped on by the Lambda from the connection row rather than
   * sent by the client. A is at `101` because of the `active` messages above, so this also
   * proves the two facts are the same fact rather than two copies of it. */
  check('a message carries where it was sent from', atB?.where?.exercise === '101',
        JSON.stringify(atB?.where));
  check('and it has an id of its own, assigned by the server', !!atB?.id, JSON.stringify(atB));

  /* ---- what somebody who joins late can read --------------------------------
   *
   * The backlog is the whole reason chat touches the table at all. It lives on the session
   * row and dies with it, so this is also the erasure guarantee: no session, nothing kept. */
  B.ws.send(JSON.stringify({ type: 'history' }));
  const back = await heardB.next('history');
  check('a backlog can be asked for', Array.isArray(back?.messages), JSON.stringify(back));
  if (chatIn) {
    check('what was said is in it', (back?.messages || []).some(m => m.text === text),
          `${(back?.messages || []).length} kept`);
    check('the backlog carries the origin too',
          (back?.messages || []).find(m => m.text === text)?.where?.exercise === '101',
          JSON.stringify((back?.messages || []).find(m => m.text === text)?.where));
  }

  // An empty message is not a message, and must not reach anybody as one.
  A.ws.send(JSON.stringify({ type: 'say', text: '   ' }));
  check('an empty message is not sent', (await heardB.next('said', 1500)) === null);

  /* ---- remote control ---------------------------------------------------------
   *
   * Every assertion here is about a boundary rather than about a feature working: who may
   * take control, who may end it, and who is told. The one that matters most is the last -
   * a screen someone else can drive without the person being able to stop them is not
   * something to ship, so the student's release is checked from the student's own socket.
   *
   * It needs a session, for the same reason chat's backlog does: control lives on that row.
   */
  if (chatIn && bSub) {
    /* Most of it holds with one account used twice - the two sockets are two browsers, and
     * every boundary here is between browsers. The two that do NOT are the ones about
     * identity: driving yourself makes "names somebody else" meaningless, and a message
     * addressed to a sub reaches both of that sub's sockets by design. */
    const distinct = bRole === 'student';

    /* EVERY `controlling` IS A BROADCAST, so both sockets hear every one of them and both
     * queues have to be drained at each step. Draining only the side an assertion reads
     * leaves the other holding a message from three steps earlier, and the next wait on it
     * answers with that - a failure that looks exactly like the wrong thing having been
     * sent. It is the trap `next` is consuming to avoid, met from the other direction. */
    const alsoA = () => heardA.next('controlling');
    const alsoB = () => heardB.next('controlling');

    A.ws.send(JSON.stringify({ type: 'control', sub: bSub }));
    const took = await heardB.next('controlling');
    await alsoA();
    check('taking control tells the room', took?.control?.sub === bSub,
          JSON.stringify(took));
    check('and names who is driving',
          !!took?.control?.by && (!distinct || took.control.by !== bSub),
          JSON.stringify(took?.control));
    check('sharing is off until it is asked for', took?.control?.sharing === false,
          JSON.stringify(took?.control));

    /* ADDRESSED TO ONE BROWSER. A drive is not a broadcast: the class follows what the
     * controlled screen then REPORTS, so a drive reaching everybody would put the room on a
     * position nobody had confirmed they were at. */
    A.ws.send(JSON.stringify({ type: 'drive', at: '202', title: 'Driven there' }));
    const drivenTo = await heardB.next('driven');
    check('a drive reaches the screen being driven', drivenTo?.position?.exercise === '202',
          JSON.stringify(drivenTo));
    if (distinct) {
      check('and reaches nobody else', (await heardA.next('driven', 1500)) === null,
            'the driver was sent their own instruction back');
    } else {
      // Same account both ends: a message addressed to that sub reaches both its sockets,
      // which is the feature rather than a leak. Drained so it cannot be mistaken for a
      // later one.
      await heardA.next('driven', 1500);
      skip('and reaches nobody else', 'one account was used for both sockets');
    }

    A.ws.send(JSON.stringify({ type: 'sharing', on: true }));
    const shared = await heardB.next('controlling');
    await alsoA();
    check('sharing can be turned on afterwards', shared?.control?.sharing === true,
          JSON.stringify(shared?.control));

    /* THE WRITE GATE, AND IT HAS TO BE ASKED WHILE CONTROL IS HELD - which is the whole
     * point of it, and was the first way this block was written wrong: placed after the
     * release below, the refusal it got back was the gate working.
     * Being an admin is not enough to write somebody's progress - the
     * function reads the session's control row and refuses unless this caller is the one
     * currently driving that student. That check is the whole difference between "an admin
     * may suspend anyone" and "an admin may silently award anyone XP". */
    {
      const at = `zz-control-${Math.random().toString(36).slice(2, 8)}`;
      const wrote = await call(site, tokenA,
        `admin/progress?sub=${encodeURIComponent(bSub)}&cohort=${encodeURIComponent(cohort)}`,
        { method: 'PUT', body: { course, exercise: at, xp: 5 } });
      check('an educator who is driving may write their progress', wrote.status === 200,
            `HTTP ${wrote.status} ${JSON.stringify(wrote.body)}`);
      // And taken straight back out, so the test leaves no XP on a real account.
      await call(site, tokenA,
        `admin/progress?sub=${encodeURIComponent(bSub)}&cohort=${encodeURIComponent(cohort)}`,
        { method: 'PUT', body: { course, exercise: at, solved: false } });
    }

    /* WHAT THE STUDENT HAD WRITTEN, which is the half of control that actually helps: a
     * progress row only ever holds the code that SOLVED an exercise, so somebody in the
     * middle of getting one wrong has nothing recorded anywhere. */
    B.ws.send(JSON.stringify({ type: 'buffer', at: '202', code: 'SELECT oops' }));
    const buf = await heardA.next('buffer');
    check('the driven screen can send back what is in its editor',
          buf?.code === 'SELECT oops' && buf?.at === '202', JSON.stringify(buf));

    /* THE STUDENT'S OWN RELEASE. Sent from B's socket, which is the whole point: `release`
     * is conditional on being either end of the pair rather than on being an admin. */
    /* Read from A, which is the assertion: it is not enough that the student's release is
     * accepted, the DRIVER has to be told their control has gone. */
    B.ws.send(JSON.stringify({ type: 'release' }));
    const letGo = await heardA.next('controlling');
    await alsoB();
    check('the student can end it themselves', letGo?.control === null,
          JSON.stringify(letGo));

    // And a roster carries it, so somebody arriving mid-lesson is not the last to know.
    A.ws.send(JSON.stringify({ type: 'control', sub: bSub }));
    await alsoA(); await alsoB();
    B.ws.send(JSON.stringify({ type: 'roster' }));
    const withControl = await heardB.next('roster');
    check('a roster says whose screen is being driven',
          withControl?.control?.sub === bSub, JSON.stringify(withControl?.control));
    A.ws.send(JSON.stringify({ type: 'release' }));
    await alsoA(); await alsoB();

    /* And the gate closes with the control. The capability lasts exactly as long as the
     * driving does - which is what makes it a smaller thing than "an admin may write
     * anyone's rows", and what makes the student's Stop button mean something. */
    const after = await call(site, tokenA,
      `admin/progress?sub=${encodeURIComponent(bSub)}&cohort=${encodeURIComponent(cohort)}`,
      { method: 'PUT', body: { course, exercise: 'zz-after', xp: 5 } });
    check('and may not once control has ended', after.status === 403,
          `HTTP ${after.status} ${JSON.stringify(after.body)}`);
  } else {
    skip('remote control', 'no session is running on this cohort');
  }

  // ---- ping is answered -------------------------------------------------------
  A.ws.send(JSON.stringify({ type: 'ping' }));
  check('ping is answered', !!(await heardA.next('pong')));

  // ---- disconnecting removes the row -----------------------------------------
  await closed(B);
  const gone2 = await heardA.next('left');
  check('the room is told when somebody leaves', !!gone2?.sub, JSON.stringify(gone2));
  // $disconnect is a Lambda invocation; give it a moment to land before asking.
  await new Promise(r => setTimeout(r, 2000));
  A.ws.send(JSON.stringify({ type: 'say', text: 'and now there is one' }));
  const after = await heardA.next('delivered');
  check('a closed socket is forgotten', after?.heard === 1, `heard=${after?.heard}`);

  await closed(A);
} finally {
  /* Always, even on a thrown assertion: a bookmark left on a cohort is where somebody's
   * next lesson would open, and a stray cohort in the picker is the kind of litter nobody
   * ever gets round to sweeping. Only ours - a cohort that already existed under this name
   * belongs to somebody else and is left alone. */
  /* Before the cohort itself: deleting a cohort does not clear a session row keyed on it,
   * and a stray one holds the lock for a day and shows the cohort as live in a list where
   * it no longer exists.
   *
   * AND IT IS WHERE THE SUMMARY IS CHECKED, because everything in it was accumulated by the
   * socket handlers above - two connections, a walk to `101`, a mark, and some chat. Ending
   * a session nobody joined would prove the shape and nothing else. */
  if (chatIn) {
    /* ENDED WITHOUT A POSITION, deliberately: that is what ending from the cohort screen
     * does, and it is the case the bookmark used to be lost in. The educator walked to `101`
     * over the socket above, so the session row carries it and the mark should come from
     * there - a browser that closed mid-lesson loses the advance, not the mark. */
    const done = await call(site, tokenA,
      `live/session?cohort=${encodeURIComponent(chatIn)}`, { method: 'DELETE' });
    const sum = done.body?.summary;
    check('ending hands back a summary', !!sum, JSON.stringify(done.body));
    check('it bookmarks where the lesson actually was, with no position sent',
          sum?.mark?.exercise === '101', JSON.stringify(sum?.mark));
    /* The educator walked to `101` and paged inside it, so exactly one row was covered - a
     * second entry would mean paging a deck counted as covering something new. */
    check('it says what was covered', (sum?.covered || []).some(c => c.exercise === '101'),
          JSON.stringify(sum?.covered));
    check('and covers a row once, however often it is paged',
          (sum?.covered || []).filter(c => c.exercise === '101').length === 1,
          JSON.stringify(sum?.covered));
    if (sawStudent) {
      check('it says who was here', (sum?.people || []).length >= 1,
            JSON.stringify(sum?.people));
    } else {
      check('it leaves educators out of the register', (sum?.people || []).length === 0,
            JSON.stringify(sum?.people));
    }
    check('it counts what was said', Number(sum?.said) > 0, `said=${sum?.said}`);
    /* One wrong answer was marked against `101` above, so it is the one thing to fix. An
     * exercise nobody got wrong must not appear here at all - the list is ordered by what
     * went wrong, not by what was attempted. */
    if (sawStudent) {
      check('and what to fix', (sum?.worst || []).some(w => w.exercise === '101' && w.wrong >= 1),
            JSON.stringify(sum?.worst));
    } else {
      /* The mirror of the check above, and worth having: an educator demonstrating an
       * exercise wrongly in front of the class must not turn up in the summary as the class
       * having struggled with it. */
      check("and leaves out an educator's own attempts", (sum?.worst || []).length === 0,
            JSON.stringify(sum?.worst));
    }
  }
  if (throwaway && madeIt) {
    const bin = await call(site, tokenA,
      `admin/cohorts?id=${encodeURIComponent(throwaway)}`, { method: 'DELETE' });
    check('the test cohort is cleaned up', bin.status === 200, `HTTP ${bin.status}`);
  }
}

console.log(`\n${failures ? `${failures} failed` : 'all good'}`);
process.exit(failures ? 1 : 0);
