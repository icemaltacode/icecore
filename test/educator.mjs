/* THE EDUCATOR'S SIDE OF A LIVE LESSON, mounted: the Share editor button and what the tab sends.
 *
 * WHY IT IS ITS OWN FILE: the role is a build flag (see admin.mjs), and player.mjs is a student.
 * Everything here is what the DELIVERING tab does, which a student build cannot reach.
 *
 * WHAT IT READS IS THE OUTBOX - every message `send` would have put on the wire - and the band's
 * own words. Preview has no socket, so its echo stands in for the room's answer, and
 * `previewHold` withholds that echo to make "the room did not answer" something a test can be
 * in. LIVE-RELIABILITY.md, Phase 3, steps 11 and 13.
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
        /* A dataset, and the tables the build would have read out of it, so the editor has
         * something to complete - see the end of this file. */
        { id: 101, title: 'First', type: 'coding', xp: 20, prompt: 'p', dataset: 'shop',
          steps: [{ sample: 'SELECT 1' }] },
        { id: 102, title: 'Second', type: 'coding', xp: 20, prompt: 'p', steps: [{ sample: 'SELECT 2' }] },
      ] },
  ] }] }],
  schemas: { shop: { shop: ['id', 'city'], orders: ['id', 'shop_id', 'total'] } },
};

const dom = installDom({ hash: '#/', search: '?course=c1' });
dom.serve('/content/courses.json', [{ id: 'c1', title: 'Course One', exercises: 2, xp: 40 }]);
dom.serve('/content/c1/index.json', COURSE);
dom.serve('/content/c1/data/shop.sql', 'CREATE TABLE shop (id int, city text);');

const { createApp } = await import('vue');
const { buildPlayer } = await import('./harness.mjs');
const player = await buildPlayer({ preview: 'admin' });

const app = createApp(player.App);
app.config.errorHandler = (err, _vm, info) => {
  check(`the app threw during "${info}"`, false, String(err?.stack || err).split('\n')[0]);
};
const host = document.createElement('div');
document.body.append(host);
app.mount(host);

const settle = (ms = 150) => new Promise(r => setTimeout(r, ms));
const text = () => document.body.textContent.replace(/\s+/g, ' ').trim();
const at = () => (text().match(/(\d+) \/ (\d+)/) || [])[0] || '(nowhere)';
const band = () => document.querySelector('.band');
const shareButton = () => [...document.querySelectorAll('button.sync')]
  .find(b => /editor|Starting|Stopping/.test(b.textContent));
const label = () => shareButton()?.textContent.trim() || '(no button)';
const press = () => shareButton()?.click();
const out = type => player.outbox.sent.filter(m => m.type === type);
const footer = re => [...document.querySelectorAll('footer button')].find(b => re.test(b.textContent));

await settle(400);

// ---------------------------------------------------------------- delivering
/* Started the way the Live button starts one: the session, then the live route. */
const COHORT = 'sept-2026-evening';
await player.delivery.start(COHORT, 'c1');
location.hash = `#/live/${COHORT}`;
dispatchEvent(new window.Event('hashchange'));
await settle(500);
// The preview's scripted room would move things underneath the test.
player.stopPreviewRoom();

check('the educator is delivering', /Delivering live/.test(text()), text().slice(0, 160));
check('with a Share editor button', label() === 'Share editor', label());

// Onto the first exercise, which has an editor.
footer(/Next/)?.click();
await settle(300);
check('the educator is on an exercise', at() === '2 / 3', at());

player.outbox.on = true;
player.outbox.sent.length = 0;

/* ---- the state, not only the changes ---------------------------------------
 *
 * Share pressed on code that is already there used to show the class nothing until the next
 * keystroke. Measured in real browsers: never, three presses out of three.
 */
press();
await settle(250);
check('pressing Share asks the room to switch on', out('sync').some(m => m.on === true),
      JSON.stringify(player.outbox.sent).slice(0, 200));
check('and once it is on, what is in the editor goes at once, with nothing typed',
      out('push').length >= 1 && out('push')[0].code === 'SELECT 1',
      JSON.stringify(out('push')).slice(0, 200));
check('the push says which tab sent it and how far along it is',
      typeof out('push')[0]?.origin === 'string' && Number.isInteger(out('push')[0]?.seq),
      JSON.stringify(out('push')[0]));
check('and the button says it is sharing', label() === 'Sharing editor', label());

{
  const before = out('push').length;
  await settle(2700);
  check('two seconds with nothing typed sends it again', out('push').length > before,
        `${out('push').length} pushes, was ${before}`);
  const seqs = out('push').map(m => m.seq);
  check('each numbered above the last', seqs.every((n, i) => i === 0 || n > seqs[i - 1]),
        JSON.stringify(seqs));
}

press();
await settle(200);
check('pressing it again switches it off', label() === 'Share editor', label());
player.outbox.sent.length = 0;
await settle(2700);
check('after which nothing more is sent', out('push').length === 0,
      JSON.stringify(out('push')).slice(0, 200));

/* ON A SLIDES ROW THE BUFFER IN HAND BELONGS TO SOMEWHERE ELSE, and must not be sent onto it. */
footer(/Previous/)?.click();
await settle(300);
check('back on the slides', at() === '1 / 3', at());
press();
await settle(200);
player.outbox.sent.length = 0;
await settle(2700);
check('sharing on a slides row sends no editor at all', out('push').length === 0,
      JSON.stringify(out('push')).slice(0, 200));
press();
await settle(200);
check('and it switches off again', label() === 'Share editor', label());

/* ---- a button that answers -------------------------------------------------
 *
 * The switch reads the room's flag back rather than setting it, and when the answer was lost it
 * never moved: "I press Share editor and nothing happens". It now says what it asked for and
 * that it is waiting, asks again, and says so when the room does not answer.
 */
player.previewHold.sync = true;
player.outbox.sent.length = 0;
press();
await settle(100);
check('with no answer yet, the button says it is starting', label() === 'Starting…', label());
check('asked once so far', out('sync').length === 1, JSON.stringify(out('sync')));
await settle(1600);
check('and a second and a half later it asks again', out('sync').length === 2,
      JSON.stringify(out('sync')));
player.emitLocal({ type: 'syncing', on: true });
await settle(100);
check('when the room answers, it says it is sharing', label() === 'Sharing editor', label());
{
  const n = out('sync').length;
  await settle(1700);
  check('and stops asking', out('sync').length === n, `${out('sync').length} asks, was ${n}`);
}

/* A SECOND PRESS BEFORE THE ANSWER REVERSES THE FIRST. It acts on what the button is SHOWING,
 * which is what the educator is looking at when they press it. */
press();
await settle(100);
check('pressed while sharing, it says it is stopping', label() === 'Stopping…', label());
press();
await settle(100);
check('pressed again before the answer, it goes back to starting', label() === 'Starting…',
      label());
check('and what it asks for last is to share', out('sync').at(-1)?.on === true,
      JSON.stringify(out('sync').at(-1)));
player.emitLocal({ type: 'syncing', on: true });
await settle(100);
check('which the room confirms', label() === 'Sharing editor', label());

/* NOBODY ANSWERS AT ALL. */
const asksBefore = out('sync').length;
press();
await settle(6500);
check('after four unanswered asks the band says the class did not answer',
      /did not answer/.test(band()?.textContent || '') && band()?.classList.contains('stuck'),
      band()?.textContent?.slice(0, 200));
check('and the button goes back to what the room last said', label() === 'Sharing editor',
      label());
check('having asked four times and then stopped', out('sync').length - asksBefore === 4,
      JSON.stringify(out('sync').slice(asksBefore)));

player.previewHold.sync = false;
press();
await settle(150);
check('pressing again, with the room answering, gets through', label() === 'Share editor',
      label());
check('and the warning goes', !/did not answer/.test(band()?.textContent || ''),
      band()?.textContent?.slice(0, 200));

/* ---- and after a reconnection, BOTH ways ------------------------------------
 *
 * The roster put sharing back ON after a reconnection and never OFF: a Stop pressed while the
 * socket was down was lost, and the room went on being shown the editor.
 */
player.previewHold.sync = true;
player.outbox.sent.length = 0;
player.emitLocal({ type: 'roster', members: [], here: [], sync: true });
await settle(150);
check('a roster saying it is on, after this tab switched it off, asks for off again',
      out('sync').some(m => m.on === false), JSON.stringify(out('sync')));
check('and the button says it is stopping', label() === 'Stopping…', label());
player.emitLocal({ type: 'syncing', on: false });
await settle(100);
check('until the room confirms it', label() === 'Share editor', label());
player.previewHold.sync = false;

/* ---- a roster every thirty seconds must not wipe what the educator is reading -------------
 *
 * A refusal to take control says why - somebody else is helping that student - and it is the
 * only place that is said. Setting control clears it, and a roster set control whether or not
 * anything had changed, so a light roster every thirty seconds would take the reason off the
 * screen before it had been read. */
player.emitLocal({ type: 'refused', what: 'control', why: 'Somebody else is helping them.' });
await settle(100);
const refusal = () => document.querySelector('.livegone')?.textContent || '';
check('a refusal to take control says why', /Somebody else is helping them/.test(refusal()),
      refusal());
player.emitLocal({ type: 'roster', light: true, control: null, sync: false, here: [] });
await settle(100);
check('and a roster that changes nothing leaves it on screen',
      /Somebody else is helping them/.test(refusal()), refusal());

/* ---- the timer's lengths ----------------------------------------------------
 *
 * The presets are what a room is actually given; anything else goes in three boxes, h : m : s,
 * where an empty box is a zero. What is asserted is what the button SENDS, and what the
 * popover says about the timer afterwards: 2:30 must not read back as the "3 min" preset it
 * rounds to.
 */
{
  const openTimer = async () => {
    if (!document.querySelector('.ltpop')) document.querySelector('.livetimer .ltbtn.more')?.click();
    await settle(120);
  };
  const presets = () => [...document.querySelectorAll('.ltmins .ltmin')];
  const box = name => document.querySelector(`.ltbox[aria-label="${name}"]`);
  const start = () => document.querySelector('.ltstart');
  const hint = () => document.querySelector('.ltbad')?.textContent.trim() || '';
  const fill = async (name, v) => {
    box(name).value = v;
    box(name).dispatchEvent(new window.Event('input'));
    await settle(40);
  };
  const enter = async ({ h = '', m = '', s = '' }) => {
    await fill('Hours', h); await fill('Minutes', m); await fill('Seconds', s);
  };
  const submit = async () => {
    start().closest('form').dispatchEvent(new window.Event('submit', { cancelable: true }));
    await settle(200);
  };

  await openTimer();
  check('the presets are the lengths a room is given',
        presets().map(b => parseInt(b.textContent, 10)).join(',') === '1,2,3,5,10,15',
        presets().map(b => b.textContent.trim()).join(','));
  check('the length is entered in hours, minutes and seconds',
        !!box('Hours') && !!box('Minutes') && !!box('Seconds'));

  check('nothing entered is not a length, and not an error either',
        start().disabled && !hint(), hint());
  await enter({ m: '75' });
  check('minutes past 59 are refused, and it says so',
        start().disabled && /59/.test(hint()), hint());
  await enter({ h: '3' });
  check('so is anything longer than the server will keep',
        start().disabled && /2 hours/.test(hint()), hint());

  await enter({});
  await fill('Minutes', 'a5');
  check('a box takes digits and nothing else', box('Minutes').value === '5', box('Minutes').value);

  await fill('Minutes', '15');
  check('a full box hands the caret on', document.activeElement === box('Seconds'),
        document.activeElement?.getAttribute('aria-label'));

  await enter({ m: '2', s: '30' });
  check('empty boxes are zeros, so 2 and 30 can be started', !start().disabled);
  player.outbox.sent.length = 0;
  await submit();
  const set = out('timer').at(-1);
  check('and the class is given exactly that', set?.do === 'set' && set?.seconds === 150,
        JSON.stringify(set));

  const reset = [...document.querySelectorAll('.livetimer .ltbtn')]
    .find(b => /again/.test(b.getAttribute('title') || ''));
  check('Reset offers the length that was set, not a rounding of it',
        reset?.getAttribute('title') === 'Start the 2:30 again', reset?.getAttribute('title'));
  await openTimer();
  check('and no preset claims to be the one running',
        !presets().some(b => b.classList.contains('on')),
        presets().filter(b => b.classList.contains('on')).map(b => b.textContent.trim()));
  check('the boxes are empty again for the next one',
        !box('Hours').value && !box('Minutes').value && !box('Seconds').value);

  await enter({ h: '1', m: '', s: '5' });
  await submit();
  check('hours count, and an empty minutes box is a zero',
        out('timer').at(-1)?.seconds === 3605, JSON.stringify(out('timer').at(-1)));
}

/* ---- completion ---------------------------------------------------------------
 *
 * The editor offers what exists: in SQL, the exercise's own tables and columns, which the
 * build reads out of the dataset once and the player hands to every exercise using it. A
 * mistyped column is the commonest way a SQL exercise is failed. Read from CodeMirror's own
 * state - what it is offering - rather than from a popup jsdom cannot lay out.
 */
{
  footer(/Next/)?.click();
  await settle(300);
  const view = player.EditorView.findFromDOM(document.querySelector('.cm-editor'));
  const offered = async text => {
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text },
                    selection: { anchor: text.length } });
    player.startCompletion(view);
    await settle(250);
    return player.currentCompletions(view.state).map(c => c.label);
  };
  const tables = await offered('SELECT * FROM ord');
  check("the exercise's own tables are offered", tables.includes('orders'), tables.join(', '));
  const columns = await offered('SELECT orders.');
  check('and their columns', ['id', 'shop_id', 'total'].every(c => columns.includes(c)),
        columns.join(', '));
  const keywords = await offered('SELECT * FROM orders WHE');
  check('keywords are offered in capitals, as the courses write them',
        keywords.includes('WHERE'), keywords.join(', '));
}

/* ---- the whiteboard, from the pen's side ------------------------------------------
 *
 * THE EDUCATOR'S TAB IS THE SOURCE OF THE DRAWING and the server only relays it. A page has no
 * ceiling on the wire: a stroke goes on its own however big the page, a whole page too big for
 * one frame goes in parts, and a student who asks is answered alone. It used to gate every
 * stroke on the size of the whole page, and stop at 24KB - a few handwritten words.
 */
{
  const sent = type => player.outbox.sent.filter(m => m.type === type);
  const pageParts = () => player.outbox.sent.filter(m => m.type === 'part' && m.of === 'page');
  const whole = parts => JSON.parse([...parts].sort((a, b) => a.n - b.n).map(p => p.chunk).join(''));
  const stroke = '<path d="M 5 5 L 9 9"/>';
  // Twice the old ceiling, and several times one frame.
  const heavy = '<path d="M 100 100 Q 101 101 102 102 Z"/>'.repeat(2000);

  player.outbox.on = true;
  player.outbox.sent.length = 0;
  player.emitLocal({ type: 'boarding', on: true, page: 0 });
  await settle(250);
  const opened = sent('page').at(-1);
  check('putting a board up sends its page, numbered',
        Number.isInteger(opened?.v) && typeof opened?.epoch === 'string', JSON.stringify(opened));

  player.outbox.sent.length = 0;
  player.commitStroke(stroke, heavy + stroke);
  const s1 = sent('stroke').at(-1);
  check('a stroke on a page far past the old 24KB still goes, on its own',
        s1?.node === stroke && s1.after === opened.v && s1.v > opened.v, JSON.stringify(s1));
  await settle(50);
  check('and nothing says the page is too big', !/too big/.test(text()), text().slice(-160));

  /* WET INK: the stroke still being drawn goes out while the pen is down, as a preview the
   * class draws over the page - and the finished stroke names it, so they drop the preview as
   * the stroke lands. Slide annotations always streamed; the board waited for the pen to lift. */
  player.outbox.sent.length = 0;
  player.inkStart();
  player.inkFrame('<path d="M 1 1 L 2 2"/>');
  player.inkFrame('<path d="M 1 1 L 2 2 L 3 3"/>');
  const frames = sent('ink');
  check('a stroke goes out while it is still being drawn, frame by frame, the whole stroke so far',
        frames.length === 2 && frames[1].node === '<path d="M 1 1 L 2 2 L 3 3"/>'
          && frames[1].n > frames[0].n && frames[0].s === frames[1].s
          && typeof frames[0].epoch === 'string' && frames[0].page === 0,
        JSON.stringify(frames));
  check('and carries no version, because it is not a change to the page',
        frames.every(f => !('v' in f) && !('after' in f)), JSON.stringify(frames[0]));
  player.commitStroke('<path d="M 1 1 L 3 3"/>', '<path d="M 1 1 L 3 3"/>');
  const finished = sent('stroke').at(-1);
  check('the finished stroke names the preview it replaces',
        finished?.s === frames[0].s && Number.isInteger(finished?.v), JSON.stringify(finished));

  player.outbox.sent.length = 0;
  player.inkStart();
  player.inkFrame('<line x1="1" y1="1" x2="2" y2="2"/>');
  player.inkCancel();
  const thrown = sent('ink');
  check('a stroke drauu throws away is said to be gone, so no preview hangs over the class',
        thrown.length === 2 && thrown[1].gone === true && thrown[1].s === thrown[0].s
          && thrown[0].s > frames[0].s, JSON.stringify(thrown));
  player.outbox.sent.length = 0;
  player.inkStart();
  player.inkCancel();
  check('and one thrown away before any of it was sent says nothing', sent('ink').length === 0,
        JSON.stringify(sent('ink')));

  player.outbox.sent.length = 0;
  player.commitPage(heavy);
  const parts = pageParts();
  check('a whole page too big for one frame goes in parts', parts.length > 1
        && whole(parts).svg === heavy && whole(parts).v > s1.v, `${parts.length} parts`);

  const undone = whole(parts).v;
  player.outbox.sent.length = 0;
  player.emitLocal({ type: 'pagewanted', sub: 'late-student' });
  await settle(80);
  const answer = pageParts();
  check('a student asking for the page is answered, and alone',
        answer.length > 1 && answer.every(p => p.to === 'late-student'), JSON.stringify(answer[0]));
  check('at the version it is already at, because asking changes nothing',
        whole(answer).v === undone, JSON.stringify({ v: whole(answer).v, undone }));

  player.outbox.sent.length = 0;
  const tooBig = '<path d="M 100 100 Q 101 101 102 102 Z"/>'.repeat(Math.ceil(player.KEEP_LIMIT / 30));
  player.commitPage(tooBig);
  await settle(80);
  check('a page too big to KEEP says so', /too big to keep/.test(text()), text().slice(-160));
  check('and still reaches the class', pageParts().length > 1);

  await settle(900);
  const stored = JSON.parse(sessionStorage.getItem(`ice-board:${COHORT}`) || 'null');
  check('the drawing is kept in the tab, so a reload does not lose it',
        stored?.pages?.[0] === tooBig, `${stored?.pages?.[0]?.length ?? 'nothing'} chars kept`);

  player.emitLocal({ type: 'boarding', on: false, page: 0 });
  await settle(120);
  check('and forgotten when the board is put away', !sessionStorage.getItem(`ice-board:${COHORT}`));
}

player.outbox.on = false;
player.outbox.sent.length = 0;
app.unmount();
dom.restore();
console.log(failures ? `\n${failures} failing` : '\nall green');
process.exit(failures ? 1 : 0);
