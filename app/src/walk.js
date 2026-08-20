/* The order a student moves through a topic.
 *
 * Without interleaving that is just the topic's exercises. With it, the topic's slides are
 * dealt into the run at the section boundaries DataCamp taught them at, so Next walks
 * slides -> exercises -> slides:
 *
 *     [slides] Databases     ?  ?
 *     [slides] Tables        ?  ?  SQL
 *     [slides] Data types    ?  ?  ?
 *
 * A SECTION IS NOT A LEVEL OF THE HIERARCHY. Course > Module > Unit > Topic > exercises is
 * still the whole vocabulary. A section is an annotation on a run of exercises within a
 * topic - a label and a slide range - and its number is internal and never shown. Topics
 * still hold the exercises; the numbering stays at three components. A fifth level is
 * exactly how the old model ended up calling a unit a course.
 *
 * Pure and dependency-free, like compare.js and dragdrop.js: App.vue walks it to move
 * through the course and ContentsModal.vue walks it to draw the same course, and the two
 * disagreeing would read as exercises going missing.
 */

/** A slide row's id. Namespaced so it can never collide with an exercise id. */
export const slideId = (topic, n) => `slides:${topic}:${n}`;

/**
 * One topic's rows, in order.
 *
 * Driven by the *deck's* sections rather than by which sections happen to have exercises.
 * A section whose exercises were all dropped on import - 1.10.4 lost both of section 1's
 * to DataCamp-hosted plots - still has slides worth teaching, and a topic's closing
 * "Congratulations!" section is material the student should reach rather than material to
 * hide. So every section contributes its slides; only exercises are conditional.
 */
export function walkTopic(topic) {
  const asExercise = e => ({ ...e, kind: 'exercise', topicId: topic.topic });
  // No deck, or nothing placed in it: the topic behaves exactly as it did before any of
  // this existed. That is also what a course with no raw data gets.
  if (!topic.sections?.length || !topic.slides) return (topic.exercises || []).map(asExercise);

  const rows = [];
  for (const s of topic.sections) {
    rows.push({
      kind: 'slides',
      id: slideId(topic.topic, s.n),
      topicId: topic.topic,
      section: s.n,
      title: s.title,
      slide: s.slide,
      end: s.end,
    });
    for (const e of topic.exercises || [])
      if (e.section === s.n) rows.push(asExercise(e));
  }
  // An exercise pointing at a section the deck doesn't have would vanish from the course
  // otherwise. `icecore verify` fails on that, so it should never ship - but a browser
  // holding a stale index.json is not covered by verify, and losing an exercise silently is
  // worse than showing it out of place.
  const placed = new Set(rows.filter(r => r.kind === 'exercise').map(r => r.id));
  for (const e of topic.exercises || [])
    if (!placed.has(e.id)) rows.push(asExercise(e));
  return rows;
}

/** Every row of a course, in order, flattened out of its modules and units. */
export const walkCourse = course =>
  (course?.modules || []).flatMap(m => m.units.flatMap(u => u.topics.flatMap(walkTopic)));

/** Only the rows that can be solved. Slides are taught, not graded. */
export const gradable = rows => rows.filter(r => r.kind !== 'slides');
