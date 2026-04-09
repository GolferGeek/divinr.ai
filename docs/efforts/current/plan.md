# Dead Table Cleanup — Implementation Plan

**PRD**: prd.md
**Created**: 2026-04-09
**Status**: Complete

## Progress Tracker

- [x] Phase 1: Drop dead tables

---

## Phase 1: Drop dead tables
**Status**: Not Started
**Objective**: Add `DROP TABLE IF EXISTS CASCADE` for `prediction.analysts` and `prediction.analyst_context_versions` to the schema service DDL.

### Steps
- [ ] 1.1 In `apps/api/src/markets/schema/markets-schema.service.ts`, add `DROP TABLE IF EXISTS prediction.analysts CASCADE;` and `DROP TABLE IF EXISTS prediction.analyst_context_versions CASCADE;` at the top of the DDL block in `ensureSchema()`, before the `CREATE TABLE` statements.
- [ ] 1.2 Do a final grep of the codebase to confirm no Divinr code references these table names (excluding the new DROP statements and docs).

### Quality Gate

- [ ] **Build**: `cd apps/api && pnpm build` — no errors
- [ ] **Lint**: `cd apps/api && pnpm lint` — no errors
- [ ] **Unit Tests**: `cd apps/api && npx tsx tests/unit/debate-reasoning.test.ts && npx tsx tests/unit/contract-editor.test.ts && npx tsx tests/unit/leaderboard-service.test.ts` — all pass
- [ ] **Web Build**: `cd apps/web && pnpm build` — no errors (no web changes, but confirms no breakage)
- [ ] **Phase Review**:
  - [ ] Both DROP TABLE statements present in DDL with IF EXISTS and CASCADE
  - [ ] No code references to `prediction.analysts` or `prediction.analyst_context_versions` remain (outside orchestrator base data service which uses external DB)
  - [ ] Only the schema service was modified — no other code changes

---
