/* The order a student moves through a course.
 *
 * PURE, SO IT NEEDS NO HARNESS - `walk.js` is dependency-free by rule, like `compare.js` and
 * `dragdrop.js`, and this file is one of the things that keeps it that way: the day somebody
 * reaches for `import.meta.env` in there, this stops importing.
 *
 * Worth having because TWO COMPONENTS DRAW THIS WALK and disagreeing reads as exercises
 * going missing - `App.vue` moves through it and `ContentsModal.vue` lists it. And because
 * of the bug that prompted it: the slides row was built without the `deck` it needs, the
 * iframe's src composed to `/undefined#/12`, the SPA fallback answered that with index.html,
 * and the player rendered INSIDE ITSELF where the slides should have been. Nothing had ever
 * executed this function.
 */
import { walkTopic, walkCourse, gradable, slideId } from '../app/src/walk.js';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `  -- ${detail}` : ''}`);
  if (!ok) failures++;
};
const eq = (label, a, b) => check(label, JSON.stringify(a) === JSON.stringify(b),
  `${JSON.stringify(a)} != ${JSON.stringify(b)}`);

const ex = (id, title) => ({ id, title, type: 'coding', xp: 20 });
const withSlides = {
  topic: '1.1.1', title: 'Databases',
  slides: 'slides/c1/1.1/index.html', slide: 3, end: 9, slideCount: 31,
  exercises: [ex(101, 'First'), ex(102, 'Second')],
};
const noSlides = { topic: '1.1.2', title: 'Tables', exercises: [ex(103, 'Third')] };

// ------------------------------------------------------------------- one topic
{
  const rows = walkTopic(withSlides);
  eq('slides first, then the exercises that practise them',
     rows.map(r => r.kind), ['slides', 'exercise', 'exercise']);
  check('the slides row is namespaced so it cannot collide with an exercise id',
        rows[0].id === slideId('1.1.1') && rows[0].id === 'slides:1.1.1', rows[0].id);

  /* THE DECK RIDES ON THE ROW. It was looked up separately - find the topic this row belongs
   * to, read its `slides` - which is one more chance to come back empty than a row that
   * carries it, and empty is not harmless: the frame's src composes to `/undefined#/3`, the
   * SPA fallback serves index.html, and the player renders inside itself. */
  check('and it carries its deck', rows[0].deck === 'slides/c1/1.1/index.html', rows[0].deck);
  eq('and its range, in composed-deck numbering',
     [rows[0].slide, rows[0].end], [3, 9]);
  /* The composed deck's length, so a slide step can number itself the way the deck's own
   * paginator does - "8 slides" beside a frame reading 13/31 is two counts of two things. */
  check('and the whole deck\'s length', rows[0].total === 31, String(rows[0].total));

  check('every row knows which topic it is in',
        rows.every(r => r.topicId === '1.1.1'));
}

// ------------------------------------------------- a topic with no deck at all
eq('no deck is just its exercises, exactly as before any of this existed',
   walkTopic(noSlides).map(r => r.kind), ['exercise']);
/* A deck the course HAS but with no section for this topic - `verify` fails on it rather
 * than shipping it, and the player still has to behave when one gets through. */
eq('a deck with no section for this topic is the same',
   walkTopic({ ...noSlides, slides: 'slides/c1/1.1/index.html' }).map(r => r.kind), ['exercise']);

/* SLIDES ARE THE TOPIC, and only the exercises are conditional. The 15 wrap-up topics of the
 * Data Analyst course - "Congratulations!", "The finish line" - are slides and nothing else,
 * and a topic that lost its exercises on import still has material worth reaching. */
eq('a topic with slides and no exercises is still a row',
   walkTopic({ topic: '1.1.9', title: 'Congratulations!', slides: 'd.html', slide: 40, end: 44 })
     .map(r => r.kind), ['slides']);
eq('and a topic with neither is nothing at all',
   walkTopic({ topic: '1.1.8', title: 'Empty' }), []);

// ----------------------------------------------------------------- the course
{
  const course = { modules: [{ module: '1', units: [{ unit: '1.1', topics: [withSlides, noSlides] }] }] };
  const rows = walkCourse(course);
  eq('a course is its topics, flattened in order',
     rows.map(r => r.id), ['slides:1.1.1', 101, 102, 103]);
  /* Slides are taught, not graded. A progress bar that fills as you page past them measures
   * nothing, which is why the footer's total and the progress total are different numbers. */
  eq('only what can be solved is gradable', gradable(rows).map(r => r.id), [101, 102, 103]);
  eq('an empty course walks to nothing', walkCourse(null), []);
  eq('and so does one with no modules', walkCourse({}), []);
}

console.log(failures ? `\n${failures} failing` : '\nall green');
process.exit(failures ? 1 : 0);
