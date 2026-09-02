/* Where you are outside the player itself, in the URL.
 *
 * THE PLAYER ALREADY HAS URL STATE and this is not it: `?course=<id>` names which course is
 * open, is read on load, and is the thing worth sending somebody. This is the other kind -
 * where you are in a screen that is not the player at all - so it goes in the fragment,
 * which keeps it out of the URL a student might be handed and lets it be a path rather than
 * a fistful of query parameters. `#/admin/people/<sub>` says what it is; `?admin=people&
 * person=<sub>` says the same thing worse, and gets worse again at the next level down.
 *
 * ONE DEFINITION, because the alternative is each screen inventing its own spelling of the
 * same location and the two disagreeing about what Back means.
 *
 * Nothing here knows who is signed in. A route is a request, not a permission: App.vue
 * decides whether to honour it, so that a student who types the URL is turned away in one
 * place rather than in every component that reads a section name.
 *
 * Not vue-router. Five routes and no nesting, guards, transitions or lazy chunks - the
 * dependency would be bought for `location.hash`, and the app has managed without one.
 */
import { ref } from 'vue';

/* Three areas, and a route says which.
 *
 *   #/admin, #/admin/<section>, #/admin/<section>/<id>
 *   #/watch/<sub>                 the player, rendered as that student sees it
 *   #/account                     the student's own account
 *
 * Watching is a URL rather than a flag for the reason the rest of this file exists: it is
 * somewhere you can BE, a reload should land you back in it rather than quietly back in
 * your own session, and Back is the natural way out. It being addressable is also half of
 * what remote control will need - a session somebody else can point at.
 *
 * THE AREA SAYS NOTHING ABOUT WHO MAY BE THERE. Two of these are for admins and the third
 * is for everybody, and that difference lives in App.vue with the rest of the honouring -
 * a route is a request. Putting it here would mean this file needed to know about the
 * session, and every screen would then have two places to ask the same question. */
function parse() {
  const hash = location.hash || '';
  if (/^#\/account\/?$/.test(hash)) return { area: 'account', section: null, id: null };
  const admin = /^#\/admin(?:\/([a-z-]+))?(?:\/(.+))?$/.exec(hash);
  if (admin) {
    return {
      area: 'admin',
      section: admin[1] || 'people',
      id: admin[2] ? decodeURIComponent(admin[2]) : null,
    };
  }
  const watch = /^#\/watch\/(.+)$/.exec(hash);
  if (watch) return { area: 'watch', section: null, id: decodeURIComponent(watch[1]) };
  return null;
}

/** The current location, or null when neither area is open. */
export const route = ref(parse());

/* Back and Forward, and somebody editing the URL by hand. Our own navigations go through
 * pushState - which deliberately does NOT fire this - and call `sync` themselves, so this
 * listener stays about the things we did not do. */
const sync = () => { route.value = parse(); };
addEventListener('hashchange', sync);

/* Every navigation is a push, so Back always means one step back: out of a person and into
 * the list, out of the list and off the screen. `replace` is for the one case that is not a
 * step - correcting a URL nobody asked for, like a student's `#/admin`. */
function navigate(url, replace) {
  history[replace ? 'replaceState' : 'pushState']({}, '', url);
  sync();
}

/** Open the admin area, at a section and optionally one thing inside it. */
export function go(section = 'people', id = null) {
  navigate('#/admin/' + section + (id ? '/' + encodeURIComponent(id) : ''), false);
}

/** Open your own account. No section: it is one page, and five headings are not five URLs
 *  - nothing links to a heading and a reload onto one would be indistinguishable from a
 *  reload onto the top of the page. */
export function account() {
  navigate('#/account', false);
}

/** Open a student's session, read-only. */
export function watch(sub) {
  navigate('#/watch/' + encodeURIComponent(sub), false);
}

/** Leave it. Pushes a hash-less URL rather than clearing the hash, which would leave a
 *  bare `#` behind and make Back a no-op. */
export function leave(replace = false) {
  if (!route.value) return;
  navigate(location.pathname + location.search, replace);
}
