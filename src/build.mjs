/* Turn a course's exercise markdown into publishable static content.
 *
 *   <contentDir>/exercises/<unit>/_unit.json   unit number + title
 *   <contentDir>/exercises/<unit>/NN-slug.md   one exercise each
 *   <contentDir>/data/<table>.sql              seed data
 *        ->
 *   <outDir>/content/courses.json              manifest
 *   <outDir>/content/<course>/index.json       units + exercises + expected results
 *   <outDir>/content/<course>/data/<t>.sql     datasets, fetched on demand
 *
 * Reference solutions are never written to the output - grading compares against the
 * expected result sets computed here, so the answers don't reach the browser.
 */
import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';

// ---- markdown parsing ------------------------------------------------------
function frontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return [{}, text];
  const fm = {};
  let key = null;
  for (const line of m[1].split('\n')) {
    const item = line.match(/^\s+-\s+(.*)$/);
    if (item && key) { (fm[key] ||= []).push(unquote(item[1])); continue; }
    const kv = line.match(/^([A-Za-z_][\w]*):\s*(.*)$/);
    if (!kv) continue;
    key = kv[1];
    fm[key] = kv[2] === '' ? [] : coerce(unquote(kv[2]));
  }
  return [fm, text.slice(m[0].length)];
}
const unquote = s => { const t = s.trim();
  if (/^".*"$/.test(t) || /^'.*'$/.test(t)) { try { return JSON.parse(t.replace(/^'|'$/g, '"')); } catch { return t.slice(1, -1); } }
  return t; };
const coerce = v => /^-?\d+$/.test(v) ? Number(v) : v;

function sections(md) {
  const out = [];
  let cur = { level: 0, title: null, body: [] };
  for (const line of md.split('\n')) {
    const h = line.match(/^(#{2,3})\s+(.*)$/);
    if (h) { out.push(cur); cur = { level: h[1].length, title: h[2].trim(), body: [] }; }
    else cur.body.push(line);
  }
  out.push(cur);
  return out.map(s => ({ ...s, body: s.body.join('\n').trim() }));
}
const codeIn = body => body.match(/```[a-z]*\n([\s\S]*?)```/)?.[1].replace(/\s+$/, '') ?? '';
const stripHeading = body => body.replace(/^#\s+.*$/m, '').trim();

export function parseExercise(file, text) {
  const [fm, md] = frontmatter(text);
  const secs = sections(md);
  const intro = stripHeading(secs[0].body);

  if (fm.type === 'mcq') {
    const optSec = secs.find(s => s.title === 'Options');
    const fbSec = secs.find(s => s.title === 'Feedback');
    const lines = (optSec?.body || '').split('\n').filter(l => /^\d+\.\s/.test(l));
    const options = lines.map(l => l.replace(/^\d+\.\s*/, '').replace(/\s*←\s*correct\s*$/, '').trim());
    const answer = lines.findIndex(l => /←\s*correct\s*$/.test(l));
    const feedback = (fbSec?.body || '').split('\n').filter(l => /^\d+\.\s/.test(l))
      .map(l => l.replace(/^\d+\.\s*/, '').trim());
    return { ...fm, file, prompt: intro, options, answer, feedback };
  }

  const setup = secs.find(s => s.title === 'Setup');
  const steps = [];
  let cur = null;
  for (const s of secs) {
    if (s.level === 2 && (/^Step \d+$/.test(s.title || '') || s.title === 'Instructions')) {
      cur = { instructions: s.body || '', sample: '', solution: '', hint: '' };
      steps.push(cur);
    } else if (cur && s.level === 3) {
      if (s.title === 'Sample') cur.sample = codeIn(s.body);
      else if (s.title === 'Solution') cur.solution = codeIn(s.body);
      else if (s.title === 'Hint') cur.hint = s.body;
    }
  }
  return { ...fm, file, prompt: intro, setup: codeIn(setup?.body || ''), steps };
}

const isDDL = q => /\b(create|drop|alter|insert|update|delete|truncate)\b/i.test(q);

/**
 * Build a content directory. Returns the full model *including* reference solutions
 * so `icecore verify` can test against it; only the stripped form is written to disk.
 */
export async function buildContent({ contentDir, outDir, write = true, log = console.log }) {
  const exDir = path.join(contentDir, 'exercises');
  if (!fs.existsSync(exDir)) throw new Error(`No exercises/ in ${contentDir}`);

  // ---- collect units, grouped by course ----
  const courses = new Map();
  const warnings = [];
  for (const unitId of fs.readdirSync(exDir).filter(d => /^\d/.test(d)).sort()) {
    const dir = path.join(exDir, unitId);
    const metaFile = path.join(dir, '_unit.json');
    if (!fs.existsSync(metaFile)) { warnings.push(`${unitId}: no _unit.json - skipped`); continue; }
    const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));

    const exercises = fs.readdirSync(dir).filter(f => f.endsWith('.md')).sort()
      .map(f => parseExercise(f, fs.readFileSync(path.join(dir, f), 'utf8')));

    for (const e of exercises.filter(e => e.type === 'coding' && !e.steps?.some(s => s.solution)))
      warnings.push(`${unitId}: no solution parsed in ${e.file}`);
    for (const e of exercises.filter(e => e.type === 'mcq' && !(e.answer >= 0)))
      warnings.push(`${unitId}: no correct option in ${e.file}`);

    if (!courses.has(meta.course))
      courses.set(meta.course, { id: meta.course, title: meta.courseTitle, topic: meta.topic, units: [] });
    courses.get(meta.course).units.push({
      unit: meta.unit, title: meta.title, label: `${meta.unit} - ${meta.title}`, exercises,
    });
  }

  // ---- load datasets ----
  const dataDir = path.join(contentDir, 'data');
  const datasets = {};
  for (const f of (fs.existsSync(dataDir) ? fs.readdirSync(dataDir) : []))
    if (f.endsWith('.sql')) datasets[f.replace(/\.sql$/, '')] = fs.readFileSync(path.join(dataDir, f), 'utf8');

  // ---- precompute expected results ----
  const seeded = new Map();
  const template = async name => {
    if (!seeded.has(name)) {
      const db = new PGlite();
      await db.exec(datasets[name]);
      const dump = await db.dumpDataDir();
      await db.close();
      seeded.set(name, dump);
    }
    return seeded.get(name);
  };

  let computed = 0, failed = 0;
  for (const course of courses.values()) {
    for (const u of course.units) {
      for (const ex of u.exercises) {
        if (ex.type !== 'coding' || !ex.dataset) continue;
        if (!datasets[ex.dataset]) { warnings.push(`${u.unit} ${ex.file}: dataset "${ex.dataset}" not extracted yet`); continue; }
        const dump = await template(ex.dataset);
        let shared = null;   // SELECT-only solutions share a database; DDL needs a clean one
        for (const step of ex.steps || []) {
          if (!step.solution) continue;
          const fresh = isDDL(step.solution);
          const db = fresh ? new PGlite({ loadDataDir: dump }) : (shared ||= new PGlite({ loadDataDir: dump }));
          try {
            const res = await db.exec(step.solution);
            const last = res[res.length - 1];
            step.expected = {
              fields: (last?.fields || []).map(f => f.name),
              rows: (last?.rows || []).slice(0, 1000),
              rowCount: last?.rows?.length ?? 0,
              ordered: /\border\s+by\b/i.test(step.solution),
              ddl: fresh,
            };
            computed++;
          } catch (e) {
            warnings.push(`${u.unit} ${ex.file}: solution failed - ${String(e.message).split('\n')[0]}`);
            failed++;
          } finally { if (fresh) await db.close(); }
        }
        await shared?.close();
      }
    }
  }

  // ---- emit ----
  const manifest = [];
  if (write) {
    const contentOut = path.join(outDir, 'content');
    fs.rmSync(contentOut, { recursive: true, force: true });
    fs.mkdirSync(contentOut, { recursive: true });

    for (const course of courses.values()) {
      const dir = path.join(contentOut, course.id);
      fs.mkdirSync(path.join(dir, 'data'), { recursive: true });

      const used = new Set(course.units.flatMap(u => u.exercises.map(e => e.dataset)).filter(Boolean));
      const shipped = [];
      for (const d of used) {
        if (!datasets[d]) continue;
        fs.writeFileSync(path.join(dir, 'data', `${d}.sql`), datasets[d]);
        shipped.push(d);
      }

      // strip reference solutions - grading uses `expected`
      fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify({
        ...course,
        datasets: shipped,
        units: course.units.map(u => ({
          ...u,
          exercises: u.exercises.map(e => e.type !== 'coding' ? e
            : { ...e, steps: e.steps.map(({ solution, ...rest }) => rest) }),
        })),
      }));

      const all = course.units.flatMap(u => u.exercises);
      manifest.push({
        id: course.id, title: course.title, topic: course.topic,
        units: course.units.map(u => ({ unit: u.unit, title: u.title, label: u.label })),
        exercises: all.length,
        coding: all.filter(e => e.type === 'coding').length,
        mcq: all.filter(e => e.type === 'mcq').length,
      });
      log(`  ${course.id}: ${course.units.length} units, ${all.length} exercises, datasets [${shipped.join(', ') || 'none'}]`);
    }
    fs.writeFileSync(path.join(contentOut, 'courses.json'), JSON.stringify(manifest, null, 2));
  }

  for (const w of warnings) log(`  ! ${w}`);
  log(`  precomputed ${computed} expected result sets${failed ? `, ${failed} SOLUTIONS FAILED` : ''}`);

  return { courses: [...courses.values()], datasets, manifest, computed, failed, warnings };
}
