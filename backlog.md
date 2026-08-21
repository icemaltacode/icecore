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

## UX

- **XP is displayed and never recorded.** Every exercise carries `xp:` and the player shows
  it, but `progress.js` and the progress Lambda store only which exercises are solved -
  no total, no per-course sum. Either sum it from the solved set at read time, or stop
  showing a number nothing counts.

- 'Open in a tab' should be a button with an icon.

- Download slide PDFs.

- Slide fullscreen button hides controls in fullscreen view.