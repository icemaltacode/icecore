# Pending Stuff

## UX

- [ ] **XP is displayed and never recorded.** Every exercise carries `xp:` and the player shows
  it, but `progress.js` and the progress Lambda store only which exercises are solved -
  no total, no per-course sum. Either sum it from the solved set at read time, or stop
  showing a number nothing counts.

## Content

- [ ] **The Playground** — a sandbox course every student has, with an editor and datasets
      they choose to load. Designed in [`PLAYGROUND.md`](PLAYGROUND.md). **The SQL side is
      built and runs**; what is left is listed there under *Still to build* — the Python run
      path, the data browser, the publish-time check that resolves borrowings against the
      bucket (nothing checks them today), sizes in the picker, the AI assistant, and
      persistence.

## Admin
- [ ] Removing and promoting accounts. 