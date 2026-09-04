/* Two things a `<script setup>` can get wrong that a build will happily compile.
 *
 *   npm run test:setup
 *
 * ONE: a binding used before the line that declares it. TWO: a Vue API used without being
 * imported. Both are ReferenceErrors at runtime and neither fails a build - and both have
 * now shipped to production, so they are worth a page of code between them.
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

/** Every .mjs under a directory, at any depth. The Lambdas, for the projection check below. */
function mjs(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return mjs(full);
    return e.isFile() && e.name.endsWith('.mjs') ? [full] : [];
  });
}

/* Comments and string bodies, blanked to spaces - length preserved, so every line number
 * still lands where it did.
 *
 * NOT COSMETIC. The word "import" appears in prose in half the files here, and a regex that
 * meets one in a docblock will happily scan across the real import statement below it and
 * swallow the thing it was looking for. That is not a hypothetical: it is how the first run
 * of this check reported two imports missing that were three lines away.
 */
function code(src) {
  const out = src.split('');
  let i = 0;
  const blank = (from, to) => { for (let j = from; j < to && j < src.length; j++)
    if (src[j] !== '\n') out[j] = ' '; };
  while (i < src.length) {
    const c = src[i], next = src[i + 1];
    if (c === '/' && next === '*') { const e = src.indexOf('*/', i + 2); const end = e < 0 ? src.length : e + 2; blank(i, end); i = end; continue; }
    if (c === '/' && next === '/') { const e = src.indexOf('\n', i); const end = e < 0 ? src.length : e; blank(i, end); i = end; continue; }
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      while (j < src.length && src[j] !== c) { if (src[j] === '\\') j++; j++; }
      blank(i + 1, j); i = j + 1; continue;
    }
    i++;
  }
  return out.join('');
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

/* Every name a `<script setup>` might reach for and have to import. Not the whole of Vue's
 * surface: the ones actually used in this app plus the near neighbours somebody would reach
 * for next. Compiler macros are deliberately absent - `defineProps` and its siblings are
 * compiled away and are supposed to be undeclared. */
const VUE_API = new Set([
  'ref', 'shallowRef', 'computed', 'reactive', 'readonly', 'unref', 'isRef',
  'toRef', 'toRefs', 'toRaw', 'markRaw',
  'watch', 'watchEffect', 'watchPostEffect', 'watchSyncEffect', 'nextTick',
  'onMounted', 'onUnmounted', 'onBeforeMount', 'onBeforeUnmount',
  'onUpdated', 'onBeforeUpdate', 'onActivated', 'onDeactivated', 'onErrorCaptured',
  'provide', 'inject', 'getCurrentInstance', 'useSlots', 'useAttrs', 'useTemplateRef',
  'defineAsyncComponent', 'h',
]);

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

  // Comments and string contents blanked, so prose about imports is not read as one.
  const body = code(m[1]);

  /* ---- used without being imported ---------------------------------------
   *
   * `nextTick` was used once in App.vue and imported nowhere, for as long as the follow
   * counter had existed. It threw every time it ran - inside a watcher, where Vue catches and
   * logs, so it was invisible; and the counter it was meant to decrement stayed stuck up
   * forever, which quietly disabled the check it belonged to. Then the same helper was called
   * from inside a try that tears a session down, and a latent ReferenceError became an
   * educator's lesson vanishing off their screen.
   *
   * Anything bound by an import or declared locally is fine; what is left is a global that
   * does not exist. */
  const bound = new Set();
  for (const im of body.matchAll(/^\s*import\s+(?:\{([^}]*)\}|(\w+))[^;\n]*?from/gm)) {
    if (im[2]) bound.add(im[2]);
    for (const part of (im[1] || '').split(',')) {
      const as = /(\w+)\s+as\s+(\w+)/.exec(part);
      const plain = /^\s*(\w+)\s*$/.exec(part);
      if (as) bound.add(as[2]);
      else if (plain) bound.add(plain[1]);
    }
  }
  for (const d of body.matchAll(/(?:^|\n)\s*(?:const|let|var|function|class)\s+(\w+)/g))
    bound.add(d[1]);

  const seen = new Set();
  for (const use of body.matchAll(/(?<![\w$.'"`])([A-Za-z_$][\w$]*)\s*\(/g)) {
    const name = use[1];
    if (!VUE_API.has(name) || bound.has(name) || seen.has(name)) continue;
    seen.add(name);
    const line = body.slice(0, use.index).split('\n').length;
    console.log(`FAIL  ${path.relative(ROOT, file)}:${line}`);
    console.log(`      \`${name}\` is used but never imported from 'vue'`);
    bad++;
  }

  /* Line numbers come from a character offset, so a source spanning three lines is reported
   * at the `watch(` that owns it rather than wherever the identifier happened to sit. */
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
        console.log(`      ${m[1].split('\n')[line].trim()}`);
        bad++;
      }
    }
  }
}

/* THREE: a DynamoDB reserved word in a ProjectionExpression.
 *
 * WRITTEN BECAUSE THIS SHIPPED, like the two above. `ProjectionExpression: 'by'` on the live
 * session row is not a wrong answer, it is a ValidationException - so the boards function
 * returned 500 on every read that reached it: a student opening a saved board, and an
 * educator's entire listing, which was swallowed and looked like there being nothing there.
 * It reached production because nothing in this repo calls an HTTP Lambda at all. `test/live.mjs`
 * opens a real socket and covers the channel; the six request/response functions have no
 * equivalent, and that gap is wider than this check - which is a reason to know about it
 * rather than a reason not to close the part that fits on a page.
 *
 * The list is AWS's published one, abridged: only names a row in THIS table could plausibly
 * be given. A word missing from it is a catch missed, never a wrong failure, so erring short
 * is the safe direction - and `ExpressionAttributeNames` is always available for anything it
 * does not know about.
 */
const RESERVED = new Set(`
absolute action add all alter and any as asc at attribute authorization avg
before begin between bit blob boolean both by
call cascade case cast char character check class close collate column comment commit
connect connection constraint continue convert copy count create current cursor
data database date day dec decimal declare default delete depth desc describe
distinct do domain double drop dump duration
each element else end equal escape exception exec execute exists exit explain
false fetch field file filter first float for foreign format free from full function
get global go goto grant group
handler has hash having hour
identified if ignore immediate in include index initial inner input insert integer
intersect interval into is isolation
join key keys kill language large last leading left length level like limit list load
local location long loop lower
map match max member merge method min minute mode modify module month
name names national natural new next no none not null number numeric
object of off offset old on only open operator option or order out outer output over owner
package pad parameter partial partition password path percent period position precision
primary prior privileges procedure public
query quit quorum
raise range raw read reads real record recursive reference references regexp region
rename repeat replace reset resource restore restrict result return returns revoke right
role rollback row rows
sample scan schema scope search second section select separate sequence session set sets
show signal similar size smallint snapshot some source space sql start state static status
storage store stored subset substring sum system
table tables tablesample temp temporary terminated text than then time timestamp timezone
to top trailing transaction trigger trim true truncate ttl type
under union unique unknown unlogged until update upper usage use user users using
value values varchar variable view views virtual void
when whenever where while window with within work write
year zone
`.trim().split(/\s+/));

for (const file of mjs(path.join(import.meta.dirname, '..', 'infra', 'lambda'))) {
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(/ProjectionExpression:\s*'([^']*)'/g)) {
    const line = src.slice(0, m.index).split('\n').length;
    for (const raw of m[1].split(',')) {
      const name = raw.trim();
      // Aliased names are exactly the thing this is asking for, and dotted paths are not names.
      if (!name || name.startsWith('#') || name.includes('.') || name.includes('[')) continue;
      if (!RESERVED.has(name.toLowerCase())) continue;
      console.log(`FAIL  ${path.relative(path.join(ROOT, '..', '..'), file)}:${line}`);
      console.log(`      \`${name}\` is a DynamoDB reserved word - alias it as \`#${name}\``);
      console.log(`      ProjectionExpression: '${m[1]}'`);
      bad++;
    }
  }
}

console.log(bad ? `\n${bad} problem${bad === 1 ? '' : 's'}`
                : 'every setup block imports what it uses and declares before it reads,'
                  + ' and no projection names a reserved word');
process.exit(bad ? 1 : 0);
