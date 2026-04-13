# Mentor/Mentee Pairing — Implementation Plan

**PRD**: ./prd.md
**Created**: 2026-04-13
**Status**: Not Started

## Progress Tracker
- [ ] Phase 1: Data Model & Mentor Application
- [ ] Phase 2: Mentee Requests & Pairing
- [ ] Phase 3: Dashboards & Views API
- [ ] Phase 4: Frontend
- [ ] Phase 5: Feedback System

---

## Phase 1: Data Model & Mentor Application
**Status**: Not Started
**Objective**: Create database tables, mentor service with eligibility checking, and mentor application/approval endpoints.

### Steps
- [ ] 1.1 Write migration SQL `/apps/api/db/migrations/2026-04-13-mentor-system.sql` with all 4 tables (`prediction.club_mentors`, `prediction.club_mentor_pairings`, `prediction.club_mentee_requests`, `prediction.club_mentor_feedback`), indexes, and constraints per PRD §4.2
- [ ] 1.2 Add DDL for all 4 tables to `ClubSchemaService.ensureSchema()` in `/apps/api/src/clubs/club-schema.service.ts`
- [ ] 1.3 Create `/apps/api/src/clubs/club-mentor.service.ts` with methods:
  - `checkEligibility(clubId, userId)` — queries `tournament_entries` + `tournament_positions` for this user in club-scoped tournaments. Returns `{eligible, tournament_count, win_rate, avg_return_pct, reasons[]}`
  - `applyToMentor(clubId, userId)` — checks eligibility, inserts `club_mentors` row with status='pending' and snapshotted metrics
  - `listApplications(clubId, userId)` — admin-only, returns pending applications with user display names
  - `approveApplication(clubId, mentorId, userId)` — admin-only, sets status='approved', records approved_by and approved_at
  - `rejectApplication(clubId, mentorId, userId)` — admin-only, sets status='rejected'
  - All constructors use `@Inject()` per CLAUDE.md
- [ ] 1.4 Register `ClubMentorService` as a provider in `/apps/api/src/clubs/club.module.ts`
- [ ] 1.5 Add controller endpoints to `/apps/api/src/clubs/club.controller.ts`:
  - `GET /clubs/:id/mentoring/eligibility`
  - `POST /clubs/:id/mentoring/apply`
  - `GET /clubs/:id/mentoring/applications` (admin-only)
  - `POST /clubs/:id/mentoring/applications/:mentorId/approve` (admin-only)
  - `POST /clubs/:id/mentoring/applications/:mentorId/reject` (admin-only)
- [ ] 1.6 Build and lint: `cd apps/api && pnpm run build && pnpm run lint`

### Quality Gate
Before moving to Phase 2, ALL of the following must pass:

- [ ] **Lint**: `cd apps/api && pnpm run lint` — no errors
- [ ] **Build**: `cd apps/api && pnpm run build` — no TypeScript errors
- [ ] **Unit Tests**: `cd apps/api && pnpm run test:unit` — no regressions (pre-existing failure accepted)
- [ ] **Curl Tests** (API on port 7100):
  ```bash
  # Check eligibility
  curl -s "http://localhost:7100/clubs/<club_id>/mentoring/eligibility" \
    -H "Authorization: Bearer $TOKEN"
  # → 200, {eligible: true/false, tournament_count, win_rate, avg_return_pct, reasons}

  # Apply to be mentor
  curl -s -X POST "http://localhost:7100/clubs/<club_id>/mentoring/apply" \
    -H "Authorization: Bearer $TOKEN"
  # → 201, mentor row with status='pending'

  # List applications (as admin)
  curl -s "http://localhost:7100/clubs/<club_id>/mentoring/applications" \
    -H "Authorization: Bearer $ADMIN_TOKEN"
  # → 200, array of pending applications

  # Approve
  curl -s -X POST "http://localhost:7100/clubs/<club_id>/mentoring/applications/<mentor_id>/approve" \
    -H "Authorization: Bearer $ADMIN_TOKEN"
  # → 200, {approved: true}

  # Reject (create another application first)
  curl -s -X POST "http://localhost:7100/clubs/<club_id>/mentoring/applications/<mentor_id>/reject" \
    -H "Authorization: Bearer $ADMIN_TOKEN"
  # → 200, {rejected: true}
  ```
- [ ] **Phase Review**:
  - [ ] All 4 tables create cleanly via schema service
  - [ ] Eligibility checks tournament count and win rate against thresholds
  - [ ] Application snapshots metrics at apply time
  - [ ] Admin-only access enforced on approve/reject
  - [ ] `@Inject()` used on all constructor params

---

## Phase 2: Mentee Requests & Pairing
**Status**: Not Started
**Objective**: Add mentee request flow, admin pairing with 1:3 ratio enforcement, and auto-DM channel creation.

### Steps
- [ ] 2.1 Add methods to `club-mentor.service.ts`:
  - `requestMentor(clubId, userId)` — inserts `club_mentee_requests` row with status='pending'; rejects if already has an active pairing or pending request
  - `listRequests(clubId, userId)` — admin-only, returns pending mentee requests with user display names
  - `pairMentorToMentee(clubId, mentorId, menteeUserId, adminUserId)` — validates: mentor is approved, mentor has < 3 active mentees, mentee has pending request. Creates pairing row, creates DM channel via `MessagingService.getOrCreateDM()`, updates mentee request status to 'matched'
  - `endPairing(clubId, pairingId, adminUserId)` — admin-only, sets pairing status='ended' and ended_at
  - `getActivePairingCount(mentorId)` — helper to enforce 1:3 ratio
- [ ] 2.2 Add controller endpoints:
  - `POST /clubs/:id/mentoring/request`
  - `GET /clubs/:id/mentoring/requests` (admin-only)
  - `POST /clubs/:id/mentoring/pair` (admin-only, body: `{mentor_id, mentee_user_id}`)
  - `POST /clubs/:id/mentoring/pairings/:pairingId/end` (admin-only)
- [ ] 2.3 Inject `MessagingService` into `ClubMentorService` for DM creation
- [ ] 2.4 Build and lint

### Quality Gate
Before moving to Phase 3, ALL of the following must pass:

- [ ] **Lint**: `cd apps/api && pnpm run lint` — no errors
- [ ] **Build**: `cd apps/api && pnpm run build` — no TypeScript errors
- [ ] **Unit Tests**: no regressions
- [ ] **Curl Tests**:
  ```bash
  # Request a mentor (as member)
  curl -s -X POST "http://localhost:7100/clubs/<club_id>/mentoring/request" \
    -H "Authorization: Bearer $MEMBER_TOKEN"
  # → 201, mentee request with status='pending'

  # List requests (as admin)
  curl -s "http://localhost:7100/clubs/<club_id>/mentoring/requests" \
    -H "Authorization: Bearer $ADMIN_TOKEN"
  # → 200, array of pending requests

  # Pair mentor to mentee
  curl -s -X POST "http://localhost:7100/clubs/<club_id>/mentoring/pair" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"mentor_id":"<mentor_id>","mentee_user_id":"<mentee_user_id>"}'
  # → 201, pairing with dm_channel_id populated

  # Verify DM channel exists
  curl -s "http://localhost:7100/messages" \
    -H "Authorization: Bearer $MEMBER_TOKEN"
  # → should include the auto-created DM channel

  # Try pairing a 4th mentee → rejected (1:3 ratio)
  curl -s -X POST "http://localhost:7100/clubs/<club_id>/mentoring/pair" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"mentor_id":"<mentor_id>","mentee_user_id":"<fourth_mentee>"}'
  # → 400, "Mentor already has 3 active mentees"

  # End pairing
  curl -s -X POST "http://localhost:7100/clubs/<club_id>/mentoring/pairings/<pairing_id>/end" \
    -H "Authorization: Bearer $ADMIN_TOKEN"
  # → 200, {ended: true}
  ```
- [ ] **Phase Review**:
  - [ ] Mentee request creates correctly
  - [ ] Pairing creates with auto-DM channel
  - [ ] 1:3 ratio enforced server-side
  - [ ] Admin-only access on pair/end
  - [ ] Mentee request status updates to 'matched' on pairing

---

## Phase 3: Dashboards & Views API
**Status**: Not Started
**Objective**: Build mentor dashboard, mentee's mentor view, mentoring status, and mentor leaderboard endpoints.

### Steps
- [ ] 3.1 Add methods to `club-mentor.service.ts`:
  - `getMentoringStatus(clubId, userId)` — returns: is user a mentor (and their mentees)? is user a mentee (and their mentor)? pending applications/requests?
  - `getMentorDashboard(clubId, userId)` — returns mentor's active mentees with aggregated activity: recent challenge responses (from `club_challenge_responses`), journal entries (from `club_strategy_journals`), tournament performance (from `tournament_entries` + `tournament_portfolios`). Use batch queries, not N+1.
  - `getMyMentor(clubId, userId)` — returns mentee's mentor info: display name, public journal entries, tournament history (ranks + returns), DM channel ID
  - `getMentorLeaderboard(clubId)` — returns all approved mentors ranked by: avg feedback rating (primary), active mentee count (secondary). Includes display name, mentee count, avg rating, badge
- [ ] 3.2 Add controller endpoints:
  - `GET /clubs/:id/mentoring/status`
  - `GET /clubs/:id/mentoring/mentor-dashboard`
  - `GET /clubs/:id/mentoring/my-mentor`
  - `GET /clubs/:id/mentoring/leaderboard`
- [ ] 3.3 Ensure mentor dashboard uses batch queries (challenge_ids → responses, journal user_ids, tournament user_ids) rather than per-mentee loops
- [ ] 3.4 Build and lint

### Quality Gate
Before moving to Phase 4, ALL of the following must pass:

- [ ] **Lint**: `cd apps/api && pnpm run lint` — no errors
- [ ] **Build**: `cd apps/api && pnpm run build` — no TypeScript errors
- [ ] **Unit Tests**: no regressions
- [ ] **Curl Tests**:
  ```bash
  # Mentoring status
  curl -s "http://localhost:7100/clubs/<club_id>/mentoring/status" \
    -H "Authorization: Bearer $TOKEN"
  # → 200, {is_mentor: true/false, is_mentee: true/false, mentor_info: {...}, mentees: [...], pending_application: {...}}

  # Mentor dashboard (as mentor)
  curl -s "http://localhost:7100/clubs/<club_id>/mentoring/mentor-dashboard" \
    -H "Authorization: Bearer $MENTOR_TOKEN"
  # → 200, {mentees: [{user_id, display_name, challenges: [...], journals: [...], tournaments: [...], dm_channel_id}]}

  # My mentor (as mentee)
  curl -s "http://localhost:7100/clubs/<club_id>/mentoring/my-mentor" \
    -H "Authorization: Bearer $MENTEE_TOKEN"
  # → 200, {mentor: {user_id, display_name, journals: [...], tournaments: [...], dm_channel_id}}

  # Leaderboard
  curl -s "http://localhost:7100/clubs/<club_id>/mentoring/leaderboard" \
    -H "Authorization: Bearer $TOKEN"
  # → 200, array of mentors with avg_rating, mentee_count, display_name
  ```
- [ ] **Phase Review**:
  - [ ] Status endpoint returns correct state for mentor, mentee, and uninvolved users
  - [ ] Mentor dashboard aggregates mentee activity with batch queries
  - [ ] Mentee view shows mentor's public data
  - [ ] Leaderboard returns mentors ranked by rating

---

## Phase 4: Frontend
**Status**: Not Started
**Objective**: Build the Mentoring tab in ClubDetailView, MentorDashboardView, and mentor store.

### Steps
- [ ] 4.1 Create `/apps/web/src/stores/mentor.store.ts` with:
  - State: `status`, `applications`, `requests`, `leaderboard`, `dashboard`, `myMentor`, `loading`, `error`
  - Methods: `fetchStatus(clubId)`, `checkEligibility(clubId)`, `applyToMentor(clubId)`, `requestMentor(clubId)`, `fetchApplications(clubId)`, `approveApplication(clubId, mentorId)`, `rejectApplication(clubId, mentorId)`, `fetchRequests(clubId)`, `pairMentor(clubId, mentorId, menteeUserId)`, `endPairing(clubId, pairingId)`, `fetchDashboard(clubId)`, `fetchMyMentor(clubId)`, `fetchLeaderboard(clubId)`
  - Base URL: `/api/clubs` with mentoring sub-paths
- [ ] 4.2 Add "Mentoring" tab to `ClubDetailView.vue`:
  - New `IonSegmentButton` value `'mentoring'`
  - Tab content loads mentoring status on tab switch
- [ ] 4.3 Build mentoring tab content:
  - **Status section**: "Apply to Mentor" button (if eligible, not applied), "Request a Mentor" button (if not mentee), "Application Pending", "Active Mentor — View Dashboard", "Your Mentor: [name] — Message"
  - **Admin section** (admins only): pending applications list with approve/reject buttons, pending requests list, active pairings list with "Pair" button and "End" button
  - **Leaderboard section**: mentor cards ranked by avg rating
- [ ] 4.4 Create `/apps/web/src/views/MentorDashboardView.vue`:
  - Cards per mentee: display name, recent challenge responses (direction + thesis), recent journal entries, tournament performance (rank, return %)
  - "Message" button per mentee linking to `/messages/<dm_channel_id>`
- [ ] 4.5 Add routes to `/apps/web/src/router/index.ts`:
  - `{ path: 'clubs/:clubId/mentoring/dashboard', name: 'mentor-dashboard', component: () => import('../views/MentorDashboardView.vue') }`
- [ ] 4.6 Typecheck and build: `cd apps/web && pnpm run build`

### Quality Gate
Before moving to Phase 5, ALL of the following must pass:

- [ ] **Lint**: `cd apps/web && pnpm run lint` — no errors
- [ ] **Build**: `cd apps/web && pnpm run build` — no errors
- [ ] **Typecheck**: pre-existing errors only; no new errors from mentoring code
- [ ] **Unit Tests**: `cd apps/api && pnpm run test:unit` — no regressions
- [ ] **Chrome Tests** (frontend on port 7101, both users in club):
  - [ ] Navigate to club → "Mentoring" tab appears
  - [ ] Click Mentoring tab → shows status with Apply/Request buttons
  - [ ] Apply to Mentor → status changes to "Application Pending"
  - [ ] Admin view shows pending application → Approve → mentor badge appears
  - [ ] Member requests mentor → admin sees request → admin pairs → DM created
  - [ ] Mentor Dashboard link → shows mentee cards
  - [ ] Mentee sees mentor card with "Message Mentor" button
  - [ ] Leaderboard shows approved mentors
- [ ] **Phase Review**:
  - [ ] Store methods cover all API endpoints
  - [ ] Mentoring tab integrated into ClubDetailView
  - [ ] Admin panel shows applications, requests, pairings
  - [ ] MentorDashboardView shows mentee activity
  - [ ] Routes work with proper parameter passing

---

## Phase 5: Feedback System
**Status**: Not Started
**Objective**: Add quarterly feedback collection, mentor leaderboard scoring from ratings, and feedback UI.

### Steps
- [ ] 5.1 Add methods to `club-mentor.service.ts`:
  - `checkPendingFeedback(clubId, userId)` — returns pairings where the current quarter has no feedback and pairing is > 90 days old or in a new quarter since last feedback
  - `submitFeedback(clubId, pairingId, userId, rating, comment?)` — validates: user is the mentee in this pairing, no duplicate for this quarter. Inserts `club_mentor_feedback` row with computed `period_label` (e.g., "2026-Q2")
- [ ] 5.2 Update `getMentorLeaderboard` to compute avg_rating from `club_mentor_feedback` table
- [ ] 5.3 Add controller endpoints:
  - `GET /clubs/:id/mentoring/feedback/pending`
  - `POST /clubs/:id/mentoring/feedback` (body: `{pairing_id, rating, comment?}`)
- [ ] 5.4 Add store methods: `fetchPendingFeedback(clubId)`, `submitFeedback(clubId, pairingId, rating, comment?)`
- [ ] 5.5 Add feedback UI in mentoring tab: prompt banner when feedback is pending, rating form (1-5 stars + optional comment)
- [ ] 5.6 Build and lint both API and web

### Quality Gate
ALL of the following must pass:

- [ ] **Lint**: both `apps/api` and `apps/web` lint clean
- [ ] **Build**: both build clean
- [ ] **Unit Tests**: no regressions
- [ ] **Curl Tests**:
  ```bash
  # Check pending feedback
  curl -s "http://localhost:7100/clubs/<club_id>/mentoring/feedback/pending" \
    -H "Authorization: Bearer $MENTEE_TOKEN"
  # → 200, array of pairings needing feedback (or empty)

  # Submit feedback
  curl -s -X POST "http://localhost:7100/clubs/<club_id>/mentoring/feedback" \
    -H "Authorization: Bearer $MENTEE_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"pairing_id":"<pairing_id>","rating":4,"comment":"Very helpful"}'
  # → 201, feedback row

  # Duplicate → rejected
  curl -s -X POST "http://localhost:7100/clubs/<club_id>/mentoring/feedback" \
    -H "Authorization: Bearer $MENTEE_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"pairing_id":"<pairing_id>","rating":5}'
  # → 400, "Already submitted feedback for this quarter"

  # Leaderboard now includes avg rating
  curl -s "http://localhost:7100/clubs/<club_id>/mentoring/leaderboard" \
    -H "Authorization: Bearer $TOKEN"
  # → 200, mentors with avg_rating reflecting submitted feedback
  ```
- [ ] **Chrome Tests**:
  - [ ] Mentoring tab shows feedback prompt when due
  - [ ] Submit rating → prompt disappears, leaderboard updates
- [ ] **Phase Review**:
  - [ ] Quarterly feedback period computed correctly
  - [ ] Duplicate prevention per quarter works
  - [ ] Leaderboard reflects feedback ratings
  - [ ] All PRD success criteria met: apply, approve, request, pair, DM, dashboard, feedback
