/* `delivery.js`: what the channel's messages do to the state a band and a panel read.
 *
 * NO COMPONENT AND NO DOM WORK HERE - the messages go in through `emitLocal`, which is
 * `live.js`'s own dispatcher, and the assertions are on the reactive objects every screen
 * draws from. That is the whole of this module's job: it holds the session, the room, the
 * marks and remote control, and until now nothing had ever run a single one of its handlers.
 *
 * IT STILL NEEDS THE BUILD. `delivery.js` imports `auth.js`, which reads
 * `import.meta.env.BASE_URL` at module level - so a plain Node import throws before any of
 * this runs. See harness.mjs.
 *
 * WHAT IT CANNOT COVER, said here rather than left as a gap somebody assumes is covered:
 * `report()` and everything else that SENDS. `send()` drops silently when there is no
 * socket, which is the honest behaviour for a channel and is exactly the state a preview run
 * is in - so what leaves this client is not observable from here. `test/live.mjs` covers the
 * server's side of those messages against a real socket.
 */
let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `  -- ${detail}` : ''}`);
  if (!ok) failures++;
};

import { installDom } from './dom.mjs';
const dom = installDom({ hash: '#/' });
/* The catalogue. Nothing here is about content, but the preview's `session` route answers
 * with the courses this deployment has - so there has to be one to answer with. */
dom.serve('/content/courses.json', [{ id: 'c1', title: 'Course One', exercises: 3, xp: 60 }]);

const { buildPlayer } = await import('./harness.mjs');
const player = await buildPlayer({ preview: 'student' });
const { delivery: d, emitLocal, stopPreviewRoom } = player;

/* WHO WE ARE, and it takes both calls. `restore()` hands back a token and `startSession()`
 * is what reads a sub out of it - the app does the pair on mount and this file has to as
 * well, because `beingDriven()` compares a control row's sub against our own and against an
 * empty session it is quietly always false. Which is the kind of thing that makes a test
 * pass while asserting nothing. */
await player.startSession(await player.restore());
check('the preview session knows who it is', !!player.session.sub, JSON.stringify(player.session));

/* A session to be in. Joined directly rather than through the route, because this file is
 * about the module and not about the screen - `join` is what `enterLive` calls. */
const SESSION = { cohort: 'data-team', title: 'Data team', course: 'c1',
                  by: 'tutor-1', name: 'Sarah Mifsud', at: new Date().toISOString() };
d.join(SESSION);
stopPreviewRoom();   // the preview scripts a room of its own; this file is the script

const who = (sub, name, extra = {}) => ({
  sub, name, role: 'student', seen: new Date().toISOString(), position: null, ...extra });
const tutor = who('tutor-1', 'Sarah Mifsud', { role: 'tutor' });

// ------------------------------------------------------------------ the roster
emitLocal({ type: 'roster', members: [{ sub: 'stu-1', name: 'Grace' }, { sub: 'stu-2', name: 'Katherine' }],
            here: [tutor, who('stu-1', 'Grace')] });
check('members and who is here are two different lists',
      d.room.members.length === 2 && Object.keys(d.room.here).length === 2,
      `${d.room.members.length} members, ${Object.keys(d.room.here).length} here`);
/* A panel built from connections alone shows a class of twelve as a class of three and
 * gives a tutor no way to see who is missing. */
check('somebody in the cohort who has not connected is still a member',
      !d.room.here['stu-2'] && d.room.members.some(m => m.sub === 'stu-2'));

// ---------------------------------------------------- one person, two browsers
emitLocal({ type: 'joined', who: who('stu-1', 'Grace') });
check('a second tab is not a second person', Object.keys(d.room.here).length === 2,
      Object.keys(d.room.here).join(','));
emitLocal({ type: 'left', sub: 'stu-1' });
check('and closing one of them is not leaving', !!d.room.here['stu-1']);
emitLocal({ type: 'left', sub: 'stu-1' });
check('closing the last one is', !d.room.here['stu-1']);

// -------------------------------------------------------------------- the marks
emitLocal({ type: 'marked', sub: 'stu-1', mark: { exercise: 101, pass: true } });
emitLocal({ type: 'marked', sub: 'stu-2', mark: { exercise: 101, pass: false } });
check('everybody\'s answer to one exercise is one object',
      Object.keys(d.marksAt(101)).length === 2, JSON.stringify(d.marksAt(101)));
/* AN EXERCISE ID IS A NUMBER AND ARRIVES FROM A SOCKET AS TEXT. An unnormalised key is a
 * lookup that never matches and a panel that stays empty for a reason nobody can see - the
 * same trap `progressId` exists for. */
check('and it is found by the id as a string or as a number',
      Object.keys(d.marksAt('101')).length === 2, JSON.stringify(d.marksAt('101')));
/* A roster answers "what is everybody doing NOW" and carries one mark each; the accumulated
 * picture is older than that and still true. Replacing empties the results view every time
 * a client reconnects. */
emitLocal({ type: 'roster', members: [], here: [tutor, who('stu-1', 'Grace')] });
check('a fresh roster does not wipe what was accumulated before it',
      Object.keys(d.marksAt(101)).length === 2, JSON.stringify(d.marksAt(101)));

// ----------------------------------------------------------- where the room is
emitLocal({ type: 'moved', sub: 'tutor-1',
            position: { exercise: '102', title: 'Second', slide: null },
            at: new Date().toISOString() });
check('the room follows the educator by default',
      d.followedPosition()?.exercise === '102', JSON.stringify(d.followedPosition()));
check('and says so by name', d.followedName() === 'Sarah Mifsud', d.followedName());

// --------------------------------------------------- until a screen is shared
emitLocal({ type: 'moved', sub: 'stu-1',
            position: { exercise: '103', title: 'Third', slide: null },
            at: new Date().toISOString() });
emitLocal({ type: 'controlling', control: { sub: 'stu-1', name: 'Grace', by: 'tutor-1',
                                            byName: 'Sarah Mifsud', sharing: true,
                                            at: new Date().toISOString() } });
/* The shared position is the controlled student's own REPORTED position, not the drive that
 * caused it - so what the class sees is what that screen actually shows rather than what it
 * was told to show. One hop longer and the only version that cannot drift. */
check('a shared screen is what the class follows instead',
      d.followedPosition()?.exercise === '103', JSON.stringify(d.followedPosition()));
check('and the band names the classmate, not the educator',
      d.followedName() === 'Grace', d.followedName());
emitLocal({ type: 'controlling', control: null });
check('and it goes back to the educator when sharing stops',
      d.followedPosition()?.exercise === '102', JSON.stringify(d.followedPosition()));

// ------------------------------------------------------- being driven, and let go
/* BEING RELEASED PUTS YOU BACK WITH THE CLASS. Without it the band came back saying "you
 * have stopped following and are working on your own" the moment an educator let go - which
 * the student had not done and could not have: they were being driven. */
d.wandered();
check('a student who moves is no longer following', d.delivery.following === false);
emitLocal({ type: 'controlling', control: { sub: player.session.sub, name: 'You', by: 'tutor-1',
                                            byName: 'Sarah Mifsud', sharing: false,
                                            at: new Date().toISOString() } });
check('being driven is my own screen', d.beingDriven() === true);
emitLocal({ type: 'controlling', control: null });
check('and being let go puts me back with the class', d.delivery.following === true);

// ------------------------------------------------------ the educator's editor
emitLocal({ type: 'syncing', on: true });
check('sharing an editor is a fact about the session', d.sync.on === true);
emitLocal({ type: 'synced', at: '102', code: 'SELECT 1', cursor: 8, when: 'now' });
check('and the buffer names the exercise it belongs to',
      d.sync.at === '102' && d.sync.code === 'SELECT 1' && d.sync.cursor === 8,
      JSON.stringify(d.sync));
/* Cleared of its buffer on the way down, so turning it on again cannot momentarily show the
 * last thing the educator wrote half an hour ago. */
emitLocal({ type: 'syncing', on: false });
check('switching it off drops the buffer with it',
      d.sync.on === false && d.sync.code === null, JSON.stringify(d.sync));

// ---------------------------------------------------------------- who is about
{
  const now = Date.now();
  emitLocal({ type: 'roster', members: [], here: [
    tutor,
    who('stu-1', 'Grace', { seen: new Date(now - 20 * 60000).toISOString() }),
    who('stu-2', 'Katherine', { seen: new Date(now).toISOString() }),
  ] });
  check('somebody who has done nothing for twenty minutes is idle',
        d.presenceOf('stu-1', now) === 'idle', d.presenceOf('stu-1', now));
  check('somebody active is here', d.presenceOf('stu-2', now) === 'here', d.presenceOf('stu-2', now));
  check('and somebody who never connected is away',
        d.presenceOf('stu-9', now) === 'away', d.presenceOf('stu-9', now));
}

// ------------------------------------------------------------- being invited
d.live.running[SESSION.cohort] = SESSION;
/* The one already open is never an invitation - that is where they are. */
check('there is no invitation while you are already in a session', d.invitation() === null);

// ------------------------------------------------------------------- and out
/* IT NO LONGER FORGETS THAT THE SESSION IS RUNNING. Leaving a lesson is a fact about this
 * client and not about the lesson: deleting the entry meant a student who left watched the
 * invitation vanish and then reappear on the next poll - the banner offering them the way
 * back in blinking out of existence at the moment it became useful. */
d.forget();
check('leaving empties the room', !d.delivery.cohort && !Object.keys(d.room.here).length);
check('and forgets the marks', Object.keys(d.marksAt(101)).length === 0);
check('but not that a lesson is running - that is what offers the way back in',
      !!d.live.running[SESSION.cohort]);
check('so the invitation is now the one you left', d.invitation()?.cohort === SESSION.cohort,
      JSON.stringify(d.invitation()));

await player.dispose();
dom.restore();
console.log(failures ? `\n${failures} failing` : '\nall green');
process.exit(failures ? 1 : 0);
