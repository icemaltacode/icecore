/* Deliberately tiny markdown renderer — the content is ours and uses a known subset. */
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * `base` is where an exercise's own images live. Image sources are written as bare
 * filenames in the markdown - the exercise shouldn't have to know the course id or where
 * the bundle is mounted - so they're resolved against it here.
 */
export function md(src = '', { base = '' } = {}) {
  const lines = esc(src).split('\n');
  const out = [];
  let list = null, para = [], fence = null;

  const flushPara = () => { if (para.length) { out.push(`<p>${inline(para.join(' '), base)}</p>`); para = []; } };
  const flushList = () => { if (list) { out.push(`<ul>${list.join('')}</ul>`); list = null; } };

  for (const line of lines) {
    // Fenced blocks come through verbatim - exercise prompts are full of SQL, and joining
    // those lines into a paragraph turns a query into an unreadable smear.
    const rule = line.match(/^\s*```(\w*)\s*$/);
    if (rule) {
      if (fence) { out.push(`<pre><code${fence.lang ? ` class="language-${fence.lang}"` : ''}>${fence.body.join('\n')}</code></pre>`); fence = null; }
      else { flushPara(); flushList(); fence = { lang: rule[1], body: [] }; }
      continue;
    }
    if (fence) { fence.body.push(line); continue; }

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

const resolve = (src, base) =>
  /^(https?:)?\/\//.test(src) || src.startsWith('/') ? src : base + src;

function inline(s, base = '') {
  return s
    .replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`)
    // Images before links: ![alt](src) would otherwise match the link rule and leave a
    // stray "!" in front of it, which is exactly what it did before.
    .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g,
      (_, alt, src) => `<img src="${resolve(src, base)}" alt="${alt}" loading="lazy">`)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}
