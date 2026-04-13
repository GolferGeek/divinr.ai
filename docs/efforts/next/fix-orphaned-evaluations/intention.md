# Effort: Fix Orphaned Evaluation Data

## Problem
The nightly evaluation system created `prediction_horizon_evaluations` rows that reference `instrument_id` and `prediction_id` values not present in the live `instruments` or `market_predictions` tables. This causes:
- Coordination contribution scores to be empty (JOIN to market_predictions fails)
- Audit findings to return empty from the API (same JOIN issue)
- Coverage table needed a lateral JOIN workaround to show instrument symbols

## Intention
Fix the data pipeline so evaluations reference the correct instrument and prediction IDs, or migrate the orphaned data to link to the correct records.

## Scope
- Diagnose how nightly evaluation creates instrument_ids that don't match `prediction.instruments`
- Either fix the evaluation pipeline to use correct IDs, or create a migration to map orphaned IDs to real instruments
- Verify coordination contributions populate after fix
- Verify audit findings return from the API after fix
- Remove the lateral JOIN workaround in coverage query once instruments JOIN works natively

## Out of Scope
- Changing evaluation logic or scoring algorithms
