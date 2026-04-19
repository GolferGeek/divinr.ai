# What — Clubs facet

## User flow

1. User lands on `/clubs`. The page heading is `Clubs`. Two header buttons sit on the right: `Rankings` and (for write-capable roles) `Create Club`.
2. `useClubStore.fetchMyClubs()` and `fetchPublicClubs()` populate the two tabs; `useTournamentStore.fetchTournaments({ scope: 'club' })` powers the sprint chips on My Clubs cards.
3. Default tab is `My Clubs`. Empty state copy: `No clubs yet. Create one or join with an invite code!`. Otherwise one `IonCard` per club with: name, sprint chip (active or upcoming), role chip, optional description, member count, optional unread-activity badge.
4. `Discover` tab lists public clubs. Empty state: `No public clubs yet.` Each card shows name, member count, tournament count.
5. Clicking any card routes to `/clubs/:id`.
6. Detail view loads `ClubDetailView.vue`. If the user is **not** a member, the page renders the heading + `<LegalDisclaimer variant="club" />` + `<ClubPreviewPanel>` (no tab bar).
7. If the user **is** a member, the page renders the heading + invite-code line + `<LegalDisclaimer variant="club" />` + `<ActiveTournamentBanner>` + the scrollable `IonSegment` tab bar.
8. Default tab is `activities` unless `?tab=<value>` overrides it (validated against the `VALID_TABS` whitelist: `members`, `tournaments`, `analysts`, `activities`, `analytics`, `curriculum`, `mentoring`). Note: `tournaments` is in the whitelist for legacy deep-links but is **not** rendered as a segment button in the current template.
9. Tab content lazy-loads via `loadTab(t)`: `analysts` → `fetchAnalysts`, `activities` → `fetchChallenges/Polls/Journals`, `analytics` → `fetchAnalytics`, `curriculum` → `fetchCurricula`, `mentoring` → `fetchStatus/Leaderboard/Eligibility/PendingFeedback`.
10. Member rows in the `Members` tab open `MemberProfileDrawer` for that user.

## Surface shape (list)

```
Clubs                                [Rankings] [Create Club]
[ My Clubs ] [ Discover ]
+--------- Club A -----------------------+
| Name                  [Sprint active] [owner]
| Description (optional)
| 12 members  (3)   <- unread badge
+----------------------------------------+
+--------- Club B -----------------------+
| ...
+----------------------------------------+
```

## Surface shape (detail, member view)

```
<Club Name>                 [Invite] [Chat]
12 members · Code: ABCD123  [Copy]
[ Legal disclaimer ]
[ ActiveTournamentBanner ]
[Members] [Analysts] [Activities] [Analytics] [Curriculum] [Mentoring]
...selected tab content...
```

## Surface shape (detail, non-member view)

```
<Club Name>
[ Legal disclaimer ]
[ ClubPreviewPanel — preview cards + join CTA ]
```

## Data invariants

- Every visible card has a non-null `club.name` and `member_count`.
- Sprint chip is shown only when an `active` or `upcoming` `scope: 'club'` tournament exists for that club id.
- Role chip uses `c.my_role` (`owner` | `admin` | `member`).
- Unread badge renders only when `unread_count > 0`.
- The legal disclaimer on detail uses the `club` variant, which states both "not a prediction model" and "not investment advice" per CLAUDE.md.
