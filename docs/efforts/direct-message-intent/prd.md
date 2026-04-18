# Direct Message Intent — Product Requirements Document

## 1. Overview
The Member Profile Drawer (shipped in PR #58) exposes a Message button on every member profile, but the handler (`MemberProfileDrawer.messageUser()`) is a `console.info` stub because the `/messages` view has no bootstrap path for a "new DM with user X" intent. This effort wires the Message button end-to-end so that clicking it always lands the caller in a ready-to-type 1:1 DM thread with the target user, reusing any existing DM idempotently.

The server-side plumbing already exists: `MessagingService.getOrCreateDmChannel(userId, targetUserId)` is implemented with self-DM guard, bidirectional block check, and idempotent lookup, and is exposed at `POST /api/messaging/channels/dm`. This effort is therefore primarily a web-side integration with light API test reinforcement.

## 2. Goals & Success Criteria
- Clicking **Message** from either the leaderboard drawer or the MEMBERS card drawer lands the user in a 1:1 DM thread with the target, with the composer visible and focus-ready.
- The flow is idempotent: clicking twice on the same member does not create two channels; both clicks land in the same thread.
- The flow works whether or not a prior DM between the two users exists.
- The user cannot DM themselves: the Message button is disabled with a tooltip when the drawer is showing the caller's own profile.
- All existing messaging quality gates (unit, compliance, lint, build) still pass; DM idempotency coverage is explicit in `messaging-dm.test.ts`.

## 3. User Stories / Use Cases
- **As a club member**, I tap a peer's name on the leaderboard, the profile drawer opens, I tap **Message**, and I'm dropped into a 1:1 DM composer with them.
- **As a club member** who has DM'd that peer before, I tap **Message** and end up back in the existing thread with my prior history intact — no duplicate channel is created.
- **As a user viewing my own profile** from the MEMBERS card, the **Message** button is hidden or disabled (`v-if="!isSelf"` already gates it; this effort keeps that behavior intact and adds a tooltip when disabled is shown).
- **As a blocked user** (either direction), attempting to open a DM returns a clear error instead of silently creating a channel. (Already enforced server-side; the web layer surfaces the error to the user.)

## 4. Technical Requirements

### 4.1 Architecture
- **Client**: Vue 3 + Ionic + Pinia. The `MemberProfileDrawer.vue` triggers a route navigation to `/messages?to=<userId>`. The `MessagesView.vue` detects the `?to=` query param on mount or when the route changes, calls a new `messagingStore.getOrCreateDm(targetUserId)` action, and redirects via `router.replace` to the canonical `/messages/:channelId` URL (reusing the existing `selectChannel` flow that fetches messages, marks read, and shows the composer).
- **Store**: A new `getOrCreateDm(targetUserId)` action in `apps/web/src/stores/messaging.store.ts` that POSTs `/messaging/channels/dm` with `{ target_user_id }`, inserts the returned channel into `channels.value` if not already present, and returns the channel object.
- **API**: No new endpoints. `POST /api/messaging/channels/dm` at `markets.controller.ts:1920` already delegates to `MessagingService.getOrCreateDmChannel`. Test coverage is tightened if gaps are found.

### 4.2 Data Model Changes
None. Uses existing `messaging.channels` (scope='dm'), `messaging.channel_members`, and `messaging.user_blocks` tables.

### 4.3 API Changes
None. The existing endpoint contract is kept:
- **Method/path**: `POST /api/messaging/channels/dm`
- **Auth**: `JwtAuthGuard` at controller level; `requireWriteAccess()` inside the handler (excludes `beta_reader`).
- **Request body**: `{ "target_user_id": "<uuid>" }`
- **Response**: `{ "data": Channel }` where `Channel` has `{ id, scope:'dm', scope_id:null, name:null, is_archived, created_at, unread_count, last_message_body, last_message_at, last_message_sender_id }`.
- **Errors**:
  - `400` `"Cannot create DM with yourself"` when `user.id === target_user_id`.
  - `403` `"Cannot create DM — user is blocked"` when a block exists in either direction.
  - `403` from `requireWriteAccess` when the caller is a `beta_reader`.

### 4.4 Frontend Changes
1. `apps/web/src/stores/messaging.store.ts`
   - Add `async getOrCreateDm(targetUserId: string): Promise<Channel>` that POSTs `/messaging/channels/dm`, adds the returned channel to `channels.value` if its `id` is not already present, and returns the channel.
   - Export it from the store's return block.
2. `apps/web/src/views/MessagesView.vue`
   - In `onMounted`, after `fetchChannels()`, read `route.query.to`. If present and the route's `channelId` param is not set, call `store.getOrCreateDm(to)`, then call `router.replace(/messages/${channel.id})` (which triggers the existing `watch` on `route.params.channelId` to select the channel). Handle errors (self-DM, blocked, auth) with a toast or inline error state — use `console.warn` + keep the user on `/messages` list view if the intent fails so they aren't stranded on a blank page.
   - Extend the `watch(() => route.params.channelId, …)` interaction: the existing watcher handles path-param transitions; the new query-param handling is confined to `onMounted` and a sibling `watch(() => route.query.to, …)` so subsequent `/messages?to=<otherUser>` navigations (e.g., clicking Message on a second peer without leaving the Messages view) also resolve correctly.
3. `apps/web/src/components/MemberProfileDrawer.vue`
   - Replace the `messageUser()` stub body with `router.push({ path: '/messages', query: { to: props.userId } }); emit('close');`.
   - Keep the existing `v-if="!isSelf"` gating on the Message button; additionally surface a disabled Message button with a tooltip (`title="You can't message yourself"`) when `isSelf` is true, so the button still appears but is non-interactive on the user's own profile. Use an Ionic `disabled` + plain `title` attribute (no new dependency).

### 4.5 Infrastructure Requirements
None. Dev ports and services unchanged (API 7100, web 7101, Supabase 7010–7016).

## 5. Non-Functional Requirements
- **Performance**: `getOrCreateDmChannel` executes two small `EXISTS` queries plus optional two inserts in the create path. No perceptible latency impact (<100ms locally).
- **Security**: Auth is enforced by `JwtAuthGuard`; write-access is enforced by `requireWriteAccess()`. Blocks are checked bidirectionally. Self-DM is rejected. No new attack surface.
- **Scalability**: No changes to hot paths or query patterns.
- **Compatibility**: Existing DM channels continue to resolve idempotently via the `EXISTS` lookup on `channel_members`. No migration required.
- **Legal language**: No user-facing copy introduced here references "advice" or "recommendation"; the Message button copy stays as-is.

## 6. Out of Scope
- Group-thread intent (`/messages?to=a,b,c` or similar).
- Pre-seeded message body or attached entity on navigation.
- Blocking, mute, or report flows from the drawer.
- Typing indicators, read receipts beyond the existing mark-as-read call, or presence.
- Moving the Message button into other surfaces (e.g., posts feed, prediction cards).
- Changes to the `messaging.channels` schema or the shape of the DM endpoint response.

## 7. Dependencies & Risks

### Dependencies
- The `POST /messaging/channels/dm` endpoint and `getOrCreateDmChannel` service method (both already shipped).
- `useAuthStore` and `useRouter` in `MemberProfileDrawer.vue` (already imported; `isSelf` computed already exists).
- The existing `MessagesView.vue` `selectChannel` + path-param `watch` flow.

### Risks
- **Risk**: The query-param-to-path-param redirect could race with the existing `fetchChannels` call, causing `selectChannel` to run before the new DM channel is in `store.channels`. **Mitigation**: `getOrCreateDm` action inserts the returned channel into `channels.value` before the `router.replace`, so the subsequent `selectChannel` (via the watcher) finds the channel in the list.
- **Risk**: A second click on the Message button while the first navigation is still in flight could fire two POSTs. **Mitigation**: The endpoint is idempotent server-side (same channel returned); no client-side debounce is required but the drawer emits `close` immediately, removing the button from the DOM.
- **Risk**: A user with `beta_reader` role cannot create DMs due to `requireWriteAccess()`. **Mitigation**: Surface the 403 in the `MessagesView` error handler so the user sees a non-silent failure rather than a blank view. This is acceptable behavior for the beta tier.
- **Risk**: Block errors currently surface as a 403 from the API; the web layer must handle this without dropping the user on an empty `/messages` route. **Mitigation**: On error, log + fall through to the `/messages` list view (the default behavior when no channel is selected).

## 8. Phasing

### Phase 1 — API verification & test hardening
**Objective**: Confirm the existing `getOrCreateDmChannel` endpoint is idempotent, self-guarded, and block-guarded; add any missing coverage.

**What**: Audit `apps/api/tests/unit/messaging-dm.test.ts`. Ensure there are explicit assertions for (a) idempotent repeat calls returning the same channel id, (b) self-DM throws, (c) bidirectional block throws, (d) `createDmChannel` controller path exercises `requireWriteAccess`. Fill any gaps. No production code changes expected.

**Validation**: `pnpm -C apps/api run test:unit` passes with messaging-dm assertions covering idempotency, self-guard, and block-guard explicitly.

### Phase 2 — Web store action
**Objective**: Add `getOrCreateDm(targetUserId)` to the messaging Pinia store.

**What**: Implement the action in `apps/web/src/stores/messaging.store.ts`. POST to `/messaging/channels/dm` via `useApi().post`, push the channel into `channels.value` if not already present (compare by `id`), return the channel. Export from the store's return block.

**Validation**: `pnpm -C apps/web run lint` and `pnpm -C apps/web run typecheck` pass. Unit smoke: a manual `curl` against the existing endpoint confirms the contract hasn't regressed.

### Phase 3 — MessagesView query-param handler
**Objective**: Make `/messages?to=<userId>` bootstrap a DM and redirect to the canonical path.

**What**: In `MessagesView.vue`, extend `onMounted` to read `route.query.to`, call `store.getOrCreateDm(to)`, then `router.replace(/messages/${channel.id})`. Add a sibling `watch(() => route.query.to, …)` so in-session re-navigation works. Handle errors by logging and leaving the user on the list view.

**Validation**: `pnpm -C apps/web run lint`, `typecheck`, and `build` all pass. Manual Chrome test: navigate directly to `/messages?to=<otherUserId>` → lands in the DM with composer visible; URL replaces to `/messages/:channelId`. Navigate again with a different `to` → opens a different DM.

### Phase 4 — Drawer wiring & self-disabled state
**Objective**: Replace the stub in `MemberProfileDrawer.vue` and polish the self-profile experience.

**What**: Replace `messageUser()` body with `router.push({ path: '/messages', query: { to: props.userId } }); emit('close');`. Keep the `v-if="!isSelf"` gate, and additionally render a disabled Message button with a `title="You can't message yourself"` tooltip when `isSelf` is true (so members viewing their own profile see an explanation rather than a missing button).

**Validation**: `pnpm -C apps/web run lint`, `typecheck`, `build` pass. Manual Chrome test: click a peer's row on the leaderboard → drawer opens → click Message → lands in DM with composer. Click the same peer again → lands in the same channel (no duplicate). Open own profile from MEMBERS card → Message button visible but disabled with tooltip. Repeat from the MEMBERS card entry point in a club.

### Phase 5 — Full-repo gates & ship
**Objective**: Run the repo-wide quality gates, write the completion report, commit, push, open the PR, and notify the user.

**What**: Run `pnpm -C apps/api run test:unit` and `pnpm -C apps/web run lint && typecheck && build`. Repo-wide `pnpm test` sanity check (known pre-existing failures acceptable if they match main baseline). Write `completion-report.md`. Commit with a clear summary, push `effort/direct-message-intent`, open a PR referencing the effort directory. Send completion email via Gmail.

**Validation**: CI-equivalent gates green on the branch. PR exists with full context. Email sent to `golfergeek@gmail.com`.
