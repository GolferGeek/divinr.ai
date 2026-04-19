# Cron smoke log — testing-team

## Registered triggers

| Job ID      | Cron        | Local time | Purpose |
|-------------|-------------|------------|---------|
| `595decd8`  | `3 6 * * *` | 06:03      | divinr-discover — run Playwright for all 9 facets, file findings |
| `4728f50a`  | `33 6 * * *`| 06:33      | divinr-triage — triage `findings/open/` → `findings/triaged/` |
| `5db31df1`  | `33 7 * * *`| 07:33      | divinr-verify — re-run specs for `findings/needs-verify/` → `findings/closed/` |
| `7e234000`  | `3 8 * * *` | 08:03      | artifact-prune — `apps/e2e/scripts/prune-artifacts.sh`, 7-day rotation |

Minute offsets `:03` and `:33` avoid the `:00`/`:30` cron-jitter bunching advised by the `CronCreate` tool.

## Persistence

All four jobs were registered with `durable: true`, but the tool reports them
as **`[session-only]`** and auto-expires after 7 days. This is a known
limitation of the in-harness scheduler — `durable: true` is accepted but not
honored in the current Claude Code build. Each Claude session re-registration
will be needed weekly until one of the following happens:

1. Harness fixes `durable: true` to actually write
   `.claude/scheduled_tasks.json`.
2. We migrate to systemd timers (the fallback option from Phase 0).

Not blocking Phase 4's end-to-end round-trip smoke — the Phase 4 smoke can
manually fire each trigger via `CronList` / CCR `/schedule` skill.

## Manual fire log

Populated as we run the Phase 4 round-trip smoke (steps 4.22–4.27). Each
entry captures: trigger ID, wall-clock fire time, exit summary.

- **2026-04-19** — manual dry-run of `divinr-discover` (step 4.21).
  Standin agent ran the `--cron` path against the two populated facets
  (predictions, tournaments). Exit summary:
  `passed=2 failed=0 filed=0 duration=2.8s`. No findings were filed (green
  suite is the expected outcome). End-to-end path validated: trigger → agent
  → `pnpm exec playwright test` → parse exit code → no-op on green.

## Added in Phase 7 (2026-04-19)

| Job ID      | Cron         | Local time | Purpose |
|-------------|--------------|------------|---------|
| `ad955b83`  | `35 6 * * *` | 06:35      | divinr-digest — run `apps/e2e/scripts/write-digest.mjs`, commit daily digest |

Same `[session-only]` caveat as the original four — systemd-timer fallback is
the only persistent path until the harness fixes `durable: true`.
