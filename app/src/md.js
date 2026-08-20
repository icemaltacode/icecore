/* Deliberately tiny markdown renderer — the content is ours and uses a known subset. */
import { DEFAULT_FLOOR as DEFAULT_APP_FLOOR } from './appframe.js';

/* `>` is deliberately not escaped: it is only special after a `<`, which is escaped, and
 * leaving it alone is what lets the blockquote rule below still see its own marker. */
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

/**
 * `base` is where an exercise's own images live. Image sources are written as bare
 * filenames in the markdown - the exercise shouldn't have to know the course id or where
 * the bundle is mounted - so they're resolved against it here.
 *
 * `apps` is the same idea for embedded apps: a `::app <name>::` line names a directory,
 * and the player decides where that directory is published.
 *
 * `escaped` is internal: a blockquote renders its own body by calling back in, and escaping
 * twice would turn &amp; into &amp;amp;.
 */
export function md(src = '', { base = '', apps = '', escaped = false } = {}) {
  const lines = (escaped ? src : esc(src)).split('\n');
  const out = [];
  let list = null, para = [], fence = null;

  const flushPara = () => { if (para.length) { out.push(`<p>${inline(para.join(' '), base)}</p>`); para = []; } };
  const flushList = () => { if (list) { out.push(`<ul>${list.join('')}</ul>`); list = null; } };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Fenced blocks come through verbatim - exercise prompts are full of SQL, and joining
    // those lines into a paragraph turns a query into an unreadable smear. This has to stay
    // the first test: result sets inside ```sql fences are pipe tables, and they are code.
    const rule = line.match(/^\s*```(\w*)\s*$/);
    if (rule) {
      if (fence) { out.push(`<pre><code${fence.lang ? ` class="language-${fence.lang}"` : ''}>${fence.body.join('\n')}</code></pre>`); fence = null; }
      else { flushPara(); flushList(); fence = { lang: rule[1], body: [] }; }
      continue;
    }
    if (fence) { fence.body.push(line); continue; }

    // An embedded app: `::app <name>::`, optionally with a height. The app is a static
    // bundle of its own, so it goes in an iframe rather than into this page - it brings its
    // own React, its own stylesheet and its own idea of what `body` should look like.
    // allow-same-origin is not optional, tempting as it looks: without it the frame gets an
    // opaque origin, its own assets become cross-origin requests to a host that sends no
    // CORS headers, and a module script - always fetched in CORS mode, attribute or not -
    // can never load. Serving CORS headers instead would work here and 403 in production,
    // where /content/* sits behind the CloudFront key group and an anonymous cross-origin
    // fetch carries no cookies. So the sandbox buys the rest of its list - no top-level
    // navigation, no popups, no forms - and the app itself has to be trusted.
    const embed = line.match(/^\s*::app\s+([\w.-]+)(?:\s+height=(\d+))?\s*::\s*$/);
    if (embed) {
      flushPara(); flushList();
      const [, name, height] = embed;
      /* The authored height is a FLOOR, not the height: `appframe.js` measures the app and
       * grows past it when the content needs more. Carried in `data-floor` as well as in
       * the inline style, because the style is only a starting point - it is overwritten on
       * the first measurement and the floor has to survive that. `height=` is optional for
       * the same reason; without it the measurement does all the work. */
      const floor = Number(height) || DEFAULT_APP_FLOOR;
      out.push(
        `<div class="appframe" data-floor="${floor}" style="height:${floor}px">` +
        `<iframe src="${apps}${encodeURIComponent(name)}/index.html" title="${name}" ` +
        `loading="lazy" sandbox="allow-scripts allow-same-origin"></iframe></div>`);
      continue;
    }

    // A pipe table: a header row, then a row of dashes. The separator must contain a pipe,
    // so a bare `---` under a line of prose stays prose rather than becoming a one-column
    // table.
    if (line.includes('|') && isSeparator(lines[i + 1])) {
      flushPara(); flushList();
      const head = cells(line);
      i++;                                   // step over the separator
      const body = [];
      while (i + 1 < lines.length && lines[i + 1].includes('|') && lines[i + 1].trim())
        body.push(cells(lines[++i]));
      out.push(
        '<div class="tablewrap"><table><thead><tr>' +
        head.map(c => `<th>${inline(c, base)}</th>`).join('') +
        '</tr></thead><tbody>' +
        body.map(r => `<tr>${r.map(c => `<td>${inline(c, base)}</td>`).join('')}</tr>`).join('') +
        '</tbody></table></div>');
      continue;
    }

    // Blockquotes, one level. Rendered by calling back in so a quote can hold paragraphs
    // and lists rather than only a single line.
    if (/^\s*>/.test(line)) {
      flushPara(); flushList();
      const quoted = [line.replace(/^\s*>\s?/, '')];
      while (i + 1 < lines.length && /^\s*>/.test(lines[i + 1]))
        quoted.push(lines[++i].replace(/^\s*>\s?/, ''));
      out.push(`<blockquote>${md(quoted.join('\n'), { base, apps, escaped: true })}</blockquote>`);
      continue;
    }

    const item = line.match(/^\s*[-*]\s+(.*)$/);
    if (item) { flushPara(); (list ||= []).push(`<li>${inline(item[1], base)}</li>`); continue; }
    if (!line.trim()) { flushPara(); flushList(); continue; }
    flushList();
    para.push(line.trim());
  }
  // An unclosed fence is malformed content; render what we have rather than losing it.
  if (fence) out.push(`<pre><code>${fence.body.join('\n')}</code></pre>`);
  flushPara(); flushList();
  return out.join('\n');
}

/* Cells of a pipe row, without the empties an outer pipe leaves behind. */
const cells = row => {
  const parts = row.split('|');
  if (parts[0].trim() === '') parts.shift();
  if (parts.length && parts[parts.length - 1].trim() === '') parts.pop();
  return parts.map(c => c.trim());
};
const isSeparator = row =>
  !!row && row.includes('|') && row.includes('-') &&
  cells(row).length > 0 && cells(row).every(c => /^:?-+:?$/.test(c));

/* encodeURI, not encodeURIComponent: a bare filename is the contract but a subdirectory
 * shouldn't break, and a filename with a space in it should resolve rather than silently
 * become a link - which is what a space-intolerant image rule used to do to it. */
const resolve = (src, base) =>
  /^(https?:)?\/\//.test(src) || src.startsWith('/') ? src : base + encodeURI(src);

function inline(s, base = '') {
  return s
    .replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`)
    // Images before links: ![alt](src) would otherwise match the link rule and leave a
    // stray "!" in front of it, which is exactly what it did before.
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g,
      (_, alt, src) => `<img src="${resolve(src.trim(), base)}" alt="${alt}" loading="lazy">`)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}
