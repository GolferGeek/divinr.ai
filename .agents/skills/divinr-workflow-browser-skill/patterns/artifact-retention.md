# Artifact Retention

Playwright produces traces, screenshots, and a JSON report per run. On the cron cadence (once-per-day), this accumulates quickly. Retention policy bounds disk usage and keeps the finding record self-contained.

## Rotation

- Directory: `apps/e2e/.testing-artifacts/` (gitignored).
- Rotation age: 7 days.
- Executed by: `apps/e2e/scripts/prune-artifacts.sh` (written in Phase 4).
- Cron trigger: registered in Phase 4, fires at 08:00 Spark-local.

The prune script is a one-liner:

```bash
find apps/e2e/.testing-artifacts/ -type f -mtime +7 -delete
```

Idempotent — runs against whatever state it finds.

## First-trace-per-finding copy

When `divinr-test-agent` files a new finding (not a dedup update), it copies the failing trace into `docs/testing/findings/open/<hash>.trace.zip` so the finding self-contains its reproduction trace even after the rotation deletes the original.

## Size cap

Trace copies are capped at 5 MB. If the original trace exceeds 5 MB (long spec, many screenshots), the agent records the `trace-artifact` path in frontmatter without copying, and notes in the body "trace too large for finding, reproduce via verify-command."

## What never rotates

- `docs/testing/findings/` — source-controlled, never auto-deleted.
- `docs/testing/digests/` — weekly digests, source-controlled.
- The copied per-finding trace zips under `docs/testing/findings/open/` — pinned to the finding until the triage agent decides to delete them as part of closure.
