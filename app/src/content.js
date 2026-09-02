/* Content is fetched at runtime from static files, not compiled into the bundle.
 * That means publishing a course is a file upload (S3, CloudFront, any static host)
 * rather than an app rebuild, and a student only downloads the course they opened. */

const BASE = `${import.meta.env.BASE_URL}content/`;

/* `no-cache` MEANS REVALIDATE, NOT "DO NOT CACHE" - the browser keeps its copy and asks
 * whether it is still good, so the usual answer is a 304 with no body.
 *
 * IT IS HERE RATHER THAN LEFT TO THE SERVER because the server cannot be relied on for
 * this. These objects shipped for a long time with no Cache-Control at all, which makes a
 * browser invent its own freshness - roughly a tenth of the file's age - and an already
 * loaded tab then goes on using a manifest that has been replaced. A CloudFront
 * invalidation does not help: it clears the edge, not a reader. Nor does a hard reload,
 * reliably, because that forces revalidation of the document and the subresources the
 * parser finds, and this is a `fetch()` made later by script.
 *
 * That failure is invisible in exactly the wrong way. index.json carries every exercise's
 * XP, expected results and reference solution, so a stale one is not a missing course - it
 * is a course that renders perfectly and is quietly out of date. It cost an afternoon
 * once: exercises awarded no XP and showed no amount, with correct data in the bucket, a
 * green pipeline and a cleared edge.
 *
 * `auth.json` already does this, for the same reason and with the stronger `no-store`.
 * Content is bigger and revalidates well, so it gets the cheaper one. */
async function json(url) {
  const r = await fetch(url, { cache: 'no-cache' });
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

/* A UNIT's speaker notes, by composed-deck slide number - the deck is the unit's, and a
 * topic reads the slice of these that falls in its own slide range. Fetched only when a
 * student opens the panel: 880KB across a course, ~11KB for the unit they are reading, and
 * paging from one topic of a unit to the next reuses the same file. Absent for a unit whose
 * deck has none, so a miss is a normal answer rather than an error - the caller treats it
 * as "no notes". */
export const loadNotes = (courseId, unit) =>
  json(`${BASE}${encodeURIComponent(courseId)}/notes/${encodeURIComponent(unit)}.json`);

/** A course's card image, published beside its content and named in the manifest. */
export const courseImage = rel => `${BASE}${rel}`;

/** Where a topic's figures live. Exercises reference them by bare filename. */
export const imageBase = (courseId, topic) =>
  `${BASE}${encodeURIComponent(courseId)}/images/${encodeURIComponent(topic)}/`;

/** Where a topic's embedded apps live. Each is a directory holding its own index.html. */
export const appBase = (courseId, topic) =>
  `${BASE}${encodeURIComponent(courseId)}/apps/${encodeURIComponent(topic)}/`;

/* Where a MODULE's Python data files live - the csv, feather and pickle files a student's
 * own code opens by name. Per module rather than per topic because a DataCamp course's
 * files are shared across all its chapters and some are megabytes; an exercise refers to
 * them by bare filename and knows neither the course id nor the module, exactly as it does
 * for a figure.
 *
 * Note `data/` under a course holds two unrelated things: a SQL dataset - either
 * `<name>.sql` or a `<name>/` directory of .sql concatenated - and a `module-<n>/`
 * directory of files mounted into the Python interpreter. They are told apart by NAME, not
 * by being a file or a directory: both kinds can be directories. The `module-` prefix is
 * the marker, and it is a prefix rather than a shape so that nothing has to guess. */
export const dataBase = courseId => `${BASE}${encodeURIComponent(courseId)}/data/`;

/** A dataset's seed SQL, fetched only when an exercise actually needs it. */
export async function loadDatasetSql(courseId, dataset) {
  const url = `${BASE}${encodeURIComponent(courseId)}/data/${encodeURIComponent(dataset)}.sql`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Dataset "${dataset}" not published for ${courseId} (HTTP ${r.status})`);
  return r.text();
}
