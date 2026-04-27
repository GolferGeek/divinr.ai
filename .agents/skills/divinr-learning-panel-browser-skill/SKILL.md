---
name: divinr-learning-panel-browser-skill
description: Playwright + Chrome-MCP patterns for the Divinr Learning Panel facet. Covers the /chat route, persisted thread hydration, grounded citations, and the level-1 educational assistant surface.
allowed-tools: Read Write Edit Grep Glob Bash
---

# Divinr Learning Panel Browser Skill

Deep skill for the `learning-panel` facet. Always load `divinr-workflow-browser-skill` first for the shared Playwright/Chrome-MCP patterns.

## Facet summary

- Route: `/chat`
- View: `apps/web/src/views/ChatView.vue`
- Capability slug: `learning-panel`
- Playwright project: `learning-panel`

## Key components / patterns

- Header copy: `Learning Panel`
- Empty state with starter prompts
- Persisted thread hydration from `/api/learning-panel/bootstrap`
- Message composer + send button
- Assistant messages can render a `Grounded in` citation list
- First-touch panel on first visit: `<FirstTouchPanel surface-key="chat">`

## API endpoints exercised

- `GET /api/learning-panel/bootstrap?surfaceKey=chat`
- `GET /api/learning-panel/threads/:threadId`
- `POST /api/learning-panel/threads`
- `POST /api/learning-panel/threads/:threadId/messages`

## File map

- `what.md` — architecture narrative of the facet
- `where.md` — exact Playwright locators per action
- `expectations.md` — pass/fail invariants
- `tests.md` — numbered Playwright cases + Chrome-MCP walkthrough
- `completeness.md` — known gaps + human demo script
