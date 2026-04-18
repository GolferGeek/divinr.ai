# Direct Message Intent — Completion Report

**Plan**: ./plan.md
**PRD**: ./prd.md
**Completed**: 2026-04-18
**Final Status**: All Phases Complete

## Summary
- Total phases: 5
- Phases completed: 5
- Phases remaining: 0

## Phase Results

### Phase 1 — API verification & test hardening
**Status**: Complete. Audited `MessagingService.getOrCreateDmChannel` (service) and `POST /messaging/channels/dm` (controller) — self-guard, bidirectional block check, idempotent EXISTS lookup, `JwtAuthGuard`, and `requireWriteAccess()` all in place. Added 4 assertions to `apps/api/tests/unit/messaging-dm.test.ts`: same-id idempotency, reversed-arg-order idempotency, symmetric (reverse-direction) block error, and block reverse-direction throws. Test count: 17 → 21. No production code changes.

### Phase 2 — Web store action (`getOrCreateDm`)
**Status**: Complete. Added `async getOrCreateDm(targetUserId): Promise<Channel>` to `apps/web/src/stores/messaging.store.ts`. Posts to `/messaging/channels/dm`, prepends the returned channel into `channels.value` if its id is not already present, seeds `unreadCounts[channel.id] ??= 0`, propagates errors to the caller. Exported from the store.

### Phase 3 — MessagesView query-param handler
**Status**: Complete. Added `handleDmIntent(targetUserId)` to `apps/web/src/views/MessagesView.vue`: calls the store action, `router.replace` to `/messages/:channelId` on success, `router.replace('/messages')` with a console.warn on failure. Wired into `onMounted` (branches on `channelId` path param first, then `?to=` query param) and added a sibling `watch(() => route.query.to, ...)` that fires only when no channel-id path param is present, so in-session re-navigation resolves correctly.

### Phase 4 — Drawer wiring & self-disabled state
**Status**: Complete. Replaced `messageUser()` console-stub body in `apps/web/src/components/MemberProfileDrawer.vue` with `router.push({ path: '/messages', query: { to: props.userId } }); emit('close');`. Added a sibling `<IonButton v-else disabled title="You can't message yourself">` so self-profile drawers display a visible-but-disabled Message button with a tooltip instead of an absent button.

### Phase 5 — Full-repo gates, completion report & ship
**Status**: Complete. API lint + build + `test:unit` green. Web lint + build green. Pre-existing baseline issues (compliance `11 !== 1`, web DOM-lib typecheck errors) verified unchanged via git-stash round-trip.

## Gate Results
- **API lint/build/test:unit**: Clean across all phases.
- **API compliance**: Same `11 !== 1` failure as main baseline (pre-existing; not a regression).
- **Web lint/build**: Clean across all phases.
- **Web typecheck**: 48 pre-existing DOM-lib/Ionic typing errors (matches main); no new errors in `MessagesView.vue`, `messaging.store.ts`, or `MemberProfileDrawer.vue`.
- **Chrome tests**: Deferred to `/pr-eval` morning review per user's saved guidance ("UI tests should run in a fresh context, not bolted onto long backend sessions").

## Deviations from PRD
- **Phase 3 & 4 Chrome tests deferred**: The API dev server on :7100 was found running a stale build (new endpoints 404), and spinning up a fresh stack inside this long backend session would violate the user's stated workflow preference. Build + lint + code-review signal was used for in-session gating; full four-scenario browser verification moves to `/pr-eval`.
- No deviations in code behavior from what the PRD specified.

## Next Steps
The PR is ready for `/pr-eval` in the morning. Suggested browser scenarios to verify then:
1. Leaderboard → peer row → drawer → **Message** → lands in `/messages/:channelId` with composer visible.
2. Same peer again → same channel id (no duplicate).
3. MEMBERS card → own row → drawer → **Message** button visible-but-disabled with tooltip.
4. Error path: `/messages?to=<self-uuid>` → falls back to `/messages` list view with console.warn.
