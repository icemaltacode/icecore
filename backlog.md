# Keith's notes

So the queue is: 
- [x] 1.7's 34 exercises, 
- [x] the 11 image ones, 
- [x] the 5 broken published ones, 
- [x] then the 6 presentation apps
- [ ] then the 22 interactive apps, *(1 done: 1.7.1 Choosing a measure)*


1.9.1 q1?

## The 28 embedded-app exercises

**All 28 are rippable.** The apps are public static bundles — no login, no API — at a
predictable URL: `content-embedded-apps.datacamp-learn-apps.com/course/<course_id>/<app>/index.html`.
Each is an 882-byte shell plus a ~220KB JS bundle, a stylesheet and two fonts. `curl` gets
them today.

Two routes:

- **Presentation (6, all in 1.11)** — the widget only reveals or compares fixed prose. The
  text sits in the JS bundle as plain strings, so lift it into the exercise prompt and the
  question becomes an ordinary MCQ. No platform work. The expand-and-collapse is a
  space-saving device in DataCamp's narrow pane, not pedagogy: showing both blocks at once
  loses nothing.
- **Interactive (22)** — all of 1.7 and 1.10, plus three of 1.11. Either the widget
  recomputes from input, or it draws a chart the question depends on, so the bundle gets
  mirrored into the course repo and embedded.

  **This route now works end to end.** The platform renders `::app <name>::` as a sandboxed
  iframe over `content/exercises/<topic>/apps/<name>/`, `verify` fails on a reference with
  no app behind it, and `npx dc-pull-app <slug> <exercise-id> --topic <topic>` does the
  mirroring. `1.7.1 Choosing a measure` is the first one through; the remaining 21 are
  authoring, not engineering.

  The font question turned out to be nothing — the bundles carry no fonts and no DataCamp
  branding, only a two-origin `postMessage` allowlist. `dc-pull-app` warns if a bundle
  reaches a DataCamp host for anything else, which would be the one case a mirror can't fix.

`chart-redesign`, `chart-type-explorer` and `slide-redesign` were counted as presentation
until their own copy gave them away — "hover the chart bars to see values". Lift only their
prose and the student gets a question about a chart that isn't there.

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
| 1.11 | Storytelling with Data > Choose the right chart | [open](https://campus.datacamp.com/courses/data-communication-concepts/storytelling-with-data?ex=10) | `chart-type-explorer` | Interactive | Yes — screenshot the charts, or mirror it |
| 1.11 | Preparing to Communicate the Data > Show the right numbers | [open](https://campus.datacamp.com/courses/data-communication-concepts/preparing-to-communicate-the-data?ex=6) | `metric-type-explorer` | Presentation | Yes — lift the text, ship as a plain MCQ |
| 1.11 | Preparing to Communicate the Data > Spot the redesign gap | [open](https://campus.datacamp.com/courses/data-communication-concepts/preparing-to-communicate-the-data?ex=9) | `chart-redesign` | Interactive | Yes — screenshot the charts, or mirror it |
| 1.11 | Structuring Written Reports > Pick the right report | [open](https://campus.datacamp.com/courses/data-communication-concepts/structuring-written-reports?ex=3) | `report-format-comparison` | Presentation | Yes — lift the text, ship as a plain MCQ |
| 1.11 | Structuring Written Reports > Spot the writing gap | [open](https://campus.datacamp.com/courses/data-communication-concepts/structuring-written-reports?ex=9) | `sentence-cleanup` | Presentation | Yes — lift the text, ship as a plain MCQ |
| 1.11 | Building Compelling Oral Presentations > Choose the purpose | [open](https://campus.datacamp.com/courses/data-communication-concepts/building-compelling-oral-presentations?ex=2) | `presentation-purpose-explorer` | Presentation | Yes — lift the text, ship as a plain MCQ |
| 1.11 | Building Compelling Oral Presentations > Finish the slide | [open](https://campus.datacamp.com/courses/data-communication-concepts/building-compelling-oral-presentations?ex=7) | `slide-redesign` | Interactive | Yes — screenshot the charts, or mirror it |


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
      however many times the platform is pushed. It is currently pinned to `d66e9e1`, which
      predates the volatile-step guard and exercise images. `npm update icecore` in the
      content repo after any platform change that CI needs.
