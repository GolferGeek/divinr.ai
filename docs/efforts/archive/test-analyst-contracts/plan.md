# Test: Analyst Contracts & Editor — Implementation Plan

**PRD**: ./intention.md
**Created**: 2026-04-13
**Status**: Complete

## Progress Tracker
- [x] Phase 1: API Verification
- [x] Phase 2: Chrome Testing
- [x] Phase 3: Bug Fixes & Marketing

---

## Phase 1: API Verification
**Status**: Complete
**Note**: All 10 analysts have contracts (2.5-3.7KB each) with 3 versions. API returns full markdown, parsed sections, version history with source/changeReason/createdBy. RBAC blocks beta_reader edits with 403.
**Objective**: Verify analyst contracts, versioning, and RBAC via API.

### Steps
- [x] 1.1 List analysts (`GET /markets/analysts`) → 10 analysts: 5 base (personality), 1 arbitrator, 3 day traders, 1 portfolio manager
- [x] 1.2 Get contract for each analyst → all 10 have contracts with markdown (2.5-3.7KB) and parsed sections (general, roles, adaptations)
- [x] 1.3 Version history → all analysts have 3 versions (v1 bootstrap, v2 AI-scaffolded, v3 Opus 4.6 quality upgrade)
- [x] 1.4 Active version flagged correctly → v3 marked isActive=true
- [x] 1.5 Version metadata → source, changeReason, createdBy, createdAt all populated
- [x] 1.6 RBAC: beta_reader cannot edit contract (`PUT /markets/analysts/:id/contract`) → 403 "Read-only access"

### Quality Gate
- [x] All 10 analysts have well-structured contracts
- [x] Version history with audit trail
- [x] RBAC enforced on writes

---

## Phase 2: Chrome Testing
**Status**: Complete
**Note**: All views verified. Analyst cards show type/weight/scope with CONTRACT and PERFORMANCE buttons. Contract editor shows rendered markdown, version history, side-by-side diff, inline edit mode with save/cancel and change reason. CREATE ANALYST and EDIT/DIFF/ROLLBACK buttons gated with canWrite.
**Objective**: Walk through analyst and contract flows in the browser.

### Steps
- [x] 2.1 Navigate to `/analysts` → 10 analyst cards with type, weight, scope, description, enabled toggle
- [x] 2.2 Each card has CONTRACT and PERFORMANCE buttons
- [x] 2.3 "CREATE ANALYST" button visible for owner, gated with `v-if="canWrite"`
- [x] 2.4 Navigate to contract editor → full markdown rendered with General, Role, Adaptations sections
- [x] 2.5 Version History (3) → v3 ACTIVE (claude-opus-4.6), v2 (AI-scaffolded), v1 (bootstrap)
- [x] 2.6 DIFF button → side-by-side comparison with green highlighted changes, version dropdowns, EXIT DIFF
- [x] 2.7 EDIT button → inline textarea with raw markdown, "Change reason" field, SAVE/CANCEL buttons
- [x] 2.8 ROLLBACK button present (not tested to avoid data change)
- [x] 2.9 EDIT/DIFF/ROLLBACK buttons gated with `v-if="canWrite && !editing && !diffMode"` — correct for beta_reader
- [x] 2.10 Day trader analysts (Gap and Go, Mean Reversion, Momentum Breakout) appear alongside base analysts

### Quality Gate
- [x] All browser scenarios pass
- [x] Contract editor fully functional (view, diff, edit)
- [x] Write controls gated for beta_reader

---

## Phase 3: Bug Fixes & Marketing
**Status**: Complete
**Objective**: Fix any bugs found, write marketing blurb.

### Steps
- [x] 3.1 No bugs discovered — all features working correctly
- [x] 3.2 No code changes needed
- [x] 3.3 Write marketing blurb → saved to `marketing-blurb.md`

### Quality Gate
- [x] **Build**: clean (no code changes)
- [x] **Lint**: clean (no code changes)
- [x] **Marketing blurb written**
