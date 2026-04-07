# Unit Tests

**Stub.** Current unit tests live at:

- `apps/api/tests/unit/*.test.ts` — 15 suites, run via `pnpm --filter @divinr/api test:unit`
- `apps/web/src/**/*.spec.ts` — Vitest specs, run via `pnpm --filter @divinr/web test`

Consolidation into this directory is deferred. The `pnpm` test scripts in `apps/api/package.json` and `apps/web/package.json` reference relative paths that would all need updating, plus the compliance harness has its own internal layout. Worth doing as a dedicated cleanup effort, not bundled into a feature change.

When consolidation happens, the structure should mirror the source layout:

```
testing/unit/
  api/
    markets/
      conviction-trader.test.ts
      stop-loss-watcher.test.ts
      eod-forced-buy.test.ts
      …
  web/
    stores/
    components/
```
