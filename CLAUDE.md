# icecore — working notes

The ICE practice platform. See [`README.md`](README.md) for what it does and how to use it
from a course repo.

## The rule that matters

**No course content in this repo, ever.** The dependency direction is always
content → platform. If something is specific to a course — a unit mapping, a dataset, an
exercise, a DataCamp slug — it belongs in that course's repo, not here.

That's also what keeps `icecore` free of DataCamp-derived material, so it's the one repo
that could be shown externally or open-sourced.

## Architecture

- `app/` — Vue 3 player. `src/compare.js` is pure and dependency-free so the CLI can share
  it; everything else in `app/src/` is browser-only (`content.js` uses `import.meta.env`,
  so Node can't import it). **Anything the builder imports out of `app/src` must stay
  dependency-free and must never reach `import.meta.env`** — that is the whole rule.
  `compare.js` and `dragdrop.js` obey it. `walk.js` and `appframe.js` are only imported by
  the app, so they are free of it today; don't let that change without checking.
- `src/build.mjs` — content builder. Parses exercise markdown, precomputes expected results
  by running each reference solution in PGlite, emits per-course static files.
- `bin/icecore.mjs` — the CLI. `root` and `publicDir` are supplied here, not in
  `app/vite.config.js`, so the same app builds against any course repo. `icecore slides`
  also lives here: the platform owns the deck build, so the selection logic exists once.
- `src/decks.mjs` — the **only** place a deck is parsed, and the only definition of where a
  built deck is published (`deckPrefix`). One `@slidev/parser` load yields both the section
  ranges — one per topic of the unit — and the transitive `src:` include graph selective
  building needs. Parsing decks twice for the two features is how they drift apart.
- `src/playground.mjs` — the **only** place a playground manifest is parsed, for the same
  reason as `decks.mjs`: `build` emits it and `verify` fails on it, and two readers would
  disagree about what a valid manifest is exactly when it mattered.
- `app/src/playground-db.js` — the Playground's composed PGlite session. Deliberately not
  `db.js`: that one clones cached data directories, which cannot be merged.
- `app/src/csv.js` — pure, like `compare.js` and `dragdrop.js`. A real CSV parser rather
  than `split(',')` because the input is a spreadsheet export: a name is often
  `"Borg, Jane"`, Excel doubles quotes inside quotes and writes CRLF.
- `app/src/walk.js` — pure, like `compare.js` and `dragdrop.js`. The order a student moves
  through a topic: its slides, then the exercises that practise them. `App.vue` and
  `ContentsModal.vue` both draw it, and the two disagreeing reads as exercises going
  missing.
- `.github/workflows/publish.yml` — the publish pipeline, called by every course repo.
  There is no template to copy any more; the two copies had already drifted.

## More than one course on a site

**A content repo is still one course** — `build.mjs` reads a single `course.json`. What
changed is that the *site* they publish into is shared, so nothing may assume it owns the
whole of `content/`.

- `build`, `dev` and `bundle` take **one content directory per course**; `verify` and
  `slides` are about one course's own material and use the first. `icecore dev ../a/content
  ../b/content` runs the grid the way a student sees it.
- A build owns `content/<id>/` **and nothing else**. It used to `rmSync` the whole of
  `content/`, which is fine while a site is one course and silently deletes the others the
  moment it isn't.
- Same shape in the pipeline: **never `aws s3 sync dist/content/ --delete`.** A repo's dist
  holds only its own course, so that removes every other course on the site. Sync one course
  prefix at a time, exactly as decks are synced one deck at a time.
- **`courses.json` is assembled, not published.** Each build writes a one-entry version, so
  uploading it would leave the grid showing only whichever repo published last. Each course
  publishes `content/<id>/card.json`; the pipeline rebuilds the catalogue from every
  `card.json` in the bucket. Self-healing — a course whose prefix is gone drops out without
  anyone editing anything.
- **A course with no exercises is announced, not broken.** A `course.json` and a cover is a
  whole valid course repo; the grid draws it as "Coming soon" and won't open it. Derived
  from the exercise count, never a flag, so a course stops being announced by gaining
  material.

## The shape of a course

**Course > Module > Unit > Topic > exercises**, numbered `1` / `1.1` / `1.1.1`. One content
repo is one course. Only topics are directories and only topics hold exercises; the levels
above exist so a few hundred exercises stay navigable.

Use these words exactly -- a fifth vocabulary is how the old model ended up calling a unit
a course and a topic a unit.

**An ICE course is one DataCamp track.** It maps as **track → course, course → module,
chapter → unit, video → topic**: so a topic is a single video's worth of slides plus the
exercises that practise it, which is the smallest thing worth putting a Next button around.

This replaced a model where one ICE course spanned several tracks. Everything shifted down
a name and the top level disappeared:

| was | is now | DataCamp |
|---|---|---|
| Course, spanning tracks | *(gone)* | — |
| Module `1` | **Course** | track |
| Unit `1.2` | Module `2` | course |
| Topic `1.2.3` | Unit `2.3` | chapter |
| `section: 2` on an exercise | Topic `2.3.2` | video |

**Depth and numbering did not change** — three components, four container words. What
changed is which DataCamp thing each word points at, and that a *section* stopped being an
annotation and became the topic level. The old numbering converts by dropping the leading
module digit and appending the section: `1.2.3 §2` → `2.3.2`. `dc-split` in the importer
did it; it is one-off and should never need running again.

## Slides, topics and interleaving

**A unit has a deck when `slides/unit-<unit>.md` exists** — the *source*, never built
output. Deriving it from `content/slides/<unit>/index.html` coupled the content pipeline to
the deck pipeline: skipping the deck build then published a course with no slides links at
all, silently. That decoupling is what makes selective deck building safe, so don't undo it.

**A topic is one section of its unit's deck.** The deck belongs to the unit — a DataCamp
chapter — and each `layout: statement` run inside it is one topic, in order, so a topic's
own third number is the ordinal that selects its slide range. Nothing joins the two but
that ordinal.

- A section opens on `layout: statement` and closes on the `layout: statement_alt`
  ("Let's practice!") that follows. **That is a contract, not a style choice.** A deck that
  opens a topic with any other layout drops it silently. A full-bleed heading that *isn't*
  a topic needs a different layout name.
- **A deck one section short leaves a topic with no slides**, and `verify` fails on it
  rather than shipping an empty topic. Two units of the Data Analyst SQL course are in
  exactly that state — their "Congratulations!" wrap-up video became a topic and the deck
  was never given a closing section for it.
- **`routerMode: hash` must stay** in every unit deck. Deep links are `#/<n>` and resolve
  client-side; drop it and every link 404s in production while still working in dev.
- **Slide numbers are composed-deck numbers.** `unit-1.1.md` pulls in the module frame and
  its page file, so a regex over the page counts from the wrong place. Only the parser
  resolves `src:`.
- **Deck prefixes are scoped to the course**: `slides/<courseId>/<unit>/`. They used to be
  a flat `slides/<unit>/`, which was unique only while one course spanned every module on
  the site — every course numbers its own modules from 1 now, so two courses both own a
  unit 1.1. `deckPrefix` in `decks.mjs` is the one definition; `dist/slides/` mirrors the
  bucket so the sync is a straight copy, and `.built.json` carries the course id so the
  pipeline reads the prefix rather than rebuilding it in YAML where nothing tests it.
- **A slide step is walled to its topic.** `SlidesStep.vue` clamps the frame's hash to
  `[slide, end]` on navigation, because Slidev's Next walks the whole unit deck and paging
  out of a topic skips the exercises that practise it. Hooked on the patched `pushState`
  rather than `hashchange`: vue-router's hash mode drives the History API directly, so a
  `hashchange` listener sees nothing at all.
- **Speaker notes are shown to students**, in a panel beside the slide step. That is only
  safe because of the house rule that a note is a handout rather than a stage direction -
  it is a property of the content, not of the code, and a course that wrote "pause here"
  notes would be publishing those too. `decks.mjs` yields them from the same parse as the
  sections and the include graph; they are derived from the deck **source**, so a unit has
  notes on exactly the terms its topics have a Slides button.
- **The notes text ships per UNIT, the count ships per topic in `index.json`.** The file is
  the deck's and is keyed by composed-deck slide number, so cutting it per topic would be
  the same file three ways and re-fetched as a student walks one unit. 880KB across the
  Data Analyst course against ~11KB for one unit, so putting the prose in `index.json`
  would be a quarter of it for something a student reads one unit of. The per-topic count
  is of that topic's own range - counting the deck's would offer the panel on a topic with
  no notes in it. Notes are raw markdown rendered by the player's own `md.js`: one
  renderer, one set of typography.
- **The notes panel follows the FRAME, not the step.** A slide step is a range and the
  student pages through it inside the iframe, so the panel rides the same patched
  `pushState` the clamp uses.
- **Which nav controls a student gets lives in `slidev-theme-ice/styles/nav.css`**, not in
  CSS the player injects. A deck is also watched in a tab, at its published URL, and under
  `slidev dev`; the set has to be the same in all of them. Matched on each button's `title`,
  so a Slidev upgrade that rewords one brings that control back - re-read
  `@slidev/client/internals/NavControls.vue` if one reappears.
- **`@slidev/parser` is resolved from the course's `slides/`**, not from here — it has to
  match the Slidev that builds the decks. So `npm ci --prefix slides` is a prerequisite of
  building *content*, not just of building decks. Miss it and every topic loses its slide
  range and ships that way without failing.

## Publishing

One definition, in `.github/workflows/publish.yml`, called by each course repo with its four
variables. Pass them explicitly: `vars` does not resolve inside a called workflow.

- **CI publishes against icecore's `main`, always, and no lockfile needs touching.** A course
  declares `"icecore": "github:icemaltacode/icecore"` — no ref, which already means main. It
  never asked to be pinned; npm resolves a git dependency to a commit at install time, writes
  that into `package-lock.json`, and `npm ci` then reinstalls that commit forever. The publish
  re-resolves it (`npm update icecore --package-lock-only`) before `npm ci` and prints the SHA
  into the run summary.

  That mechanic used to be treated as the feature and guarded with a check that failed the
  publish when the pin was behind — the reasoning being that a bad platform commit must not
  silently regrade a whole course. **The build already answers that, directly and loudly:**
  every reference solution is graded against its own SCT and one that does not mark itself
  correct fails the build. What the gate actually bought was a manual lockfile bump in six
  course repos on every platform push, to re-agree with what `package.json` says by default.
  A tax like that gets skipped, and then the pin is stale *and* unguarded — strictly worse
  than not having one.

  It needs no credentials, and that is load-bearing: the lockfile records a `git+ssh://` URL
  and a runner has no SSH key, so this only works because icecore is the *public* repo and npm
  falls back to HTTPS for a hosted GitHub dependency. Keeping course material out of icecore
  is what buys that. Note also each course's `.npmrc` carries `allow-git=root` — npm 12 refuses
  git dependencies without it, with `EALLOWGIT`.

  **Known hole, and it predates this:** `.icecore/cache` keys a Python verdict on the Pyodide
  version and the wheel filenames, not on the icecore commit, so a change to grading *logic*
  does not invalidate a cached verdict. Putting the commit in the key would close it and bust
  the whole cache on every platform push — 13 minutes a run — which is why it has not been.

- **Never `aws s3 sync --delete` against `slides/` as a whole.** With a partial `dist/slides`
  — which is now the normal case — it deletes every deck that wasn't rebuilt. Sync one deck
  prefix at a time and reconcile removed decks explicitly. **The reconcile is scoped to the
  publishing course's own prefix** (`slides/<courseId>/`) for the same reason the content
  sync is: listing `slides/` as a whole walks every other course's decks and, finding none
  of them in this repo's manifest, would delete the lot.
- **Each deck ships only the images it references.** Slidev copies all of `public/` into
  every build; that was 84MB and 861 objects for a deck whose own content is 6.4MB. Pruned
  after the build, so `slidev dev` still sees all of `public/` and the markdown is untouched.
  The brief's `/slides/_shared/` idea fights Vite, which rewrites absolute asset URLs against
  each deck's `--base`.
- The theme's background used to dominate per-deck weight: `bg_main.png` was 3.6MB of a
  deck's ~6.4MB, one identical file repeated ~212MB across the site. It was refactored to
  `bg_main.webp` on 2026-08-20 and is now **522KB**, so that line is ~41MB across the site
  and no longer the thing to look at first. It lives in `slidev-theme-ice`.
- **A deck's PDF is not sized by its assets.** Each `slides.pdf` is ~5.6MB (median; 520MB
  for all 79), and 4.7MB of that is one full-page image of the background — but that is the
  *exporter's* doing, not the file's. Chromium decodes the 522KB webp and re-encodes it as
  2559x1440 `FlateDecode` RGB plus an alpha `SMask`, losslessly. Shrinking the source again
  buys nothing here; the lever is the export.
- CI only works as of 2026-08-20. GitHub now issues OIDC subject claims carrying numeric ids
  (`repo:icemaltacode@132367313/icecore-x@1338407739:...`) and STS reports a condition
  mismatch identically to a missing role. Both claim shapes are trusted while the rollout is
  in progress. If publishing breaks with "Not authorized to perform
  sts:AssumeRoleWithWebIdentity", check `GET /repos/{owner}/{repo}/actions/oidc/customization/sub`
  before suspecting the variables.
- **The alarm email lives in `infra/cdk.json`, not in a `-c alertEmail=` flag.** The
  subscription is a CDK resource: pass it as a flag once and the topic gets a subscriber,
  forget the flag on the next deploy and CloudFormation removes that subscriber again —
  silently, from a deploy that goes green, leaving five alarms firing into nothing.
  Committed context cannot be forgotten. AWS also requires the recipient to click a
  confirmation link, and an unconfirmed subscription looks identical to a working one:
  `just alerts` shows a real ARN only once it has been confirmed.
- **The invitation must contain `{username}`, and must never show it.** Cognito rejects an
  admin-create-user template without that token — the deploy fails with "Email message body
  should have {username}" — but the pool signs in by email alias, so Cognito generates an
  internal UUID as the real username and the token renders as
  `362e22b0-a041-705a-0ab4-feb0bd46157b`. The old copy opened with "Hello {username}", which
  greeted every student with a 36-character identifier and implied it was what they sign in
  with. There is no `{email}` placeholder. So it lives in an HTML comment and the copy tells
  them to use their email address. Deleting it breaks the deploy; surfacing it misinforms.
- **`just deploy` syncs an ALLOWLIST, not everything-except.** The app owns `index.html`,
  `auth.json` and `assets/*`; every other prefix in the bucket belongs to a course pipeline,
  to the stack, or to something not invented yet. This was an exclude list naming `content/*`
  and `slides/*`, and the day `brand/` was added for the invitation logo the next deploy
  deleted it — the list had been written before that prefix existed, and the post-deploy
  check looked at the prefixes already protected, so it could not catch it. Forgetting to add
  a new app file to the allowlist means it does not deploy, which is visible; forgetting to
  exclude someone else's prefix means it is deleted, which is not.
- **The invitation's logo is deployed by the stack, not by `just deploy`.** A mail client
  drops an inline `data:` URI and Cognito sends one body with no attachment, so a remote
  image is the only route — which makes the image a dependency of the email, and the email
  is defined in the stack. It lands under `brand/`, served by the default behaviour, which
  has no trusted key group and so is publicly readable: the recipient is not signed in.
  `BucketDeployment` is set `prune: false` deliberately — it defaults to deleting everything
  in the destination prefix that is not in the source, which is the same foot-gun as an
  `s3 sync --delete` against a bucket holding three courses and 79 decks. Most clients block
  remote images, so the `alt` text is what most recipients actually see.
- **Invitations send through SES, from `noreply@icecampus.com`.** Cognito's own sender is
  capped at 50 messages a day per account and arrives from an unrecognised amazonaws.com
  address. `inviteFromEmail` in `cdk.json` turns it on, and its absence falls back to the
  Cognito sender so a fresh region needs no verified domain to come up. eu-south-1 Cognito
  does accept an eu-south-1 SES identity, which is not true of every Cognito region.
- **Both secrets are referenced, never created.** `fromSecretNameV2` for
  `icecore/cloudfront-signing-key` and `icecore/openai-api-key` — they must exist *before*
  the first `cdk deploy`, and they come from `just keys` / `just openai-key`. Two traps:
  `just keys` refuses to run when `infra/cloudfront-public-key.pem` exists (a deliberate
  anti-rotation guard), so a fresh region cannot be bootstrapped without deleting the
  committed pem; and Secrets Manager is regional, so a second region deploys clean and 403s
  every content request. The committed public pem and its private half are a pair, and only
  one of them is in git.
- **Only the `admins` Cognito group can invite anyone**, and a pool with nobody in it is a
  lockout that arrives via a deploy that goes green. The bootstrap admin is `adminEmail` in
  `infra/cdk.json`, **not a `-c` flag**, for the reason the alarm email is not one: passed as
  a flag it has to be remembered on every deploy, and forgetting it once removes both
  bootstrap resources again — silently, from a deploy that goes green. That is survivable
  today only because neither has a delete handler and the admin already exists; on a pool
  that had just been replaced, the deploy that recreated it would create nobody. `just
  infra-deploy someone@icemalta.com` overrides it to bootstrap a different person; `just
  admins` lists who is in the group and `just grant-admin <email>` promotes someone on a pool
  that is already up. The bootstrap is idempotent — an existing user is promoted rather than
  failing the deploy — and has no delete handler, because tearing the stack down must not
  delete a person.
- **The pool declares `name` required, and a schema cannot be altered after the pool is
  created.** So every writer supplies one, forever - the invite Lambda and the CDK admin
  bootstrap both. Cognito rejects an `adminCreateUser` that omits it with an
  `InvalidParameterException`, which the bootstrap's `ignoreErrorCodesMatching:
  'UsernameExistsException'` does not catch. Default it to the email's **local part**, never
  the whole address: `TopBar` renders `name || email.split('@')[0]`, so a name that is always
  set means that fallback never runs and a student invited without one reads their own full
  email address in the corner of every page.
- **The web client has no `readAttributes` on purpose.** Unset means Cognito grants read on
  every standard attribute, which is what puts `name` and `email` in the id token. Setting it
  to add a custom attribute later stops implying the standard ones - list them too, or the
  name vanishes from the top bar and reads as a styling bug.
- AWS work needs `AWS_PROFILE=ice` (account 845106282768). The default profile is a different
  account that also has a GitHub OIDC provider installed, so a wrong-account `cdk diff`
  reports the whole stack as new rather than failing.

## Managing users

`AdminPanel.vue`, `UserDialog.vue`, `UserImport.vue` and `infra/lambda/admin/` — one route,
`/api/admin/users`, doing GET/POST/PUT/DELETE. It replaced a screen that could only ask "who
is on course X" and could only invite and unenrol.

- **Cognito owns identity; the table owns enrolment.** Name, email, sign-in status, enabled,
  and membership of `admins` are read back from the pool, never from a copy. The name is
  still echoed onto each `ENROL#` row as a cache, and PUT rewrites it on a rename — one fact
  in two places diverges unless something keeps them together.
- **The sub is not the username, and Admin\* calls take the username.** The pool signs in by
  email alias, so Cognito generated an opaque username of its own and `sub` is a separate
  attribute. Passing a sub where a username is wanted fails with `UserNotFound` on a user who
  plainly exists. `lookup()` resolves it with `ListUsers` filtered on `sub` — which also
  means a caller cannot mismatch a sub and an address into modifying one account in the pool
  and a different one in the table.
- **An admin sees every course, and it is derived rather than enrolled.** `App.vue` skips the
  enrolment filter when `session.admin` is set. Writing enrolment rows on promotion instead
  would be rows to withdraw on demotion and — the part that would actually rot — rows somebody
  has to remember to add for every course published afterwards. It is also not something the
  Lambda could do: it does not know which courses exist, for the same reason its listing
  queries per user. Same shape as `open`, against a boundary that was only ever about what is
  *shown* — the signed cookie covers the whole origin. Promotion takes effect on the next
  sign-in, with nothing to migrate. `preview.js` gives the admin role an **empty** enrolment
  list on purpose: a full one would let the grid look right while this rule was broken.
- **An admin may not unmake themselves.** Only the `admins` group can reach the function, so
  self-demotion or self-suspension is a lockout the app cannot undo — the fix is
  `just grant-admin`, run by somebody who still has rights. Blocking it also means the group
  can never be emptied here: demoting the last admin is always demoting yourself.
- **The listing is one query per USER, not per course.** Only the first is authoritative: the
  catalogue lives in the content bucket, assembled from every `card.json` in it, so this
  function does not know which courses exist — and somebody enrolled on a withdrawn course is
  still enrolled. It is also why the Admin function alone gets 30 seconds rather than 10. The
  listing is capped, and says `truncated` rather than letting a partial list read as the
  whole pool. `byCourse` therefore has no reader yet; it is kept for the admin panel's later
  pages, which are per course and so ask exactly the question it is shaped for.
- **Delete removes the account first and the rows second.** The other order leaves somebody
  who can still sign in with no progress, which reads to them as their work being lost; this
  order can at worst orphan rows keyed on a sub that signs in nowhere.
- **POST is additive, PUT is the whole desired set.** The CSV import runs POST once per row,
  and a row that happens not to mention a course must not take it away. Taking courses away
  is PUT's job, where the set is stated rather than implied.
- **The import's ticked courses are ADDED to every row**, not used to fill in only the rows
  whose `courses` column is blank. Both rules cover the common case - a class list with no
  courses column at all - and only this one can be stated in a sentence. The tick list is
  also shown before a file is chosen: gated on "some row has no courses" it was invisible in
  exactly the case it matters most, because a plain class list has no such column and so no
  rows to notice.
- **The import is one POST per row, sequential.** Each row is an `AdminCreateUser` and an
  email, both rate-limited; thirty at once is how an import half-succeeds with a throttling
  error that names none of the students it dropped. Sequential is also the progress bar.
- **A CSV line opening with `#` is a comment.** The template ends with the list of course ids
  written that way — a tutor cannot guess that a course is called `data-analyst-sql`, and an
  import whose course column is quietly wrong succeeds and leaves a class with an empty grid.
  The legend goes *under* the data: a comment before the header makes the header the second
  line, and every spreadsheet then imports the comment as its column names.
- **`preview.js` stubs all four methods, including both refusals.** `icecore dev --as admin`
  is the only way to look at this screen without a pool behind it, and a disabled control
  whose message cannot be reached locally is a message nobody reads before shipping.

## The Playground

A sandbox that appears as a course: an editor, no syllabus, no marking, and datasets a
student chooses to load. [`PLAYGROUND.md`](PLAYGROUND.md) is the design; what follows is the
part that constrains other work.

- **The platform owns everything but the manifest.** `icecore-playground` authors
  `content/playground.json` and its starter files, and nothing else. That keeps the rule
  intact in the one place it looks like an exception.
- **Datasets are borrowed by `{course, name}`, never copied** - the shape
  `loadDatasetSql(courseId, dataset)` already takes. A Python file is borrowed by
  `{course, module, name}`; it was `unit` until a DataCamp course stopped being a unit, and
  `readFiles` names the old field in its error so a manifest that has not caught up says
  why rather than reading as malformed. So the coupling is real and nothing
  local can see it: the playground repo does not have the data. Three checks in three
  places, none of which subsumes another - structure in `verify`, resolution and collisions
  in `verify` *with the lender's content dir passed*, and the load-bearing one against the
  bucket in the pipeline. **A lender that is not checked out is reported as skipped, never
  assumed fine.**
- **The pipeline check runs BEFORE the content sync**, so a playground borrowing something
  absent never reaches the bucket. Split deliberately: `icecore playground dist --lenders`
  names the courses, the workflow does the `aws s3 ls`, and `--sizes <listing>` resolves and
  **stamps the byte counts in**. The credentials stay in the workflow and the resolution
  stays in icecore - written as YAML it would live somewhere nothing tests. The published
  manifest therefore differs from the authored one, the same way `index.json` differs from
  the exercise markdown, and the picker's "13 MB" comes from the bucket rather than from
  anyone typing it.
- **A course is a playground because it has a manifest**, and it is `open` because
  `course.json` says so. Two different things: `playground` decides which screen renders,
  `open` decides whose grid it appears on without an enrolment row. Both derived from their
  own source, neither a flag beside the other. `open` is not a boundary - the signed cookie
  covers the whole origin, so enrolment has only ever decided what is *shown*.
- **Loading is additive, and that is why it is `exec`.** `db.js` caches a dumped data
  directory per dataset, which is right for an exercise and useless here: loading a dump
  *replaces* the database, so two cannot be merged. `playground-db.js` is the composed
  session. A set applies as one multi-statement simple query, which Postgres runs as one
  implicit transaction, so a collision rolls the whole set back and reports itself - **table
  collisions need no declaration and no parsing at runtime**. `soccer` and `pgdata` both
  define `country`, which is why there is no Postgres set yet.
- **Not `idb://`, and it was tried.** PGlite throws *"Database already exists, cannot load
  from tarball"* if `loadDataDir` meets an existing data directory, so persistence and the
  blank-dump reset are mutually exclusive; and two tabs on one idb store have no locking
  between them. Reset restores a dump taken while the database was empty - a cold `initdb`
  is seconds.
- **`DataGrid` is the only table renderer in the app**, and `ResultGrid` draws through it.
  Not for code size: a student browses a table, queries it, and compares the two by eye, so
  nulls and numeric alignment differing between panes reads as the query having changed
  something.
- **Prefix container classes inside `Playground.vue`.** `CodeEditor`'s own root is
  `class="editor"`, and Vue's scoped CSS reaches a child component's root - a bare `.editor`
  here hands a CodeMirror instance `display: grid`.
- **The browser has three sources and one answer.** `playground-browse.js` asks Postgres for
  a table, pandas for a frame, and plain JavaScript for a CSV - because Pyodide takes seconds
  to boot and the browser is most useful in exactly those seconds. So a CSV never goes
  through the interpreter, and only a `.feather` file and the student's own frames do. It
  follows that browsing `mpg.csv` and browsing `mpg` are different questions - the bytes on
  disk against what pandas made of them - which is a real difference and not the `DataGrid`
  inconsistency that file warns about.
- **Matching is a literal, case-insensitive substring in all three**, and that had to be
  chosen rather than inherited: Postgres defaults to LIKE patterns, JavaScript to a regex
  and pandas to a regex, so `100%` or `a.b` would find different rows depending on what the
  student happened to be browsing. `strpos`, `includes` and `regex=False` are the three
  spellings of one rule.
- **A pager needs a stable order and a bare SELECT has none.** Postgres may return the same
  row on page 2 and page 3 and omit another, which reads as the data being wrong rather than
  as the query being underspecified. `ORDER BY ctid` for a table - which is also the order it
  was loaded in - and `ORDER BY` every column for a view, which has no ctid and whose
  remaining ties are between identical rows.
- **Both counts, always**: how many rows are in the thing and how many match. A filtered
  count alone reads as a small table rather than as a narrow search.
- **JavaScript's `null` does not arrive in Python as `None`.** Pyodide hands it over as a
  `JsNull`, which is not `None` and is perfectly truthy - so `col is None` is false and the
  `int()` beside it raises. `undefined` *does* arrive as `None`, so the natural spelling
  passes wherever the argument is omitted and fails wherever it is passed explicitly. Test
  the other way round: `_ice_none` asks whether the value is a number.
- **No backticks anywhere inside `RUNTIME`.** It is a JavaScript template literal holding
  Python, and a backtick in a docstring - the natural way to quote an identifier in prose -
  ends the string, so the file stops parsing somewhere else entirely and esbuild reports a
  line number in the middle of the Python. The file says so at the top; it has now caught
  two people.

- **The language switch offers what the player can RUN**, not what the manifest declares.
  `RUNNABLE` in `Playground.vue`. A manifest is authored in another repo on another
  schedule and is allowed to be ahead of the platform; a tab that apologises is worse than
  one that is not there yet.

## Embedded apps

A prompt can host a self-contained static app: a line reading `::app <name>::`, optionally
`::app <name> height=720::`, renders an iframe. **`height=` is a floor, not a height** -
[`app/src/appframe.js`](app/src/appframe.js) measures the app and grows the frame past it
when the content needs more, so the authored number only has to be not-too-large. Sixteen
of the twenty-two shipped apps do exceed theirs, two of them by ~600px.

Every measurement is taken at the *same* reference height, the floor: set frame to floor,
read `scrollHeight`, write the answer back, all in one task so the reference is never
painted. Measuring at the frame's current height would be circular - these apps were built
to fill DataCamp's exercise pane, so what they report depends on what you gave them, and the
frame walks down the page a few pixels per redraw. Neutralising that instead would collapse
any chart with `flex: 1`. Checked against all 22: every one is a fixed point of the
reference measurement.

The watcher is installed once from `main.js`, not owned by a component: the `::app` markup
is produced by `md.js` and injected with `v-html` from several components and owned by none,
so a future component rendering prose would silently get fixed-height frames again. The app is a directory beside the exercise
at `content/exercises/<topic>/apps/<name>/` with its own `index.html`, mirrored to
`content/<course>/apps/<topic>/<name>/` at build time and shipped whole. `verify` fails on
a reference with no `index.html` behind it, the same way it does for a missing figure.

The iframe is sandboxed, but **with** `allow-same-origin`, and it has to be. Without it the
frame gets an opaque origin, its own assets become cross-origin requests to a host that
sends no CORS headers, and a module script — always fetched in CORS mode, `crossorigin`
attribute or not — can never load at all. Serving CORS headers instead works in dev and
403s in production: `/content/*` is behind the CloudFront key group and an anonymous
cross-origin fetch carries no cookies.

So the sandbox is worth keeping for the rest of its list — no top-level navigation, no
popups, no forms — but it does **not** isolate the app from the player. A mirrored bundle is
first-party code and has to be treated that way: read what it loads before shipping it.
`dc-pull-app` warns when one reaches a DataCamp host at runtime, which is the loudest
version of that check but not the only one worth doing.

It has to be an iframe and not inlined markup: these bundles bring their own framework, their
own stylesheet and their own opinion about what `body` looks like.

## Grading semantics

Result-set comparison, not pattern matching on SQL:

- Column count and names must match; row count must match.
- Row order matters **only** when the reference solution contains `ORDER BY`; otherwise rows
  compare as a multiset.
- Submissions containing DDL run against a throwaway database copy — a failed attempt must
  never leave the student's session broken. (Learned the hard way: grading originally ran
  the reference solution against the student's own database, which the `CREATE VIEW`
  exercise broke immediately.)
- `expected.rows` is capped at 1000; past the cap only columns and counts are checked.
- A step whose solution calls `now()`, `CURRENT_DATE`, `random()` and friends **must** be
  marked `### Nondeterministic`, and `verify` fails if it isn't. The marker is hand-written
  in the exercise, so a forced re-convert can wipe it -- without the check that would
  silently restore strict grading, and the failures would look like data problems. Note the
  worst case is not the step that fails at once but the one that matches a value precomputed
  the same day and goes red at midnight.
- A step marked `### Nondeterministic` is graded on columns and row count alone. Expected
  results are computed at build time, so anything resting on `now()` or `random()` can never
  match later. It is declared per step and never inferred from the SQL -- `now()` in a
  `WHERE` clause may still give a fixed result set, and one step of an exercise being
  unreproducible says nothing about its siblings.

**Python is graded by DataCamp's own SCT, not by us.** A module 2 exercise carries a
`### Check` holding a `pythonwhat` program, and the platform *executes* it rather than
interpreting it — see [`app/src/python.js`](app/src/python.js). Reimplementing
`has_equal_ast`, `check_args` and thirty-five siblings would mean owning DataCamp's edge
cases forever; measured across module 2, all 37 SCT functions used are real pythonwhat API
and none is custom.

- **The runtime is current and the content adapts, never the reverse.** When an exercise
  fails because a library moved on — pingouin renaming `p-val` to `p_val`, pandas rejecting
  a weighted `sample(replace=False)` — fix the exercise. Pyodide bundles exactly one pandas,
  so DataCamp-era parity is not available at all, and chasing it per-library buys a
  mixed-era stack plus a dead API taught as current.
- **Both runs are seeded, and must be.** pythonwhat runs the solution and the submission in
  separate interpreters and compares what each produced, so unseeded `np.random` makes a
  reference solution fail against *itself*. Seeding is not the SQL `### Nondeterministic`
  problem in disguise: nothing here is precomputed, but the two runs still have to agree
  with each other. `seed:` names another value, `seed: none` disables it.
- **`mode="stub"` is the only mode that works** — the default builds a
  `multiprocessing.Process` and WASM has no `_multiprocessing`. pythonwhat's own source
  calls stub "no isolation" and means it: the submission runs in the same interpreter as the
  grader. Same trust model as the SQL editor, and not good enough for a summative mark.
- `run_exercise` returns four values with the **solution** process first, the reverse of the
  order `test_exercise` names its parameters. Backwards, it grades the submission against
  itself and passes everything.
- **Nothing is precomputed.** The interpreter is already up and a check is ~20ms, so grading
  is live. What the builder does instead is *validate*: every reference solution is graded
  against its own SCT, and one that does not mark itself correct fails the build.
- **That validation is only half the question**, and `python-worker.mjs` can now be asked the
  other half. A step may carry its own `submission` and `expect: 'incorrect'`, and the step
  then fails if the SCT marks that submission correct. Validating the solution against itself
  asks whether a check ACCEPTS the right answer; a `### Check` holding only
  `success_msg("ok")` passes that and accepts everything, which is exactly what refusing a
  *missing* check exists to prevent. `ppf-sct-probe` in the importer drives it, grading an
  empty submission against every exercise in a course.
- **A step with a Solution and no `### Check` accepts every submission.** That is the failure
  that gets worse the later it is found, so the build refuses to produce it — as it does a
  `type: coding` exercise with neither a `dataset:` nor an SCT.
- Only pythonwhat and its two non-bundled companions are vendored, under `app/py/`;
  everything else comes from the jsDelivr CDN, which is what DataCamp's own player does.
  They are **build assets, not `public/`** — `icecore dev` points Vite's publicDir at the
  course's staging directory, so the app's own `public/` is never served.
- **A `WHEELS_BY_NAME` value may be a list, and then it is in install order with
  dependencies first.** micropip resolves each install independently and would otherwise
  fetch the dependency from PyPI, which is the one bit of network trust vendoring exists to
  avoid. `openpyxl` needs `et_xmlfile`, so asking for openpyxl brings both. The map is keyed
  by *module* name because the Playground looks a wheel up by what the student tried to
  import — which is why `et_xmlfile` is also listed alone. `wheelsFor()` is the one reader.

### What a run gives back

A graded step is marked by its SCT, but a student also has to be able to see what their code
did. Both are collected by the same bridge and both are **opt-in**: `grade()` takes
`capture`, defaulting to false, so the builder runs exactly the code it ran before any of
this existed and a cached verdict keeps meaning what it meant. `test/python-artefacts.mjs`
(`npm run test:python`) covers all of it end to end against real Pyodide.

- **Figures are collected in the SETUP, not around the run.** The backend is Agg, so
  `plt.show()` produces nothing a student can see and an exercise that plots looks like an
  exercise that does nothing. But grading runs the **solution first and the submission
  second**, in one interpreter — see `pythonwhat.local.run_exercise` — so afterwards
  matplotlib's registry holds both runs' figures with nothing to tell them apart. The fix is
  a prologue prepended to the setup, which `run_single_process` executes before *each* side:
  by the time the submission's setup has run, the solution's figures are already closed.
- **It closes rather than records a baseline**, and that is the difference between working
  and not. An exercise whose setup does `fig, ax = plt.subplots()` and asks the student to
  draw into `ax` must still show that figure, so the baseline has to be empty where the setup
  *starts* rather than where it ends.
- **The setup can't see the bridge's names.** pythonwhat execs it in a namespace of its own,
  so the prologue reaches back through `import __main__` rather than calling a helper
  directly.
- **Files written are collected on Run and never on Check.** Both sides of a grade write to
  one working directory and the solution goes first, so a submission writing the same bytes
  the solution just wrote leaves the file untouched and would be reported as having written
  nothing. Run executes no solution, so there it is honest.
- **Run no longer grades the submission against itself.** It used to, so that what the
  student saw printed was what the SCT would look at, and it threw the verdict away. That ran
  their code *twice* — which is what made written files undetectable on the second pass. It
  now calls pythonwhat's own `run_single_process` in the same stub mode and working directory
  grading uses, so the guarantee survives without the second execution.
- **File bytes are read out of `pyodide.FS`, not returned through the bridge.** Python hands
  back names only; base64ing a quarter-megabyte workbook across the boundary buys nothing
  when the filesystem is right there. Capped at 8 files and 25MB each.
- **A figure gets a literal white plate**, like a figure in prose and an embedded app.
  matplotlib draws for a light page whatever the player is wearing, and a dark plate under
  dark axis labels reads as a broken chart rather than a themed one.

**Not everything is graded by result set.** `dragdrop` exercises have no SQL and no
dataset: they're graded structurally by `app/src/dragdrop.js`, which is pure and shared with
the CLI the same way `compare.js` is. Don't route them through PGlite or give them
precomputed expected results — `verify` validates their *content* instead (every item in
exactly one zone, nothing duplicated).

**Reference solutions ship to the browser, deliberately.** This reversed an earlier rule.
These assessments are formative, not summative, and the player offers a "show answer"
affordance anyway, so hiding the solution bought almost nothing while forcing a private
server-side content artifact and a fatter hint service. `build` writes `solution` and the
`checks:` frontmatter into `index.json`; the hint Lambda gets everything from the client.
Don't re-strip it.

## Gotchas

- **`content/data/` holds two unrelated kinds of thing, and the NAME says which.** A SQL
  dataset is `<name>.sql` or a `<name>/` directory of `.sql`; a `module-<n>/` directory is
  the loose `.csv`/`.p`/`.feather` files a Python exercise opens by bare filename, mounted
  beside it at runtime. Both kinds can be directories, so the shape tells you nothing. This
  used to be `2.4/` matched by `/^\d+\.\d+$/` — "shaped like a unit number, which is not
  something anyone would call a dataset" — and the files belong to a whole DataCamp course,
  which is a module now, so that pattern would have to become a bare `4/`. A lone digit is a
  far weaker claim to not-a-dataset than a dotted pair was, so the kind went into the name.
  Getting it wrong makes a dataset vanish, and a missing dataset surfaces much later as an
  exercise reporting that a table does not exist.

- **`'globalThis.process.env': 'undefined'` in `app/vite.config.js` is load-bearing**, and it
  looks like a no-op. Vite defines `globalThis.process.env` as `{}` for a client build, `{}`
  is truthy, and PGlite guards a save/restore of Node's exit code with exactly
  `globalThis.process?.env && (saved = process.exitCode)`. Folded to a constant the guard
  passes, the bare `process` beside it throws, and one of the four sites is inside PGlite's
  own init — so **every SQL exercise dies with `process is not defined` the first time it
  boots a database**. Vite's define pattern rewrites `.` as `\??\.`, so the optional
  chaining does not save it. **Dev cannot catch this**: `vite:define` returns early for a
  client transform when the command is not `build`. A bug that exists only in the artefact
  nobody runs locally — which is the argument for grepping the built bundle, not reloading
  the dev server, after touching `define`.
- **A deck can build clean and ship a blank control bar**, and it has done, twice. Slidev's
  nav buttons are nothing but `<div class="i-carbon:arrow-left">`; UnoCSS is meant to turn
  that class into a mask-image and does not, because the classes live inside
  `@slidev/client` — in node_modules, outside UnoCSS's scan. `slidev-theme-ice` carries a
  `uno.config.ts` that walks the client, collects every `i-<collection>:<name>` and injects
  the generated CSS as a preflight. **That file is not in the theme's `files` allowlist, so
  npm never packs it**: a clean `npm ci` simply does not have it, the deck builds and exits
  0, and the six transport controls render as empty boxes. The allowlist foot-gun `just
  deploy` documents, in a place where forgetting is invisible rather than loud. `icecore
  slides` now fails a deck whose CSS holds no `i-carbon` rule — 54 when it works, 0 when it
  does not, so it is not a threshold. The real fix is one line in the theme repo.
- **`icecore slides` clears a deck's output directory first.** `slidev build` writes into it
  without emptying it, so a rebuild leaves the previous run's hashed assets behind to be
  published — and a stale stylesheet made the icon check above pass on output the run had
  not produced, which is how the check first appeared to work when it did not.
- **Slidev hides its own nav bar on a wide screen**, and the theme puts it back —
  `slidev-theme-ice/styles/nav.css`. `persistNav` is `height - width / (16/9) > 120`, a
  presenter's rule that lands on a knife edge for real windows: the player's slides pane is
  persistent, 1080p fullscreen is hover-only, and a maximised laptop falls either side of it
  depending on the browser chrome. The bad case is Slidev's own fullscreen button — it takes
  the viewport to exactly 1080p, hiding the control that would take you back out, with
  nothing on screen to say Escape works.
- `@electric-sql/pglite` must stay in `optimizeDeps.exclude` — it ships wasm and breaks if
  pre-bundled. Every contrib entry point needs its own entry too: `exclude` matches the
  import specifier, not the package.
- **Contrib extensions live in [`src/extensions.mjs`](src/extensions.mjs)** — one list, used
  by all three PGlite call sites and by `vite.config.js`'s `optimizeDeps.exclude`. Adding one
  is a single line there. They must be registered on *every* instance, not just the one that
  seeds a dataset: a data dir dumped with an extension installed still fails to load without
  the wasm module present (`could not access file "$libdir/tablefunc"`).
- Registering an extension also makes it appear in `pg_available_extensions`, with
  `installed_version` set only once `CREATE EXTENSION` has run — so that catalogue reflects
  the list above, not the ~30 a stock PostgreSQL server offers.
- **Don't register all 32 bundled extensions.** Each is emitted as a separate browser asset
  and they total ~2.1MB (pgcrypto alone is 1.1MB), plus ~220ms per instance boot against
  ~45ms for the current three.
- Booting a PGlite instance is slow (seconds in Node). That's why expected results are
  precomputed at build time rather than graded live; don't reintroduce per-check database
  creation.
- **Precomputed results are cached on disk** by [`src/expected-cache.mjs`](src/expected-cache.mjs),
  under the course's gitignored `.icecore/cache/expected/`. Cold that pass is ~218s for the
  Data Analyst course; warm it is ~0.9s, which is the difference between `icecore dev` being
  usable and not. The key is per **exercise** - dataset content, setup, and every step's
  solution and `nondeterministic` flag, plus the installed PGlite version - because steps of
  one exercise share a database and a per-step key would hit on step 3 after step 2's
  `INSERT` changed the rows underneath it. Failures are cached too, and replay goes through
  the same `record()` as a fresh computation so a warm run and a cold run cannot report
  different numbers. `ICECORE_NO_CACHE=1` bypasses it.
- **A cached entry must name the runtime that produced it.** The SQL entries carry the
  installed PGlite version; the Python ones carry the Pyodide version and the grader wheel
  filenames, because a Python entry is a *verdict* — "this solution grades itself correct" —
  and bumping Pyodide moves pandas, numpy, scipy and matplotlib underneath a key that would
  otherwise never notice. That is a green build asserting something nothing checked. Scoped
  to the wheels an exercise actually loads, so bumping pingouin doesn't recompute seaborn.
- **CI caches `.icecore/cache` between runs**, so a runner no longer regrades the whole
  course for a one-line copy edit — that was 13 of 19 minutes. The key is rolling
  (`…-${{ github.sha }}` plus a `restore-keys` prefix) because a GitHub cache entry is
  immutable and an exact hit never saves: a fixed key freezes the first cache forever and
  every exercise written after it misses for good. Safety doesn't rest on that key at all —
  entries are content-addressed, so a restored entry that no longer describes its exercise
  isn't misread, it isn't found.
- **Signed cookies covering more than one file need a *custom* policy.** Passing
  `dateLessThan` to `getSignedCookies` yields a canned policy, which CloudFront rebuilds
  from `CloudFront-Expires` and the URL being requested — so a signed `…/*` matches nothing
  and every request 403s, with cookies that look entirely correct. Build the policy JSON and
  pass `policy`; the giveaway is whether the cookies carry `CloudFront-Policy` (custom) or
  `CloudFront-Expires` (canned).
- **The session Lambda cannot learn the site's domain from the `Host` header.** `/api/*`
  uses CloudFront's `AllViewerExceptHostHeader` origin request policy — required for an API
  Gateway origin — which replaces the viewer's `Host` with the API's own domain. Signing
  cookies for that host produces cookies that look perfectly valid and make every content
  request 403. The client sends its `location.origin` instead. It can't be an environment
  variable: the distribution depends on the API, which depends on the function.
- **An exercise's `## Setup` SQL has to be applied in both places** — at build time before
  precomputing expected results, and in the player before the student's query runs.
  Build-time only means an exercise that graded fine tells the student the table doesn't
  exist. It's applied to a *copy* of the seeded dataset and dumped, never by booting a
  fresh instance, and everything the player caches downstream of a dataset is keyed by the
  setup too: two exercises on one dataset can define the same table name differently.
- **Only a ```sql fence in `## Setup` is setup.** That section also holds DataCamp's Python
  `connect()` line in most imported exercises. `codeIn` matches any language; `sqlIn` is the
  one to use here.
- **Drag-and-drop item ids must be unique across the whole exercise**, not per zone.
  Grading matches a placement to an item by id, so two zones each owning an `avg` would let
  an item dropped in the wrong zone score as correct in both. `withIds` takes a shared
  `used` map for exactly this, and `validate()` re-checks it as a backstop — the check looks
  redundant and is not.
- **A figure's filename must not contain a space**, and `dc-convert` slugifies on the way in
  for that reason. The image rule and the builder's missing-figure check both tolerate one
  now, but a space used to make the rule miss entirely: the reference fell through to the
  link rule, rendered as a stray `!` in front of a hyperlink, and the check that exists to
  catch a dropped figure skipped it for the same reason. Three of DataCamp's assets were
  named that way.
- Run `icecore verify` against a real course repo after touching the builder or the grader.
  It's the only end-to-end check.
