# Curriculum Builder — Product Requirements Document

## 1. Overview

Build a curriculum system that lets club admins create structured multi-week courses within learning clubs. Each curriculum contains weekly modules with sequenced activities (prediction challenges, consensus polls, journal entries, tournaments). Students enroll, progress through weeks with auto-unlock gating, and professors monitor class-wide progress from a dedicated dashboard.

This targets university professors and financial literacy programs who need structured learning paths rather than ad-hoc club activities.

## 2. Goals & Success Criteria

- **G1**: Club admins can create, edit, and delete curricula scoped to their club
- **G2**: Each curriculum contains ordered weekly modules, each with a theme, assigned instruments, and linked activities (challenge, poll, journal prompt, tournament)
- **G3**: Students enroll in a curriculum and see a week-by-week view with completion status
- **G4**: Weeks auto-unlock only when the previous week's required activities are completed
- **G5**: Pre-built curriculum templates exist for common courses (Intro to Markets, Technical Analysis, Fundamental Analysis)
- **G6**: Professors see a class-wide dashboard showing every student's progress, scores, and completion percentage

**Success criteria:**
- A professor can create a 6-week curriculum, enroll 30 students, and track their completion — all within the existing club UI
- Auto-unlock correctly gates students from skipping ahead
- At least 3 curriculum templates ship with the feature

## 3. User Stories / Use Cases

**UC1 — Professor creates a curriculum**: A club admin navigates to their club, opens the Curriculum tab, creates a new curriculum with a name/description and number of weeks. They then configure each week: set a theme, assign instruments, create a challenge, create a poll, set a journal prompt, and optionally link a tournament.

**UC2 — Professor uses a template**: Instead of building from scratch, the admin picks a pre-built template (e.g., "Intro to Markets — 6 Weeks") that pre-fills weeks with themes, instruments, and activity prompts. They can customize before publishing.

**UC3 — Student enrolls and progresses**: A club member sees the active curriculum, enrolls, and lands on Week 1. They complete the challenge, vote in the poll, write a journal entry, and (if linked) participate in the tournament. Once all required activities for Week 1 are done, Week 2 unlocks.

**UC4 — Student views their progress**: The student sees a curriculum progress page showing each week, what's completed, what's pending, and their scores per week.

**UC5 — Professor monitors the class**: The professor opens the curriculum dashboard and sees a table of all enrolled students with columns for each week's completion %, individual activity status, and aggregate scores.

**UC6 — Professor reviews individual student**: The professor clicks on a student row to see their detailed activity responses — challenge predictions, poll votes, journal entries, and tournament performance per week.

## 4. Technical Requirements

### 4.1 Architecture

Follow the existing NestJS module pattern:
- New module: `/apps/api/src/curriculum/` with controller, service, schema service, and types
- Register `CurriculumModule` in `app.module.ts`
- New Pinia store: `/apps/web/src/stores/curriculum.store.ts`
- New views under `/apps/web/src/views/Curriculum*.vue`
- New routes under `/curricula` in the router

All constructor parameters use `@Inject()` per CLAUDE.md convention.

### 4.2 Data Model Changes

New migration: `/apps/api/db/migrations/2026-04-13-curriculum-system.sql`

**`prediction.curricula`**
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | `gen_random_uuid()::text` |
| club_id | TEXT NOT NULL | FK → `prediction.clubs(id)` |
| name | TEXT NOT NULL | |
| description | TEXT | |
| week_count | INTEGER NOT NULL | Number of weeks |
| status | TEXT NOT NULL | CHECK: 'draft', 'active', 'archived' |
| template_source | TEXT | NULL if custom, template slug if cloned |
| created_by | TEXT NOT NULL | User ID of creator |
| created_at | TIMESTAMPTZ | DEFAULT now() |

**`prediction.curriculum_modules`**
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | |
| curriculum_id | TEXT NOT NULL | FK → curricula |
| week_number | INTEGER NOT NULL | 1-indexed |
| theme | TEXT NOT NULL | e.g., "Reading Candlestick Charts" |
| instruments | JSONB NOT NULL | Array of `{symbol, instrument_id}` |
| challenge_id | TEXT | FK → `club_prediction_challenges(id)`, NULL until created |
| poll_id | TEXT | FK → `club_consensus_polls(id)`, NULL until created |
| journal_prompt | TEXT | Prompt text for the week's journal |
| tournament_id | TEXT | FK → `tournaments(id)`, NULL if no tournament |
| created_at | TIMESTAMPTZ | DEFAULT now() |

UNIQUE constraint on `(curriculum_id, week_number)`.

**`prediction.curriculum_enrollments`**
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | |
| curriculum_id | TEXT NOT NULL | FK → curricula |
| user_id | TEXT NOT NULL | |
| current_week | INTEGER NOT NULL | Default 1, highest unlocked week |
| completion_pct | NUMERIC(5,2) | 0.00 – 100.00 |
| enrolled_at | TIMESTAMPTZ | DEFAULT now() |

UNIQUE constraint on `(curriculum_id, user_id)`.

**`prediction.curriculum_module_progress`**
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | |
| enrollment_id | TEXT NOT NULL | FK → enrollments |
| module_id | TEXT NOT NULL | FK → curriculum_modules |
| challenge_completed | BOOLEAN | DEFAULT false |
| poll_completed | BOOLEAN | DEFAULT false |
| journal_completed | BOOLEAN | DEFAULT false |
| tournament_completed | BOOLEAN | DEFAULT false |
| score | NUMERIC(5,2) | Aggregate score for the week |
| completed_at | TIMESTAMPTZ | NULL until all required activities done |

UNIQUE constraint on `(enrollment_id, module_id)`.

**Indexes:**
- `idx_curricula_club` on `curricula(club_id)`
- `idx_curriculum_modules_curriculum` on `curriculum_modules(curriculum_id)`
- `idx_curriculum_enrollments_curriculum` on `curriculum_enrollments(curriculum_id)`
- `idx_curriculum_enrollments_user` on `curriculum_enrollments(user_id)`
- `idx_curriculum_module_progress_enrollment` on `curriculum_module_progress(enrollment_id)`

### 4.3 API Changes

New controller at `POST/GET/PATCH/DELETE /curricula/*`:

**Curriculum CRUD (admin-only):**
| Method | Path | Description |
|--------|------|-------------|
| POST | `/curricula` | Create curriculum (requires `club_id`, `name`, `week_count`) |
| GET | `/curricula?club_id=X` | List curricula for a club |
| GET | `/curricula/:id` | Get curriculum with modules |
| PATCH | `/curricula/:id` | Update name, description, status |
| DELETE | `/curricula/:id` | Delete curriculum (draft only) |

**Module management (admin-only):**
| Method | Path | Description |
|--------|------|-------------|
| PATCH | `/curricula/:id/modules/:weekNumber` | Update module (theme, instruments, link activities) |
| POST | `/curricula/:id/modules/:weekNumber/challenge` | Create challenge for this module |
| POST | `/curricula/:id/modules/:weekNumber/poll` | Create poll for this module |

**Enrollment & progress (member):**
| Method | Path | Description |
|--------|------|-------------|
| POST | `/curricula/:id/enroll` | Enroll current user |
| GET | `/curricula/:id/progress` | Get current user's enrollment + module progress |
| POST | `/curricula/:id/modules/:weekNumber/complete-activity` | Mark an activity type complete (body: `{activity: 'challenge'|'poll'|'journal'|'tournament'}`) |

**Professor dashboard (admin-only):**
| Method | Path | Description |
|--------|------|-------------|
| GET | `/curricula/:id/dashboard` | All enrollments with module progress for every student |
| GET | `/curricula/:id/dashboard/:userId` | Single student's detailed progress |

**Templates:**
| Method | Path | Description |
|--------|------|-------------|
| GET | `/curricula/templates` | List available templates |
| POST | `/curricula/from-template` | Create curriculum from a template (body: `{club_id, template_slug}`) |

### 4.4 Frontend Changes

**New store**: `curriculum.store.ts` — manages curricula list, active curriculum, enrollment, module progress, and dashboard data.

**New views:**
- `CurriculumListView.vue` — shown as a tab within `ClubDetailView.vue`, lists club's curricula
- `CurriculumDetailView.vue` — week-by-week view; for students shows progress + current week activities; for admins shows edit mode
- `CurriculumCreateView.vue` — create form with option to start from template
- `CurriculumDashboardView.vue` — professor's class-wide progress table with drill-down to individual students

**New routes:**
```
/clubs/:clubId/curricula                → CurriculumListView (or tab in ClubDetail)
/clubs/:clubId/curricula/create         → CurriculumCreateView
/clubs/:clubId/curricula/:id            → CurriculumDetailView
/clubs/:clubId/curricula/:id/dashboard  → CurriculumDashboardView
```

**ClubDetailView.vue modification:** Add a "Curriculum" segment/tab alongside existing tabs (members, tournaments, analysts, activities, analytics).

### 4.5 Infrastructure Requirements

No new infrastructure. Uses existing:
- PostgreSQL (Supabase) `prediction` schema
- NestJS API server on port 7100
- Vue/Ionic frontend on port 7101
- Existing auth (JWT + RBAC)

## 5. Non-Functional Requirements

- **Performance**: Dashboard query for 50 students × 12 weeks should return in < 500ms. Use a single JOIN query, not N+1.
- **Security**: Only club admins/owners can create/edit curricula. Members can only enroll and view their own progress. Dashboard is admin-only. All endpoints behind `JwtAuthGuard`.
- **Data integrity**: Auto-unlock logic runs server-side — clients cannot skip weeks by calling the API directly. The `complete-activity` endpoint verifies the activity was actually completed (e.g., challenge response exists) before marking progress.
- **Compatibility**: Works in web (Vue/Ionic), desktop (Electron), and mobile (Capacitor) — all use the same API.

## 6. Out of Scope

- **Grading/rubrics**: No letter grades or rubric-based assessment. Scores are numeric aggregates from activity performance.
- **Due dates per week**: No time-based deadlines on modules — progression is completion-gated, not time-gated.
- **Cross-club curricula**: Curricula are scoped to a single club. No marketplace or sharing between clubs.
- **Custom activity types**: Only the four existing activity types (challenge, poll, journal, tournament). No pluggable activity framework.
- **Notification system**: No email or push notifications for curriculum events. Students check their progress manually.
- **AI-generated curricula**: No LLM integration for auto-generating curriculum content.

## 7. Dependencies & Risks

**Dependencies:**
- Learning clubs (shipped — `prediction.clubs`, `club_members`)
- Club activities (shipped — `club_prediction_challenges`, `club_consensus_polls`, `club_strategy_journals`)
- Tournament system (shipped — `prediction.tournaments`)

**Risks:**
| Risk | Impact | Mitigation |
|------|--------|------------|
| Activity completion verification is fragile — different activity types have different "done" criteria | Students could game progress or get stuck | Define explicit completion rules per type: challenge = response submitted, poll = vote cast, journal = entry exists for the week, tournament = entry joined |
| Template data becomes stale as instruments change | Templates reference symbols that may delist | Templates store instrument symbols, not IDs. Validation on template instantiation warns if a symbol is no longer available |
| Large class dashboards could be slow | Poor professor UX | Single aggregate query with JOINs; add pagination if > 100 students |

## 8. Phasing

### Phase 1 — Data Model & Core CRUD
- Write migration SQL for all 4 tables
- Build `CurriculumSchemaService` (idempotent DDL)
- Build `CurriculumService` with create, read, update, delete for curricula and module configuration
- Build `CurriculumController` with admin CRUD endpoints
- Register `CurriculumModule` in `app.module.ts`
- **Gate**: All CRUD endpoints work via curl/Postman. Schema creates cleanly.

### Phase 2 — Enrollment & Progress Tracking
- Add enrollment endpoints (enroll, get progress)
- Implement `complete-activity` with server-side verification per activity type
- Implement auto-unlock logic: when all required activities in a week are complete, increment `current_week` and create next module's progress row
- Recalculate `completion_pct` on each activity completion
- **Gate**: A test user can enroll, complete Week 1 activities, and see Week 2 unlock. Week 2 is inaccessible before completion.

### Phase 3 — Professor Dashboard API
- Build dashboard endpoint returning all enrollments with per-module progress
- Build student detail endpoint with activity responses (challenge predictions, poll votes, journal text, tournament rank)
- **Gate**: Dashboard endpoint returns correct aggregated data for multiple enrolled students.

### Phase 4 — Curriculum Templates
- Define 3 template data files (JSON): Intro to Markets (6 weeks), Technical Analysis (8 weeks), Fundamental Analysis (6 weeks)
- Build `from-template` endpoint that clones template into a real curriculum with pre-filled modules
- Build `list templates` endpoint
- **Gate**: Creating from template produces a fully populated curriculum that the admin can customize.

### Phase 5 — Frontend: Curriculum Management
- Create `curriculum.store.ts` with API methods
- Build `CurriculumCreateView.vue` with template picker
- Build `CurriculumDetailView.vue` with week-by-week module editor (admin mode)
- Add "Curriculum" tab to `ClubDetailView.vue`
- Add routes to router
- **Gate**: Admin can create a curriculum (from scratch or template), configure weekly modules, and publish it.

### Phase 6 — Frontend: Student Experience & Dashboard
- Build student mode in `CurriculumDetailView.vue`: week progress, activity links, locked/unlocked states
- Build `CurriculumDashboardView.vue`: student progress table with drill-down
- Wire enrollment flow: enroll button, progress display
- **Gate**: Full flow works — professor creates curriculum, student enrolls, completes activities, weeks unlock, professor sees dashboard.
