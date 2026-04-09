# Effort: harden-monitor

## Summary
Full codebase monitoring scan and hardening pass. No PRD — this was an operational effort driven by `/monitor` and `/harden` skills.

## Branch
`effort/harden-monitor` — merged to main via fast-forward

## What was done

### Quality Skills (commit 2)
Added 4 Claude Code skills: `scan-errors`, `fix-errors`, `monitor`, `harden`

### Full Hardening (commit 4 — 80 files)
- **@Inject decorators**: ~50 missing params fixed across 44 files
- **Admin authorization**: role checks on 19 admin/A2A endpoints
- **Security**: auth guards on observability stream, CORS restrictions, RBAC endpoint protection
- **Legal language**: 'recommend' to 'signal/propose' in prompts and UI
- **SSE reconnect**: timer cleanup, exponential backoff, max retries
- **Error handling**: try/catch on store fetches and view API calls
- **Store consistency**: useApi() per-action, tenant store over localStorage
- **Pool leaks**: OnModuleDestroy for 3 pg Pool services
- **Dead code**: 6 unused Vue components removed, dead LLM fields cleaned
- **Accessibility**: keyboard nav + mobile hamburger menu in sidebar
- **Misc**: port 7100, 404 route, proper HTTP exceptions

## Monitoring artifact
`.monitor/all.json` — 200 files analyzed, 40 issues identified and resolved

## Date
2026-04-09
