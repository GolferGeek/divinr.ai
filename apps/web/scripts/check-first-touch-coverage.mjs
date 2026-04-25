#!/usr/bin/env node
/**
 * First-touch inventory coverage check.
 *
 * Source of truth for the 105 keys is PRD Appendix A —
 * docs/efforts/current/onboarding-tour-extended/prd.md (look for
 * "Appendix A — Canonical Surface Inventory"). That list is reproduced
 * verbatim below so this script runs standalone.
 *
 * Fails if:
 *   1. Any Appendix A key is missing from surface-content.ts.
 *   2. Any Appendix A key is neither wired (via useFirstTouch or
 *      <FirstTouchPanel surface-key="…">) NOR documented in
 *      apps/web/src/onboarding/pending-surfaces.md.
 *   3. A key is wired but not in Appendix A (typo catcher).
 *   4. A key appears in both the wired set and pending-surfaces.md (inconsistent).
 */

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const webRoot = path.resolve(__dirname, '..');
const srcRoot = path.join(webRoot, 'src');

// PRD Appendix A — the 105 canonical surface keys. Keep in sync with
// docs/efforts/current/onboarding-tour-extended/prd.md §Appendix A.
const APPENDIX_A = [
  // Top-level sections (11)
  'dashboard', 'predictions', 'instruments', 'portfolios', 'performance',
  'analysts', 'clubs', 'tournaments', 'messages', 'notifications', 'settings',
  // Predictions & trade path (5)
  'prediction.card', 'prediction.detail', 'prediction.trade-cta', 'prediction.sources',
  'tournament.picker',
  // Instrument surfaces (4)
  'instrument.detail', 'instrument.debate', 'instrument.variant-switcher',
  'instrument.article-relevance',
  // Analyst surfaces (4)
  'analyst.detail', 'analyst.contract-viewer', 'analyst.calibration-drilldown', 'analyst.affinity',
  // Portfolio (4)
  'portfolio.my-triples', 'portfolio.add-triple', 'portfolio.position-row', 'portfolio.detail',
  // Performance (4)
  'performance.equity-curve', 'performance.attribution', 'performance.author-retention', 'performance.leaderboard',
  // Clubs (8)
  'club.discover', 'club.create', 'club.detail', 'club.activities',
  'club.mentoring', 'club.curriculum', 'club.analysts', 'club.opt-outs',
  // Tournaments (6)
  'tournament.list', 'tournament.detail.info', 'tournament.detail.trade',
  'tournament.detail.leaderboard', 'tournament.detail.my-positions', 'tournament.avatar-stack',
  // Messaging (3)
  'messages.dm', 'messages.channel', 'messages.direct-message-intent',
  // Authoring (12)
  'authoring.custom-analyst.create', 'authoring.custom-analyst.editor',
  'authoring.custom-instrument.create', 'authoring.custom-instrument.editor',
  'authoring.contract-section.predictor-generation',
  'authoring.contract-section.risk-assessment',
  'authoring.contract-section.prediction-generation',
  'authoring.contract-section.learning',
  'authoring.contract-section.adaptations',
  'authoring.byo-llm', 'authoring.relationship-selection', 'authoring.source-selection',
  // Authored content (2)
  'authored.overview', 'authored.attribution.mine',
  // Risk & sentiment (2)
  'risk-dashboard', 'fear-greed-alerts',
  // Coordination (1)
  'analyst.coordination',
  // Sources (2)
  'sources', 'source.quality',
  // Per-instrument attribution (1)
  'instrument.attribution',
  // Curriculum & learning (4)
  'learning-dashboard', 'curriculum.dashboard', 'curriculum.create', 'curriculum.detail',
  // Mentor (1)
  'mentor.dashboard',
  // Tournaments extra (3)
  'tournament.create', 'tournament.history', 'tournament.invite-landing',
  // Clubs extra (4)
  'club.compare', 'club.rankings', 'club.invite-landing', 'club.join-signup',
  // Auth & onboarding (2)
  'auth.invite-signup', 'welcome-modal',
  // Cost & billing (7)
  'billing.summary', 'billing.compute-breakdown', 'billing.student-accrual',
  'billing.trial-countdown', 'billing.read-only-banner', 'billing.bill-overview',
  'pricing.overview',
  // Admin (17)
  'admin.cost-modeling.calibration', 'admin.cost-modeling.defensibility',
  'admin.cost-modeling.experiments', 'admin.llm-usage', 'admin.day-trader-runs',
  'admin.findings-inbox', 'admin.evaluations', 'admin.runs.list', 'admin.runs.detail',
  'admin.canonical-day', 'admin.proposals', 'admin.graduation-candidates',
  'admin.contract-editor', 'admin.notification-debug', 'admin.attribution',
  'admin.domain-dashboard', 'admin.user-billing',
  'admin.billing-webhook-health',
  // Settings (6)
  'settings.onboarding', 'settings.opt-outs', 'settings.social-opt-outs',
  'settings.byo-credentials', 'settings.profile', 'settings.terms',
];

if (APPENDIX_A.length !== 114) {
  console.error(`Appendix A baseline is malformed: expected 114, got ${APPENDIX_A.length}`);
  process.exit(2);
}
const inventory = new Set(APPENDIX_A);
if (inventory.size !== APPENDIX_A.length) {
  console.error('Appendix A contains duplicates');
  process.exit(2);
}

// 1. Parse surface-content.ts keys.
const surfaceContentPath = path.join(srcRoot, 'onboarding/surface-content.ts');
const surfaceSrc = fs.readFileSync(surfaceContentPath, 'utf8');
const contentKeys = new Set();
const keyRe = /^\s*'?([a-z0-9][a-z0-9.\-]*)'?\s*:\s*\{\s*$/gm;
for (const m of surfaceSrc.matchAll(keyRe)) {
  contentKeys.add(m[1]);
}

// 2. Grep-scan views & components for wiring references.
const wiredKeys = new Set();
function scanDir(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      scanDir(full);
    } else if (entry.isFile() && (full.endsWith('.vue') || full.endsWith('.ts'))) {
      const txt = fs.readFileSync(full, 'utf8');
      for (const m of txt.matchAll(/surface-key\s*=\s*"([^"]+)"/g)) wiredKeys.add(m[1]);
      for (const m of txt.matchAll(/useFirstTouch\(\s*['"]([^'"]+)['"]/g)) wiredKeys.add(m[1]);
    }
  }
}
scanDir(path.join(srcRoot, 'views'));
scanDir(path.join(srcRoot, 'components'));

// 3. Parse pending-surfaces.md for deferred keys.
const pendingPath = path.join(srcRoot, 'onboarding/pending-surfaces.md');
const pendingSrc = fs.readFileSync(pendingPath, 'utf8');
const pendingKeys = new Set();
for (const m of pendingSrc.matchAll(/^- `([a-z0-9][a-z0-9.\-]*)`/gm)) {
  pendingKeys.add(m[1]);
}

const errors = [];

// Check 1: every inventory key has content.
const missingContent = [...inventory].filter(k => !contentKeys.has(k));
if (missingContent.length) {
  errors.push(`Missing from surface-content.ts (${missingContent.length}):\n  ${missingContent.join('\n  ')}`);
}

// Check 2: every inventory key is either wired or documented as pending.
const orphaned = [...inventory].filter(k => !wiredKeys.has(k) && !pendingKeys.has(k));
if (orphaned.length) {
  errors.push(
    `Appendix A keys that are neither wired nor listed in pending-surfaces.md (${orphaned.length}):\n  ${orphaned.join('\n  ')}`,
  );
}

// Check 3: wired keys that aren't in Appendix A (typo catcher).
const bogus = [...wiredKeys].filter(k => !inventory.has(k));
if (bogus.length) {
  errors.push(
    `Wired surface keys not present in Appendix A (${bogus.length}) — likely typo or stale inventory:\n  ${bogus.join('\n  ')}`,
  );
}

// Check 4: keys both wired and documented pending (inconsistent).
const conflicts = [...wiredKeys].filter(k => pendingKeys.has(k));
if (conflicts.length) {
  errors.push(
    `Keys that are wired AND listed in pending-surfaces.md (${conflicts.length}) — remove from pending:\n  ${conflicts.join('\n  ')}`,
  );
}

const total = inventory.size;
const wiredCount = [...wiredKeys].filter(k => inventory.has(k)).length;
const pendingCount = [...pendingKeys].filter(k => inventory.has(k)).length;

console.log(`First-touch coverage: ${wiredCount} wired + ${pendingCount} pending = ${wiredCount + pendingCount} / ${total}`);

if (errors.length) {
  console.error('\nFAIL:');
  for (const e of errors) console.error('\n' + e);
  process.exit(1);
}

console.log('OK: every Appendix A key has content and is either wired or marked pending.');
