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

Port the Orchestrator AI testing harness to Divinr, adapted for Divinr's UI shape (data-viz and read-heavy rather than LangGraph + SSE + HITL). Ship four layers:

1. **Finding lifecycle** — file-based queue at `docs/testing/findings/` with folders `open/ → triaged/ → in-fix/ → needs-verify/ → closed/`. Each finding is a markdown file with YAML frontmatter. Filename is a deterministic dedup hash so the same issue cannot be re-filed, and a hash appearing in `closed/` then `open/` auto-flags as a P0 regression.
2. **Agents** — one Divinr-specific discover agent (`divinr-test-agent.md`) plus the two product-neutral triage and verify agents copied verbatim from Orchestrator.
3. **Skill library** — one base Chrome-patterns skill (`divinr-workflow-browser-skill/`), one product index skill, and one deep skill per facet. Each deep skill is six files (SKILL.md, what.md, where.md, expectations.md, tests.md, completeness.md) describing how to exercise that facet in a real browser session.
4. **Daily cron pipeline** — discover agents run at 6:00 AM, triage at 6:30 AM, verify at 7:30 AM. The harness produces a daily digest of new findings, in-fix items, and closed-today items.

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
- `.claude/agents/divinr-test-agent.md` — the discover agent. Walks a provided skill (e.g. portfolios, predictions, trades, clubs, tournaments), opens Chrome, exercises the documented flows, drops findings into `open/`. Cloned from `forge-test-agent.md`, with HITL/SSE/LangGraph patterns removed and Divinr-specific patterns added:
  - Data-view "rendered vs blank/zero" checks
  - Filter/segment control interaction
  - Drill-down navigation (list → detail → back)
  - Chart/equity-curve render presence
  - Empty-state vs populated-state distinction
  - Trade-form submission and confirmation loop (the closest thing Divinr has to Forge's "submit job → await completion")

### 3. Skill Library

**Base skill — `divinr-workflow-browser-skill/`:**
- Chrome pre-flight: API on 7100, web on 7101, Supabase on 7010–7016 (see `project_dev_ports` memory)
- Login flow: test user credential handling, session persistence
- Console/network error capture patterns
- Screenshot + GIF capture conventions (where to save, naming)
- Wait patterns: "data rendered" rather than Forge's "SSE event received" — poll for non-empty tables/charts with a bounded timeout
- Common assertions: "no 0.00 where a number is expected," "no empty chart containers," "no unhandled console errors"

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
| `where.md` | Navigation — exact DOM selectors, form fields, button labels, API endpoints |
| `expectations.md` | Pass/fail criteria, regression checklist |
| `tests.md` | Numbered test cases, GIF capture points, verify-command snippets |
| `completeness.md` | Known coverage gaps, demo script |

The `where.md` files are the deepest Divinr-specific work. They require actually exploring the component tree for each facet — an Explore agent pass per facet.

### 4. Daily Cron Pipeline

Three triggers via the `schedule` skill:

- **6:00 AM — `divinr-discover`** — fires the discover agent against each deep skill in sequence (Ollama is serial per `project_ollama_serial` memory, so parallel discovery is a non-goal). Drops findings into `open/`.
- **6:30 AM — `divinr-triage`** — reads `open/`, dedups, severity-assigns, moves to `triaged/` or `in-fix/`.
- **7:30 AM — `divinr-verify`** — reads `needs-verify/`, runs verify-commands, closes or re-opens.

The 6:00 AM slot fires in a single pass that iterates facets, not parallel agents — respect the serial-Ollama constraint, and keep the Chrome session count to one.

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
- **Ollama is serial.** Discovery runs sequentially across facets, not in parallel. The harness accepts a longer total runtime as the price of the serial constraint.

## Success Criteria

- `docs/testing/findings/` exists with the five-state folder layout and a passing TEMPLATE.md
- Triage and verify agents installed and functional (copy-verbatim verified)
- `divinr-test-agent.md` installed and successfully drives one facet end-to-end in Chrome
- Nine deep skills written, each with all six files populated (may be minimal but present)
- Daily cron pipeline active; at least one morning digest committed before this effort closes
- CLAUDE.md + build-plan/verify-plan convention updated
- First real finding filed, triaged, fixed, verified, and closed through the full lifecycle — as the smoke test that the harness actually works end-to-end

## Out of Scope

- **Historical-day replay** — that is `regression-testing-harness` in `future/`, a separate effort about contract-change validation against historical market data. This effort is Chrome UI testing, not replay.
- **Pricing / cost-modeling accuracy validation** — the cost-modeling dashboards are tested for render, not for numerical accuracy against ground truth. Accuracy validation is an analytics effort, not UI testing.
- **Mobile device testing** — v1 is Chrome at Divinr's tested breakpoints (desktop + 390px mobile via DevTools). Real-device testing defers.
- **Cross-browser (Firefox, Safari)** — Chrome-only in v1.
- **Performance / Lighthouse budgets** — a separate concern; not part of this harness.
- **Security testing (CSP, XSS, auth bypass)** — separate concern, separate skillset.
- **Unit / integration test coverage growth** — the existing Vitest suites are unaffected by this effort. This adds a Chrome layer on top, not a replacement for API-level tests.
- **Parallelizing Ollama inference to speed up discovery** — hard constraint per `project_ollama_serial` memory.

## Dependencies

- **`onboarding-tour-extended`** — the surface inventory in §3 is the coverage checklist. This effort should land *after* that one, so the skills can key directly into the finalized inventory rather than tracking a moving target. Also, the first-touch content written during that effort describes what "passing" looks like at each surface — useful seed material for the deep-skill `expectations.md` files.
- **`ui-vocabulary-and-marketing-refresh`** — the vocabulary sweep changes many user-visible strings. Writing `where.md` files before that sweep lands would require immediate rework. Sequence this effort after vocab refresh too.
- No infrastructure dependencies otherwise. Ollama + Chrome are already on Spark.

## Open Questions for PRD Phase

- **Skill location** — Divinr uses `/home/golfergeek/projects/divinr.ai/.claude/skills/` already. Should deep skills live there or in `docs/testing/skills/`? Leaning `.claude/skills/` for consistency with Orchestrator.
- **Finding digest format** — markdown file committed daily, Slack/email, or both? Leaning committed-markdown for now (no external dependencies; grep-able history).
- **Test-user provisioning** — the discover agent needs a known test user with stable state to hit every surface. Do we seed one on Supabase, or reuse `demo-user`? (`demo-user` has real activity that would drift over time; probably want a dedicated `testing-team-user` seeded via migration.)
- **Authoring surfaces require paid-tier state** — some flows (BYO LLM, custom analyst creation) assume an account with payment configured. How do we simulate that in test without wiring Stripe? Mock flag on the test user, probably.
- **When a finding is filed against a surface mid-effort-branch** — if a current effort's branch breaks a surface the harness is watching, does the cron run against `main` only, or also against open branches? v1 scope says `main` only; branch-level testing is a future add.
- **Cron delivery mechanism** — use the existing `schedule` / cron skill, or a separate systemd unit? The `schedule` skill is lighter-weight and already in use for other scheduled work.
- **GIF capture storage** — GIFs are heavy; commit them to the repo per finding, or write to a local `.testing-artifacts/` directory with a retention policy? Leaning latter; the finding file can reference a path without the binary being committed.

## Adjacent Efforts

- **`regression-testing-harness`** (in `future/`) — historical-day replay. Unrelated in mechanism but complementary in intent. Both are "ops & validation" layer; both raise the founder's ability to ship safely alone.
- **`onboarding-tour-extended`** (current) — the surface inventory is shared. See Dependencies above.
- **Orchestrator AI testing harness** — the reference implementation. Layer 1 (finding lifecycle) and the triage/verify agents copy verbatim; everything else is a Divinr-specific rewrite.

---

*Drafted 2026-04-19 after porting discussion with Orchestrator AI. The harness pattern is validated in Orchestrator; this effort is about adaptation, not invention.*
