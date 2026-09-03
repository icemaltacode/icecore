# Live delivery — plan

A tutor puts a whole cohort on the same page of the same course, in real time: their
screen leads, everyone else's follows, and the room is visible to all of them. It is the
first thing in icecore where two people's browsers have to agree about anything, which is
why almost all of the work is below the UI rather than in it.

It is also the feature [ADMIN.md](ADMIN.md) has been holding a door open for. View-as was
built as *the same feature with a different source* — five constraints taken then, cheap at
the time and expensive to retrofit — and this is the thing that comes through that door.
Read [View-as now; remote control later](ADMIN.md#view-as-now-remote-control-later-as-an-addition)
first; this plan does not restate it.

Status: **every step is built, deployed and green** (2026-09-03). The channel: `infra/lambda/live/`, the socket and
its ticket route in the stack, `app/src/live.js`, and the socket URL riding into `auth.json`.
It was purely additive — 18 new resources, nothing modified or replaced. Two things below
were revised by building them, and are marked.

Step 2 added the session and its lock, the Live button, the course picker and the band —
`app/src/delivery.js`, `LiveStart.vue`, `LiveBand.vue`, `#/live/<cohort>`. Step 3 added
presence and the participants panel — `LivePanel.vue`, and the `roster` / `joined` / `left`
/ `moved` messages behind it. Step 4 added following. Step 5 added chat — `app/src/chat.js`,
`LiveChat.vue`, and the `say` / `said` / `history` messages, which is where `say` stopped
being a smoke test and became the feature it was standing in for. Step 6 added per-exercise
class results — a `checked` event out of all four exercise components, the `marked` message,
and the two views that read it. Step 7 was built in two passes: the control itself —
`control` / `sharing` / `release` / `drive`, `ControlBand.vue`, `ControlStart.vue`,
`#/control/<cohort>/<sub>` — then the write gate and the editor buffer. Step 7½, the
invitation, was never in the build order at all and is why a student could not previously
discover a lesson had started.

`npm run test:live` is the end-to-end check, against the real deployment: the session's
conditional write and its refusal, the bookmark round trip, a refused handshake without a
ticket, a ticket that cannot be spent twice, what one socket says arriving at the other,
and — the one that actually proves `$disconnect` — a closed socket dropping the delivered
count. Chat is checked from both ends: the origin the Lambda stamps on, the backlog a late
joiner reads, and an empty message reaching nobody. Marks are checked in both directions —
the tutor hears one, and a student hears nobody's, on the push and on the roster alike. It reads the socket URL from the stack outputs rather than from the published
`auth.json`, and it does its session work in a **throwaway cohort it creates and deletes**,
so running it never writes a bookmark onto a real class.

Thirteen mock screens are drawn against the real player's tokens
and components — the cohort screen with its Live button, the two educator screens, remote
control from both sides, the four student states, the sharing prompt and the end-of-session
summary. They are the specification for everything under "The screens".

## Decisions taken

| | |
|---|---|
| **Channel** | API Gateway **WebSocket API**, not polling. First push infrastructure in the stack |
| **What travels** | **Application state, never pixels.** No screen capture, no video, no WebRTC |
| **Session** | One per cohort, and **only one admin may deliver to a cohort at a time** — enforced by a conditional write, not by a check |
| **Bookmark** | Per **cohort and course**. Written when the session ends; it is the cohort's mark and never a student's |
| **Following** | Opt-in, leaveable, and rejoinable. A student who moves on their own keeps their work |
| **Remote control** | Announced on the student's screen, endable by them, and **writes their rows as them, attributed to the admin** |
| **Screen sharing** | A choice taken when control starts, **off until it is taken**, and switchable during the session |
| **Chat** | **Not durable.** It lives in the channel and dies with the session |
| **Presence** | Derived from connections, never a stored status field |
| **History** | Names are **cached on the history row and never rewritten**. It is a record of an hour, not a view of who exists now |
| **Prefix** | `LIVE#`, chosen because it falls **outside** the range `belongings` already reads |

## What it is, and what it is not

**It is shared state, not a screen share.** What crosses the channel is a position — course,
unit, topic, exercise, step, slide number — and, during remote control, the editor buffer.
Each client renders that with its own copy of the course, which it already has.

That is not a compromise; it is the only version that works here. A screen share needs
capture and a media path, and this stack has neither and should not grow one for a slide
and a SQL editor. Replicated state is also *better* than video for what this is for: the
text stays selectable, the deck stays interactive, and a student on a phone gets a layout
that fits rather than a letterboxed 1440px screenshot.

It has one consequence worth stating out loud, because "see the student's screen" invites
the other reading: **the class never sees anything the platform did not put there.** A
student's other browser tabs, their notifications and their desktop are not in scope and
cannot be, which is most of what makes screen 13's sharing choice a small decision rather
than a large one.

## The channel

### Why a WebSocket rather than polling

Twelve clients polling every two seconds is perfectly affordable, and it is still the wrong
shape. Four of the five things this feature does are pushes — the invitation, the position,
a chat message, a keystroke under remote control — and every one of them is worse with
half a poll interval of latency in front of it. A tutor pressing Next and watching the room
land a second and a half later will press it again.

The one thing that looked genuinely pull-shaped, the per-exercise class results, turned out
not to be — see **Class results** below. It is a push like the rest, and the plan was wrong
about it in a way worth recording rather than quietly fixing.

### `$connect` cannot use the authorizer `/api/*` uses — and needs none

This is the trap, and it is worth knowing before any CDK is written.
[`icecore-stack.js:434`](infra/lib/icecore-stack.js#L434) protects the HTTP API with an
`HttpJwtAuthorizer`. **There is no WebSocket equivalent.** A `WebSocketApi` takes a
`WebSocketLambdaAuthorizer` or IAM, and nothing else — so `$connect` needs a REQUEST
authorizer that validates the Cognito token itself.

Worse, a browser **cannot set headers on a WebSocket handshake**. `new WebSocket(url)` takes
a URL and nothing else, so the token has to travel in the query string — which is exactly
where tokens end up in access logs and referrers.

So: **the client does not send its id token at all.** It calls the HTTP API — already
authorized, already working — for a **single-use ticket**: a random id written with a
60-second expiry against the caller's sub, cohort and role. `$connect` takes `?ticket=`,
consumes the row conditionally, and stores the connection. The identity on the connection
row therefore comes from a row the server wrote, never from anything the client asserted,
which is the same property the sub-versus-username handling in the admin function already
relies on.

**Revised while building: there is no authorizer at all.** The plan called for a REQUEST
authorizer validating the token, and once the token stopped being sent there was nothing
left for it to validate — it would have been a second Lambda in front of this one doing the
same conditional delete. A `$connect` handler returning a non-2xx refuses the handshake,
and that is the whole mechanism. All three routes are `AuthorizationType: NONE`, which
looks alarming in a diff and is correct.

**The delete is the check**, not a read followed by one: `attribute_exists` makes spending
a ticket atomic, so two sockets opened with one ticket cannot both succeed. And the expiry
is checked in code rather than left to the row's `ttl`, because DynamoDB deletes an expired
item within 48 hours rather than at the instant — a minute-old ticket is very often still
sitting there.

### It is not behind the distribution — revised while building

The plan called for a `/ws` behaviour on the existing CloudFront distribution, for the
same-origin property `/api/*` has. **It does not work, and the property buys nothing here.**

A WebSocket API's URL is `wss://<host>/<stage>` with nothing below it. CloudFront appends
the request path to the origin path, so a behaviour at `/ws` forwards `/<stage>/ws`, which
API Gateway refuses — routing it through would need a CloudFront Function rewriting the
path on every single connection. And the reason `/api/*` is same-origin does not apply: a
WebSocket handshake has no CORS and carries no signed cookie, so there is nothing for a
shared origin to protect.

So the socket is reached at its own `execute-api` hostname, and **the client learns that
URL from `auth.json`** — a `LiveSocketUrl` stack output that `just deploy` writes in
alongside the pool ids, exactly as those are read rather than typed. It is the one thing
the app talks to that is not same-origin.

The session Lambda's problem does not recur either: `/api/*` uses
`AllViewerExceptHostHeader`, which is why the session function cannot learn the site's
domain from `Host` and takes `location.origin` from the client instead. Nothing here needs
a hostname — the ticket already names everything the server has to know.

### Fanning out

A message is delivered with `PostToConnectionCommand` from
`@aws-sdk/client-apigatewaymanagementapi`, per connection. **A `GoneException` is routine
and means the row is stale** — delete it and carry on; a client that closed a laptop lid
without a clean `$disconnect` is the normal case, not an error to log.

The management endpoint is built **from the event** — `requestContext.apiId` and `.stage` —
rather than from an environment variable. Passing it in would make the function depend on
the stage, which depends on the API, which depends on the function: a CloudFormation cycle.

### Two limits that are not ours

**API Gateway closes an idle socket after ten minutes, and any socket after two hours**,
whatever is happening on it. The first is handled by a four-minute heartbeat, the second by
reconnecting — which is why `live.js` treats reconnection as the ordinary case and not the
failure case, and why the backoff is capped low. A two-hour cap arriving mid-lesson with a
client that has backed off to five minutes is a student who misses the rest of it.

**A ticket is single-use, so every reconnection mints a fresh one.** That is not an
inefficiency to optimise away: it is what makes a ticket in a log worth nothing.

## The rows

All of it on the existing table ([`icecore-stack.js:164`](infra/lib/icecore-stack.js#L164)),
pk/sk with the inverted `sk`/`pk` GSI and the `ttl` attribute.

### The prefix, and the range that already exists

**`LIVE#`, and the choice is not cosmetic.** `belongings` in the admin function reads
cohorts and enrolments as one range —
`sk BETWEEN 'COHORT#' AND 'ENROL$'` ([`admin/index.mjs:113`](infra/lambda/admin/index.mjs#L113))
— so **any new sort-key prefix beginning with D or E arrives in the user listing as an
enrolment nobody wrote.** `L` sorts after `ENROL$`, so `LIVE#` falls outside it. The
prefixes in use today are `COHORT#`, `ENROL#`, `LAST#`, `PROG#`, `RATE#` and `SPEND#`.

### Four kinds of row

**The session**, `COHORTS` / `LIVE#<cohortId>`. Course, the admin's sub, started-at, the
current position, the sharing flag, and the running tallies the summary will need. Written
with `attribute_not_exists(sk)` — **that condition is the "one admin at a time" rule**, and
it is the rule rather than a check on the cohort screen, because a check is a race and a
condition is not. The Live button's disabled state exists to explain the refusal, never to
prevent it. Deleted when the session ends; a `ttl` of a day catches a session nobody ended.

**A connection**, `CONN#<connectionId>` / `LIVE#<cohortId>`. Sub, name, role, last-seen,
current position, and a `ttl`. Two reads fall straight out of the existing GSI: the
connection by its id on the base table, and **every connection in a session by querying the
GSI on `sk = LIVE#<cohortId>`** — so fan-out needs no new index.

**The bookmark**, `COHORTS` / `LIVEMARK#<cohortId>#<courseId>`. Per cohort *and* course,
because a cohort takes more than one course and a single mark would send Tuesday's SQL class
to where Thursday's Python class stopped. **It outlives the session row**, which is the whole
reason it is a row of its own rather than a field on one.

Written when the session ENDS, from the position the ending client sends — a session that
has not ended has not left off anywhere. **Missing means missing**: ending without a position
leaves the previous mark standing rather than replacing it with nothing, so a tutor whose
browser dies mid-lesson loses the advance and not the mark.

**It is the cohort's and nobody's own, and that distinction is the whole of it.** Every
student already has a `LAST#` row per course, written on every move, and the player resumes
them to it. The two look identical on screen. Entering a session therefore overrides the
personal marker with the cohort's *after* `open()` has applied it — deliberately, in one
place, because the alternative is a lesson that opens wherever each person last wandered to
and a tutor who cannot tell that from the feature working.

**Session history**, `COHORTS` / `LIVEPAST#<cohortId>#<endedAt>` — **not** the
`LIVE#<cohortId>#PAST#<endedAt>` this line said until it was built, which is the exact
mistake the bookmark's own note two paragraphs above exists to prevent. `running()` asks for
`begins_with(sk, 'LIVE#')`, so a history row spelled that way comes back as a live session
for every cohort that has ever had one — and the Live button then refuses to start a lesson
on the grounds that last Tuesday's is still going.

It is otherwise as described: What the summary reads:
who attended and for how long, which topics were walked, what each exercise did to the
class. Written when the session ends, from tallies kept on the session row as it runs.

**It stores names, cached, exactly as `ENROL#` and `COHORT#` rows already do** — so the
summary is one read with no pool call behind it. One difference from those two, and it is
the important one: **a rename must not rewrite a history row.** `ENROL#` and `COHORT#` cache
a name because they answer "who is on this course *now*", and PUT rewrites them for that
reason. A history row answers "who was in the room on the 3rd of September", which a later
rename does not change. It is a snapshot, and snapshots that get edited are not records.

That has one consequence to carry: a name on a cohort partition is personal data
`forget()` cannot reach, since deleting a person walks `USER#<sub>` and nothing scans for
their name elsewhere. **So history rows get a `ttl`** — a year is generous for something
whose whole use is deciding what to do next term — and erasure is then a matter of time
rather than of a scan nobody would remember to write.

### Chat is not durable, and that settles the erasure question

Messages travel on the channel and are held on the session row — the last 200, for a student
who joins late — and **they go when the session row goes.** Nothing is written under
`USER#<sub>`.

That is a deliberate answer to the problem the alternative creates. Chat is personal data;
`forget()` in the account function deletes everything under a student's partition, and the
Article 15 export in [ACCOUNT.md](ACCOUNT.md) has to be able to produce everything the
platform holds about them. Messages stored on a *cohort* partition are reachable by neither
— they would be personal data on a row that erasure cannot see, which is precisely the
shape of thing that is discovered years later. Making chat transient removes the problem
instead of handling it, and the honest sentence for the export is short: a live session
holds nothing once it has ended.

**The summary quotes a count, not the text.** That count is a tally on the session row —
`said`, incremented by the same write that keeps the message.

Four things the build settled:

- **The server assigns the id and the time, and the sender hears their own message back.**
  An optimistic local echo is the obvious way to make a composer feel instant, and it gives
  the person who typed a message a slightly different transcript from everybody else's —
  which is the one thing a transcript must not be. The cost is a round trip on a socket that
  is already open.
- **A message carries where it was sent from, taken from the CONNECTION ROW.** The client
  already reports its position on every move, so asking it to say where it is a second time
  would be a second copy of a fact to keep in step with the first — and the copy the panel
  draws is the one that would go stale. A question asked from inside an exercise can then be
  *opened* rather than located. Shown only when it differs from where the reader already is,
  and clicking it is an ordinary navigation: for a following student that stops the follow,
  which is right and needs no special case.
- **The backlog is trimmed append-then-remove**, not read-modify-write. A read-modify-write
  loses a race by construction; this one can only lose backlog — two messages arriving
  together both see the list one over and both drop the front entry, so the window is 199
  rather than 200 for a moment. `CHAT_KEEP` and `CHAT_CHARS` are a pair: 200 × 500 characters
  is the budget that keeps the session row inside DynamoDB's 400KB item however long a lesson
  runs.
- **Keeping a message is conditional on the session row existing.** Otherwise a message sent
  in the second after a session ends resurrects the row as an orphan holding a class's chat,
  with no session attached to explain it or to delete it.

**Docked or floating, and it is one component either way.** Undocking moves where it is
drawn and almost nothing about what is drawn. The floating one is rendered by `App.vue`
rather than by the panel, because the panel collapses to a rail — a chat window that vanished
with it would not be undocked, it would be hidden.

**The collapsed rail carries an unread count**, and that is what makes closing the panel a
reasonable thing for a student to do: they can put the class away and still be told when
they are being spoken to. Without it the collapse is a way of missing the lesson.

## Presence

**Derived, never stored.** A student is online because they have a connection; there is no
status field for anything to disagree with. The connection row carries `seen`, and **the
label is computed by the client** — so nothing needs a timer Lambda, and a clock that is a
few seconds out changes a word rather than a fact.

**A PING IS NOT ACTIVITY, and that distinction is the whole of it.** The socket has to be
kept open or API Gateway closes it after ten minutes; if the keep-alive also counted as the
person being there, nobody would ever go idle and a tab left open on a train would read as
attentive for the whole lesson. `ping` keeps the connection, `active` keeps the person, and
only `active` moves `seen`. Saying something counts too — it is the one message that is
obviously a person without an `active` beside it.

`active` carries the sender's POSITION as well, because the two facts arrive together and a
second message for the position would be a second thing to keep in step with this one. It is
broadcast as `moved` only when the place actually changes: a student working through a
multiple-choice question is active every few seconds and in the same place throughout, and
broadcasting that is a dozen posts a minute telling eleven clients nothing.

**The panel lists everyone in the COHORT, not everyone connected** — a list built from
connections shows a class of twelve as a class of three and gives a tutor no way to see who
is missing. The membership comes from the `COHORT#` rows through the inverted GSI, with the
name already cached on them, and it is sent to students too: a student cannot read the user
listing, which is exactly why this is computed server-side rather than taken from it.

**Keyed by person, counted by connection.** A student with two tabs is two sockets and one
person, so a `left` decrements rather than removes — otherwise closing a duplicate tab takes
somebody out of the room.

**It starts collapsed for a student and open for a tutor** — one default expressing two
different jobs. Knowing who is in the room *is* the tutor's job; for a student it is context,
and a column of classmates beside an exercise is 300px taken from the thing they are meant to
be doing. Collapsed it leaves a rail rather than nothing, the same way the sidebar does, and
the rail carries the count — a control that only says "participants" has to be opened to find
out whether anything changed. The choice is remembered per browser and **remembered
separately from the default**, so a student who opens it once is not collapsed again next
lesson.

Four states, and only three are in the brief: **with you**, **somewhere else** (connected,
attentive, and not where the tutor is), **idle**, **not here**. Somebody who has stopped
following is not absent, and drawing them as offline is how a tutor concludes half the room
has left.

**THE SERVER CANNOT PUSH THE ROSTER FROM `$connect`.** A connection does not exist until
that handler returns 2xx, so a post from inside it comes back `GoneException` — which this
code swallows, because a GoneException is also the ordinary way a stale row announces
itself. The roster would simply never arrive, silently. So the client asks on open, and
`live.js` delivers a local `{type:'open'}` through the same path as a real message to make
that hookable without the channel learning what a roster is. It has to work that way
regardless: a client reconnecting after a tunnel has a roster from before the gap.

## The screens

The mocks are the specification. What each one needs behind it:

1. **Cohorts, with Live** — Rename/Archive/Delete move into a `⋯` menu; Live becomes the
   first and only primary button; the lead paragraph stops wrapping at 60ch. Disabled with
   a reason for an empty cohort, for a cohort whose members share no course, and for one
   already live. `CohortList.vue`.
2. **Which course** — only when the members share more than one; skipped when they share
   one. It quotes each course's bookmark, so what is about to be resumed is visible before
   it is chosen.
3. **Delivering, on slides** — the player, plus a live band and a 336px panel holding
   participants over chat. The band is the `WatchBanner` shape and colour deliberately:
   both say which mode you are in, standing, and one vocabulary for that is what keeps
   either of them readable.
4. **Delivering, on an exercise** — the class's answers drawn *into* the options rather than
   charted beside them, and the panel switching from presence to per-student marks on the
   same rows.
5. **Remote control** — its own tab. Watch/Control as an explicit toggle, and the sharing
   switch from screen 13 carried into the band.
6. **Chat, undocked** — a message sent from inside an exercise carries where it was sent
   from, so a question can be opened rather than located.
7. **The invitation** — persistent, undismissable, and a band rather than a modal. Drawn
   over a *different* course on purpose: that is the case the rule exists for.
8. **Following** — participants and chat collapsed to a rail, matching how the sidebar
   already collapses.
9. **Working on her own** — the same band restated, `Catch up` carrying the existing
   `.btn.urge` halo, and the sidebar marking where the tutor is.
10. **Being controlled** — the student's side of screen 5, with the admin's caret named in
    her editor.
11. **Session ended** — the bookmark first and accented, because it is the only thing on the
    screen that changes anything; then what was covered, who attended, and what to fix.
12. **Watching a classmate** — what everyone else sees while control is running.
13. **Before taking control** — the sharing choice, unticked.

## Following, and leaving

The tutor broadcasts a position on every move. A following client sets its own to match;
that is the whole of it, and it is only that simple because of ADMIN.md's third constraint:
**position is explicit and settable from outside.** A position that lived inside components
would leave nothing able to set it.

**A SLIDES STEP IS A RANGE, so the slide number travels with the row.** Without it a
follower lands at the top of a topic the tutor is nine slides into, which looks exactly like
following being broken. `SlidesStep.vue` already clamps the deck's hash to the topic's range
on the patched `pushState` — vue-router's hash mode drives the History API directly and a
`hashchange` listener sees nothing — so both the report and the drive hang off that same
watch rather than installing a third listener that would stop working the day Slidev changes
how it navigates. Driven with `replace`, or following through nine slides puts nine entries
in a student's history and makes Back a slow walk backwards through the lesson.

Leaving is not an action a student takes but one they cause: **any navigation of their own
stops the follow.** Not a button they have to find — a student who navigates has already
decided to go somewhere, and a screen that dragged them back would be the feature fighting
them. The band restates itself, `Catch up` returns them, and nothing they did in between is
lost. A student who wanders is still in the session, still counted present, still able to
chat.

**MOVING BECAUSE WE FOLLOWED IS NOT NAVIGATING.** Every position applied from the tutor runs
through the same watcher that decides somebody has struck out on their own, so without a
guard the first followed move would immediately end the following. It is a counter rather
than a flag: the row and the slide arrive together, and a boolean cleared by the first would
leave the second looking like a student's own move.

`Catch up` is offered only once the room has said where the tutor is. A session starts
before anybody has reported a position, and a nudge that cannot go anywhere is worse than
no nudge.

## Class results

**This step's one-line description in the build order was wrong, and the error is the
interesting part.** It read "a read of events that already exist by this point" — and
nothing existed to read. `active` carries a position and nothing else; no message, and no
row anywhere in the platform, said how somebody had *answered*. A `PROG#` row is written
only on a success, so from the table "answered wrongly" and "has not answered yet" are the
same shape — which are precisely the two states a tutor most needs to tell apart.

So the write went in first, as everywhere else in this plan. The mistake was assuming an
ordering that had not happened, and it is the kind that is cheap to catch here and expensive
to catch after a view has been half-built against data nobody records.

**Every press of Check, not only the ones that pass.** All four exercise components now emit
`checked` beside `solved`. Two events rather than a verdict on one, because they answer to
different things: `solved` writes progress and XP and must not fire twice for one earn,
while this wants the wrong answers most of all.

**A MARK GOES TO THE TUTORS AND TO NOBODY ELSE.** `emit()` grew an `only` role filter for
this one message. A class watching each other's answers arrive during a question is a
different activity from the one being run, and the confident student answering first would
decide it for everybody. Filtered on the server rather than ignored on the client — a
student with the developer tools open is still a student, and in a classroom that is not a
small thing. The same rule applies to the pull: a roster asked for by a student comes back
with nobody's mark on it, and the asker's role is read off the row the function already had
to fetch, so there is nothing to trust there either.

**Nothing is written down, and that is a decision.** Marks accumulate on the tutor's client
from the messages themselves. The platform already holds the durable half — a `PROG#` row
for every success — and deliberately does not record failed attempts; [backlog.md](backlog.md)
defers that decision until there is a screen to decide it against, and **this is that
screen**. Writing a row now would answer the question by assuming it.

The honest cost: **a tutor who reloads mid-lesson loses the picture.** The connection row
carries the *latest* mark, exactly as it carries `position`, so a reload gets back whatever
everybody currently connected last did — but not the exercise before that one. One mark per
connection rather than a map of every exercise, which would grow all lesson on a row that
dies when the socket does: the worst of both.

**A mark outranks presence in the panel.** Somebody who answered correctly and then shut
their laptop belongs under Correct — the tutor's question is "who has got this", not "who is
looking at it now". They are dimmed with the same `away` class instead, so the panel never
claims somebody is there.

**Six groups, not four.** `Could not run it` is its own group rather than folded into
`Not right yet`, because `grade.js` already keeps an error apart from a wrong answer for the
Ask AI nudge, and six people whose query will not run is a different problem from six who
have misread the question.

**The switch is a prop, not a derivation.** The panel groups by result because it is *told*
to, not because `marks` happens to be non-empty — an exercise nobody has answered yet is
exactly when a tutor most wants the class listed as not having answered, and a panel that
only became a results view once somebody had would flip layouts under them.

**The person delivering is an EDUCATOR on screen**, never a Tutor. The word appears in
three places — the panel's leading row, a chat message's byline, and the band's fallback
when a session carries no name — and the wire role is still the token `tutor`, which is how
the wrong word got typed into a template in the first place. If a fourth place ever needs
it, the word is Educator.

**The answers are drawn into the options**, and **the educator sees which one is right.**
A student sees nothing until they submit, because a marked option is the answer; the
educator is the one person in the room for whom that is not a spoiler, and is looking at
this to run a lesson from. So the correct option is green from the start and a wrong one
turns red as soon as somebody has actually chosen it — only the ones people chose, because
reddening every option that is not the answer makes the picture uniform and says nothing.
The colour is worth having on the bar as well as the border: it is what makes "the class
split between B and C" readable at a glance instead of countable.

**The answers are drawn into the options.** A bar chart beside the list makes a tutor read
across from a colour to an answer while a class waits; the number belongs on the thing it is
about. The share is of those who have *answered*, not of the class — a bar that shrank as
latecomers arrived would make an option look less popular for having been chosen by more
people — and the count of who has answered at all is said in words beside it, because nine
of twelve evenly split is a different moment from three of twelve.

**A choice stays a number on the wire.** The first version capped it with
`String(msg.choice).slice(0, 80)`, which bounds the wrong kind of thing: every choice in the
player is an option index. It survived a tally by accident — an object key is a string
either way — and would not have survived the next reader. Same trap `progressId` exists for,
and the test caught it.

`classAnswers` is **null rather than an empty tally** when it does not apply, so an exercise
can tell "nobody has answered yet" from "this is not a live delivery". The first is worth
drawing; the second must leave the exercise looking exactly as every student sees it.

## The invitation

**A student could not find out that a lesson had started**, and that was not a decision — it
was a gap. `refreshRunning()` was called from the admin's cohort screen and nowhere else, so
every student arrived by a link somebody had sent them. Screen 7 was drawn and then never
picked up by the build order, which assumed all the way through step 7 that a student would
already be in the room.

**It polls, and the plan said it would be a push.** That was written before the channel had a
shape. A push needs the student to already hold a socket; a socket belongs to one cohort; a
student can be in several. So pushing the invitation means either a socket per cohort held
all day or abandoning the one-socket-per-tab rule that keeps every listener from firing
twice. Neither is worth it for a fact nobody is waiting on to the second — a minute is
imperceptible for "your class has started", and it costs one query per student. The poll
stops while a client is in a session, which is the case where it has nothing to say.

**One invitation, never a list.** A student in two classes being taught at once has a problem
no band can solve, and a list of invitations is a worse answer than the first one.

**Persistent and undismissable are two different claims**, and both are deliberate. It cannot
be closed because a lesson that has started stays started, and a student who dismissed it at
9:01 and looked up at 9:20 would have no way back. It does not interrupt for the opposite
reason: a modal would stop somebody mid-exercise for something they are allowed to ignore,
and being late to a lesson is not an emergency. So it is a band, drawn over whatever they
were doing — including a different course, which is the case the rule exists for.

**It names the course, not just the class.** "Somebody is delivering live" is an invitation to
a room; what a student needs to know is whether it is the thing they are already working on.

### And the listing had to be filtered first

`GET /api/live/session` with no cohort returned **every** running session to any signed-in
caller. That was harmless while the only caller was the admin screen and became a leak the
moment a student's client had a reason to ask: every class id and title in the school, and
the name of whoever is teaching it.

It is filtered per **user** rather than per session — one query against their own partition,
which cannot return a cohort they are not in however many sessions are running. Admins still
see everything, because they already see every cohort.

**Asking about one cohort obeys the same rule**, and that is the same hole through a different
door: cohort ids are slugs a person typed, so `oct-2026-morning` is a guess anybody could
make. A non-member gets a 403 rather than an empty answer — the ticket route already turns
them away, and "there is no session" about a lesson that *is* running sends somebody looking
for a problem that does not exist.

## Remote control

### What ADMIN.md already fixed in place

Five constraints were taken when view-as was built, so that this would be an addition rather
than a rewrite. Three become load-bearing now:

- **The viewed session is a value, not a mode.** View-as fetches that object once; remote
  control feeds the same object from the channel. This is the one that would have cost the
  most to undo.
- **Position is explicit and settable from outside.** Remote control *is* setting it from
  outside.
- **One write gate, at the API layer.** View-as makes progress PUTs inert. Remote control is
  that gate changing behaviour — writes go through, as the student — rather than a guard
  being removed from twenty call sites.

The other two stay true and unchanged: never hydrate a viewed session through the local
record, and never render a snapshot server-side.

### Who writes the student's row

**As the student, attributed to the admin.** A `PROG#` row written under remote control is
the student's progress and their XP — screen 13 says so before it starts — with a `by`
field naming the admin's sub. This is the platform's first case of one person's keystrokes
creating another person's row, and the attribution is what makes it auditable rather than
indistinguishable from their own work.

It goes through the admin function, which may already act on any sub. It must not go through
the account function: that one acts on exactly the caller's sub, there is no sub parameter
in the file, and **the day somebody adds a `?sub=` there for a good reason, the boundary is
gone.** See [ACCOUNT.md](ACCOUNT.md) — the two functions are separate for blast radius, not
for code.

### What the write gate turned out to need

- **One definition of a progress row, in `infra/lambda/shared/progress-rows.mjs`.** Two
  functions write these rows now and there is one description of what one *is* — `at` written
  once, the amount only when it is sent, the code capped. Two copies would have drifted
  exactly where it mattered: a student's XP recorded one way by their own browser and another
  way by an educator's. `NodejsFunction` bundles with esbuild, so the import is compiled into
  each artefact — no layer to version, and a change to that file redeploys both.
- **What stays behind in each function is WHO MAY WRITE**, which is the half that must never
  be shared. The progress function keys on the caller's own sub and still has no sub parameter
  in the file.
- **Being an admin is not enough.** The plan said the write "goes through the admin function,
  which may already act on any sub" — true, and too wide. That would make *an admin may
  suspend anyone* and *an admin may silently award anyone XP* the same permission. So the
  route reads the live session and refuses unless the caller is the one **currently driving
  that student**. The capability then lasts exactly as long as the control does, which is
  what makes the student's Stop button mean something. The cohort travels with every write for
  this reason and no other.
- **The place-marker is attributed too.** An educator who drove somebody to exercise 12 has
  moved where that student resumes tomorrow — a change to their record even though nothing was
  solved, and a bookmark nobody can account for reads as the platform having lost their place.
- **`by` is never removed by a later unattributed write.** The two facts are about different
  moments: an educator solved this for them, and later they came back to it themselves. The
  second does not undo the first, and a row that quietly stopped saying somebody had been
  driving would make the attribution worth nothing.
- **`driving()` is built FROM `watching()`**, so the reads are identical and only the writes
  differ. Two independent readers would be two chances to render one student while recording
  against another, and that failure is silent.
- **The band says work is recorded against them.** An educator who did not know that would be
  surprised by it later, and the surprise would be somebody else's XP.

### The editor, across the channel

**One field in each direction and no merge.** While control is on, the student's editor is
read-only and the educator's is the live one. Two people typing into one buffer is not
something this can do — there is no CRDT here and there should not be one — and a half-built
merge is worse than the rule.

**The student sends their buffer once, when control begins**, and that is the half that
actually helps. A progress row only ever holds the code that *solved* an exercise, so somebody
in the middle of getting one wrong has nothing recorded anywhere for an educator to look at.
It comes off the channel or not at all. After that first send the editor is read-only, so
there is nothing further that could have changed.

**The buffer travels with the position, not on a message of its own.** They change together —
moving to an exercise is also arriving at its starter code — and two messages would show one
exercise's prompt over another's buffer for however long the second took to arrive.
**Undefined rather than empty when there is nothing to send**, so a drive that is only a
navigation does not blank an editor somebody is reading.

**The educator only applies a borrowed buffer to the exercise it was written against.**
Control can be taken while the tab is still landing on the student's position, and dropping
somebody's half-finished query into the wrong exercise is worse than not showing it.

**`EDITOR_LIMIT` matches `STEP_LIMIT`** in the shared row module. A buffer that could cross
the channel and then be refused by the row it was heading for would be a silent loss at
exactly the moment somebody was being helped.

**Read-only is a compartment, not a rebuild.** Control starts and stops mid-lesson, and
recreating the CodeMirror view would throw away the undo history and the scroll position each
time.

### What is still not built

**Not this:** there is no window in which the student edits and the educator does not see it.
While control is on the student's editor is read-only, so only one keyboard is live and
nothing can diverge. Two things genuinely are missing, and they are different from each other:

- **You cannot watch somebody type without taking control.** `#/watch/<sub>` is fed by saved
  progress — the code that *solved* each exercise, not a live editor. So an educator who wants
  to see somebody struggling before deciding to step in has to step in, which freezes them.
  That is the one worth revisiting: the whole point of noticing a stall is to decide whether to
  intervene, and here the only way to look is to intervene.
- **Driving somebody to a different exercise shows their saved code or the starter**, never
  what they had typed there. One buffer crosses, for the exercise they were on when control
  began. Fixing this properly means continuous streaming, which is a bigger feature and a
  different privacy question — a student's editor going to somebody else at all times is not
  the same bargain as one that goes when they are told it is going.

### Sharing is opt-in, and switchable

Taking control asks whether to show the student's screen to the class, and **the box is
unticked.** Helping someone who is stuck is the ordinary case; putting their screen in front
of eleven classmates is not, and a default of on makes the quiet version the thing you have
to remember to ask for.

It is not a one-shot decision either — the same switch sits in the control band, because the
moment to stop showing a screen arrives during the session rather than before it. When it is
on, following clients render the controlled student's position instead of the tutor's, with
every control inert and a bar above the pane naming whose screen it is. When it is off, the
class stays exactly where the tutor left them.

The student is told either way, and can end it. **A screen someone else can drive without
the person being able to stop them is not something to ship.** `release` is conditional on
being *either end of the pair* rather than on being an admin — the student's button is not a
courtesy, it is the same route.

### What building the first half settled

- **It is a TAB, and the tab reports nothing.** This is the load-bearing one and it was not
  obvious. An educator with a control tab open has *two* connections in the room under one
  sub; if both said where they were, the room's idea of where the educator is would flap
  between them and the whole class would follow whichever tab moved last. A control tab is
  driving somebody else's screen — it is not anywhere itself. It follows that the tab must
  not become an ordinary live tab when control ends either: it says so and stops.
- **A drive is addressed to one browser, and the class is not among them** even while
  sharing is on. The controlled student's client applies it and then reports `active` like
  any other move, so what the class follows is what that screen *actually shows* rather than
  what it was told to show. One hop longer, and the only version that cannot drift.
- **`leaderPosition` became `followedPosition`**, and the rename is the feature: while a
  screen is shared, every following client renders *that*. Two functions would mean each
  caller choosing, and a caller choosing wrong would leave half a screen following the class
  and half following the educator.
- **The control tab opens on the student, not on the class's bookmark.** The point of taking
  control is to see what they are seeing; landing on the lesson's bookmark would drag them
  off whatever they were stuck on at the moment control began. Their position arrives with
  the roster rather than with the session, so it is a one-shot watcher — and it must be
  one-shot, or the educator would be yanked back every time the student moved.
- **Control is claimed when the socket opens, not when the tab arrives.** `send` drops
  silently when there is nothing to send on, which is right for a channel and would have made
  `control` the one call that never happened. Re-claiming is idempotent by construction — the
  conditional write allows it when `by` is already you — so a reconnection restores the claim
  rather than leaving a tab that looks like it is driving and is not.
- **A closed tab must not leave somebody locked.** `$disconnect` releases control that has
  lost either end, counted per person rather than per connection: closing one of two tabs is
  not leaving. Conditional on the pair still being the one that lost its browser, so a
  release racing a fresh claim cannot undo it.
- **Controlling somebody who is not connected is controlling nothing**, and is refused with a
  reason. Their browser is what applies a drive; without one the educator would drive a
  screen that does not exist and the student would arrive to find themselves already being
  driven by somebody who had since given up.
- **One notice element, never two.** Each notice is a row of the shell's grid, and a second
  one appearing beside a band pushed the player out of the row that gives it its height.
  That rule was already subtly wrong — it said three rows for both cases — and was only right
  because the one notice that existed could not co-occur with a band. A control tab can show
  both.

## Ending a session

Ending writes the bookmark — the step *after* the one the session finished on, per cohort
and course — deletes the session row, and rolls the running tallies into a history row.

**It never touches a student's own place-marker.** Somebody who ran ahead keeps where they
got to; the bookmark is the cohort's, and the two are different facts that would be
indistinguishable if this wrote `LAST#`.

The summary screen answers four questions and stops: what the next session opens on, what was
covered, who attended, and which exercise cost the class the most. A summary that answers
everything somebody might ask is one nobody reads, and every extra panel competes with the
one line that matters.

**The bookmark is first and it is the only accented thing on the screen**, because it is the
only part of this that *changes* anything. Everything below it is a record, and a record laid
out with the same weight as an action is one where nobody can tell which is which.

**It comes back WITH the ending rather than being fetched afterwards.** It is built from
tallies on the row being deleted, so that is the last moment anything can produce it without
a second read — and the screen that shows it is the one that pressed the button. A spinner
there would be one over an answer we already had. The history row is written **before** the
session row is deleted, in that order and not the other, for the same reason.

### The tallies, and where each of them has to be written

- **Attendance cannot be derived at the end.** Connection rows are deleted on `$disconnect`,
  so by the time a lesson finishes the only people left to count are the ones who stayed —
  which is the opposite of the question being asked. It accumulates on the session row, as a
  whole value per person rather than a counter, because "when they first appeared" and "how
  long they were here" are not both counters. `SET people.#sub` touches one path, so twelve
  students arriving together do not contend; two tabs of the *same* person can lose a write,
  which is a fair trade for attendance against a read-modify-write on every socket.
- **What was covered is where the EDUCATOR went**, not where anybody went. A student reading
  ahead has not covered anything with the class, and counting them would make the summary a
  record of the most restless person in the room.
- **The per-exercise tally is the one thing several people hit at once** — twelve answers in
  ten seconds — so it is an `ADD` and not a read-modify-write, which would lose them by
  construction. `ADD` needs the document path to exist, which is why the educator's arrival at
  an exercise *seeds* it in the same write that records it as covered. A student answering
  something the class has not reached takes the uncommon branch and seeds it there: one extra
  write on the rare path rather than two on every one.
- **Educators are left out of both.** The person reading the summary is not somebody whose
  attendance is in question, and an educator demonstrating an exercise wrongly in front of the
  class must not appear in it as the class having struggled.
- **`worst` is ordered by what went wrong, not by attempts.** An exercise everybody tried once
  and got is not the one to look at; one six people could not run is.

**The tallies are seeded empty when the session starts** rather than created on first use, and
that is not tidiness: every one of these writes is to a document *path*, and a path whose
parent is absent fails the whole update.

**Reading history back is not built.** The row is written and the summary is shown once; a
screen that lists past sessions belongs with the platform page in [backlog.md](backlog.md),
which is where the per-course and per-cohort views already are. Writes before views, as
everywhere else here.

## `preview.js`

`icecore dev --as admin` is the only way to look at any of this without AWS behind it, and
the house rule applies in full: **a state that cannot be reached locally is a state nobody
sees before shipping.**

The channel cannot be faked with a real second party, so do not pretend to. A
`preview-live.js` drives the same store from a script: for `--as admin`, a cohort whose
students arrive, answer, go idle and wander off on a timer; for `--as student`, an
invitation that appears a few seconds in, a tutor who moves, and a control session that
starts and ends. It must reach the refusals too — the cohort that is already live, and the
student ending control on their own — for the same reason the sign-in preview reaches the
unopened-invitation refusal.

`previewRole()` is gated on `import.meta.env.VITE_ICECORE_PREVIEW` and `bundle` sets it
false, so none of this can leak into anything that ships.

## The boundary

Both existing rules hold, and neither is strained by this feature — which is worth checking
rather than assuming, because it is a feature that touches everything.

**Content stays out of the platform.** Live delivery reads a course exactly as the player
does and writes only platform state: sessions, positions, presence, bookmarks, progress. It
adds no reason for a course id, a unit mapping or an exercise to appear in this repo.

**The admin area may read content and never write it.** A tutor watching a class stall on
2.4.2 is the platform doing its job; fixing 2.4.2 is a commit in the course repo. The
summary screen is the most tempting place this rule will ever be broken — it names a bad
exercise, on screen, to the person who wrote it — and it must stay a report.

## Order I would build it

Writes before views, as with the other two plans: a screen can be built later against data
that exists and cannot be built at all against data nobody recorded.

1. ~~**The channel.**~~ **Built, not deployed.** WebSocket API, the ticket route on the HTTP
   API, `$connect` spending the ticket, connection rows, fan-out by GSI, and `live.js`
   holding one socket per tab. Nothing user-visible: `say` broadcasts to everyone in the
   cohort and to nobody else, which is the whole deliverable and the thing to check first
   on a deployment.
2. **The session row and the lock**, the Live button and its three disabled states, the
   course picker, the band. Tallies start being recorded here, before anything reads them.
3. ~~**Presence and the participants panel**, including the fourth state.~~ Done.
4. ~~**Following**: position broadcast, the slide clamp, leaving, catching up.~~ Done.
5. ~~**Chat**, docked and undocked.~~ Done.
6. ~~**Per-exercise class results** — a read of events that already exist by this point.~~
   Done, and **the description was wrong**: no event existed to read. See below.
7. **Remote control**, in two passes. ~~The control itself: `control` / `sharing` /
   `release` / `drive`, both bands, the sharing prompt, the classmate view.~~ Done. **Pass
   two: the write gate** — a `PROG#` row written as the student with a `by` naming the admin,
   through the admin function and never the account one — **and the editor buffer.**~~ Both
   done. Splitting was worth it: the second pass turned out to need a shared row module and a
   tighter permission than the plan had specified.
7½. ~~**The invitation**, and the listing filter it needs.~~ Done — and it was never in this
   list, which is how it got missed. Screen 7 was drawn with the rest and every step up to
   here quietly assumed a student would already be in the room.
8. ~~**The summary.**~~ Done. ~~The bookmark, then the summary.~~ The bookmark **moved into step 2**,
   and the reason is worth keeping: without it the course picker said "never delivered live"
   about a cohort that had just been delivered to, while the session nonetheless *resumed*
   in the right place — because `open()` had restored the tutor's own `LAST#` marker. The
   feature looked like it worked and the label looked like the bug, when the truth was the
   other way round. **Two bookmarks that are indistinguishable on screen cannot be built one
   at a time.** The summary is still last: it is what a tutor would like, where the bookmark
   is what the next session needs.

## Open questions

- **A student invited to a session for a course they are not enrolled on.** Deferred, and
  recorded under Deferred in [backlog.md](backlog.md). Reachable by construction, and every
  answer leaves the session itself unchanged.
- **Two tabs, one student.** Two connections, one sub. Follow both, or make the newest win?
  The second is less surprising and needs the older tab told why it stopped.
- **What a late joiner sees.** The current position and the last 200 messages is the
  proposal. Whether they should also see the slides already walked is a content question,
  not a channel one.
- **Whether the bookmark should be adjustable from the cohort screen** as well as from the
  summary. Probably yes, and it is one row.
- **How long a `ttl` on the history rows should be.** A year is the proposal. It is the
  only number here that cannot be changed later without losing the rows it was already
  applied to.
