# Testing Team — Phase 0 Readiness

**Date**: 2026-04-19
**Checked from**: Spark (`/home/golfergeek/projects/divinr.ai`)

## 0.1 — `https://divinr.ai` reachability

```
curl -sfI https://divinr.ai → HTTP/2 200
server: cloudflare
cf-ray: 9eedfa3e3aa65f24-ORD
cf-cache-status: DYNAMIC
```

Status: reachable. Cloudflare-fronted (confirmed `server: cloudflare`, `cf-ray`, `cf-cache-status`). No `cf-access-*` response headers — not behind Cloudflare Access.

## 0.2 — `https://api.divinr.ai/health` reachability

```
curl -sfI https://api.divinr.ai/health → HTTP/2 200
content-type: application/json
x-powered-by: Express
server: cloudflare
```

Status: reachable. Express (NestJS) behind Cloudflare. `/health` endpoint returns JSON. Root `/` returns 404 (expected — no root handler).

## 0.3 — Cloudflare Access gating

**Neither host is gated by Cloudflare Access.** No `cf-access-*` request-required headers, no 302 to a Cloudflare login page, no 403 Access-denied on an unauthenticated curl. Both are behind vanilla Cloudflare CDN + WAF.

Implication: **no service-token wiring needed.** `CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET` can be omitted from the Phase 3 `.env.example` (or left documented as optional for future-proofing).

## 0.4 — Playwright Chromium install on Spark

```
cd /tmp/pw-phase0-install
npx --yes playwright@latest install chromium
```

Chromium Headless Shell v147 (`chromium-headless-shell-linux-arm64.zip`, 107.5 MiB) + FFmpeg v1011 (1.6 MiB) downloaded cleanly into `~/.cache/ms-playwright/`.

Spark is ARM64 (NVIDIA Grace/Hopper); Playwright serves the correct arch. **No Docker fallback needed.**

## 0.5 — Schedule mechanism smoke

`CronCreate` / `CronList` / `CronDelete` all work end-to-end (verified with a throwaway one-shot trigger `27d91acf`, confirmed via `CronList`, deleted via `CronDelete`).

**Important finding about persistence**: `CronCreate` defaults to `durable: false` (session-only, "dies when Claude exits"). For the Phase 4 real triggers (discover / triage / verify / artifact-prune) to survive CCR session restarts, **each call must pass `durable: true`** — this writes the trigger to `.claude/scheduled_tasks.json` (the same file the session lock `.claude/scheduled_tasks.lock` sits beside).

The "survives session restart" sub-check in plan step 0.5 is satisfied *by mechanism* (durable mode exists and is documented). A true end-to-end restart test is deferred to Phase 4 when the real triggers are registered — at that point we can verify they re-load on restart by checking `.claude/scheduled_tasks.json` after a `/resume`.

## 0.6 — Decisions (feeds Phase 1+)

| Decision | Choice | Why |
| --- | --- | --- |
| Playwright install path | **Direct `npx playwright install chromium`** (no Docker) | Step 0.4 succeeded cleanly on Spark ARM64 |
| Cloudflare Access wiring | **Not needed** | Step 0.3 found no `cf-access-*` gating |
| Scheduling mechanism | **`CronCreate` with `durable: true`** for real Phase 4 triggers | Native Claude Code cron primitive; persistent mode writes `.claude/scheduled_tasks.json` |
| Any surprise that reshapes later phases | **None** | All Phase 0 unknowns resolved green |

## Notes for Phase 1+

- `apps/e2e/.env.example` should document `CF_ACCESS_*` env vars as **optional** (commented out) rather than required — keeps the config future-proof without demanding non-existent values today.
- For cron triggers in Phase 4, invoke `CronCreate` directly with `durable: true` rather than relying solely on the `schedule` skill (which can still be used as an ergonomic wrapper, but the raw tool is the primitive).
- `.claude/scheduled_tasks.lock` is a session-lock file that is already modified in git status; it is a runtime artifact, not commit material.
