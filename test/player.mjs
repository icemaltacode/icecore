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
      /* Versioned, as the builder writes it - see deckVersion in build.mjs. */
      slides: 'slides/c1/1.1/index.html?v=abc123def456', slide: 3, end: 9, slideCount: 31,
      exercises: [
        /* A dataset on the first one only, so that a run reaching for the database reaches
         * PGlite - which is stubbed, and says so. See the Run relay at the end of this file. */
        { id: 101, title: 'First', type: 'coding', xp: 20, prompt: 'p', dataset: 'shop',
          steps: [{ sample: 'SELECT 1' }] },
        { id: 102, title: 'Second', type: 'coding', xp: 20, prompt: 'p', steps: [{ sample: 'SELECT 2' }] },
      ] },
    { topic: '1.1.2', title: 'Topic Two', exercises: [
      /* A setup, so the fold above the editor has something to show - see CodeEditor.vue. */
      { id: 103, title: 'Third', type: 'coding', xp: 20, prompt: 'p',
        setup: 'CREATE VIEW recent AS SELECT 3;', steps: [{ sample: 'SELECT 3' }] } ] },
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
        !!frame && frame.getAttribute('src') === '/slides/c1/1.1/index.html?v=abc123def456#/3',
        frame ? frame.getAttribute('src') : 'no iframe');
  check('and never at a path built out of nothing',
        !/undefined/.test(frame?.getAttribute('src') || ''), frame?.getAttribute('src'));
  /* THE VERSION GOES WHERE THE DECK GOES. A republished deck is a new address so that no
   * browser reuses the old one, and the PDF is republished with it - so the download carries
   * the same `?v=`, and is still `slides.pdf` beside the deck rather than a path with the query
   * stuck in the middle of it. */
  const pdf = document.querySelector('a.deckbtn[download]');
  check('the PDF sits beside the deck, with the same version',
        pdf?.getAttribute('href') === '/slides/c1/1.1/slides.pdf?v=abc123def456',
        pdf ? pdf.getAttribute('href') : 'no download link');
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

/* ---- and what it says when the connection goes ----------------------------
 *
 * THE STATE NOBODY CAN LOOK AT. A dropped socket and a finished lesson were indistinguishable
 * from where a student sits - the room went quiet, and the only way to find out which had
 * happened was to reload - so the band has to say which, and it has to say it somewhere that
 * survives a small screen. The old wording was an aside on a `.sub` line that is
 * `display: none` under 720px.
 *
 * Driven through the channel's own reactive state rather than by dropping a socket, because
 * there is no socket here: `socketUrl()` is null in preview, so nothing can be disconnected.
 * That state is exactly what LiveBand reads, and it is the whole of the difference between
 * the two sentences.
 */
{
  const band = () => document.querySelector('.band');
  check('the band is not yellow while the room is live',
        !band()?.classList.contains('away'), band()?.className);

  player.channel.lost = true;
  player.channel.status = 'waiting';
  await settle(60);
  check('losing the connection turns the band yellow',
        !!band()?.classList.contains('away'), band()?.className);
  /* THE PRIMARY SENTENCE, not an aside: this is the half of the band that is never hidden. */
  check('and it says the connection went rather than that the lesson ended',
        /reconnect/i.test(band()?.textContent || ''), band()?.textContent?.slice(0, 160));
  check('and that they are still in the lesson',
        /still in/i.test(band()?.textContent || ''), band()?.textContent?.slice(0, 160));
  /* Leave is still there. A student who has had enough of waiting must not be trapped by a
   * band that has taken its own controls away. */
  check('and the way out is still offered',
        /Leave/.test(band()?.textContent || ''), band()?.textContent?.slice(0, 160));

  player.channel.status = 'open';
  player.channel.lost = false;
  await settle(60);
  check('and it goes back to the ordinary sentence when it comes back',
        !band()?.classList.contains('away') && /Following .* live/.test(text()),
        text().slice(0, 160));
}

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

/* ---- MOVES IN ORDER, BY THE SERVER'S CLOCK ----------------------------------
 *
 * Every move is its own concurrent invocation, so two quick presses of Next can reach a student
 * the wrong way round, and applied as they came the class is left one slide behind. The Lambda
 * stamps each with `at`, and the newest is where the educator is.
 *
 * STAMPED BETWEEN THE LAST MOVE AND NOW. `moved()` above stamps the present, so a time further
 * back than the last one it sent is older than that move and rightly ignored; and a time in the
 * future would make every move this file sends afterwards look old.
 */
{
  await settle(300);
  const ago = ms => new Date(Date.now() - ms).toISOString();
  const place = (exercise, title) => ({ exercise, title, slide: null });
  player.emitLocal({ type: 'moved', sub: tutor.sub, position: place('102', 'Second'), at: ago(100) });
  player.emitLocal({ type: 'moved', sub: tutor.sub, position: place('103', 'Third'), at: ago(200) });
  await settle();
  check('a move that arrives after a newer one does not walk the class back', at() === '3 / 4', at());
  /* A ROSTER IS READ AT ONE MOMENT and can land after a move made a moment later. */
  player.emitLocal({ type: 'roster', members: [],
                     here: [{ ...tutor, position: place('103', 'Third'), posAt: ago(270) }] });
  await settle();
  check('nor does a roster read before the newest move', at() === '3 / 4', at());
  player.emitLocal({ type: 'roster', members: [],
                     here: [{ ...tutor, position: place('103', 'Third'), posAt: ago(0) }] });
  await settle();
  check('but a roster newer than it does move them', at() === '4 / 4', at());
}

/* ---- A MOVE COUNTS ONLY ONCE IT HAS GONE -----------------------------------
 *
 * `report()` recorded a position as reported and THEN sent it, ignoring the answer - so a move
 * made while the socket was between connections was never sent and never tried again, and the
 * class sat on the old slide until the educator moved a second time. Nothing here could see it:
 * `send` drops silently with no socket, and there is never a socket in preview. The outbox is
 * what sees it - every send is recorded, and every one of them fails, which is exactly the
 * state a reconnecting tab is in.
 */
{
  player.outbox.on = true;
  player.outbox.sent.length = 0;
  const actives = () => player.outbox.sent.filter(m => m.type === 'active');
  moved('102', 'Second');
  await settle();
  const first = actives().length;
  check('following a move reports where this screen now is',
        first >= 1 && String(actives().at(-1)?.at) === '102', JSON.stringify(actives()));
  dispatchEvent(new window.KeyboardEvent('keydown', { key: 'a' }));
  await settle(60);
  check('a report that could not be sent is tried again on the next thing the student does',
        actives().length > first, `${actives().length} reports, was ${first}`);

  /* A REOPENED SOCKET IS A NEW CONNECTION ROW WITH NO POSITION ON IT, so the first thing it
   * says is where it is - or after any reconnection the room had nobody to follow. */
  player.outbox.sent.length = 0;
  player.emitLocal({ type: 'open' });
  await settle(60);
  check('a reopened socket asks for the roster and then says where it is, throttle or not',
        player.outbox.sent.some(m => m.type === 'roster')
        && actives().length === 1 && String(actives()[0].at) === '102',
        JSON.stringify(player.outbox.sent).slice(0, 200));
  player.outbox.on = false;
  player.outbox.sent.length = 0;
}

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

// -------------------------------------------------------------- following again
const rejoin = [...document.querySelectorAll('button')].find(b => /Follow again/.test(b.textContent));
check('and there is a way back, offered because the room said where to go', !!rejoin);
rejoin?.click();
await settle();
/* Following again does NOT move them on its own here - the band sets the flag and the next
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
/* THE STUDENT'S OWN, and it is the first because it is the first tab. There can be two
 * editors on this screen now - see EditorPane.vue - and the whole promise of the second one
 * is that it is not this. A helper that said "the editor" would quietly pass whichever
 * happened to be in the DOM first and prove nothing about which. */
const editors = () => [...document.querySelectorAll('.cm-content')].map(e => e.textContent);
const editorText = () => editors()[0] ?? '(no editor)';
/** What is on the screen, in either tab. */
const anyEditor = () => editors().join('\n');
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

/* A CARET PAST THE END OF THE TEXT MUST NOT FREEZE THE EDITOR. The educator typed two lines
 * at the bottom, then copied the shorter answer in: the student's editor kept the caret at
 * character 333 of a 286-character document, and every change after that threw inside
 * CodeMirror's `mapPos` - "Position 333 is out of range for changeset of length 286" - so
 * the screen stayed on the old text for the rest of the session while every drive arrived.
 * Found on the live rig. */
{
  const driveTo = (code, cursor) => player.emitLocal({
    type: 'driven', position: { exercise: '103', title: 'Third', slide: null },
    code, cursor, at: new Date().toISOString() });
  const LONG = 'SELECT the_educator_typed_two_more_lines_at_the_bottom;';
  driveTo(LONG, LONG.length);
  await settle(200);
  driveTo('SELECT copied;', LONG.length);   // the caret still where the long text ended
  await settle(200);
  driveTo('SELECT the_next_drive_arrives;', 5);
  await settle(250);
  check('a caret left past the end of the text does not freeze the editor',
        /the_next_drive_arrives/.test(editorText()), editorText());

  // And the newest drive wins over the last to arrive, as a pushed demonstration does.
  const numbered = (code, seq) => player.emitLocal({
    type: 'driven', position: { exercise: '103', title: 'Third', slide: null },
    code, cursor: null, origin: 'control-tab', seq, at: new Date().toISOString() });
  numbered('SELECT the_newer_drive;', 7);
  await settle(200);
  numbered('SELECT the_older_drive;', 6);
  await settle(200);
  /* ---- THE SETUP, FOLDED ABOVE THE CODE ------------------------------------
   *
   * Students started exercises confused that a table or a variable already existed, because
   * the setup that made it runs first and was shown nowhere. It is drawn above line 1 now,
   * folded by default - and it is NOT in the document, so it is never run twice, never
   * submitted, and moves no line number and no caret. */
  {
    const fold = () => document.querySelector('.cm-preamble');
    const lines = () => [...document.querySelectorAll('.cm-content')][0]
      ?.querySelectorAll('.cm-line') || [];
    const doc = () => [...lines()].map(l => l.textContent).join('\n');
    check('the setup is shown above the code, folded',
          !!fold() && !fold().classList.contains('open') && !document.querySelector('.cm-preamble-code')
            && /Setup code/.test(fold().textContent)
            && /1 line/.test(fold().textContent),
          fold()?.textContent || 'no fold');
    fold().querySelector('.cm-preamble-head').click();
    await settle(120);
    check('and opens to the code that runs first',
          document.querySelector('.cm-preamble-code')?.textContent === 'CREATE VIEW recent AS SELECT 3;',
          document.querySelector('.cm-preamble-code')?.textContent || 'still folded');
    check('without becoming part of what they wrote',
          !/CREATE VIEW/.test(doc()) && /^SELECT /.test(doc()), doc());
    fold().querySelector('.cm-preamble-head').click();
    await settle(120);
    check('and folds again', !document.querySelector('.cm-preamble-code'));
  }

  check('an older drive arriving late does not replace a newer one on the driven screen',
        /the_newer_drive/.test(editorText()) && !/the_older_drive/.test(editorText()),
        editorText());
}

// -------------------------------- and the same button, to the whole room at once
/* SHARING AN EDITOR HAD CONTROL'S OLD HOLE, one audience further out. The educator's code
 * appeared on every screen in the room and then stopped: Run and Check ran in their own tab
 * alone, so a class watched an answer being typed and then watched nothing happen to it.
 *
 * THE INSTRUMENT IS THE SAME STUB and it can only be read once per row, because the
 * component is keyed by the row and a remount clears what it said. So this runs on a row
 * nothing has run on yet, and the REFUSAL is asserted before the acceptance - the other
 * order proves nothing, since a screen that has already complained goes on complaining.
 */
{
  player.emitLocal({ type: 'controlling', control: null });
  await settle(150);
  [...document.querySelectorAll('button')].find(b => /Follow again/.test(b.textContent))?.click();
  await settle(120);
  /* The first row, and only it: the fixture puts a dataset there so that a run reaching for
   * the database says so. A row without one fails earlier and for another reason, which
   * proves the fetch rather than the run. */
  moved('101', 'First');
  await settle(250);
  check('the class is back with the educator, on a row nothing has run on',
        at() === '2 / 4' && !reached(), `${at()} ${text().slice(-160)}`);

  const SHOWN = 'SELECT the_answer_everybody_watched;';
  const shows = () => editorText().includes('the_answer_everybody_watched');
  const pressRun = at => player.emitLocal(
    { type: 'acting', do: 'run', at, when: new Date().toISOString() });

  player.emitLocal({ type: 'syncing', on: true });
  await settle(150);

  /* THE SWITCH IS NOT THE GATE, and this is the half that would be silently wrong. A press
   * to the room reaches every connection, so a student sitting on a different row from the
   * push has the educator's button pressed on THEIR OWN half-written attempt, by somebody
   * who cannot see it. The verb names the exercise on screen, so the component's own check
   * passes - only the buffer being the educator's can tell these two apart. */
  player.emitLocal({ type: 'synced', at: '102', code: SHOWN, cursor: null, anchor: null,
                     when: new Date().toISOString() });
  await settle(200);
  check("a push for another row does not put the educator's code here", !shows(), editorText());
  pressRun('101');
  await settle(300);
  check('and Run does not reach a screen that is not showing what they wrote', !reached(),
        text().slice(-200));

  /* ---- and the shape of what a demonstration actually does ------------------
   *
   * IT OPENS A TAB; IT DOES NOT TAKE THE EDITOR. Sharing used to write the educator's text
   * into the student's own buffer and hand it back afterwards - one stash, cleared on
   * navigation, so a student who walked out of a demonstration half way left their attempt
   * behind with it. Nothing of theirs is touched now, so there is nothing to give back, and
   * these two assertions are the whole of that promise: it is on screen, and it is not in
   * their editor.
   */
  const MINE = 'SELECT what_the_student_was_writing;';
  const view0 = player.EditorView.findFromDOM(document.querySelector('.cm-editor'));
  view0.dispatch({ changes: { from: 0, to: view0.state.doc.length, insert: MINE } });
  await settle(200);

  player.emitLocal({ type: 'synced', at: '101', code: SHOWN, cursor: null, anchor: null,
                     step: 0, when: new Date().toISOString() });
  await settle(250);
  check("the educator's editor is on the student's screen", anyEditor().includes(SHOWN),
        anyEditor());
  check('and it did NOT land in the student\'s own', editorText().includes('was_writing'),
        editorText());
  /* The tab is named after the person, because there is no file concept to borrow and a
   * student in two intakes has two of these. */
  check('the tab is named after whoever wrote it',
        [...document.querySelectorAll('.tab')].some(t => /'s version/.test(t.textContent)),
        [...document.querySelectorAll('.tab')].map(t => t.textContent.trim()));

  pressRun('101');
  await settle(300);
  check('and now Run reaches the class, not only the tab it was pressed in', reached(),
        text().slice(-240));

  /* ---- THE NEWEST PUSH WINS, NOT THE LAST TO ARRIVE ------------------------
   *
   * Each push is its own concurrent invocation, so an older one can land after a newer one - and
   * each carries the whole buffer, so applied last it leaves older code on thirty screens once the
   * educator stops typing. The sending tab numbers them; a number means something only beside
   * the tab that counted it.
   */
  {
    const push = (code, stamp = {}) => player.emitLocal({
      type: 'synced', at: '101', code, cursor: null, anchor: null, step: 0,
      when: new Date().toISOString(), ...stamp });
    push('SELECT the_fifth_push;', { origin: 'tab-a', seq: 5 });
    await settle(200);
    push('SELECT the_fourth_push;', { origin: 'tab-a', seq: 4 });
    await settle(200);
    check('an older push arriving late does not replace a newer one',
          anyEditor().includes('the_fifth_push') && !anyEditor().includes('the_fourth_push'),
          anyEditor());
    push('SELECT from_before_the_deploy;');
    await settle(200);
    check('a push with no number is applied, as an educator tab from before this sends',
          anyEditor().includes('from_before_the_deploy'), anyEditor());
    push('SELECT from_a_reloaded_tab;', { origin: 'tab-b', seq: 1 });
    await settle(200);
    check('a push from a new tab is applied whatever its number',
          anyEditor().includes('from_a_reloaded_tab'), anyEditor());
    // And the demonstration the rest of this file expects, back on screen.
    push(SHOWN, { origin: 'tab-b', seq: 2 });
    await settle(200);
  }

  player.emitLocal({ type: 'syncing', on: false });
  await settle(200);

  /* IT SURVIVES THE LESSON MOVING ON. The exercise component is keyed by row, so without a
   * record of its own the tab would last exactly as long as the student stayed put - and
   * being able to come back to it is the reason it is kept at all. */
  check('the demonstration is still there when sharing stops', anyEditor().includes(SHOWN),
        anyEditor());
  check("and so is the student's own work", editorText().includes('was_writing'), editorText());

  /* ---- taking it as your own ------------------------------------------------
   *
   * The one gesture that changes what Check submits, and the whole reason the version this
   * replaced wanted a checkbox on a modal. It asks first, because there is something to lose.
   */
  const button = re => [...document.querySelectorAll('button')]
    .find(b => re.test(b.textContent.trim()));
  button(/Use this as my answer/)?.click();
  await settle(150);
  check('taking it as your own asks first, because there is work to lose',
        !!button(/^Replace mine$/), [...document.querySelectorAll('.ask p')].map(n => n.textContent));
  button(/^Keep mine$/)?.click();
  await settle(150);
  check('and declining leaves their own alone', editorText().includes('was_writing'),
        editorText());

  button(/Use this as my answer/)?.click();
  await settle(120);
  button(/^Replace mine$/)?.click();
  await settle(200);
  check('accepting puts it in their own editor, where Check can reach it',
        editorText().includes('the_answer_everybody_watched'), editorText());
}

// ------------------------------- a classmate's screen, shown to the class
/* SHARING A CONTROLLED SCREEN SHARED ITS POSITION AND NOTHING ELSE. The class was walked to
 * the exercise, told they were watching somebody's screen, and shown the starter code while
 * the educator wrote the fix into that student's editor where nobody else could see it. Found
 * on the live rig: 33 drives reached the controlled student and none reached the classmate.
 *
 * The editor now arrives as `shown`, and is drawn the way a demonstration is - a tab beside
 * their own work - named after the student whose screen it is. Unlike a demonstration it is
 * not kept: it is a classmate's work, visible for exactly as long as sharing is on.
 */
{
  const DORIS = 'SELECT what_the_educator_wrote_for_doris;';
  const doris = { sub: 'doris-sub', name: 'Doris McDay', role: 'student',
                  seen: new Date().toISOString() };
  const showing = (code, stamp = {}) => player.emitLocal({
    type: 'shown', sub: doris.sub, at: '101', code, cursor: null, anchor: null,
    when: new Date().toISOString(), ...stamp });
  const hasDoris = () => anyEditor().includes('what_the_educator_wrote_for_doris');

  player.emitLocal({ type: 'joined', who: { ...doris,
    position: { exercise: '101', title: 'First', slide: null } } });
  const control = sharing => player.emitLocal({ type: 'controlling', control: {
    sub: doris.sub, name: doris.name, by: tutor.sub, byName: tutor.name,
    sharing, at: '2026-09-29T15:45:38.274Z' } });

  control(false);
  await settle(150);
  showing(DORIS, { origin: 'ctl', seq: 1 });
  await settle(200);
  check('a controlled screen that is NOT shared shows the class nothing of its editor',
        !hasDoris(), anyEditor());

  control(true);
  await settle(150);
  showing(DORIS, { origin: 'ctl', seq: 2 });
  await settle(250);
  check("while it is shared, the class sees that screen's editor", hasDoris(), anyEditor());
  check('and it did NOT land in their own', !editorText().includes('for_doris'), editorText());
  check('the tab is named after the student whose screen it is',
        [...document.querySelectorAll('.tab')].some(t => /Doris McDay's version/.test(t.textContent)),
        [...document.querySelectorAll('.tab')].map(t => t.textContent.trim()));

  showing('SELECT an_older_drive;', { origin: 'ctl', seq: 1 });
  await settle(200);
  check('an older drive arriving late does not replace a newer one',
        hasDoris() && !anyEditor().includes('an_older_drive'), anyEditor());

  /* ---- AND RUN, ON EVERY SCREEN WATCHING IT ----------------------------------
   *
   * The educator's Run on a shared screen reaches the class, and each classmate runs THAT
   * screen's code in their own browser. When sharing stops they get their own screen back:
   * the editor tab and the output pane both, because output from a program no longer on
   * screen is not their screen. The stub is the instrument, as it is above, so the pane is
   * emptied by one full cycle before the cycle that proves anything. */
  const pressRun = () => player.emitLocal(
    { type: 'acting', do: 'run', at: '101', when: new Date().toISOString() });
  pressRun();
  await settle(300);
  control(false);
  await settle(250);
  check('it goes the moment sharing stops, rather than being kept like a demonstration',
        !hasDoris(), anyEditor());
  check("and so does the output of that screen's run", !reached(), text().slice(-200));

  control(true);
  await settle(150);
  showing(DORIS, { origin: 'ctl', seq: 3 });
  await settle(250);
  check('shared again, and nothing has run here yet', hasDoris() && !reached(),
        text().slice(-200));
  pressRun();
  await settle(300);
  check("Run pressed on a shared screen runs on the classmate's too", reached(),
        text().slice(-200));
  control(false);
  await settle(250);
  check('and when control ends they get their own screen back',
        !reached() && !hasDoris() && editorText().includes('everybody_watched'),
        `${editorText()} | ${text().slice(-160)}`);

  player.emitLocal({ type: 'controlling', control: null });
  player.emitLocal({ type: 'left', sub: doris.sub });
  await settle(150);
}

// ------------------------------------------- and Run runs what is highlighted
/* EVERY EDITOR A STUDENT HAS EVER USED runs the highlighted lines, and this one ran the
 * whole file regardless - so trying one line meant commenting out the rest and remembering
 * to put it back.
 *
 * WHAT IS ASSERTED HERE IS THE WIRING, and it is asserted through the BUTTON because that is
 * what a student sees: the editor's selection has to reach the component and change what the
 * button says it is about to do. What the selection resolves TO - whole lines, dedented,
 * blank is nothing - is pure and lives in test/selection.mjs, where it can be stated as
 * fifteen cases instead of one.
 *
 * The label is the feature and not decoration. Running something other than the file is what
 * every other editor does, but doing it silently would be a surprise the student had no way
 * to see coming - sharpest in Python, where a run is the setup and then the code with
 * nothing carried over, so a selection leaning on their own earlier lines raises NameError.
 */
{
  const runButton = () =>
    [...document.querySelectorAll('.actions button')].find(b => /^Run/.test(b.textContent.trim()));
  const runLabel = () => runButton()?.textContent.trim() ?? '(no Run button)';
  const view = player.EditorView.findFromDOM(document.querySelector('.cm-editor'));
  check('the editor is reachable, so a selection can be put in it', !!view);

  const MULTI = 'SELECT one\nFROM t\nWHERE x = 1';
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: MULTI } });
  await settle(250);
  check('with nothing highlighted the button runs the file', runLabel() === 'Run code', runLabel());

  // The second line, exactly - the offsets either side of 'FROM t'.
  view.dispatch({ selection: { anchor: 11, head: 17 } });
  await settle(250);
  check('highlighting some of it changes what the button says it will do',
        runLabel() === 'Run selection', runLabel());

  /* A STRAY DRAG IS NOT A SELECTION. Two spaces highlighted would otherwise offer to run
   * nothing, which is a button press that does nothing and looks like a fault. */
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'SELECT 1\n   \n' } });
  view.dispatch({ selection: { anchor: 9, head: 12 } });
  await settle(250);
  check('but highlighting only whitespace is not', runLabel() === 'Run code', runLabel());

  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: MULTI } });
  view.dispatch({ selection: { anchor: 11, head: 17 } });
  await settle(200);
  view.dispatch({ selection: { anchor: 11, head: 11 } });
  await settle(250);
  check('and putting the caret back gives the whole file again',
        runLabel() === 'Run code', runLabel());
}

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

  /* ---- NUMBERED, because messages overtake one another ------------------------
   *
   * Every change the educator makes carries the version it makes (`v`) and, for a stroke, the
   * one it follows (`after`). A stroke that arrives before the one it follows is held and
   * applied when the gap closes; one that never closes is repaired by asking for the page.
   * `epoch` is one run of the educator's tab - a reload counts from one again. */
  {
    const page = (v, svg, epoch = 'run-1') => player.emitLocal({ type: 'paged', page: 0, v, epoch, svg });
    const stroke = (v, after, x, epoch = 'run-1') => player.emitLocal(
      { type: 'stroked', page: 0, v, after, epoch, node: `<ellipse cx="${x}" cy="1" rx="1" ry="1"/>` });
    const count = x => (ink().match(new RegExp(`cx="${x}"`, 'g')) || []).length;

    page(10, '<rect x="100"/>');
    await settle(120);
    check('a numbered page is drawn', /x="100"/.test(ink()), ink().slice(0, 120));

    stroke(11, 10, 11);
    await settle(80);
    check('a stroke that follows it is appended', count(11) === 1, ink().slice(0, 200));

    stroke(13, 12, 13);
    await settle(80);
    check('one that arrives before the stroke it follows is held, not drawn', count(13) === 0,
          ink().slice(0, 200));
    stroke(12, 11, 12);
    await settle(80);
    check('and both are drawn, in order, once the gap closes',
          count(12) === 1 && count(13) === 1 && ink().indexOf('cx="12"') < ink().indexOf('cx="13"'),
          ink().slice(0, 300));

    stroke(12, 11, 12);
    await settle(80);
    check('a stroke heard twice is drawn once', count(12) === 1, ink().slice(0, 300));

    page(9, '<rect x="999"/>');
    await settle(120);
    check('an older page arriving late does not replace a newer drawing',
          !/x="999"/.test(ink()) && count(13) === 1, ink().slice(0, 200));

    page(1, '<rect x="222"/>', 'run-2');
    await settle(120);
    check("a reloaded educator's first page is taken, though it counts from one again",
          /x="222"/.test(ink()) && count(13) === 0, ink().slice(0, 200));

    player.outbox.on = true;
    player.outbox.sent.length = 0;
    stroke(5, 4, 55, 'run-2');
    await settle(1700);
    check('a gap that never closes is repaired by asking for the page',
          player.outbox.sent.some(m => m.type === 'wantpage') && count(55) === 0,
          JSON.stringify(player.outbox.sent));
    player.outbox.on = false;
    player.outbox.sent.length = 0;
  }

  /* ---- WET INK: the stroke still being drawn -----------------------------------
   *
   * A preview over the page, not part of it: each frame is the whole stroke so far and replaces
   * the last, and the finished stroke - numbered like any other - takes its place. Nothing here
   * may leave two copies of a stroke on screen, or a preview hanging where nothing was drawn. */
  {
    const page = (v, svg) => player.emitLocal({ type: 'paged', page: 0, v, epoch: 'wet', svg });
    const inked = (s, n, x, extra = {}) => player.emitLocal(
      { type: 'inked', page: 0, epoch: 'wet', s, n, node: `<path d="M 0 0 L ${x} ${x}"/>`, ...extra });
    const has = x => (ink().match(new RegExp(`L ${x} ${x}"`, 'g')) || []).length;

    page(1, '<rect x="300"/>');
    await settle(120);
    inked(1, 1, 401);
    await settle(30);
    check('the stroke being drawn shows while the pen is still down', has(401) === 1,
          ink().slice(0, 200));

    inked(1, 3, 403);
    inked(1, 2, 402);
    await settle(30);
    check('each frame replaces the last, and an older one arriving late is ignored',
          has(403) === 1 && has(401) === 0 && has(402) === 0, ink().slice(0, 300));

    inked(2, 1, 77, { page: 1 });
    await settle(30);
    check('a stroke on another page is not drawn on this one', has(77) === 0, ink().slice(0, 300));

    player.emitLocal({ type: 'stroked', page: 0, v: 2, after: 1, epoch: 'wet', s: 1,
                       node: '<path d="M 0 0 L 409 409"/>' });
    await settle(30);
    check('the finished stroke takes the place of its preview, one copy on screen',
          has(409) === 1 && has(403) === 0, ink().slice(0, 300));
    inked(1, 4, 404);
    await settle(30);
    check('and a frame overtaken by its own finished stroke is not drawn again', has(404) === 0,
          ink().slice(0, 300));

    inked(3, 1, 501);
    await settle(30);
    player.emitLocal({ type: 'inked', page: 0, epoch: 'wet', s: 3, gone: true });
    await settle(30);
    check('a stroke the educator threw away goes from the screen', has(501) === 0,
          ink().slice(0, 300));

    inked(4, 1, 601);
    await settle(30);
    page(3, '<rect x="333"/>');
    await settle(120);
    check('a page replacing this one takes whatever was wet with it',
          has(601) === 0 && /x="333"/.test(ink()), ink().slice(0, 300));
  }

  player.emitLocal({ type: 'boarding', on: false, page: 0 });
  await settle(150);
  check('the board goes away when the educator puts it away', !wb());
  check('AND THE STUDENT IS EXACTLY WHERE THEY WERE - an overlay moves nobody',
        at() === before, `${at()} was ${before}`);
}

// ------------------------------------------ catching up, every thirty seconds
/* THE LIGHT ROSTER. Every discrete message is sent once, and a client that missed one with its
 * socket still up never heard it again - measured on the deployment, three of three never
 * caught up. So every client asks every thirty seconds, and the server answers without the
 * members, which cannot change, and without the board's drawing, which must not be put back
 * under an educator's pen on a timer. What arrives has to repair what was missed and leave
 * everything else exactly as it was.
 */
{
  const wb = () => document.querySelector('.whiteboard');
  const ink = () => wb()?.querySelector('.wbsurface')?.innerHTML || '';
  const band = () => document.querySelector('.band')?.textContent.replace(/\s+/g, ' ') || '';
  const place = (exercise, title) => ({ exercise, title, slide: null });
  const now = () => new Date().toISOString();
  [...document.querySelectorAll('button')].find(b => /Follow again/.test(b.textContent))?.click();
  await settle(150);
  /* Past the freshness window of the whiteboard test above: a light roster deliberately defers
   * to a `boarding` heard in the last five seconds. */
  await settle(5200);

  player.emitLocal({ type: 'roster', members: [{ sub: 'member-1', name: 'Member One' }],
                     here: [{ ...tutor, position: place('101', 'First'), posAt: now() }] });
  await settle(250);
  await settle(20);
  player.emitLocal({ type: 'roster', light: true, boardOn: false,
                     here: [{ ...tutor, position: place('102', 'Second'), posAt: now() }] });
  await settle(250);
  check('a light roster moves a following student to where the educator is', at() === '3 / 4',
        at());
  /* Read from the state, because a student is never shown the member list: it is the educator's
   * panel that would empty every thirty seconds. */
  check('and leaves the member list as it was', player.delivery.room.members.length === 1,
        JSON.stringify(player.delivery.room.members));

  /* THE ROSTER SAYS A BOARD IS UP AND NOTHING ABOUT WHAT IS ON IT: the drawing is not kept on
   * the server any more. The student asks the educator's tab, which answers them alone. */
  player.outbox.on = true;
  player.outbox.sent.length = 0;
  player.emitLocal({ type: 'roster', members: [{ sub: 'member-1', name: 'Member One' }],
                     here: [{ ...tutor, position: place('102', 'Second'), posAt: now() }],
                     board: { on: true, page: 0 } });
  await settle(200);
  check('a full roster puts up the board a student arrived under', !!wb());
  check('and the student asks for what is already drawn on it',
        player.outbox.sent.some(m => m.type === 'wantpage'), JSON.stringify(player.outbox.sent));
  player.outbox.on = false;
  player.outbox.sent.length = 0;
  player.emitLocal({ type: 'paged', page: 0, v: 3, epoch: 'roster-run', svg: '<path d="M1,1 L2,2"/>' });
  await settle(150);
  check('which arrives, and is drawn', /M1,1/.test(ink()), ink().slice(0, 80));
  player.emitLocal({ type: 'roster', light: true, boardOn: true,
                     here: [{ ...tutor, position: place('102', 'Second'), posAt: now() }] });
  await settle(200);
  check('a light roster leaves an open board, and its drawing, as they were',
        !!wb() && /M1,1/.test(ink()), ink().slice(0, 80));
  player.emitLocal({ type: 'roster', light: true, boardOn: false,
                     here: [{ ...tutor, position: place('102', 'Second'), posAt: now() }] });
  await settle(200);
  check('a board the student missed being put away is put away', !wb());

  player.outbox.on = true;
  player.outbox.sent.length = 0;
  player.emitLocal({ type: 'roster', light: true, boardOn: true,
                     here: [{ ...tutor, position: place('102', 'Second'), posAt: now() }] });
  await settle(100);
  check('a board the student missed going up is asked for in full, drawing and all',
        player.outbox.sent.some(m => m.type === 'roster' && !m.light),
        JSON.stringify(player.outbox.sent));
  player.outbox.on = false;
  player.outbox.sent.length = 0;

  /* A ROSTER READ JUST BEFORE A BROADCAST CAN ARRIVE JUST AFTER IT, and must not undo it. */
  player.emitLocal({ type: 'boarding', on: true, page: 0 });
  await settle(100);
  player.emitLocal({ type: 'roster', light: true, boardOn: false,
                     here: [{ ...tutor, position: place('102', 'Second'), posAt: now() }] });
  await settle(150);
  check('a light roster does not take down a board put up a moment ago', !!wb());
  player.emitLocal({ type: 'boarding', on: false, page: 0 });

  player.emitLocal({ type: 'syncing', on: true });
  await settle(100);
  player.emitLocal({ type: 'roster', light: true, sync: false,
                     here: [{ ...tutor, position: place('102', 'Second'), posAt: now() }] });
  await settle(150);
  check('nor switch off a demonstration switched on a moment ago',
        /writing in a tab of their own/.test(band()), band().slice(0, 160));
  player.emitLocal({ type: 'syncing', on: false });
  await settle(150);
}

// ------------------------------------------ the class is given five minutes
/* THE COUNTDOWN, from the side that receives one.
 *
 * THE ASSERTION THAT MATTERS IS THE SECOND. Every message carries the SERVER'S clock beside
 * the deadline, and this client's clock is deliberately wrong by ninety seconds - which is an
 * ordinary laptop in an ordinary classroom. Uncorrected, the room would be told it had 3:30
 * while the educator was looking at 5:00, and both screens would look equally right. There is
 * no other instrument for this: a preview and a real lesson both run on one machine, where
 * every clock agrees by construction.
 */
{
  const chip = () => document.querySelector('.ltchip .ltnum')?.textContent?.trim() || '';
  const big = () => document.querySelector('.ltbig');
  /* Ninety seconds BEHIND the server, so an uncorrected reading is too long rather than too
   * short - a timer that ran out early could be mistaken for one that simply did. */
  const wrong = ms => new Date(Date.now() + ms).toISOString();
  const timing = t => player.emitLocal({ type: 'timing', timer: t });

  timing({ seconds: 300, ends: wrong(90 * 1000 + 300 * 1000), running: true,
           prominent: false, now: wrong(90 * 1000) });
  await settle(150);
  check('a countdown set for the room reaches the class', !!chip(), chip());
  check('AND A BROWSER WITH A WRONG CLOCK STILL SHOWS THE RIGHT TIME',
        /^(5:00|4:59)$/.test(chip()), chip());
  check('and small is small - nothing over the player until it is asked for', !big());

  /* Made prominent is a different way of showing the same deadline. If this moved it, the
   * panel would open on a number that had nothing to do with the one beside it. */
  timing({ seconds: 300, ends: wrong(90 * 1000 + 300 * 1000), running: true,
           prominent: true, now: wrong(90 * 1000) });
  await settle(150);
  check('made prominent, it is drawn over the player as well', !!big());
  check('and it is the same deadline, not a new one',
        /^(5:00|4:59)$/.test(big()?.querySelector('strong')?.textContent?.trim() || ''),
        big()?.textContent);
  /* It floats over the bottom of the player, which is where the Check button is. */
  check('and it takes no clicks', big()?.className.includes('ltbig'));

  // Paused carries what is LEFT rather than a deadline: a paused timer has no deadline.
  timing({ seconds: 300, left: 154, running: false, prominent: true, now: wrong(90 * 1000) });
  await settle(150);
  check('pausing stops the clock where it stood', chip() === '2:34', chip());
  check('and says so, because a stopped clock is also what a broken one looks like',
        /paused/i.test(document.querySelector('.ltchip')?.textContent || ''));

  // And out. Zero is arithmetic on every screen at once; nothing is sent when it happens.
  timing({ seconds: 300, ends: wrong(90 * 1000 - 1000), running: true, prominent: true,
           now: wrong(90 * 1000) });
  await settle(150);
  check('a countdown that has run out says nought rather than counting past it',
        chip() === '0:00', chip());
  check('and the room is told in words', /Time.s up/i.test(big()?.textContent || ''),
        big()?.textContent);

  const before = at();
  timing(null);
  await settle(150);
  check('taking it away takes it off every screen', !chip() && !big());
  check('and none of it ever moved anybody - a clock is not a place',
        at() === before, `${at()} was ${before}`);
}

// -------------------------------- the room and the chat, and who gets the room
/* THE PANEL HOLDS TWO THINGS AND THE READER DECIDES THE RATIO. What is worth asserting
 * here is not the number - jsdom does no layout and cannot tell you a pixel - but that both
 * halves are still mounted inside one divider, and that the divider folds away rather than
 * leaving a handle with nothing on the other side of it. Two panes that collapse to nothing
 * is exactly the failure this kind of change makes, and it is invisible to reading.
 */
{
  // Collapsed by default for a student, which is the panel's own rule. The rail is the way in.
  document.querySelector('.roomrail .railbtn')?.click();
  await settle(150);
  const panel = () => document.querySelector('.roompanel');
  const handle = () => panel()?.querySelector('.splitpane.column > .handle');
  check('the panel opens from the rail', !!panel());
  check('and holds the roster and the chat in one divider',
        !!panel()?.querySelector('.people') && !!panel()?.querySelector('.livechat'));
  check('which is a divider somebody can actually take hold of',
        handle()?.getAttribute('role') === 'separator'
        && handle()?.getAttribute('aria-orientation') === 'horizontal',
        handle()?.outerHTML?.slice(0, 120));
  /* A PERCENTAGE, NOT PIXELS - it has to survive a laptop being plugged into a monitor. This
   * also proves the pane is being apportioned at all rather than sized by its own content,
   * which is what a collapsed pane looks like from here. */
  check('and it apportions the panel rather than letting each half size itself',
        /%/.test(panel()?.querySelector('.pane.a')?.style?.flex || ''),
        panel()?.querySelector('.pane.a')?.style?.flex);

  // Popped out, there is one pane and nothing to drag: a handle with nothing beyond it is a
  // control that does nothing.
  panel()?.querySelector('.livechat .shut')?.click();
  await settle(150);
  check('popping the chat out takes the divider with it', !handle());
  check('and the roster keeps the whole panel', !!panel()?.querySelector('.people'));
  check('while the chat is still on screen, floating',
        !!document.querySelector('.livechat.float'));
}

// ------------------------------------------ the educator points at a control
/* LOOK HERE, from the side that receives one.
 *
 * WHAT IS ASSERTED HERE IS THE WIRING, and the arithmetic that decides whether to draw is
 * asserted in test/pointer.mjs instead - deliberately, because jsdom does no layout and
 * `getBoundingClientRect` returns zeros, so "is this control visible" answered against a DOM
 * would be answered by accident. That is also why the one element under test is lent a box
 * below: this file can prove the message reaches a screen and takes an arrow with it, and
 * cannot prove anything about where the arrow lands.
 *
 * THE ASSERTION THAT MATTERS IS THE LAST BUT ONE. An instruction for a row this client is not
 * on must draw NOTHING - a student two exercises ahead has a different Check button in front
 * of them, and ringing it says something the educator did not say.
 */
{
  const arrow = () => document.querySelector('.lookhere');
  const ring = () => document.querySelector('.lookhere .lookring');
  const look = (at, where) => player.emitLocal({
    type: 'looking', at, where, when: new Date().toISOString(),
  });

  /* Contents, because it is the one named control on screen whose press is inert - it opens
   * a list. Pressing Check here would reach for a database that is stubbed out. */
  const contents = document.querySelector('[data-show="contents"]');
  check('the sidebar\'s Contents button carries a name to be pointed at', !!contents);
  if (contents) {
    contents.getBoundingClientRect = () => ({ left: 24, top: 180, width: 180, height: 34,
                                              right: 204, bottom: 214, x: 24, y: 180 });
  }

  /* `where` unset is an educator who has not reported a position - the first seconds of a
   * lesson, and an older sender - and both mean draw. */
  look('contents', null);
  await settle(200);
  check('a control the educator points at is drawn on the class\'s screen', !!arrow());
  check('and it is a ring round a box, not a decoration in a corner',
        /width: 188px/.test(ring()?.getAttribute('style') || ''), ring()?.getAttribute('style'));
  /* Said in words as well, because a ring is invisible to a screen reader - and the word is
   * THIS screen's own, not one that travelled: the same name is Contents in an open sidebar
   * and the menu in a collapsed one. */
  check('and it is said in words for anyone who cannot see a ring',
        /pointing at Contents/i.test(arrow()?.textContent || ''), arrow()?.textContent);

  /* ANSWERED BY DOING THE THING. Cleared on this screen alone - `.btn.urge`'s rule, that
   * whoever sets a nudge owns clearing it, and a student who has already done it is being
   * nagged. */
  contents?.click();
  await settle(200);
  check('pressing the thing being pointed at takes the arrow away', !arrow());
  document.querySelector('.scrim .btn')?.click();
  await settle(150);

  look('nosuchthing', null);
  await settle(200);
  check('a name this screen has nothing for draws nothing', !arrow(),
        'it declines rather than guessing where a control that is not here would have been');

  look('contents', null);
  await settle(200);
  check('and an ordinary instruction is drawn again', !!arrow());

  look('contents', 'somewhere-else');
  await settle(200);
  check('AN INSTRUCTION FOR ANOTHER ROW IS DRAWN NOWHERE', !arrow(),
        'a student who has gone ahead has a different screen in front of them');
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
  const CHANNEL = 'Course One \u2014 1.1 Topic One - Slidev - drawings';
  const drawn = (data, seq) =>
    player.emitLocal({ type: 'decked', channel: CHANNEL, data, origin: 'tab-e', seq });
  const last = () => got.filter(m => m?.kind === 'ice:deck-sync').pop()?.data?.['3'];

  drawn({ 3: '<path d="M10 10 L90 90"/>' });
  await settle(200);
  check("an educator's annotation reaches the deck on screen",
        got.some(m => m?.kind === 'ice:deck-sync' && m.data?.['3']),
        JSON.stringify(got).slice(0, 200));

  /* AND IN THE SHAPE IT ACTUALLY TRAVELS IN. A patch is a delta now - `keep` pieces of what
   * you hold, then these - because a whole slide on every frame is what grew past the cap
   * and froze a lesson mid-word. This is the only place that path runs end to end: a real
   * frame, real svgclean, and the reassembly in between. What crosses has to be the WHOLE
   * slide, because Slidev hands it to drauu's `load()`, which replaces. */
  got.length = 0;
  drawn({ 3: { keep: 0, add: ['<path d="M1 1"/>'], full: true } }, 1);
  await settle(120);
  drawn({ 3: { keep: 1, add: ['<path d="M2 2"/>'] } }, 2);
  await settle(200);
  check('a delta arrives as the whole slide, not as the stroke it carried',
        /M1 1/.test(last() || '') && /M2 2/.test(last() || ''), String(last()).slice(0, 160));

  /* A delta that does not fit is declined rather than forced - and declining must leave what
   * is on screen alone rather than blanking it. */
  got.length = 0;
  drawn({ 3: { keep: 9, add: ['<path d="M3 3"/>'] } }, 3);
  await settle(200);
  check('and one that does not fit what is held reaches the deck not at all',
        !got.some(m => m?.kind === 'ice:deck-sync'), JSON.stringify(got).slice(0, 160));

  /* ---- A PATCH TOO BIG FOR ONE FRAME ------------------------------------------
   *
   * API Gateway closes a connection that sends a frame over 32KB, and a browser sends each
   * message as one frame. The snapshot of every annotated slide crossed that within a few
   * handwritten words, and cut the educator's socket after every stroke. So a big patch goes
   * in parts, the Lambda relays each as `of: 'decked'`, and live.js puts them back together
   * before anything above it looks - in whatever order they arrive. */
  got.length = 0;
  const big = Array.from({ length: 6 }, (_, i) =>
    `<path d="M${100 + i} 1 ${'C 2 2 3 3 4 4 '.repeat(500)}"/>`);
  const inner = { channel: CHANNEL, to: 'room', origin: 'tab-e', seq: 4,
                  data: { 3: { keep: 0, add: big, full: true } } };
  const parts = player.split(JSON.stringify({ type: 'deck', ...inner }),
                             { type: 'part', of: 'decked', to: 'room' }, 'tab-e-1');
  for (const p of [...parts].reverse()) player.emitLocal(p);
  await settle(250);
  check('a patch too big for one frame arrives in parts, out of order, and reaches the deck whole',
        parts.length > 1 && /M100 1/.test(last() || '') && /M105 1/.test(last() || ''),
        `${parts.length} parts; ${String(last()).slice(0, 80)}`);

  /* AND THE SENDING HALF: nothing that leaves this tab is over one frame. */
  player.outbox.on = true;
  player.outbox.sent.length = 0;
  player.send('deck', { ...inner, seq: 5 });
  const wire = player.outbox.sent.map(m => new TextEncoder().encode(JSON.stringify(m)).length);
  check('a big deck patch leaves as parts, every one under the frame',
        player.outbox.sent.length > 1 && player.outbox.sent.every(m => m.type === 'part')
        && wire.every(n => n <= 28 * 1024), JSON.stringify(wire));
  player.outbox.sent.length = 0;
  player.send('push', { at: '101', code: 'y'.repeat(40_000) });
  check('any other message that big is refused rather than sent to cut the connection',
        player.outbox.sent.length === 0, JSON.stringify(player.outbox.sent).slice(0, 80));
  player.delivery.pushEditor('101', 'x'.repeat(60_000), 0, null, 0);
  check("an editor's text is capped where it is sent, at the Lambda's own limit",
        player.outbox.sent.length === 1 && player.outbox.sent[0].code.length === 20_000,
        `${player.outbox.sent[0]?.code?.length}`);
  player.outbox.on = false;
  player.outbox.sent.length = 0;
}

// ------------------------------------------------------------- where Python comes from
/* NOT A CDN, AND ABSOLUTE. Two separate properties, and the second one shipped broken.
 *
 * Pyodide resolves every wheel with `new URL(file_name, packageBaseUrl)`, and a relative base
 * makes that throw `Invalid URL` - so the runtime boots perfectly and then no package loads
 * at all. What that looks like from the outside is Python starting and immediately saying
 * "No module named micropip", which names nothing anybody could search for.
 *
 * It only breaks in a BROWSER. `initializeConfiguration` puts `indexURL` through its own
 * resolver and `packageBaseUrl` through nothing, so the fault is invisible in Node, where the
 * base is an absolute filesystem path - which is exactly how it got past a smoke test that
 * booted the real interpreter against the real files and loaded micropip successfully.
 *
 * So this asserts the one thing that test could not: the shape of the URL the browser gets.
 */
{
  const opts = player.pyodideOptions();
  check('Python is fetched from our own origin, never a CDN',
        !/cdn\.|jsdelivr|unpkg/.test(opts.indexURL + opts.packageBaseUrl), JSON.stringify(opts));
  check('and the index URL is ABSOLUTE',
        /^https?:\/\//.test(opts.indexURL), opts.indexURL);
  /* The exact call Pyodide makes for every wheel in the lock file. */
  let resolved = null;
  try { resolved = new URL('micropip-0.11.1-py3-none-any.whl', opts.packageBaseUrl).href; }
  catch (e) { resolved = `THREW ${e.message}`; }
  check('so a wheel resolves against it rather than throwing Invalid URL',
        resolved.startsWith('http') && resolved.endsWith('.whl'), resolved);
  check('and it names the version the app was built against',
        opts.indexURL.includes('/pyodide/'), opts.indexURL);
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

  /* AND THE CLASS IS TOLD WHEN THE LIST CHANGES. The paperclip is read when a course opens
   * and when the lesson changes - deliberately, so drawing one on every row costs no round
   * trip - which left exactly one gap: a board kept in the middle of the lesson it was drawn
   * in. A student had to reload the page to see it, at the moment it is most worth seeing.
   *
   * Driven by changing what the stand-in will answer NEXT and then sending the nudge, which
   * is the only way to tell a re-read from a list that was never going to change. */
  await player.previewApi('boards?cohort=sept-2026&topic=x&board=pv-board-2', { method: 'DELETE' });
  player.emitLocal({ type: 'kept', course: 'c1', topic: '1.1.1' });
  await settle(250);
  const after = document.querySelector('.slidestep .boardclip button');
  after?.click();
  await settle(120);
  check('a board filed mid-lesson reaches the class without a reload',
        [...document.querySelectorAll('.clipmenu button')].length === 1
          || !document.querySelector('.clipmenu'),
        `${document.querySelectorAll('.clipmenu button').length} still listed`);
}

await player.dispose();
dom.restore();
console.log(failures ? `\n${failures} failing` : '\nall green');
process.exit(failures ? 1 : 0);
