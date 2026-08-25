# The Playground — plan

A sandbox every student has: an editor, no syllabus, no marking, and a set of datasets they
can choose to load. Two languages, SQL and Python.

This is a **platform** feature that appears as a course. The player owns the editor, the
picker and the runtimes; the `icecore-playground` repo owns nothing but a manifest of what
to offer. That split is what keeps it inside the rule that course content never enters this
repo — and the datasets it offers stay owned by the courses that authored them.

Status: **the SQL playground is built and runs.** What that covers, and what it does not,
is at the bottom under [What is built](#what-is-built). Two decisions below were revised by
contact with the code; both are marked where they appear and listed there.

## Decisions taken

| | |
|---|---|
| **Datasets** | Borrowed from the owning course by manifest, never copied |
| **Shape** | One card on the grid; a language switch inside |
| **Access** | An `open` property on the course, not per-user enrolment rows |
| **Persistence** | localStorage for snippets; the SQL database is in memory (see below - `idb://` did not survive contact) |
| **Layout** | Browse beside the editor; folds into a tab beside Results when narrow |

### Why borrowed rather than copied

`loadDatasetSql(courseId, dataset)` already takes a course id, and the session cookie's
policy is `${origin}/*` — the whole site rather than a per-course prefix. So the player can
already fetch `icex-data-analyst`'s data from inside the Playground with no infrastructure
change and no duplicated megabytes.

The cost is a cross-repo coupling that nothing checks today, and it has to be made loud:

- The manifest names `{course, dataset}` pairs. `verify` in the **playground** repo must
  fail when a pair does not resolve, so a renamed dataset breaks a build rather than a
  student's session.
- A site may publish the Playground and *not* the course a set borrows from. That is not an
  error — it is a smaller Playground. A set whose course is absent from `courses.json` is
  **hidden, not broken**, the same way a course with no exercises is announced rather than
  half-opened.

### Why an `open` property rather than auto-enrolment

Enrolment is a DynamoDB row written when an admin invites someone. Auto-enrolling would need
a backfill for every existing user and would silently miss anyone created by another path.
`open: true` in `course.json` is derived from the course itself, cannot drift out of sync,
and needs no per-user write.

**Note what this does and does not do.** Enrolment is already only a grid filter — the
signed cookie grants the whole origin, so any signed-in student can fetch any course's
content by URL today. `open` therefore changes what is *shown*, which is all enrolment ever
controlled. Worth knowing before anyone treats enrolment as a boundary.

## The UI

One card on the grid. Opening it does **not** enter the exercise walk — there are no
modules, units, topics or exercises, and the walk is the wrong shape for all of it.

```
┌────────────────────────────────────────────────────────────┐
│  icecore            [ SQL | Python ]                  ⚙ ◐  │
├──────────────┬─────────────────────────────────────────────┤
│  DATA        │  1  SELECT title, release_year              │
│              │  2  FROM films                              │
│  ▸ Film       │  3  WHERE release_year > 2000              │
│  ▾ Sport      │                                            │
│    soccer  ✓ │                             [ Run ]  [ AI ] │
│    medals    ├─────────────────────────────────────────────┤
│  ▸ World      │  title              release_year           │
│  ▸ Postgres   │  ───────────────    ────────────           │
│              │  Sputnik            2007                    │
│  Loaded:     │  ...                                        │
│  soccer      │  1,238 rows · 41 ms                         │
│  [ Reset ]   │                                             │
└──────────────┴─────────────────────────────────────────────┘
```

- **Nothing is loaded by default.** The editor opens empty against an empty database. That
  is the brief and it is also the honest default: loading 13MB of `sql_eda` on the chance
  someone wants it is a slow first paint for nothing.
- **The picker is the left rail**, grouped into sets (below). Selecting a set loads it and
  says so; the rail keeps showing what is currently in the database, because "what tables do
  I have" is the first question a sandbox raises and the answer must not require a query.
- **Loading is additive.** A student can load Film *and* Sport into one database. Reset
  clears it.
- **The language switch is the only mode.** SQL and Python re-offer their own sets and their
  own results pane. Python's Pyodide boot only happens if they switch to it.

## The sets

### SQL — grouping is mostly naming

Eight datasets, ~20MB, already tidy. Proposed sets:

| Set | Datasets | Why together |
|---|---|---|
| **Film** | `films`, `MovieNow` | Both film-domain; joins across them are a natural exercise |
| **Sport** | `soccer`, `summer_medals` | Match/event data, both good for window functions |
| **World** | `nations` | Economic and demographic indicators |
| **Books** | `books` | One table, the gentlest starting point |
| **EDA** | `sql_eda` | Six tables: `evanston311`, `stackoverflow`, `fortune500`, `company`, `tag_company`, `tag_type`. 13MB, and the picker says so |
| **Postgres** | `pgdata` | Catalogue tables |

**`sql_eda` is not trimmed, and that reverses an earlier call in this document.** The first
version of this plan wanted it cut down, on the grounds that 13MB was too much to hand
someone casually. Two facts undo that:

- **Forty exercises in unit 1.8 already load it**, from exactly the URL the Playground would
  use. Any student who has done that unit has already paid for it.
- **A trimmed copy is a different artefact at a different URL.** So a student who did 1.8 and
  then opened the Playground would fetch 13MB *and* the trim - strictly worse for the common
  case, to save weight for someone who has not done the unit and is already covered, because
  nothing loads by default.

The split into smaller sets goes with it. A directory dataset is **concatenated into one
`<name>.sql` at build time**, so the six tables are not separately fetchable. Offering them
apart would mean either republishing them as six datasets - changing the `dataset:` key on all
forty exercises, which legitimately want them together - or holding curated copies here, which
is the duplication borrowing exists to avoid.

What survives is the mitigation that was always the real one: **the picker states the size**,
so loading 13MB is a deliberate click rather than a surprise. And the set lists its six tables,
so it is not a mystery parcel.

There is no curated-original exception after all, so the manifest does not need a
course-less dataset. Left out until something actually needs it.

**Table-name collisions are the open risk.** Sets load into one database and additively, so
two datasets that both define `films` would silently shadow. Needs a build-time check across
every set that can be co-loaded, not a runtime surprise.

### Python — curation, and it removes more than it keeps

91 files across nine units. **61 are pickles** (`.p`, `.pkl`, `.bz2`) and the Playground
should offer none of them: a pickle is opaque, so a student cannot look before loading —
exactly the move a sandbox exists to encourage — and pickle is pandas-version fragile. This
repo has already been bitten, with `putmask: output array is read-only` on a pickle-loaded
frame when pyarrow was importable.

Of the 26 CSVs, reading the actual columns rather than the filenames leaves **14**. What
came out:

| Dropped | Why |
|---|---|
| `2.2/baseball.csv` | Byte-identical to `2.1/baseball.csv` |
| `planes_end_ex_2.4.csv` | Same 11 columns as `planes.csv`, 8,508 rows against 10,660 — a filtered stage |
| `planes_for_lesson_2.3.csv` | Same rows as `planes.csv`, one column swapped mid-lesson |
| `ds_salaries_4.1.csv`, `ds_salaries_date_added.csv` | Earlier 11-column cuts of the 14-column `ds_salaries_4.3.csv` |
| `mpg_mean.csv` | 39 rows — a groupby result, not data |
| `world_happiness_sugar.csv` | `world_happiness.csv` plus a lesson's extra column |
| `update.csv` | No header; column names are the first row's floats. Numeric scratch |
| `1.2.1_example_csv.csv` | 17 rows of "How old are you?" — a toy for teaching `read_csv` |
| `S&P500.csv` | 10 rows x 2 |

The keepers, grouped — five sets, mirroring SQL's five:

| Set | Files | Shape |
|---|---|---|
| **World** | `gapminder`, `countries-of-the-world`, `clean_unemployment`, `world_happiness`, `WorldBank_GDP` | 142x7 to 227x20; `clean_unemployment` is wide-by-year, so a reshaping exercise for free |
| **People** | `student-alcohol-consumption`, `young-people-survey-responses`, `divorce`, `dem_votes_potus_12_16` | 395x30, 1010x16, 2209x10 — the widest and best for filtering; `divorce` is all dates |
| **Work** | `ds_salaries_4.3`, `amir_deals`, `all_deals`, `attrition.feather` | Salaries, one rep's deals and all deals — a natural pair to compare |
| **Travel** | `planes`, `airline_bumping`, `late_shipments.feather` | `planes` at 10,660x11 is the largest and the messiest, which is the point |
| **Everyday** | `mpg`, `food_consumption`, `baseball`, `spotify_2000_2020` | The tidy ones to start on, plus the 41k-row flagship |

The feather files are read, not guessed - through Pyodide, since there is no local pandas:

| File | Shape | Verdict |
|---|---|---|
| `spotify_2000_2020.feather` | 41,656 x 20 | **The best dataset here.** Audio features, all numeric, recognisable subject |
| `attrition.feather` | 1,470 x 31 | HR data, heavy on categoricals - good for grouping |
| `late_shipments.feather` | 1,000 x 27 | Supply chain, mixed types, genuinely messy |
| `dem_votes_potus_12_16.feather` | 500 x 4 | Two paired percentages. A stats artefact more than a dataset |

`spotify_2000_2020` was missed in the first inventory. It is by some distance the largest and
most explorable thing in the Python collection, and it was invisible because that pass read a
truncated listing rather than the directory.

**The stray index column stays.** Most of these CSVs carry an unnamed leading column from a
careless `to_csv`. Stripping it would be tidier and would also be the last time a student saw
one - they will meet it in every real CSV they open, and a sandbox is the right place to meet
it.

## Browsing the data

A picker that only says "loaded" is not enough — the first question a sandbox raises is
*what have I actually got*, and answering it should not require writing a query.

So the data browser is a first-class pane, not a modal: a table list, then a paginated grid
with search and counts.

```
┌─────────────┬──────────────────────────────────────────────┐
│  DATA       │  SELECT ... │  ⇕ resize                      │
│  ▾ Sport     │                                             │
│    soccer ✓ ├─────────────┴──────────────────────────────  │
│  ▸ World     │  BROWSE  matches ▾   🔍 messi         1,284  │
│             │  ┌────────┬───────────┬──────────┬────────┐  │
│  TABLES     │  │ id     │ home_team │ away_team│ date   │  │
│  matches    │  │ 10241  │ Barcelona │ Sevilla  │ 2013.. │  │
│  teams      │  └────────┴───────────┴──────────┴────────┘  │
│  players    │  ‹ 1 2 3 … 26 ›        1,284 of 25,979 rows  │
└─────────────┴──────────────────────────────────────────────┘
```

- **Counts always visible**: rows in the table, and rows matching the current search. A
  filtered count with no total is the version of this that misleads.
- **Search is across all columns** by default, with a column selector for narrowing. For SQL
  that is a query against the loaded database, which PGlite is already there to serve.
- **For Python the browser must not need Pyodide.** The data is CSV, so the pane can parse
  and page it in plain JavaScript and be useful in milliseconds, while the interpreter is
  still booting or before the student has run anything. Two implementations, but each is the
  natural one for its side — and the alternative is a browser that is unavailable exactly
  when someone is deciding what to load.
- **Paginated, never fully rendered.** `planes` is 10,660 rows and `sql_eda` is 13MB; the
  grid must page rather than build 10,000 DOM rows.

## Resizable everywhere

Every divider drags: picker against workspace, editor against results, editor against
browser. Sizes persist in localStorage per pane, so a layout survives a reload.

This is the difference between a sandbox someone tries once and one they work in — a fixed
editor height is fine for a five-line exercise answer and wrong for the sixty-line thing a
student is actually noodling on. It also decides the split-vs-tab question for the browser:
with a draggable divider, browse and edit can share the screen and the student sets the
ratio, so neither has to win.

Worth building as one small `SplitPane` component rather than three ad-hoc drag handlers —
the same argument as `Badge` and `DeckActions`, and it is the third time this repo has needed
the shared-not-duplicated rule stated.

## Where the browse pane sits, and what it shares

Two questions that got tangled together: **where it goes on screen**, and **how much code it
shares with the results pane**. They are separate.

### On screen

Every `┃` and `━` below is a draggable divider.

**A — browse beside the editor** (what "split view" most naturally means)

```
┌──────────┳━━━━━━━━━━━━━━━━━━━━━┳━━━━━━━━━━━━━━━━━━━━━━┐
│ DATA     ┃  1 SELECT title     ┃ BROWSE  films ▾   🔍 │
│ ▾ Film   ┃  2 FROM films       ┃ ┌──────┬───────────┐ │
│   films✓ ┃  3 WHERE year>2000  ┃ │ id   │ title     │ │
│   Movie… ┃          [Run] [AI] ┃ │ 1    │ Sputnik   │ │
│ ▸ Sport  ┣━━━━━━━━━━━━━━━━━━━━━┫ │ 2    │ Vertigo   │ │
│          ┃ RESULTS             ┃ └──────┴───────────┘ │
│ TABLES   ┃ title      year     ┃ ‹ 1 2 3 … 26 ›       │
│ films    ┃ Sputnik    2007     ┃ 1,284 of 4,968 rows  │
│ people   ┃ 1,238 rows · 41 ms  ┃                      │
└──────────┸━━━━━━━━━━━━━━━━━━━━━┸━━━━━━━━━━━━━━━━━━━━━━┘
```

Reference and workspace at once — you read the schema while writing against it. Costs
horizontal room: three columns on a laptop leaves the editor narrow, though the dividers mean
that is the student's call rather than ours.

**B — browse and results share the lower pane, as tabs**

```
┌──────────┳━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┐
│ DATA     ┃  1 SELECT title, release_year               │
│ ▾ Film   ┃  2 FROM films                               │
│   films✓ ┃  3 WHERE release_year > 2000                │
│   Movie… ┃                            [ Run ]  [ AI ]  │
│ ▸ Sport  ┣━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┫
│          ┃ [ Results ] [ Browse ]                      │
│ TABLES   ┃ title              release_year             │
│ films    ┃ Sputnik            2007                     │
│ people   ┃ 1,238 rows · 41 ms                          │
└──────────┸━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┘
```

A wide editor and a wide grid, which wide tables want. But browsing hides your results and
vice versa, and the one moment you most want the schema is while writing the query that is
about to replace it.

**Decided: A, with B's behaviour when narrow.** Below roughly 1100px the third column
collapses and browse folds into a tab beside Results. Same components either way — only where
they are mounted changes.

### What they share

The grid is the same problem twice; the chrome around it is not.

```
        DataGrid  ── columns, rows, widths, null and type rendering,
            │        horizontal scroll, windowed rows
            │
    ┌───────┴────────┐
    │                │
ResultPane       BrowsePane
    │                │
 timing          table list
 affected rows   search box
 tracebacks      pager
 figures         total vs filtered count
```

One `DataGrid` that knows how to draw a table of values and nothing else. Two thin wrappers
around it, because what they need next to the grid has nothing in common — a result has a
duration and might be a traceback or a figure; a browse has a pager and two different counts.

The reason to be strict about that line: **the two grids must look identical.** A student
browses `films`, runs a query against it, and compares the two by eye. If nulls render one way
in one pane and another way in the other, or a numeric column is right-aligned in one and not
the other, they will read that as the query having changed something. Sharing the renderer is
what makes the comparison trustworthy - the same argument as `Badge`, and the same failure if
it is not shared.

## The manifest

`content/playground.json` in the playground repo. It is the only thing that repo authors -
the platform owns everything else.

```json
{
  "sql": {
    "sets": [
      {
        "id": "film",
        "title": "Film",
        "blurb": "Two film databases. Joining across them is the interesting part.",
        "datasets": [
          { "course": "icex-data-analyst", "name": "films" },
          { "course": "icex-data-analyst", "name": "MovieNow" }
        ],
        "starter": "film.sql"
      },
      {
        "id": "postgres",
        "title": "Postgres internals",
        "blurb": "Catalogue tables and a large EDA corpus.",
        "datasets": [
          { "course": "icex-data-analyst", "name": "pgdata" },
          { "course": "icex-data-analyst", "name": "sql_eda" }
        ],
        "starter": "postgres.sql"
      }
    ]
  },

  "python": {
    "packages": ["pandas", "numpy", "matplotlib", "seaborn", "scipy"],
    "_comment": "the set that MAY be loaded, not the set loaded up front",
    "sets": [
      {
        "id": "world",
        "title": "World",
        "blurb": "Development indicators. clean_unemployment is wide by year.",
        "files": [
          { "course": "icex-data-analyst", "unit": "2.2", "name": "gapminder.csv" },
          { "course": "icex-data-analyst", "unit": "2.6", "name": "countries-of-the-world.csv",
            "as": "countries.csv" },
          { "course": "icex-data-analyst", "unit": "2.7", "name": "clean_unemployment.csv" }
        ],
        "starter": "world.py"
      }
    ]
  }
}
```

### Why it is shaped like that

**Split by language at the top, not a `language` field on each set.** The two sides carry
genuinely different things - a SQL set names datasets, a Python set names files with a
working filename - and Python needs configuration SQL does not (`packages`). One list with a
discriminator would mean every reader branching on it anyway, and would permit a set that
claims to be SQL while holding `files`.

**`{course, name}` matches `loadDatasetSql(courseId, dataset)` exactly**, which is the
function that already exists and already takes a course id. No translation layer.

**`as` is the working filename**, defaulting to `name`. A student should write
`pd.read_csv('gapminder.csv')`, not a path into someone else's unit directory - and two sets
can legitimately want files called the same thing in different units. It is also the only
knob that can resolve a Python-side collision without renaming anything in the course.

**Starters are files, not embedded strings.** `starter: "film.sql"` resolves to
`content/playground/starters/film.sql`. Authoring a twelve-line query as a JSON string full
of escapes is how starters stop being edited; a real `.sql` or `.py` file gets syntax
highlighting, a linter and a diff that reads.

**Array order is display order.** No `order` field to drift out of step with the array it
annotates.

**Nothing is declared that can be derived.** No table lists, no row counts, no sizes - those
come from the data, and a copy of them in JSON is a copy that goes stale. Sizes *are* wanted
by the UI (`sql_eda` is 13MB and should say so before it loads), so the publish stamps them
into the emitted manifest from what is actually in the bucket. The authored file and the
published file therefore differ, the same way `index.json` is not the exercise markdown.

### What checks it, and where

The hard part: the playground repo **does not have the data it references**. Those datasets
live in another repo and are built by another pipeline, so nothing local can confirm that
`icex-data-analyst/films` still exists. Three checks in three places, because no single one
can see everything:

| Where | Can see | Checks |
|---|---|---|
| `verify` in the playground repo | The manifest only | Structure: unique set ids, non-empty sets, every `starter` file present, nothing listed twice within a set |
| `verify` with sibling dirs passed | Local checkouts of the other courses | Resolves every `{course, name}`; parses the dataset SQL and reports **table-name collisions** across co-loadable sets |
| The publish pipeline | The live bucket | Resolves every pair against `content/<course>/data/`, fails on a miss, stamps sizes |

The pipeline check is the load-bearing one, and it checks the *real* dependency - what is
actually published - rather than a local copy that may be ahead of or behind it. It costs one
`aws s3 ls` per referenced course, and the publisher role already has that permission.

The sibling-dirs check is the only one that can catch a collision before a student does,
because collisions need the SQL itself:

```
icecore verify content ../icecore-datacamp-data-analyst/content
```

In CI it is skipped, with a line saying so. "Publishing less than you meant to" is silent by
nature and a check that quietly did not run is its cousin.

**A set whose course is absent is hidden, not broken.** That is the runtime rule and it holds
regardless of these checks, because a site may legitimately publish the Playground without
the course a set borrows from.

## What has to be built in the platform

Roughly in dependency order:

1. **A playground route.** The player currently resolves a course into a walk. A course with
   `open: true` and no modules needs a different view entirely.
2. **Composable databases.** Smaller than it looks - see the runtime section below.
   `runOn(db, sql)` is already exactly the editor's execute path.
3. **A plain Python run path.** `py.js` builds a *grader*: it runs pythonwhat against a
   solution. A playground needs execute-and-show — stdout, tracebacks, and matplotlib
   figures surfaced rather than swallowed by the `Agg` backend the grader sets.
4. **A results pane that is not a grading verdict.** Both languages currently render
   correct/incorrect. The Playground renders *output*.
5. **The manifest format**, plus `verify` support for it in a course repo.
6. **Collision checking** across co-loadable sets.
7. **A `SplitPane` component**, used by every divider, with sizes persisted per pane.
8. **The data browser** — table list, paginated grid, search, counts. Two backings: a query
   against PGlite for SQL, and a JavaScript CSV parse for Python so the pane works before
   the interpreter is up.

Reusable as-is: `CodeEditor.vue` (already language-aware since the `SqlEditor` rename),
PGlite boot and extension registration, the Pyodide package machinery, and the results table.

## Runtime design

### SQL: one live database, added to

The instinct is that composing datasets needs new caching machinery. It does not, and the
reason is worth stating because it also rules out the alternative.

`db.js` caches a **dumped data directory** per dataset and clones it with `loadDataDir`. That
is perfect for exercises - each one wants exactly one dataset - and useless for composition,
because loading a dump *replaces* the database. Two dumps cannot be merged. So additive
loading has to be `exec`, and once it is `exec`, the whole thing is three lines:

```js
const db = new PGlite({ extensions: EXTENSIONS });   // once per session
const blank = await db.dumpDataDir();                // keep, for reset
await db.exec(await loadDatasetSql(course, name));   // per dataset the student adds
```

`runOn(db, sql)` already returns the last statement's fields and rows, which is precisely what
an editor shows. The playground's SQL execute path is a function that exists.

**Each dataset applies in a transaction.** Postgres DDL is transactional, so a set that
collides half way through rolls back rather than leaving a database with three of five tables
in it. That also means **collisions need no manifest declaration and no parsing**: a second
`CREATE TABLE films` raises `relation "films" already exists`, the transaction aborts, and the
UI reports which set could not be added and why. The build-time check across co-loadable sets
is still worth having - it tells an author before it tells a student - but it is an
improvement on this, not a prerequisite for it.

**Reset reloads the blank dump** rather than booting a fresh instance. A cold PGlite boot is
seconds; restoring an empty data directory is not.

**Caching composed sets is not worth it.** Keyed by the sorted list of loaded set ids it would
work, but an in-memory cache only helps within one tab session, and within one session a
student loads each combination once anyway. Skip it.

**`idb://` persistence was decided, and then withdrawn.** The reasoning was sound and the
mechanism is not available: PGlite refuses `loadDataDir` against a data directory that
already holds a database - *"Database already exists, cannot load from tarball"* - so with an
idb data directory the blank-dump reset three paragraphs up does not exist. Reset would mean
deleting the IndexedDB store and paying a cold `initdb`: seconds, on a button a student
might press ten times.

There is a second problem the plan had not reached. PGlite does no locking between tabs, so
two tabs sharing one idb store corrupt it. Persistence needs a worker and leader election,
which is a real piece of work rather than a configuration string.

So the session is in memory today. Bringing persistence back means answering the multi-tab
question, and it still brings the obligation the original note identified: a dataset that
changed upstream is stale until something notices, which argues for stamping the loaded set
with the published size or etag.

### Python: what "reset" can honestly mean

Pyodide cannot unload a module, and it has no teardown API - the same fact that made the
builder run 25 interpreters out of heap and forced `python-worker.mjs`. So a true reset means
a new interpreter, which costs seconds and leaks the old one. Offering that on a button a
student might press ten times is a memory leak with a nice label.

So reset is two things, named honestly:

- **Clear output** - the results pane only. Free.
- **Reset session** - clears the globals namespace, unlinks the mounted data files, and closes
  matplotlib's figures. Fast, and covers everything a student actually did.

What survives is imports and any state inside them - a monkeypatched library stays
monkeypatched. The UI should say so in a sentence rather than pretend otherwise, and offer a
full page reload as the "really start again" escape hatch, which is a new interpreter by
another name and costs nothing extra because the tab is going anyway.

**Files mount, they do not copy into a virtual home.** Each set's files land at the working
directory under their `as` name, so `pd.read_csv('gapminder.csv')` works and the student never
sees a unit number.

### Python packages load when they are first wanted

`packages` in the manifest is the set a student **may** load, not the set loaded up front.
Nothing is fetched until an import needs it.

The failure mode this has to avoid is a stalled cell with no explanation: `import seaborn`
sits there for several seconds while a wheel downloads, and the student concludes the
playground is broken. So the run has to say what it is doing - "loading seaborn..." with a
spinner, in the results pane, before the output appears.

Mechanically that means resolving imports before executing rather than letting the import
fail: scan the source for `import x` / `from x import`, map to Pyodide package names, and
`loadPackage` anything not already present, reporting each. Pyodide's own
`loadPackagesFromImports` does the scan; the reporting is ours.

Worth restating because it looks like a contradiction: the constraint that shaped
`packageKey` - an interpreter must hold *exactly* the declared set - does **not** apply here.
That exists so grading is reproducible, and it was learned the hard way when pyarrow's
presence changed a pandas code path. Nothing in a playground is graded, so a student
accumulating packages as they go is fine.

### The results pane is output, not a verdict

Both editors currently render correct/incorrect. A playground renders whatever happened, and
for Python that is three different things at once:

- **stdout and stderr**, captured for the run.
- **The value of the last expression**, via `eval_code(..., return_mode="last_expr")`. If it
  has `to_html` - and in this course it usually will - render the DataFrame as a table rather
  than as `repr` text, styled like the browse grid so the two agree.
- **Figures.** The grader sets matplotlib to `Agg` and suppresses the non-interactive warning,
  which is right for grading and exactly wrong here. After each run, walk
  `pyplot.get_fignums()`, save each to PNG bytes and show them. Without this, a student's first
  `plot()` appears to do nothing at all, which is the worst possible first impression for a
  sandbox.

A traceback is output too, not an error state - shown in the pane, not as a failure banner.

## Features beyond the editor

- **AI assistance.** See below - it needs its own shape.
- **A schema view.** For SQL, what is loaded and its columns. Cheap, and removes the most
  common reason to leave the page.
- **Snippets.** localStorage to start. If it earns a server-side upgrade later, keep the
  shape simple enough that the migration is a copy.
- **Seeded examples per set.** A starter query per set, so an empty editor is not the first
  thing a student meets. Cheap, high value, and it belongs in the manifest.

## The AI assistant

The hint Lambda cannot be reused as it stands. It is exercise-shaped - title, prompt,
instructions, solution, submission, feedback - and every one of those exists so it can reason
towards a **right answer**. A playground has no right answer. Asked to help with a query it
has no target for, a prompt built to nudge someone toward a known solution will invent one.

So: same Lambda, same key, new route and new prompt. What it gets:

```json
{
  "language": "sql",
  "question": "why does my date comparison return nothing?",
  "editor": "SELECT * FROM films WHERE release_date > '2000-01-01'",
  "selection": "release_date > '2000-01-01'",
  "loaded": {
    "sets": ["film"],
    "tables": [
      { "name": "films", "rows": 4968, "columns": [
        { "name": "id", "type": "integer" },
        { "name": "title", "type": "text" },
        { "name": "release_date", "type": "text" }
      ], "sample": [
        { "id": 1, "title": "Sputnik", "release_date": "12/03/2007" }
      ] }
    ]
  },
  "lastRun": { "ok": true, "rows": 0, "ms": 12 }
}
```

**Shape, not data.** Column names, types and row counts - never the table. `sql_eda` is 13MB
and could not go in a prompt if we wanted it to, and the model needs the schema to write
correct SQL, not the values.

**With a deliberate exception: three sample rows per table.** The example above is exactly why.
The schema says `release_date` is `text`; only a sample shows it holds `12/03/2007`, which is
the entire answer to the student's question. Without sample rows the assistant confidently
explains date comparison and never spots that the column is a string in the wrong format -
the most common real question a sandbox produces. These are public teaching datasets, so
there is no privacy cost to weigh against it; a set of student-uploaded data later would
change that calculus and should turn the samples off.

**The shape is derived at ask time, not tracked.** For SQL it is a query against
`information_schema.columns` plus a count - the student's own live database answers what they
actually have, including anything they created themselves in the editor. For Python it is a
walk of globals for objects with `dtypes` and `shape`, plus the files mounted. Either way the
assistant sees the session as it is rather than as the manifest said it would be, which is the
difference between helping with `my_summary` and only knowing about `planes.csv`.

**`selection` matters more than it looks.** "Why does *this bit* return nothing" is the
question people actually ask, and a highlighted fragment is how they ask it. Passing it lets
the answer be about that fragment rather than about the whole script.

**`lastRun` carries the failure, not the output.** Row count, duration, and the error or
traceback if there was one. Not the result set - the same reason as the tables.

**Read-only, decided.** The assistant sees the shape and answers; it never executes. It would
be more useful if it could look before answering, and that is exactly the point at which a
help button becomes an agent operating on the student's database. The student running it
themselves is the point of a playground. Easy to allow later, hard to withdraw.

## Open questions

None outstanding on design. Two things worth a look while building:

- **Cache headers on published content.** Datasets are synced with no `Cache-Control`, so a
  student returning next week re-downloads `sql_eda` even though it has not changed. A
  moderate `max-age` would make the Playground's reuse of course datasets genuinely free
  rather than merely likely - bounded by the fact that a re-extracted dataset keeps its URL,
  so the header cannot be long without a version in the path.
- **How the picker states size.** It has to come from the published manifest (stamped by the
  pipeline from the bucket), because the player cannot know before fetching - and fetching to
  find out is the thing the label exists to prevent.

## What is built

The SQL side works end to end: pick a set, it loads, write a query, see the rows.

| | |
|---|---|
| `src/playground.mjs` | The manifest - parsed once, consumed by `build` and `verify` |
| `src/build.mjs` | Emits `content/<id>/playground.json`, carries `open` and `playground` onto the card |
| `app/src/playground-db.js` | The additive PGlite session, reset from a blank dump, and the live schema |
| `app/src/components/SplitPane.vue` | Every divider, sizes remembered per pane |
| `app/src/components/DataGrid.vue` | The one table renderer - `ResultGrid` now draws through it too |
| `app/src/components/Playground.vue` | The screen: picker, editor, results |
| `bin/icecore.mjs` | `verify <course> <lender>...` resolves borrowings and finds collisions |

Two things came out differently from the plan above, both because the code disagreed:

- **The database is in memory, not `idb://`.** See the runtime section - `loadDataDir`
  cannot be combined with an existing data directory, and two tabs on one idb store have no
  locking between them.
- **The language switch offers only what the player can run.** A manifest may declare
  Python before the platform can execute it - it is authored in another repo, on another
  schedule - and a tab that apologises is worse than a tab that is not there yet. The switch
  is drawn only when there is a real choice.

### Still to build

Roughly in the order they are worth doing.

1. **The Python run path** - execute-and-show rather than grade. stdout, tracebacks, the
   last expression as a table, and `pyplot.get_fignums()` walked so a first `plot()` does
   something. Adding `'python'` to `RUNNABLE` in `Playground.vue` is the last line of it,
   not the first.
2. **The data browser** - table list, paginated grid, search, two counts. `DataGrid` is
   already the renderer it needs; what is missing is the chrome and, for Python, the plain
   JavaScript CSV parse so the pane works before Pyodide is up.
3. **The publish-time check.** The pipeline is the load-bearing resolver - the local one
   sees a checkout, which may be ahead of or behind the bucket - and it is also where sizes
   get stamped. Nothing checks a playground's borrowings against the bucket today.
4. **Sizes in the picker.** Waiting on 3; the player cannot know before fetching, and
   fetching to find out is the thing the label exists to prevent.
5. **The AI assistant** - new route on the hint Lambda, read-only, shape plus three sample
   rows.
6. **`idb://` persistence**, with the multi-tab question answered.

### A collision that already exists

`soccer` and `pgdata` both define `country`, so a Postgres set and the Sport set cannot be
loaded together - the second is refused, atomically, with Postgres's own message. That is
why `pgdata` is not offered yet. It is also the check working: `icecore verify content
../icecore-datacamp-data-analyst/content` names the pair before a student finds it.
