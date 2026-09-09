/* THE ADMIN AREA, MOUNTED. Nothing in this repo had ever executed it.
 *
 * WHY IT IS ITS OWN FILE rather than a block in player.mjs: the role is a BUILD flag.
 * `previewRole()` is compiled in through `VITE_ICECORE_PREVIEW`, so a student player and an
 * admin one are two builds, and one process can only be one of them at a time.
 *
 * WHAT IT ASSERTS IS WHAT AN ADMIN SEES - the words in the People table - for the reason
 * player.mjs gives: reaching into refs would test the implementation and would pass with the
 * screen blank. The stand-in behind it is `preview.js`, which is the same stand-in
 * `icecore dev --as admin` throws, so a test that invented its own fiction would be a test
 * of the fiction.
 */
import { installDom } from './dom.mjs';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `  -- ${detail}` : ''}`);
  if (!ok) failures++;
};

const dom = installDom({ hash: '#/admin/people', search: '?course=c1' });
dom.serve('/content/courses.json', [{ id: 'c1', title: 'Course One', exercises: 3, xp: 60 }]);
dom.serve('/content/c1/index.json', {
  id: 'c1', title: 'Course One',
  modules: [{ module: '1', title: 'M', units: [{ unit: '1.1', title: 'U', topics: [
    { topic: '1.1.1', title: 'Topic One',
      exercises: [{ id: 101, title: 'First', type: 'coding', xp: 20, prompt: 'p',
                    steps: [{ sample: 'SELECT 1' }] }] }] }] }],
});

const { createApp } = await import('vue');
const { buildPlayer } = await import('./harness.mjs');
const player = await buildPlayer({ preview: 'admin' });

const app = createApp(player.App);
app.config.errorHandler = (err, _i, info) => {
  failures++;
  console.log(`FAIL  the app threw during ${info}  -- ${err?.stack || err}`);
};
const host = document.createElement('div');
document.body.append(host);
app.mount(host);

const settle = (ms = 260) => new Promise(r => setTimeout(r, ms));
await settle(600);

const text = () => document.body.textContent.replace(/\s+/g, ' ').trim();
/** One person's row, by the name in it. */
const rowFor = name => [...document.querySelectorAll('tbody tr')]
  .find(tr => tr.textContent.includes(name));

check('the admin area draws the People table', !!rowFor('Ada Lovelace'), text().slice(0, 200));
check('and it has a Last seen column', /Last seen/.test(text()), text().slice(0, 300));

// --------------------------------------------------------------- connected now
/* TWO FACTS, SAID SEPARATELY, and this is the pair that must not collapse into one. `online`
 * is only ever true while there is a lesson to be connected TO, so a screen that carried it
 * alone would show every dot dark every evening and read as broken; `seen` is what the row
 * says the rest of the time. */
const katherine = rowFor('Katherine Johnson');
check('somebody connected right now is marked', !!katherine?.querySelector('.dot.live'),
      katherine?.innerHTML.slice(0, 160));
check('and the row says so in words as well as in a colour',
      /In the lesson/.test(katherine?.textContent || ''), katherine?.textContent);

const ada = rowFor('Ada Lovelace');
check('somebody who is not connected gets a dot that is not lit',
      !!ada?.querySelector('.dot') && !ada.querySelector('.dot.live'), ada?.innerHTML.slice(0, 160));
/* THE DOT IS DRAWN FOR EVERYBODY, not only for the people who are on. A mark that appears
 * and disappears makes every name jump sideways the moment somebody connects, and a dot that
 * is only ever present when lit is a decoration rather than a state. */
check('so the column keeps its shape whether or not a lesson is running',
      document.querySelectorAll('tbody .dot').length
        === document.querySelectorAll('tbody tr').length,
      `${document.querySelectorAll('tbody .dot').length} dots for `
        + `${document.querySelectorAll('tbody tr').length} rows`);

// ------------------------------------------------------------------- last seen
check('somebody who was working recently is timed rather than dotted',
      /\d+ (min|hour)s? ago/.test(ada?.textContent || ''), ada?.textContent);

/* NEVER IS AN EM DASH AND NOT THE WORD "never". The Status column already says "Invited" for
 * somebody who has not opened their account, and saying it twice in two columns reads as two
 * different facts about them rather than one. */
const grace = rowFor('Grace Hopper');
check('an unopened invitation is said once, in the Status column',
      /Invited/.test(grace?.textContent || '') && !/never/i.test(grace?.textContent || ''),
      grace?.textContent);
check('and its Last seen cell is blank rather than a claim',
      !!grace?.querySelector('.seen.dim'), grace?.innerHTML.slice(0, 240));

// --------------------------------------------------------------- and filtering
/* A FILTER FOR IT, because the question "who is actually in my lesson" is asked of a list
 * that may be hundreds long - and the dot is only findable by eye. */
const filterSelect = [...document.querySelectorAll('select')]
  .find(s => [...s.options].some(o => o.value === '!online'));
check('the list can be filtered to whoever is in a lesson', !!filterSelect,
      [...document.querySelectorAll('select')].map(s => s.name || s.className).join(','));
if (filterSelect) {
  filterSelect.value = '!online';
  filterSelect.dispatchEvent(new window.Event('change'));
  await settle(200);
  check('and filtering leaves exactly the people who are',
        !!rowFor('Katherine Johnson') && !rowFor('Ada Lovelace'),
        `${document.querySelectorAll('tbody tr').length} rows left`);
}

app.unmount();
dom.restore();
console.log(failures ? `\n${failures} failing` : '\nall green');
process.exit(failures ? 1 : 0);
