# Effort: Testing Team

## Background

Divinr is a one-developer product with non-trivial surface area — predictions, portfolios, trades, clubs, tournaments, analysts, instruments, messaging, admin. Every shipped effort expands what needs to keep working. The founder is the developer *and* the tester, and is honest that QA is not a strength. As the product gets deeper, the gap between "features built" and "features actively exercised" is widening; regressions are found by beta users (or the founder himself, next morning) rather than by a dedicated testing pass.

The same problem was solved in Orchestrator AI by building a four-layer **testing harness**: skills encode how to exercise each facet of the product in Chrome, agents run the exercises on a daily cron, findings land in a file-based queue, and triage/verify agents push each finding through open → triaged → in-fix → needs-verify → closed. The harness replaced "manual tester the founder would hire" with Claude-agent infrastructure that runs on the same machine the product runs on.

The Orchestrator harness has been running long enough to confirm the pattern works. This effort ports it to Divinr.

## Problem

1. **No standing test coverage.** Regressions are found by luck — beta-user reports or the founder stumbling onto them — not by a system that exercises every surface regularly. As the surface inventory from onboarding-tour-extended makes clear, there are >80 user-visible surfaces; a solo dev cannot hand-walk them.
2. **No finding lifecycle.** When a regression is spotted, it is either fixed immediately or forgotten. There is no queue, no severity triage, no record of what was deferred, no automatic regression-detection when a closed issue reappears.
3. **No coverage-growth discipline.** Every new effort *should* add to the testing-coverage inventory the same way it *should* add to the first-touch content inventory, but without a harness to point at, there is no obvious place for that additive work to land.
4. **Solopreneur economics.** A testing contractor would cost real money and scale poorly. An AI testing team is the right shape: local models, daily cron, no marginal cost per run, infinitely patient, and — importantly — honest about what it did and didn't verify.

## Intention

Port the Orchestrator AI testing harness to Divinr, adapted for Divinr's UI shape (data-viz and read-heavy rather than LangGraph + SSE + HITL) and for the Orchestrator-validated three-layer execution split: Playwright primary, Chrome-MCP exploratory, Jest cron-safe. Ship four layers:

1. **Finding lifecycle** — file-based queue at `docs/testing/findings/` with folders `open/ → triaged/ → in-fix/ → needs-verify/ → closed/`. Each finding is a markdown file with YAML frontmatter. Filename is a deterministic dedup hash so the same issue cannot be re-filed, and a hash appearing in `closed/` then `open/` auto-flags as a P0 regression.
2. **Agents** — one Divinr-specific discover agent (`divinr-test-agent.md`) plus the two product-neutral triage and verify agents copied verbatim from Orchestrator. The discover agent drives the Playwright suite (cron path) and can be invoked interactively against Chrome-MCP for exploratory investigation.
3. **Test harness (three layers)** — ships alongside the skill library:
   - **Playwright** — primary regression harness. Deterministic flow tests for page loads, form submissions, happy paths, filters, drilldowns, chart/table render checks. Runs headless (bundled Chromium via `npx playwright install chromium`) against the Cloudflare-fronted prod URLs (`https://divinr.ai` + `https://api.divinr.ai`). This is the only layer cron can drive — local display is unavailable to scheduled agents.
   - **Chrome-MCP** — exploratory / manual-only. Used interactively by the founder or a spawned agent for ad-hoc investigation, reproducing a user report, or walking a new surface that doesn't yet have Playwright coverage. Never in cron.
   - **Jest / Vitest** — cron-safe unit and API-integration tests (Vitest is already wired in `apps/web` / `apps/api`). The harness treats these as the headless-by-default tier that can always run.
4. **Skill library** — one base Playwright-patterns skill (`divinr-workflow-browser-skill/`), one product index skill, and one deep skill per facet. Each deep skill is six files (SKILL.md, what.md, where.md, expectations.md, tests.md, completeness.md) describing the capability, selectors, assertions, and the concrete Playwright `*.spec.ts` files that exercise it. Chrome-MCP walkthrough patterns live in the same skills as a secondary section for exploratory use.
5. **Daily cron pipeline** — Playwright suite runs at 6:00 AM against prod (divinr.ai / api.divinr.ai), discover agent files findings into `open/`, triage at 6:30 AM, verify at 7:30 AM. The harness produces a daily digest of new findings, in-fix items, and closed-today items.

The goal is that every morning the founder wakes up to either "nothing new, everything verified" or a triaged list of specific things to look at — not the current state of "hope nothing broke overnight."

## Scope

### 1. Finding Lifecycle (shared infrastructure, copy verbatim)

Copy from Orchestrator:

- `docs/testing/findings/` directory with the five-state folder layout
- `docs/testing/findings/TEMPLATE.md`
- Dedup hash algorithm: `sha1("divinr:{file-path}:{test-name}") | head -c 8`
- Filename convention: `{8-char-hash}-divinr-{short-slug}.md`
- Frontmatter fields: severity, capability, surface-key, verify-command, first-seen, last-seen, regression-count

The only change from Orchestrator is the `product` field value (`divinr` instead of `compose`/`forge`).

### 2. Agents

**Copy verbatim (product-neutral):**
- `.claude/agents/test-triage-agent.md` — reads `open/`, dedups, assigns P0–P3 severity, moves to `triaged/` or `in-fix/`. Does not need product knowledge.
- `.claude/agents/test-verify-agent.md` — reads `needs-verify/`, runs the finding's verify-command, closes on pass or re-opens on fail.

**Write new (Divinr-specific):**
- `.claude/agents/divinr-test-agent.md` — the discover agent. Cron-path: runs the Playwright suite for a given facet against the prod URL, parses failures into structured findings, and drops them into `open/`. Interactive-path: when invoked with a Chrome-MCP-available terminal, walks the facet's exploratory patterns for ad-hoc investigation. Cloned from `forge-test-agent.md`, with HITL/SSE/LangGraph patterns removed and Divinr-specific patterns added:
  - Data-view "rendered vs blank/zero" checks
  - Filter/segment control interaction
  - Drill-down navigation (list → detail → back)
  - Chart/equity-curve render presence
  - Empty-state vs populated-state distinction
  - Trade-form submission and confirmation loop (the closest thing Divinr has to Forge's "submit job → await completion")

### 3. Skill Library

**Base skill — `divinr-workflow-browser-skill/`:**
- Playwright project setup: `@playwright/test` in `apps/web` (or a new `apps/e2e` workspace), `playwright.config.ts` pointing at `BASE_URL` (defaults to `https://divinr.ai`; overridable to `http://localhost:7101` for local dev), Chromium-only install for v1
- Target hostnames: `https://divinr.ai` (web), `https://api.divinr.ai` (API, if exposed) — behind Cloudflare on Spark
- Local-dev ports for developer-triggered runs: API 7100, web 7101, Supabase 7010–7016 (see `project_dev_ports` memory)
- Login flow: seeded testing-team user credential handling via env vars (`TEST_USER_EMAIL`, `TEST_USER_PASSWORD`), storage-state reuse across tests for session persistence
- Console/network error capture patterns (`page.on('console')`, `page.on('requestfailed')`) — attached to test reports
- Screenshot + trace capture conventions (trace on first retry, screenshot on failure, output to `test-results/` — gitignored)
- Wait patterns: `expect(locator).toBeVisible()` with bounded timeout rather than raw sleeps — poll for non-empty tables/charts rather than Forge's SSE events
- Common assertions: "no 0.00 where a number is expected," "no empty chart containers," "no unhandled console errors," "no 4xx/5xx on the happy path"
- Chrome-MCP exploratory section: navigation patterns for the founder/agent to drive Chrome-MCP manually against localhost or prod (not cron)

**Product index skill — `divinr-platform-browser-skill/`:**
- Enumerates every deep skill below
- Shared components the deep skills reference (MemberProfileDrawer, ActiveTournamentBanner, disclaimer banner, etc.)
- Top-level routes and nav structure

**Deep skills — one per facet.** v1 ships these (ordered by user-visibility and current beta exposure):

1. `divinr-predictions-browser-skill/` — prediction list, filtering, detail drawer, reasoning panel, trade-CTA flow into tournament trade form
2. `divinr-portfolios-browser-skill/` — my-triples list, add-to-portfolio modal, position rows, portfolio detail, per-triple calibration drill
3. `divinr-tournaments-browser-skill/` — list countdown/player-count/prize cards, detail tabs (INFO/TRADE/LEADERBOARD/MY POSITIONS), trade form (equity vs options disabled state), leaderboard click → MemberProfileDrawer
4. `divinr-clubs-browser-skill/` — discover, create, detail (ACTIVITIES with unread badge, MEMBERS, CHALLENGES, POLLS, JOURNALS, CURRICULUM, ANALYSTS, MENTORING, ANALYTICS, SETTINGS), invite-landing, one-step signup
5. `divinr-analysts-browser-skill/` — roster, detail (track record, contract viewer, affinity, calibration drilldown), coordination correlation matrix
6. `divinr-instruments-browser-skill/` — instrument detail, debate (Blue/Red/Arbiter), variant switcher
7. `divinr-performance-browser-skill/` — equity curve vs SPY, attribution views, leaderboard, author retention
8. `divinr-authoring-browser-skill/` — custom analyst/instrument creation, contract editor sections, BYO LLM credential setup, relationship/source selection
9. `divinr-admin-browser-skill/` — admin-gated surfaces (cost modeling dashboards, LLM usage, day-trader runs, findings inbox, proposals, graduation candidates, contract editor)

Each deep skill is the six-file structure:

| File | Contents |
| --- | --- |
| `SKILL.md` | Index — routes, capability slug, key components, any special patterns |
| `what.md` | Architecture — what the user is supposed to be able to do and why |
| `where.md` | Navigation — exact Playwright locators (preferably role/text-based, selector fallback), form fields, button labels, API endpoints |
| `expectations.md` | Pass/fail criteria, regression checklist, explicit "must render" assertions that map 1:1 to `expect()` calls |
| `tests.md` | Numbered test cases, each with its Playwright `*.spec.ts` filename + trace/screenshot capture points + verify-command snippet |
| `completeness.md` | Known coverage gaps, demo script |

Each deep skill is paired with concrete Playwright spec files co-located under `apps/e2e/tests/<facet>/*.spec.ts` (or equivalent). The `where.md` files are the deepest Divinr-specific work. They require actually exploring the component tree for each facet — an Explore agent pass per facet.

### 4. Daily Cron Pipeline

Three triggers via the `schedule` skill. All run headless against the Cloudflare-fronted prod URLs (`https://divinr.ai` / `https://api.divinr.ai`) — cron cannot access a local Chrome display, so Chrome-MCP is not in the cron path.

- **6:00 AM — `divinr-discover`** — runs the Playwright suite project-by-project (one project per facet) against prod. Parses `test-results/results.json` into structured findings, dedups by hash, drops new ones into `open/`. Facets run sequentially (Ollama is serial per `project_ollama_serial` memory for any LLM-assisted triage side-steps, though Playwright itself is not Ollama-bound, so parallel workers within a single facet are fine up to Playwright's default).
- **6:30 AM — `divinr-triage`** — reads `open/`, dedups, severity-assigns, moves to `triaged/` or `in-fix/`.
- **7:30 AM — `divinr-verify`** — reads `needs-verify/`, runs verify-commands (usually a single `playwright test <spec>` invocation against prod), closes or re-opens.

A daily digest (plain markdown, committed to the repo) summarizes new/triaged/in-fix/closed counts per facet. The founder reads this in the morning.

### 5. Coverage Growth Convention

Analogous to the onboarding-tour-extended "Forever Rule," this effort ships a coverage-growth convention:

- **CLAUDE.md update** — add: *"Every new user-visible surface ships a first-touch content entry AND either extends an existing deep testing skill or stubs a new one. Definition of Done for any effort touching a user-visible view."*
- **build-plan / verify-plan skill update** — when generating or checking a plan, include a "Testing-coverage update" line under Definition of Done for any phase that adds a surface. The verify-plan pass flags as Major if a surface is added without a corresponding skill entry.

The surface inventory in `onboarding-tour-extended/intention.md` §3 is the authoritative coverage checklist at the moment this effort ships; deep skills are written to cover it. Future efforts add to it when they ship new surfaces.

## How Divinr Differs From Forge (adaptations from the reference harness)

- **No SSE / HITL.** Divinr does not have LangGraph jobs with mid-flow review modals. Strip those patterns from the base skill.
- **Data-viz primary.** The dominant failure mode is "data didn't render" or "the number is zero when it shouldn't be," not "the job got stuck." Discover patterns lean hard on rendered-vs-blank assertions.
- **Trade form is the only "submit" flow.** The paper-trade submission is the closest analog to Forge job submission, and deserves its own pattern block rather than being shoehorned into generic form tests.
- **Admin surfaces are many.** Forge had essentially no admin UI. Divinr has a rich admin surface (cost modeling, LLM usage, day-trader runs, findings inbox, proposals, graduation candidates, contract editor). Gets its own deep skill rather than being folded into a user skill.
- **Three-layer execution split (same as Orchestrator landed on).** Playwright is the cron-safe primary regression harness; Chrome-MCP is exploratory / manual-only (remote CCR agents can't access a local display); Jest/Vitest remains the unit and API-integration tier. The cron pipeline only ever exercises layers that can run headless.
- **Cloudflare-fronted prod is the cron target.** Unlike a local-only harness, this one hits `https://divinr.ai` + `https://api.divinr.ai` through Cloudflare. Implications: real TLS, real CDN cache behavior, real Cloudflare Access rules — all of which get tested incidentally. Also means the testing-team user must exist on *prod* Supabase with stable seed state.
- **Ollama is serial.** Any LLM-assisted triage or finding-summarization runs sequentially. Playwright itself is not Ollama-bound and can use its default worker pool within a facet.

## Success Criteria

- `docs/testing/findings/` exists with the five-state folder layout and a passing TEMPLATE.md
- Playwright installed, configured, and runnable headless against `https://divinr.ai` (+ `https://api.divinr.ai` where applicable) via `pnpm e2e` (or equivalent)
- At least one Playwright spec per facet passes green against prod (the "smoke" floor)
- Triage and verify agents installed and functional (copy-verbatim verified)
- `divinr-test-agent.md` installed; cron-path successfully runs the Playwright suite against prod and files findings; interactive-path successfully drives one facet via Chrome-MCP
- Nine deep skills written, each with all six files populated (may be minimal but present) and each paired with at least one real Playwright spec
- Daily cron pipeline active; at least one morning digest committed before this effort closes
- CLAUDE.md + build-plan/verify-plan convention updated
- First real finding filed, triaged, fixed, verified, and closed through the full lifecycle — as the smoke test that the harness actually works end-to-end

## Out of Scope

- **Historical-day replay** — that is `regression-testing-harness` in `future/`, a separate effort about contract-change validation against historical market data. This effort is Playwright UI testing, not replay.
- **Chrome-MCP in cron** — cron agents have no local display. Chrome-MCP is explicitly for interactive / exploratory use only in this effort.
- **Pricing / cost-modeling accuracy validation** — the cost-modeling dashboards are tested for render, not for numerical accuracy against ground truth. Accuracy validation is an analytics effort, not UI testing.
- **Mobile device testing** — v1 is Chromium at Divinr's tested breakpoints (desktop + 390px mobile via Playwright's device emulation). Real-device testing defers.
- **Cross-browser (Firefox, Safari)** — Chromium-only in v1 via Playwright. Enabling Firefox/WebKit is one config line but is deferred.
- **Performance / Lighthouse budgets** — a separate concern; not part of this harness.
- **Security testing (CSP, XSS, auth bypass)** — separate concern, separate skillset.
- **Unit / integration test coverage growth** — the existing Vitest suites are unaffected by this effort. This adds a Playwright end-to-end layer on top, not a replacement for API-level tests.
- **Parallelizing Ollama inference to speed up discovery** — hard constraint per `project_ollama_serial` memory. Does not apply to Playwright's own worker pool, which is non-Ollama.

## Dependencies

- **`onboarding-tour-extended`** (shipped) — the surface inventory in §3 is the coverage checklist. Playwright specs key directly into the finalized inventory. First-touch content describes what "passing" looks like at each surface — seed material for `expectations.md` files.
- **`ui-vocabulary-and-marketing-refresh`** (shipped) — vocab sweep landed, so `where.md` role/text locators can use the current copy without needing rework.
- **Cloudflare-fronted Spark deployment** — `https://divinr.ai` (web) and `https://api.divinr.ai` (API) must be reachable and stable. This is the cron-path target. If Cloudflare Access gates either host, the Playwright runner needs a service-account credential (not a personal login) configured via environment variables.
- **Prod Supabase testing-team user** — a dedicated seeded user with stable data (e.g., a known club membership, a known paper portfolio with positions, a known tournament entry) so Playwright assertions can target concrete rendered content rather than "anything non-empty." Seed via migration; flag with `is_testing = true` so it can be excluded from analytics and cost accounting.
- No local infrastructure dependencies beyond that. Ollama + Chrome are already on Spark; Playwright's Chromium is self-contained via `npx playwright install`.

## Open Questions for PRD Phase

- **Playwright workspace layout** — `apps/web/tests-e2e/` co-located with the web app, a new `apps/e2e/` package, or `tests/e2e/` at the repo root? Leaning new `apps/e2e/` package — independent `playwright.config.ts`, independent CI job, clean deps.
- **Prod seeded testing-team user** — seed via Supabase migration, a one-shot script committed to the repo, or manual setup documented once? Leaning migration: idempotent, reproducible on any env, and the state it creates is part of the spec.
- **Cloudflare Access gating** — is divinr.ai / api.divinr.ai currently behind Cloudflare Access / Zero-Trust, or just Cloudflare's CDN? If gated, Playwright needs a service token via env vars. Confirm before building.
- **Skill location** — Divinr uses `/home/golfergeek/projects/divinr.ai/.claude/skills/` already. Should deep skills live there or in `docs/testing/skills/`? Leaning `.claude/skills/` for consistency with Orchestrator.
- **Finding digest format** — markdown file committed daily, Slack/email, or both? Leaning committed-markdown for now (no external dependencies; grep-able history).
- **Authoring surfaces require paid-tier state** — some flows (BYO LLM, custom analyst creation) assume an account with payment configured. How do we simulate that in test without wiring Stripe? Mock flag on the testing-team user, probably.
- **Branch testing** — cron runs against `main`/prod only in v1. Running Playwright against a branch preview (if we stand one up) is a future add.
- **Cron delivery mechanism** — use the existing `schedule` / cron skill, or a separate systemd unit? Leaning `schedule`: lighter-weight, already in use.
- **Trace / screenshot artifact storage** — Playwright traces are heavy; write to a local `.testing-artifacts/` directory with a retention policy (e.g., 7 days) and reference the path from the finding file, rather than committing binaries. Exception: the first trace for each new finding gets uploaded to somewhere durable (GitHub release asset, S3, or similar) for long-tail triage — decide during PRD.
- **Playwright CCR environment** — confirm `npx playwright install chromium` works inside the CCR cron environment on Spark without extra system deps. If not, stand up a Docker image pre-baked with Chromium + Playwright, mirror the Orchestrator `testing-browser-smoke` pattern.

## Adjacent Efforts

- **`regression-testing-harness`** (in `future/`) — historical-day replay. Unrelated in mechanism but complementary in intent. Both are "ops & validation" layer; both raise the founder's ability to ship safely alone.
- **`onboarding-tour-extended`** (current) — the surface inventory is shared. See Dependencies above.
- **Orchestrator AI testing harness** — the reference implementation. Layer 1 (finding lifecycle) and the triage/verify agents copy verbatim; everything else is a Divinr-specific rewrite.

---

*Drafted 2026-04-19 after porting discussion with Orchestrator AI. The harness pattern is validated in Orchestrator; this effort is about adaptation, not invention. Updated 2026-04-19 to commit to the Playwright-primary / Chrome-MCP-exploratory / Jest-cron-safe three-layer split that Orchestrator landed on, targeting the Cloudflare-fronted prod deployment at divinr.ai / api.divinr.ai.*
