# Dead Table Cleanup — Product Requirements Document

## 1. Overview

Drop two legacy tables — `prediction.analysts` and `prediction.analyst_context_versions` — that have been dead since 2026-03-15. They were superseded by `prediction.market_analysts` and `prediction.analyst_config_versions`. No Divinr code references them. Removing them cleans up the schema and eliminates confusion.

## 2. Goals & Success Criteria

| Goal | Measurable Criterion |
|---|---|
| Both tables dropped | `prediction.analysts` and `prediction.analyst_context_versions` no longer exist in the database after startup |
| No code changes beyond migration | Only the schema service is modified |
| Existing functionality unaffected | All existing tests pass; no runtime errors |

## 3. User Stories / Use Cases

**Developer inspecting the schema:** "I look at the prediction schema and only see active tables. No dead `analysts` table sitting alongside `market_analysts` causing confusion."

## 4. Technical Requirements

### 4.1 Architecture

Add `DROP TABLE IF EXISTS` statements to the DDL block in `markets-schema.service.ts` `ensureSchema()`. The statements run idempotently — safe on databases where the tables already don't exist.

### 4.2 Data Model Changes

**Dropped tables:**
- `prediction.analysts` — legacy analyst definitions, superseded by `prediction.market_analysts`
- `prediction.analyst_context_versions` — legacy context versioning, superseded by `prediction.analyst_config_versions`

No data migration needed — these tables contain no data worth preserving.

### 4.3 API Changes

None.

### 4.4 Frontend Changes

None.

### 4.5 Infrastructure Requirements

None.

## 5. Non-Functional Requirements

- **Safety:** `DROP TABLE IF EXISTS` is idempotent. Runs cleanly whether the tables exist or not.
- **External DB unaffected:** `OrchestratorBaseDataService` reads `prediction.analysts` from the external orchestrator database via `ORCHESTRATOR_DATABASE_URL`. This cleanup only affects Divinr's own database (connected via `DATABASE_URL`).

## 6. Out of Scope

- Changing the external orchestrator database or `OrchestratorBaseDataService`.
- Renaming or restructuring any active tables.
- Any data migration.

## 7. Dependencies & Risks

| Risk | Mitigation |
|---|---|
| Tables might have unexpected foreign key references in the DB | `IF EXISTS` + `CASCADE` ensures the drop succeeds even with orphaned FK constraints |
| External orchestrator DB has its own `prediction.analysts` | Divinr's schema service only runs against `DATABASE_URL`, never `ORCHESTRATOR_DATABASE_URL` |

## 8. Phasing

### Phase 1: Drop tables (single phase)

Add `DROP TABLE IF EXISTS prediction.analysts CASCADE` and `DROP TABLE IF EXISTS prediction.analyst_context_versions CASCADE` to the DDL block in `ensureSchema()`. Verify build, lint, and all existing tests pass.
