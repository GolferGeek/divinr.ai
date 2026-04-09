# Effort: Dead Table Cleanup

## Problem

Two legacy tables — `prediction.analysts` and `prediction.analyst_context_versions` — have been dead in Divinr's own database since 2026-03-15, when they were superseded by `prediction.market_analysts` and `prediction.analyst_config_versions`. No Divinr code creates, reads, writes, or references them. They are not in the schema service. They occupy space and create confusion for anyone inspecting the database schema.

Note: `OrchestratorBaseDataService` reads from a `prediction.analysts` table in the **external** orchestrator database (via `ORCHESTRATOR_DATABASE_URL`). That is a different database — this cleanup does not affect it.

## Intention

Drop both dead tables from Divinr's database to clean up the schema.

## Scope

- Add a migration SQL file that runs `DROP TABLE IF EXISTS prediction.analysts` and `DROP TABLE IF EXISTS prediction.analyst_context_versions`.
- Ensure the schema service runs the migration as part of `ensureSchema()`.
- Verify no code references these tables.

## Success Criteria

- Both tables are dropped from the database on next startup.
- No code changes needed beyond the migration.
- Existing functionality is unaffected.

## Out of Scope

- Changing the external orchestrator database or `OrchestratorBaseDataService`.
- Renaming or restructuring any active tables.
- Any data migration — these tables have no data that needs preserving.
