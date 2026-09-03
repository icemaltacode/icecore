/* Does any `<script setup>` use a binding before the line that declares it?
 *
 *   npm run test:order
 *
 * WRITTEN BECAUSE THIS SHIPPED. A watcher gained a second source - `watch([getter, flat], ...)`
 * - thirteen lines above `const flat = computed(...)`. A watch source is read the moment
 * `watch()` is called, so the whole component threw `can't access lexical declaration` before
 * it mounted and the site went blank. The getter it replaced was lazy and did not care where
 * it sat, which is exactly why moving to an array was easy to miss.
 *
 * A BUILD DOES NOT CATCH IT. Vite compiles a temporal-dead-zone reference happily; nothing
 * fails until something executes the setup function, and nothing in this repo does - the
 * live tests open raw sockets and never load the app. So this is the cheapest thing that
 * stands between that mistake and a blank production site.
 *
 * IT IS DELIBERATELY NARROW: it looks at `watch()` SOURCES and nothing else. A watch source
 * is the one construct in a `<script setup>` that reads a binding eagerly while looking
 * exactly like a reference that does not - `watch(() => a.b, fn)` is lazy and
 * `watch([() => a.b, c], fn)` is not, and the difference is one character of punctuation.
 * Anything after a `=>` is a body that runs later and is skipped, which is precisely why
 * `() => flat.value` is safe where a bare `flat` is not.
 *
 * A general scope analyser would be the thorough answer and a much bigger one. This is the
 * mistake that actually happened, and it fits on a page.
 *
 * False positives are possible and are the right failure direction: this is a linter for one
 * mistake, and the fix for a flagged line is always to move the declaration up.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, '..', 'app', 'src');

/** Every .vue under app/src, at any depth. */
function vues(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return vues(full);
    return e.isFile() && e.name.endsWith('.vue') ? [full] : [];
  });
}

/** The balanced text from `from` (index of an open paren) to its match. */
function balanced(src, from) {
  let depth = 0;
  for (let i = from; i < src.length; i++) {
    if ('([{'.includes(src[i])) depth++;
    else if (')]}'.includes(src[i])) { depth--; if (!depth) return src.slice(from + 1, i); }
  }
  return '';
}

/* Everything from a `=>` to the end of its enclosing element is a body that runs later.
 * Blanked rather than parsed: what is left is what a watch source evaluates immediately. */
function withoutBodies(text) {
  const out = text.split('');
  for (let i = 0; i < text.length - 1; i++) {
    if (text[i] !== '=' || text[i + 1] !== '>') continue;
    let depth = 0;
    for (let j = i; j < text.length; j++) {
      if ('([{'.includes(text[j])) depth++;
      else if (')]}'.includes(text[j])) { if (!depth) break; depth--; }
      else if (text[j] === ',' && !depth) break;
      out[j] = ' ';
    }
  }
  return out.join('');
}

let bad = 0;
for (const file of vues(ROOT)) {
  const src = readFileSync(file, 'utf8');
  const m = /<script setup>([\s\S]*?)<\/script>/.exec(src);
  if (!m) continue;
  const lines = m[1].split('\n');

  const declaredAt = new Map();
  lines.forEach((l, i) => {
    const d = /^(?:const|let|var)\s+([A-Za-z_$][\w$]*)/.exec(l);
    if (d && !declaredAt.has(d[1])) declaredAt.set(d[1], i);
  });

  /* Line numbers come from a character offset, so a source spanning three lines is reported
   * at the `watch(` that owns it rather than wherever the identifier happened to sit. */
  const body = m[1];
  const lineOf = at => body.slice(0, at).split('\n').length - 1;

  for (const w of body.matchAll(/\bwatch(?:Effect|PostEffect|SyncEffect)?\s*\(/g)) {
    const open = w.index + w[0].length - 1;
    const args = balanced(body, open);
    // The first argument only: the rest is the callback and its options.
    const source = withoutBodies(args.split(/,(?![^[\]]*\])/)[0] || '');
    const line = lineOf(open);
    for (const id of source.matchAll(/(?<![\w$.'"`])([A-Za-z_$][\w$]*)(?![\w$(])/g)) {
      const at = declaredAt.get(id[1]);
      if (at !== undefined && at > line) {
        console.log(`FAIL  ${path.relative(ROOT, file)}:${line + 1}`);
        console.log(`      watch source uses \`${id[1]}\`, declared on line ${at + 1}`);
        console.log(`      ${body.split('\n')[line].trim()}`);
        bad++;
      }
    }
  }
}

console.log(bad ? `\n${bad} watch source${bad === 1 ? '' : 's'} read before declaration`
                : 'no watch source is read before its declaration');
process.exit(bad ? 1 : 0);
