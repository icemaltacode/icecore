# Live reliability: plan

The live channel has been losing messages in every busy lesson since at least 2026-09-09. It
shows in three places: the shared editor stalls, slide annotations lag or stop, and students stop
following the educator from page to page. This plan fixes the cause first. Second, it stops the
educator's own connection being cut by oversized messages, and stops moves being lost while it
reconnects. After that it makes the shared editor, and then the rest of the channel, recover from
a message lost for any other reason, so that one dropped message can never again leave a student
behind.

Status: **Phases 0 to 3 are built, deployed and measured** (2026-09-29). Phase 4 is not
started. Diagnosed on 2026-09-29 from the live function's logs and
metrics, during a lesson, without touching the deployment. Keith confirmed two things since:
the stalls he saw that morning fell in the stretch the logs show failing, and he writes by hand
on slides in most lessons and has seen the "Connection lost" band flash just after a stroke.
That led to fault 1 below being fixed in Phase 2. Measuring it since has narrowed fault 1 and
left the flashing band unexplained; see fault 1.

## Decisions taken

| | |
|---|---|
| **Transport** | Kept. API Gateway and Lambda are nowhere near a limit, and the fault was in our code |
| **Cause** | One management client per container, reused, instead of a new one for every message |
| **Message size** | Nothing goes on the wire larger than 28KB in one piece. A deck patch that is bigger is split and reassembled; anything else that big is refused rather than dropped or cutting the connection |
| **Position** | A move counts as reported only once it has actually been sent, and every reconnection reports it again |
| **Protocol** | Full snapshots from one writer, numbered, and resent while the writer is idle. No diffs, no CRDT |
| **Failures** | Named, counted and alarmed, including why a socket closed. Swallowing them silently is how this ran for three lessons |
| **Catching up** | A light roster every 30 seconds restores any discrete message a client missed |
| **Order** | Measure first (Phase 0), then four phases, each deployable and revertible on its own and each measured before and after. Phase 1 ships first, and Phase 2 as soon as it is built |

## What is wrong

### The cause

`managementFor` ([index.mjs:181](infra/lambda/live/index.mjs#L181)) builds a new
`ApiGatewayManagementApiClient` every time the function sends anything: once per `emit`, once
per `to`. Every client brings its own connection pool. So every delivery to every student opens
a new HTTPS connection, with its own DNS lookup and TLS handshake. The pool keeps that
connection open for reuse, but the client that owns it is thrown away, so nothing ever reuses
it.

The leaked connections pile up inside the warm container for as long as it lives. Once enough
have accumulated, DNS lookups start failing with `getaddrinfo EBUSY`, and every post that
needed one fails. `emit` logs the failure and moves on
([index.mjs:289](infra/lambda/live/index.mjs#L289)). That is the right response to one
unreachable student and the wrong one for a whole room, and it kept the Lambda Errors metric at
zero throughout.

It is the only client in the repo built this way. Every other Lambda, and the DynamoDB client
in this same file, creates its clients once, at the top of the module.

### The evidence

- **Failed deliveries by lesson day:** 158 on 09-09, 2,850 on 09-10, 2,089 on 09-29. All but
  75 of the 5,097 were EBUSY; the rest were `AggregateError` connection failures.
- **Whole messages, not stray deliveries.** On 09-29, 364 messages lost at least one recipient,
  and 263 of those lost six or more, in a room of about nine.
- **Only old containers fail.** Every container that failed had served 367 to 824
  invocations, and its memory had risen in a straight line from 117MB to 234MB of its 256MB.
  Every fresh container failed nothing. Which container a message happens to land on is why
  the problem looks random.
- **The DynamoDB calls in those same containers never failed**, at the same moments. They
  reuse their connections.
- **Reproduced locally** with the SDK version that is deployed (`@smithy/node-http-handler`
  4.12): 30 messages to 9 recipients opened 270 connections and left all 270 open. One shared
  client opened 17 and reused them.
- **Not capacity.** Account concurrency is 1,000, there were no throttles, traffic averaged
  about one invocation a second, and at most 16 ran at once.
- **Confirmed against a lesson.** The failures on 09-29 ran from 10:30 to 11:03 Malta time,
  with a short burst at 10:02, and Keith confirmed that stretch as one where the editor stalled.

Drawing and sharing are the two heaviest traffic on the channel, so they are what degrades a
container fastest. A deck frame goes to the whole room up to ten times a second while the pen
moves; a push goes to the whole room on every keystroke. The pointer is faster still, but it
goes to one student.

### Four smaller faults that make it worse

**1. A snapshot over 32KB reaches nobody.** The Lambda carries no deck patch over 32KB
(`DECK_LIMIT`, [index.mjs:73](infra/lambda/live/index.mjs#L73)) and drops a bigger one without
a word. The deck sync lets a patch reach 96KB (`CAP`, [decksync.js:81](app/src/decksync.js#L81)),
so everything between the two left the educator's tab and went nowhere.

The patch most likely to cross the line is the snapshot sent 600ms after every stroke
([decksync.js:298](app/src/decksync.js#L298)). It holds **every annotated slide in the deck**
([decksync.js:241](app/src/decksync.js#L241)), so it grows all lesson, and by that file's own
measurement handwriting costs about 10KB a word. A few written words across a deck puts it over.
The snapshot exists to give a student back a stroke they missed, because a student missing a
piece declines every later piece of that slide. Once it stops arriving, that slide stops
updating for that student for the rest of the lesson. The rig measured it directly: 26 frames
over 32KB sent while writing on five slides.

**API Gateway has limits of its own, and past them it cuts the SENDER's connection** with code
1009 rather than refusing the message. [AWS documents](https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-execution-service-websocket-limits-table.html)
a 32KB frame and a 128KB message. Measured against the deployment:

- **Node's WebSocket client is cut at 40KB** (the oversize probe).
- **Chromium 153 survives 126KB and is cut at 130KB**, "Message too big". It evidently frames a
  large message in a way API Gateway accepts, where Node's client does not.

**This corrects the first version of this plan**, which said that an oversized snapshot cut the
educator's connection after every stroke. That was generalised from Node's client and a test
against a local server. The deployed deck sync never sends more than 96KB, so in Chromium the
snapshot was being dropped by the Lambda, not cutting the socket. Other browsers were not
measured; parts of at most 28KB are safe whichever way a browser frames a message.

**Why Keith saw "Connection lost" flash while drawing is therefore still open.** The likeliest
cause is the leak itself: while an educator draws, almost nothing comes back to their tab but
heartbeat replies, those were being lost (143 of 468 in the synthetic lesson), and three missed
replies make the tab declare the socket dead and reconnect. In the rig, the band flashed during
drawing on degraded containers and not on healthy ones. Step 4 logs every close code, so the next
lesson says which it was.

The same limits apply to every other message a client sends. `pushEditor`, remote control's
`drive` and the student's `buffer` send an editor's text with no cap at all
([delivery.js:600](app/src/delivery.js#L600), [delivery.js:678](app/src/delivery.js#L678)).
Chat caps at 20,000 characters, but the limits are in bytes: JSON escaping and non-ASCII
characters can take 20,000 characters past 32KB.

**2. A move is recorded as reported before it is sent.** `report()` sets `lastAt` and
`lastSlide` and only then calls `send`, ignoring its answer
([delivery.js:273](app/src/delivery.js#L273)). If the socket is between connections, the move
is lost, and the client believes it was delivered. Nothing reports it again until the educator
moves, or up to a minute later when the activity throttle next lets a report through.

**3. Nothing reports the educator's position when a socket reopens.** On `open`, a client asks
for the roster and nothing else ([delivery.js:490](app/src/delivery.js#L490)). The educator's
new connection row has no position, and every student's copy of it is null. After any
reconnection (the two-hour cap, a wifi blip, a heartbeat that gave up), students have nothing to follow until
the educator next moves.

**4. Moves and pushes are unordered.** Each is its own concurrent invocation, so an older one
can arrive last. The `moved` handler applies whatever arrives last
([delivery.js:414](app/src/delivery.js#L414)), and so does `synced`. The deck already guards
against exactly this ([index.mjs:1966](infra/lambda/live/index.mjs#L1966)).

### How that produces what was reported

| Reported | Why |
|---|---|
| **The editor lags** | Every delivery pays for a DNS lookup, a TCP connection and a TLS handshake, on a Lambda with about a seventh of a CPU. The editor also waits for a 160ms pause before sending anything ([CodingExercise.vue:92](app/src/components/CodingExercise.vue#L92)), so fast typing arrives in lumps |
| **It stops for a while, then catches up** | Pushes that land on a degraded container are lost. Each push carries the whole buffer, so the next one to reach a healthy container restores everything |
| **It never catches up** | The last push before the educator stopped typing was lost, and nothing sends it again. Or an older push arrived after a newer one and won (fault 4) |
| **Share editor does nothing** | The button never moves by itself. It waits for the `syncing` broadcast ([delivery.js:588](app/src/delivery.js#L588)), and that broadcast is one of the messages that gets dropped. The server then has sharing on while the button says off, and the educator's tab sends no keystrokes, because it only pushes while it believes sharing is on ([App.vue:1066](app/src/App.vue#L1066)). A click made while the socket is reconnecting is discarded without a trace ([delivery.js:593](app/src/delivery.js#L593)) |
| **Annotations lag, or stop** | Deck frames are lost to the leak like everything else. A lost piece is worse than a lost push: a student holding less than the next delta expects declines it, and every delta after it on that slide, until a snapshot repairs them. Past 32KB the snapshot is dropped by the Lambda (fault 1), so that slide stops updating for that student for the rest of the lesson |
| **Next and Previous stop moving students** | A dropped `moved` is never sent again, because the server only broadcasts a *change* of position ([index.mjs:1061](infra/lambda/live/index.mjs#L1061)), so students stay put until the educator moves again. Sharing and drawing degrade containers fastest, which is why it tends to follow them. A Next pressed while the educator's socket is reconnecting, for any reason, is lost by faults 2 and 3. Fault 4 can land a student one page behind |

The same losses hit every other message too: remote control, the whiteboard, chat and heartbeat
replies. Reconnections went from 4 in the half hour before the failures started to 17 in the 45
minutes around them.

## The shape of the fix

One educator writing while a room reads is the easiest kind of sync there is. Each push already
carries the whole buffer, so no push depends on any other. Three properties make that reliable:

1. **Messages that arrive.** Phase 1 stops the leak. Phase 2 stops messages too large to cross,
   and moves being dropped while a socket reconnects.
2. **A number on every push and every move**, so a reader keeps the newest. Phase 3.
3. **The current state sent again while the writer is idle**, so anything lost, for any reason,
   is replaced within seconds. Phase 3 for the editor, Phase 4 for the rest of the channel.

## Phase 0: measure first

Every fix below is measured before a class meets it. The instruments are built and run
against the current deployment first, and each has to reproduce the fault it is for. A test
that has never failed proves nothing, so a pass after a fix only counts once the same test
has failed before it.

### 0a. A synthetic classroom

[test/classroom.mjs](test/classroom.mjs), `AWS_PROFILE=ice npm run test:classroom`. One
educator socket and a room of student sockets, playing a lesson's traffic through the real API
Gateway and Lambda: typing, drawing, a move every five seconds and the heartbeat. By default
it runs 12 students for 12 minutes, which is roughly the 09-29 lesson's deliveries compressed
into twelve minutes.

- **It counts at the far end,** what each student would see: whether their editor holds the
  last push 2.5 seconds after typing stops, whether they hold the last drawing a second after
  the pen lifts, and whether they know where the educator is 2 seconds after a move. Also
  every delivery's latency, everything missing, and anything that arrived out of order.
- **It reads the Lambda's side too:** failures by kind, memory by container, duration and cold
  starts, for the same window.
- **No passwords.** It writes its own tickets and session rows with the `ice` profile, so it
  starts at `$connect`, which is where every fault here lives.
- **It will not run during a lesson,** and stops if one starts, because it shares the Lambda's
  containers with every real class. It cleans up everything it wrote.

After a run against the current deployment, the containers it degraded can outlive it. A
configuration change to the function replaces them all, so every such run is followed by one.

### 0b. The oversize probe

`npm run test:classroom -- --oversize`. The educator socket sends deck messages of 16, 30, 40
and 80KB and records whether the socket survives and the student receives each.

### 0c. Real browsers, scripted

[test/rig.mjs](test/rig.mjs). Keith's two debug Chromium profiles (see **Proving it**), signed
in once as the educator and as a test student, driven over the DevTools protocol against the
live site. It runs the client code the other two cannot: the Share editor button, a move
lost during a reconnection, and keystroke-to-screen time in the real editor. It cuts the
educator's socket on demand through API Gateway's management API, which is exactly what the
two-hour cap and a 1009 close do.

### Results

**The synthetic classroom**: 12 students, 12 minutes. "Stale" is the question a student would
ask: 2.5 seconds after typing stops, a second after the pen lifts, 2 seconds after a move, is my
screen right? Phase 2 changes only the client, which this does not run, so its column is Phase 1's.

| | Before | After Phase 1 |
|---|---|---|
| Editor pushes that never arrived | **49.7%** | **0%** |
| Student's editor stale after typing stopped | **57.3%** | **0%** |
| Annotation frames that never arrived | **46.5%** | **0%** |
| Student's drawing incomplete after the pen lifted | **28.8%** | **0%** |
| Moves that never arrived | **39.6%** | **0%** |
| Student wrong about where the educator was | **39.6%** | **0%** |
| Push latency, p50 / p95 / max | 381 / 670 / 2,032 ms | 73 / 96 / 656 ms |
| Arrived out of order (pushes / annotations) | 608 / 1,212 | 8 / 13 |
| Heartbeat replies lost | 143 of 468 | 0 of 468 |
| Lambda: failed posts (EBUSY) | **16,622** | **0** |
| Lambda: peak memory per container | 230MB of 256MB | 137MB of 1,024MB |
| Lambda: p50 / p99 duration | 258 / 786 ms | 34 / 134 ms |

The same harness with 8 students, run as background load for the browser rig, lost 14%, then
78%, then 63% of pushes on the deployment before Phase 1: each run started on containers the
previous one had degraded, which is the "restarting the share does not help" of a real lesson.

**Real browsers** ([test/rig.mjs](test/rig.mjs)): the educator and a test student in two Chromiums,
with an 8-student synthetic classroom running alongside as load. The educator's socket was cut 6
times in every run, by the cut scenario, and by nothing else.

| | Before | After Phase 1 | After Phase 2 |
|---|---|---|---|
| Moves (slides and rows) the student never followed | **17 of 21** | 11 of 22 | **0 of 22** |
| Next pressed while the educator's socket reconnected, never followed | **6 of 6** | 6 of 6 | **0 of 6** (followed in 0.65s) |
| Share editor pressed and nothing happened | **4 of 10** | **0 of 10** (85ms) | 0 of 10 |
| Share on, but the educator's tab sent no keystrokes | **yes** | no | no |
| Student's copy of the editor never caught up after a pause | **4 of 4** | **0 of 4** | 0 of 4 |
| A typed line first reaches the student after | 4.8s | 4.7s | 4.8s (0.12s after Phase 3, below) |
| Updates the student sees while a line is being typed | 0 | 0 | 0 (25 to 45 after Phase 3) |
| Largest annotation frame sent | 89KB | 89KB | **26.8KB**, in parts |
| Snapshots over 32KB that reached the student whole | **0 of 7** | 0 of 7 | **12 of 12** |
| Annotation frames that reached the student | 271 of 356 | 349 of 356 | **429 of 429** |
| Next after writing on a slide, never followed | 1 of 5 | 0 of 5 | 0 of 5 |

The 11 slide steps missed after Phase 1 did not reproduce: two traced repeats, one under the
same load, followed 22 of 22. The likeliest cause is the student's page still busy after setup,
which passes through a Python exercise; it is recorded rather than explained away.

**The oversize probe**

| | Before | After Phase 1 | After Phase 2 |
|---|---|---|---|
| Node's client, 16KB / 30KB whole | arrive | arrive | |
| Node's client, 40KB whole | **socket cut, 1009**; reaches nobody | the same: API Gateway's limit | |
| Chromium, 40 to 126KB whole | socket survives; **the Lambda drops it**, reaches nobody | | |
| Chromium, 130KB and over, whole | **socket cut, 1009 "Message too big"** | | |
| 40 / 80 / 200KB, in parts | not yet possible | **all arrive whole, socket stays open** | the same, and the player now sends them |

The route that carries parts shipped with Phase 1's deploy, inert until a client sends parts.
The Lambda records API Gateway's cut of an oversized sender as **1006** "Connection closed
abnormally", not the 1009 the client sees, so that is the code to look for in a lesson's log.

**Phase 3, in real browsers.** The rig gained two scenarios for it: `start` presses Share on code
already written and waits for the student's copy to match, and `dropout` takes the student's
network away while the educator writes a line, brings it back, and waits for the two to match.
Run with the same 8-student synthetic classroom alongside. After the deploy, every scenario was
run, not only these, because step 14 changed how a follower applies a move.

| | Before Phase 3 | After Phase 3 |
|---|---|---|
| A typed line first reaches the student after (p50) | **4.75s** | **0.12s** |
| Updates the student sees while a line is being typed | **0** (4 pushes for 143 keystrokes) | **25 to 45** a line (160 pushes) |
| Pushes on the student's wire within 300ms of leaving | 100% (p50 97ms) | 100% (p50 89ms, p95 110ms, 0 lost, 0 out of order) |
| The two copies match after typing stops | 4 of 4, in 152ms | 4 of 4, in 7ms |
| Share pressed on code already written, shown to the student | **never** (see below) | **3 of 3, in 0.18s** |
| Student offline while a line was written, caught up after coming back | **never** (see below) | **3 of 3, 1.2s** after the network returned |
| Share editor button moved when pressed | 86ms (only on the answer) | **4ms** ("Starting…"), confirmed in 93ms, 0 of 10 failed |
| Moves followed / Next during a reconnection / snapshots whole | | 22 of 22 / 6 of 6 / 12 of 12, as after Phase 2 |
| Pushes arriving numbered; rosters saying when | | 214 of 214; yes |

**The rig misread two of the before numbers, and the first after run.** It compared the two
editors' text as drawn on the page, and CodeMirror draws only the lines near the viewport. Every
run of the rig appends to the educator's draft, so by this phase the buffer was longer than
either pane, and the two panes, of different heights, held different windows of it: the first
after run reported "never caught up" on every comparison while every push had arrived and the
student's last 160 characters equalled the educator's. It reads each editor's whole document
from CodeMirror's own state now, and a fallback to the drawn lines can never compare equal.
The "never" for `start` and `dropout` before Phase 3 is therefore not a browser measurement.
It is still what that code did: it sent nothing after a Share press or after a student
reconnected until the educator next typed, and the new checks in `test/educator.mjs`, run
against it, saw no push after the press and none after 2.7 idle seconds. The editor comparison
before (152ms) was a real match. The rows that do not compare text are unaffected.

**One synthetic student went silent** in the 14-minute load run beside the after run: from about
two minutes in it received nothing, its heartbeat went unanswered, and its socket never closed.
The Lambda's log shows why without saying so: that connection closed at the end as `unknown`,
meaning its row had been deleted while API Gateway still held the socket open, and the only
thing that deletes a live connection's row is `emit` receiving `GoneException` for it, which it
treats as routine and does not log. A 5-minute rerun alongside six cuts of the educator's socket,
now recording when each student's row disappears, lost nothing. Not caused by this phase (its
Lambda change only adds two fields to a push, and the synthetic students do not run the app). A
real browser in that state gets no pong and reconnects within about 65 seconds, then catches up
through step 11; the harness never reconnects, so it stayed silent. Open question 3.

What this phase did not measure on the deployment is the Share button's give-up path: four
unanswered asks, the warning, and `probe()` replacing a half-open socket. A room that does not
answer cannot be made on demand against the real Lambda; `test/educator.mjs` covers it in a
build, and `?hold=sync` shows it under `icecore dev --as admin`.

## Phase 1: stop the drops

Lambda and stack only, in one `just infra-deploy`. Nothing on the wire changes.

### 1. One management client per container

In [index.mjs:181](infra/lambda/live/index.mjs#L181):

```js
const management = new Map();
const managementFor = event => {
  const endpoint = process.env.WS_ENDPOINT
    || `https://${event.requestContext.apiId}.execute-api.`
       + `${process.env.AWS_REGION}.amazonaws.com/${event.requestContext.stage}`;
  if (!management.has(endpoint))
    management.set(endpoint, new ApiGatewayManagementApiClient({ endpoint }));
  return management.get(endpoint);
};
```

- **Keyed by endpoint rather than held in one constant**, because the socket function only
  learns its endpoint from the event (the CloudFormation cycle the existing comment explains).
  In practice the map holds one entry.
- **`emit` and `to` need no change.** Both functions, `Live` and `LiveApi`, run this module, so
  both get the fix. So does every message type: pushes, moves, deck frames, control, chat.
- **The default pool allows 50 connections per client**, more than any class today. A room
  larger than that queues its posts rather than failing them.
- **A kept connection can be closed by the far end while the container is frozen** between
  invocations. The SDK's standard retry resends that one post, so it costs a few milliseconds,
  not a message.

**Test:** a new `test/relay.mjs`. The Lambda exports `emit` and `managementFor`. The test points
`WS_ENDPOINT` at a local HTTP server, gives the SDK throwaway credentials through the
environment, and asserts two things: `managementFor` returns the same client on every call, and
30 fan-outs to 9 rows open at most 27 connections (the deployed code opens 270). It skips, and
says so, when `infra/node_modules` is not installed. Added to `npm test`.

### 2. Give the live functions four times the CPU

`memorySize: 1024` for `Live` and `LiveApi`
([icecore-stack.js:452](infra/lib/icecore-stack.js#L452)). Lambda allocates CPU in proportion
to memory: 256MB buys about a seventh of a vCPU. A fan-out is CPU work, because every post is
serialised, signed and encrypted. More CPU also shortens cold starts, which took about 290ms
on 09-29.

Cost: that lesson was about 4,700 invocations. At 1GB and its durations that is roughly a cent
per lesson, and faster invocations bring it down.

### 3. Name what failed, and alarm on it

- **Log what was lost.** `emit` and `to` log the message type and the error code with every
  failure, such as `post failed push <connection> EBUSY`. Today's lines say that a post failed
  but not what it carried, which is why this plan cannot say how many of the losses were
  pushes and how many were moves.
- **Count the failures.** A metric filter on the `Live` log group counts `post failed` and
  `reply failed` lines into `icecore/LiveDeliveryFailures`. The group is created inside the
  `fn` helper, so either reach it through the function or hoist it out of the helper.
- **Alarm on them.** Fire at 10 or more failures in 5 minutes, into the existing Alerts topic.
  `GoneException` is routine and is not logged, so the baseline after this phase should be
  zero.
- **Catch unhandled throws too.** `live` and `liveApi` join the Errors alarms
  ([icecore-stack.js:723](infra/lib/icecore-stack.js#L723)). Today an unhandled throw in the
  live function alarms nowhere.

Why: this failure shows up as a room going quiet, which nobody reports as an error, and it was
invisible to every metric that existed.

### 4. Record why sockets close

The Lambda's `$disconnect` handler logs one line per socket: who it was, and the close code and
reason API Gateway hands it (`closed tutor 1009 "..."`).

- **This is how the flashing band gets explained.** A socket closed for an oversized message
  logs 1009; one the tab gave up on after missed heartbeat replies closes from the client side.
  Both looked the same from the educator's chair until now.
- **Changed from the first version of this plan**, which put it in the stage's access log. The
  close code and reason are not access-log variables for a WebSocket API (checked against AWS's
  list), and access logging would also have needed a region-wide CloudWatch role set by hand.
  The `$disconnect` event already carries them to the function that handles it.
- **Cost:** a few dozen lines a lesson.

### 5. Write the rules down

Two CLAUDE.md gotchas, with the numbers above:
- An AWS SDK client is created once per container, never per call.
- Nothing a client sends may exceed 28KB in one piece: the Lambda drops a deck patch over
  32KB, and API Gateway cuts the sender's connection over its own limits. It points to step 7.

LIVE.md's **Fanning out** section gets a line pointing to both.

### Phase 1 checks

1. `npm test`.
2. `just infra-diff` shows only: the two functions' code and memory, one metric filter and
   three alarms. Anything else is a reason to stop and look.
3. `just infra-deploy`.
4. `npm run test:live` against the deployment.
5. At the next lesson, the queries under **Proving it**.

## Phase 2: stop losing snapshots and moves

Faults 1, 2 and 3: the ones that leave a student's slide stuck with strokes missing, and that lose
a Next pressed while the educator's socket is reconnecting. This ships as soon as it is built,
and does not wait for a lesson on Phase 1. The Lambda goes first, because it has to know the `part`
type before any client sends one; then the app.

### 6. Make sends visible to the tests

`test/harness.mjs` says plainly that anything which sends is not covered, and most of the
changes from here on are on the sending side. `send()` ([live.js:105](app/src/live.js#L105))
records what it would have sent into an outbox under preview, exposed to the tests through the
harness entry the way `emitLocal` is. It still returns false, so every preview fallback behaves
exactly as it does today. The tests below read the outbox.

### 7. Nothing larger than a frame

Fault 1. The rule is that live.js never puts more than 28KB on the socket in one piece, and it is enforced in
one place.

- **`send` measures in bytes**, as the frame limit does: the UTF-8 length of the JSON, not its
  character count. The threshold is 28KB, leaving room under 32KB for the envelope.
- **A deck patch over it is split.** It goes as numbered parts: `{ type: 'part', of, to, id, n,
  total, chunk }`. The inner type (`of`) and its audience (`to`) stay outside the chunk, so the
  Lambda can route a part without reassembling it.
- **The Lambda carries parts.** A `part` case accepts only an `of` on an allowlist, which is
  `deck` alone. It applies exactly the entitlement check `deck` applies (factored out so both
  use one definition), and relays the part to the same audience through the same cached
  connection list. `DECK_LIMIT` then applies to each part, which is what it was always
  measuring against.
- **Only the deck splits,** because it is the only message the Lambda passes through
  untouched. `push`, `drive`, `buffer` and `say` are rewritten on the way through (trimmed,
  validated, stamped), which a Lambda cannot do to a message it only sees in pieces.
- **The others are capped where they are made.** `pushEditor`, `drive` and `sendBuffer` trim
  their text to the Lambda's own 20,000-character limit before sending, as chat already does. If
  one is still over 28KB after that, `send` refuses it with a console warning and returns false.
  One message not arriving is better than the educator's connection being cut and everything
  behind it lost.
- **The receiver reassembles.** live.js collects parts by `id` and hands the complete message to
  `deliver()`, so decksync.js receives an ordinary `decked` and nothing above live.js knows
  parts exist. An incomplete message is dropped after 5 seconds; the next snapshot replaces it.
- **`CAP` stops pretending to be the wire limit.** It becomes a sanity ceiling on a single patch,
  say 512KB with a warning, because splitting is now the transport's job.
- **The split and join are pure**, in `app/src/parts.js`, so they are tested directly.

**What it fixes:** snapshots that never arrive, so a student who missed a piece of a slide gets
it back within a second of the pen lifting, however much has been drawn; and any message large
enough to get the sender's connection cut, in any browser.

**Tests:**
- `test/parts.mjs`: a 100KB message splits into parts under 28KB and rejoins byte for byte, in
  any arrival order; a message missing a part yields nothing and is forgotten after the
  timeout.
- player.mjs: parts delivered out of order through `emitLocal` reach the deck as one patch.
- Outbox: a 60KB deck patch leaves as parts, none over 28KB; a 60KB push is trimmed, and one
  still over the limit is refused rather than sent.

### 8. A move counts only once it has gone

Faults 2 and 3.

- **`report()` records a move only when `send` says it went**
  ([delivery.js:261](app/src/delivery.js#L261)). `lastAt`, `lastSlide` and `lastReport` move
  after a successful send and not before. A move made while the socket is down then stays
  pending, and goes with the next activity event or reconnection.
- **Every `open` reports the position unconditionally**, after asking for the roster
  ([delivery.js:490](app/src/delivery.js#L490)). The new connection row carries a position from
  its first second, so students always have somewhere to follow. It runs for students too,
  which keeps the educator's panel right after a student's reconnection.

**What it fixes:** a Next or Previous pressed while the educator's socket is reconnecting,
whatever cut it, and a room with nobody to follow after the educator's socket is replaced.

**Tests** (reading the outbox; preview never has a socket, so every send fails there):
- A move sends an `active`, and because the send failed, the next activity event sends it again.
- A local `open` sends an `active` whatever the throttle says.

### 9. Against the real deployment

`test:live` gains a check on a real socket pair: a 60KB deck message, sent as parts, arrives
whole at the other socket, and the sender's socket is still open afterwards.

### Phase 2 checks

1. `npm test`.
2. `just infra-diff` shows only the live functions' code.
3. `just infra-deploy`, then `npm run test:live`, then `just deploy`.
4. In the rig (see **Proving it**), write by hand across four slides: the educator's socket
   stays open, and a student who reloads mid-way receives every slide's drawing on the next
   stroke.

## Phase 3: a shared editor that heals itself

The Lambda goes first, then the app. Every change is additive on the wire.

**As built**, where it differs from the steps below:
- **Step 11 asks the exercise component for its buffer** (a `resend` counter prop) rather than
  resending App.vue's copy after checking `myAt` against `currentId`. It is the same rule,
  enforced by construction: only the component on screen can answer, a slides row has none, and
  an exercise nobody has touched yet still answers with its starter, which the `myAt` check
  would have refused to send at all.
- **Step 12's first send goes on the next tick**, not synchronously. One keystroke is two events
  (the text, then the caret), and sent on the first every keystroke would go out twice, the
  first copy with the old caret.
- **Step 13 checks the socket when it gives up.** Four unanswered asks on a socket that reads
  open is the half-open socket the heartbeat takes a minute to notice, so `probe()` in live.js
  pings it and replaces it if nothing comes back within 4 seconds; the reopened socket's roster
  then asks again. A `syncing` this tab did not ask for (another of the educator's tabs, or an
  older request landing late) is adopted as the new intent rather than argued with, so two tabs
  cannot re-assert at each other.
- **Step 15's second check already existed** in test:live. It gained the stamp check and a
  check that the roster says when each position was written.
- **Tests:** `test/beat.mjs`, `test/educator.mjs` (the delivering tab, an admin build) and new
  checks in `test/player.mjs`. Every new check was run against the code before this phase and
  failed there.

### 10. Number every push

- **Sender:** `pushEditor` ([delivery.js:598](app/src/delivery.js#L598)) stamps each push with
  `origin`, a random id minted once per page load, and `seq`, counted up per push. decksync.js
  already mints exactly this id for the deck; it moves to a small `app/src/tab.js`, so a tab has
  one identity on the channel.
- **Lambda:** `push` ([index.mjs:1899](infra/lambda/live/index.mjs#L1899)) carries `origin` and
  `seq` through, validated the way `deck` validates them.
- **Receiver:** `synced` ([delivery.js:425](app/src/delivery.js#L425)) ignores a push whose
  `seq` is not above the last one heard from the same origin. A push with no stamp is applied,
  so an educator tab older than the deploy keeps working. The record is cleared in `forget()`.
- **Accepted edge:** an educator who reloads mid-demonstration gets a new origin, so a late push
  from the old tab could land after the new tab's first one. Step 11 replaces it within 2
  seconds.

**Tests** (player.mjs):
- seq 5 followed by seq 4 leaves seq 5 on screen.
- A push with no stamp is applied.
- A push from a new origin is applied, whatever its number.

### 11. Send the state, not only the changes

In App.vue, in the deliverer's tab only, never in a control tab:

- **When sharing turns on, push the current buffer at once.** Today the class sees nothing until
  the educator next types, and pressing the button and then talking is the normal way to use
  it.
- **While sharing, push the current buffer again whenever nothing has gone out for 2 seconds.**
  A one-second interval checks when the last push went. It stops when sharing stops or the
  session ends.
- **Only when the buffer belongs to the row on screen** (`myAt` checked against `currentId`). On
  a slides row, or an exercise whose starter is empty, the buffer in hand is the previous
  exercise's, and it must not be re-sent onto this one.

Nothing changes on the receiving side. CodeEditor already ignores a value equal to what it holds
([CodeEditor.vue:253](app/src/components/CodeEditor.vue#L253)), so a repeat is invisible.

**What it fixes, within 2 seconds:** a lost push, a stale push after a reload, a student who
joins or reconnects mid-demonstration, and a student who presses Follow again.

**The cost:** one message to the room every 2 seconds, while sharing is on and the educator is
idle.

**Tests** (admin build, reading the outbox):
- Switching sharing on sends a push immediately.
- 2.5 seconds idle sends another.
- Switching it off stops them.
- On a slides row, nothing is sent.

### 12. Send while typing, not after

The editor's beat is a trailing debounce
([CodingExercise.vue:92](app/src/components/CodingExercise.vue#L92),
[PythonExercise.vue:101](app/src/components/PythonExercise.vue#L101)). Every keystroke restarts
a 160ms timer, so somebody typing faster than one key per 160ms sends nothing until they pause.

- **Replace it with a throttle:** the first change goes at once, then at most one send per 100ms
  while changes keep coming, and always a final send carrying the last state.
- **One definition, in a new pure `app/src/beat.js`, used by both components.** The two copies
  are identical today, and two copies is how they would come to differ. Pure means no
  `import.meta.env`, so its test can import it directly, as `walk.js`'s does.
- **Remote control and drafts ride the same beat.** Remote control's drive and the local draft
  save both go out on it, and both are fine at this rate.
- **Up to 10 pushes a second** while typing without a pause. That is affordable once Phase 1 has
  landed and not before, which is why this step waits for it.

**Tests** (a new `test/beat.mjs`, with generous timing margins):
- Twenty changes 20ms apart produce one send at once, about one per 100ms after that, and a
  final one carrying the last value.
- A single change produces exactly one send.

### 13. A Share editor button that answers

- **Pending state.** `sync.pending` holds what this tab asked for and has not yet seen confirmed
  (null, true or false). The button shows `pending ?? on`, so it moves when clicked and says it
  is waiting ("Starting…", "Stopping…").
- **Confirmed** when a `syncing` arrives that matches the pending value.
- **Retried** every 1.5 seconds while the socket is open. The write is a SET or a REMOVE, so
  repeating it is harmless. After four tries the band says it could not reach the class, in
  words the educator can act on.
- **Clicked while the socket is down:** nothing is sent, the button stays pending, and the band's
  existing "Connection lost" line says why. The intent is applied on reconnection (next
  bullet).
- **The roster re-assertion** ([delivery.js:402](app/src/delivery.js#L402)) only handles "on"
  today. It becomes symmetric, driven by an intent that stays null until this tab has pressed
  the button. Once it has, a roster that disagrees gets the intent sent again. A freshly loaded
  tab has no intent, so it adopts whatever the room already has, as it does today.
- **LiveBand emits `!(pending ?? syncing)`,** so a second click before confirmation reverses the
  first rather than repeating it.

**Tests** (admin build):
- With preview's echo withheld, a click shows the pending label, and a second `sync` reaches the
  outbox after 1.5 seconds.
- When the echo then arrives, the button reads Sharing editor.
- Preview needs a way to withhold that echo. That follows the house rule that a state nobody can
  reach locally is a state nobody looks at before shipping.

### 14. Moves in order

Fault 4, for position.

- **The server already stamps each `moved` with its own time (`at`)**, and the connection row
  already keeps `posAt`, the time of the position it holds. The roster's `here` entries carry
  `posAt` as well, so a roster and a `moved` can be compared.
- **The `moved` handler** ([delivery.js:414](app/src/delivery.js#L414)) **applies a position
  only if its time is no older than the one held for that person**, and the roster handler does
  the same per entry. Both times come from the same Lambda clock, so they compare directly.

**What it fixes:** two quick presses of Next landing a student on the first one. Step 16's
periodic roster makes this matter more, since a roster computed a moment before a move could
otherwise walk a student back.

**Tests** (player.mjs):
- A `moved` to C followed by an older `moved` to B leaves a following student on C.
- A roster whose `posAt` is older than the position held does not move them back.

### 15. Against the real deployment

`test:live` gains two more checks on a real socket pair:
- A push arrives with its `origin` and `seq` intact.
- A `sync` from the deliverer comes back to the deliverer.

## Phase 4: a room that catches up

### 16. A light roster, every 30 seconds

Every discrete message on the channel is sent once: `moved`, `syncing`, `controlling`, `ended`.
The roster restores all of them, but a client only asks for it when a socket opens, and the
server never repeats a `moved` (see the table above).

- **Ask again every 30 seconds** while in a session. The follow watcher
  ([App.vue:455](app/src/App.vue#L455)) watches the leader's position, so a corrected roster
  moves a following student to where the class is.
- **The periodic request is `{ type: 'roster', light: true }`,** and the server leaves out
  `members` and `board`. Members cannot change during a lesson. Leaving out the board is
  required, not an optimisation: [board.js:172](app/src/board.js#L172) applies the roster's
  page, and doing that every 30 seconds on the educator's own tab would load the server's copy
  back under their pen, a stroke behind.
- **An absent field means unchanged,** which is how `control`, `sync` and `timer` are already
  read. Two handlers need that change: `room.members = m.members || []` in delivery.js, and
  board.js's `!m.board?.on`, which today would read an absent board as no board and close it.
- **Cost:** one small invocation per student every 30 seconds. For a class of 30, one a second.

**Tests** (player.mjs):
- A light roster that places the leader somewhere new moves a following student.
- A light roster leaves the member list and an open board as they were.

## Deploying

- **Order:**
  1. Phase 0's instruments, run against the current deployment for the before numbers.
  2. Phase 1, as soon as it is built, then the same runs again.
  3. Phase 2, as soon as it is built, without waiting for a lesson in between, then the same
     runs again. None of its faults depends on Phase 1.
  4. A lesson on both, read against **Proving it**.
  5. Phase 3, then Phase 4, each measured the same way.

  Within a phase, the Lambda (`just infra-deploy`) goes before the app (`just deploy`). The
  Lambda has to carry the new fields, and to know the `part` type, before any client sends them.
- **Compatibility:** every change is additive. An old tab's unstamped push is applied, and a new
  client's light roster, answered by an old Lambda, simply comes back full. An old client never
  sends a part.
- **Mid-lesson:** deploying the Lambda closes no sockets. The connections belong to API Gateway
  and the state is in DynamoDB, so the next message simply runs the new code. The app only
  reaches a student when they reload. Between lessons is still the better time.
- **Rollback:** each phase is its own commit, so revert it and redeploy. Nothing in this plan
  changes a table, a row or a key.

## Proving it

### Before Phase 1: a baseline

Recommended, about ten minutes, with Keith driving. Use the two-browser rig: the educator on
port 9222 and a student on 9223, with every websocket frame read on both. Three measurements:

- **The editor.** For each `push` the educator sends, the time until the student's matching
  `synced` arrives. Both browsers are on one machine, so there is one clock. Type normally for
  two minutes, then stop and compare the student's final text with the educator's.
- **Annotation, then Next.** Write a few words by hand across three or four slides, pressing
  Next straight after each. Watch whether the educator's socket closes after each stroke, and
  count the presses that never produced a `moved` at the student.
- **Following alone.** Page through a deck with Next and Previous without drawing, and count
  the same.

Repeating the same measurements after each phase gives the before-and-after.

### After each lesson: the logs

The live log group is `Icecore-LiveLogsA0C0099F-ltizWtQ7XDaG`, in eu-south-1.

Failures, by kind:

```
filter @message like /ERROR/
| parse @message /ERROR\t(?<kind>\S+ \S+)[^\n]*?(?<err>EBUSY|AggregateError|ECONNRESET|\w+Exception)/
| stats count() by kind, err
```

Whether containers still degrade as they age:

```
stats sum(@type="REPORT") as inv, sum(@message like /EBUSY/) as ebusy,
      max(@maxMemoryUsed/1000/1000) as memMB by @logStream
| sort inv desc
```

Speed:

```
filter @type = "REPORT"
| stats pct(@duration,50) as p50, pct(@duration,99) as p99, count(@initDuration) as cold
```

Why sockets closed (after step 4):

```
filter @message like /\tclosed / | parse @message /closed (?<role>\S+) (?<code>\S+)/
| stats count() by role, code
```

### Done means

- **Phase 1:**
  - No `post failed` with EBUSY across a whole lesson.
  - Per-container memory stays flat instead of climbing to the limit.
  - The new alarm stays silent.
  - Every socket's close code is in the log.
- **Phase 2:**
  - No disconnects with code 1009 across a lesson with handwriting on the slides.
  - In the rig, every snapshot sent while writing reaches the student whole.
  - The "Connection lost" band no longer flashes after a stroke, or the close codes say why it
    still does.
  - Every Next and Previous moves the student, including one pressed straight after a stroke
    and one pressed while the educator's wifi is switched off and back on.
- **Phase 3** (all three met on 2026-09-29, see Results):
  - In the rig, 95% of pushes reach the student's screen within 300ms of leaving the educator's.
    *100%, p95 110ms.*
  - After typing stops, the two texts match within 2 seconds, every time. That includes a
    student whose wifi is switched off and back on mid-demonstration. *4 of 4 in 7ms; 3 of 3
    within 1.2s of the network returning.*
  - The Share editor button either confirms within a second or says what it is waiting for.
    *Moves in 4ms, confirmed in 93ms.*
- **Phase 4:**
  - The player tests pass.
  - The logs show the light roster costing what the estimate says.

## Considered and not doing

- **Replacing the transport** (AppSync Events, IoT Core, an always-on WebSocket server, or a
  hosted service such as Ably). The traffic is tiny for what already exists, and the fault was
  in our code. Revisit only if the rig still shows pushes slower than 300ms at the 95th
  percentile after Phase 3.
- **Diffs, OT, or a CRDT such as Yjs.** They solve many writers. With one writer, full snapshots
  are simpler and more robust: each snapshot is complete on its own, so a lost one is late
  rather than corrupting. A buffer is capped at 20,000 characters and is usually a few hundred.
- **Smaller deck snapshots instead of splitting.** Sending only the slide just drawn on would
  shrink them, but a student who joined late would then only ever receive slides drawn after
  they arrived. One slide of handwriting can also pass 32KB on its own, so splitting is needed
  either way.
- **Splitting every message type.** Only the deck passes through the Lambda untouched. The
  others are trimmed, validated and stamped on the way, which cannot be done to pieces, and none
  of them has a reason to be anywhere near 32KB once capped at 20,000 characters.
- **Keeping the buffer on the session row** for late joiners. Step 11 reaches them within 2
  seconds, without a write per keystroke.
- **Caching the session row for `push`,** as `deck` does. A container holding "sharing off"
  would refuse pushes for up to 2 seconds after the switch goes on, which is the start of every
  demonstration.
- **Caching the connection list for `push`.** It would save one query, and DynamoDB was never
  the slow part or the failing one.
- **Provisioned concurrency.** The 09-29 lesson had 35 cold starts at about 290ms, and step 2
  shortens them. Paying to keep containers warm all week is not worth that.
- **Timeouts on each post.** No post has been seen to hang (the slowest invocation on 09-29 took
  1.1 seconds), so a timeout would have nothing to fix yet.

## Documentation, once built

- **CLAUDE.md:** the two gotchas from step 5, and a line under
  **Tests** for `relay.mjs`, `parts.mjs` and `beat.mjs`.
- **LIVE.md:** **Sharing the editor with the whole class** gains the numbering, the resend and
  the button, and links here. Its bullet "What they had written comes back" has been stale since
  the demonstration became a tab of its own (95521e1), and should go at the same time.
  **Following, and leaving** gains steps 8 and 14.
- **decksync.js:** the comment on `CAP` describes a wire limit it never enforced, and is
  rewritten with step 7.
- **test/harness.mjs:** its note that sends are not covered narrows to sends that bypass the
  outbox.

## Open questions

1. **The alarm threshold.** It starts at 10 failures in 5 minutes.
2. **The intervals.** A 2-second resend, a 30-second roster and a 100ms beat are judgement calls.
   Each is a single constant, to be tuned against the rig and the logs.
3. **A row deleted under a live socket.** Seen once (Phase 3 results). Two small Lambda changes
   would make it visible and short: log every row `emit` deletes on `GoneException`, with the
   message type; and when a message arrives from a connection with no row, close that socket
   (`DeleteConnection`) rather than ignoring it, so the browser reconnects within one heartbeat
   (20 seconds) instead of waiting out three (about 65).
