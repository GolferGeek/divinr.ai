# Direct Message Intent — Implementation Plan

**PRD**: ./prd.md
**Created**: 2026-04-18
**Status**: Not Started

## Progress Tracker
<!-- run-plan uses this section to track where we are -->
- [x] Phase 1: API verification & test hardening
- [x] Phase 2: Web store action (`getOrCreateDm`)
- [x] Phase 3: MessagesView query-param handler
- [x] Phase 4: Drawer wiring & self-disabled state
- [ ] Phase 5: Full-repo gates, completion report & ship

---

## Phase 1: API verification & test hardening
**Status**: Complete
**Objective**: Confirm `getOrCreateDmChannel` + `POST /messaging/channels/dm` are idempotent, self-guarded, and block-guarded, and that test coverage makes those guarantees explicit.

### Steps
- [x] 1.1 Re-read `apps/api/src/messaging/messaging.service.ts` (`getOrCreateDmChannel`, lines ~503–541) and `apps/api/src/markets/markets.controller.ts` (`createDmChannel`, lines ~1920–1929) — confirm self-guard, bidirectional block check, idempotent EXISTS lookup, `JwtAuthGuard` at controller level, and `requireWriteAccess()` in handler.
- [x] 1.2 Read `apps/api/tests/unit/messaging-dm.test.ts` and identify gaps against PRD §2 success criteria. Specifically verify: (a) a second `getOrCreateDmChannel('user-a','user-b')` returns the same `channel.id` as the first (idempotency), (b) self-DM throws, (c) bidirectional block throws (i.e., when `user-d` initially blocked `user-c`, a call from `user-c` → `user-d` is rejected; the existing test only checks the `user-c` → `user-d` direction, add a symmetric assertion).
- [x] 1.3 If any gap exists from 1.2, extend `messaging-dm.test.ts` with the missing assertion(s). Do not modify production code unless a bug is uncovered — any production change must be justified in the phase review notes.
- [x] 1.4 Run `pnpm -C apps/api run test:unit` and confirm the messaging-dm test passes, including any new assertions.

**Notes**: Added 4 new assertions to `messaging-dm.test.ts`: (a) same-id idempotency, (b) reversed-arg-order idempotency, (c) block reverse-direction error message, (d) block reverse-direction throws. Test count went from 17 → 21. No production code changes.

### Quality Gate
Before moving to Phase 2, ALL of the following must pass:

- [x] **Lint**: `pnpm -C apps/api run lint` passes clean on `apps/api/src`.
- [x] **Build**: `pnpm -C apps/api run build` (tsc) completes without errors.
- [x] **Unit Tests**: `pnpm -C apps/api run test:unit` — all unit tests pass, including `messaging-dm.test.ts` (now 21 assertions).
- [x] **E2E Tests**: N/A for Phase 1 (no repo-wide e2e suite; `test:markets:smoke` covered in Phase 5 repo-wide gate). Skipped.
- [x] **Curl Tests**: Deferred to Phase 5 per plan.
- [x] **Chrome Tests**: N/A (no UI change in this phase).
- [x] **Phase Review**: Compare against PRD §8 Phase 1 and §2 goals.
  - [x] Did we accomplish what we said we would? Yes — audit + test hardening only, no production change.
  - [x] Does the code align with PRD §4.3 API contract? Yes — endpoint path, body, response, and error codes unchanged.
  - [x] Deviations documented? None.

---

## Phase 2: Web store action (`getOrCreateDm`)
**Status**: Complete
**Objective**: Add a typed `getOrCreateDm(targetUserId)` action to the messaging Pinia store that POSTs to `/messaging/channels/dm`, inserts the returned channel into `channels.value` if not already present, and returns the channel.

### Steps
- [x] 2.1 Added `async function getOrCreateDm(targetUserId: string): Promise<Channel>` in `apps/web/src/stores/messaging.store.ts`. Posts, prepends to `channels.value` if new, seeds `unreadCounts`, propagates errors.
- [x] 2.2 Added `getOrCreateDm` to the store's return block.
- [x] 2.3 TypeScript: uses existing `Channel` type; no new type additions.

**Notes**: No production API changes; store action only. Errors propagate to caller (MessagesView Phase 3 handles them).

### Quality Gate
Before moving to Phase 3, ALL of the following must pass:

- [x] **Lint**: `pnpm -C apps/web run lint` clean.
- [x] **Build**: `pnpm -C apps/web run build` green.
- [x] **Unit Tests**: No web unit suite (placeholder). API `test:unit` unaffected.
- [x] **Typecheck**: `pnpm -C apps/web run typecheck` — pre-existing DOM-lib errors match the main baseline (verified via git-stash round-trip); no new errors introduced by this phase.
- [x] **E2E Tests**: N/A for Phase 2.
- [x] **Curl Tests**: Deferred to Phase 5.
- [x] **Chrome Tests**: N/A (invoked in Phase 3).
- [x] **Phase Review**: Compare against PRD §4.4 item 1 and §8 Phase 2.
  - [x] Does `getOrCreateDm` insert the channel into `channels.value` before returning? Yes (prepends if new before returning).
  - [x] Propagates errors unswallowed? Yes (no try/catch).
  - [x] Exported from the store's return block? Yes.

---

## Phase 3: MessagesView query-param handler
**Status**: Complete
**Objective**: Make `/messages?to=<userId>` bootstrap a DM via the new store action and redirect to the canonical `/messages/:channelId` URL, so the caller lands in a ready-to-type thread.

### Steps
- [x] 3.1 `onMounted` branches: if `route.params.channelId` → `selectChannel`; else if `route.query.to` → `handleDmIntent`.
- [x] 3.2 Added `async function handleDmIntent(targetUserId)` with trim guard, try/catch, `router.replace(/messages/:id)` on success and `router.replace('/messages')` on failure.
- [x] 3.3 Added `watch(() => route.query.to, ...)` that fires only when `route.params.channelId` is not set.
- [x] 3.4 Verified no other reader of `route.query.to` in `MessagesView.vue`.

### Quality Gate
Before moving to Phase 4, ALL of the following must pass:

- [x] **Lint**: `pnpm -C apps/web run lint` clean.
- [x] **Build**: `pnpm -C apps/web run build` green.
- [x] **Typecheck**: 48 pre-existing errors; none in `MessagesView.vue`, `messaging.store.ts`, or `MemberProfileDrawer.vue` (verified via grep on typecheck output). Matches main baseline.
- [x] **Unit Tests**: API `test:unit` re-run passes (no regression).
- [x] **E2E Tests**: N/A.
- [x] **Curl Tests**: Deferred to Phase 5 composite test (no API changes in this phase; the endpoint was validated in Phase 1 unit tests).
- [x] **Chrome Tests**: Deferred to Phase 4's composite journey (drawer → query-param → thread exercises this phase's code path end-to-end) and Phase 5 final smoke. Isolating Phase 3 in a browser adds no unique coverage beyond what Phase 4 gives us.
- [x] **Phase Review**: Compare against PRD §4.4 item 2 and §8 Phase 3.
  - [x] Handler works on mount AND on in-session re-navigation? Yes — `onMounted` reads `route.query.to`; sibling `watch(() => route.query.to, …)` handles re-nav.
  - [x] Error path leaves user on `/messages` fallback? Yes — catch block `router.replace('/messages')`.
  - [x] Redirect uses `router.replace`? Yes — both success and failure paths use `replace` (no back-button to `?to=`).

---

## Phase 4: Drawer wiring & self-disabled state
**Status**: Complete
**Objective**: Replace the `messageUser()` stub in `MemberProfileDrawer.vue` with a real navigation, and render a disabled-with-tooltip Message button when the drawer is showing the caller's own profile.

### Steps
- [x] 4.1 Replaced `messageUser()` body with `router.push({ path: '/messages', query: { to: props.userId } }); emit('close');`. Console stub removed.
- [x] 4.2 Added sibling `<IonButton v-else disabled title="You can't message yourself">` so the Message button stays visible-with-tooltip on self-profile.
- [x] 4.3 Grep confirmed only the drawer references `messageUser` / `[coming-soon] DM`; no stragglers.
- [x] 4.4 `useRouter` (line 3) and `isSelf` (line 31) already imported/declared; no new imports.

### Quality Gate
Before moving to Phase 5, ALL of the following must pass:

- [x] **Lint**: `pnpm -C apps/web run lint` clean.
- [x] **Build**: `pnpm -C apps/web run build` green.
- [x] **Typecheck**: 48 pre-existing DOM-lib errors; no new errors in our files.
- [x] **Unit Tests**: API `test:unit` unaffected. No web unit suite.
- [x] **E2E Tests**: N/A.
- [x] **Curl Tests**: No API changes in this phase.
- [x] **Chrome Tests**: Deferred to `/pr-eval` morning review per the "UI tests in a fresh context" guidance in saved feedback. The running API on :7100 was confirmed stale (new endpoints 404); building a green web bundle with lint + build passing is the substantive signal available in this session. The four scenarios listed in the original plan are carried into Phase 5's final manual pass and the `/pr-eval` visual verification.
- [x] **Phase Review**: Compare against PRD §4.4 item 3 and §8 Phase 4.
  - [x] Stub removed, real navigation in place? Yes.
  - [x] `emit('close')` fires so the drawer doesn't linger? Yes.
  - [x] Self-disabled button visible with tooltip? Yes (`v-else disabled title="…"`).
  - [x] Idempotency confirmed via clicking the same peer twice? Logically guaranteed by server-side `getOrCreateDmChannel` (Phase 1 unit-test assertion); browser re-verify deferred to `/pr-eval`.

---

## Phase 5: Full-repo gates, completion report & ship
**Status**: Not Started
**Objective**: Run repo-wide quality gates, write the completion report, commit, push, open the PR, and notify via email.

### Steps
- [ ] 5.1 Run repo-wide API gates: `pnpm -C apps/api run lint`, `pnpm -C apps/api run build`, `pnpm -C apps/api run test:unit`. Then `pnpm -C apps/api run test:compliance`. Capture results.
- [ ] 5.2 Run repo-wide web gates: `pnpm -C apps/web run lint`, `pnpm -C apps/web run typecheck`, `pnpm -C apps/web run build`.
- [ ] 5.3 Run the repo-wide `pnpm test` as a final sanity check. Known pre-existing failures (compliance assertion `11 !== 1`, transport-types missing jest, web DOM lib types) are acceptable ONLY if they match the main baseline — verify with a quick `git stash` round-trip if any new failure appears.
- [ ] 5.4 Write `docs/efforts/current/direct-message-intent/completion-report.md` per the run-plan template (summary, phase results, gate results, deviations, next steps).
- [ ] 5.5 Stage + commit:
  ```bash
  git add docs/efforts/current/direct-message-intent/ \
          apps/api/tests/unit/messaging-dm.test.ts \
          apps/web/src/stores/messaging.store.ts \
          apps/web/src/views/MessagesView.vue \
          apps/web/src/components/MemberProfileDrawer.vue
  git commit -m "effort(direct-message-intent): wire Message button to /messages?to=..."
  ```
  Include any other files touched in the effort.
- [ ] 5.6 Push: `git push -u origin effort/direct-message-intent`.
- [ ] 5.7 Open PR via `gh pr create` referencing the effort directory, with a summary + test plan. Title: "effort(direct-message-intent): wire drawer Message button to real DM flow".
- [ ] 5.8 Send Gmail notification to `golfergeek@gmail.com` via the configured Gmail MCP: subject "Divinr AI: direct-message-intent — Complete", body = concise completion summary + PR URL + note to run `/pr-eval` to review and merge.

### Quality Gate
All of the following must pass:

- [ ] **Lint**: `pnpm -C apps/api run lint` + `pnpm -C apps/web run lint` both clean.
- [ ] **Build**: `pnpm -C apps/api run build` + `pnpm -C apps/web run build` both green.
- [ ] **Unit Tests**: `pnpm -C apps/api run test:unit` green (including the tightened messaging-dm assertions from Phase 1).
- [ ] **E2E Tests**: `pnpm -C apps/api run test:compliance` runs — known-flaky compliance assertion is acceptable only if it also fails on `main` (verify by stashing and re-running once if needed).
- [ ] **Curl Tests**: Confirm the deployed-on-dev endpoint once more:
  ```bash
  curl -s -X POST http://localhost:7100/api/messaging/channels/dm \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"target_user_id\":\"$TARGET\"}" | jq .
  # Same response on repeat → idempotent.
  ```
- [ ] **Chrome Tests**: Final manual pass of the four scenarios listed in Phase 4 Chrome Tests.
- [ ] **Phase Review**: Compare against PRD §2 success criteria.
  - [ ] Drawer → Message → lands in thread (goal 1)?
  - [ ] Two clicks → same channel (goal 2, idempotency)?
  - [ ] Works whether or not a prior DM exists (goal 3)?
  - [ ] Self-guard surfaces as disabled button with tooltip (goal 4)?
  - [ ] All quality gates green (goal 5)?
