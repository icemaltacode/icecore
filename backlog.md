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

- [x] **Every exercise now leaves `convert.mjs` by a counted door.** Each chapter reconciles
      exercises read against the sum of written, kept, byHand, video, widget, noOptions,
      noFigure and unmapped; a mismatch names the topic and exits 1. Not an equality against
      the file count - dropping is often right - the invariant is that every drop was
      deliberate enough that someone wrote a bucket for it, so a new `continue` without one
      fails the run. All twenty courses reconcile; reintroducing the v2 `ExplorableExercise`
      drop reports `2.8.3: read 13, accounted for 11` and exits 1. The per-topic log line
      also printed what the chapter *contained* rather than what the run produced - 2.8.3
      said 9 while writing 7, on every run, for as long as those two were missing.
      *(Practicals ripping agent.)*


## UX

- **XP is displayed and never recorded.** Every exercise carries `xp:` and the player shows
  it, but `progress.js` and the progress Lambda store only which exercises are solved -
  no total, no per-course sum. Either sum it from the solved set at read time, or stop
  showing a number nothing counts.

- 'Open in a tab' should be a button with an icon.

- Download slide PDFs.

- Slide fullscreen button hides controls in fullscreen view.