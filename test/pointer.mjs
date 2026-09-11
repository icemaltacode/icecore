/* The pointer translation, against two screens that are nothing like each other.
 *
 * This is the file that earns the design. The obvious way to share a cursor is to send
 * `x / innerWidth` and multiply back at the other end, and the reason that is wrong HERE is
 * not a matter of taste: the shell is fixed pixels either side of a fluid middle, so the
 * sidebar is a fifth of a laptop's width and a tenth of a large monitor's. The first test
 * below measures exactly that error, so the argument is a number rather than an opinion.
 *
 * No jsdom. `getBoundingClientRect` returns zeros there, which would make every assertion
 * here trivially true - so the screens are hand-built objects with real boxes on them, which
 * is all `pointer.js` ever asks for. Same reason `walk.mjs` and `csv.mjs` import their
 * modules directly: the thing under test is pure, and a DOM would be a test of the DOM.
 */
import { pointFrom, placeAt, showing, meantForMe } from '../app/src/pointer.js';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `  -- ${detail}` : ''}`);
  if (!ok) failures++;
};

/**
 * A screen laid out the way the shell actually is: 272px of sidebar and 336px of room, both
 * FIXED, with everything else sharing what is left. The stage is split between a prompt and
 * an editor in the same 34/66 the exercise uses.
 */
function screen(width, height = 900) {
  const stageLeft = 272;
  const stageWidth = width - 272 - 336;
  const promptWidth = Math.max(320, stageWidth * 0.34);
  const rect = (left, w) => ({ left, top: 0, width: w, height, right: left + w, bottom: height });
  const regions = {
    stage: rect(stageLeft, stageWidth),
    prompt: rect(stageLeft, promptWidth),
    editor: rect(stageLeft + promptWidth, stageWidth - promptWidth),
  };
  const el = name => ({
    dataset: { point: name },
    getBoundingClientRect: () => regions[name],
    closest: sel => (sel === '[data-point]' ? el(name) : null),
  });
  return {
    width,
    regions,
    doc: {
      // The innermost region containing the point, which is what elementFromPoint gives.
      elementFromPoint(x) {
        for (const name of ['prompt', 'editor']) {
          const r = regions[name];
          if (x >= r.left && x <= r.right) return el(name);
        }
        const s = regions.stage;
        return x >= s.left && x <= s.right ? el('stage') : null;
      },
      querySelector(sel) {
        const name = /\[data-point="(.+)"\]/.exec(sel)?.[1];
        return name && regions[name] ? el(name) : null;
      },
    },
  };
}

const wide = screen(2560);
const laptop = screen(1280);

// ------------------------------------------------ what a viewport ratio would do
/* THE ERROR, MEASURED. An educator on a 2560 screen puts their pointer just inside the left
 * edge of their editor. Scaled by viewport fraction onto a 1280 screen it lands hundreds of
 * pixels away - and on the wrong side of a boundary, which is the part that matters: it is
 * not a near miss, it is a different pane. */
{
  const x = wide.regions.editor.left + 4;
  const naive = (x / wide.width) * laptop.width;
  const target = laptop.regions.editor;
  check('a viewport ratio lands outside the pane it started in',
        naive < target.left,
        `${Math.round(naive)}px against an editor starting at ${Math.round(target.left)}px`);
  check('and it is not a rounding error', target.left - naive > 100,
        `off by ${Math.round(target.left - naive)}px`);
}

// ------------------------------------------------------- what a region does instead
const roundTrip = (from, to, x, y = 450) => {
  const p = pointFrom(x, y, from.doc);
  return { p, at: p && placeAt(p, to.doc) };
};

{
  const { p, at } = roundTrip(wide, laptop, wide.regions.editor.left + 4);
  check('a point names the pane it is over', p?.region === 'editor', JSON.stringify(p));
  const t = laptop.regions.editor;
  check('and arrives inside that pane on a different screen',
        at.left >= t.left && at.left <= t.right,
        `${Math.round(at.left)} not within ${Math.round(t.left)}..${Math.round(t.right)}`);
}

{
  /* The far edge of a pane is the far edge of that pane on any screen, whatever it is
   * next to. A fraction is a fraction of the thing, not of the window. */
  const src = wide.regions.prompt;
  const { p, at } = roundTrip(wide, laptop, src.left + src.width / 2);
  const t = laptop.regions.prompt;
  check('the middle of a pane is the middle of that pane over there',
        p.region === 'prompt' && Math.abs((at.left - t.left) / t.width - 0.5) < 0.001,
        `${JSON.stringify(p)} -> ${Math.round(at.left)}`);
}

// --------------------------------------------- a pane the other screen does not have
/* THE HONEST FAILURE, and the reason a region beats a coordinate. A student who has closed
 * something the educator has open simply does not have that box, and this SAYS SO rather
 * than guessing - a cursor drawn approximately in the right place is trusted, and a cursor
 * trusted in the wrong place is worse than none. */
{
  const bare = screen(1280);
  delete bare.regions.editor;
  const p = pointFrom(wide.regions.editor.left + 4, 450, wide.doc);
  check('a region the other screen has not got draws nothing',
        placeAt(p, bare.doc) === null, JSON.stringify(placeAt(p, bare.doc)));
}

// ------------------------------------------------------------------- the edges
{
  const r = wide.regions.editor;
  const p = pointFrom(r.right + 40, 450, wide.doc);
  check('past every region is nothing to send', p === null, JSON.stringify(p));
  /* On a boundary the two panes share, which of them claims it is the browser's business -
   * `elementFromPoint` picks one and either is right. What has to hold is that a pointer on
   * an edge is INSIDE a pane rather than over nothing, and that the fraction is clamped to
   * the ends rather than rounding a pixel outside. */
  const on = pointFrom(r.left, 450, wide.doc);
  check('the very edge of a pane is still inside a pane',
        ['prompt', 'editor'].includes(on?.region) && (on.x === 0 || on.x === 1),
        JSON.stringify(on));
  check('the pointer having gone places nowhere', placeAt(null, laptop.doc) === null);
  check('and neither does a point with no region',
        placeAt({ region: null, x: 0.5, y: 0.5 }, laptop.doc) === null);
}

/* ---- and the other half: which CONTROL, not which pixel -----------------------
 *
 * Two rules, and both of them fail QUIETLY rather than loudly, which is why they are here
 * rather than left to a browser.
 *
 * A NAME MAY SIT ON MORE THAN ONE ELEMENT, because the affordance itself moves when a pane
 * collapses - Contents is a button in an open sidebar and a menu button in a rail - so which
 * one is decided by which has a box. jsdom returns zeros for every box, so a test of this
 * written against a DOM would pass without ever deciding anything.
 *
 * AND AN EXERCISE ID IS A NUMBER THAT ARRIVES FROM A SOCKET AS A STRING. Get that comparison
 * wrong and every instruction is declined on a screen that is on exactly the right row: the
 * feature never works at all, and nothing anywhere says why.
 */
function screenWith(boxes) {
  const els = Object.entries(boxes).map(([key, box]) => ({
    dataset: { show: key.replace(/#.*$/, ''), label: key },
    getBoundingClientRect: () => box,
  }));
  return {
    querySelectorAll: sel => {
      const want = /\[data-show="([^"]+)"\]/.exec(sel)?.[1];
      return els.filter(e => e.dataset.show === want);
    },
  };
}

const laidOut = { left: 10, top: 10, width: 90, height: 30, right: 100, bottom: 40 };
const collapsed = { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 };

{
  const doc = screenWith({ 'contents#sidebar': collapsed, 'contents#rail': laidOut });
  check('a name on two elements resolves to the one with a box',
        showing('contents', doc)?.dataset.label === 'contents#rail',
        showing('contents', doc)?.dataset.label);
  check('and a name with nothing laid out resolves to nothing',
        showing('check', doc) === null);
}
{
  /* The same guard `placeAt` has and for the same reason: the name ends up inside an
     attribute selector, and it arrived off a socket. */
  const doc = screenWith({ contents: laidOut });
  check('a name that is not one of ours is not looked up at all',
        showing('a"]:has(script)', doc) === null);
  check('and neither is nothing at all',
        showing('', doc) === null && showing(null, doc) === null);
}

check('an instruction for the row we are on is drawn', meantForMe(101, 101) === true);
check('AND A NUMBER MATCHES THE STRING IT ARRIVED AS', meantForMe('101', 101) === true,
      'a sort key is text and a socket carries text - progressId exists for this');
check('and the other way round', meantForMe(101, '101') === true);
check('an instruction for another row is drawn nowhere', meantForMe(101, 102) === false);
/* Not a refusal: the first seconds of a lesson, before anybody has reported a position, and
   an older sender that never carried the field. Declining would be a guess the other way. */
check('an educator who has not said where they are reaches everybody',
      meantForMe(null, 101) === true && meantForMe(undefined, 101) === true);
check('but a reader who is nowhere yet is not reached by a placed instruction',
      meantForMe(101, null) === false);

console.log(failures ? `\n${failures} failing` : '\nall green');
process.exit(failures ? 1 : 0);
