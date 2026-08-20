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

## UX

- Are we actually tracking XP?

- Icons are ugly


---


