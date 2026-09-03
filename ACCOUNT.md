# The account screen — plan

There is nowhere in the player for a student to be a *person*. The top bar shows a name it
derived and a theme picker; everything else the platform knows about them is either
scattered across screens that are about a course, or visible only to an admin, or not
visible at all. This plan gives them one place.

It is the mirror of [ADMIN.md](ADMIN.md) and inherits its boundary from the other side: the
admin area may read content and never write it, and the account screen may read the
student's own rows and never reach past them.

Status: **steps 1 to 6 are built.** Password recovery, the route and shell, Security, the
account function behind the You section, Learning, and the danger zone. What is left is the
Article 15 response and the avatar - the two that need the most writing and the most
infrastructure respectively, which is why they are last. Recovery came first because it was
not a feature at all but a live lockout.

## Decisions taken

| | |
|---|---|
| **Recovery** | Forgot-password lives on the **sign-in** screen, not here — the account screen is behind the thing they have lost |
| **Identity** | Name and avatar are theirs to change. Email is not, and the pool already refuses it |
| **Avatar** | Normalised in the browser to a square WebP, uploaded to a **content-addressed** key. The bytes uploaded are pixels we drew, never the file they chose |
| **Enrolment** | Read-only, always. A student removing a course they were put on is a support ticket wearing a button |
| **Progress** | Resettable, per course, behind two gates in a danger zone |
| **Data** | The export is a **full Article 15 response** — the copy and the supplementary information — and self-serve. Erasure is a request, because it is also an enrolment decision |
| **Subject** | The account screen is always `me()`. It is unreachable while view-as is running |

## The gap that comes first, and is not a feature

**There is no password recovery anywhere in the platform.**

The pool is configured for it — `accountRecovery: EMAIL_ONLY`
([icecore-stack.js:195](infra/lib/icecore-stack.js#L195)) — and nothing calls it. There is
no `forgotPassword` in [auth.js](app/src/auth.js) and no link on
[SignIn.vue](app/src/components/SignIn.vue). The admin side cannot cover for it either:
`resendInvite` uses `MessageAction: 'RESEND'`, which Cognito refuses for a user who has
already chosen a password ([admin/index.mjs:303](infra/lambda/admin/index.mjs#L303)) — the
right refusal, since there is no invitation left to reissue.

So a student who forgets their password after first sign-in cannot get back in, and you
cannot let them. That is a lockout with no handle on either side, and it is the one item
here that is a bug rather than an addition.

### The flow

Two stages on the sign-in card, in the shape `stage` already has — it is
`'signin' | 'newpassword'` today and becomes `'signin' | 'newpassword' | 'forgot' | 'reset'`.

1. **forgot** — an email field and a button. `CognitoUser.forgotPassword()`.
2. **reset** — the six-digit code and a new password. `confirmPassword(code, password)`.

Both go through `auth.js`, never straight to `amazon-cognito-identity-js` from a component:
the module is the one place that knows whether a pool exists at all, and preview has to be
able to stand in for it.

### Three things it has to get right

- **Enumeration is already handled, and the copy still has to match.**
  `preventUserExistenceErrors: true` is set on the web client
  ([icecore-stack.js:311](infra/lib/icecore-stack.js#L311)), so Cognito answers an unknown
  address with a plausible delivery result rather than `UserNotFoundException`. The screen
  must say **"if that address has an account, a code is on its way"** — a message that
  promises a code unconditionally will be read as a promise, and a student who mistyped
  their address will sit waiting for mail that was never sent to anyone.

- **An unopened invitation cannot be recovered, and that is the confusing case.** A user
  still in `FORCE_CHANGE_PASSWORD` — invited, never signed in — gets
  `NotAuthorizedException` from `forgotPassword`, because there is no password to reset.
  This is precisely the student who is most likely to try it: their temporary password
  expired after seven days and the site looks broken. The raw Cognito string tells them
  nothing. It has to be caught by name in `friendly()` and turned into *"Your invitation is
  still unopened — ask your tutor to send it again."* which points at
  [`resendInvite`](infra/lambda/admin/index.mjs#L311), the thing that actually fixes it.

- **The recovery mail is already branded, for free.** `UserPoolEmail.withSES` is configured
  at the *pool* level, not per message type, so the code arrives from
  `noreply@icecampus.com` with DKIM exactly as the invitation does. Nothing to add — worth
  writing down only because it is the kind of thing someone later spends an afternoon
  building twice.

### And preview has to reach it

`icecore dev --as signin` exists so the sign-in and choose-a-password screens can be looked
at with no pool behind them, and `password === 'temp'` is how the first-login challenge is
reached locally. Both new stages need the same treatment, and so does the
still-unopened-invitation refusal — by the rule the admin panel already follows, *a message
that cannot be reached locally is a message nobody reads before shipping.*

## Where the screen lives

- **`#/account`**, parsed by [route.js](app/src/route.js) beside `#/admin/...` and
  `#/watch/...`. It is a fragment for the same reason those are: `?course=` names which
  content is open and is the thing worth sending somebody, and this is not.
- **The way in is the person in the top bar.** `.who` is inert markup today. It becomes a
  menu button, using the click-away pattern the theme picker beside it already has — one
  behaviour in that corner rather than two.
- **It is `me()`, never the subject.** [subject.js](app/src/subject.js) decides *whose
  progress* the player draws; the account screen is about whose account it is, which is
  always the person signed in. While `watching(sub)` is running the entry is hidden, because
  an admin editing a student's name from inside their session is the boundary breaking from
  a direction nobody would think to guard.

## The sections

```
┌───────────────────────────────────────────────────────────┐
│  Your account                                             │
├───────────────────────────────────────────────────────────┤
│  You          avatar · name · email (fixed)               │
│  Security     change password · sign out everywhere       │
│  Learning     XP · hints left today · courses · cohort    │
│  Your data    what we hold · download it · how to be erased│
│  ─────────────────────────────────────────────────────    │
│  Danger zone  reset my progress on a course               │
└───────────────────────────────────────────────────────────┘
```

Five, and the order is deliberate: what a student came here to change, then what protects
it, then what they earned, then what we hold, then what they can destroy. The danger zone
is last and separated, because everything above it is safe.

## You

### Name

The highest-value writable field on the screen, and the reason is the CSV import: a class
list with no name column defaults every student to the local part of their email
([`displayName`](infra/lambda/admin/index.mjs#L87)), so they read `jane.borg` in the corner
of every page and cannot fix it. The pool declares `fullname` **required and mutable**
([icecore-stack.js:192](infra/lib/icecore-stack.js#L192)), so this is a supported write.

**The one real constraint: the name is cached in two other places.** `ENROL#` and `COHORT#`
rows each carry a copy, because the roster and cohort views need names without a Cognito
call per person, and `PUT /api/admin/users` is what currently keeps them in step. A
self-serve rename that writes Cognito directly diverges them silently — the student sees
their new name, and every list you look at shows the old one.

So the rename goes through `PUT /api/account`, which does what the admin PUT does: write
the attribute, then rewrite the cached copies. Not because a Lambda is needed to change an
attribute — the signed-in client could do it alone — but because the second half is the
whole job.

### Avatar

An image the student uploads, replacing the initials in the top bar. It is the one item
here that needs infrastructure, so the design matters more than the feature does.

**Normalise in the browser, not on the server.** The file is drawn to a canvas, cropped
square, scaled to 256×256 and re-encoded before anything leaves the machine. Three things
fall out of that, and the third is the one that decides it:

1. The size limit is enforced by construction rather than by a rule someone has to check.
2. No image-processing layer, no `sharp`, no Lambda that decodes untrusted bytes.
3. **The bytes uploaded are pixels the browser drew, not the file that was chosen.**
   Re-encoding discards EXIF — which on a phone photo carries GPS coordinates — and a file
   crafted to exploit a decoder does not survive being rasterised and re-encoded. We never
   store a student's original file at all.

**Ask for WebP and believe the answer.** `canvas.toBlob(cb, 'image/webp')` falls back to
PNG *silently* where WebP encoding is unsupported. Take the extension from `blob.type`, not
from what was requested, or a PNG ends up at a `.webp` key served with the wrong
content-type.

**The key is content-addressed: `avatars/<sub>/<hash>.webp`.** A stable key would sit in
CloudFront's cache and a student would replace their picture and go on seeing the old one
for a day. Versioning by hash makes every avatar URL immutable and infinitely cacheable, and
replacing one is a new key plus a delete of the old — no invalidation, which is slow and
costs money per path.

**It goes behind the key group.** `/avatars/*` joins `/content/*` and `/slides/*` in
`additionalBehaviors` with `trustedKeyGroups`. A face is not brand assets: `brand/` is
public because the recipient of an invitation is not signed in, and nobody who is not signed
in has any business fetching these. The session cookie's policy is already `${origin}/*`
([session/index.mjs](infra/lambda/session/index.mjs)), so it covers the new prefix without a
change.

**Uploading is a presigned POST, not bytes through the API.** `POST /api/account/avatar`
returns a policy scoped to that student's own prefix, with a `content-length-range` and a
content-type condition — presigned POST supports both, presigned PUT supports neither. The
image never passes through API Gateway, whose payload limit would meet base64 inflation at
exactly the wrong size.

**Two prefixes that must not collide with existing rules.** `avatars/` is safe from
`just deploy` by construction, because that sync is an *allowlist* — `index.html`,
`auth.json`, `assets/*` — rather than the exclude list that once deleted `brand/`. And if
the avatar's key is ever recorded on a DynamoDB row, the prefix has to sort outside
`COHORT#` … `ENROL$`, which is read as one range by the admin listing. `AVATAR#` is before
it and safe; anything beginning D or E arrives in the admin panel as an enrolment nobody
wrote.

**The top bar learns about it from the session, not from a second call.** `POST /api/session`
already runs once at sign-in and already returns `courses`, `admin` and `expires`; it gains
`avatar`. Everything else on this screen can be fetched when the screen opens, but the
avatar is needed on the first paint of every page, and a boot-time round trip for a picture
is a round trip on the critical path.

**Initials remain the fallback, and there is no generated one.** Most students will never
upload a picture, and the `.avatar` circle already works and already survives a single
initial. An identicon would be warmer and would also be a second thing to design, to explain
and to keep looking deliberate at 26px - and it answers a question nobody asked. The `<img>`
falls back to the initials on error as well as on absence, so a deleted object degrades to
something that looks intentional rather than to a broken-image glyph.

### Email

Shown, never editable — and this is not a policy decision to be revisited later. The pool
declares `email: { required: true, mutable: false }`
([icecore-stack.js:191](infra/lib/icecore-stack.js#L191)) and **a pool's schema cannot be
altered after creation**. Cognito will refuse the write. It is also the sign-in alias, so
changing it is an identity change and not a preference.

Say why on the screen rather than showing a greyed-out field: *"This is how you sign in. Ask
your tutor if it needs to change."*

## Security

- **Change password** — `CognitoUser.changePassword(old, new)`. The signed-in half of the
  gap the sign-in screen fixes.
- **Sign out everywhere** — `globalSignOut()`. Modest but real: these are shared lab
  machines, and `refreshTokenValidity` is **30 days**
  ([icecore-stack.js:310](infra/lib/icecore-stack.js#L310)), so a session left open on a
  college PC outlives the module. Worth pairing with the password change, because changing a
  password does *not* invalidate refresh tokens already issued — a student who changes it
  because someone else got in has not actually locked them out until this is pressed.

## Learning

All read-only. Everything here already exists and is simply not shown in one place.

- **XP, as a lifetime total and per course.** Today's is in the top bar and per-course
  totals are on the grid cards; nothing shows what they have earned altogether. Every number
  is already on the `PROG#` rows, with `xp` and `at` on each.
- **Hints left today.** `DAILY_LIMIT` is 40 and `remaining` already rides on every hint
  response ([hint/index.mjs:181](infra/lambda/hint/index.mjs#L181)) — but a student only
  discovers the limit exists by hitting a 429 mid-exercise. Showing "31 of 40 left today"
  turns a wall into a budget, and costs nothing.
- **Courses and cohort.** *Read-only, and firmly.* "Am I on the right class list?" is a real
  question a student cannot currently answer, and it is the one they ask a tutor. But
  enrolment is set by an admin: a student who unenrols themselves loses a course they were
  put on and generates a support ticket that looks, from the admin panel, exactly like an
  administrative mistake. There is no button. There is a line saying who to ask.
- **Theme** may be mirrored here. It already works and lives in the top bar, and it is
  `localStorage` under `ice-theme` — per device, which is the honest behaviour when a lab
  machine and a laptop want different things. Do not sync it server-side; that buys a row
  and a way for two devices to disagree, to solve a problem nobody has.

## Your data

Malta is in the EU, so this is an obligation rather than a nicety. Two rights, and they are
not the same shape: **access** is answered by the platform, in full and on demand, and
**erasure** is answered by a person, because it is also an enrolment decision. The machinery
for the second is mostly built already —
[`forget()`](infra/lambda/admin/index.mjs#L349) deletes everything under `USER#<sub>` — and
the first is the part that needs writing.

### The access request, in full

`GET /api/account/export` is a **complete Article 15 response**, not a convenience download.
That is a higher bar than a data dump and it is worth being precise about, because the
difference is mostly things that are easy to leave out.

Article 15 gives a person two things: a **copy of their personal data**, and **supplementary
information about the processing of it**. A file with only the first half is the common way
to get this wrong — it looks generous and answers about a third of the article.

**Part one: the copy.** Every row in the student's own partition, plus their Cognito
attributes and group membership. Named individually, because "everything under `USER#<sub>`"
is a query, not a promise, and the next prefix somebody adds has to be a decision here rather
than an accident:

| | what it is |
|---|---|
| Cognito attributes | sub, email, name, verification and enabled state, created and last-modified |
| `ENROL#<course>` | which courses they are on |
| `COHORT#<id>` | which cohorts they are in |
| `PROG#<course>#<exercise>` | every solve: the XP, when it was earned, and **the code they submitted** |
| `LAST#<course>` | where they left off |
| `SPEND#hint#<day>#<course>` | every hint they asked for: the model, the token counts, the day |
| `RATE#hint#<day>` | the daily hint counter, where it still exists |
| the avatar | the object itself, if they uploaded one |

The `PROG#` code is the bulky part and also the part that makes this genuinely theirs — it is
the only route by which a student leaves here with the work they did.

**`SPEND#hint#` rows are included.** They are personal data by any reading: keyed on the
student, recording something they did. My instinct was to leave them out — a file that
quantifies how much help somebody took reads to them as a score even where nothing scores it
— but that is a presentation problem and Article 15 is not optional. So it is solved as a
presentation problem: the screen and the file both call them **hints you asked for**, listed
by day, not "what you cost". The token counts are in the file because they are in the row;
they are not what the screen leads with.

**`RATE#hint#<day>` may simply not be there,** and that is correct rather than a gap. It
carries a three-day TTL ([hint/index.mjs:109](infra/lambda/hint/index.mjs#L109)) because it
is a limit rather than history — the retention statement below says so, which is the honest
way to explain an absence.

**`HINTS#<course>` is excluded, and it is the one exclusion that needs no apology.** It
counts hints per *exercise across everyone*, is not keyed on any person, and is not in the
student's partition at all. It is not their personal data, so it is not theirs to receive.

**Part two: the supplementary information.** Article 15(1) asks for eight things, and all
eight are stable facts about this platform rather than about the person - purposes,
categories, recipients, retention, their rights to rectification and erasure and restriction
and objection, the right to complain to a supervisory authority (the IDPC, in Malta), where
the data came from, and whether anything is decided about them automatically.

Two of those have real answers here rather than boilerplate, and both should be said plainly:

- **Recipients.** Hint text goes to OpenAI. A student's *code* is sent with it, because that
  is what a hint is about. That is a third-country transfer of their personal data and it is
  the single most surprising item in this section — so it is the one that most needs saying.
- **Automated decision-making.** None with legal or similarly significant effects. Grading is
  automated and formative: it marks an exercise, and nothing follows from it. Saying so is
  better than silence, because silence is what a reader assumes the worst about.

**It is one definition, emitted once and rendered twice.** The Lambda puts this object in the
export, and the account screen renders that same object as the page's own privacy summary.
Written as prose in a component *and* as JSON in a function, the two drift, and the drift is
between what we tell someone and what we send them.

**Format is JSON**, which also satisfies Article 20's "structured, commonly used,
machine-readable" without a second export existing.

### What is deliberately not in the file

Named here so that leaving it out is a position rather than an omission somebody discovers.

**CloudWatch logs.** The session Lambda logs a line naming the student's `sub` on every
sign-in ([session/index.mjs](infra/lambda/session/index.mjs)); API Gateway and every function
log request metadata. A `sub` is a pseudonymous identifier tied to an identifiable person, so
this is personal data. It is **described in the retention statement rather than copied into
the file** — the logs are operational, they expire after one month
([icecore-stack.js:337](infra/lib/icecore-stack.js#L337)), and pulling a month of log lines
per request would be slow, expensive and less legible than the sentence that explains them.
Article 15's copy obligation is met by the partition; this is met by disclosure. If somebody
specifically asks for their log lines, that is the contact route, answered by a person.

### Erasure

**A request, not a button**, and the screen has to say so plainly rather than omit it —
Article 17 is a right, and a screen that answers Article 15 in full and then stays silent
about erasure has built the harder half and skipped the one people actually ask for.

The reason it is not self-serve is that deletion is also an enrolment decision: a student on
a paid course who clears their account destroys the record of what they were entitled to, and
`forget()` deletes the Cognito user first, so there is nobody left to ask what happened.

Two shapes, and I would ship the first:

1. **A named contact route.** The screen says who to write to and what happens. Zero
   infrastructure, honest, and it is what an admin has to action either way.
2. **A request row later** — `REQ#delete` on the student's own partition, surfaced in the
   admin People list. `REQ#` sorts safely outside `COHORT#` … `ENROL$`. Worth doing *only
   with the view*: a request that lands in a table nobody looks at is worse than an email,
   because it looks like it worked.

   **When it is built, an unanswered request nudges the admin after three days.** Long
   enough that a request raised on a Friday is not an alert nobody can act on, short enough
   to leave a month inside the one GDPR allows for a response — the deadline is the thing
   being protected, so the nudge has to land while there is still room to do the work. It
   is a property of the request, not of the person: the nudge is that a request is
   outstanding, not that a particular student is waiting.

## Danger zone

Visually separated, last on the page, and holding exactly one thing.

### Reset my progress on a course

**Per course, not a single global reset.** "Start Data Analyst SQL again" is a real
intention; "erase everything I have ever done here" is not one anybody has, and offering it
as one button makes the smaller act feel like the larger one.

**Two gates, in this order:**

1. **"Are you sure?"** — a confirmation naming the course, how many exercises are solved,
   and how much XP goes with them. Numbers, not adjectives: "This clears 47 solved exercises
   and 2,350 XP on Data Analyst SQL" is a different decision from "this cannot be undone."
2. **Type the course title exactly** to enable the button. Not the word `DELETE` — a generic
   token is typed by muscle memory and confirms only that a human is present, where the
   title confirms **which course**. The failure this guards against is not an accidental
   click; it is resetting the wrong course, and only the second gate can catch that.

**What it deletes:**

| | |
|---|---|
| `PROG#<course>#*` | every solve, its XP, and the submitted code |
| `LAST#<course>` | the place marker |
| the local record | `ice-platform-progress:<course>`, `ice-platform-place:<course>`, `ice-platform-code:<course>` |

**What it does not touch, and why:**

- `ENROL#<course>` — resetting progress is not leaving the course.
- `COHORT#` — a cohort is a group of people, and this is not about who they are.
- `SPEND#hint#` — that is a financial record, and history is not the student's to revise.
- `HINTS#<course>` — the per-exercise counter is **not about a student**. It is the
  difficulty signal the platform otherwise lacks entirely, which is exactly why it is the one
  row `forget()` does not delete either.

**The reset is two-sided, and forgetting the second side makes it look broken.**
`progress.js` falls back to the local record whenever a call fails, and `preview.js` writes
the same keys — so clearing DynamoDB alone leaves a browser that re-asserts the progress
that was just deleted the next time anything goes offline. [progress-store.js](app/src/progress-store.js)
is the one definition of that record's shape and is where the clearing belongs.

**One consequence to write down before somebody reports it as a bug.** `at` is written once,
with `if_not_exists`, so re-solving old work does not move the earn into today — that is what
makes the daily counter derivable from the rows rather than kept as a second total. A reset
deletes those rows, so re-solving afterwards writes a **fresh** `at`, and work originally
done in March, reset and redone today, counts as today's XP. That is defensible — they did
genuinely do it again — but it is surprising, and it means a reset can make today's number
jump. It is also why the confirmation quotes the XP figure: the student should know that
number is leaving before it comes back.

**What is not in the danger zone:** unenrolling (not offered at all) and deleting the
account (a request, above). A danger zone that holds one irreversible act the student
actually wants is a useful warning; one that holds three becomes a place they learn to click
through.

## The boundary, from this side

[ADMIN.md](ADMIN.md) says the admin area may read content and must never write it. The
account screen has the matching rule and it is easier to break, because every violation looks
like a convenience:

**A student may change facts about themselves and never facts about their course.** Name and
avatar are theirs. Enrolment, cohort, XP amounts, and what an exercise is worth are not —
those are set by an admin or by the course repo, and the moment this screen can adjust one of
them it has become a second, worse admin panel with the student holding it.

The one exception is deliberate and bounded: resetting progress destroys their own record of
a course without changing the course or their relationship to it.

## Rules that carry over

- **`preview.js` stubs all of it, including every refusal.** The immutable email, the
  unopened-invitation message, the reset confirmation. `icecore dev --as student` is the only
  way to look at this screen without a pool behind it.
- **A name is always set.** `displayName` defaults it to the email's local part precisely so
  `TopBar`'s `name || email.split('@')[0]` fallback never runs. Anything written here keeps
  that true — an empty name is not an allowed save.
- **One Lambda, told apart by path**, as the admin function already is. `/api/account`,
  `/api/account/avatar`, `/api/account/export`, `/api/account/progress`.
- **New sort-key prefixes sort outside `COHORT#` … `ENROL$`.** The admin listing reads that
  range as one query.

## Order I would build it

1. ~~**Forgot password**, on the sign-in screen, with the unopened-invitation message. It is a
   live lockout and it is independent of everything below.~~ **Done.**
2. ~~**The route, the top-bar menu, and the shell** — `#/account`, five empty sections.~~
   **Done.** The way in is the person in the top bar, which was inert markup and is now a
   menu; Sign out moved into it. Finding that the theme dropdown beside it had never been
   styled at all was a side effect.
3. ~~**Change password, and sign out everywhere.**~~ **Done**, with no new infrastructure -
   both are `amazon-cognito-identity-js` calls through `auth.js`.
4. ~~**The account Lambda and `GET /api/account`**, plus the name rename with its cached-copy
   rewrite.~~ **Done.** A separate function from the admin one, for blast radius rather than
   for code - see [The boundary](#the-boundary-from-this-side).
5. ~~**Learning** — XP, hints, courses, cohort.~~ **Done.** The course list is the union of
   enrolment and progress, which is what makes it right for an admin and for somebody
   unenrolled since.
6. ~~**The danger zone.** Reset needs step 4's counts to write an honest confirmation.~~
   **Done**, and it needed a route of its own: `DELETE /api/account/progress?course=`.
7. ~~**The access request.** Not one query and one download any more: the copy is one query,
   and the supplementary statement is prose that has to be written once and then rendered in
   two places. Budget for the writing rather than the code — the recipients line, which says
   that a hint sends a student's code to OpenAI, is the part that needs to be *right* rather
   than merely present.~~ **Done**, as `GET /api/account/export`. The budget was right: the
   prose was the work, and it lives in `ABOUT` so that the screen and the file are two
   renderings of one statement rather than two statements.
8. ~~**The avatar.** Last, and deliberately: it is the only item that needs a CloudFront
   behaviour, a bucket prefix, a presigned POST and a change to the session response, and
   every other thing on the screen is useful without it.~~ **Done**, and *not* with a
   presigned POST - the bytes go through the API. See the long note in the account function:
   the argument for a presigned upload was API Gateway's payload limit meeting base64
   inflation, and cropping to a small square on the client removes the premise.

**All eight are built.** What is left of this plan is nothing; the file is kept as the record
of why each part is shaped the way it is.

## Settled

The three questions this plan opened with, answered. Recorded rather than deleted, because
each rules something out and the argument for the thing ruled out does not get weaker with
time.

- **No identicons.** Initials are the fallback and the only one. See
  [Avatar](#avatar).
- **The export carries the `SPEND#hint#` rows and not the aggregate `HINTS#` counter.**
  Reversed after it was first settled the other way: leaving out data somebody has a right to
  because of how it might read is a presentation decision overruling a legal one, and the
  presentation problem has its own fix. So the export is a full Article 15 response, and the
  aggregate counter stays out because it is not personal data at all. See
  [The access request, in full](#the-access-request-in-full).
- **A deletion request nudges after three days.** Applies when the request row is built,
  which is only worth building with the view that shows it. See [Erasure](#erasure).
