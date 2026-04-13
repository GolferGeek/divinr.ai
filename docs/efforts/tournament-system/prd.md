# Tournament System — Product Requirements Document

## 1. Overview

Divinr has a complete AI analysis and paper-trading platform but no social or competitive layer. The tournament system adds a game layer where users compete on paper-trading performance using AI analyst signals. Tournaments are the acquisition and engagement hook — "play the market with AI analysts." This is explicitly a game, not investment advice.

Three tournament scopes serve different social contexts: **System** tournaments (official Divinr events), **Club** tournaments (private to a club's members), and **Invitation** tournaments (user-created, invite-only). Each scope shares the same core entity but differs in who can create and join.

## 2. Goals & Success Criteria

- **Engagement**: Users return daily to check leaderboard positions and execute tournament trades.
- **Acquisition**: Invitation tournaments drive organic growth — users invite friends via shareable links.
- **Retention**: Weekly sprints create a recurring reason to participate.

**Success criteria:**
- Users can create, join, and compete in tournaments across all three scopes.
- Tournament portfolios are fully isolated from main portfolios with identical trading mechanics.
- Live leaderboards update with return %, PnL, win rate, and Sharpe ratio.
- Messaging channels auto-create per tournament; notifications fire at lifecycle events.
- Invitation flow works end-to-end: generate link → share → recipient joins.
- All UI and copy uses game/entertainment language with prominent disclaimers.

## 3. User Stories / Use Cases

**System tournament player:**
A user browses upcoming system tournaments from the dashboard, enters a "Weekly Sprint," receives a fresh tournament portfolio with equal starting balance, queues trades using AI analyst signals, and tracks their rank on the live leaderboard throughout the week.

**Invitation tournament creator:**
A user creates a "Sector Challenge" tournament restricted to tech stocks, gets a shareable invite link, sends it to friends. Friends click the link, see tournament details, and join with one click. A tournament messaging channel is auto-created for trash talk and discussion.

**Club tournament admin:**
A club admin creates a tournament scoped to their club. Only club members can see and join it. The tournament appears in the club's context alongside club messaging channels.

**Tournament lifecycle observer:**
A participant receives notifications 24h and 1h before a tournament starts, when it begins and ends, when their leaderboard position changes, and when final results are announced.

## 4. Technical Requirements

### 4.1 Architecture

The tournament system is a new NestJS module (`TournamentModule`) within the API app, following established patterns:

- **Service layer**: `TournamentService` for CRUD + lifecycle, `TournamentPortfolioService` for isolated portfolio management, `TournamentLeaderboardService` for ranking.
- **Controller**: `TournamentController` under `/tournaments` prefix.
- **Database**: New `prediction.tournaments`, `prediction.tournament_entries`, `prediction.tournament_portfolios`, `prediction.tournament_positions`, `prediction.tournament_trade_queue`, and `prediction.tournament_invites` tables.
- **Integration**: Hooks into existing `MessagingService`, `NotificationService`, and `ObservabilityEventsService`.

All constructor parameters use explicit `@Inject()` per codebase convention.

### 4.2 Data Model Changes

**`prediction.tournaments`**
| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid PK | Tournament ID |
| `name` | text NOT NULL | Display name |
| `description` | text | Optional description |
| `scope` | text NOT NULL | `'system'`, `'club'`, `'invitation'` |
| `scope_id` | uuid | Club ID for club-scope; NULL for system/invitation |
| `tournament_type` | text NOT NULL | `'weekly_sprint'`, `'sector_challenge'`, `'analyst_draft'` |
| `status` | text NOT NULL DEFAULT 'upcoming' | `'upcoming'`, `'active'`, `'completed'`, `'archived'` |
| `created_by` | uuid NOT NULL FK → authz.users | Creator user ID |
| `starting_balance` | numeric NOT NULL | Equal starting balance for all entrants |
| `allowed_instruments` | jsonb | NULL = all instruments; array of instrument IDs for sector-restricted |
| `analyst_draft_config` | jsonb | For analyst_draft type: `{ pick_count: number }` |
| `starts_at` | timestamptz NOT NULL | Tournament start time |
| `ends_at` | timestamptz NOT NULL | Tournament end time |
| `channel_id` | uuid | FK → messaging.channels; set when tournament starts |
| `created_at` | timestamptz DEFAULT now() | |

**`prediction.tournament_entries`**
| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid PK | Entry ID |
| `tournament_id` | uuid NOT NULL FK → tournaments | |
| `user_id` | uuid NOT NULL FK → authz.users | |
| `portfolio_id` | uuid NOT NULL FK → tournament_portfolios | Created on entry |
| `drafted_analysts` | jsonb | For analyst_draft: array of analyst IDs |
| `final_rank` | integer | Set when tournament completes |
| `joined_at` | timestamptz DEFAULT now() | |
| UNIQUE | `(tournament_id, user_id)` | One entry per user per tournament |

**`prediction.tournament_portfolios`**
| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid PK | |
| `tournament_id` | uuid NOT NULL FK → tournaments | |
| `user_id` | uuid NOT NULL FK → authz.users | |
| `initial_balance` | numeric NOT NULL | Matches tournament starting_balance |
| `current_balance` | numeric NOT NULL | |
| `total_realized_pnl` | numeric DEFAULT 0 | |
| `total_unrealized_pnl` | numeric DEFAULT 0 | |
| `created_at` | timestamptz DEFAULT now() | |

**`prediction.tournament_positions`**
| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid PK | |
| `tournament_id` | uuid NOT NULL FK → tournaments | |
| `portfolio_id` | uuid NOT NULL FK → tournament_portfolios | |
| `user_id` | uuid NOT NULL FK → authz.users | |
| `symbol` | text NOT NULL | |
| `direction` | text NOT NULL | `'long'` or `'short'` |
| `quantity` | numeric NOT NULL | |
| `entry_price` | numeric | Set on execution |
| `current_price` | numeric | Updated daily |
| `exit_price` | numeric | Set on close |
| `unrealized_pnl` | numeric DEFAULT 0 | |
| `realized_pnl` | numeric DEFAULT 0 | |
| `status` | text NOT NULL DEFAULT 'open' | `'open'`, `'closed'` |
| `opened_at` | timestamptz | |
| `closed_at` | timestamptz | |

**`prediction.tournament_trade_queue`**
| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid PK | |
| `tournament_id` | uuid NOT NULL FK → tournaments | |
| `portfolio_id` | uuid NOT NULL FK → tournament_portfolios | |
| `user_id` | uuid NOT NULL FK → authz.users | |
| `prediction_id` | uuid | Optional link to prediction |
| `symbol` | text NOT NULL | |
| `direction` | text NOT NULL | |
| `quantity` | numeric NOT NULL | |
| `status` | text NOT NULL DEFAULT 'queued' | `'queued'`, `'executed'`, `'cancelled'` |
| `queued_at` | timestamptz DEFAULT now() | |
| `execution_price` | numeric | Set on execution |
| `executed_at` | timestamptz | |

**`prediction.tournament_invites`**
| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid PK | |
| `tournament_id` | uuid NOT NULL FK → tournaments | |
| `invite_token` | text NOT NULL UNIQUE | Shareable token |
| `invited_by` | uuid NOT NULL FK → authz.users | |
| `invited_user_id` | uuid | NULL for link-based; set for direct invites |
| `invited_email` | text | For email-based invites |
| `status` | text NOT NULL DEFAULT 'pending' | `'pending'`, `'accepted'`, `'expired'` |
| `created_at` | timestamptz DEFAULT now() | |

### 4.3 API Changes

All endpoints under `/tournaments` prefix. Auth required on all routes.

**Tournament CRUD:**
| Method | Path | Description | Access |
|--------|------|-------------|--------|
| `POST` | `/tournaments` | Create tournament | System scope: admin only. Club: club admin. Invitation: any user. |
| `GET` | `/tournaments` | List tournaments | Filterable by `scope`, `status`, `tournament_type`. System tournaments visible to all. Club tournaments visible to club members. Invitation tournaments visible to creator + invitees. |
| `GET` | `/tournaments/:id` | Get tournament detail | Visible if user has access per scope rules |
| `PATCH` | `/tournaments/:id` | Update tournament | Creator or admin only; only `upcoming` status tournaments |
| `POST` | `/tournaments/:id/archive` | Archive completed tournament | Creator or admin |

**Entry & Registration:**
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/tournaments/:id/enter` | Enter tournament (creates portfolio) |
| `GET` | `/tournaments/:id/entries` | List tournament entries |
| `GET` | `/tournaments/me` | List user's active/upcoming tournament entries |

**Trading (mirrors main portfolio endpoints, scoped to tournament):**
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/tournaments/:id/queue-trade` | Queue trade in tournament portfolio |
| `GET` | `/tournaments/:id/positions` | List positions (`?status=open\|closed`) |
| `POST` | `/tournaments/:id/positions/:positionId/close` | Close a position |

**Leaderboard:**
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/tournaments/:id/leaderboard` | Live leaderboard: rank, return %, PnL, win rate, Sharpe |
| `GET` | `/tournaments/:id/results` | Final results (completed tournaments only): winner, top 3, notable stats (best trade, highest Sharpe, biggest comeback) |

**Invitations:**
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/tournaments/:id/invites` | Generate invite link or invite by username/email |
| `GET` | `/tournaments/invite/:token` | Get tournament details from invite token (public) |
| `POST` | `/tournaments/invite/:token/accept` | Accept invite and enter tournament |

**History:**
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/tournaments/history` | User's past tournament results with final standings |

### 4.4 Frontend Changes

**New routes:**
| Route | View | Description |
|-------|------|-------------|
| `/tournaments` | `TournamentsView` | Browse/filter tournaments, enter, create |
| `/tournaments/create` | `TournamentCreateView` | Tournament creation form |
| `/tournaments/:id` | `TournamentDetailView` | Tournament detail: leaderboard, positions, trade queue, chat |
| `/tournaments/:id/results` | `TournamentResultsView` | Final standings for completed tournaments |
| `/tournaments/invite/:token` | `TournamentInviteView` | Invite landing page — tournament preview + join |
| `/tournaments/history` | `TournamentHistoryView` | Personal tournament history |

**New Pinia store:** `useTournamentStore()`
- Tournament list, active tournament state, leaderboard data, trade queue.
- SSE integration for real-time leaderboard updates via `ObservabilityEventsService`.

**Dashboard integration:**
- "Your Tournaments" card on main dashboard showing active entries with rank.
- Tournament navigation item in sidebar.

**Component reuse:**
- Reuse existing portfolio components (position list, trade queue, PnL display) with tournament-scoped data source.
- Reuse messaging components — tournament detail page embeds the existing channel view for the tournament's messaging channel.

**Legal framing in UI:**
- All tournament pages display the disclaimer: "Divinr is an AI analysis game. Virtual portfolios use simulated trades for educational and entertainment purposes. Not investment advice."
- Language throughout: "players" not "investors," "game" not "trading," "virtual balance" not "funds."

### 4.5 Infrastructure Requirements

- **Database migration**: Single migration file creating all tournament tables with indexes on `(tournament_id, user_id)`, `(tournament_id, status)`, and `invite_token`.
- **EOD settlement extension**: The existing EOD settlement process must also execute queued trades in tournament portfolios and update tournament position PnL.
- **Tournament lifecycle cron**: A scheduled job to transition tournament statuses (`upcoming` → `active` at `starts_at`, `active` → `completed` at `ends_at`), fire notifications, create/archive messaging channels.
- **SSE events**: New event types `tournament_leaderboard_updated`, `tournament_status_changed` pushed via `ObservabilityEventsService`.

## 5. Non-Functional Requirements

- **Performance**: Leaderboard queries must complete in <500ms for tournaments with up to 100 entrants. Indexes on `tournament_id` in positions and portfolios tables support this.
- **Data isolation**: Tournament portfolios are completely separate tables from main portfolios. No cross-contamination possible by design (separate tables, not row-level filtering).
- **Security**: Tournament creation respects scope-based access rules. System tournaments require admin role. Invite tokens are cryptographically random (UUIDv4). All mutations check RBAC via `requireWriteAccess()`.
- **Scalability**: Table-per-concern design (separate tournament_positions, tournament_trade_queue) means tournament growth doesn't impact main portfolio query performance.
- **Compatibility**: Follows existing NestJS module patterns, DatabaseService raw SQL access, Vue 3 + Ionic frontend conventions. No new infrastructure dependencies.

## 6. Out of Scope

- **Real money or prizes** — all tournaments use virtual/paper money only. No gambling mechanics.
- **Club entity/membership management** — that's the learning-clubs effort. Tournament entity supports `club` scope from day one, but club CRUD and membership are not built here.
- **Chat or messaging between players** — already shipped. The messaging system handles this; tournaments only integrate by creating scoped channels.
- **Badges and achievements** — future effort, after tournaments prove engagement value.
- **Analyst Draft UI for pick selection** — the `analyst_draft` tournament type stores config and drafted picks, but the interactive draft-pick UI is a follow-up enhancement. Initial implementation allows setting drafted analysts at entry time.

## 7. Dependencies & Risks

**Dependencies:**
- **Messaging system** (shipped): `createChannel('tournament', tournamentId, name)` for auto-creating tournament channels. Already supports `tournament` scope in `ChannelScope` type.
- **Notification system** (shipped): `NotificationService.notify()` for lifecycle events. Requires adding new event types (`tournament_starting`, `tournament_started`, `tournament_ended`, `tournament_rank_change`, `tournament_results`).
- **EOD settlement** (shipped): Must be extended to process `tournament_trade_queue` alongside `user_trade_queue`.
- **Portfolio mechanics** (shipped): Tournament trading mirrors existing queue → execute → position lifecycle. Logic is reimplemented for tournament tables, not shared, to maintain isolation.

**Risks:**
| Risk | Impact | Mitigation |
|------|--------|------------|
| EOD settlement adding tournament processing increases job duration | Medium | Tournament trades processed in a separate pass after main settlement. Monitor execution time. |
| Leaderboard computation for large tournaments becomes slow | Low | Index-backed queries; 100-entrant cap is sufficient for initial launch. Materialized views if needed later. |
| Club scope tournaments created before learning-clubs effort ships | Low | `scope='club'` is supported in the entity, but club validation is deferred. Gate club tournament creation behind a feature check for club existence. |
| Invite token abuse (mass-generated links) | Low | Rate-limit invite creation per user. Tokens expire with tournament. |
| Legal ambiguity around competitive virtual trading | Medium | Prominent disclaimers on all tournament pages. No real money. Language audit: "players," "game," "virtual balance." Terms of service updated. |

## 8. Phasing

### Phase 1: Tournament Entity & Database Foundation
Create the database migration with all tournament tables. Build `TournamentService` with CRUD operations. Implement scope-based access control (system requires admin, invitation open to all users). Register `TournamentModule` in the API. Validation: tournaments can be created, listed, and fetched via API with proper access control.

### Phase 2: Tournament Portfolios & Trading
Build `TournamentPortfolioService` with isolated portfolio creation on tournament entry. Implement tournament-scoped trade queue, position management, and PnL tracking using the same mechanics as the main portfolio system but against tournament tables. Extend EOD settlement to process tournament trade queues. Validation: users can enter a tournament, queue trades, and see positions with correct PnL.

### Phase 3: Leaderboard & Results
Build `TournamentLeaderboardService` computing rank, return %, PnL, win rate, and Sharpe ratio across tournament entries. Implement final results computation when tournament status transitions to `completed`. Expose leaderboard and results API endpoints. Validation: live leaderboard returns correct rankings; completed tournaments show final standings.

### Phase 4: Lifecycle Automation & Notifications
Implement the tournament lifecycle cron job (status transitions at `starts_at`/`ends_at`). Add new notification event types and fire notifications at lifecycle events (starting soon, started, ended, rank change, final results). Integrate messaging — auto-create tournament channel on start, add entrants as members (tournament creator gets `admin` role in the channel for moderation), archive on completion. Validation: tournaments auto-transition, notifications fire, messaging channels are created and populated.

### Phase 5: Invitation Flow
Build invite token generation, invite-by-username/email, and the invite acceptance endpoint. Implement the invite landing page on the frontend showing tournament details with a "Join" button. In-app notification sent to directly invited users. Validation: invite link works end-to-end — generate → share → view → join.

### Phase 6: Frontend — Tournament UI
Build all frontend views: tournament list/browse, create form, detail page (leaderboard + positions + chat), results page, history page. Add tournament store, dashboard card, and sidebar navigation. Embed existing messaging components for tournament chat. Apply legal disclaimers and game-oriented language throughout. Validation: full user journey works in browser — browse → enter → trade → check leaderboard → see results.
