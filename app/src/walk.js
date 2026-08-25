/* The order a student moves through a topic.
 *
 * Without slides that is just the topic's exercises. With them, the topic opens on its own
 * run of slides and the exercises practise what they taught, so Next walks a unit as:
 *
 *     1.1.1  [slides] Databases    ?  ?
 *     1.1.2  [slides] Tables       ?  ?  SQL
 *     1.1.3  [slides] Data types   ?  ?  ?
 *
 * A TOPIC IS ONE SECTION OF ITS UNIT'S DECK. This used to say the opposite - that a section
 * is an annotation on a run of exercises inside a topic and emphatically not a level of the
 * hierarchy - and the hierarchy was re-cut underneath it: a DataCamp chapter is a unit now,
 * and the video-sized run of slides inside it is a topic. The vocabulary is still exactly
 * Course > Module > Unit > Topic > exercises and the numbering is still three components;
 * what changed is which DataCamp thing each word points at. Nothing here is a fifth level.
 *
 * So the deck belongs to the unit, and the topic carries a slide RANGE into it - `slide`
 * and `end`, in composed-deck numbering. Paging inside that range happens in the frame, not
 * in this walk, which is why `SlidesStep.vue` clamps the hash to it.
 *
 * Pure and dependency-free, like compare.js and dragdrop.js: App.vue walks it to move
 * through the course and ContentsModal.vue walks it to draw the same course, and the two
 * disagreeing would read as exercises going missing.
 */

/** A slide row's id. Namespaced so it can never collide with an exercise id. */
export const slideId = topic => `slides:${topic}`;

/**
 * One topic's rows, in order: its slides, then the exercises that practise them.
 *
 * The slides row is emitted whenever the topic HAS a range, not when it has exercises to
 * introduce. The 15 wrap-up topics of the Data Analyst course - "Congratulations!", "The
 * finish line" - are slides and nothing else, and a topic that lost its exercises on import
 * still has material worth reaching. Only exercises are conditional; slides are the topic.
 */
export function walkTopic(topic) {
  const asExercise = e => ({ ...e, kind: 'exercise', topicId: topic.topic });
  const exercises = (topic.exercises || []).map(asExercise);
  // No deck, or a deck with no section for this topic: it behaves exactly as a topic did
  // before any of this existed, which is also what a course with no slides/ gets.
  if (!topic.slides || !topic.slide) return exercises;

  return [{
    kind: 'slides',
    id: slideId(topic.topic),
    topicId: topic.topic,
    title: topic.title,
    slide: topic.slide,
    end: topic.end,
    /* The composed deck's length, carried so a slide step can number itself the way the
     * deck's own paginator does. A topic labelled "8 slides" beside a frame reading 13/31
     * is two counts of two different things and reads as a bug. */
    total: topic.slideCount,
  }, ...exercises];
}

/** Every row of a course, in order, flattened out of its modules and units. */
export const walkCourse = course =>
  (course?.modules || []).flatMap(m => m.units.flatMap(u => u.topics.flatMap(walkTopic)));

/** Only the rows that can be solved. Slides are taught, not graded. */
export const gradable = rows => rows.filter(r => r.kind !== 'slides');
