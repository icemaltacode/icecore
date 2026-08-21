# Pending Stuff

## Infrastructure (CDK)

The CDK app lives in `infra/`, JavaScript to match the rest of the repo. `just infra-synth`
passes and the stack is deployed. Everything reaches students through **one** CloudFront
distribution — the app at `/`, the API at `/api/*`, content at `/content/*` and decks at
`/slides/*` — which is what makes the API same-origin, so there is no CORS to configure and
the session endpoint can set cookies that content requests will actually send.

- [ ] **Custom domain** via Route 53 + ACM. Not wired: the stack works on the CloudFront
      domain, and the session Lambda signs for whatever host it was called on, so adding a
      domain later needs no code change.

- [ ] Check cognito invite email does not go to spam after the above change.

## Platform

- [ ] **Resume has never run against DynamoDB.** Not once. Every test went through
      `preview.js`, which stubs progress with localStorage. The `LAST#<course>` read and
      write paths have only ever executed against a fake. Test on a real second device
      before trusting it — and note this compounds the infra-deploy item above.

- [ ] **The `name` claim may never arrive.** TopBar reads name/email from the id token
      client-side; whether `name` is present depends on the app client's attribute read
      permissions, which was never verified. If absent it falls back to the email local part
      and looks deliberate, so the failure is invisible. Check one real signed-in user.

## Content

- [ ] **The importer has no `exercises out == exercises in` assertion.** Dropped figures,
      dropped tables, dropped MCQ hints, dropped per-step questions, unmarked volatile steps
      and five dropped `VisualExercise` entries were each invisible until something
      specifically looked for them. A per-chapter count check in `convert.mjs` is close to
      free and would have caught the most recent one on day one. *(Practicals ripping agent.)*
- [x] **The four `ExplorableExercise` questions have their dashboards back.** The premise of
      this item was wrong: the options were never only inside the Shiny dashboard, they were
      in a field of the capture nobody read - `possible_answers` at the top level in the v0
      shape, nested under `question` in the v2 shape. Two of the four converted and two were
      dropped, and the two that converted shipped a quieter version of the same fault, asking
      the student to read plots and move sliders that were not on the page. The dashboards
      themselves are served from inside DataCamp's exercise container and cannot be mirrored,
      so all four were rebuilt as `::app` bundles. *(Practicals ripping agent.)*


## UX

- **XP is displayed and never recorded.** Every exercise carries `xp:` and the player shows
  it, but `progress.js` and the progress Lambda store only which exercises are solved -
  no total, no per-course sum. Either sum it from the solved set at read time, or stop
  showing a number nothing counts.

- 'Open in a tab' should be a button with an icon.

- Download slide PDFs.

- Slide fullscreen button hides controls in fullscreen view.