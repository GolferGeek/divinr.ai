#!/usr/bin/env node
// check-api-dist-fresh.mjs
// Compares the newest mtime under apps/api/src against the newest mtime
// under apps/api/dist. Exits non-zero if src is newer than dist, with a
// human-readable diagnosis.
//
// Origin: filed during effort/portfolio-foundation-resume Phase 10. The
// §4.9 confused-deputy verification recipe initially returned HTTP 201
// instead of 400 because the running API was serving a stale dist that
// didn't include the Phase 9 header/body slug-parity fix. This script
// catches that class of failure before any verification recipe runs.
//
// Usage:
//   node scripts/check-api-dist-fresh.mjs
//   pnpm --filter @divinr/api preverify   # if wired into package.json

import { readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const SRC = join(ROOT, 'apps/api/src');
const DIST = join(ROOT, 'apps/api/dist');

function newestMtime(dir, exts) {
  let max = 0;
  let maxPath = null;
  function walk(d) {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.turbo') continue;
        walk(full);
      } else if (exts.some((e) => entry.name.endsWith(e))) {
        const m = statSync(full).mtimeMs;
        if (m > max) {
          max = m;
          maxPath = full;
        }
      }
    }
  }
  walk(dir);
  return { mtime: max, path: maxPath };
}

if (!existsSync(SRC)) {
  console.error(`[dist-fresh] FAIL: src dir not found at ${SRC}`);
  process.exit(2);
}
if (!existsSync(DIST)) {
  console.error(`[dist-fresh] FAIL: dist dir not found at ${DIST}`);
  console.error(`[dist-fresh] hint: cd apps/api && pnpm build`);
  process.exit(1);
}

const src = newestMtime(SRC, ['.ts']);
const dist = newestMtime(DIST, ['.js']);

if (src.mtime > dist.mtime) {
  const ageSec = Math.round((src.mtime - dist.mtime) / 1000);
  console.error(`[dist-fresh] FAIL: src is newer than dist by ${ageSec}s`);
  console.error(`  newest src:  ${src.path}`);
  console.error(`  newest dist: ${dist.path}`);
  console.error(`  hint: cd apps/api && pnpm build && restart the api`);
  process.exit(1);
}

const leadSec = Math.round((dist.mtime - src.mtime) / 1000);
console.log(`[dist-fresh] OK — dist is ${leadSec}s newer than src`);
process.exit(0);
