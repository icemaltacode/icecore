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

## Platform

- [ ] **`-c alertEmail=` has never been set**, so the five CloudWatch alarms publish to an
      SNS topic with no subscriber. Cosmetic until something breaks, at which point it is
      the opposite.

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

- [ ] **The importer never checks that exercises out == exercises in.** Dropped figures,
      dropped tables, dropped MCQ hints, dropped per-step questions, unmarked volatile steps
      and five dropped `VisualExercise` entries were each invisible until something
      specifically looked. A per-chapter count assertion in `convert.mjs` would have caught
      the most recent one on day one and is close to free. *(Importer-side; belongs to the
      practicals ripping agent, recorded here because the pattern is the point.)*

## Content

- [ ] **The importer has no `exercises out == exercises in` assertion.** Dropped figures,
      dropped tables, dropped MCQ hints, dropped per-step questions, unmarked volatile steps
      and five dropped `VisualExercise` entries were each invisible until something
      specifically looked for them. A per-chapter count check in `convert.mjs` is close to
      free and would have caught the most recent one on day one. *(Practicals ripping agent.)*


## UX

- Are we actually tracking XP?

- 'Open in a tab' should be a button with an icon.

- Course cover images.

- The 'contents' button in the sidebar should no longer say X exercises. Instead, X items.

- Download slide PDFs.

- Slide fullscreen button hides controls in fullscreen view.