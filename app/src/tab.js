/* WHICH TAB THIS IS, on the live channel. One id per page load, and one definition of it.
 *
 * Two messages on the channel are numbered by their sender so that a reader can keep the newest:
 * the deck's patches (decksync.js) and the shared editor's pushes (delivery.js). API Gateway runs
 * every message as its own concurrent invocation, so nothing on the way imposes an order, and the
 * number only means something beside the tab that counted it. The parts of a split message
 * (live.js) are named by it too.
 *
 * PER TAB, NOT PER PERSON. An educator's room tab and their control tab are one sub with two
 * independent counters, and merged they would each look stale to the other. Random rather than
 * derived from anything, so it says nothing about anybody.
 *
 * Pure and dependency-free, so decksync.js can import it and still be imported by its test.
 */
export const TAB = Math.random().toString(36).slice(2, 12);
