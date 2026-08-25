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

/* The Playground's declaration of what it offers - sets of datasets, borrowed from the
 * courses that own them. Its own file rather than a field of index.json: index.json is the
 * walk, and the Playground has no walk at all. Only fetched for a course whose card says it
 * is one. */
export const loadPlayground = id => json(`${BASE}${encodeURIComponent(id)}/playground.json`);

/** A course's card image, published beside its content and named in the manifest. */
export const courseImage = rel => `${BASE}${rel}`;

/** Where a topic's figures live. Exercises reference them by bare filename. */
export const imageBase = (courseId, topic) =>
  `${BASE}${encodeURIComponent(courseId)}/images/${encodeURIComponent(topic)}/`;

/** Where a topic's embedded apps live. Each is a directory holding its own index.html. */
export const appBase = (courseId, topic) =>
  `${BASE}${encodeURIComponent(courseId)}/apps/${encodeURIComponent(topic)}/`;

/* Where a UNIT's Python data files live - the csv, feather and pickle files a student's
 * own code opens by name. Per unit rather than per topic because they are shared inside
 * one and some are megabytes; an exercise refers to them by bare filename and knows
 * neither the course id nor the unit, exactly as it does for a figure.
 *
 * Note `data/` under a course holds two unrelated things: a SQL dataset - either
 * `<name>.sql` or a `<name>/` directory of .sql concatenated - and a `<unit>/` directory of
 * files mounted into the Python interpreter. They are told apart by NAME, not by being a
 * file or a directory: both kinds can be directories. A unit number is the marker. */
export const dataBase = courseId => `${BASE}${encodeURIComponent(courseId)}/data/`;

/** A dataset's seed SQL, fetched only when an exercise actually needs it. */
export async function loadDatasetSql(courseId, dataset) {
  const url = `${BASE}${encodeURIComponent(courseId)}/data/${encodeURIComponent(dataset)}.sql`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Dataset "${dataset}" not published for ${courseId} (HTTP ${r.status})`);
  return r.text();
}
