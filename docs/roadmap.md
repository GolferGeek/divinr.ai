# Divinr.ai Roadmap

This roadmap is intentionally lightweight. The authoritative feature inventory is [docs/features.md](features.md), and detailed implementation history lives under [docs/efforts/](efforts/).

## Current Focus

- Make the product understandable to reviewers, prospects, and early collaborators.
- Keep the local development path reliable.
- Preserve trust framing around analysis, education, and paper trading.
- Continue improving calibration, evidence visibility, and analyst accountability.
- Harden the API, background jobs, billing lifecycle, and browser-visible workflows.

## Near-Term Polish

- Add current product screenshots for the dashboard, analysis rationale, tournaments, clubs, authoring, and operator views.
- Keep the README, feature inventory, demo script, and technical overview synchronized.
- Expand reviewer-friendly setup notes when a fresh external machine exposes friction.
- Tighten known local-development assumptions around seeds, demo login, and optional integrations.
- Keep Playwright coverage aligned with new or substantially changed user-facing surfaces.

## Product Directions

- Better focused dashboard attention surfaces.
- Clearer custom analyst graduation workflow.
- Deeper risk-debate and rationale inspection.
- More complete contract editor workflows with version diff and rollback.
- Continued learning-system improvements from audit and outcome feedback.
- More polished club, tournament, mentoring, and classroom-demo paths.

## Known Limitations

- Stripe is wired for test-mode/local lifecycle validation; live cutover is intentionally separate.
- Optional market data and LLM providers require local credentials.
- Some local flows depend on seeded demo users and generated data.
- Production deployment, production data, private credentials, and private brand assets are not included in the open-source repository.
- The repository is pre-1.0 and still changing quickly.

## Deferred Decisions

- Whether to accept broad outside contributions or keep collaboration contact-first.
- Whether to publish individual packages to npm.
- Which hosted deployment topology should be documented as canonical.
- Whether to move from MIT to a different license later.
