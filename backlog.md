# Keith's notes

We have migrated all the MCQs, re-ordering, drag and drop and SQL exercises to the new platform. However, 22 practical exercises across 1.7 (introduction to statistics), 1.10 (Understanding data Visualization) and 1.11 (Data Communication Concepts) include an embedded web app. For example, some sort of dashboard to tweak the parameters of a chart and see how it changes, with accompanying MCQ.

How can we tackle these?


Can an exercise prompt include an image, and if not, what would it take?

DataCamp embeds figures in exercise prompts — a Venn diagram for set operators, a table schema, a histogram to read. html2md drops <img> silently, so five published exercises are live right now with their figure missing: 1.1.1/03, 1.1.1/05, 1.2.2/11, 1.3.2/07, 1.3.3/10. 1.3.3/10 Calling all set operators is the clearest — it asks students to match operators to a Venn diagram that isn't on screen.

It also blocks 11 exercises in topics 1.10 and 1.11, which I've held back rather than shipping broken. Those are the visualisation ones — "Interpreting histograms", "Interpreting scatter plots", "Interpreting correlation heatmaps" — where the figure is the exercise.

What I need to know:

Does the player render markdown images in a prompt today? The prompt goes through md.js, so ![alt](…) may already work — but nothing serves the file. The content bundle carries data/ and slides/; there's no home for exercise assets that I can see.

If not, where should they live? The natural shape from this side is content/exercises/<topic>/images/<file>.png beside the exercise, published into the bundle like datasets are, and referenced relatively. But that's your call — it affects the bundle layout, the S3 sync in publish.yml, and the private-bucket signed-cookie scoping.

Is there a size or count concern? These are small PNGs, roughly 20–80 KB each, and the total across the course would be tens of files. Nothing like the 13 MB sql_eda dataset.


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
- [ ] **A `slides:build` script in the course repo** that builds one static Slidev deck per
      unit (`slidev build unit-1.2.3.md --base /slides/1.2.3/`). Only a dev-server script
      exists today, so the `just slides` recipe runs that instead.
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
- [ ] **Confirm the hint call on first deploy.** The Lambda uses `gpt-5.6-luna` at `low`
      reasoning effort (override with `-c openaiModel=` / `-c reasoningEffort=`) on
      `/v1/chat/completions`, capped at 2000 completion tokens because reasoning tokens
      count against that cap. It logs OpenAI's error body, so a rejected parameter is one
      CloudWatch line. Untestable before the stack exists.
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
- [ ] **A course repo must depend on `github:icemaltacode/icecore`**, not `file:../icecore`,
      before its workflow can install in CI.
