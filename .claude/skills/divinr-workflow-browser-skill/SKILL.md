---
name: divinr-workflow-browser-skill
description: "Playwright patterns for testing the Divinr web app. Load this skill before writing any divinr-<facet>-browser-skill deep skill. Documents login, wait-for-data-render, console/network capture, trace/screenshot conventions, Chrome-MCP exploratory patterns, and common assertions. Keywords: playwright, browser, e2e, login, fixtures, divinr."
allowed-tools: Read, Write, Edit, Grep, Glob, Bash
---

# Divinr Workflow Browser Skill (Base)

The base skill for browser testing on Divinr.ai. Every deep skill (`divinr-<facet>-browser-skill/`) loads this first, then layers its facet-specific patterns on top. This skill does not enumerate surfaces or run tests — it documents the reusable testing machinery.

## When to load this skill

- Writing or editing any `apps/e2e/tests/**/*.spec.ts`.
- Writing any `divinr-<facet>-browser-skill/` deep skill.
- Debugging a Playwright failure that touches login, wait conditions, console/network capture, or artifact retention.

Do not load this skill for product-code changes; it is test-side only.

## Index

| File | Covers |
|------|--------|
| [`patterns/login.md`](./patterns/login.md) | How to use `apps/e2e/fixtures/login.ts`, storage-state reuse, when to re-login, producing fresh state via `prepare-auth-state.ts`. |
| [`patterns/wait-for-data-render.md`](./patterns/wait-for-data-render.md) | Divinr-specific wait patterns for tables, charts, skeletons, and empty vs not-yet-loaded states. |
| [`patterns/console-network-capture.md`](./patterns/console-network-capture.md) | Attach `page.on('console')` and `page.on('requestfailed')`, assert no unhandled errors on the happy path. |
| [`patterns/trace-screenshot-artifacts.md`](./patterns/trace-screenshot-artifacts.md) | Default capture config, where traces/screenshots land, how findings reference them. |
| [`patterns/chrome-mcp-exploratory.md`](./patterns/chrome-mcp-exploratory.md) | Generic Chrome-MCP patterns for the interactive discover path. Each deep skill's Chrome-MCP section references this file. |
| [`patterns/artifact-retention.md`](./patterns/artifact-retention.md) | `.testing-artifacts/` rotation, first-trace-per-finding copy, size caps. |
| [`assertions.md`](./assertions.md) | The canonical Divinr assertion list — "no 0.00 where a number is expected," empty-chart container rules, 4xx/5xx on happy path, etc. |

## Deep-skill authoring protocol

When writing a new `divinr-<facet>-browser-skill/`:

1. Start from this skill's index — copy the six-file structure (`SKILL.md`, `what.md`, `where.md`, `expectations.md`, `tests.md`, `completeness.md`).
2. `what.md` is the architecture narrative — where the facet lives in the router, which views, which shared components.
3. `where.md` is the locator table — one row per user action, with the exact Playwright locator grounded in the actual Vue source. Do not invent selectors.
4. `expectations.md` is the pass/fail criteria — one line per `expect()` call in the spec.
5. `tests.md` is the numbered test cases + the secondary **Chrome-MCP exploratory patterns** section used by the `divinr-test-agent --interactive <facet>` path.
6. `completeness.md` is the known-gaps ledger + the human demo script.

The file structure is non-negotiable — the `divinr-test-agent` and cron pipeline index into these paths by convention.
