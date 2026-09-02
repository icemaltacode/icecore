/* Where you are in the admin area, in the URL.
 *
 * THE PLAYER ALREADY HAS URL STATE and this is not it: `?course=<id>` names which course is
 * open, is read on load, and is the thing worth sending somebody. This is the other kind -
 * where you are inside a screen only admins can reach - so it goes in the fragment, which
 * keeps it out of the URL a student might be handed and lets it be a path rather than a
 * fistful of query parameters. `#/admin/people/<sub>` says what it is; `?admin=people&
 * person=<sub>` says the same thing worse, and gets worse again at the next level down.
 *
 * ONE DEFINITION, because the alternative is each screen inventing its own spelling of the
 * same location and the two disagreeing about what Back means.
 *
 * Nothing here knows who is signed in. A route is a request, not a permission: App.vue
 * decides whether to honour it, so that a student who types the URL is turned away in one
 * place rather than in every component that reads a section name.
 *
 * Not vue-router. Four routes and no nesting, guards, transitions or lazy chunks - the
 * dependency would be bought for `location.hash`, and the app has managed without one.
 */
import { ref } from 'vue';

/** `#/admin`, `#/admin/<section>`, `#/admin/<section>/<id>`, or null for anywhere else. */
function parse() {
  const m = /^#\/admin(?:\/([a-z-]+))?(?:\/(.+))?$/.exec(location.hash || '');
  if (!m) return null;
  return { section: m[1] || 'people', id: m[2] ? decodeURIComponent(m[2]) : null };
}

/** The current admin location, or null when the admin area is not open. */
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

/** Leave it. Pushes a hash-less URL rather than clearing the hash, which would leave a
 *  bare `#` behind and make Back a no-op. */
export function leave(replace = false) {
  if (!route.value) return;
  navigate(location.pathname + location.search, replace);
}
