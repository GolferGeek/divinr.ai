# Trace & Screenshot Artifacts

`playwright.config.ts` captures `trace: 'on-first-retry'` and `screenshot: 'only-on-failure'`. The cron pipeline assumes these defaults — do not override per-spec unless investigating a specific flaky test.

## Where artifacts land

- Traces: `apps/e2e/test-results/<project>-<test-slug>/trace.zip`.
- Screenshots: `apps/e2e/test-results/<project>-<test-slug>/test-failed-1.png`.
- JSON report: `apps/e2e/test-results/results.json` (read by `divinr-test-agent` for parsing failures).

## Finding frontmatter reference

When a finding is filed, the `trace-artifact` frontmatter field points to the trace zip:

```yaml
trace-artifact: apps/e2e/test-results/predictions-loads-the-predictions-list/trace.zip
```

The first trace for any new finding is copied to `docs/testing/findings/open/<hash>.trace.zip` (capped at 5 MB per PRD §5.2) so the finding self-contains its reproduction trace even after artifact rotation.

## Viewing a trace

```bash
cd /home/golfergeek/projects/divinr.ai
npx playwright show-trace apps/e2e/test-results/<project>-<test-slug>/trace.zip
```

Opens the Playwright Trace Viewer in the browser. This is the first thing triage should do on any incoming finding.

## Do not commit artifacts

`apps/e2e/test-results/`, `apps/e2e/playwright-report/`, and `apps/e2e/.testing-artifacts/` are all in `.gitignore`. The only artifacts that ever land in git are the ≤5 MB trace copies under `docs/testing/findings/open/`.
