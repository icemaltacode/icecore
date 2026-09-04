/* THE TEST'S ENTRY INTO THE PLAYER, and it has to be one file for one reason: module state.
 *
 * `delivery.js` holds the session, the room and the listener registry at module scope, and
 * `live.js` holds the dispatcher every message goes through. A test that imported App.vue
 * from one bundle and `live.js` from another would be poking a second copy of the channel
 * while the mounted app listened to the first - and every assertion would fail for a reason
 * that looks nothing like the cause. One entry, one module graph, one of each.
 *
 * What is re-exported is exactly what a test drives the app WITH: the room's own dispatcher,
 * the session state to read back, and the preview's room script so it can be stopped. The
 * app is otherwise untouched - this adds no seam to the player, it only names the doors that
 * already exist.
 */
export { default as App } from '../../app/src/App.vue';
export { emitLocal, live as channel, send, on } from '../../app/src/live.js';
export * as delivery from '../../app/src/delivery.js';
/* `previewApi` is the stand-in's own front door, and a test uses it the way the app does -
 * to change what the stand-in will answer next. That is what makes "the class is told when
 * the list changes" checkable at all: without it the list is a constant, and a test that a
 * re-read happened could only assert that nothing changed. */
export { previewRole, stopPreviewRoom, previewApi } from '../../app/src/preview.js';
export { session, restore, startSession } from '../../app/src/auth.js';
