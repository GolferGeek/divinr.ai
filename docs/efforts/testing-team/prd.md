# Testing Team — Product Requirements Document

## 1. Overview

Port the Orchestrator AI testing harness to Divinr. The harness replaces "manual tester the founder would hire" with Claude-agent infrastructure that exercises Divinr's user-facing surfaces on a daily cron, files regressions into a markdown-based finding queue, and drives those findings through a triage/fix/verify lifecycle.

Ships the five deliverables from intention §Intention, with the three-layer execution split running underneath them:

1. **Finding lifecycle** — file-based queue at `docs/testing/findings/` with folders `open/ → triaged/ → in-fix/ → needs-verify/ → closed/`. Filename is a deterministic dedup hash; a hash appearing in `closed/` then `open/` auto-flags P0 regression.
2. **Agents** — at `.claude/agents/`: one Divinr-specific discover agent (`divinr-test-agent.md`), two product-neutral triage/verify agents copied verbatim from Orchestrator.
3. **Test harness (three execution layers)**:
   - **Playwright** — primary regression harness. Runs headless against Cloudflare-fronted prod (`https://divinr.ai` + `https://api.divinr.ai`). Only layer cron can drive.
   - **Chrome-MCP** — exploratory / manual investigation, invoked interactively against localhost or prod by the founder or a spawned agent. Never in cron.
   - **Jest / Vitest** — cron-safe unit and API-integration tests. Today exists only in `apps/api/tests/` as `tsx`-driven unit runners (see `apps/api/package.json` `test:unit`); `apps/web` has no unit framework wired and this effort does not add one (§6). Harness treats the existing `apps/api` tier as the always-runnable layer that cron can also invoke alongside Playwright.
4. **Skill library** — a base browser-patterns skill (`divinr-workflow-browser-skill/`), a product index skill (`divinr-platform-browser-skill/`), and nine deep per-facet skills. Each deep skill is six files plus a Chrome-MCP exploratory section as a secondary area within, paired with concrete Playwright specs under `apps/e2e/tests/<facet>/`.
5. **Daily cron pipeline** — discover (06:00) → triage (06:30) → verify (07:30), running against prod, emitting a committed markdown digest of new / triaged / in-fix / closed-today findings.

Plus a coverage-growth convention so every future user-surface effort extends the harness the same way it extends the first-touch inventory — enforced via CLAUDE.md and `verify-plan`.

## 2. Goals & Success Criteria

### Primary goals (from intention "Intention" + "Success Criteria")

- Every morning, the founder wakes up to either "nothing new, everything verified" or a triaged list of specific things to look at — not the current state of "hope nothing broke overnight."
- No regression survives unnoticed across more than one daily cron cycle (24 h).
- No regression can be silently re-filed or silently re-closed: filename is a deterministic dedup hash; a hash appearing in `closed/` then `open/` auto-flags as a P0 regression.
- Every user-visible surface in the canonical inventory (105 keys, Appendix A of `docs/efforts/archive/onboarding-tour-extended/prd.md`) is at least smoke-covered by Playwright.
- Every future user-surface effort extends a deep skill (or stubs a new one) the same way it extends `surface-content.ts` — enforced via CLAUDE.md + `verify-plan`.

### Concrete "done" criteria (verifiable)

- `docs/testing/findings/` exists with five-state folder layout and a populated `TEMPLATE.md`; dedup hash algorithm implemented and tested.
- `apps/e2e/` workspace exists with `@playwright/test`, `playwright.config.ts`, and a `pnpm e2e` script that runs the full suite headless against `$BASE_URL` (default `https://divinr.ai`).
- `pnpm e2e` passes green against prod, exercising at least one smoke spec per facet (9 facets → ≥9 specs passing).
- Nine deep skills exist under `.claude/skills/`, each with all six files present (may be minimal but non-empty), each paired with ≥1 real Playwright spec in `apps/e2e/tests/<facet>/`.
- Base skill `divinr-workflow-browser-skill/` ships with documented Playwright patterns (login, storage-state reuse, wait-for-data-render, console/network error capture, trace/screenshot artifact conventions).
- `.claude/agents/` exists with three agents: `divinr-test-agent.md`, `test-triage-agent.md` (verbatim from Orchestrator), `test-verify-agent.md` (verbatim from Orchestrator). Cron-path of `divinr-test-agent` demonstrated end-to-end (runs Playwright → parses results → drops finding into `open/`). Interactive-path demonstrated on one facet via Chrome-MCP.
- Three cron triggers registered via the `schedule` skill: `divinr-discover` at 06:00, `divinr-triage` at 06:30, `divinr-verify` at 07:30 (local Spark TZ).
- At least one morning digest committed to `docs/testing/digests/YYYY-MM-DD.md` before effort closes. Digest summarizes **new / triaged / in-fix / closed-today** counts per facet (per intention §Intention item 5).
- CLAUDE.md updated with a "Testing coverage" Definition-of-Done clause; `verify-plan` skill updated to check for a "Testing-coverage update" line under any phase that adds a user-visible surface (flag Major if missing).
- **End-to-end smoke**: one real finding filed by the discover agent, triaged to P1+, moved to `in-fix/`, fixed, moved to `needs-verify/`, verified by verify agent, closed. The round-trip demonstrates the harness works.
- Prod Supabase seeded `is_testing=true` user exists with stable fixture data (documented club membership, paper portfolio with ≥1 position, ≥1 tournament entry); credentials available to Playwright via `TEST_USER_EMAIL` / `TEST_USER_PASSWORD` env vars.

## 3. User Stories / Use Cases

**Founder, 7:45 AM** — Opens repo, reads `docs/testing/digests/2026-04-20.md`. Sees: 3 new findings (1 P1, 2 P3), 1 closed overnight. Clicks through the P1 file, sees the failing spec, reproduces locally with the verify-command from the frontmatter, fixes, commits, renames the finding into `needs-verify/`. Next morning it's in `closed/`.

**Founder, mid-day ad-hoc investigation** — Beta user reports "my club's Activities tab looks blank." Founder invokes `divinr-test-agent.md` interactively (not via cron) pointing at the `club.activities` facet with Chrome-MCP. The agent walks the facet's exploratory pattern block in `divinr-clubs-browser-skill/`, reproduces the blank-state issue, files a finding into `open/` with a trace attached. Triage runs immediately on next scheduled pass.

**Founder, planning a new effort** — Writing a plan for a new "watchlist" surface. `verify-plan` flags the plan with a Major issue: "Phase 3 adds `watchlist.list` surface but no deep-skill entry — either extend `divinr-predictions-browser-skill/` or stub a new skill." The plan gets fixed before merge.

**Future tester / next Claude** — Reads `docs/testing/findings/open/a3f2c4d1-divinr-trade-form-regressed.md`. Frontmatter tells them severity, capability, surface-key, verify-command. They run the command, see the failure, open the Playwright trace from the artifact path, understand the regression without needing the original filer's context.

**Cron agent, 06:00** — Spawned headlessly by the `schedule` skill. Runs `pnpm e2e --project=predictions`, parses `test-results/results.json`, computes dedup hashes, writes new findings into `open/` (existing ones are no-ops). Exits.

## 4. Technical Requirements

### 4.1 Architecture

```
docs/testing/
├── findings/
│   ├── TEMPLATE.md
│   ├── open/          # newly filed, un-triaged
│   ├── triaged/       # severity assigned, ticketable
│   ├── in-fix/        # actively being worked (mostly by the founder)
│   ├── needs-verify/  # fix claimed; verify agent runs verify-command next pass
│   └── closed/        # verified; a reappearing hash auto-becomes P0 regression
└── digests/
    └── YYYY-MM-DD.md  # daily summary, committed

apps/e2e/                          # new pnpm workspace
├── package.json                   # @divinr/e2e
├── playwright.config.ts           # BASE_URL from env, default https://divinr.ai
├── tests/
│   ├── predictions/*.spec.ts
│   ├── portfolios/*.spec.ts
│   ├── tournaments/*.spec.ts
│   ├── clubs/*.spec.ts
│   ├── analysts/*.spec.ts
│   ├── instruments/*.spec.ts
│   ├── performance/*.spec.ts
│   ├── authoring/*.spec.ts
│   └── admin/*.spec.ts
├── fixtures/
│   └── login.ts                   # storage-state reuse helper
└── .testing-artifacts/            # traces, screenshots — gitignored

.claude/
├── agents/                        # new directory
│   ├── divinr-test-agent.md       # discover (written new)
│   ├── test-triage-agent.md       # verbatim from Orchestrator
│   └── test-verify-agent.md       # verbatim from Orchestrator
└── skills/
    ├── divinr-workflow-browser-skill/
    │   ├── SKILL.md
    │   ├── patterns/
    │   │   ├── login.md
    │   │   ├── wait-for-data-render.md
    │   │   ├── console-network-capture.md
    │   │   ├── trace-screenshot-artifacts.md
    │   │   └── chrome-mcp-exploratory.md
    │   └── assertions.md
    ├── divinr-platform-browser-skill/
    │   └── SKILL.md               # index of the nine deep skills + shared components
    ├── divinr-predictions-browser-skill/
    │   ├── SKILL.md
    │   ├── what.md
    │   ├── where.md
    │   ├── expectations.md
    │   ├── tests.md
    │   └── completeness.md
    ├── divinr-portfolios-browser-skill/  # same six-file structure
    ├── divinr-tournaments-browser-skill/
    ├── divinr-clubs-browser-skill/
    ├── divinr-analysts-browser-skill/
    ├── divinr-instruments-browser-skill/
    ├── divinr-performance-browser-skill/
    ├── divinr-authoring-browser-skill/
    └── divinr-admin-browser-skill/
```

**Relationships**:

- Each deep skill's `tests.md` references concrete spec files in `apps/e2e/tests/<facet>/`. Deep skill and spec move together.
- Each deep skill also carries a **Chrome-MCP exploratory section** as a secondary area within its six files (embedded in `tests.md` under a dedicated heading, per intention §Scope/Skill Library). The base `divinr-workflow-browser-skill/` documents the generic Chrome-MCP patterns; each deep skill's section provides facet-specific walkthrough steps for interactive investigation.
- `divinr-test-agent` reads a facet name + mode flag (`--cron` vs `--interactive`), loads the deep skill, runs specs (cron) or walks the deep skill's Chrome-MCP exploratory section (interactive).
- `schedule` skill registers three cron triggers via `CronCreate`; the triggers spawn `divinr-test-agent` / `test-triage-agent` / `test-verify-agent` respectively.
- Finding files are markdown with YAML frontmatter; filename is the dedup hash; the folder is the state. State transitions are filesystem moves (no DB).

### 4.2 Data Model Changes

**No schema changes to the product DB.** All finding state is filesystem-based in `docs/testing/findings/`.

**Testing-team Supabase user** — one seeded row, created by a new migration under `apps/api/db/migrations/YYYY-MM-DD-testing-team-seed.sql` following the repo's existing date-prefixed SQL-file convention (see `apps/api/db/migrations/2026-04-13-learning-clubs.sql` etc. for prior art). The migration is idempotent (`CREATE TABLE IF NOT EXISTS`, `INSERT … ON CONFLICT DO NOTHING`, `ALTER TABLE … ADD COLUMN IF NOT EXISTS`). Required state the migration establishes:

| Field / state | Value |
| --- | --- |
| `email` | `testing-team@divinr.ai` (or similar stable literal) |
| `is_testing` | `true` — **new column** on the users table (currently absent; added by this migration, default `false`) |
| Club membership | 1 seeded club with known state |
| Paper portfolio | ≥1 position with known ticker |
| Tournament entry | 1 entry in a seeded tournament |
| Payment flag | A mock-paid flag so authoring flows (BYO LLM, custom analyst) are accessible without Stripe |

The `is_testing=true` flag must be excluded from analytics, cost accounting, leaderboards, and tournament prize calculations. A grep of `apps/api/src/` for `is_testing` today returns zero matches, so every relevant aggregation needs the filter added in this effort. The audit surfaces the full list during Phase 1 before the flag goes live.

**Finding file schema** (frontmatter, copied from Orchestrator):

```yaml
---
product: divinr
severity: P0 | P1 | P2 | P3
capability: <facet-name>           # predictions / portfolios / tournaments / ...
surface-key: <dotted-key>          # e.g., tournament.detail.trade
spec: <path-to-playwright-spec>
verify-command: <exact shell command>
first-seen: YYYY-MM-DDTHH:MM:SSZ
last-seen: YYYY-MM-DDTHH:MM:SSZ
regression-count: 0
trace-artifact: <path or URL>
---
```

Dedup hash: `sha1("divinr:{spec-path}:{test-name}") | head -c 8`. Filename: `{8-char-hash}-divinr-{short-slug}.md`.

### 4.3 API Changes

**None to the product API.** The harness consumes the existing NestJS REST surface under `/api/*` for assertion purposes (e.g., "after paper trade submit, `/api/markets/portfolios/mine` reflects the new position"). No new endpoints are introduced.

**One API-adjacent concern** — if Cloudflare Access or Zero-Trust gates `api.divinr.ai`, Playwright needs a service-account token via env vars (`CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET`). Confirmed during Phase 0 readiness (see §7); if absent, no wiring needed.

### 4.4 Frontend Changes

**No runtime frontend changes.** The harness only reads the deployed web app.

**One testability concern** — Playwright locators prefer `getByRole` + accessible name over CSS selectors. Where a component lacks an accessible name (unnamed buttons, un-labelled inputs, icon-only toggles), the deep skill's `where.md` calls it out as a "testability gap." Those gaps are *documented*, not fixed, in this effort — fixing them is a follow-on pass. Exception: if a gap blocks a smoke spec from passing at all, fix it in-flight and note it in the effort's completion report.

### 4.5 Infrastructure Requirements

- **Playwright on Spark** — `npx playwright install chromium` must work in the CCR cron environment. Phase 0 verifies this; if missing system libs, the fallback is a Docker image pre-baked with Chromium (mirror Orchestrator's `testing-browser-smoke` Dockerfile). Leaning no-Docker until a real block surfaces.
- **Artifact storage** — traces + screenshots land in `apps/e2e/.testing-artifacts/` on Spark, gitignored, with a 7-day retention cron. Each finding's frontmatter points at the absolute artifact path. The **first trace of each new finding** additionally gets copied to `docs/testing/findings/open/<hash>.trace.zip` (committed, one-off, capped at 5 MB — larger traces get downsampled or stored out-of-repo with a URL reference). This gives long-tail triage a durable artifact even if the local file is rotated.
- **`schedule` skill on Spark** — used as-is per user memory. Three `CronCreate` invocations register the three daily triggers. Triggers must survive CCR session restarts; confirm during Phase 4.
- **Prod DNS / Cloudflare** — `https://divinr.ai` and `https://api.divinr.ai` must be reachable from Spark. Phase 0 verifies with a simple `curl -sfI` check of each host and a `curl` of a known public endpoint. If Cloudflare Access gates either, capture service token and wire via env.
- **Testing-team user seed migration** — idempotent SQL migration runnable against any Supabase instance (dev localhost 7011, prod Spark). Committed under the existing migrations directory.
- **Env var convention** — new file `apps/e2e/.env.example` documents `BASE_URL`, `API_BASE_URL`, `TEST_USER_EMAIL`, `TEST_USER_PASSWORD`, `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET`. Real values live in `apps/e2e/.env` (gitignored) and in the cron runner's env.

## 5. Non-Functional Requirements

### 5.1 Performance

- **Full Playwright suite**, all nine facets, sequential projects: must complete within **20 minutes wall-clock** against prod. Within a facet, Playwright's default worker pool is allowed (not Ollama-bound). Across facets, sequential — keeps log output coherent and avoids hammering prod.
- **Triage pass** (agent over `open/`): < 5 minutes for up to 50 findings. Serial-only per Ollama constraint if the triage agent calls an LLM.
- **Verify pass**: bounded by how many findings are in `needs-verify/`. Each verify-command is itself a Playwright spec invocation, typically < 30 s. Cap: 30 findings per pass; excess carries to next pass.

### 5.2 Reliability

- **Flake tolerance**: each spec retried once on first failure (Playwright built-in). A spec is only filed as a finding after 2 consecutive failed runs (the initial + the retry). This trades a bit of runtime for a sharp false-positive cut.
- **Network / Cloudflare transients**: any spec that fails with a 5xx from Cloudflare or a connection-reset gets retried up to 3× before being classified as a real failure; persistent 5xx becomes a P1 "prod unreachable" finding (the only finding the harness is itself allowed to file under a non-spec capability).
- **No test interdependency**: each spec creates its own test state via API or resets to a known seeded state. No spec depends on another spec's side effect. Storage-state reuse for login is allowed (deterministic).

### 5.3 Security

- **Testing-team credentials** never committed. `apps/e2e/.env` is gitignored.
- **Service tokens** (Cloudflare Access, if needed) stored in the same gitignored env file.
- **Trace artifacts** may contain screenshots of the testing-team user's state — that user's data is synthetic and committable. If a spec ever logs in as a real user, traces are *not* committed; the skill explicitly forbids storing non-testing-team session state.
- **Ollama serial** preserved: any LLM-assisted triage is sequential. No parallel LLM calls from the harness.

### 5.4 Scalability

- **Finding queue growth**: filesystem-based; a few thousand closed findings is trivial to grep. No DB needed at any projected scale.
- **Skill library growth**: each new facet is one more deep skill (six files) + specs; adding a tenth or eleventh is mechanical.
- **Cron fan-out**: future effort may add a branch-preview path (PR-scoped runs) without touching the cron prod path.

### 5.5 Compatibility

- **Node version**: pnpm workspace already requires Node ≥ 20; Playwright supports 20+. No bump needed.
- **Web assertions**: Chromium-only in v1, at desktop + 390px via Playwright device emulation. Firefox/WebKit deferred (§6).
- **CI compatibility**: `apps/e2e` is a workspace package with its own `test` script; `pnpm -w run e2e` works at the repo root. CI can add `pnpm e2e` as a later gate without restructuring — explicitly not wired in v1 (§6).

## 6. Out of Scope

Explicitly excluded from this effort (reiterating and extending intention "Out of Scope"):

- **Historical-day replay** — covered by `regression-testing-harness` in `future/`.
- **Chrome-MCP in cron** — cron has no local display.
- **Cost-modeling / pricing accuracy validation** — render tests only, not numerical ground-truth checks.
- **Mobile device testing** — beyond 390px Chromium emulation.
- **Cross-browser (Firefox, WebKit)** — one-line config change, deferred.
- **Lighthouse / performance budgets** — separate concern.
- **Security testing (CSP, XSS, auth bypass)** — separate skillset.
- **Unit / integration test growth** — Vitest + `apps/api/tests` suites untouched.
- **Parallelized Ollama inference in triage** — hard constraint.
- **CI gating on PRs** — harness is cron-driven in v1. Wiring `pnpm e2e` into GitHub Actions on PR is a follow-up.
- **Branch-preview runs** — cron runs against `main` / prod only. Branch-preview is a future add.
- **Findings dashboard UI** — digest is markdown committed to the repo. No web UI for the queue in v1.
- **Cross-environment test matrix** — v1 targets prod only. Dev/staging-targeting variants defer.
- **Automatic fix attempts** — the harness finds and verifies; it does not fix. Founder (or a separate fix agent) closes the loop.
- **Slack / email delivery of the digest** — committed markdown only.

## 7. Dependencies & Risks

### 7.1 External dependencies

- **`onboarding-tour-extended`** (shipped, archived) — surface inventory Appendix A (105 keys) is the coverage checklist. Deep skills map to keys. Locked.
- **`ui-vocabulary-and-marketing-refresh`** (shipped, archived) — vocab sweep landed; `where.md` role/text locators can use current copy directly.
- **Cloudflare-fronted Spark deployment** — `https://divinr.ai` + `https://api.divinr.ai` must be reachable and stable. Risk: Cloudflare Access gating (see §7.2). Mitigation: Phase 0 readiness check, service token if needed.
- **Prod Supabase testing-team user** — seeded via migration. Risk: existing code paths that don't filter service accounts may skew leaderboards / cost reporting. Mitigation: audit in Phase 1, add filters where missing.
- **`schedule` skill** — user-global per memory; available on Spark. Risk: cron survives session restart? Mitigation: Phase 4 verifies persistence, falls back to a systemd timer if needed.
- **No local infra beyond that**: Ollama + Chrome already on Spark; Playwright Chromium self-contained via `npx playwright install`.

### 7.2 Technical risks (with mitigations)

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Cloudflare Access gates `api.divinr.ai` → Playwright can't reach API | Low/Med | High | Phase 0 `curl` check; if gated, configure `CF_ACCESS_CLIENT_ID/SECRET` service token |
| Playwright Chromium needs system libs not present on Spark | Low | Med | Phase 0 install check; Docker fallback mirroring Orchestrator's testing-browser-smoke |
| `schedule` skill triggers don't persist across CCR session restarts | Med | Med | Phase 4 verifies; systemd timer fallback (one extra file per trigger) |
| Flake rate too high against prod → every day has false-positive findings | Med | Med | 2-consecutive-fails rule, Cloudflare retry, bounded timeouts — all in §5.2; tune in a Phase 7 hardening pass |
| Testing-team user's seeded state drifts over time (trades age out, tournament closes) | High | Low/Med | Migration is idempotent; re-run resets state; document `pnpm migrate:testing-team-reset` |
| Writing 9 deep skills front-loads a lot of component exploration; effort balloons | High | Med | Each deep skill is allowed to ship **minimal** (all six files present, 1 spec green); post-ship iteration adds depth. Don't gold-plate pre-merge |
| Discover agent mis-parses Playwright results JSON → wrong finding filed | Low | Low | Schema is stable across Playwright versions; unit-test the parser against a captured sample |
| Cost-modeling / analytics queries break when `is_testing=true` users are excluded mid-effort | Low | Med | Audit done in Phase 1 before enabling the flag; gated rollout |
| First trace artifact commit bloats repo if traces are large | Med | Low | Cap enforced at 5 MB per committed trace; larger → downsample or URL-reference |
| Finding queue grows unboundedly if closed files never get archived | Low | Low | Policy: closed findings older than 90 days move to `docs/testing/findings/archive/YYYY-MM/`. Out of scope for v1; manual sweep when needed |

### 7.3 Implicit assumptions made explicit

- The founder is the sole consumer of the daily digest in v1. No stakeholder needs paging.
- Prod Supabase admits the testing-team user with real credentials — no MFA gating on this specific account.
- The existing compliance harness at `apps/api/tests/compliance/` is orthogonal to this effort and remains unchanged.
- `@nestjs/schedule` internal crons in the API (day-trader runner, nightly evaluation, etc.) are unaffected; this harness is external to the API runtime.

## 8. Phasing

Each phase is independently validatable. A phase is "done" when its acceptance check passes — not when its files are written. Quality gates (lint, typecheck, existing `apps/api` tests) must remain green at every phase boundary.

### Phase 0 — Readiness (no code)

**Goal**: confirm the three unknowns in "Open Questions" before committing to a path.

- `curl -sfI https://divinr.ai` and `curl -sfI https://api.divinr.ai` from Spark → both 200 or documented Cloudflare behavior.
- `npx playwright install chromium` run on Spark in a throwaway dir → completes without system-dep errors. If it fails, switch Phase 1 to the Docker variant.
- Cloudflare Access check on `api.divinr.ai` (look for `cf-access` response headers on an unauthenticated curl) → decide whether service-token wiring is needed in Phase 1.
- `schedule` skill smoke test: create a throwaway trigger, confirm it fires and survives a CCR restart. If not, plan for systemd timer fallback.

**Acceptance**: a short `docs/efforts/current/testing-team/readiness.md` committed with decisions: playwright-install vs docker, cf-access needed or not, schedule-persistent or systemd-fallback.

### Phase 1 — Finding lifecycle + testing-team user

**Goal**: the substrate both agents and harness depend on.

- Create `docs/testing/findings/{open,triaged,in-fix,needs-verify,closed}/` (each with `.gitkeep`).
- Write `docs/testing/findings/TEMPLATE.md` mirroring Orchestrator's format; product=divinr.
- Implement dedup-hash helper in `apps/e2e/src/finding-hash.ts` (pure function: spec-path + test-name → 8-char hash).
- Seed migration for the testing-team Supabase user, including `is_testing` column on the users table if not present. Idempotent.
- Audit: every analytics / cost / leaderboard / tournament query under `apps/api/src/` that aggregates over users — list each one and either add an `is_testing=false` filter or note why it's safe. Report committed as `docs/efforts/current/testing-team/is-testing-audit.md`.

**Acceptance**: running the migration against dev Supabase produces the testing-team user with documented fixture state; the hash helper has a unit test (`tsx`-driven) that passes; the audit report lists every analytics query and its disposition.

### Phase 2 — Agents

**Goal**: the three agents installed and functional.

- Create `.claude/agents/`.
- Copy `test-triage-agent.md` and `test-verify-agent.md` from the Orchestrator reference verbatim (only change: product-name references become `divinr`).
- Write `divinr-test-agent.md` fresh, cloning `forge-test-agent.md`'s shape but replacing HITL/SSE patterns with Divinr data-viz patterns listed in the intention (rendered-vs-blank, filter interaction, drill-down navigation, chart render, empty-vs-populated, trade-form submit).
- Agent supports two modes: `--cron <facet>` (runs Playwright project, parses results, files findings) and `--interactive <facet>` (drives Chrome-MCP exploratory patterns).

**Acceptance**: triage and verify agents installed and visible in `.claude/agents/`; divinr-test-agent's cron-path is invokable and writes (to a scratch directory) when pointed at a hand-rolled failing spec; interactive-path invokable and drives Chrome-MCP against localhost on one facet.

### Phase 3 — Base skill + Playwright workspace

**Goal**: the browser patterns and the Playwright project skeleton.

- New pnpm workspace: `apps/e2e/` with `package.json` (`@divinr/e2e`), `@playwright/test` dependency, `playwright.config.ts` using `BASE_URL` env (default `https://divinr.ai`), single `chromium` browser, sequential projects (one per facet), `reporter: ['list', ['json', { outputFile: 'test-results/results.json' }]]`, trace-on-first-retry + screenshot-on-failure.
- `apps/e2e/fixtures/login.ts` — storage-state reuse helper using `TEST_USER_EMAIL` / `TEST_USER_PASSWORD`.
- `apps/e2e/.env.example` documenting all env vars.
- `divinr-workflow-browser-skill/` under `.claude/skills/` with SKILL.md + pattern files (login, wait-for-data-render, console-network-capture, trace-screenshot-artifacts, chrome-mcp-exploratory) + shared assertions doc.
- Root `package.json`: add `"e2e": "pnpm --filter @divinr/e2e exec playwright test"` script.

**Acceptance**: `pnpm e2e` runs (no specs yet → exits green with 0 tests); storage-state fixture successfully logs the testing-team user in against prod; base skill files lint-clean against existing CLAUDE.md conventions.

### Phase 4 — First two deep skills + product index + cron wiring

**Goal**: end-to-end proof the harness works — one smoke finding round-trips.

- `divinr-platform-browser-skill/` index skill — enumerates the nine deep skills and lists shared components (`MemberProfileDrawer`, `ActiveTournamentBanner`, `<LegalDisclaimer>`).
- Two pilot deep skills, each with all six files populated and a real passing smoke spec:
  1. `divinr-predictions-browser-skill/` + `apps/e2e/tests/predictions/smoke.spec.ts`
  2. `divinr-tournaments-browser-skill/` + `apps/e2e/tests/tournaments/smoke.spec.ts`
- Register three cron triggers via the `schedule` skill: `divinr-discover` 06:00, `divinr-triage` 06:30, `divinr-verify` 07:30.
- Artifact retention: add `apps/e2e/scripts/prune-artifacts.sh` and wire into a daily cron (08:00).
- **Round-trip smoke**: deliberately break a known surface (or pick a real issue if one exists), let cron file the finding, manually triage+fix+verify, confirm closure. Revert the break. Document in `docs/efforts/current/testing-team/round-trip-log.md`.

**Acceptance**: cron runs at 06:00 and produces a finding file; triage at 06:30 moves it to `triaged/`; manual fix + verify closes it. Round-trip log documents the timing.

### Phase 5 — Remaining seven deep skills

**Goal**: every facet covered.

Sequentially (each with ≥1 smoke spec, all six files minimal-but-present):

5a. `divinr-portfolios-browser-skill/`
5b. `divinr-clubs-browser-skill/`
5c. `divinr-analysts-browser-skill/`
5d. `divinr-instruments-browser-skill/`
5e. `divinr-performance-browser-skill/`
5f. `divinr-authoring-browser-skill/`
5g. `divinr-admin-browser-skill/`

Each sub-phase's acceptance: `pnpm e2e --project=<facet>` green against prod; skill's `tests.md` references actual spec files; cron pipeline picks up failures from the new facet on next pass.

### Phase 6 — Coverage-growth convention

**Goal**: enforce the Forever-Rule analog going forward.

- Update `CLAUDE.md` with a "Testing coverage on every user-facing surface" section (mirrors the "First-touch coverage" section already there). Language, per intention §5 verbatim: "Every new user-visible surface ships a first-touch content entry AND either extends an existing deep testing skill or stubs a new one. Definition of Done for any effort touching a user-visible view."
- Update `.claude/skills/verify-plan/SKILL.md` — add a §7 "Testing coverage" check: if a plan introduces any new Vue view under `apps/web/src/views/` or substantially changes one, the plan MUST include a step that updates the relevant deep skill (either adds a test case to `tests.md` + spec, or stubs a new deep skill). Missing → flag Major.
- Update `.claude/skills/build-plan/SKILL.md` — under "Definition of Done" for any phase that adds a surface, include a "Testing-coverage update" line by default.

**Acceptance**: a hand-rolled throwaway plan that adds a surface but omits testing coverage → `verify-plan` flags Major. Revert throwaway.

### Phase 7 — First daily digest + harden

**Goal**: the harness produces a real morning artifact, and known flake is triaged.

- Let the harness run for 3–5 consecutive days against prod.
- Each day, `divinr-discover` (or a light "digest" step inside the triage trigger) writes `docs/testing/digests/YYYY-MM-DD.md` with counts per facet and a link-list of **new / triaged / in-fix / closed-today** findings (per intention §Intention item 5).
- After the observation window, triage any flake: tune retries, tighten locators, file improvement tickets. Not required to hit zero flakes — required to understand what's flaky and why.
- First committed digest marks the harness "live."

**Acceptance**: ≥1 digest committed; flake tuning documented in `docs/efforts/current/testing-team/flake-triage.md`.

### Phase 8 — Completion

**Goal**: wrap.

- End-to-end smoke confirmed (Phase 4 round-trip still holds).
- Nine deep skills present; every facet has ≥1 passing smoke spec.
- Cron triggers active; three days of digests committed.
- CLAUDE.md + verify-plan + build-plan updated and exercised.
- `completion-report.md` written summarizing what shipped, what deferred, known flake, and follow-up tickets.

**Acceptance**: `completion-report.md` committed; effort ready to be promoted to `archive/` by the next `commit-push` / roadmap sweep.
