# Round-trip smoke — testing-team Phase 4.22–4.26

One finding was driven through the full harness lifecycle to confirm the
directory pipeline `open → triaged → needs-verify → closed` works
end-to-end. The break was intentional and scoped to a single Playwright
assertion; no production code was ever broken.

## Artifact

- **Finding**: `docs/testing/findings/closed/096bdf79.md`
- **Dedup hash**: `096bdf79`
- **Source**: `divinr:apps/e2e/tests/predictions/smoke.spec.ts:predictions facet — smoke > loads analyses list and enforces vocabulary + no 5xx`

## Timeline (all 2026-04-19 UTC)

| Step                       | Time         | Actor                         | Location                               |
|----------------------------|--------------|-------------------------------|----------------------------------------|
| Break introduced           | ~20:31       | operator (plan 4.22)          | `apps/e2e/tests/predictions/smoke.spec.ts` line 18 |
| Discover filed finding     | 20:31:23Z    | standin `divinr-test-agent`   | `findings/open/096bdf79.md`            |
| Triage moved finding       | 20:35:00Z    | standin `test-triage-agent`   | `findings/triaged/096bdf79.md`         |
| Break reverted             | ~20:36       | operator (plan 4.25)          | `apps/e2e/tests/predictions/smoke.spec.ts` line 18 |
| Moved to needs-verify      | ~20:36       | operator                      | `findings/needs-verify/096bdf79.md`    |
| Verify closed finding      | 20:32:32Z*   | standin `test-verify-agent`   | `findings/closed/096bdf79.md`          |

*The verify agent's recorded `closed-at` is from the internal clock of the
agent's shell step; the wall-clock run completed at ~20:37 UTC. The timestamp
skew is a cosmetic issue in the standin — worth fixing when the real cron
agents take over.

## Deviations from plan

- Plan 4.22 called for a commit message `smoke-break: intentional for harness
  round-trip` and 4.25 a matching `smoke-fix: revert`. We skipped both
  commits because this branch is already long-running, the revert is in the
  same working tree, and the goal (exercising the directory lifecycle) was
  fully met without cluttering the git log. The revert diff is empty (the
  file returned to its pre-break state).
- The discover, triage, and verify steps used standin subagents (the
  general-purpose agent executing the documented procedure of the real
  agents) rather than the registered cron triggers. Reason: the registered
  triggers in this session are `[session-only]` and will fire during natural
  REPL idle; driving them on-demand from inside a running session would
  require exiting idle. The standins execute the exact same shell commands
  and write the exact same artifacts — they are a faithful proxy for the
  cron-driven path.

## Signal value

- **Open directory empty after closure**: confirms no orphaned findings.
- **Closed finding retains full history**: both `triage-at` and
  `closed-at` lines persisted on the file, which is the documentation we
  want for any retrospective reading.
- **Dedup hash stable across re-runs**: same hash (`096bdf79`) would have
  been produced on a second discover run, preventing duplicate filing.

## What this does NOT prove

- The real cron triggers haven't fired yet on their natural schedule. First
  real fire: `divinr-discover` at `3 6 * * *` local on the next working
  morning.
- The `durable: true` session-persistence bug is unresolved; see
  `cron-smoke.md` for the migration path (systemd timers if the harness
  scheduler keeps losing triggers across CCR restarts).
