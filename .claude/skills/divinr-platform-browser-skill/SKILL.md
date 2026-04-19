---
name: divinr-platform-browser-skill
description: Index of all Divinr deep browser skills. Load this before picking a facet to exercise.
allowed-tools: Read Glob
---

# Divinr Platform Browser Skill (Index)

This is the product-index skill: a single place to look up which deep skill covers which facet, which shared components show up across multiple facets, and where the underlying routes live.

Load `divinr-workflow-browser-skill` for the shared Playwright / Chrome-MCP patterns before opening any of the deep skills below.

## Deep skills

| Slug | Path | What it covers |
|---|---|---|
| `predictions` | `.claude/skills/divinr-predictions-browser-skill/` | Analyses list, role filter, detail drawer, trade-CTA hand-off |
| `portfolios` | `.claude/skills/divinr-portfolios-browser-skill/` | Portfolio dashboard, equity curve, positions, P&L |
| `tournaments` | `.claude/skills/divinr-tournaments-browser-skill/` | Tournaments list, detail tabs (INFO/TRADE/LEADERBOARD/MY POSITIONS), trade form, leaderboard |
| `clubs` | `.claude/skills/divinr-clubs-browser-skill/` | Clubs list, detail, rankings, compare, curriculum |
| `analysts` | `.claude/skills/divinr-analysts-browser-skill/` | Analysts list, performance, contract editor |
| `instruments` | `.claude/skills/divinr-instruments-browser-skill/` | Instruments list, detail, contract editor |
| `performance` | `.claude/skills/divinr-performance-browser-skill/` | Performance dashboard (cross-facet aggregates) |
| `authoring` | `.claude/skills/divinr-authoring-browser-skill/` | Authored content (analysts/instruments/wiring/llm credentials/billing) |
| `admin` | `.claude/skills/divinr-admin-browser-skill/` | Admin surfaces: attribution, cost calibration/defensibility/experiments, graduation candidates |

## Shared components (verified against `apps/web/src/components/`)

- `AvatarStack.vue` — player avatars on tournament cards (predictions/tournaments/clubs surfaces)
- `FirstTouchPanel.vue` — onboarding overlay on every view under `/` (auth guard wraps this)
- `LegalDisclaimer.vue` — legal copy on every user-visible analysis/trade/tournament surface
- `EquityCurveChart.vue` — portfolio/tournament performance charts (portfolios, tournaments, performance)
- `CalibrationChart.vue` — analyst/model calibration (analysts, performance)
- `MemberProfileDrawer.vue` — opens from tournament leaderboards, club rosters, analyst followers

## Routes, grouped by facet

### Predictions
- `/predictions`

### Portfolios
- `/portfolios` (canonical), `/portfolio` → redirect

### Tournaments
- `/tournaments`, `/tournaments/create`, `/tournaments/history`
- `/tournaments/:id`, `/tournaments/:id/results`
- `/tournaments/invite/:token`

### Clubs
- `/clubs`, `/clubs/create`, `/clubs/rankings`, `/clubs/compare`
- `/clubs/:id`, `/clubs/:id/:tab` (members/tournaments/analysts/activities/analytics/curriculum/mentoring)
- `/clubs/invite/:token`
- `/clubs/:clubId/curricula/*`, `/clubs/:clubId/mentoring/dashboard`

### Analysts
- `/analysts`, `/analysts/:id/performance`, `/analysts/:id/contract`

### Instruments
- `/instruments`, `/instruments/:id`, `/instruments/:id/contract`
- `/attribution/instrument/:id`

### Performance
- `/performance`, `/domain/:domain`

### Authoring
- `/settings/authored-content`, `/settings/onboarding`
- `/billing/summary`, `/usage`

### Admin
- `/admin/cost/calibration`, `/admin/cost/defensibility`
- `/admin/cost/experiments`, `/admin/cost/experiments/:id`
- `/admin/attribution`, `/admin/attribution/sources`, `/admin/attribution/graduation-candidates`
- `/attribution/mine`, `/findings`, `/risk`

## How to use

1. Read this file to pick which deep skill matches the facet you're exercising.
2. Load `divinr-workflow-browser-skill` first for shared patterns.
3. Open the matching `divinr-<facet>-browser-skill/` folder; each deep skill is six files (`SKILL.md`, `what.md`, `where.md`, `expectations.md`, `tests.md`, `completeness.md`).
4. Run specs per facet via `pnpm e2e --project=<slug>`.
