# Keith's notes

So the queue is: 
- [x] 1.7's 34 exercises, 
- [x] the 11 image ones, 
- [x] the 5 broken published ones, 
- [x] then the 6 presentation apps
- [x] then the 22 interactive apps

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

## Publishing pipeline

- [ ] **A platform change needs the course repo's lockfile refreshed.** npm pins a git
      dependency to a commit, so CI keeps installing whatever `package-lock.json` names
      however many times the platform is pushed. `npm update icecore` in the content repo
      after any platform change that CI needs. Currently at `4ba03bd`, which covers exercise
      images, markdown tables, embedded apps and multiple-choice hints.
