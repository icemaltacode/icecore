/* Content is fetched at runtime from static files, not compiled into the bundle.
 * That means publishing a course is a file upload (S3, CloudFront, any static host)
 * rather than an app rebuild, and a student only downloads the course they opened. */

const BASE = `${import.meta.env.BASE_URL}content/`;

async function json(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} - HTTP ${r.status}`);
  return r.json();
}

/** All courses available on this deployment. */
export const loadManifest = () => json(`${BASE}courses.json`);

/** One course: units, exercises, expected results, and reference solutions. */
export const loadCourse = id => json(`${BASE}${encodeURIComponent(id)}/index.json`);

/** A course's card image, published beside its content and named in the manifest. */
export const courseImage = rel => `${BASE}${rel}`;

/** Where a topic's figures live. Exercises reference them by bare filename. */
export const imageBase = (courseId, topic) =>
  `${BASE}${encodeURIComponent(courseId)}/images/${encodeURIComponent(topic)}/`;

/** Where a topic's embedded apps live. Each is a directory holding its own index.html. */
export const appBase = (courseId, topic) =>
  `${BASE}${encodeURIComponent(courseId)}/apps/${encodeURIComponent(topic)}/`;

/** A dataset's seed SQL, fetched only when an exercise actually needs it. */
export async function loadDatasetSql(courseId, dataset) {
  const url = `${BASE}${encodeURIComponent(courseId)}/data/${encodeURIComponent(dataset)}.sql`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Dataset "${dataset}" not published for ${courseId} (HTTP ${r.status})`);
  return r.text();
}
