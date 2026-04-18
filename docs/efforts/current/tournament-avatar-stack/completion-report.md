# Tournament Avatar Stack — Completion Report

**Plan**: ./plan.md
**PRD**: ./prd.md
**Completed**: 2026-04-18
**Final Status**: Implementation Complete — chrome-gate verification deferred to PR review

## Summary
- Total phases: 3
- Phases completed: 3 (code + unit-level gates)
- Phases with deferred items: 2 + 3 (chrome + curl gates deferred to fresh-context PR review)

## Phase Results

### Phase 1 — API: extend `listTournaments` payload
- **Status**: Complete
- **Changes**:
  - `apps/api/src/tournaments/tournament.types.ts` — added optional `entrants_preview?` + `entrants_overflow?` to `Tournament` (mirrors `player_count?` convention).
  - `apps/api/src/tournaments/tournament.service.ts` — `listTournaments()` extended with `LEFT JOIN LATERAL` returning up to 3 entrants by `joined_at ASC` as jsonb-agg; post-query mapping coerces `entrants_preview` to `[]` on null and computes `entrants_overflow = max(0, player_count - preview.length)`.
  - `apps/api/tests/unit/tournaments-list-entrants-preview.test.ts` — new test (18 assertions) covering single-SQL invariant, LATERAL shape, overflow math for `player_count` = 0/2/7, and preview entry key-shape.
  - `apps/api/package.json` — new test added to `test:unit` chain.
- **Deviations**: `entrants_preview` / `entrants_overflow` are optional on the interface (matching `player_count?`). Runtime contract unchanged.

### Phase 2 — Web: `AvatarStack` component + card integration
- **Status**: Complete
- **Changes**:
  - `apps/web/src/stores/tournament.store.ts` — `Tournament` DTO extended to match API mirror; added mirror-reference comment.
  - `apps/api/src/tournaments/tournament.types.ts` — reciprocal cross-reference comment.
  - `apps/web/src/components/AvatarStack.vue` — new reusable component: up to 3 initials circles (deterministic HSL-hue by `user_id`) + overflow chip (`aria-label="+K more players"`); renders nothing when empty.
  - `apps/web/src/views/TournamentsView.vue` — imports `AvatarStack`, renders it before the roster text; `.roster-line`/`.roster-text` updated with `min-width: 0` + ellipsis to protect the stack on narrow viewports.
- **Deviations**: None in implementation. Chrome gate deferred.

### Phase 3 — Responsive polish & regression check
- **Status**: Code complete — live chrome verification deferred
- **Changes**: JSDoc added on `AvatarStack.vue`; preventive CSS guards in place (`flex-shrink: 0`, `min-width: 0`, ellipsis text).
- **Deviations**: Responsive sweep at 375/768/1280 and Network-panel round-trip check deferred to fresh-context PR review, per project feedback memory ("UI tests should run in a fresh context, not bolted onto long backend sessions").

## Gate Results

| Gate | Result |
|---|---|
| API lint | ✅ clean |
| API build | ✅ clean |
| API typecheck | ✅ clean |
| API unit tests (full suite, ~110 files) | ✅ all green, including new `tournaments-list-entrants-preview.test.ts` (18/18) |
| Markets smoke | ✅ passed in isolation (7/7 cases; initial concurrent run hit a DDL deadlock vs. the unit suite — orthogonal to changes) |
| Web lint | ✅ clean |
| Web build | ✅ clean |
| Web typecheck | ⚠️ pre-existing baseline errors unchanged — no new errors introduced; `AvatarStack.vue` type-clean |
| Curl checks | ⏳ deferred — running API is pre-edit, no bearer token in session |
| Chrome checks | ⏳ deferred to fresh-context PR review |

## Deviations from PRD

1. **Typed fields optional vs. required.** `entrants_preview?` and `entrants_overflow?` are optional on the `Tournament` TypeScript interface to match the existing `player_count?` convention and to avoid forcing type-cast churn on the four `Tournament`-returning methods that don't populate them. Runtime contract unchanged: `listTournaments` always emits both fields. Unit-tested.

2. **Curl + chrome gates deferred to PR review.** Explained at length in `plan.md` Deviation Notes. The functional coverage the curls would provide is captured in the new unit test. The chrome verification belongs in a fresh session per user convention.

3. **Web typecheck baseline.** The repo has ~20 pre-existing type errors on main (DOM lib config + Pinia store typing + Ionic segment event types). My edits introduce zero new errors. Verified by stashing and re-running typecheck on clean main.

## Next Steps

- **User runs `/pr-eval`** to execute the deferred chrome verification and architectural review in a fresh session.
- **PR author restarts the API dev server** (or starts a fresh one) so `dist/` reflects the new SQL before any live payload inspection.
- **After chrome-gate passes**, merge the PR. No follow-up code work identified.
