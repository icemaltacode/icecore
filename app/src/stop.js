/* WHEN A STOP BUTTON IS OFFERED: once a press has taken long enough to need one.
 *
 * Stop exists because the runtimes moved into workers (see worker-rpc.js): a `while True:` or
 * a cross join of two large tables used to hold the whole page with no way out but closing
 * the tab, and a worker can be ended from outside. Stopping costs a restart of the runtime,
 * so it is for a run that is not going to finish, not a gesture to offer on every press.
 *
 * NOT FROM THE FIRST INSTANT. A Stop shown the moment a run starts flashes beside every Run
 * that takes 20ms, which reads as something going wrong. A run that has not finished after
 * a second and a half is the one a student starts to wonder about, so that is when it
 * appears.
 *
 * ONE DEFINITION, used by both exercise types and the Playground, so the button behaves the
 * same wherever a student meets it.
 */
import { ref, watch, onBeforeUnmount } from 'vue';

export const STOP_AFTER = 1500;

/** A ref that turns true once `busy` has stayed true for STOP_AFTER, and false with it. */
export function useStop(busy) {
  const offered = ref(false);
  let timer = null;
  watch(busy, now => {
    clearTimeout(timer);
    offered.value = false;
    if (now) timer = setTimeout(() => { offered.value = true; }, STOP_AFTER);
  });
  onBeforeUnmount(() => clearTimeout(timer));
  return offered;
}
