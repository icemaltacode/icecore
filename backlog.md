# Deferred

Steps 8 and 9 of [ADMIN.md](ADMIN.md). Both are waiting on **data rather than on work** —
neither is blocked, and building either today would produce a worse answer than building it
in a month.

- [ ] **The platform page** — publication state, hint spend overall / by cohort / by course
  / by student, and the account ceiling said out loud before it is reached rather than
  after. The publication half could be built now. The spend half would draw a day of data:
  the ledger began recording on 2026-09-02, so a chart today is three points and a shape
  nobody can read. Waiting costs nothing, because the rows accumulate whether or not
  anything reads them — which is exactly why they were written before any screen for them
  existed.

- [ ] **Decide whether attempts need recording.** Nothing records a failed attempt, so
  "hard exercise" and "exercise nobody has reached yet" are the same shape in the table. The
  stall view is the instrument for deciding: if solve-drop plus hint volume is enough signal
  on real cohorts, this is a write on every Check press that never has to be added — one on
  the student's critical path, and impossible to remove once a screen depends on it. Decide
  it against the screen rather than in advance. If it is added, add a counter on the
  exercise rather than an event per press: the question is "how many tries before this class
  got it", not an audit log.

- [ ] **A cohort member who is not enrolled on the course being delivered.** Reachable by
  construction: a cohort is a group of *people*, deliberately not a group of enrolments, so
  nothing stops an intake taking one course together while one of them is not on it. Three
  answers, and the live delivery screens do not settle which — enrol them on the spot,
  refuse the invitation, or let them follow read-only for the hour. Deferred rather than
  decided because it costs nothing to defer: every path leaves the session itself unchanged
  and only decides what one person sees. See [LIVE.md](LIVE.md).

- [ ] **End a live session from the cohort screen.** Today the only End session button is on
  the live screen itself, which is fine until that screen is the thing that is broken - and
  then the session is unendable and holds its cohort's lock until the `ttl` a day later. The
  takeover rule in the Lambda already allows any admin to end a session with nobody connected,
  so the button has somewhere to go; what is missing is the button. Found the hard way, while
  a bug on the live screen made every attempt to end a lesson require waiting it out.

# Live Delivery

Ok, so I had a think about the remote control feature, and I think it makes sense to implement it as a new, 'Live Delivery' feature. So here's how it works:

Keith is an Educator.
1. Keith logs into icecore. He goes to the admin area, and clicks 'Cohorts'.
2. Next to each cohort, there's a 'Live' button. Keith clicks it. 
3. Icecore checks which courses are common between all the students that are in the cohort. If there's more than one course, it asks Keith to select which course he wants to deliver live. If there's only one course, it just selects that one.
4. Icecore displays the live delivery screen. In this screen:
4.1. Keith sees a list of all the students in the cohort. They are grouped as 'online' and 'offline'. 
4.2. In the main area, Keith sees the course content for the selected course (the whole thing... with the sidebar, the slides, exercises, content browser, etc). 
4.3. The content starts from where the last live delivery left off. If there is none, it starts from the beginning of the course.
4.4. As Keith navigates the course, the students see the same content. If Keith goes to an exercise, the students see the exercise. If Keith goes to a slide, the students see the slide. If Keith goes to a content browser, the students see the content browser.
4.6. When Keith is on an exercise (i.e. MCQ, coding activity, etc), he can see the students' progress on that exercise. He can see which students have completed it, which students are still working on it, and which students have not started it yet. 
4.7. When Keith is on an exercise, he can also see the students' answers to that exercise. He can see which students have answered correctly, which students have answered incorrectly, and which students have not answered yet.
4.8. There is also an option to pop-out a chat window, so that Keith can chat with the students in the cohort. The chat window can also be undocked. 
5. Next to each student in the list, Keith also sees a 'Remote control' button. If he clicks it, he can see the student's screen, and he can control the student's screen. He can navigate the course on behalf of the student, and he can also see the student's answers to exercises. This should open in a new tab.

Alice is a student in Keith's cohort.
1. Alice logs into icecore. The fact that she's just logged in means that she is online. After 15 minutes of inactivity, she is considered idle. After 30 minutes of inactivity, she is considered offline.
2. When Keith starts a live delivery session, Alice sees a notification that says "Keith is delivering live. Click here to join." If she clicks the notification, she is taken to the live delivery screen. The notification is persistent, and cannot be dismissed. However, it still allows Alice to ignore it and carry on with any work she was doing. 
3. When Alice is in the live delivery screen, she sees the course content that Keith is delivering. She can navigate the course on her own, but if she does, she will see a notification that says "You are no longer following Keith's live delivery." If she clicks the notification, she is taken back to where Keith is in the course.
4. Alice has options to view the participant list, and to view the chat window. These are both collapsed for Alice by default. She cannot interact with the participants, but she can chat.

This is a major feature, and will require a lot of work. It will also require a lot of testing, as it is a new feature that has not been implemented before. In support of this, some things need to be changed in the cohort screen:
1. The Rename, Archive and Delete buttons need to be moved to a dropdown menu, as they are not used very often.
2. The 'Live' button needs to be added next to each cohort. It should be a primary button, and should be the first button in the row. It should be disabled if there are no students in the cohort, or if there are no courses that are common between all the students in the cohort. It should also be disabled if there is already a live delivery session in progress for that cohort. If it is disabled, it should have a tooltip that explains why it is disabled.
3. The description in the current cohort screen needs to use the width of the window. Currently, it is wrapped for some reason. 

You will start by generating at least 5 different mock screens for the live delivery feature. These mock screens should include all of the features described above, and should be designed to be user-friendly and intuitive.
