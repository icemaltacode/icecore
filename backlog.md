# Pending Stuff

## UX

- [ ] **XP is displayed and never recorded.** Every exercise carries `xp:` and the player shows
  it, but `progress.js` and the progress Lambda store only which exercises are solved -
  no total, no per-course sum. Either sum it from the solved set at read time, or stop
  showing a number nothing counts.

## Admin
- [ ] Removing and promoting accounts. 

# Custom Courses

Right now, there are two courses on this platform, ICExDataCamp Data Analyst Associate and ICExDataCamp Data Analyst Pro.

I would also like to use this platform for some of our existing courses, starting with some custom training material I've created for two corporate clients, that we have coming up.

## ONEY
The first client is ONEY (insurance). The first part of their course is our normal Python Foundations course. The second part is 3 modules on data analysis with Python. The latter modules are heavily based on the Data Analyst Pro course we already have, but customised with custom slides, and custom data sources for the practical exercises. Also with the MCQs etc removed. 

The material for the first part of the course - Python Programming Foundations - can be found here: /home/keith/gdrive/Course Material/Python Programming Foundations/Material - v1.1. The material for the second part, which is custom for them, is here: /home/keith/gdrive/Course Material/Python Programming Foundations/Custom Training/Python ONEY.

I've currently prepared their practical exercises as a git repo. You can find the local repo here: /home/keith/LocalCode/icemaltacode/ppf_oney

I would like help migrating this course to icecore. It would be two separate courses - one for the foundations course, and the custom part for ONEY. Note that the practicals are heavily based on existing practicals from the Data Analyst Pro course, but slightly tweaked and with different data sources (which are in the repo for each module). 

## FIAU
The second client is FIAU (Financial Intelligence and Analysis Unit [of Malta]). They have a custom Python course. Many of the modules are based on the foundations course, whilst others are custom for them and also based on Data Analysis Pro. Their course material is here: /home/keith/gdrive/Course Material/Python Programming Foundations/Custom Training/Python FIAU. Their practicals, are here: /home/keith/LocalCode/icemaltacode/ppf_fiau. Note that there are only practicals in the repo for Modules 4, 5, 7, 8, 9, since the other modules use the normal in-class exercises as the foundations course. 