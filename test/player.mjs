/* The player, mounted, with a live session happening to it.
 *
 * THE FIRST TEST IN THIS REPO THAT EXECUTES THE APP. Everything under `app/src` that is not
 * pure had none, and it cost a day: `nextTick` was never imported, so every `applied()` call
 * threw after incrementing its guard, the guard was stuck for the life of the tab, and
 * following only appeared to work. Three rounds of reading did not find it; a debugging
 * browser did. This is the cheaper instrument.
 *
 * WHAT IT DRIVES IS THE ROOM, not the buttons. The messages go in through `emitLocal`, which
 * is `live.js`'s own dispatcher and the preview's one door in - so what runs is every real
 * handler a real socket would reach, in the same order. What it asserts is what a student
 * SEES: the band's sentence and the footer's position, read out of the DOM. Reaching into
 * App.vue's refs would test the implementation and would have passed with `applying` stuck.
 *
 * The fixtures are a course with a slides topic and three exercises, so the walk is
 * `[slides, 101, 102, 103]` and the footer counts 1..4. See harness.mjs for how it is built
 * and dom.mjs for what a jsdom window has to be lent.
 */
import { installDom } from './dom.mjs';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `  -- ${detail}` : ''}`);
  if (!ok) failures++;
};

const COURSE = {
  id: 'c1', title: 'Course One',
  modules: [{ module: '1', title: 'M', units: [{ unit: '1.1', title: 'U', topics: [
    { topic: '1.1.1', title: 'Topic One',
      slides: 'slides/c1/1.1/index.html', slide: 3, end: 9, slideCount: 31,
      exercises: [
        /* A dataset on the first one only, so that a run reaching for the database reaches
         * PGlite - which is stubbed, and says so. See the Run relay at the end of this file. */
        { id: 101, title: 'First', type: 'coding', xp: 20, prompt: 'p', dataset: 'shop',
          steps: [{ sample: 'SELECT 1' }] },
        { id: 102, title: 'Second', type: 'coding', xp: 20, prompt: 'p', steps: [{ sample: 'SELECT 2' }] },
      ] },
    { topic: '1.1.2', title: 'Topic Two', exercises: [
      { id: 103, title: 'Third', type: 'coding', xp: 20, prompt: 'p', steps: [{ sample: 'SELECT 3' }] } ] },
  ] }] }],
};

const dom = installDom({ hash: '#/', search: '?course=c1' });
dom.serve('/content/courses.json', [{ id: 'c1', title: 'Course One', exercises: 3, xp: 60 }]);
dom.serve('/content/c1/index.json', COURSE);
dom.serve('/content/c1/data/shop.sql', 'CREATE TABLE shop (id int);');

const { createApp } = await import('vue');
const { buildPlayer } = await import('./harness.mjs');
const player = await buildPlayer({ preview: 'student' });

const app = createApp(player.App);
/* ANY ERROR THE APP THROWS IS A FAILURE OF THIS TEST, named where it happened.
 *
 * This is most of the value here. The bug that prompted the file threw inside a watcher on
 * every call - Vue caught it, logged it, and carried on, so the screen went on looking
 * roughly right while a guard was left permanently set. Without this handler the run would
 * be green and the app would be broken; with it, the first such throw is the failure.
 *
 * Vue's default handler swallows into console.error, so replacing it is the only way to see
 * them at all. */
app.config.errorHandler = (err, _vm, info) => {
  check(`the app threw during "${info}"`, false, String(err?.stack || err).split('\n')[0]);
};
app.mount(document.getElementById('app'));

/* Vue flushes on a microtask and the app's own load is a fetch away, so every step waits.
 * A fixed sleep rather than a flush: the thing under test is a chain of watchers reacting to
 * a message, and asserting after one tick would be asserting on a half-settled screen. */
const settle = (ms = 120) => new Promise(r => setTimeout(r, ms));
const text = () => document.body.textContent.replace(/\s+/g, ' ').trim();
/** The footer's counter - "3 / 4" - which is the one unambiguous statement of where we are. */
const at = () => (text().match(/(\d+) \/ (\d+)/) || [])[0] || '(nowhere)';

await settle(400);

// ---------------------------------------------------------------- it comes up
check('the course opens', /Course One/.test(text()), text().slice(0, 120));
/* Four rows for three exercises: the topic's slides are a step of the walk. A count of 3
 * here would mean the slides row was dropped, which is how a topic loses its teaching. */
check('the walk counts the slides row', at() === '1 / 4', at());

/* THE DECK IS ON THE ROW, and the frame's src is where that shows. It was looked up
 * separately and could come back empty, composing `/undefined#/3` - which the SPA fallback
 * answers with index.html, so the player rendered inside itself. */
{
  const frame = document.querySelector('iframe');
  check('the slides step points at its own deck, at its own first slide',
        !!frame && frame.getAttribute('src') === '/slides/c1/1.1/index.html#/3',
        frame ? frame.getAttribute('src') : 'no iframe');
  check('and never at a path built out of nothing',
        !/undefined/.test(frame?.getAttribute('src') || ''), frame?.getAttribute('src'));
}

// ------------------------------------------------------- joining a live session
location.hash = '#/live/data-team';
dispatchEvent(new window.Event('hashchange'));
await settle(400);
/* The preview seeds a session somebody else is running, and joining it starts a scripted
 * room that walks the tutor every three seconds. Stopped, because this test is the script:
 * two things moving the same screen is a test that passes or fails on timing. */
player.stopPreviewRoom();

check('the band says whose session it is',
      /Following .* live/.test(text()), text().slice(0, 200));

const tutor = { sub: 'preview-9', name: 'Sarah Mifsud', role: 'tutor', seen: new Date().toISOString() };
const moved = (exercise, title, slide = null) => player.emitLocal({
  type: 'moved', sub: tutor.sub, position: { exercise, title, slide },
  at: new Date().toISOString(),
});

player.emitLocal({ type: 'roster', members: [], here: [{ ...tutor, position: null }] });
await settle();

// ------------------------------------------------------------------- following
moved('102', 'Second');
await settle();
check('the class follows where the educator goes', at() === '3 / 4', at());

moved('103', 'Third');
await settle();
check('and keeps following as they move on', at() === '4 / 4', at());

/* A SLIDES STEP IS A RANGE, so paging inside one is a move even though the row has not
 * changed - and the follower has to page with it or the class sits on slide 3 while the
 * educator is nine slides in, which looks exactly like following being broken. */
moved('slides:1.1.1', 'Topic One', 7);
await settle();
check('and back onto the slides when the educator goes back to them', at() === '1 / 4', at());
/* WHERE INSIDE THE RANGE THEY LAND IS NOT ASSERTED HERE, and the reason is a real boundary
 * rather than an oversight: the follower is moved by writing the frame's hash, and the frame
 * is a browser navigating a published deck. jsdom loads nothing into it and has no history
 * to push, so there is no observable difference between slide 7 and slide 3 from out here.
 * What this run does prove is that the educator returning to the deck brings the class back
 * to it - the step, not the page within it. The clamp and the hash are `SlidesStep`'s, and
 * the only honest place to check them is a browser. */

moved('102', 'Second');
await settle();

// ------------------------------------------------------- and striking out alone
/* A move of their own is a decision, and it ends the following. THIS IS THE ONE THE MISSING
 * `nextTick` BROKE: `applied()` threw every time, so the guard it increments was stuck above
 * zero for the life of the tab and this branch was unreachable. The screen still followed,
 * so nothing looked wrong until a student navigated and was dragged back. */
const previous = [...document.querySelectorAll('footer button')]
  .find(b => /Previous/.test(b.textContent));
previous.click();
await settle();
check('navigating stops the following',
      /stopped following/.test(text()), text().slice(0, 240));
check('and it is their own move, so the screen stayed where they put it', at() === '2 / 4', at());

moved('101', 'First');
await settle();
check('the educator moving no longer drags them', at() === '2 / 4', at());

// ------------------------------------------------------------------- catch up
const catchUp = [...document.querySelectorAll('button')].find(b => /Catch up/.test(b.textContent));
check('and there is a way back, offered because the room said where to go', !!catchUp);
catchUp?.click();
await settle();
/* Catching up does NOT move them on its own - the band's Catch up sets the flag and the next
 * thing the educator does carries them. So the assertion is on the move after it. */
moved('102', 'Second');
await settle();
check('and after it they follow again', at() === '3 / 4', at());
check('and the band says so once more', /Following .* live/.test(text()), text().slice(0, 200));

// ------------------------------------- the educator presses Run on their behalf
/* CONTROL COULD MOVE THIS SCREEN AND TYPE INTO IT, and then Run and Check happened only in
 * the educator's own tab: the student watched their query being written for them and then
 * watched nothing happen to it. The gesture travels now, and it runs HERE - against this
 * browser's database, recording against this student's rows.
 *
 * WHAT IS ASSERTED IS THAT THE RUN WAS ATTEMPTED ON THIS SIDE, and the instrument is the
 * stub. The wasm runtimes are aliased away in a test process and name themselves when
 * called, so the database reporting itself absent is proof that this browser reached for it.
 * Nothing about a query RESULT is observable from here and nothing should be - asserting on
 * rows would be asserting on PGlite. See test/stubs/absent.js.
 */
player.emitLocal({
  type: 'controlling',
  control: {
    sub: player.session.sub, name: 'Ada Lovelace',
    by: tutor.sub, byName: tutor.name, sharing: false, at: new Date().toISOString(),
  },
});
player.emitLocal({
  type: 'driven',
  position: { exercise: '101', title: 'First', slide: null },
  code: 'SELECT 1', at: new Date().toISOString(),
});
await settle();
check('being driven carries the student to the exercise', at() === '2 / 4', at());

const reached = () => /not available in a test process/.test(text());
check('and nothing has run there yet', !reached(), text().slice(-200));
player.emitLocal({ type: 'acting', do: 'run', at: '101', when: new Date().toISOString() });
await settle(300);
check("the educator pressing Run runs it on the STUDENT's screen", reached(), text().slice(-240));

// --------------------------------- and what the editor is left holding afterwards
/* THE POINT OF DRIVING SOMEBODY'S EDITOR IS THAT THEY KEEP WHAT YOU WROTE, and they did
 * not. The exercise component is keyed by row, so every move remounts it and it reloaded
 * its own starter - and being released puts a student back with the class, so the
 * educator's next step carried them off the exercise they had just been helped with. The
 * fix was gone by the time they walked back to it, which reads as remote control undoing
 * itself.
 */
const editorText = () => document.querySelector('.cm-content')?.textContent ?? '(no editor)';
const FIX = 'SELECT the_fix_the_educator_typed;';
const holdsFix = () => editorText().includes('the_fix_the_educator_typed');

player.emitLocal({
  type: 'driven', position: { exercise: '101', title: 'First', slide: null },
  code: FIX, at: new Date().toISOString(),
});
await settle(250);
check('a drive writes the educator\'s fix into the student\'s editor', holdsFix(), editorText());

player.emitLocal({ type: 'controlling', control: null });
await settle(250);
check('letting go does not take it back on its own', holdsFix(), editorText());

/* And the half that was actually failing: being released puts them back with the class, so
 * the educator's next move is what carries them away from it. */
/* Somewhere the educator is not already standing: the follow watcher fires on a CHANGE of
 * reported position, so re-reporting the row they are on moves nobody. */
moved('103', 'Third');
await settle();
check('the lesson carries them off the exercise', at() === '4 / 4', at());
const previousAgain = () =>
  [...document.querySelectorAll('footer button')].find(b => /Previous/.test(b.textContent)).click();
previousAgain(); await settle(200);
previousAgain(); await settle(250);
check('and the fix is still there when they walk back to it', holdsFix(), editorText());

/* A DRIVE THAT ALSO MOVES THEM CARRIES ITS CODE. The buffer arrives as a prop, and a prop
 * that is already set when a component mounts fires no watcher - so a drive to an exercise
 * the student was not already on landed on a fresh component that had never heard of it and
 * showed the starter. The code never arrived at all. */
player.emitLocal({
  type: 'controlling',
  control: {
    sub: player.session.sub, name: 'Ada Lovelace',
    by: tutor.sub, byName: tutor.name, sharing: false, at: new Date().toISOString(),
  },
});
await settle(150);
player.emitLocal({
  type: 'driven', position: { exercise: '103', title: 'Third', slide: null },
  code: 'SELECT driven_across_a_move;', at: new Date().toISOString(),
});
await settle(300);
check('a drive that moves them to another exercise carries its code with it',
      at() === '4 / 4' && /driven_across_a_move/.test(editorText()), `${at()} ${editorText()}`);

// ------------------------------------------------- the educator goes to the board
/* THE STUDENT'S SIDE OF THE WHITEBOARD, which is the half `--as admin` cannot show: an
 * educator's board is drauu drawing on their own screen, and a student's is markup arriving
 * from somewhere else.
 *
 * THE ASSERTION THAT MATTERS IS THE LAST ONE. The board is an overlay and not a row in the
 * walk, and the whole design rests on that: it is why a board can simply be shown to the room
 * with no invitation, and why a student who has stopped following keeps their place under it.
 * As a row, showing it would be a MOVE - so the number in the footer being the same before
 * and after is the design, not a detail.
 */
{
  const wb = () => document.querySelector('.whiteboard');
  const ink = () => wb()?.querySelector('.wbsurface')?.innerHTML || '';
  const before = at();

  player.emitLocal({ type: 'boarding', on: true, page: 0 });
  await settle(150);
  check('a board put up in the room reaches the class', !!wb());
  check('and a student gets no chrome on it - they are watching one, not using one',
        !wb()?.querySelector('.wbbar'));

  player.emitLocal({ type: 'paged', page: 0, svg: '<path d="M10,10 L90,90" stroke="#f00"/>' });
  await settle(150);
  check('the page arrives and is drawn', /M10,10/.test(ink()), ink().slice(0, 120));

  player.emitLocal({ type: 'stroked', page: 0, node: '<rect x="5" y="6" width="8" height="9"/>' });
  await settle(150);
  check('and a stroke is appended to it rather than replacing it',
        /M10,10/.test(ink()) && /width="8"/.test(ink()), ink().slice(0, 200));

  /* Filtered on the way in, and this is the only place that can prove it end to end: the
   * string goes through the channel, the store and `v-html` exactly as a real one does. */
  player.emitLocal({ type: 'paged', page: 0,
                     svg: '<rect x="1" onmouseover="alert(1)"/><script>alert(2)<\/script>' });
  await settle(150);
  check('what arrives is filtered before it becomes DOM',
        /x="1"/.test(ink()) && !/onmouseover|alert/.test(ink()), ink().slice(0, 200));

  player.emitLocal({ type: 'boarding', on: false, page: 0 });
  await settle(150);
  check('the board goes away when the educator puts it away', !wb());
  check('AND THE STUDENT IS EXACTLY WHERE THEY WERE - an overlay moves nobody',
        at() === before, `${at()} was ${before}`);
}

// ------------------------------------- the educator's annotations, arriving
/* THE PLAYER'S OWN WIRING, which is the half a browser harness cannot reach: `decked` off
 * the channel -> delivery.js -> decksync.js -> a postMessage into whatever deck is on screen.
 * The deck itself is proven elsewhere; what is proven here is that the player finds it.
 *
 * The channel name is the one Slidev actually uses - the deck's title with ` - drawings` on
 * the end - because matching the bare word is precisely the bug this covers. */
player.emitLocal({ type: 'controlling', control: null });
await settle(150);
{
  // Back onto the slides row, which is the only row with a deck in it.
  const contents = [...document.querySelectorAll('footer button')].find(b => /Previous/.test(b.textContent));
  for (let i = 0; i < 4 && at() !== '1 / 4'; i++) { contents.click(); await settle(120); }
  check('the student is on the slides step', at() === '1 / 4', at());

  const frame = document.querySelector('iframe[data-deck]');
  check('and the deck frame is marked for the relay to find', !!frame,
        document.querySelector('iframe')?.outerHTML?.slice(0, 120) || 'no iframe');

  const got = [];
  frame?.contentWindow?.addEventListener('message', e => got.push(e.data));
  player.emitLocal({
    type: 'decked',
    channel: 'Course One \u2014 1.1 Topic One - Slidev - drawings',
    data: { 3: '<path d="M10 10 L90 90"/>' },
  });
  await settle(200);
  check("an educator's annotation reaches the deck on screen",
        got.some(m => m?.kind === 'ice:deck-sync' && m.data?.['3']),
        JSON.stringify(got).slice(0, 200));
}

// ------------------------------------------------------- the paperclip, afterwards
/* WHAT A STUDENT FINDS LATER. The board itself is live and gone; this is the half that
 * survives it, and the half a student who missed the lesson is actually served by.
 *
 * TWO HOMES, AND THIS COVERS THE SLIDES ONE. The footer's paperclip sits beside the Slides
 * button, which is hidden on a slides step - so on this row the header's is the only one
 * there is, which is exactly why there are two.
 */
{
  const clip = () => document.querySelector('.slidestep .boardclip button');
  check('a topic with kept boards draws a paperclip', !!clip());

  clip().click();
  await settle(120);
  const items = [...document.querySelectorAll('.clipmenu button')];
  check('several boards are chosen from rather than guessed between', items.length === 2,
        `${items.length} in the menu`);

  items[0].click();
  await settle(200);
  const surface = document.querySelector('.boardview .bvsurface');
  check('opening one draws it', !!surface && /ellipse|path/.test(surface.innerHTML || ''),
        (surface?.innerHTML || 'no surface').slice(0, 120));
  check('and says which board it is', /Joins, on the board/.test(text()), text().slice(0, 160));

  /* Two pages, so the pager is there. A board of one page must NOT draw it - a control that
   * says there is somewhere else to go and then refuses is worse than no control. */
  check('a board of more than one page can be paged',
        /1 \/ 2/.test(document.querySelector('.bvfoot')?.textContent || ''),
        document.querySelector('.bvfoot')?.textContent || 'no pager');

  [...document.querySelectorAll('.boardview button')].find(b => /Close/.test(b.textContent))?.click();
  await settle(120);
  check('and it closes again', !document.querySelector('.boardview'));
}

await player.dispose();
dom.restore();
console.log(failures ? `\n${failures} failing` : '\nall green');
process.exit(failures ? 1 : 0);
