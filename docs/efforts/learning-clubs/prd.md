# Investment Learning Clubs — Product Requirements Document

## 1. Overview

Divinr has individual AI analysis, paper trading, and tournaments, but no way for groups to learn together. Learning Clubs add a community layer where groups — university classes, Discord communities, friend groups — collaborate on AI-assisted market analysis. Clubs create retention by combining custom AI analysts, private tournaments, and structured learning activities. Explicitly framed as "investment learning" — educational, not advisory.

## 2. Goals & Success Criteria

- **Retention**: Club members stay longer than solo users through community accountability and shared learning.
- **Depth**: Custom club analysts let groups explore specific strategies (value investing, momentum, macro) with full AI pipeline integration.
- **Education**: Learning activities (prediction challenges, consensus polls, post-mortems) build the habit of documenting reasoning.

**Success criteria:**
- Users can create clubs, invite members, and manage roles (owner/admin/member).
- Club analysts run in the standard prediction pipeline and are visible only to club members.
- Club tournaments use the existing `scope='club'` tournament infrastructure.
- Learning activities (prediction challenges, consensus polls, post-mortems, strategy journals, contrarian spotlight) are functional.
- Club analytics aggregate member performance, analyst trust, and learning progress.
- Public clubs are discoverable; private clubs are invite-only.
- All UI uses educational language with legal disclaimers.

## 3. User Stories / Use Cases

**University professor:** Creates a club for their finance course, writes a custom analyst following their curriculum's methodology ("only use fundamentals and margin of safety"). Students compete in weekly tournaments, write prediction challenges before seeing AI analysis, and track their learning score over the semester.

**Trading Discord community:** Community leader creates a club, invites members via link. They create a momentum-focused custom analyst, run sector challenges, and use consensus polls to gauge the group's view before revealing AI signals.

**Friend group:** Creates a casual club with no custom analyst. Runs invitation tournaments scoped to the club. Uses post-mortems to laugh about bad trades and learn from good ones.

**Financial literacy program:** Organization creates a club for participants with structured prediction challenges and strategy journals to build the habit of documenting reasoning before acting.

## 4. Technical Requirements

### 4.1 Architecture

New `ClubModule` in the API, following the tournament module pattern:

- **Service layer**: `ClubService` (CRUD + membership), `ClubAnalystService` (custom analyst management), `ClubActivityService` (learning activities), `ClubAnalyticsService` (aggregate stats).
- **Controller**: `ClubController` under `/clubs` prefix.
- **Database**: New tables in `prediction` schema for clubs, members, activities, and analytics.
- **Integration**: Hooks into existing tournament system (`scope='club'`), analyst pipeline, affinity system, messaging system (club channels).

All constructor parameters use explicit `@Inject()` per codebase convention.

### 4.2 Data Model Changes

**`prediction.clubs`**
| Column | Type | Description |
|--------|------|-------------|
| `id` | text PK | Club ID |
| `name` | text NOT NULL | Display name |
| `description` | text | Club description |
| `invite_code` | text UNIQUE | Shareable join code |
| `is_public` | boolean DEFAULT false | Visible in club discovery |
| `created_by` | text NOT NULL | Owner user ID |
| `channel_id` | text | FK → messaging.channels; auto-created |
| `created_at` | timestamptz DEFAULT now() | |

**`prediction.club_members`**
| Column | Type | Description |
|--------|------|-------------|
| `id` | text PK | |
| `club_id` | text NOT NULL FK → clubs | |
| `user_id` | text NOT NULL | |
| `role` | text NOT NULL DEFAULT 'member' | `'owner'`, `'admin'`, `'member'` |
| `joined_at` | timestamptz DEFAULT now() | |
| UNIQUE | `(club_id, user_id)` | One membership per user per club |

**`prediction.club_invites`**
| Column | Type | Description |
|--------|------|-------------|
| `id` | text PK | |
| `club_id` | text NOT NULL FK → clubs | |
| `invite_token` | text NOT NULL UNIQUE | For direct invites |
| `invited_by` | text NOT NULL | |
| `invited_email` | text | For email-based invites (signup + join) |
| `invited_user_id` | text | For existing user invites |
| `status` | text DEFAULT 'pending' | `'pending'`, `'accepted'`, `'expired'` |
| `created_at` | timestamptz DEFAULT now() | |

**`prediction.club_analysts`** (junction table linking clubs to analysts)
| Column | Type | Description |
|--------|------|-------------|
| `id` | text PK | |
| `club_id` | text NOT NULL FK → clubs | |
| `analyst_id` | text NOT NULL FK → market_analysts | |
| `created_by` | text NOT NULL | Admin who created it |
| `created_at` | timestamptz DEFAULT now() | |
| UNIQUE | `(club_id, analyst_id)` | |

Club analysts are regular `prediction.market_analysts` rows with `club_id` stored in the junction table. The `market_analysts.user_id` field is set to the creating admin's ID. Visibility is controlled by joining through `club_analysts` + `club_members`.

**`prediction.club_prediction_challenges`**
| Column | Type | Description |
|--------|------|-------------|
| `id` | text PK | |
| `club_id` | text NOT NULL FK → clubs | |
| `created_by` | text NOT NULL | Admin who created challenge |
| `instrument_id` | text NOT NULL | Target instrument |
| `symbol` | text NOT NULL | |
| `prompt` | text | Optional framing question |
| `status` | text DEFAULT 'open' | `'open'`, `'revealed'`, `'closed'` |
| `created_at` | timestamptz DEFAULT now() | |
| `revealed_at` | timestamptz | When AI analysis was revealed |

**`prediction.club_challenge_responses`**
| Column | Type | Description |
|--------|------|-------------|
| `id` | text PK | |
| `challenge_id` | text NOT NULL FK → club_prediction_challenges | |
| `user_id` | text NOT NULL | |
| `direction` | text NOT NULL | `'bull'`, `'bear'`, `'neutral'` |
| `thesis` | text NOT NULL | Member's written reasoning |
| `submitted_at` | timestamptz DEFAULT now() | |
| UNIQUE | `(challenge_id, user_id)` | One response per member per challenge |

**`prediction.club_consensus_polls`**
| Column | Type | Description |
|--------|------|-------------|
| `id` | text PK | |
| `club_id` | text NOT NULL FK → clubs | |
| `created_by` | text NOT NULL | |
| `instrument_id` | text NOT NULL | |
| `symbol` | text NOT NULL | |
| `status` | text DEFAULT 'open' | `'open'`, `'revealed'`, `'closed'` |
| `created_at` | timestamptz DEFAULT now() | |
| `revealed_at` | timestamptz | |

**`prediction.club_consensus_votes`**
| Column | Type | Description |
|--------|------|-------------|
| `id` | text PK | |
| `poll_id` | text NOT NULL FK → club_consensus_polls | |
| `user_id` | text NOT NULL | |
| `direction` | text NOT NULL | `'bull'`, `'bear'`, `'neutral'` |
| `voted_at` | timestamptz DEFAULT now() | |
| UNIQUE | `(poll_id, user_id)` | |

**`prediction.club_strategy_journals`**
| Column | Type | Description |
|--------|------|-------------|
| `id` | text PK | |
| `club_id` | text NOT NULL FK → clubs | |
| `user_id` | text NOT NULL | |
| `tournament_id` | text | Optional tournament context |
| `symbol` | text | |
| `entry` | text NOT NULL | One-liner reasoning |
| `created_at` | timestamptz DEFAULT now() | |

### 4.3 API Changes

All endpoints under `/clubs` prefix. Auth required on all routes.

**Club CRUD:**
| Method | Path | Description | Access |
|--------|------|-------------|--------|
| `POST` | `/clubs` | Create club | Any user |
| `GET` | `/clubs` | List user's clubs | Authenticated |
| `GET` | `/clubs/discover` | Browse public clubs | Authenticated |
| `GET` | `/clubs/:id` | Club profile (members, stats, activity) | Club members |
| `PATCH` | `/clubs/:id` | Update club details | Owner/admin |
| `DELETE` | `/clubs/:id` | Delete club | Owner only |

**Membership:**
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/clubs/:id/join` | Join via invite code (body: `{ code }`) |
| `POST` | `/clubs/:id/leave` | Leave club |
| `GET` | `/clubs/:id/members` | List members with tournament stats |
| `POST` | `/clubs/:id/members/:userId/promote` | Promote to admin (owner only) |
| `POST` | `/clubs/:id/members/:userId/demote` | Demote to member (owner only) |
| `DELETE` | `/clubs/:id/members/:userId` | Remove member (owner/admin) |

**Invites:**
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/clubs/:id/invites` | Create invite (link or by email/username) |
| `GET` | `/clubs/invite/:token` | Preview club from invite |
| `POST` | `/clubs/invite/:token/accept` | Accept invite and join |

**Club Analysts:**
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/clubs/:id/analysts` | Create club analyst (admin) |
| `GET` | `/clubs/:id/analysts` | List club's analysts |
| `GET` | `/clubs/:id/analysts/:analystId/contract` | Get analyst contract |
| `PUT` | `/clubs/:id/analysts/:analystId/contract` | Update analyst contract (admin) |

**Learning Activities:**
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/clubs/:id/challenges` | Create prediction challenge (admin) |
| `GET` | `/clubs/:id/challenges` | List challenges |
| `POST` | `/clubs/:id/challenges/:challengeId/respond` | Submit bull/bear thesis |
| `POST` | `/clubs/:id/challenges/:challengeId/reveal` | Reveal AI analysis (admin) |
| `POST` | `/clubs/:id/polls` | Create consensus poll (admin) |
| `GET` | `/clubs/:id/polls` | List polls |
| `POST` | `/clubs/:id/polls/:pollId/vote` | Cast vote |
| `POST` | `/clubs/:id/polls/:pollId/reveal` | Reveal AI analysis (admin) |
| `POST` | `/clubs/:id/journals` | Add strategy journal entry |
| `GET` | `/clubs/:id/journals` | List club's journal entries |

**Club Analytics:**
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/clubs/:id/analytics` | Aggregate stats: win rate, avg return, analyst trust, analyst trust evolution over time, learning score, club style, common mistakes |
| `GET` | `/clubs/:id/analytics/post-mortem/:tournamentId` | Auto-generated post-mortem for a completed tournament |

### 4.4 Frontend Changes

**New routes:**
| Route | View | Description |
|-------|------|-------------|
| `/clubs` | `ClubsView` | My clubs + discover public clubs |
| `/clubs/create` | `ClubCreateView` | Club creation form |
| `/clubs/:id` | `ClubDetailView` | Club profile: members, tournaments, analysts, activities, analytics |
| `/clubs/:id/analysts/:analystId/contract` | Reuse `ContractEditorView` | Contract editor scoped to club analyst |
| `/clubs/invite/:token` | `ClubInviteView` | Invite landing page |

**New Pinia store:** `useClubStore()`
- Club list, active club, members, analysts, challenges, polls, journals, analytics.

**Dashboard integration:**
- "Your Clubs" card showing active clubs with member count.
- Club navigation item in sidebar.

**Component reuse:**
- Contract editor reused for club analysts with club-scoped API endpoints.
- Messaging components for club channel (auto-created on club creation).
- Tournament list filtered by `scope='club'` on club detail page.

**Legal framing:**
- All club pages: "Investment Learning Club — educational platform for practicing AI-assisted market analysis. Not investment advice."
- Language: "learn", "practice", "study", "analysis", "signals" — never "advice", "recommendations", "invest".

### 4.5 Infrastructure Requirements

- **Database migration**: Single migration file creating all club tables with appropriate indexes.
- **Analyst pipeline extension**: When running predictions for a user, include club analysts the user has access to (via `club_members` → `club_analysts` → `market_analysts` join).
- **Tournament scope validation**: When creating a `scope='club'` tournament, validate that `scope_id` references a valid club and that the creator is an admin of that club.
- **Messaging integration**: Auto-create a `scope='club'` messaging channel when a club is created. Add/remove members as they join/leave.
- **Post-mortem generation**: After a club tournament completes, generate a summary comparing top performer's trades, analyst usage, and consensus alignment.

## 5. Non-Functional Requirements

- **Performance**: Club analytics queries should complete in <1s for clubs up to 200 members. Aggregate affinity uses pre-joined queries, not N+1 per-member lookups.
- **Data isolation**: Club analysts visible only to club members. Prediction pipeline respects club scope — non-members never see club analyst predictions.
- **Security**: Club CRUD respects role hierarchy (owner > admin > member). Invite tokens are UUIDv4. All mutations check membership + role.
- **Scalability**: Separate `club_members` table (not extending global RBAC) keeps club operations fast without touching the auth schema.

## 6. Out of Scope

- **In-app chat or messaging** — clubs use the existing messaging system (club-scoped channels auto-created). No new chat features built.
- **Club-pooled portfolios** — each member trades independently in their own tournament portfolio. No shared money.
- **Paid club tiers** — future revenue model. All clubs are free for now.
- **Public club rankings/leaderboards across clubs** — future. Only intra-club leaderboards.
- **Curriculum builder / structured multi-week courses** — future enhancement.
- **Mentor/mentee pairing** — future.

## 7. Dependencies & Risks

**Dependencies:**
- **Tournament system** (shipped): `scope='club'` + `scope_id` already supported in tournament entity. Need to add club membership validation on tournament creation.
- **Messaging system** (shipped): `scope='club'` already supported in `ChannelScope`. Auto-create club channel on club creation.
- **Analyst pipeline** (shipped): Club analysts are `market_analysts` rows. Pipeline needs filtering extension to include club analysts for club members.
- **Affinity system** (shipped): Club analytics aggregate `user_analyst_affinity` across club members.
- **Contract editor** (shipped): Reused for club analyst contracts. Needs club-scoped API guard.

**Risks:**
| Risk | Impact | Mitigation |
|------|--------|------------|
| Analyst pipeline performance with many club analysts | Medium | Club analysts indexed by club_id; pipeline queries add one join. Monitor query time. |
| Post-mortem generation quality | Low | Auto-generated from structured data (trades, positions, analyst usage). No LLM needed for v1. |
| Club admin abuse (spam analysts, inappropriate content) | Low | Rate-limit analyst creation per club (10 max). Platform admin can disable clubs. |
| Legal ambiguity around "investment clubs" | Medium | Name is "Investment Learning Club". Disclaimers on every page. No pooled money. Educational framing. |

## 8. Phasing

### Phase 1: Club Entity & Membership
Create database migration with club tables (clubs, club_members, club_invites). Build ClubService with CRUD + membership management. Implement role hierarchy (owner/admin/member). Register ClubModule. Auto-create messaging channel on club creation. Validation: clubs can be created, members join/leave, roles managed.

### Phase 2: Club Analysts
Build ClubAnalystService — create club analysts as `market_analysts` rows linked via `club_analysts` junction table. Extend analyst pipeline to include club analysts for club members. Club analyst contracts use existing contract editor with club-scoped API guard. Validation: club admin creates analyst, analyst runs in pipeline, predictions visible only to club members.

### Phase 3: Club Tournaments
Add club membership validation to tournament creation for `scope='club'`. Filter tournament visibility for club members. Club tournament leaderboard and results scoped to club. Validation: club admin creates tournament, only club members can see/enter it.

### Phase 4: Learning Activities
Build ClubActivityService — prediction challenges (create, respond, reveal), consensus polls (create, vote, reveal), strategy journals (create, list). Contrarian spotlight computed when member goes against consensus and wins. Validation: admin creates challenge, members respond, AI analysis revealed, consensus tracked.

### Phase 5: Club Analytics & Post-Mortems
Build ClubAnalyticsService — aggregate win rate, average return, analyst trust (affinity aggregation), learning score (accuracy improvement over time), common mistakes, club style summary. Auto-generate post-mortems for completed club tournaments. Validation: analytics endpoint returns meaningful aggregates, post-mortem summarizes top performer patterns.

### Phase 6: Frontend — Club UI
Build all frontend views: clubs list + discovery, create form, detail page (members, tournaments, analysts, activities, analytics tabs), invite page. Add club store, dashboard card, sidebar navigation. Apply legal disclaimers and educational language. Validation: full user journey works — create club → invite members → create analyst → run tournament → do activities → view analytics.
