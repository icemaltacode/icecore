/* The course's Slidev decks, as the platform sees them.
 *
 * One helper, two callers, deliberately:
 *
 *   - `build.mjs` needs each deck's *sections* - the slide ranges a topic's exercises are
 *     interleaved with.
 *   - `icecore slides` needs each deck's *includes* - the transitive `src:` graph, so a
 *     push can rebuild only the decks a change actually touched.
 *
 * Both come out of one `@slidev/parser` load. Parsing every deck twice would be the
 * obvious way to write this and is how the two features drift apart.
 *
 * WHY THE PARSER AND NOT A REGEX. A topic deck is a shell:
 *
 *     topic-1.1.1.md  ->  _frame-module-1.md, _unit-1.1.md,
 *                         1.1.1-relational-databases.md, _frame-close.md
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

/** `1.1.1` -> `<slides>/topic-1.1.1.md`, for every deck the course actually has. */
export function deckFiles(srcDir) {
  const out = new Map();
  if (!fs.existsSync(srcDir)) return out;
  for (const f of fs.readdirSync(srcDir)) {
    const m = f.match(/^topic-(\d[\d.]*)\.md$/);
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
 * ("Let's practice!") that follows it. This is a contract the decks already keep - all 59
 * of them - not a convention being introduced here. A deck that opens a section with some
 * other layout drops that section silently, which is why `verify` counts them.
 *
 * `end` is carried as well as `slide` so the player can walk a section rather than dumping
 * the student at its first slide and leaving them to find where it stops. */
const OPENS = 'statement';
const CLOSES = 'statement_alt';
/* Frames belong to the deck, not to any section: a section must never run into the closing
 * slide of the deck. */
const FRAME = new Set(['closing_slide', 'module_title', 'topic_title', 'contents', 'title']);

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

/**
 * Everything the platform wants to know about one deck.
 *
 * `includes` is repo-relative and covers the whole transitive `src:` chain, entry file
 * included - it is what maps "this file changed" to "these decks must be rebuilt".
 */
export async function readDeck(srcDir, topic, file) {
  const parser = await loadParser(srcDir);
  if (!parser) return null;
  // Absolute: the parser opens the entry relative to the process cwd, not to the root it is
  // handed, so a bare `topic-1.1.1.md` only resolves when you happen to be standing in
  // slides/ - which the CLI never is.
  const data = await parser.load(srcDir, path.join(srcDir, file));
  return {
    topic,
    file,
    slides: data.slides.length,
    sections: sectionsOf(data.slides),
    includes: [...Object.keys(data.watchFiles || {})]
      .map(p => path.relative(srcDir, path.resolve(srcDir, p))),
  };
}

/* Anything under slides/ that is not markdown is shared by every deck: the theme, the
 * stylesheet, package.json, the lockfile, and above all public/, which Slidev copies
 * wholesale into every build. Changing one of those rebuilds the lot.
 *
 * Markdown, by contrast, is attributable - and only through the include graph. "Rebuild
 * only 1.5.2" is not a filename match: topic-1.5.2.md pulls in _frame-module-1.md and
 * _unit-1.5.md as well as its own page, so editing _unit-1.5.md affects four decks and
 * editing _frame-module-1.md affects all of them. */
const isMarkdown = rel => rel.endsWith('.md');

/**
 * Which decks a set of changed files forces a rebuild of.
 *
 * `changed` is repo-relative, as `git diff --name-only` gives it. Paths outside slides/
 * cannot affect a deck and are ignored. Returns the topics to rebuild and why, so the
 * command can say "all 59, because slides/public/images/x.png changed" rather than just
 * doing it.
 */
export function affectedDecks(decks, changed) {
  const all = [...decks.keys()];
  const global = [];
  const byTopic = new Map();
  for (const p of changed) {
    const norm = p.split(path.sep).join('/');
    if (!norm.startsWith('slides/')) continue;
    const rel = norm.slice('slides/'.length);
    if (!isMarkdown(rel)) { global.push(rel); continue; }
    for (const d of decks.values())
      if (d.includes.includes(rel)) {
        if (!byTopic.has(d.topic)) byTopic.set(d.topic, []);
        byTopic.get(d.topic).push(rel);
      }
  }
  if (global.length) return { topics: all, global, reasons: new Map(all.map(t => [t, global])) };
  return { topics: [...byTopic.keys()], global: [], reasons: byTopic };
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
  for (const [topic, file] of deckFiles(srcDir)) {
    try {
      decks.set(topic, await readDeck(srcDir, topic, file));
    } catch (e) {
      onError(topic, String(e.message).split('\n')[0]);
    }
  }
  return decks;
}
