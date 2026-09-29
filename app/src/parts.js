/* A message too big for one frame, split into parts that each fit, and put back together.
 *
 * THREE LIMITS STAND BETWEEN AN EDUCATOR'S DRAWING AND A CLASS, and the smallest decides:
 *
 *   - the Lambda carries no deck patch over 32KB (`DECK_LIMIT`), and drops a bigger one without
 *     a word - so the snapshot of every annotated slide, which passes 32KB within a few
 *     handwritten words, reached nobody, and a student who had missed a stroke never got it
 *     back;
 *   - API Gateway closes the SENDER's connection, code 1009, over its limits. Measured against
 *     the deployment: Node's client is cut at 40KB, Chromium survives 126KB and is cut at 130KB;
 *   - and the 32KB frame limit AWS documents, which how each browser frames a message decides.
 *
 * Parts of at most 28KB are under all three, whatever the browser. See LIVE-RELIABILITY.md.
 *
 * PURE, like compare.js and walk.js: no imports, no `import.meta.env`, so its test imports it
 * directly. live.js does the sending and the receiving; this only cuts and joins.
 *
 * The limit is in BYTES, as the frame's is. A chunk is JSON text inside a JSON string, so every
 * quote and backslash in it doubles when the part is serialised - and SVG is mostly quotes - so
 * each chunk is sized by measuring its part, never by counting characters.
 */

/* Under the 32KB frame with room for the envelope. What a part may weigh on the wire. */
export const PART_BYTES = 28 * 1024;
/* A ceiling on how many parts one message may become - the most the Lambda will relay, and the
 * most a receiver will hold. 64 parts is well over a megabyte of drawing. */
export const MAX_PARTS = 64;

const encoder = new TextEncoder();
/** The size of a string on the wire: its UTF-8 bytes, which is what the frame limit counts. */
export const bytes = s => encoder.encode(s).length;

/**
 * Cut `text` (a serialised message) into parts, each of which serialises to at most `limit`
 * bytes with its envelope. `envelope` is the fields every part carries - the type, what it is
 * part of, who it is for - and `id` names the message the parts belong to.
 *
 * Returns null when the message would need more than MAX_PARTS: that is not a message this
 * channel should carry in pieces either.
 */
export function split(text, envelope, id, limit = PART_BYTES) {
  const chunks = [];
  let at = 0;
  // Start from a guess and halve until the part fits; most chunks fit first time.
  let size = Math.max(256, Math.floor(limit / 2));
  while (at < text.length) {
    let n = Math.min(size, text.length - at);
    for (;;) {
      const part = JSON.stringify({ ...envelope, id, n: 0, total: 999, chunk: text.slice(at, at + n) });
      if (bytes(part) <= limit || n <= 64) break;
      n = Math.floor(n / 2);
    }
    chunks.push(text.slice(at, at + n));
    at += n;
    if (chunks.length > MAX_PARTS) return null;
  }
  return chunks.map((chunk, n) => ({ ...envelope, id, n, total: chunks.length, chunk }));
}

/**
 * Put parts back together as they arrive, in any order.
 *
 * `add(part)` answers the whole serialised message once its last part is in, and null until
 * then. A message with a part that never comes is forgotten after `ttl` rather than held for the
 * rest of the lesson: whatever it carried will be sent again, because everything that travels
 * in parts is a snapshot that the sender repeats.
 */
export function assembler({ ttl = 5000 } = {}) {
  const pending = new Map();   // id -> { total, chunks, got, at }
  const sweep = now => {
    for (const [id, p] of pending) if (now - p.at > ttl) pending.delete(id);
  };
  return {
    add(part, now = Date.now()) {
      sweep(now);
      const { id, n, total, chunk } = part || {};
      if (typeof id !== 'string' || !Number.isInteger(n) || !Number.isInteger(total)
          || total < 1 || total > MAX_PARTS || n < 0 || n >= total || typeof chunk !== 'string') {
        return null;
      }
      let p = pending.get(id);
      if (!p) { p = { total, chunks: new Array(total), got: 0, at: now }; pending.set(id, p); }
      if (p.total !== total || p.chunks[n] !== undefined) return null;
      p.chunks[n] = chunk;
      p.got += 1;
      if (p.got < p.total) return null;
      pending.delete(id);
      return p.chunks.join('');
    },
    /** How many messages are waiting for a part. For tests. */
    get waiting() { return pending.size; },
  };
}
