---
name: divinr-clubs-browser-skill
description: Playwright + Chrome-MCP patterns for the Divinr clubs facet. Covers /clubs (My Clubs / Discover), /clubs/:id detail with the scrollable tab bar (Members, Analysts, Activities, Analytics, Curriculum, Mentoring), and the non-member preview/join surface.
allowed-tools: Read Write Edit Grep Glob Bash
---

# Divinr Clubs Browser Skill

Deep skill for the `clubs` facet. Always load `divinr-workflow-browser-skill` first.

## Routes

- `/clubs` — list with two tabs: `My Clubs`, `Discover`
- `/clubs/:id` — detail. Member view shows the scrollable tab bar; non-member view shows `ClubPreviewPanel` + join CTA.
- `/clubs/:id?tab=<members|analysts|activities|analytics|curriculum|mentoring>` — deep-link a tab on detail
- `/clubs/create` — admin-only club creation
- `/clubs/rankings` — cross-club leaderboard
- `/clubs/invite/:token` — invite landing (anonymous-friendly via `ClubJoinSignupView`)
- `/clubs/:id/curricula/:curriculumId` — curriculum detail (nested under detail)
- `/clubs/compare` — `ClubCompareView` (cross-club comparison)

## View files

- `apps/web/src/views/ClubsView.vue`
- `apps/web/src/views/ClubDetailView.vue`
- `apps/web/src/views/ClubCreateView.vue`
- `apps/web/src/views/ClubInviteView.vue`
- `apps/web/src/views/ClubJoinSignupView.vue`
- `apps/web/src/views/ClubCompareView.vue`
- `apps/web/src/views/ClubRankingsView.vue`
- `apps/web/src/components/ClubPreviewPanel.vue` (non-member preview surface)

## Key components

- `IonSegment` (top of `/clubs`) — values `mine` and `discover`
- `IonCard` per club tile — clickable; routes to `/clubs/:id`
- Sprint chips on `My Clubs` cards: green `Sprint active`, warning `Sprint starts <date>`
- Role chip per club tile (`owner` | `admin` | `member`)
- `LegalDisclaimer variant="club"` on detail (member and non-member branches)
- `ClubPreviewPanel` — non-member preview surface
- `ActiveTournamentBanner` — banner above the segment on member detail
- `MemberProfileDrawer` — opens from a member row (members tab)
- `IonPopover` (`#club-actions-trigger`) — mobile action menu (Invite, Chat)

## Detail tab inventory (member view)

Real `IonSegmentButton` values in `ClubDetailView.vue`:

| Tab        | Value         | Purpose                                                      |
| ---------- | ------------- | ------------------------------------------------------------ |
| Members    | `members`     | Roster, role chips, mentor chip, click → `MemberProfileDrawer` |
| Analysts   | `analysts`    | Club-shared analysts; create CTA visible to admins            |
| Activities | `activities`  | Signal Challenges, Strategy Journals, Consensus Polls (sub-headings inside the tab — not their own tabs) |
| Analytics  | `analytics`   | Win rate, avg return, club style, tournament count            |
| Curriculum | `curriculum`  | Reading lists / module plans                                  |
| Mentoring  | `mentoring`   | Mentor program — apply / request / pending feedback           |

The smoke spec is **read-only** on `/clubs` and does not click into any of these tabs. The deep skill documents them so future tests can opt in.

## File map

- `what.md` — architecture narrative
- `where.md` — exact Playwright locators
- `expectations.md` — pass/fail invariants
- `tests.md` — numbered Playwright cases + Chrome-MCP exploratory section
- `completeness.md` — gaps + human demo script
