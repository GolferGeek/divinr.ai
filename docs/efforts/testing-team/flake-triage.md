# Flake triage — testing-team Phase 7

Scaffold populated after the 3-day observation window (steps 7.2–7.4).
The cron triggers (`divinr-discover`, `divinr-triage`, `divinr-verify`,
`divinr-digest`) fire starting the morning after merge; each reappearing
finding lands here for categorization.

## Categories

- **Real regression** — hash was `closed`, reappeared in `open`. P0 per
  `docs/testing/findings/README.md` regardless of original severity.
- **Real pre-existing** — never closed; the harness surfaced an issue that
  exists in prod. Stays triaged; fixed by a follow-up effort.
- **Flake** — inconsistent failure with no user-visible bug. Root cause: a
  timing/selector/data-drift issue in the spec itself.

## Findings

| Hash | First-seen (UTC) | Facet | Category | Root cause | Fix | Re-run status |
|------|------------------|-------|----------|------------|-----|---------------|
| _(empty — populated during 7.2–7.4 observation window)_ | | | | | | |

## Known-queued real findings (not flake)

These surfaced during Phase 4/5 harness bring-up and are expected to still be
queued at the start of the observation window — they are **not** flake
candidates.

- `21be5b26` (open) — `instrument.detail` surfaces forbidden vocabulary
  through LLM-authored `prediction.rationale` / `risk.rationale` text. Fix is
  a follow-up effort; keep triaged, not closed.
