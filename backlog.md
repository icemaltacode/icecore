# Pending Stuff

## Infrastructure (CDK)

The CDK app lives in `infra/`, JavaScript to match the rest of the repo. `just infra-synth`
passes; nothing has been deployed. Everything reaches students through **one** CloudFront
distribution — the app at `/`, the API at `/api/*`, content at `/content/*` and decks at
`/slides/*` — which is what makes the API same-origin, so there is no CORS to configure and
the session endpoint can set cookies that content requests will actually send.

- [ ] **Custom domain** via Route 53 + ACM. Not wired: the stack works on the CloudFront
      domain, and the session Lambda signs for whatever host it was called on, so adding a
      domain later needs no code change.

- [ ] Check cognito invite email does not go to spam after the above change.

## Publishing pipeline

- [ ] **A platform change needs the course repo's lockfile refreshed.** npm pins a git
      dependency to a commit, so CI keeps installing whatever `package-lock.json` names
      however many times the platform is pushed. `npm update icecore` in the content repo
      after any platform change that CI needs. Refreshed to `4391667` (the course grid); the
      platform has moved on since — sidebar, top bar, themes, the resume Lambda — so it
      needs another before the next publish.

## Platform

- [ ] Embedded App Height.
Auto-height for embedded apps

::app <name> height=NNN:: renders a fixed-height iframe. The height is authored by hand, which means it's a guess, and the failure mode is silent: an app that crops loses the chart the question asks about, and the exercise still looks fine.

Make the height a floor rather than an exact value, and make it optional.

The frame is same-origin (see the comment in md.js — allow-same-origin is required, not incidental), so the parent can measure iframe.contentDocument.documentElement.scrollHeight directly. No postMessage, no change to the bundles. Keep a ResizeObserver on the inner <body>: several of these apps redraw on a slider or a tab click, so a one-shot measurement on load isn't enough.

The catch, which is the whole reason this needs care. Sixteen of the twenty-two set minHeight: "100vh" on their root — all of 1.10 and 1.11, none of 1.7. Inside an iframe 100vh is the frame's height, so measurement is circular: set the frame to 900px and the app reports ≥900px regardless of content. It can grow, never shrink.

Same-origin means you can neutralise that before measuring, and I'd advise against it. Those apps were built to fill DataCamp's exercise pane; if their internal layout gives the chart flex: 1, removing the floor collapses the chart instead of fitting it. A collapsed chart is worse than empty space.

So: max(measured, authored). Apps that size to content (the 1.7 six) fit exactly. Apps that want the viewport keep the authored height and grow past it if their content genuinely exceeds it. The authored numbers stop needing to be right and only need to be not-too-large.

height= should become optional — no attribute means measure-only, with a small default floor.

Files: the ::app rule in app/src/md.js, plus resize logic in whichever component owns it. Note the rule currently emits a static style="height:Npx" on .appframe, so the height needs to become something the component can update after mount. .appframe styling is in styles.css.

Ownership: you were last in md.js, so it's yours — I'll keep out of it. Content side needs nothing; the 22 ::app lines work unchanged either way.

## Platform — inherited from the platform agent

Handed over from the platform agent on 2026-08-20 with a clean tree and nothing in flight.
Its last commit was `be91553`. Verified each of these against the code rather than taking
them on trust.

- [ ] **`just infra-deploy` IS REQUIRED BEFORE THE NEXT `just deploy`.** The progress Lambda
      changed shape in `4a45523`: `GET /api/progress` now returns `{ solved, last }` and
      `PUT` accepts `{ course, last }`, writing a `LAST#<course>` row. That is the
      resume-where-you-left-off feature. `app/src/progress.js:28` destructures `last`
      unconditionally and **its catch falls back to local storage** — so against the
      *deployed* Lambda the player gets no `last`, fails soft, and silently restarts every
      student at exercise one. No error, no log, just wrong. Shipping app changes without
      the infra deploy is what produces it.

- [ ] **The course grid has no card art.** `course.json` reads two optional fields, `image`
      and `blurb`; the content repo supplies neither, so every card draws the fallback tile.
      `image` is relative to `content/` and must be **square** — the card crops 1:1.
      Ordering trap: naming an image that does not exist *fails verify*
      (`build.mjs` pushes `course.json: no image at …` into `missingImages`), so the field
      and the file have to land in the same commit.

- [ ] **`-c alertEmail=` has never been set**, so the five CloudWatch alarms publish to an
      SNS topic with no subscriber. Cosmetic until something breaks, at which point it is
      the opposite.

- [ ] **NOTHING PUTS ANYONE IN THE `admins` GROUP — this is a lockout risk.** Verified:
      `infra/lib/icecore-stack.js:95` creates the `admins` CfnUserPoolGroup,
      `infra/lambda/admin/index.mjs` only *checks* membership, and a repo-wide grep for
      `AdminAddUserToGroup` returns nothing. So the only admin exists because someone ran a
      console/CLI command by hand, outside the repo. **If that user pool is ever replaced
      there is no admin, no way to invite anyone, and no code path to fix it** — you are
      locked out of your own enrolment tool by a deploy that goes green. Fix with a
      documented `aws cognito-idp admin-add-user-to-group --group-name admins`, or better, a
      bootstrap in the stack. Highest priority on this list; nothing else here can lock you out.

- [ ] **Both secrets are referenced, not created.** `fromSecretNameV2` at
      `icecore-stack.js:115-116` for `icecore/cloudfront-signing-key` and
      `icecore/openai-api-key` — they must exist *before* the first `cdk deploy`, and they
      come from `just keys` / `just openai-key`, not CDK. Two traps: `just keys` refuses to
      run if `infra/cloudfront-public-key.pem` exists (deliberate anti-rotation guard), so a
      fresh region cannot be bootstrapped without deleting the committed pem; and Secrets
      Manager is regional, so a second region deploys clean and 403s every content request.
      The committed public pem and its private half are a pair and only one is in git.

- [ ] **Resume has never run against DynamoDB.** Not once. Every test went through
      `preview.js`, which stubs progress with localStorage. The `LAST#<course>` read and
      write paths have only ever executed against a fake. Test on a real second device
      before trusting it — and note this compounds the infra-deploy item above.

- [ ] **The `name` claim may never arrive.** TopBar reads name/email from the id token
      client-side; whether `name` is present depends on the app client's attribute read
      permissions, which was never verified. If absent it falls back to the email local part
      and looks deliberate, so the failure is invisible. Check one real signed-in user.

- [ ] **Two `icecore dev` servers corrupt each other.** Both stage into `<course>/.icecore`
      and `buildContent` wipes it on startup. `bundle` already dodges this with
      `.icecore-bundle`; `dev` never got the same treatment because nobody ran two. With
      several sessions on one machine it has already happened twice. Fix: stage per port
      under `.icecore/<port>/`, which the existing .gitignore already covers.

- [ ] **The importer never checks that exercises out == exercises in.** Dropped figures,
      dropped tables, dropped MCQ hints, dropped per-step questions, unmarked volatile steps
      and five dropped `VisualExercise` entries were each invisible until something
      specifically looked. A per-chapter count assertion in `convert.mjs` would have caught
      the most recent one on day one and is close to free. *(Importer-side; belongs to the
      practicals ripping agent, recorded here because the pattern is the point.)*

- [ ] `the_big_merge.md` is fully implemented as of `0d9cbb0` — both requirement sets,
      verified end to end. Mark it done or delete it so nobody actions it twice. Its factual
      findings still hold and are worth keeping until then.

## Platform gotchas worth not rediscovering

Handed over by the platform agent and kept because each cost hours once.

- **Signed-cookie 403s have two independent causes, and both produce cookies that look
  perfectly valid.** The diagnostic: mint a set and look at what it carries.
  `CloudFront-Expires` means a *canned* policy, which CloudFront rebuilds from the URL being
  requested — so a wildcard path matches nothing and everything 403s.
  `CloudFront-Policy` means a custom policy and is correct. `getSignedCookies({ dateLessThan })`
  silently gives you canned. Separately, the session Lambda cannot learn the site's host from
  the `Host` header, because `AllViewerExceptHostHeader` replaces it with the API's own
  domain — the client sends `location.origin` instead.
- **CloudFront's `defaultRootObject` applies only to the root**, not to subdirectories. That
  is why the player links `slides/<topic>/index.html` and never the bare directory. Deep
  links survive only because `routerMode: hash` keeps the fragment away from CloudFront.
- **Vue scoped CSS reaches a child component's root element.** `App.vue`'s `.bar` was
  rounding TopBar's corners because TopBar's root happened to be `<header class="bar">`. The
  fix is unique root class names, not overrides.
- **The purity rule, now that shared modules exist.** Anything the *builder* imports out of
  `app/src` must stay dependency-free and must never touch `import.meta.env`. `compare.js`
  and `dragdrop.js` obey it; `content.js` does not, which is why Node cannot import it.
  `walk.js` is imported only by `App.vue` and `ContentsModal.vue`, never by the builder, so
  it is clear — don't let that change without moving it.
- **Don't try to recover a dropped table from `information_schema.views`.** It cannot work:
  the same view name means different rows in different exercises. That dead end is what
  produced per-exercise `## Setup` SQL.

## Content

- [ ] **Three source courses still have no raw data**: `intro-to-python-for-data-science`,
      `intermediate-python`, `data-manipulation-with-pandas`. Their topics cannot be
      sectioned until it is pulled, so this — not authoring the exercises — is what blocks
      module 2 from interleaving. Exercises landing before it will have no `section:` and
      the topic will silently not interleave. *(Practicals ripping agent.)*

- [ ] **The importer has no `exercises out == exercises in` assertion.** Dropped figures,
      dropped tables, dropped MCQ hints, dropped per-step questions, unmarked volatile steps
      and five dropped `VisualExercise` entries were each invisible until something
      specifically looked for them. A per-chapter count check in `convert.mjs` is close to
      free and would have caught the most recent one on day one. *(Practicals ripping agent.)*


## UX

- Are we actually tracking XP?

- Icons are ugly

---

# Where the contracts live now

The two long briefs that used to sit here — for the slide migration agent and the
practicals ripping agent — were delivered and are gone. Everything durable in them was
written into the file the relevant person actually reads, which is not this one:

- **[`CLAUDE.md`](CLAUDE.md)** (this repo) — `layout: statement` / `statement_alt` and
  `routerMode: hash` as contracts, composed-deck slide numbering, why a section is not a
  fifth level, per-deck image pruning, and never `s3 sync --delete` against `slides/`.
- **`icecore-datacamp-data-analyst/slides/CLAUDE.md`** — the same contracts from the deck
  author's side, plus the section *termination* rule verbatim, why divider order is
  load-bearing, and the stale-`node_modules` trap that makes `icecore slides` look broken.
- **`icecore-import-datacamp/CLAUDE.md`** — `content/raw/` being load-bearing, `dc-sections`
  after any `dc-convert --force`, the three source courses with no raw data, and the
  three-part `VisualExercise` fault (`assetType`, `question.solutionItems`, the `html2md`
  guard).
- **`ice_slidev/README.md`** — why theme assets must stay small: a layout's asset is bundled
  into every deck, so its size is multiplied by the deck count.
