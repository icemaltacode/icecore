# Keith's notes

So the queue is: 
- [ ] 1.7's 34 exercises, 
- [ ] the 11 image ones, 
- [ ] the 5 broken published ones, 
- [ ] then the 9 presentation apps
- [ ] then the 19 interactive apps,

## Images in questions

Does it work today? No. md.js had a link rule but no image rule, so ![alt](x.png) rendered as a literal ! followed by a link — and nothing served the file. It works now, verified in a browser: the image element renders, the request returns 200, and the bitmap actually decodes.

Where they live — your proposed shape, unchanged:


content/exercises/<topic>/images/venn.png     →  dist/content/<course>/images/<topic>/venn.png
Referenced by bare filename: ![Venn diagram](venn.png). The markdown never names the course or the deployment path — the player resolves it against the topic's image directory. Absolute and http(s):// sources pass through untouched.

Putting them under content/ answers your deploy concern: that path is already behind the CloudFront key group and already carried by the content sync, so figures inherit private access and CI publishing for free. No change to publish.yml, the distribution, or the cookie scoping. Only referenced files ship — I left an unused PNG in the fixture and it was correctly skipped.

Size — no concern at that scale. They're fetched per-exercise by the browser, not bundled, so they cost nothing until someone opens the exercise.

One addition beyond what you asked, because it's the actual bug: a reference with no file behind it fails verify. A missing figure is invisible otherwise — the prompt still reads plausibly and the exercise still grades correctly, which is precisely how five exercises reached production with their diagrams gone. build also reports an image count in its summary line.

So for 1.10 and 1.11, ship the images alongside and verify will tell you if any reference is dangling.

One thing worth deciding on your side: alt text. I render it, and for "Interpreting histograms" the alt text is the difference between a screen-reader user having an exercise and having nothing. Worth writing properly rather than letting the converter emit ![](fig1.png).

## The 28 embedded-app exercises

**All 28 are rippable.** The apps are public static bundles — no login, no API — at a
predictable URL: `content-embedded-apps.datacamp-learn-apps.com/course/<course_id>/<app>/index.html`.
Each is an 882-byte shell plus a ~220KB JS bundle, a stylesheet and two fonts. `curl` gets
them today.

Two routes, and the split falls exactly along course lines:

- **Presentation (9, all in 1.11)** — the widget only reveals or compares fixed content.
  The text sits in the JS bundle as plain strings, so lift it into the exercise prompt and
  the question becomes an ordinary MCQ. No platform work.
- **Interactive (19, all of 1.7 and 1.10)** — the widget recomputes or redraws from input
  and the answer depends on what changed. Mirror the bundle into the course repo and embed
  it. Needs the platform to host an app inside an exercise, and a decision on shipping
  DataCamp's brand fonts.

Counts were 22 until 1.7 was checked: it was written off as slides-only but holds 6 apps,
plus 34 drag-and-drop and MCQ exercises nobody has ripped.

| Topic | Chapter > Exercise | URL | App | Type | Can we rip it? |
|---|---|---|---|---|---|
| 1.7 | Summary Statistics > Choosing a measure | [open](https://campus.datacamp.com/courses/introduction-to-statistics/summary-statistics-8a336d12-cf3c-4ac9-877b-581087f672cd?ex=7) | `mean-median-explorer` | Interactive | Yes — mirror the bundle, embed it |
| 1.7 | Summary Statistics > London Boroughs with most frequent crimes | [open](https://campus.datacamp.com/courses/introduction-to-statistics/summary-statistics-8a336d12-cf3c-4ac9-877b-581087f672cd?ex=8) | `borough-crime-ranker` | Interactive | Yes — mirror the bundle, embed it |
| 1.7 | Probability and distributions > Chances of the next sale being more than the mean | [open](https://campus.datacamp.com/courses/introduction-to-statistics/probability-and-distributions?ex=3) | `probability-calculator` | Interactive | Yes — mirror the bundle, embed it |
| 1.7 | Probability and distributions > Sample mean vs. Theoretical mean | [open](https://campus.datacamp.com/courses/introduction-to-statistics/probability-and-distributions?ex=9) | `sample-mean-simulator` | Interactive | Yes — mirror the bundle, embed it |
| 1.7 | More Distributions and the Central Limit Theorem > Visualizing sampling distributions | [open](https://campus.datacamp.com/courses/introduction-to-statistics/more-distributions-and-the-central-limit-theorem-bed4b331-74c3-4827-a96f-9954c24ecf4e?ex=11) | `clt-visualizer` | Interactive | Yes — mirror the bundle, embed it |
| 1.7 | Correlation and Hypothesis Testing > Identifying correlation between variables | [open](https://campus.datacamp.com/courses/introduction-to-statistics/correlation-and-hypothesis-testing?ex=9) | `correlation-explorer` | Interactive | Yes — mirror the bundle, embed it |
| 1.10 | Visualizing distributions > Adjusting bin width | [open](https://campus.datacamp.com/courses/understanding-data-visualization/visualizing-distributions?ex=6) | `histogram-bin-width` | Interactive | Yes — mirror the bundle, embed it |
| 1.10 | Visualizing distributions > Ordering box plots | [open](https://campus.datacamp.com/courses/understanding-data-visualization/visualizing-distributions?ex=9) | `box-plot-ordering` | Interactive | Yes — mirror the bundle, embed it |
| 1.10 | Visualizing two variables > Trends with scatter plots | [open](https://campus.datacamp.com/courses/understanding-data-visualization/visualizing-two-variables-2?ex=3) | `scatter-trend-lines` | Interactive | Yes — mirror the bundle, embed it |
| 1.10 | Visualizing two variables > Interpreting bar plots | [open](https://campus.datacamp.com/courses/understanding-data-visualization/visualizing-two-variables-2?ex=8) | `bar-plot-explorer` | Interactive | Yes — mirror the bundle, embed it |
| 1.10 | Visualizing two variables > Sorting dot plots | [open](https://campus.datacamp.com/courses/understanding-data-visualization/visualizing-two-variables-2?ex=12) | `dot-plot-sorting` | Interactive | Yes — mirror the bundle, embed it |
| 1.10 | The color and the shape > Another dimension for scatter plots | [open](https://campus.datacamp.com/courses/understanding-data-visualization/the-color-and-the-shape?ex=2) | `scatter-dimensions` | Interactive | Yes — mirror the bundle, embed it |
| 1.10 | The color and the shape > Another dimension for line plots | [open](https://campus.datacamp.com/courses/understanding-data-visualization/the-color-and-the-shape?ex=3) | `line-dimensions` | Interactive | Yes — mirror the bundle, embed it |
| 1.10 | The color and the shape > Eye-catching colors | [open](https://campus.datacamp.com/courses/understanding-data-visualization/the-color-and-the-shape?ex=5) | `color-perception` | Interactive | Yes — mirror the bundle, embed it |
| 1.10 | The color and the shape > Qualitative, sequential, diverging | [open](https://campus.datacamp.com/courses/understanding-data-visualization/the-color-and-the-shape?ex=6) | `color-scale-selector` | Interactive | Yes — mirror the bundle, embed it |
| 1.10 | The color and the shape > Highlighting data | [open](https://campus.datacamp.com/courses/understanding-data-visualization/the-color-and-the-shape?ex=7) | `data-highlighting` | Interactive | Yes — mirror the bundle, embed it |
| 1.10 | 99 problems but a plot ain't one of them > Bar plot axes | [open](https://campus.datacamp.com/courses/understanding-data-visualization/99-problems-but-a-plot-aint-one-of-them?ex=5) | `bar-plot-axes` | Interactive | Yes — mirror the bundle, embed it |
| 1.10 | 99 problems but a plot ain't one of them > Dual axes | [open](https://campus.datacamp.com/courses/understanding-data-visualization/99-problems-but-a-plot-aint-one-of-them?ex=6) | `dual-axes-explorer` | Interactive | Yes — mirror the bundle, embed it |
| 1.10 | 99 problems but a plot ain't one of them > Multiple plots | [open](https://campus.datacamp.com/courses/understanding-data-visualization/99-problems-but-a-plot-aint-one-of-them?ex=9) | `multi-plot-dashboard` | Interactive | Yes — mirror the bundle, embed it |
| 1.11 | Storytelling with Data > Diagnose the data story | [open](https://campus.datacamp.com/courses/data-communication-concepts/storytelling-with-data?ex=3) | `story-snippet-analyzer` | Presentation | Yes — lift the text, ship as a plain MCQ |
| 1.11 | Storytelling with Data > Translate for the marketing director | [open](https://campus.datacamp.com/courses/data-communication-concepts/storytelling-with-data?ex=5) | `jargon-translator` | Presentation | Yes — lift the text, ship as a plain MCQ |
| 1.11 | Storytelling with Data > Choose the right chart | [open](https://campus.datacamp.com/courses/data-communication-concepts/storytelling-with-data?ex=10) | `chart-type-explorer` | Presentation | Yes — lift the text, ship as a plain MCQ |
| 1.11 | Preparing to Communicate the Data > Show the right numbers | [open](https://campus.datacamp.com/courses/data-communication-concepts/preparing-to-communicate-the-data?ex=6) | `metric-type-explorer` | Presentation | Yes — lift the text, ship as a plain MCQ |
| 1.11 | Preparing to Communicate the Data > Spot the redesign gap | [open](https://campus.datacamp.com/courses/data-communication-concepts/preparing-to-communicate-the-data?ex=9) | `chart-redesign` | Presentation | Yes — lift the text, ship as a plain MCQ |
| 1.11 | Structuring Written Reports > Pick the right report | [open](https://campus.datacamp.com/courses/data-communication-concepts/structuring-written-reports?ex=3) | `report-format-comparison` | Presentation | Yes — lift the text, ship as a plain MCQ |
| 1.11 | Structuring Written Reports > Spot the writing gap | [open](https://campus.datacamp.com/courses/data-communication-concepts/structuring-written-reports?ex=9) | `sentence-cleanup` | Presentation | Yes — lift the text, ship as a plain MCQ |
| 1.11 | Building Compelling Oral Presentations > Choose the purpose | [open](https://campus.datacamp.com/courses/data-communication-concepts/building-compelling-oral-presentations?ex=2) | `presentation-purpose-explorer` | Presentation | Yes — lift the text, ship as a plain MCQ |
| 1.11 | Building Compelling Oral Presentations > Finish the slide | [open](https://campus.datacamp.com/courses/data-communication-concepts/building-compelling-oral-presentations?ex=7) | `slide-redesign` | Presentation | Yes — lift the text, ship as a plain MCQ |


# icecore backlog

Working notes for taking the platform from a local static player to a hosted, authenticated
product. Decisions that are settled are recorded here so they don't get re-litigated;
open questions are marked as such.

## Decisions taken

- **Reference solutions ship to the browser.** Reversed from the original design. These
  assessments are formative, not summative, and students get a "show answer" affordance
  anyway — hiding the solution bought almost no pedagogical value and cost a private
  server-side content artifact, a second bucket, and a fatter hint Lambda. DataCamp's own
  frontend API exposes solutions the same way.
- **Slides are linked as Slidev HTML, not PDF**, built one deck per unit so the deck
  granularity matches the exercise granularity and no slide numbers are hard-coded.
- **Infrastructure as code is AWS CDK.** Not Serverless Framework — this is a
  distribution-and-auth problem with a few small functions attached, not a functions
  problem, and V4's licence key is friction for no gain. SST v3 was the runner-up.
- **API Gateway HTTP API (v2), not REST.** Cheaper, and it validates Cognito JWTs natively
  without a custom authorizer.
- **The hint Lambda calls the OpenAI API**, on cost grounds.
- **No content versioning.** Everyone is always on latest. A typo fix reaches a
  mid-course cohort immediately, which is the intended behaviour.
- **No instructor/student-progress view for now.** The only admin surface built is the
  minimum needed to onboard people: send registration invitations and assign users to
  courses. Reporting can come much later.
- **Iframe focus between the deck and the editor is not a problem worth solving** — a
  mouse click moves focus, and that's sufficient.
- **One environment only.** No dev/staging/prod split — `just deploy` publishes live.
- **The app deploys manually, content deploys through CI.** `just deploy` is the only thing
  that publishes the player itself; the course repos' workflow publishes content and decks
  and assumes the app is already there. Keeping the app out of CI means a content push can
  never change the player under a cohort, but it does mean a fresh bucket needs one manual
  deploy before anything works.
- **`just` is the task runner.** Recipes live in `Justfile` at the repo root and export
  `AWS_PROFILE=ice`.
- **Signed cookies are scoped to the whole site, not per course.** One cookie set for
  `/*`, so any signed-in user could fetch any published course's files directly; enrolment
  governs what the UI offers, not what the CDN serves. The threat model is "not public on
  the internet", not "student A must not read course B", and per-course scoping would mean
  a re-sign every time someone switched course.
- **AWS access is via the `ice` CLI profile**, which resolves to **eu-south-1**. The CDK
  entry point refuses to run without a resolved account and region rather than falling back
  to a default — the secrets live in the profile's region, and a stack deployed elsewhere
  fails at runtime, not at deploy.

## Open questions

Nothing outstanding. Questions resolved here move up into *Decisions taken*.

---

## Frontend

- [x] **Wide result sets scroll horizontally instead of widening the window.** Not a
      `ResultGrid` bug — it already set `overflow: auto` and `white-space: nowrap`. The
      cause was the CSS grid/flex `min-width: auto` default letting a wide table push its
      track wider. Fixed by capping the content tracks with `minmax(0, 1fr)` in `.shell`
      and `.coding`, and adding `min-width: 0` to `.work` and `.result-pane`.
- [x] **Show-answer affordance** on coding exercises. Sits beside the hint in the brief
      pane, reveals the current step's solution and offers to copy it into the editor.
      Ungated: the hint is ungated too, and any gate is one dummy "Check answer" away from
      being bypassed, so it would have been theatre. One `v-if` to change if that's wrong.
- [x] **Slides panel.** A **Slides** button in the footer — shared by every exercise type —
      opens the current unit's deck in a pane beside the exercise, following the student as
      they cross into the next unit. Same origin, so the signed cookies that unlock content
      unlock the deck too.
- [x] **Tutor hints in the exercise UI** — "Ask a tutor" beside the static hint, with
      thinking, error and rate-limit states. Hidden entirely where auth is off, since there
      is no API to call. Not offered on multiple-choice steps: a nudge on a three-way choice
      is just the answer.

## Builder / CLI

- [x] **Per-exercise setup SQL.** A `## Setup` section with a ```` ```sql ```` fence builds
      the derived tables an exercise needs on top of its dataset. Needed because the same
      table name means different rows in different exercises, which no shared dataset can
      express. Applied to a copy and dumped once, in the builder and in the player alike;
      the player keys its cached databases by the setup so two exercises can't leak tables
      into each other. Non-SQL fences are ignored, so the Python `connect()` line that most
      imported exercises carry stays inert.
- [x] **Multiple-choice steps inside a coding exercise.** `### Options` in a step makes it
      multiple-choice, `### Solution` makes it a query, and one exercise can mix them.
      `verify` now fails a step carrying neither or both — the case that let an exercise
      ship with its final question silently dropped while its other steps passed.
- [x] **`dragdrop` exercise type** — `order` (drag into sequence) and `classify` (sort into
      named zones). Schema is in `README.md`; grading and content validation live in
      `app/src/dragdrop.js`, pure and shared with the CLI like `compare.js`. Neither flavour
      touches PGlite. Three exercises in the Data Analyst course were waiting on this.

- [x] **`build` no longer strips `solution`.** `checks:` already shipped — it is
      frontmatter, so it rode along in the exercise object. `verify` was unaffected; it
      builds the same model in memory. `just verify` passes 10/10 with the negative control
      still rejecting a wrong query.
- [x] **`CLAUDE.md` and `README.md` rewritten** — both stated the never-ship rule as hard
      architecture and would have had a future session undo the change. The README's
      "version the content path" advice is gone too, and its deployment note now points at
      Cognito and signed cookies.
- [x] **Decks are discovered, not declared** — a unit has one when
      `content/slides/<unit>/index.html` exists. `slides:` in `_unit.json` still overrides
      with an absolute URL for a deck hosted elsewhere.
- [x] **`slides:build` exists in the course repo** and builds one deck per unit entry.
- [x] **Decks publish with the content** — `build` copies `content/slides/<unit>/` to
      `dist/slides/<unit>/`, so a deck and its exercises deploy together behind the same
      auth.

## Backend

- [x] **Session endpoint** — `POST /api/session` returns signed cookies plus the caller's
      enrolments and whether they're an admin.
- [x] **Hint Lambda** — `POST /api/hint`. The client sends the exercise, the reference
      solution, the student's query and whatever the grader last said; the function adds the
      key and the tutoring prompt. No content server-side, so nothing to keep in sync.
      **Not streamed**: response streaming needs a Lambda Function URL, and everything here
      goes through API Gateway behind the one distribution. A hint is a paragraph.
- [x] **Per-student rate limiting** — one atomic DynamoDB counter per student per day,
      swept by the table's TTL. Default 40/day, set with `-c hintsPerDay=`.
- [x] **Progress API** — `GET/PUT /api/progress`, keyed on the caller's own Cognito sub
      so the request can't name someone else. The client writes locally first and syncs,
      so a failed call never blocks practising and never loses a tick.
- [x] **Enrolment API** — folded into the admin endpoint below; students get their
      enrolments from `POST /api/session`, so there was nothing separate left to build.

## Admin (minimal)

Onboarding only. No progress reporting, no cohort dashboards — see *Decisions taken*.

- [x] **Invite and enrol are one call.** `POST /api/admin/enrolments` takes an email and a
      course: it finds the Cognito user or creates them (which sends the invitation email
      with a temporary password), writes the `PROFILE` row and the `ENROL#<course>` row.
      They were separate items until it became obvious nobody is created without a course
      to sit on.
- [x] **Restricted to admins** by the `cognito:groups` claim, checked inside the function —
      a JWT authorizer can't see groups, so this can't live in API Gateway.
- [x] **A screen to drive it**, shown in the sidebar only to admins: pick a course, invite
      by email, see and remove who's on it. No reporting, as agreed.

## Data

- [x] **DynamoDB single table.** `pk = USER#<sub>`, `sk = PROFILE | ENROL#<course> |
      PROG#<course>#<exercise>` — progress is per *exercise*, not per unit as first
      sketched, because that's the grain the player already tracks. On-demand, point-in-time recovery on, retained on stack
      delete. Cognito remains the account store — this holds everything *about* accounts.
- [x] **`byCourse` GSI** — the key schema inverted, so "who is on course X" is one query.

## Infrastructure (CDK)

The CDK app lives in `infra/`, JavaScript to match the rest of the repo. `just infra-synth`
passes; nothing has been deployed. Everything reaches students through **one** CloudFront
distribution — the app at `/`, the API at `/api/*`, content at `/content/*` and decks at
`/slides/*` — which is what makes the API same-origin, so there is no CORS to configure and
the session endpoint can set cookies that content requests will actually send.

- [x] **Static site**: private S3 bucket behind CloudFront with origin access control.
- [ ] **Custom domain** via Route 53 + ACM. Not wired: the stack works on the CloudFront
      domain, and the session Lambda signs for whatever host it was called on, so adding a
      domain later needs no code change.
- [x] **Content bucket stays private.** `/content/*` and `/slides/*` sit behind a
      CloudFront trusted key group; the `POST /api/session` Lambda trades a valid Cognito
      token for signed cookies. See the open question above on how tightly they're scoped.
- [x] **`just keys` has been run.** The signing pair is in Secrets Manager as
      `icecore/cloudfront-signing-key`, the public half is at
      `infra/cloudfront-public-key.pem`, and the two were checked to actually pair.
- [x] **Cognito user pool**, invite-only (self sign-up off), with an `admins` group, an
      SRP web client and the invitation email template.
- [x] **Sign-in screen in the player**, with the first-login password change that invited
      students always hit. `POST /api/session` runs before the first content fetch, and the
      course list is filtered to the caller's enrolments. Auth is *optional*: the app reads
      `auth.json` at boot and runs open when it isn't there, so `just dev` and course
      authoring need no AWS account. `just deploy` writes that file from the stack outputs.
- [x] **HTTP API** with a Cognito JWT authorizer, routed through the distribution.
- [x] **Secrets**: `just openai-key` stores the key in Secrets Manager, reading it from
      stdin so it stays out of shell history. Still to be run.
- [x] **Hint call confirmed against the deployed stack.** `gpt-5.6-luna` at `low` reasoning
      effort on `/v1/chat/completions` with `max_completion_tokens` — every parameter
      accepted, a usable nudge returned first time. The empty-submission guard fires before
      the counter is spent, and the rate-limit row carries a TTL three days out.
- [x] **CloudWatch** — a month's log retention on every function, plus five alarms: one per
      Lambda for unhandled errors (each answers its own error cases with a status code, so a
      thrown error is a bug) and one for CloudFront 5xx. Deliberately sparse. They go
      nowhere until you deploy with `-c alertEmail=someone@icemalta.com`.

## Publishing pipeline

- [x] **GitHub Action** — `templates/publish.yml`, to copy into each course repo. Verifies,
      builds, syncs content and decks, invalidates. Authenticates by OIDC against the
      `icecore-publisher` role the stack creates, so no access key lives in any repo.
- [x] **Content publishing is separate from `cdk deploy`** — the publisher role can write
      objects and invalidate the CDN, and has no other permission.
- [x] **The course repo depends on `github:icemaltacode/icecore`.**
- [ ] **A platform change needs the course repo's lockfile refreshed.** npm pins a git
      dependency to a commit, so CI keeps installing whatever `package-lock.json` names
      however many times the platform is pushed. It is currently pinned to `d66e9e1`, which
      predates the volatile-step guard and exercise images. `npm update icecore` in the
      content repo after any platform change that CI needs.
