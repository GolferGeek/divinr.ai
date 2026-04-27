---
name: divinr-mastery-browser-skill
description: Playwright + Chrome-MCP patterns for the Divinr mastery-level shell. Covers Level 1 nav hiding, hidden-route fallback into the Learning Panel, and the manual complexity control in onboarding settings.
allowed-tools: Read Write Edit Grep Glob Bash
---

# Divinr Mastery Browser Skill

Deep skill for the `mastery` facet. Always load `divinr-workflow-browser-skill` first for shared Playwright and Chrome-MCP patterns.

## Facet summary

- Primary routes: `/`, `/settings/onboarding`, hidden-route fallback through `/chat`
- Capability slug: `mastery`
- Playwright project: `mastery`

## Key components / patterns

- Left nav in `DefaultLayout.vue`
- Manual complexity controls in `OnboardingSettingsView.vue`
- Router fallback from hidden routes into the Learning Panel
- Level-aware Learning Panel notice for hidden surfaces

## API endpoints exercised

- `GET /api/mastery/profile`
- `POST /api/mastery/profile`
- `GET /api/learning-panel/bootstrap`

## File map

- `what.md` — architecture narrative of the facet
- `where.md` — exact Playwright locators per action
- `expectations.md` — pass/fail invariants
- `tests.md` — numbered Playwright cases + Chrome-MCP walkthrough
- `completeness.md` — known gaps + human demo script
