# Tournament Avatar Stack — Product Requirements Document

## 1. Overview

Tournament list cards in `apps/web/src/views/TournamentsView.vue` currently render a flat `{N} players` roster line. This effort adds a small overlapping avatar stack — first 3 entrants plus an overflow chip for the rest — inline with that roster text. The avatars are sourced via a single bulk SQL statement on `listTournaments`, preserving the existing "one round-trip per page load" contract (no N+1).

This is a cosmetic/social polish effort: the underlying data (tournaments, entries, users) is unchanged; only the payload shape of one endpoint and one card component are extended.

## 2. Goals & Success Criteria

- **G1** Every tournament list card shows up to 3 entrant avatars adjacent to the `{N} players` text.
- **G2** When there are more than 3 entrants, an overflow chip (`+K`) renders after the 3 avatars, where `K = player_count - 3`.
- **G3** `GET /tournaments` (the `listTournaments` endpoint) remains a single round-trip regardless of how many tournaments are on the page. No per-card queries. No client-side fan-out.
- **G4** Users without a `display_name` still get a rendered avatar (initial from `user_id` fallback). No blank circles.
- **G5** Visual parity with the existing initials-avatar pattern used in `apps/web/src/components/MemberProfileDrawer.vue` (`<div class="avatar">` + first-letter-uppercase). No new Ionic or third-party avatar dependency.
- **G6** On narrow (mobile) viewports, the stack + overflow chip fit within the card without wrapping the `{N} players` line or overflowing the card edge.

**Done when:** all six goals are verifiable in the running app, the `listTournaments` round-trip count is unchanged (verified by network panel / existing `tournaments-list-player-count.test.ts`-style unit test), and the card renders correctly across mobile and desktop breakpoints.

## 3. User Stories / Use Cases

- **As a prospective tournament entrant** browsing the list, I can glance at a card and see that real people are in it (faces / initials), not just a number. Tournaments feel populated and social rather than abstract.
- **As a returning user**, I can recognize friends or familiar handles by their initial-colored avatar without opening the tournament detail view.
- **As an admin** scanning for low-activity tournaments, I can quickly distinguish "empty/just-started" tournaments (0–2 avatars, no overflow chip) from "full" ones (3 avatars + overflow).

## 4. Technical Requirements

### 4.1 Architecture

- **No new services, no new tables, no new migrations.** The change extends one existing endpoint and one existing view component.
- **API change:** `TournamentService.listTournaments()` in `apps/api/src/tournaments/tournament.service.ts` (lines 62–111) extends its SQL with a `LEFT JOIN LATERAL` that returns the first 3 entries per tournament as a JSON array. The existing `player_count` scalar subquery is retained; the new lateral supplies the preview list.
- **Web change:** A new reusable `AvatarStack.vue` component in `apps/web/src/components/` renders the avatar circles + overflow chip. `TournamentsView.vue` (lines 107–133) imports and renders it beside the roster text.
- **Mobile:** `apps/ios` is a Capacitor wrapper — no native changes. The responsive CSS on `AvatarStack.vue` + `TournamentsView.vue` covers the mobile form factor.

### 4.2 Data Model Changes

**None.** Schema is unchanged.

- `prediction.tournament_entries` already has `joined_at TIMESTAMPTZ DEFAULT now()` (migration `2026-04-13-tournament-system.sql` line 46), which provides the stable ordering for "first 3 entrants."
- `authz.users` already has `display_name TEXT` (nullable). `avatar_url` does **not** exist in the schema today.
- Since there is no `avatar_url` column, the API always returns `avatar_url: null` for every entrant for now. The field is declared in the DTO as `avatar_url: string | null` so a future column addition is non-breaking for the web client (which already has to handle `null` via the initials fallback).

### 4.3 API Changes

**Endpoint:** `GET /tournaments` (controller: `apps/api/src/tournaments/tournament.controller.ts` lines 103–116). No URL, method, query param, or auth change.

**Response shape change — `Tournament` item** (interface in `apps/api/src/tournaments/tournament.types.ts` lines 5–22 and mirrored in `apps/web/src/stores/tournament.store.ts` lines 36–52):

Add two fields:

```ts
entrants_preview: Array<{
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;   // always null for now; forward-compatible
}>;  // length 0..3
entrants_overflow: number;     // max(0, player_count - 3)
```

Both fields are always present in the response (never undefined). Empty tournaments return `entrants_preview: []` and `entrants_overflow: 0`.

**SQL sketch** (extension of the existing query in `tournament.service.ts` lines 103–108, following the `LEFT JOIN LATERAL` precedent in `tournament-leaderboard.service.ts` lines 59–67):

```sql
SELECT
  t.*,
  (SELECT COUNT(*)::int
     FROM prediction.tournament_entries te2
     WHERE te2.tournament_id = t.id) AS player_count,
  COALESCE(preview.entrants, '[]'::jsonb) AS entrants_preview
FROM prediction.tournaments t
LEFT JOIN LATERAL (
  SELECT jsonb_agg(
           jsonb_build_object(
             'user_id', sub.user_id,
             'display_name', sub.display_name,
             'avatar_url', NULL
           )
           ORDER BY sub.joined_at ASC
         ) AS entrants
  FROM (
    SELECT te.user_id, te.joined_at, u.display_name
    FROM prediction.tournament_entries te
    LEFT JOIN authz.users u ON u.id = te.user_id
    WHERE te.tournament_id = t.id
    ORDER BY te.joined_at ASC
    LIMIT 3
  ) sub
) preview ON TRUE
ORDER BY t.starts_at DESC;
```

`entrants_overflow` is computed in the service layer after the query as `Math.max(0, row.player_count - row.entrants_preview.length)` to keep the SQL simple.

### 4.4 Frontend Changes

- **New component:** `apps/web/src/components/AvatarStack.vue`
  - Props: `entrants: Array<{ user_id, display_name, avatar_url }>` (≤3) and `overflow: number`.
  - Renders 0–3 overlapping avatar circles (left-to-right, newest-drawn-on-top visually so the leftmost is frontmost — standard stack look), plus a `+K` chip when `overflow > 0`.
  - Each avatar circle: if `avatar_url` is non-null render an `<img>`; else render initials from `display_name` (first letter, uppercased) with `user_id[0].toUpperCase()` as final fallback. This mirrors the exact pattern already in `MemberProfileDrawer.vue` line 109.
  - CSS: initials avatars use a deterministic background color derived from `user_id` (simple hash → hue) so the same user is always the same color across cards. Circle size ~24–28px; overlap ~8px; overflow chip uses existing `IonChip`-like styling (reuse classes from `TournamentsView.vue` if present, else match visually).
- **Integration:** In `TournamentsView.vue` the roster line at line 122 becomes:
  ```vue
  <AvatarStack :entrants="t.entrants_preview" :overflow="t.entrants_overflow" />
  <span class="roster-text">{{ pluralPlayers(t.player_count ?? 0) }}</span>
  ```
  Flex layout ensures the stack and text stay on one line at standard widths.
- **Store types:** Update `Tournament` in `apps/web/src/stores/tournament.store.ts` (lines 36–52) to include the two new fields. Because the API always returns them, they are non-optional on the store type.

### 4.5 Infrastructure Requirements

None. No new env vars, no new ports, no new services, no migrations.

## 5. Non-Functional Requirements

- **Performance:** The added LATERAL subquery should add <25ms to the `listTournaments` query at current data scale (tens of tournaments, tens to low-hundreds of entries each). The existing `idx_tournament_entries_tournament_user (tournament_id, user_id)` index plus the natural `joined_at` ordering keeps the inner `LIMIT 3` cheap. No new index is required for launch; reassess only if p95 latency regresses.
- **Round-trip budget:** Exactly one SQL statement per `listTournaments` call, unchanged from today. Verified by a unit test mirroring the style of `apps/api/tests/unit/tournaments-list-player-count.test.ts`.
- **Security:** `display_name` is already exposed via other endpoints (leaderboard, member drawer); no new PII surface. `user_id` is already returned by tournament-related endpoints. No auth model change.
- **Accessibility:** Each avatar needs `alt` text (display name or "Entrant") and the overflow chip an `aria-label` like `"+5 more players"`.
- **Compatibility:** Web (desktop + mobile responsive) + Capacitor-wrapped iOS. No new browser APIs used.

## 6. Out of Scope

- **Full entrant roster expansion on the list card** — remains the job of the tournament detail view.
- **Avatar uploads / profile picture management** — no UI, no storage, no `avatar_url` column addition. Field is stubbed as `null` for forward compatibility only.
- **Avatar stacks on leaderboard rows** — leaderboard already shows display names next to every row.
- **Real profile pictures** — this effort is initials-only rendering today.
- **Caching layer for entrant previews** — the single LATERAL is fast enough; no Redis/memoization.

## 7. Dependencies & Risks

- **Risk: DTO drift.** `Tournament` is hand-kept in sync between `apps/api/src/tournaments/tournament.types.ts` and `apps/web/src/stores/tournament.store.ts` (no shared transport-types package for this type). **Mitigation:** update both in the same phase; add a brief comment in each file referencing the other.
- **Risk: SQL regression on `listTournaments`.** The query is already covered by `tournaments-list-player-count.test.ts` for `player_count`; extending it silently could change shape. **Mitigation:** add a parallel unit test asserting `entrants_preview` shape and length cap, and that `entrants_overflow === player_count - entrants_preview.length`.
- **Risk: Visual jank on mobile cards.** The card layout is narrow on small phones; a stack + chip + text on one line may wrap. **Mitigation:** flex with `min-width: 0` on the text span and `flex-shrink: 0` on the stack; truncate the pluralization text before the stack collapses. Verified by manual check at iPhone SE width (375px) in the browser.
- **Risk: Color hash collisions** giving two users the same initial + same color on one card. **Mitigation:** acceptable; this is cosmetic. Hue derives from the full `user_id`, not the initial, so collisions are rare.
- **Dependency:** NestJS DI convention (`@Inject(ClassName)` on every constructor param, per `CLAUDE.md`) — any new service parameter on `TournamentService` would need it, but this effort does not add new parameters.

## 8. Phasing

Each phase is independently buildable, testable, and mergeable.

### Phase 1 — API: extend `listTournaments` payload

- Update `Tournament` interface in `apps/api/src/tournaments/tournament.types.ts` to include `entrants_preview` and `entrants_overflow`.
- Extend the SQL in `TournamentService.listTournaments()` with the LATERAL subquery above.
- Compute `entrants_overflow` in the service after the DB round-trip.
- Add unit test asserting: (a) one SQL call per `listTournaments` invocation, (b) `entrants_preview` capped at 3 and ordered by `joined_at ASC`, (c) `entrants_overflow = max(0, player_count - entrants_preview.length)`, (d) empty-tournament case returns `[]` and `0`.

**Exit criteria:** `curl /tournaments` returns the new fields with the correct shape on a DB with mixed empty / small / large tournaments. Existing test suite still green.

### Phase 2 — Web: `AvatarStack` component + card integration

- Add `apps/web/src/components/AvatarStack.vue` implementing props, initials fallback, deterministic color hash, overflow chip, and accessibility labels.
- Update `Tournament` interface in `apps/web/src/stores/tournament.store.ts` to match the API payload.
- Integrate `<AvatarStack>` into the roster row of `TournamentsView.vue` (around line 122).
- Visually verify against `MemberProfileDrawer.vue`'s existing initials avatar for styling parity.

**Exit criteria:** Tournament list page shows the stack + overflow chip. A tournament with 0 entrants shows just the text. A tournament with 1–3 shows exactly that many avatars and no chip. A tournament with >3 shows 3 avatars + `+K` chip where K matches the real count.

### Phase 3 — Responsive polish & regression check

- Manually verify layout at 375px (mobile), 768px (tablet), 1280px (desktop) in a real browser — no wrapping, no overflow of card bounds.
- Confirm `listTournaments` is still a single network request on the tournaments page (browser DevTools Network panel).
- Add/confirm a light frontend test that mounts `AvatarStack` with the four shape cases (0 / 2 / 3 / overflow) and asserts the rendered DOM.

**Exit criteria:** All three viewports look clean. Network tab shows one call. Frontend test passes.
