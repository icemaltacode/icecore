/* The course's Slidev decks, as the platform sees them.
 *
 * A DECK BELONGS TO A UNIT. It used to belong to a topic, and the rename is the whole of
 * what changed here: a DataCamp chapter is a unit now rather than a topic, so the file it
 * was always the deck for is a unit's. What a topic gets instead is one of that deck's
 * sections - a slide range - which is exactly what `sectionsOf` has always returned.
 *
 * One helper, two callers, deliberately:
 *
 *   - `build.mjs` needs each deck's *sections* - one per topic of the unit, in order.
 *   - `icecore slides` needs each deck's *includes* - the transitive `src:` graph, so a
 *     push can rebuild only the decks a change actually touched.
 *
 * Both come out of one `@slidev/parser` load. Parsing every deck twice would be the
 * obvious way to write this and is how the two features drift apart.
 *
 * WHY THE PARSER AND NOT A REGEX. A unit deck is a shell:
 *
 *     unit-1.1.md  ->  _frame-module-1.md, 1.1-relational-databases.md, _frame-close.md
 *
 * so the slide numbering a deep link addresses (`index.html#/13`) exists only after those
 * `src:` includes are resolved. A regex over the page file counts from the wrong place and
 * every link lands on the wrong slide.
 *
 * The parser belongs to the *course* repo (it is a devDependency of `slides/`), not to
 * icecore - the platform has no business depending on Slidev. So it is resolved from the
 * course's own node_modules and its absence is a degradation, not an error: a course
 * without it publishes with no interleaving rather than not publishing.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

/* Where a course keeps its deck sources. Fixed beside content/, the same way slides/ is.
 * Absolute, always: `createRequire` resolves a relative specifier against the *module*
 * rather than the cwd, so a relative path here finds icecore's own node_modules - which has
 * no Slidev in it - and silently degrades every course to "no interleaving". */
export const slidesSrcDir = contentDir => path.resolve(contentDir, '..', 'slides');

/* Where a built deck is PUBLISHED, and the one definition of it.
 *
 * Scoped by course, which it did not used to be. Deck prefixes lived at `slides/<unit>/`
 * while a course spanned every module in the site, so a deck number was globally unique by
 * construction. It is not any more: each course numbers its own modules from 1, so two
 * courses on one site both have a unit 1.1 and would write the same prefix - one silently
 * serving the other's slides.
 *
 * `build.mjs` puts this in index.json, `icecore slides` passes it to `--base`, and the
 * publish reads the course out of `.built.json` rather than reconstructing it. The three
 * must agree exactly: --base decides what URL a deck's own assets ask for, so a mismatch
 * 404s every image in production while working perfectly from a dev server at the root. */
export const deckPrefix = (courseId, unit) => `slides/${courseId}/${unit}`;

/** `1.1` -> `<slides>/unit-1.1.md`, for every deck the course actually has. */
export function deckFiles(srcDir) {
  const out = new Map();
  if (!fs.existsSync(srcDir)) return out;
  for (const f of fs.readdirSync(srcDir)) {
    const m = f.match(/^unit-(\d[\d.]*)\.md$/);
    if (m) out.set(m[1], f);
  }
  return out;
}

/* Resolved from the course, and cached: `require.resolve` walks the filesystem and this is
 * asked once per deck. A course with no slides/ at all resolves to null and every caller
 * degrades. */
const parsers = new Map();
export async function loadParser(srcDir) {
  if (parsers.has(srcDir)) return parsers.get(srcDir);
  let mod = null;
  try {
    const require = createRequire(path.join(srcDir, 'package.json'));
    mod = await import(pathToFileURL(require.resolve('@slidev/parser/fs')).href);
  } catch { mod = null; }
  parsers.set(srcDir, mod);
  return mod;
}

/* A section opens on `layout: statement` and closes on the `layout: statement_alt`
 * ("Let's practice!") that follows it. This is a contract the decks already keep - all 79
 * of them - not a convention being introduced here. A deck that opens a section with some
 * other layout drops that section silently, which is why `verify` counts them.
 *
 * ONE SECTION PER TOPIC, IN ORDER. A section's ordinal is its topic's third number: the
 * second section of `unit-2.3.md` is topic 2.3.2. That alignment is the whole interleaving
 * contract now - it used to be an annotation joining exercises to slides, and it is the
 * hierarchy itself. A deck one section short therefore leaves a topic with no slides, which
 * is what `verify` fails on.
 *
 * `end` is carried as well as `slide` so the player can walk a section rather than dumping
 * the student at its first slide and leaving them to find where it stops. */
const OPENS = 'statement';
const CLOSES = 'statement_alt';
/* Frames belong to the deck, not to any section: a section must never run into the closing
 * slide of the deck. */
const FRAME = new Set(['closing_slide', 'module_title', 'unit_title', 'topic_title',
                       'contents', 'title']);

export function sectionsOf(slides) {
  const layout = i => slides[i]?.frontmatter?.layout || '';
  const out = [];
  for (let i = 0; i < slides.length; i++) {
    if (layout(i) !== OPENS) continue;
    // Runs to its own closing slide, or - if the author never wrote one - to whatever comes
    // before the next section or the deck's closing frame.
    let end = i;
    for (let j = i + 1; j < slides.length; j++) {
      if (layout(j) === OPENS || FRAME.has(layout(j))) break;
      end = j;
      if (layout(j) === CLOSES) break;
    }
    out.push({
      n: out.length + 1,
      title: slides[i].title || `Section ${out.length + 1}`,
      slide: i + 1,        // 1-based: `#/1` is the first slide of the composed deck
      end: end + 1,
    });
  }
  return out;
}

/* The speaker notes, keyed by COMPOSED-DECK slide number - the same numbering a topic's
 * range and a deep link use, and the only one that means anything once `src:` includes are
 * resolved. Sparse: about a quarter of slides have no note, and an entry for each of those
 * would be three quarters of a file saying nothing.
 *
 * Raw markdown, not HTML. Slidev renders these itself in its presenter view and the player
 * has its own markdown renderer for exercise prose; handing the player the source means one
 * renderer and one set of typography rather than two that drift.
 *
 * These are worth showing a student BECAUSE of how they are written - the house rule is
 * that a note is a handout, not a stage direction, so there is nothing in them addressed to
 * a presenter. That is a property of the content, not of this function; a course that wrote
 * "remember to pause here" notes would be publishing them to students too. */
export function notesOf(slides) {
  const out = {};
  slides.forEach((s, i) => {
    const note = String(s.note || '').trim();
    if (note) out[i + 1] = note;
  });
  return out;
}

/**
 * Everything the platform wants to know about one deck.
 *
 * `includes` is repo-relative and covers the whole transitive `src:` chain, entry file
 * included - it is what maps "this file changed" to "these decks must be rebuilt".
 */
export async function readDeck(srcDir, unit, file) {
  const parser = await loadParser(srcDir);
  if (!parser) return null;
  // Absolute: the parser opens the entry relative to the process cwd, not to the root it is
  // handed, so a bare `unit-1.1.md` only resolves when you happen to be standing in
  // slides/ - which the CLI never is.
  const data = await parser.load(srcDir, path.join(srcDir, file));
  const includes = [...Object.keys(data.watchFiles || {})]
    .map(p => path.relative(srcDir, path.resolve(srcDir, p)));
  return {
    unit,
    file,
    slides: data.slides.length,
    sections: sectionsOf(data.slides),
    notes: notesOf(data.slides),
    includes,
    images: imagesUsedBy(srcDir, data, includes),
  };
}

/* Which files under public/ a deck actually asks for.
 *
 * Slidev copies the whole of public/ into every build, and public/ is 77MB of every unit's
 * figures - so a deck for 1.1 ships 10.4's images, and 79 decks ship the same 77MB 79
 * times. Knowing what a deck references is what lets the build drop the rest.
 *
 * Two sources, unioned, because getting this wrong deletes a figure that is genuinely used
 * and the slide renders a broken image rather than failing anything:
 *
 *   - what the parser saw, which is markdown and HTML `<img>` usage
 *   - a plain scan of the source text, which additionally catches frontmatter (`image:`,
 *     `background:`) and anything built by hand in a template
 *
 * The scan alone would be enough today. Both are cheap, and the parser's view is the one
 * that keeps working if someone starts generating references.
 */
function imagesUsedBy(srcDir, data, includes) {
  const used = new Set();
  const add = ref => {
    if (typeof ref !== 'string') return;
    const clean = ref.split(/[?#]/)[0].trim();
    if (clean.startsWith('/')) used.add(clean);
  };
  for (const s of data.slides || []) (s.source?.images || []).forEach(add);
  for (const rel of includes) {
    let text;
    try { text = fs.readFileSync(path.join(srcDir, rel), 'utf8'); } catch { continue; }
    for (const m of text.matchAll(/(\/[\w.@-]+(?:\/[\w.@%-]+)*\.(?:png|jpe?g|gif|svg|webp|avif|mp4|webm))/gi))
      add(m[1]);
  }
  return [...used];
}

/* Anything under slides/ that is not markdown is shared by every deck: the theme, the
 * stylesheet, package.json, the lockfile, and above all public/, which Slidev copies
 * wholesale into every build. Changing one of those rebuilds the lot.
 *
 * Markdown, by contrast, is attributable - and only through the include graph. "Rebuild
 * only 5.2" is not a filename match: unit-5.2.md pulls in _frame-module-5.md as well as its
 * own page, so editing _frame-module-5.md affects every deck of module 5. */
const isMarkdown = rel => rel.endsWith('.md');

/**
 * Which decks a set of changed files forces a rebuild of.
 *
 * `changed` is repo-relative, as `git diff --name-only` gives it. Paths outside slides/
 * cannot affect a deck and are ignored. Returns the units to rebuild and why, so the
 * command can say "all 79, because slides/public/images/x.png changed" rather than just
 * doing it.
 */
export function affectedDecks(decks, changed) {
  const all = [...decks.keys()];
  const global = [];
  const byUnit = new Map();
  for (const p of changed) {
    const norm = p.split(path.sep).join('/');
    if (!norm.startsWith('slides/')) continue;
    const rel = norm.slice('slides/'.length);
    if (!isMarkdown(rel)) { global.push(rel); continue; }
    for (const d of decks.values())
      if (d.includes.includes(rel)) {
        if (!byUnit.has(d.unit)) byUnit.set(d.unit, []);
        byUnit.get(d.unit).push(rel);
      }
  }
  if (global.length) return { units: all, global, reasons: new Map(all.map(u => [u, global])) };
  return { units: [...byUnit.keys()], global: [], reasons: byUnit };
}

/**
 * Every deck in the course, parsed once.
 *
 * Returns an empty map when the parser isn't installed, so a caller can carry on without
 * interleaving rather than failing the build. `onError` sees a deck that will not parse -
 * that one is a real problem and the caller decides how loud to be about it.
 */
export async function readDecks(srcDir, { onError = () => {} } = {}) {
  const decks = new Map();
  const parser = await loadParser(srcDir);
  if (!parser) return decks;
  for (const [unit, file] of deckFiles(srcDir)) {
    try {
      decks.set(unit, await readDeck(srcDir, unit, file));
    } catch (e) {
      onError(unit, String(e.message).split('\n')[0]);
    }
  }
  return decks;
}
