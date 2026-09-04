# Whiteboard — plan

An educator draws, and the class sees it. A blank surface over the whole player, brought up
during a live lesson, with pages; saved boards come back afterwards as an attachment on the
topic they were drawn for.

Status: **every step is built and green** (2026-09-04). It sits on top of live delivery — read [LIVE.md](LIVE.md) first; this does not restate
the channel, the session, the roster or following.

The surface is `app/src/components/Whiteboard.vue` over `app/src/board.js`; the filter is
`app/src/svgclean.js`; the three channel messages are in `infra/lambda/live/`; the rows and
both HTTP routes are `infra/lambda/boards/`; the paperclip is `BoardClip.vue` in its two
homes, `BoardViewer.vue` behind it, and `BoardOpen.vue` for carrying on from a kept one. Four
things below were revised by building them and are marked.

It is on [backlog.md](backlog.md) as one line, and this is what that line means.

## Decisions taken

Settled before any code, in the order they were asked:

1. **The educator holds the pen.** Not the class, not the student being driven. One hand.
2. **The educator turns the page.** Same authority as the position: one thing moves the room.
3. **The board is an overlay over the whole UI**, brought up by a button on the educator's
   side, not a step in the walk and not a pane.
4. **Boards are saved**, and a saved board comes back to students as an attachment.
5. **An educator can reopen their own saved boards** and carry on from one.
6. **Text is not in v1**, because the library has no text tool and the rest of it is right.
7. **A board is titled when it is saved.** One field, and it is what makes a list of boards
   readable a month later.
8. **Boards go with the cohort.** Archiving keeps them; deleting the cohort deletes them.
9. **The educator's list of past boards does not span cohorts.** A board belongs to the class
   it was drawn for.

## What it is, and what it is not

It is a **blank surface**. It is not annotation over the live UI, and the difference is not
cosmetic — see **Why the overlay is opaque** below, which is the one structural constraint in
this whole document.

It is also not the only drawing in the product, and the other one already works. Slidev's own
annotation is relayed to the class by [`app/src/decksync.js`](app/src/decksync.js), so
**drawing on a slide is already a feature.** The whiteboard is for the blank-page moments —
sketching a join, an ER diagram, working a query out longhand — which is most of what anybody
walks to a whiteboard for anyway. Keeping the two separate is what stops this becoming a
second, worse annotation layer.

## The library

**`drauu`** — MIT, v1.0.0, one dependency (`perfect-freehand`), ~64KB unpacked. It is the
engine inside Slidev's annotation feature, so it is already installed in every course repo's
`slides/node_modules` and already proven on this exact transport.

Modes: `draw`, `stylus` (pressure), `line`, `rectangle`, `ellipse`, `eraseLine`. Brush carries
colour, size, fill, dash array, corner radius and arrowheads. Undo/redo stacks. Stylus-vs-finger
discrimination on iPad. That is lines, colours and shapes outright.

Two API facts the whole design rests on:

- **`dump()` is `el.innerHTML` and `load(svg)` is `clear()` then set it.** The sync primitive
  is a string, which is why this fits the channel with nothing invented. `load()` clearing the
  op stack is also correct rather than incidental: a student cannot undo the educator's work
  because the receiving side has no stack to undo.
- **Coordinates go through `getScreenCTM().inverse()` by default** (`@drauu/core`,
  `coordinateTransform`, on unless turned off). So **the board's SVG must carry a `viewBox`**,
  and then strokes are stored in board units rather than screen pixels. That one attribute is
  what makes the board resolution-independent: the student's copy is the same SVG in a
  differently-sized box, and so is the phone's. Take it on day one — it is free now and a
  migration later.

**What it does not have: a text tool.** `DrawingMode` has no `text` and there is no way to type
on the board. Accepted for v1. If it is added later, note that `dump()` serialises the whole
element, so an SVG `<text>` node appended by hand travels and loads correctly; what it would
not do is join drauu's undo stack without reaching for `_appendNode`, which is marked
`@internal`.

**tldraw was considered and ruled out on licence** — commercial use without the "made with
tldraw" watermark needs a paid Business licence. Excalidraw is MIT and has text, select/move
and images, but it is React: it would bring react + react-dom into a Vue app for a feature
whose transport we already have. `js-draw` is MIT and framework-agnostic but ships its own
toolbar, which would fight the player's tokens. drauu is the only one already in the stack.

## Why the overlay is opaque

The board covers the UI. It does **not** show through to what is underneath, and it must not.

[`app/src/pointer.js`](app/src/pointer.js) already carries the argument in full: the shell is
fixed pixels either side of a fluid middle, so the sidebar is a fifth of a 1280 screen and a
tenth of a 2560 one. A drawing made over the educator's result grid arrives on a student's
screen over something else, or over nothing. The pointer survives this by sending
`{ region, x, y }` as fractions of a *named region* — and it survives it only because **a dot
has no shape.** A stroke has one. Scaled into a region of a different aspect ratio, a circle
drawn around a cell arrives as an ellipse: sheared rather than merely offset, and wrong in the
way `pointer.js` names — approximately right everywhere and correct nowhere.

So the board is its own coordinate space, fixed ratio, `viewBox`'d, letterboxed identically on
every screen **including the educator's**. They draw inside the same letterbox everyone else
sees, or they draw in a corner nobody has.

The escape hatch, if annotating real UI is ever wanted, is not a transparent overlay: it is a
board page that takes a **background image** — snapshot the view, draw on the picture. Both
screens then share a coordinate system by construction. Not in v1.

## There is no invitation, and no band

An earlier draft of this plan had the un-followed student getting a band rather than the board,
by analogy with the lesson invitation. That was wrong twice over:

- **A joiner is already caught up.** `remember()` in [`app/src/delivery.js`](app/src/delivery.js)
  sets `following = true` on joining a session, so somebody arriving mid-lesson lands on the
  board with everyone else. There is no state to negotiate.
- **`following` protects against being *moved*, and the board moves nobody.** A student is
  dropped out of follow ([`App.vue:1308`](app/src/App.vue#L1308)) when they navigate for
  themselves, because being sent to the educator's position loses their place. An overlay
  changes nothing underneath it: closing the board returns a wandered student to *their* row,
  not the educator's. So the thing `following` exists to prevent cannot happen here.

**This is exactly why the board must be an overlay and not a row in the walk.** As a row,
showing it would be a move, and every sentence above stops being true. The choice of overlay
is load-bearing, not a layout preference.

## The transport

**Starting the board is a write, not a mode of the educator's browser.** A flag on the session
row, carried by the roster, for the reason the `sync` handler in
[`infra/lambda/live/index.mjs`](infra/lambda/live/index.mjs) already gives for sharing an
editor: a student joining ten minutes in has to arrive already knowing, and a fact held only in
one tab cannot tell them.

**Do not broadcast `dump()` on every change.** `decksync.js` caps a slide's annotation at
`CAP = 24 * 1024` because API Gateway does not truncate or reject an oversized frame — it
closes the connection, which reads as the room going quiet rather than as a message being too
big. A dedicated full-screen board reaches that faster than a slide annotation does, because
`stylus` mode emits filled outline paths with a point per pixel of the stroke.

**Revised while building: a drawing is not echoed back to its sender.** The plan said the
board would follow `sync`'s read-it-back rule throughout, and for the flag it does — a toggle
claiming to be on when the write was refused is worse than one that lags. For `stroke` and
`page` it is wrong: those are the educator's own DOM and are already on their screen, so an
echo would load their page back underneath the pen and double every stroke they drew. The
Lambda passes `except: id` on exactly those two.

So, three messages and one rule:

- `board` — tutor only, `{ on }`. Writes the session flag. Server emits `boarding`.
- `stroke` — one committed node's `outerHTML`, streamed as it is drawn. drauu's `committed`
  event hands over the element. Small, and the common case.
- `page` — `{ page, svg }`, a full dump. Sent on a page turn, and on join as part of the
  roster.

**The rule: an append streams, anything else re-dumps.** Undo, redo, `clear()` and `eraseLine`
all remove or reorder nodes, so a stream of appends cannot express them and the page is sent
whole instead. That is a handful of messages a lesson, not a stream.

**Revised while building: telling those apart rests on drauu's exact event order**, which is
worth writing down because reading the API would suggest otherwise. `changed` fires on
pointer-down and on *every pointer move*, so recording or sending on it naively is a hundred
messages a stroke. What makes the split clean is that `commit()` emits `committed` before
`eventEnd` emits `changed`, and `drawing` is already false by then — so the surface skips
`changed` while drawing, and a `changed` arriving with no `committed` beside it is exactly an
undo, a redo, a clear or an erase. An eraser stroke commits with an *undefined* node, which
falls into the same branch and re-dumps, correctly and by accident of the same test.

**The row stores the page as a list of node strings, not a string.** DynamoDB can
`list_append` and cannot concatenate a string, so this is what lets a stroke be one small
write with no read in front of it. A full page resets the list to a single entry; a joiner is
handed `nodes.join('')`, which is the same markup either way.

**A page has a ceiling, and it is said out loud to the educator.** If a page's dump exceeds the
cap it cannot be sent, and the honest response is to tell the educator the page is full and
offer a new one. `decksync` drops an oversized slide and says so; here the equivalent silence
would be a board that stops syncing while it still looks fine on the one screen that does not
matter — a lesson taught to nobody.

### Every string that becomes DOM is filtered first

`load(svg)` sets `innerHTML`, which parses markup and inserts real nodes. An inserted
`<script>` does not run, but `<image href onerror>`, `on*` on any element, `<foreignObject>`
hosting an `<iframe>` and `<a href="javascript:">` all do — which is script execution in the
player's own origin, where the session and the CloudFront signed cookies live.

The sender is not arbitrary: `board`, `stroke` and `page` are gated on being the session's
tutor, exactly as `point` and `sync` are. **What raises this above theoretical is that saved
boards persist and replay.** A bad page sits in the rows and reaches every student who opens
the paperclip, months later and outside any lesson.

So a board SVG is **filtered against a closed allowlist** — the elements drauu emits (`path`,
`line`, `rect`, `ellipse`, `polyline`, `g`, `marker`) and only the attributes it sets;
every `on*` and every `href` dropped; re-serialised. Not escaped, and not a dependency: this
is `pointer.js`'s own reasoning about a region name, which validates rather than escapes
because "the set of names is closed and short, and anything else is a message this version
does not understand rather than something to render carefully."

**It runs wherever a string becomes DOM that this browser did not draw** — on receive from the
socket, and on read-back from a saved board. The educator's own live board is never filtered,
because it was never a string.

Pure and dependency-free, like `compare.js` and `dragdrop.js`, so a test can import it. **And
`decksync.js` uses the same one**: relayed slide annotations reach drauu's `innerHTML` inside
the deck iframe by the identical path and were unfiltered until this. One definition, or the
two drift and only one of them stays right.

**Revised while building: it walks siblings, not `children`.** An `HTMLCollection` is live, so
reading it by index re-derives it — O(n) an element and O(n²) a page. On a big drawing that is
not slow, it hangs. It cost a test run to find and it would have cost a lesson.

## The rows

A saved board is **scoped to the cohort, never to the topic alone**, and that is the rule
rather than a preference.

An artefact anchored to a topic and shown to everyone is course material authored in the
platform, and CLAUDE.md's first rule is that the platform may read content and must never write
it. Next January's intake opening topic 2.3 to find last year's scribbles is that rule being
broken in the most ordinary-looking way. Scoped to the cohort it is what it actually is: **the
record of one class's lesson** — most useful to the person who missed it.

    pk  COHORT#<cohortId>
    sk  BOARD#<topic>#<boardId>          the board: title, who, when, page count
    sk  BOARD#<topic>#<boardId>#<n>      one page, its SVG

A fresh partition rather than a new prefix in a crowded one — the cohort row is `COHORTS` /
`COHORT#<id>` and membership is `USER#<sub>` / `COHORT#<id>`, so `COHORT#<id>` as a *partition
key* is unused. The attachment for a topic is `begins_with(sk, 'BOARD#<topic>#')`; the
educator's own list of past boards is `begins_with(sk, 'BOARD#')`.

**Opening the whiteboard carries on from this topic's board.** A board in a room is not blank
because somebody walked in; if the class already has one for the topic being taught, opening
loads it and Keep updates it in place. That is also what stops the ordinary rhythm — open,
draw, keep, close, open again — from filing two documents with the same title, which is what
it did on the first afternoon it was used. **New board** is the way out, and it drops the
identity as well as the pages: what is drawn next is its own document, so "start again" and
"throw away what the class already has" never become the same gesture.

The resume is held in the client and acted on when the flag comes back, never sent — it is one
browser's intention, not a fact about the room. A student receiving the same `boarding` resumes
nothing, and a second one (a reconnection, somebody else's lesson) does not act on it twice. It
has to run *after* `applyBoarding` rather than before, because that resets the pages.

**The class is told when the list changes.** The paperclip is read when a course opens and
when the lesson changes — deliberately, so that drawing one on every row costs no round trip —
which left exactly one gap: a board kept in the middle of the lesson it was drawn in, which is
when it is most worth seeing. A student had to reload the page. A `kept` message on the channel
closes it, and it carries a **nudge rather than the board**: the list is per caller — a student
sees their intakes' boards and the educator sees the room's — so the only honest thing to
broadcast is that it changed. A removal sends it too, or the paperclip is left behind on a
board that is gone and opens onto a 404.

The boards function is HTTP and cannot reach the room itself; it has no connection list and no
business acquiring one. So the educator's client says so.

**Deleting is gated exactly like saving, and deliberately not like reading.** `mayRead` lets a
member in, because a board is theirs to look at; removing it is not, and a student deleting
their class's lesson would be the same gesture as tidying up their own notes. Whoever may write
may delete, which today means the person standing in front of the class. Gone means gone —
there is no archive flag and no soft delete, so the confirmation says the pages go for good and
that the class loses it from that topic. The header row goes last, mirroring the save.

**One row per page, not one per board.** A DynamoDB item is capped at 400KB and a ten-page
board at the transport ceiling is most of that. Pages are already the unit everything else
here works in.

These rows land in the `byCourse` index as a partition nothing queries, which is harmless —
worth knowing rather than discovering.

**A board is a document, not a snapshot.** Reopening one and carrying on rewrites it in place,
which is why it needs an id and a title of its own rather than being identified by its
timestamp. The title is typed at save time. Cheap to take now, awkward later — the same shape
as a cohort needing a row of its own because an empty cohort has to exist.

**Revised while building: reaching a board is two rows, never a role.** `mayRead` in the
boards function asks whether the caller is *in* the class or is *delivering to it right now* —
membership row, or the live session row's `by`. `tutor` says somebody may run a lesson; it
does not follow that they may read this class's history. That is also the whole of how an
educator, who is in none of these classes, gets a list at all: `?cohort=` is not a wider way
in, it is the same scope named explicitly by somebody standing in front of that class.

**And the document belongs to the class, not to the educator.** A board list does not span
cohorts: reopening last term's diagram for this term's intake is a real wish and it is the
wrong one, because it would make one class's lesson into material handed to another — the
same inversion the cohort scoping exists to prevent, arriving through a convenience instead
of through a screen. An educator who wants that diagram again draws it again, which is what
they would do at a physical whiteboard.

**Deleting a cohort deletes its boards.** Archiving keeps them, as it keeps everything else —
a class that finished in June still owns the lesson it was taught. Deletion already takes the
courses away and `CohortList` says so before the button is pressed; that sentence grows a
clause, because "delete" beside a member count reads as deleting students and now also
destroys the only copy of a lesson.

## The screens

**The educator's button** sits with the other live controls. Bringing the board up is the write
above; taking it down returns everyone to where they each were.

**The board's own chrome**, on the educator's side only: the brush (mode, colour, size), undo,
clear, **Save**, **New page**, and thumbnails of the board's pages. A thumbnail needs no
rendering pipeline — it is the same SVG in a smaller box.

**The paperclip has two homes, and between them they cover every row.**

- On an exercise: beside the **Slides** button in the footer of the exercise pane
  ([`App.vue:1580`](app/src/App.vue#L1580)). Its own comment says why it lives there — "in the
  footer rather than inside an exercise, so every exercise type gets it" — and the attachment
  inherits that for free.
- On a slides step: in `SlidesStep.vue`'s header group, beside `DeckActions`. That component's
  comment already names the grouping — "what to do with the notes, and what to do with the
  deck" — and an attachment is a third small thing to do with this topic. The footer button is
  deliberately hidden on a slides step (offering to open the deck beside a full-pane copy of it
  reads as a bug), which is exactly why the second home is needed rather than optional.

That covers the case the first draft of this got wrong: [`walk.js:42`](app/src/walk.js#L42)
emits a slides row only when the topic has a deck section, so a deckless topic — and a course
with no `slides/` at all — has no header to hang anything on. The exercise footer does not care.

**`preview.js` must reach all of it.** `icecore dev --as tutor` is the only way to look at this
screen without a socket behind it, and a saved board that cannot be opened locally is a screen
nobody reads before shipping. Seed a board with more than one page, and a topic with no board,
because those are the two states a list derived from rows could not draw.

**Prefix the overlay's container classes.** It hosts an SVG and a toolbar, and Vue's scoped CSS
reaches a child component's root — the trap `SlidesStep`, `DataGrid` and `Playground` each
spell out at length.

## Two things found by using it

Both on the read side, both the same afternoon it went out, and both invisible to the suite
for the reason stated above: `test/player.mjs` drives the room from a student's side, and
these are the educator's.

- **The person who drew the board was the one person who could not see it.** The listing the
  paperclip reads answers "what may I, whoever I am, see" — the caller's own cohorts — and an
  educator is in none of them, by the same design that gives an admin an empty enrolment list.
  So a board saved correctly, stored correctly, and appeared nowhere. The fix is not a wider
  listing: while they are **delivering**, the client names the room, and `mayRead` in the
  boards function already blesses exactly that — member or deliverer, the rule step six
  established for reopening. Only when it is their lesson: a student in one is a member
  already, and naming the room for them would *narrow* their list to it and hide a board kept
  for another intake they are also in.

- **Nothing re-read the list after a save.** `loadSaved` ran when a course opened and never
  again, so a kept board appeared only after reopening the course — which reads exactly like
  saving having failed, at the one moment somebody is looking for the result of it. `keepBoard`
  now refreshes, and so does a change of lesson: whose boards are visible moves in both
  directions, and an educator who has ended a session must stop being offered that class's
  boards.

- **`by` is a DynamoDB reserved word.** `ProjectionExpression: 'by'` on the live session row —
  in `mayRead`, the function both of the above lean on — is not a wrong answer, it is a
  `ValidationException`. So every read that reached it returned 500: a student opening a saved
  board, and an educator's entire listing, which `loadSaved` swallows and which therefore
  looked exactly like there being nothing there. One cause, three symptoms, none of them
  resembling each other.

  It reached production because **nothing in this repo calls an HTTP Lambda at all.**
  `test/live.mjs` opens a real socket and covers the channel; the six request/response
  functions have no equivalent. `test/setup-checks.mjs` now refuses a reserved word in a
  projection, which closes the part of that gap that fits on a page — and is the third thing
  in that file written because it shipped.

- **The slides header's paperclip opened its menu off the top of the screen.** One control in
  two homes, and the menu was positioned for one of them: `bottom: calc(100% + 6px)` is right
  in the exercise footer and wrong in a header that sits at the very top of the pane. It opens
  downward there now.

  **The suite cannot see this class of bug and it is worth knowing which.** `test/player.mjs`
  clicks that exact control and asserts both entries are in the menu — and passes, because
  jsdom has no layout: everything is at 0×0 and nothing is ever off-screen or clipped. So the
  DOM is checkable here and the *position* of it is not, which is the same boundary the slide
  clamp and the frame's hash already sit on. Anything about where a thing lands on a screen
  needs a browser.

The shape of the miss is worth keeping. Both halves were *designed* — the cohort scoping is
the rule this feature exists to hold, and the once-per-course fetch is what keeps a paperclip
off the navigation path. What was never asked is what the two of them do to the one person who
is not in the class and is standing in front of it.

## Order I would build it

1. **The surface, local only.** drauu mounted in a `viewBox`'d fixed-ratio overlay, brush
   controls, pages, undo. No channel. This is where the letterboxing is either right or wrong,
   and it is visible in one browser.
2. **The filter**, before anything can be received. Pure, tested, and adopted by `decksync.js`
   in the same pass — it is a fix to something already shipped, not only a dependency of this.
3. **The session flag and the fan-out.** `board`, `stroke`, `page`, the roster carrying the
   current page, the ceiling and its refusal.
4. **Save, and the rows.** Nothing reads them yet.
5. **The two paperclips**, and the viewer behind them.
6. **The educator's list**, which is the step that makes a board a document.

**Revised while building (6): reopening needs a revision counter, not a page watch.** The
surface reloads when `board.page` changes — but reopening a kept board onto the page you are
already on changes no index, so the surface would go on showing the board it had a moment ago.
It cannot watch `pages` instead: `setPage` replaces that array on every stroke, so the surface
would reload itself out from under the pen. `board.rev` is bumped by the three things that
replace pages wholesale and by nothing else.

**What is not covered by a test, so nobody assumes it is:** the educator's own half. `board.mine`
is false in `test/player.mjs` — it drives the room, and the room's side of a board is a student's.
An educator's board is a drauu instance responding to real pointer events, which jsdom cannot
produce meaningfully, so the toolbar, the ceiling's refusal and reopening are covered by the
preview (`--as admin`) and by a browser, not by the suite. Same boundary the slide-range clamp
already sits on.

Steps 1–3 are the lesson. 4–6 are what survives it.
