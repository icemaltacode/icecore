# Video and screen sharing: plan

Today a lesson runs in two windows. icecore carries the material, the class's code, the
whiteboard, chat and who is here; Zoom or Teams carries the educator's face, everyone's voice
and a screen share. This plan moves the second window into the first, so that a lesson is one
place, one link and one sign-in.

Status: **not started, and parked.** Written on 2026-10-01 as a sizing exercise, with no
commitment to build it yet. Nothing below has been tried, and every figure in it is to be
confirmed by Phase 0 before any player code is written. The list of what was recalled rather
than checked is at the end.

## What already exists, and what that changes

Most of what makes a meeting tool hard to leave is built: the roster, chat, attendance in the
session summary, deck sync, the whiteboard, the shared editor, Look here, and an educator
watching or taking remote control of a student's session ([LIVE.md](LIVE.md)).

That changes what screen sharing is for. Slides, annotations and code already reach the class
as data, which is sharper than any video of them, costs a fraction of the bandwidth and
survives a student zooming in. So the educator's screen share is for what is **outside**
icecore: an IDE, a terminal, a website. A student's screen share matters even less, because
watching their session already shows the thing a tutor usually asks to see.

What is missing is a transport for faces and voices. That is the whole of this plan.

## Proposed decisions

| | |
|---|---|
| **Transport** | A rented selective forwarding unit (SFU). Amazon Chime SDK first, LiveKit Cloud as the alternative. Never peer-to-peer, never self-hosted |
| **Lifecycle** | A meeting belongs to a live session: recorded on the `LIVE#` row, created on the first join, deleted by `end()` |
| **Identity** | An attendee is keyed on the sub from the claims, never on anything the client says |
| **Independence** | Media and the live channel fail separately. Nothing on screen waits for a call to connect |
| **Origin** | Everything the media SDK *loads* comes from our own origin, like Pyodide. Only the media itself leaves it |
| **Loading** | The SDK is a dynamic import on joining a session. Self-study never downloads it |
| **Recording** | None. Nothing recorded is nothing stored, nothing exported and nothing to erase |
| **Teams** | Runs in parallel for at least a term, and is retired against written criteria |

## Why rented, and why not the other two

**Peer-to-peer does not survive a class.** Every browser uploads its camera once per other
person: in a room of ten, that is nine uploads from a student laptop on home broadband, and the
weakest uplink sets the quality for everyone. It works to about four people and is the wrong
shape past that.

**Self-hosting would be the first server in the stack.** LiveKit's open-source server,
mediasoup and Jitsi all need machines with public addresses, a range of UDP ports open, a TURN
relay on 443 for networks that block UDP, certificates, scaling and monitoring. icecore today
is CloudFront, S3, Lambda, API Gateway, DynamoDB and Cognito, none of which needs patching at
2am. A self-hosted SFU would also make every deploy of it a dropped call for whoever is in one,
which turns "not during a lesson" from a theme rule into an infrastructure rule.

**A rented SFU fits the stack as it is.** The server side is a handful of API calls from a
Lambda. The media servers, TURN and scaling are the provider's.

**Chime first, because it is AWS.** IAM rather than an API key in Secrets Manager, CDK rather
than a dashboard, one bill, and a processor that already handles everything else here. Priced
at about $0.0017 per attendee-minute when this was written, a class of ten for an hour is about
a dollar. Against a Teams licence the institution already pays for, cost is not the argument
for doing this; one place to teach is.

**LiveKit Cloud is the alternative**, with the better developer experience: a cleaner client,
server-side mute, and a data channel good enough to carry the live channel's traffic one day.
That last part is a temptation rather than a reason. The live channel stayed on API Gateway on
purpose ([LIVE-RELIABILITY.md](LIVE-RELIABILITY.md)) and is now measured. Moving it would be a
separate decision with its own evidence.

Phase 0 tries Chime. If it fails anywhere on the list, LiveKit is tried against the same list
before the idea is dropped.

## The meeting

### Where it lives

The meeting is a property of the session, so it lives on the session row. `start()`
([index.mjs:634](infra/lambda/live/index.mjs#L634)) already creates the `LIVE#` row with a
conditional write, and the meeting id joins it. `end()`
([index.mjs:677](infra/lambda/live/index.mjs#L677)) deletes the meeting before the row. A
meeting with no session is a call nobody can be told has ended; a session with no meeting just
has no video.

**Created on the first join, not by `start()`, and recreated when it has gone.** Chime ends a
meeting by itself once it has been empty for a while, and a session row can live for
`SESSION_HOURS`. So the stored id is a hint, never a promise. A join that finds the meeting
gone creates a new one and writes it back with a condition on the id it found. Two students
arriving at once then race on that condition: one wins, the other re-reads and joins the
winner's meeting. It is the pattern `start()` already uses, for the same reason: a check
followed by a write is a race.

### The route

`POST /api/live/media { cohort }` -> `{ meeting, attendee }`, in the live function beside
`/ticket`.

- **The same checks as a ticket**: signed in, in the cohort or an admin, and a session live.
  It is a route of its own rather than more fields on the ticket response because a ticket is
  single-use and minted on every reconnect of the socket, which is exactly the moment a call
  should carry on undisturbed.
- **The attendee's external id is the sub, from the claims.** A reconnect or a second tab is
  then the same person rather than a second tile, and nobody can join under somebody else's
  name. Names on tiles come from the roster, which already has them, not from the provider.
- **The Chime client is created once, at module scope.** This is the function where that rule
  was learned: a client per call leaked a connection per call until DNS failed (CLAUDE.md,
  Gotchas).
- **The IAM grant is four actions**: create and delete a meeting, create and delete an
  attendee. Deleting an attendee is the educator's real lever over a disruptive tab, because a
  mute is only a request (below).

## The player

### Media is never in the way of the lesson

A call that will not connect costs the student the call and nothing else. The deck, the editor
and the whiteboard arrive over the live channel, which neither knows nor cares whether media
connected. A student whose network blocks the provider still follows every slide, and the band
says that the call could not reach them, so the session does not read as broken.

### Where the faces go

Every pane is already spoken for: slides, editor, notes, the live panel. Video tiles are a
design problem before they are a code problem. The proposal:

- **The educator's camera floats**: one small tile over the player, movable and collapsible,
  with its position remembered per student. It is the one face a student needs.
- **Students' cameras appear on the educator's side only**, in the live panel beside the roster
  that already lists them. A student does not need a gallery of classmates to follow a lesson,
  and every tile drawn is a stream decoded on a laptop that is also running Python.
- **Whoever is speaking is lit in the roster**, and their tile shows if their camera is on.

### The educator's screen share

- **It takes over the main pane for the class**, the way a slide step does, and stopping it
  returns every student to where they were following.
- **The picker leaves out the icecore tab.** `getDisplayMedia` takes
  `selfBrowserSurface: 'exclude'` in Chromium. Sharing the player into the player is a hall of
  mirrors, and a video of slides the class already has as slides is the worse copy of them.
- **The track is marked `contentHint = 'text'`**, so the encoder spends its bits on sharpness
  rather than frame rate. That is what makes an IDE's small type readable rather than smeared.
- **Shared audio is a Chromium feature**: a tab's sound in Chromium anywhere, the whole
  system's only on Windows. A video with sound shared from a Mac will be silent, and that is
  the browser's limit, not ours.

### Mute, and who may speak

- **Students join muted, with the camera off.** The browser asks for the microphone when they
  first unmute, never on joining. A permission prompt nobody asked for, mid-lesson, gets
  clicked away, and the microphone is then blocked for the site until they find the setting.
- **A raised hand is a live-channel message**, shown in the roster. It needs no media at all,
  so it works for the student whose call never connected, who is exactly the student most
  likely to need it.
- **An educator's mute is a request**, sent over the live channel and honoured by the student's
  own tab. Chime has no server-side mute. A tab that ignores the request is removed by deleting
  its attendee. If LiveKit is chosen, its server-side mute replaces the request.
- **Mute all is in the first phase.** It is the one control a teacher reaches for without
  thinking, and a call without it is one they will not trust.

### Loading

- **A dynamic import on joining**, so a student practising alone never downloads the SDK, for
  the same reason PGlite and Pyodide load only when an exercise needs them.
- **Noise suppression and background blur fetch models and wasm from an AWS CDN by default.**
  Both are staged onto our origin instead, like Pyodide, for the same class behind a network
  that blocks CDNs. `test/setup-checks.mjs` refuses a host named in `app/src`, but the SDK
  lives in `node_modules`, so that check will never see its default URLs: the staging has to
  be deliberate.
- **The media itself cannot come from our origin.** It is the one place this plan accepts a
  third-party host at runtime, and Phase 0 measures whether that class can reach it.

### Preview and the harness

- **`icecore dev --as admin` and `--as student` reach every state without a provider**: joined,
  muted, camera denied, no camera at all, the provider unreachable, the meeting gone, a hand
  raised. A refusal that cannot be reached locally is a message nobody reads before shipping.
  The stand-in draws tiles from `canvas.captureStream()`, so the layout is real with no call
  behind it.
- **The SDK is aliased to a throwing stub in `test/harness.mjs`**, like PGlite and Pyodide.
  `test/player.mjs` asserts on what a student sees: the band's sentence when the call fails,
  the floating tile, the hand in the roster.

## Student laptops

The player already runs PGlite and Pyodide in the page, and Pyodide's warm-up holds the main
thread for a second or two (CLAUDE.md, under `pycomplete.js`). Video decoding and audio playback
run off the main thread, so audio should survive that. The SDK's own control logic does not, and
a long enough freeze can look to it like a dead connection.

Phase 0 measures this rather than guessing: a Python exercise opened mid-call on the cheapest
laptop a student actually brings. If audio glitches or the SDK reconnects, moving Pyodide into
a worker, already named as "the real fix", becomes a prerequisite of this plan rather than an
improvement beside it.

## Networks

Reaching Teams is the institution's IT department's problem today, and its endpoints are on
every corporate allow-list already. Reaching Chime would be ours.

- A network that blocks UDP pushes media onto TURN over TLS on 443. The provider runs it, so it
  works, at some cost in latency and quality.
- A network that blocks the provider's hosts outright cannot be fixed from this side. The
  answer then is the fallback below, and a conversation with that network's IT.
- **The class whose network blocks CDNs is the test that matters**, which is why it is in
  Phase 0.

## Data protection

- **Nothing is recorded.** Recording is the one feature that would bring storage, a retention
  period, consent, and a new section in the Article 15 export ([ACCOUNT.md](ACCOUNT.md)).
  Without it a call leaves no personal data at rest, and the export, `forget()` and the
  account screen are unchanged.
- Media is encrypted in transit and processed by AWS, which already processes everything else
  here. The privacy notice should still say that live lessons carry audio and video through it.
- **Cameras are optional for students**, and the screen says so. Whether a class expects them
  on is the educator's policy, not the platform's.

## Fallback

For at least the first term a Teams meeting stays open beside every lesson. When the call cannot
connect, the band tells the student to use the backup call, and the educator posts its link in
chat, which works without media. Retiring it is Phase 4.

## Order I would build it

**Phase 0: a spike, and a go or no-go.** A throwaway page outside the player, joining a meeting
created by hand, tried:

1. from the class whose network blocks CDNs;
2. on the cheapest laptop a student brings, with Pyodide warming up in the same page;
3. in Safari, and on a phone;
4. for a full hour, to read the cost off the bill.

Nothing else is built until all four pass. If one fails on Chime, LiveKit gets the same four.

**Phase 1: voices and the educator's face.** The meeting on the `LIVE#` row, the media route,
the floating educator tile, joining muted, the microphone prompt on first unmute, a device
picker, mute all, raised hands, the failure band, and the preview states. This alone covers
what a lesson uses Teams for most of the time.

**Phase 2: the educator's screen share.** The takeover, the picker without the icecore tab,
the text hint.

**Phase 3: students' cameras** in the educator's panel, and a student's screen share only if
watching their session turns out not to be enough. Lowest priority, because it usually is.

**Phase 4: retire Teams**, once:

- a term of lessons has run with none that had to move to Teams for audio;
- the class behind the restricted network has had lessons on it;
- the bill per lesson matches the Phase 0 reading.

Sizing, roughly: Phase 0 is a day or two. Phase 1 is the bulk, a few weeks to something worth
trusting in a real lesson, and the live channel's history says the last stretch of that is the
long one. Phases 2 and 3 are a week or two each.

## Not in this plan

- **Recording**, for the reasons under Data protection.
- **Breakout rooms.** A second meeting per room, and a roster that moves people between them.
  Worth building only once somebody misses them.
- **A waiting room.** It exists to keep strangers out of a link. There is no link here, only a
  cohort, and a ticket already refuses anyone outside it.
- **Captions, transcription, phone dial-in**, and backgrounds beyond the SDK's blur.
- **A second attendance record.** The session summary already says who was here, from the live
  channel. Reading join and leave events from the provider as well would be one fact in two
  places.
- **Moving the live channel onto the SFU's data channel.** See "Why rented".

## Open questions for Keith

1. **Is any class hybrid?** Two open microphones in one room howl. If some students sit in the
   room with the educator, joining without audio has to be the obvious path for them, not a
   setting.
2. **Do you want to see students?** That decides whether Phase 3 matters at all.
3. **Which class is behind the restricted network**, and can Phase 0 borrow some of their time?
4. **Do students join from phones or tablets?** A phone can listen and speak; it cannot share a
   screen.

## To confirm before building

Recalled rather than checked when this was written:

- Chime's price per attendee-minute, and whether a screen share is billed as a second attendee.
- That Milan (eu-south-1) is a Chime media region, and which region the control API has to be
  called in. The control API is offered in fewer regions than the media, so the Lambda's Chime
  client may need a region of its own.
- That `CreateAttendee` with an existing external id hands back the existing attendee, which
  the one-tile-per-person rule leans on.
- How long Chime keeps an empty meeting before ending it.
- That noise suppression and background blur accept self-hosted asset paths.
