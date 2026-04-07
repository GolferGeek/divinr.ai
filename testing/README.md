# Testing

Cross-cutting test artifacts. Subdirectories:

| Dir | Purpose | Status |
|---|---|---|
| `ui/` | Manual Chrome test plans driven by Claude via the `mcp__claude-in-chrome` tools. The plan is the source of truth; Claude executes it and reports findings. | **Populated** — see `ui/manual-test-plan.md` |
| `unit/` | Future home for consolidated unit tests. | Stub — current unit tests live at `apps/api/tests/unit/*.test.ts`. Consolidation deferred. |
| `e2e/` | Future home for end-to-end / integration tests. | Stub — current integration tests live at `apps/api/tests/markets/` and `apps/api/tests/compliance/`. Consolidation deferred. |
| `curl/` | Future home for curl-driven API smoke tests, organized as runnable shell scripts. | Stub — current curl tests live inline in effort plans (`docs/efforts/**/plan.md`). Consolidation deferred. |

## Why this exists

As the app grew (Phases 1–6 of analyst-intelligence-platform, portfolio-foundation Phase 1, agent-autotrading), tests landed wherever was convenient at the time. This directory is the long-term home; consolidation will happen as a separate effort.

## Hierarchical UI testing concept

Claude can drive Chrome via the `mcp__claude-in-chrome__*` tools. There's no Playwright / Cypress / Puppeteer dependency — `ui/manual-test-plan.md` is just a structured markdown doc that Claude follows top-down. Three tiers:

1. **Smoke** — every top-level route loads, no console errors. Fast, runs whenever you ask.
2. **Per-screen** — for each screen, primary elements render and primary interactions work.
3. **Edge** — error states, edge cases, harder user journeys.

Run order: smoke → per-screen → edge. Stop at the first tier that fails and report findings before continuing.
