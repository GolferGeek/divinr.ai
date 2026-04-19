#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), '..', '..', '..');
const FINDINGS_DIR = path.join(REPO_ROOT, 'docs', 'testing', 'findings');
const DIGESTS_DIR = path.join(REPO_ROOT, 'docs', 'testing', 'digests');

const STATES = ['open', 'triaged', 'in-fix', 'needs-verify', 'closed'];
const FACETS = [
  'predictions', 'tournaments', 'portfolios', 'clubs', 'analysts',
  'instruments', 'performance', 'authoring', 'admin',
];

function today() {
  return new Date().toISOString().slice(0, 10);
}

async function safeReaddir(dir) {
  try {
    return await fs.readdir(dir);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

function parseFrontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const out = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([\w-]+):\s*(.*)$/);
    if (kv) out[kv[1]] = kv[2].trim().replace(/^['"]|['"]$/g, '');
  }
  return out;
}

async function collectFindings(state) {
  const dir = path.join(FINDINGS_DIR, state);
  const entries = await safeReaddir(dir);
  const out = [];
  for (const name of entries) {
    if (!name.endsWith('.md')) continue;
    const full = path.join(dir, name);
    const text = await fs.readFile(full, 'utf8');
    const fm = parseFrontmatter(text);
    const titleMatch = text.match(/^#\s+(.+)$/m);
    const fallbackTitle = name.replace(/^[0-9a-f]{8}-divinr-/, '').replace(/\.md$/, '').replace(/-/g, ' ');
    out.push({
      file: path.relative(REPO_ROOT, full),
      name,
      hash: name.slice(0, 8),
      facet: fm.capability || 'unknown',
      severity: fm.severity || '',
      title: titleMatch ? titleMatch[1].trim() : fallbackTitle,
      lastSeen: fm['last-seen'] || '',
    });
  }
  return out;
}

function facetCounts(findings) {
  const counts = Object.fromEntries(FACETS.map((f) => [f, 0]));
  counts.unknown = 0;
  for (const f of findings) {
    counts[f.facet] = (counts[f.facet] ?? 0) + 1;
  }
  return counts;
}

function tableRow(label, perState) {
  const cells = STATES.slice(0, 4).map((s) => perState[s] ?? 0);
  const closedToday = perState.closedToday ?? 0;
  return `| ${label} | ${cells[0]} | ${cells[1]} | ${cells[2]} | ${closedToday} |`;
}

async function main() {
  const date = today();
  const byState = {};
  for (const s of STATES) byState[s] = await collectFindings(s);

  const closedToday = byState.closed.filter((f) => f.lastSeen.startsWith(date));

  const facetBreakdown = FACETS.map((facet) => {
    const row = { facet };
    for (const s of STATES) {
      row[s] = byState[s].filter((f) => f.facet === facet).length;
    }
    row.closedToday = closedToday.filter((f) => f.facet === facet).length;
    return row;
  });

  const lines = [];
  lines.push(`# Testing Digest — ${date}`);
  lines.push('');
  lines.push('## Counts');
  lines.push(`- New (open/): ${byState.open.length}`);
  lines.push(`- Triaged (triaged/): ${byState.triaged.length}`);
  lines.push(`- In-fix (in-fix/): ${byState['in-fix'].length}`);
  lines.push(`- Needs-verify (needs-verify/): ${byState['needs-verify'].length}`);
  lines.push(`- Closed today (closed/ with last-seen=${date}): ${closedToday.length}`);
  lines.push('');
  lines.push('## Per-facet breakdown');
  lines.push('| Facet | New | Triaged | In-fix | Closed today |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const row of facetBreakdown) {
    lines.push(`| ${row.facet} | ${row.open} | ${row.triaged} | ${row['in-fix']} | ${row.closedToday} |`);
  }
  lines.push('');
  lines.push('## New findings');
  if (byState.open.length === 0) lines.push('- _(none)_');
  for (const f of byState.open) {
    lines.push(`- [${f.hash}](${f.file}) — ${f.title} — ${f.severity || 'n/a'}`);
  }
  lines.push('');
  lines.push('## In-fix');
  if (byState['in-fix'].length === 0) lines.push('- _(none)_');
  for (const f of byState['in-fix']) {
    lines.push(`- [${f.hash}](${f.file}) — ${f.title}`);
  }
  lines.push('');
  lines.push('## Closed today');
  if (closedToday.length === 0) lines.push('- _(none)_');
  for (const f of closedToday) {
    lines.push(`- [${f.hash}](${f.file}) — ${f.title}`);
  }
  lines.push('');

  await fs.mkdir(DIGESTS_DIR, { recursive: true });
  const outPath = path.join(DIGESTS_DIR, `${date}.md`);
  await fs.writeFile(outPath, lines.join('\n'), 'utf8');
  console.log(`Wrote ${path.relative(REPO_ROOT, outPath)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
