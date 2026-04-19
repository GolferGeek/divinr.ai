# Completeness — Clubs facet

## What the smoke covers

- `/clubs` list route loads, heading renders, cards-or-empty state.
- Vocabulary check outside `<LegalDisclaimer>` and `[surface-key]` nodes.
- No 5xx from `divinr.ai` / `127.0.0.1:7100` / `127.0.0.1:7101`.

The smoke is intentionally **read-only**. It does not click into any detail page, does not switch the My Clubs / Discover segment, does not assert exact row counts, and does not exercise any tab on the detail view.

## Known gaps (not yet automated)

1. **Detail tab bar coverage** — assert all six segment buttons render on a club the testing-team user is a member of. Requires a guaranteed-membership fixture.
2. **Non-member preview path** — assert `ClubPreviewPanel` renders for a club the testing-team user is **not** a member of. Requires a fixture club id.
3. **Tab deep-links** — `?tab=members|analysts|activities|analytics|curriculum|mentoring` should each render their dedicated content block.
4. **Member drawer** — clicking a member row opens `MemberProfileDrawer`. Needs a club with at least 2 members.
5. **Sprint chip rendering** — Sprint active / Sprint starts <date>. Needs an active/upcoming `scope: 'club'` tournament fixture.
6. **Invite flow** — `/clubs/:id` Invite button → modal/popover → copy link; `/clubs/invite/:token` landing.
7. **Activities sub-blocks** — Signal Challenges, Strategy Journals, Consensus Polls. Each has its own create CTA and empty-state copy.
8. **Mentoring states** — apply / request / pending feedback / pair member. Branch-heavy; needs deterministic mentor + mentee fixtures.
9. **Analytics grid** — win rate, avg return, club style, tournament count formatting and null-handling.
10. **Curriculum CRUD** — list, create (admin), open detail at `/clubs/:id/curricula/:cid`.
11. **Cross-club views** — `/clubs/rankings`, `/clubs/compare` — separate test files when promoted.
12. **`Create Club` admin flow** — gated on `canWrite`.

## Known vocabulary gaps — refer to UI vocab effort

None observed at smoke time. The `/clubs` list view in `apps/web/src/views/ClubsView.vue` does not contain the forbidden tokens (`prediction*`, `recommendation`, `advice`) outside of `<LegalDisclaimer>`. If a future regression introduces inline forbidden copy, document the offending selector here and relax the spec's vocabulary check by excluding that selector — do not edit the app from this skill.

## Human demo script (manual)

1. Log in as testing-team; navigate to `/clubs`.
2. Verify the page heading reads `Clubs` and two header buttons (`Rankings`, optionally `Create Club`) appear.
3. Verify the segment shows `My Clubs` (default) and `Discover`.
4. Confirm cards render with name, optional sprint chip, role chip, member count, optional unread badge.
5. Switch to `Discover`; verify public-club cards render with member + tournament counts (or `No public clubs yet.`).
6. Click any card. Confirm URL is `/clubs/<uuid>` and the legal disclaimer renders.
7. Member view: confirm the six tabs render — Members, Analysts, Activities, Analytics, Curriculum, Mentoring. Click each; content should change.
8. Members tab: click any member row; confirm `MemberProfileDrawer` opens.
9. Mentoring tab: confirm the panel matches the user's mentor status (apply CTA, request CTA, or active pairings).
10. Navigate `/clubs/<uuid>?tab=analytics`; confirm the analytics grid loads.
11. Navigate `/clubs/rankings`; confirm cross-club leaderboard renders.
12. (Optional) Use the Invite button to generate an invite link and open it in an incognito window.

## Promotion criteria

To promote a gap into the smoke, the fixture needs to be either: (a) idempotent against prod data (read-only), or (b) backed by a dedicated seed fixture in the `testing-team` scope that no human user touches.
