# Mentor/Mentee Pairing — Product Requirements Document

## 1. Overview

Build a mentor/mentee system within learning clubs where experienced members can be paired with newer members for guided learning. Mentors are identified by tournament performance, approved by club admins, and matched to mentees (1:3 max). The system auto-creates DM channels for each pairing, provides dashboards for both sides, and tracks mentor effectiveness through quarterly mentee ratings.

This is the retention flywheel — experienced members get recognition and purpose, new members get human guidance alongside AI analysts, and clubs get stickier.

## 2. Goals & Success Criteria

- **G1**: Members meeting eligibility criteria can apply to become mentors; club admins approve/reject
- **G2**: Members can request a mentor within their club; admins match mentors to mentees (1:3 max ratio)
- **G3**: A DM channel is auto-created for each mentor-mentee pairing
- **G4**: Mentors see a dashboard with their mentees' trades, journal entries, and challenge responses
- **G5**: Mentees see their mentor's public journal entries and tournament history
- **G6**: Mentors earn a "Mentor" badge visible on their member card and a mentor leaderboard within the club
- **G7**: Mentees rate mentor helpfulness quarterly; ratings feed the mentor leaderboard

**Success criteria:**
- An admin can approve a mentor, match them with 3 mentees, and all 3 pairings get auto-created DM channels
- The mentor dashboard correctly aggregates mentee activity across challenges, journals, and tournaments
- Quarterly feedback collection completes and updates mentor scores

## 3. User Stories / Use Cases

**UC1 — Member applies to be a mentor**: A club member with strong tournament history navigates to the Mentoring tab and clicks "Apply to Mentor." The system checks eligibility (min 2 completed tournaments in this club, min 50% win rate). If eligible, the application is submitted for admin review.

**UC2 — Admin approves mentor**: A club admin opens the Mentoring admin panel, sees pending mentor applications with the applicant's performance stats, and approves or rejects. Approved mentors get the "Mentor" badge.

**UC3 — Member requests a mentor**: A club member opens the Mentoring tab and clicks "Request a Mentor." The request is visible to club admins.

**UC4 — Admin matches mentor to mentee**: The admin sees pending mentee requests and available mentors (with current mentee count). They select a mentor for each mentee. The system creates a DM channel and notifies both parties.

**UC5 — Mentor reviews mentee progress**: The mentor opens their Mentor Dashboard and sees each mentee's recent activity: challenge responses (direction + thesis), journal entries, and tournament positions/PnL. They can message the mentee directly from the dashboard.

**UC6 — Mentee views mentor**: The mentee sees their assigned mentor's profile: public journal entries, tournament history (ranks, returns), and a "Message Mentor" button.

**UC7 — Quarterly feedback**: Every 90 days from pairing creation, the system prompts the mentee to rate their mentor (1-5 scale + optional comment). Ratings feed the mentor leaderboard.

## 4. Technical Requirements

### 4.1 Architecture

New service within the clubs module: `/apps/api/src/clubs/club-mentor.service.ts`
- No new NestJS module needed — add to existing `ClubModule` as a provider
- Controller endpoints added to `ClubController` under `:id/mentoring/*`
- New Pinia store methods added to `club.store.ts` (or a new `mentor.store.ts`)
- New views: `MentorDashboardView.vue`, mentoring tab content in `ClubDetailView.vue`
- Uses existing `MessagingService.getOrCreateDM()` for auto-DM creation

All constructor parameters use `@Inject()` per CLAUDE.md convention.

### 4.2 Data Model Changes

New migration: `/apps/api/db/migrations/2026-04-13-mentor-system.sql`

**`prediction.club_mentors`** — approved mentors within a club
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | `gen_random_uuid()::text` |
| club_id | TEXT NOT NULL | FK → `prediction.clubs(id)` |
| user_id | TEXT NOT NULL | The mentor's user ID |
| status | TEXT NOT NULL | CHECK: 'pending', 'approved', 'rejected', 'inactive' |
| tournament_count | INTEGER | Snapshot at application time |
| win_rate | NUMERIC(5,2) | Snapshot at application time |
| avg_return_pct | NUMERIC(5,2) | Snapshot at application time |
| applied_at | TIMESTAMPTZ | DEFAULT now() |
| approved_at | TIMESTAMPTZ | NULL until approved |
| approved_by | TEXT | Admin who approved |

UNIQUE constraint on `(club_id, user_id)`.

**`prediction.club_mentor_pairings`** — active mentor-mentee relationships
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | |
| club_id | TEXT NOT NULL | FK → clubs |
| mentor_id | TEXT NOT NULL | FK → club_mentors(id) |
| mentee_user_id | TEXT NOT NULL | |
| dm_channel_id | TEXT | FK → messaging.channels(id), auto-created |
| status | TEXT NOT NULL | CHECK: 'active', 'ended' |
| paired_at | TIMESTAMPTZ | DEFAULT now() |
| ended_at | TIMESTAMPTZ | NULL until ended |

UNIQUE constraint on `(club_id, mentee_user_id)` — one mentor per mentee per club.

**`prediction.club_mentee_requests`** — pending mentee requests
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | |
| club_id | TEXT NOT NULL | FK → clubs |
| user_id | TEXT NOT NULL | The requesting member |
| status | TEXT NOT NULL | CHECK: 'pending', 'matched', 'cancelled' |
| requested_at | TIMESTAMPTZ | DEFAULT now() |

UNIQUE constraint on `(club_id, user_id)`.

**`prediction.club_mentor_feedback`** — quarterly mentee ratings
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | |
| pairing_id | TEXT NOT NULL | FK → club_mentor_pairings(id) |
| mentee_user_id | TEXT NOT NULL | |
| rating | INTEGER NOT NULL | CHECK: 1-5 |
| comment | TEXT | Optional |
| period_label | TEXT NOT NULL | e.g., "2026-Q2" |
| created_at | TIMESTAMPTZ | DEFAULT now() |

UNIQUE constraint on `(pairing_id, period_label)` — one rating per pairing per quarter.

**Indexes:**
- `idx_club_mentors_club` on `club_mentors(club_id)`
- `idx_club_mentors_user` on `club_mentors(user_id)`
- `idx_club_mentor_pairings_club` on `club_mentor_pairings(club_id)`
- `idx_club_mentor_pairings_mentor` on `club_mentor_pairings(mentor_id)`
- `idx_club_mentee_requests_club` on `club_mentee_requests(club_id)`
- `idx_club_mentor_feedback_pairing` on `club_mentor_feedback(pairing_id)`

### 4.3 API Changes

New endpoints under `GET/POST /clubs/:id/mentoring/*`:

**Mentor application (member):**
| Method | Path | Description |
|--------|------|-------------|
| POST | `/clubs/:id/mentoring/apply` | Apply to be a mentor (auto-checks eligibility) |
| GET | `/clubs/:id/mentoring/eligibility` | Check if current user meets mentor criteria |

**Mentee requests (member):**
| Method | Path | Description |
|--------|------|-------------|
| POST | `/clubs/:id/mentoring/request` | Request a mentor |

**Admin management:**
| Method | Path | Description |
|--------|------|-------------|
| GET | `/clubs/:id/mentoring/applications` | List pending mentor applications |
| POST | `/clubs/:id/mentoring/applications/:mentorId/approve` | Approve mentor application |
| POST | `/clubs/:id/mentoring/applications/:mentorId/reject` | Reject mentor application |
| GET | `/clubs/:id/mentoring/requests` | List pending mentee requests |
| POST | `/clubs/:id/mentoring/pair` | Match mentor to mentee (body: `{mentor_id, mentee_user_id}`) |
| POST | `/clubs/:id/mentoring/pairings/:pairingId/end` | End a pairing |

**Views (member):**
| Method | Path | Description |
|--------|------|-------------|
| GET | `/clubs/:id/mentoring/status` | Current user's mentoring status (mentor/mentee/neither, pairings) |
| GET | `/clubs/:id/mentoring/mentor-dashboard` | Mentor's view of all mentees' activity |
| GET | `/clubs/:id/mentoring/my-mentor` | Mentee's view of their mentor |
| GET | `/clubs/:id/mentoring/leaderboard` | Mentor leaderboard (avg rating, mentee count) |

**Feedback (mentee):**
| Method | Path | Description |
|--------|------|-------------|
| POST | `/clubs/:id/mentoring/feedback` | Submit quarterly rating (body: `{pairing_id, rating, comment?}`) |
| GET | `/clubs/:id/mentoring/feedback/pending` | Check if feedback is due |

### 4.4 Frontend Changes

**ClubDetailView.vue modification:** Add "Mentoring" tab to the IonSegment, after Curriculum.

**Mentoring tab content (within ClubDetailView or separate component):**
- **Status section**: Shows current user's mentoring status
  - Not involved → "Apply to Mentor" button (if eligible) + "Request a Mentor" button
  - Pending mentor → "Application pending" status
  - Active mentor → Link to Mentor Dashboard
  - Active mentee → Mentor card with "Message Mentor" button
- **Admin section** (admins only): Pending applications, pending requests, active pairings, pair button
- **Mentor Leaderboard**: All approved mentors ranked by avg rating + mentee count

**New views:**
- `MentorDashboardView.vue` — `/clubs/:clubId/mentoring/dashboard`
  - Cards per mentee showing: recent challenge responses, journal entries, tournament performance
  - "Message" button per mentee linking to DM channel
- Mentee's mentor view embedded in the mentoring tab (no separate route needed)

**Store:** Add mentor methods to `club.store.ts` or create `mentor.store.ts`.

### 4.5 Infrastructure Requirements

No new infrastructure. Uses existing:
- PostgreSQL `prediction` schema
- Messaging system for DM channels
- Existing auth (JWT + RBAC)

## 5. Non-Functional Requirements

- **Performance**: Mentor dashboard aggregates mentee data. Use batch queries (not N+1) — a mentor with 3 mentees should be < 500ms.
- **Security**: Only club admins can approve mentors and create pairings. Mentors can only see their own mentees' data. Mentees can only see their own mentor.
- **Data integrity**: Mentor eligibility is checked server-side at application time with snapshotted metrics. The 1:3 mentor-mentee ratio is enforced server-side.
- **Compatibility**: Works across web, desktop, and mobile.

## 6. Out of Scope

- **Self-pairing**: No automated matching algorithm. Admins manually pair mentors to mentees.
- **Cross-club mentoring**: Mentoring is scoped to a single club. No marketplace.
- **Mentor compensation**: No payment or reward system beyond badges and leaderboard recognition.
- **Video/voice**: No call features. DM text channels only.
- **Mentor training materials**: No content library for mentors. They use their own experience.

## 7. Dependencies & Risks

**Dependencies:**
- Learning clubs (shipped — `prediction.clubs`, `club_members`)
- Messaging system (shipped — `messaging.channels`, `getOrCreateDM`)
- Tournament system (shipped — `tournament_entries`, `tournament_portfolios`, `tournament_positions`)

**Risks:**
| Risk | Impact | Mitigation |
|------|--------|------------|
| Clubs may have no members meeting eligibility criteria | Feature appears empty | Set modest eligibility thresholds (2 tournaments, 50% win rate); show eligibility progress bar for non-eligible members |
| Mentors may not engage with mentees | Mentees get matched but ignored | Quarterly feedback surfaces inactive mentors; admins can end pairings and re-match |
| 1:3 ratio may not be enough for large clubs | Mentee requests pile up | Start with 1:3; can be adjusted per club later if needed |

## 8. Phasing

### Phase 1 — Data Model & Mentor Application
- Write migration SQL for all 4 tables
- Build `ClubMentorService` with eligibility check, apply, approve/reject
- Add endpoints: eligibility, apply, list applications, approve, reject
- **Gate**: Mentor can apply, admin can approve. Eligibility check works.

### Phase 2 — Mentee Requests & Pairing
- Add mentee request endpoints
- Build pairing logic with 1:3 ratio enforcement and auto-DM creation via `MessagingService.getOrCreateDM()`
- Add pair, end-pairing, list-requests endpoints
- **Gate**: Admin can pair mentor to mentee. DM channel auto-created. Ratio enforced.

### Phase 3 — Dashboards & Views
- Build mentor dashboard (aggregates mentee challenges, journals, tournament data)
- Build mentee's mentor view (mentor's journals, tournament history)
- Build status endpoint and mentor leaderboard
- **Gate**: Mentor sees mentee activity. Mentee sees mentor profile. Leaderboard renders.

### Phase 4 — Frontend
- Add "Mentoring" tab to ClubDetailView
- Build mentoring tab content: status, apply/request buttons, admin panel, leaderboard
- Build MentorDashboardView with mentee cards
- Add routes
- **Gate**: Full flow works in browser — apply, approve, request, pair, dashboard, message.

### Phase 5 — Feedback System
- Add quarterly feedback collection: submit rating, check pending
- Build mentor leaderboard scoring (avg rating + mentee count)
- Add feedback UI in mentoring tab
- **Gate**: Mentee can submit rating. Mentor leaderboard reflects ratings.
