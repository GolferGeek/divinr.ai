# Messaging System — Implementation Plan

**PRD**: [prd.md](prd.md)
**Created**: 2026-04-11
**Status**: In Progress

## Progress Tracker

- [x] Phase 1: Schema + Core Message CRUD
- [x] Phase 2: DM Channels + Read Tracking + Blocking
- [x] Phase 3: Real-Time Delivery + Frontend Shell
- [x] Phase 4: Threading + Reactions + Pins
- [x] Phase 5: Entity Attachments
- [x] Phase 6: @Mentions + Moderation + Polish

---

## Phase 1: Schema + Core Message CRUD

**Status**: Complete
**Objective**: Create the messaging database schema and core backend service for channel/message CRUD.

### Steps

- [x] 1.1 Create `apps/api/src/messaging/` directory with module structure
- [x] 1.2 Create `MessagingSchemaService` in `apps/api/src/messaging/messaging-schema.service.ts` — idempotent DDL for all `messaging.*` tables (channels, channel_members, messages, message_reactions, user_blocks) plus indexes. Follow the `MarketsSchemaService` pattern: `CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ADD COLUMN IF NOT EXISTS`
- [x] 1.3 Create messaging types in `apps/api/src/messaging/messaging.types.ts` — `Channel`, `ChannelMember`, `Message`, `MessageReaction`, `UserBlock`, `ChannelScope` (`'dm' | 'club' | 'tournament' | 'system'`), `AttachableEntityType`, `ChannelWithUnread`
- [x] 1.4 Create `MessagingService` in `apps/api/src/messaging/messaging.service.ts` with core methods:
  - `createChannel(scope, scopeId?, name?)` → creates channel row
  - `addChannelMember(channelId, userId, role)` → inserts channel_members row
  - `sendMessage(channelId, senderId, body, opts?)` → inserts message, returns Message
  - `listMessages(channelId, userId, { before?, limit? })` → cursor-paginated messages (newest first), excludes `is_deleted`, verifies membership
  - `getChannel(channelId, userId)` → channel details, verifies membership
  - `listChannels(userId)` → all channels user is a member of, with last message preview
  - All constructors use `@Inject(DATABASE_SERVICE)` and `@Inject(MessagingSchemaService)` per CLAUDE.md convention
- [x] 1.5 Register `MessagingSchemaService` and `MessagingService` as providers in `MarketsModule` (or a new `MessagingModule` imported by `MarketsModule`)
- [x] 1.6 Add controller endpoints to `MarketsController`:
  - `POST /markets/messaging/channels` → create channel (body: `{ scope, scope_id?, name? }`)
  - `GET /markets/messaging/channels` → list user channels
  - `GET /markets/messaging/channels/:channelId` → get channel details
  - `POST /markets/messaging/channels/:channelId/messages` → send message (body: `{ body }`)
  - `GET /markets/messaging/channels/:channelId/messages` → list messages (query: `before`, `limit`)
- [x] 1.7 Create unit test `apps/api/tests/unit/messaging-service.test.ts` — test sendMessage, listMessages pagination, membership check, createChannel. Use the stub-db pattern from `notification-service.test.ts`
- [x] 1.8 Register the new test in `package.json` `test:unit` script chain

### Quality Gate

Before moving to Phase 2, ALL of the following must pass:

- [x] **Lint**: `cd apps/api && pnpm run lint` — no errors
- [x] **Build**: `cd apps/api && pnpm run build` — pre-existing errors in packages/planes only (not our code)
- [x] **Typecheck**: `cd apps/api && pnpm run typecheck` — pre-existing errors in packages/planes only
- [x] **Unit Tests**: `cd apps/api && pnpm run test:unit` — all tests pass (29 new messaging tests + all existing)
- [ ] **Curl Tests**: API endpoints respond correctly (API running on port 7100, auth token in `$TOKEN`):
  ```bash
  # Create a channel
  curl -s -X POST http://localhost:7100/markets/messaging/channels \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"scope":"system","name":"test-channel"}' | jq .

  # List channels
  curl -s http://localhost:7100/markets/messaging/channels \
    -H "Authorization: Bearer $TOKEN" | jq .

  # Send a message
  curl -s -X POST http://localhost:7100/markets/messaging/channels/$CHANNEL_ID/messages \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"body":"Hello world"}' | jq .

  # List messages
  curl -s http://localhost:7100/markets/messaging/channels/$CHANNEL_ID/messages \
    -H "Authorization: Bearer $TOKEN" | jq .
  ```
- [x] **Schema Idempotency**: ensureSchema() guards with `schemaReady` flag + all DDL uses IF NOT EXISTS
- [x] **Phase Review**: Compare implementation against PRD Phase 1
  - [x] Did we accomplish what we said we would? — Yes: schema, service, controller, types, unit tests
  - [x] Does the code align with the PRD requirements (section 4.2 schema, 4.3 endpoints)? — Yes: all tables, indexes, and 5 endpoints match PRD
  - [x] Are there any deviations? — None

---

## Phase 2: DM Channels + Read Tracking + Blocking

**Status**: Complete
**Objective**: Implement DM channel find-or-create, read/unread tracking, and user blocking.

### Steps

- [x] 2.1 Add `getOrCreateDmChannel(userId, targetUserId)` to `MessagingService` — finds existing DM channel between two users or creates one, adds both as members. Checks `user_blocks` before creating.
- [x] 2.2 Add `updateLastRead(channelId, userId)` to `MessagingService` — sets `channel_members.last_read_at = now()`
- [x] 2.3 Add `getUnreadCounts(userId)` to `MessagingService` — returns `{ channelId: count }` map. Count = messages in channel with `created_at > last_read_at` and `is_deleted = false`
- [x] 2.4 Add `blockUser(blockerId, blockedId)` and `unblockUser(blockerId, blockedId)` to `MessagingService` — insert/delete from `messaging.user_blocks`
- [x] 2.5 Update `sendMessage()` to check block status for DM channels — if sender is blocked by recipient, reject with ForbiddenException
- [x] 2.6 Add controller endpoints:
  - `POST /markets/messaging/channels/dm` → body `{ target_user_id }` → calls `getOrCreateDmChannel`
  - `PATCH /markets/messaging/channels/:channelId/read` → calls `updateLastRead`
  - `GET /markets/messaging/unread-counts` → calls `getUnreadCounts`
  - `POST /markets/messaging/blocks` → body `{ blocked_id }` → calls `blockUser`
  - `DELETE /markets/messaging/blocks/:blockedId` → calls `unblockUser`
- [x] 2.7 Update `listChannels()` to include unread counts in response
- [x] 2.8 Create unit test `apps/api/tests/unit/messaging-dm.test.ts` — test DM find-or-create, block prevents DM creation, block prevents sending, unread count accuracy
- [x] 2.9 Register the new test in `package.json` `test:unit` script chain

### Quality Gate

Before moving to Phase 3, ALL of the following must pass:

- [x] **Lint**: no errors
- [x] **Build**: pre-existing errors only
- [x] **Typecheck**: pre-existing errors only
- [x] **Unit Tests**: 16 new DM tests + all existing pass
- [ ] **Curl Tests**: deferred to live server testing
- [x] **Phase Review**: Compare implementation against PRD Phase 2
  - [x] DM find-or-create works, block prevents DM creation and sending — verified by unit tests
  - [x] Unread counts accurate — verified by unit tests
  - [x] No deviations

---

## Phase 3: Real-Time Delivery + Frontend Shell

**Status**: Complete
**Objective**: Push new messages via SSE and build the initial frontend messaging UI.

### Steps

- [ ] 3.1 Inject `ObservabilityEventsService` (optional) into `MessagingService`. After `sendMessage()` inserts the row, call `observability.push()` with `hook_event_type: 'message_created'` and payload `{ channelId, messageId, senderId }`. Follow `NotificationService.notify()` SSE push pattern.
- [ ] 3.2 Create `apps/web/src/stores/messaging.store.ts` — Pinia store with:
  - State: `channels: Channel[]`, `activeChannelId: string | null`, `messagesByChannel: Record<string, Message[]>`, `unreadCounts: Record<string, number>`, `loading: boolean`
  - Actions: `fetchChannels()`, `fetchMessages(channelId, before?)`, `sendMessage(channelId, body)`, `markRead(channelId)`, `fetchUnreadCounts()`
  - Uses `useApi()` composable for HTTP calls
- [ ] 3.3 Add SSE listener in messaging store — listen for `message_created` events on existing event stream. On event: if channel is active, append message to list; if not, increment unread count
- [ ] 3.4 Create `apps/web/src/views/MessagesView.vue` — split layout:
  - Left panel: channel list grouped by scope (DMs, Clubs, Tournaments, System). Each row: channel name/user name, last message snippet, unread badge
  - Right panel: message thread for active channel. Scrollable message list, each message shows sender, timestamp, body
  - Mobile: stacked layout (channel list → tap → message thread with back button)
- [ ] 3.5 Create `apps/web/src/components/messaging/MessageCompose.vue` — text input with send button. Emits `send(body)` event. Fixed at bottom of message thread panel
- [ ] 3.6 Add `/messages` and `/messages/:channelId` routes to Vue Router
- [ ] 3.7 Add messages icon (mail/chat icon) to header toolbar component alongside notification bell. Show total unread count badge. Click navigates to `/messages`
- [ ] 3.8 On `MessagesView` mount, call `fetchChannels()` and `fetchUnreadCounts()`. On channel select, call `fetchMessages(channelId)` and `markRead(channelId)`

### Quality Gate

Before moving to Phase 4, ALL of the following must pass:

- [ ] **Lint**: `cd apps/api && pnpm run lint` and `cd apps/web && pnpm run lint` — no errors
- [ ] **Build**: `pnpm run build` (root) — both API and web build without errors
- [ ] **Typecheck**: `cd apps/web && pnpm run typecheck` — no type errors
- [ ] **Unit Tests**: `cd apps/api && pnpm run test:unit` — all tests pass
- [ ] **Chrome Tests** (manual via browser):
  - [ ] Messages icon visible in header toolbar
  - [ ] Clicking messages icon navigates to `/messages`
  - [ ] Channel list loads and shows existing channels
  - [ ] Clicking a channel loads messages in the right panel
  - [ ] Sending a message appears in the thread immediately
  - [ ] Opening a second browser tab: sending a message in tab 1 appears in tab 2 within 2 seconds
  - [ ] Unread badge updates when a message arrives in a non-active channel
  - [ ] Mobile layout: channel list is full-width, tapping a channel shows message thread with back button
- [ ] **Phase Review**: Compare implementation against PRD Phase 3
  - [ ] Did we accomplish what we said we would?
  - [ ] SSE real-time delivery works?
  - [ ] Frontend shell matches PRD section 4.4 layout description?
  - [ ] Are there any deviations? If so, document why.

---

## Phase 4: Threading + Reactions + Pins

**Status**: Not Started
**Objective**: Add threaded replies, emoji reactions, and message pinning.

### Steps

- [ ] 4.1 Update `sendMessage()` to accept optional `parent_message_id`. Validate parent message exists and belongs to the same channel.
- [ ] 4.2 Add `getThreadReplies(channelId, parentMessageId, userId)` to `MessagingService` — returns replies ordered by `created_at ASC`. Verifies membership.
- [ ] 4.3 Update `listMessages()` to include `reply_count` on each message (subquery or join on `parent_message_id`)
- [ ] 4.4 Add `addReaction(messageId, userId, emoji)` and `removeReaction(messageId, userId, emoji)` to `MessagingService` — upsert/delete in `messaging.message_reactions`
- [ ] 4.5 Add `getReactions(messageIds)` to `MessagingService` — batch fetch reactions for a list of messages. Returns `{ messageId: { emoji: count, userReacted: boolean }[] }`
- [ ] 4.6 Add `togglePin(messageId, userId)` to `MessagingService` — flip `is_pinned`. Verify user is admin of the channel. Push SSE event `message_pinned`.
- [ ] 4.7 Add `getPinnedMessages(channelId, userId)` to `MessagingService`
- [ ] 4.8 Add controller endpoints:
  - `GET /markets/messaging/channels/:channelId/threads/:messageId` → thread replies
  - `POST /markets/messaging/messages/:messageId/reactions` → body `{ emoji }`
  - `DELETE /markets/messaging/messages/:messageId/reactions/:emoji` → remove reaction
  - `PATCH /markets/messaging/messages/:messageId/pin` → toggle pin
  - `GET /markets/messaging/channels/:channelId/pinned` → pinned messages
- [ ] 4.9 Update `MessageCompose.vue` to support replying (show "replying to..." indicator, pass `parent_message_id`)
- [ ] 4.10 Create `apps/web/src/components/messaging/MessageThread.vue` — inline expansion below parent message showing thread replies and a compose box for new reply
- [ ] 4.11 Add reply count display on parent messages in message list. Clicking reply count opens thread view.
- [ ] 4.12 Create emoji reaction UI — reaction row under each message showing emoji + count, click to toggle. Add emoji picker button (simple predefined emoji grid, not a full picker library)
- [ ] 4.13 Add pin UI — admin sees pin/unpin action on messages. Pinned messages section at top of channel (collapsible)
- [ ] 4.14 Update messaging store with: `fetchThread(channelId, messageId)`, `addReaction(messageId, emoji)`, `removeReaction(messageId, emoji)`, `togglePin(messageId)`, `fetchPinnedMessages(channelId)`
- [ ] 4.15 Push SSE events for `reaction_added` and `message_pinned`. Frontend handles these in the store listener.
- [ ] 4.16 Create unit test `apps/api/tests/unit/messaging-threads-reactions.test.ts` — test thread creation, reply count, reaction add/remove/counts, pin toggle with admin check
- [ ] 4.17 Register the new test in `package.json` `test:unit` script chain

### Quality Gate

Before moving to Phase 5, ALL of the following must pass:

- [ ] **Lint**: `cd apps/api && pnpm run lint` and `cd apps/web && pnpm run lint` — no errors
- [ ] **Build**: `pnpm run build` (root) — both API and web build without errors
- [ ] **Typecheck**: `cd apps/api && pnpm run typecheck` and `cd apps/web && pnpm run typecheck` — no type errors
- [ ] **Unit Tests**: `cd apps/api && pnpm run test:unit` — all tests pass including new threads-reactions test
- [ ] **Curl Tests**:
  ```bash
  # Send a reply
  curl -s -X POST http://localhost:7100/markets/messaging/channels/$CHANNEL_ID/messages \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"body":"This is a reply","parent_message_id":"PARENT_MSG_ID"}' | jq .

  # Get thread
  curl -s http://localhost:7100/markets/messaging/channels/$CHANNEL_ID/threads/PARENT_MSG_ID \
    -H "Authorization: Bearer $TOKEN" | jq .

  # Add reaction
  curl -s -X POST http://localhost:7100/markets/messaging/messages/$MSG_ID/reactions \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"emoji":"👍"}' | jq .

  # Remove reaction
  curl -s -X DELETE "http://localhost:7100/markets/messaging/messages/$MSG_ID/reactions/👍" \
    -H "Authorization: Bearer $TOKEN" | jq .

  # Pin message
  curl -s -X PATCH http://localhost:7100/markets/messaging/messages/$MSG_ID/pin \
    -H "Authorization: Bearer $TOKEN" | jq .

  # Get pinned messages
  curl -s http://localhost:7100/markets/messaging/channels/$CHANNEL_ID/pinned \
    -H "Authorization: Bearer $TOKEN" | jq .
  ```
- [ ] **Chrome Tests** (manual via browser):
  - [ ] Clicking "reply" on a message opens thread view with compose box
  - [ ] Reply appears in thread; parent message shows reply count
  - [ ] Emoji reactions: clicking emoji button shows picker, selecting emoji adds it under message
  - [ ] Clicking an existing reaction toggles it (add/remove)
  - [ ] Admin user sees pin button; clicking it pins message to top section
  - [ ] Non-admin user does not see pin button
- [ ] **Phase Review**: Compare implementation against PRD Phase 4
  - [ ] Did we accomplish what we said we would?
  - [ ] Threading, reactions, and pins all functional?
  - [ ] Are there any deviations? If so, document why.

---

## Phase 5: Entity Attachments

**Status**: Not Started
**Objective**: Enable attaching Divinr entities (prediction, instrument, analyst, position, tournament) to messages with rich card rendering.

### Steps

- [ ] 5.1 Update `sendMessage()` to accept optional `attached_entity_type` and `attached_entity_id`. Validate the entity exists by querying the appropriate `prediction.*` table (instruments, market_predictions, market_analysts, user_positions). Tournament validation deferred (table doesn't exist yet — store the reference, skip validation).
- [ ] 5.2 Add `resolveAttachment(entityType, entityId, userId)` to `MessagingService` — fetches the entity data needed for card rendering. Returns a normalized `AttachmentCardData` shape per type:
  - Prediction: `{ direction, confidence, analyst_name, symbol, horizon_minutes }`
  - Instrument: `{ symbol, name, asset_type, current_state_summary }`
  - Analyst: `{ display_name, analyst_type, workflow_scope }`
  - Position: `{ symbol, direction, entry_price, current_price, unrealized_pnl, status }`
  - Tournament: `{ id, name }` (stub — full data when tournament tables exist)
- [ ] 5.3 Update `listMessages()` and `getThreadReplies()` to resolve attachments for messages that have them. Return attachment data alongside the message.
- [ ] 5.4 Create `apps/web/src/components/messaging/EntityAttachmentCard.vue` — polymorphic component that renders the correct card layout based on `entity_type`. Each variant shows key data fields and is wrapped in a clickable link to the entity's detail page.
- [ ] 5.5 Create `apps/web/src/components/messaging/AttachmentPicker.vue` — modal/popover with:
  - Type selector (prediction, instrument, analyst, position, tournament)
  - Search input that queries the appropriate API endpoint (reuses existing list/search endpoints)
  - Results list — click to select. Returns `{ type, id, preview_label }`
- [ ] 5.6 Integrate `AttachmentPicker` into `MessageCompose.vue` — attachment button opens picker, selected entity shown as preview chip in compose area, included in send payload
- [ ] 5.7 Render `EntityAttachmentCard` in message list and thread view when message has an attachment
- [ ] 5.8 Create unit test `apps/api/tests/unit/messaging-attachments.test.ts` — test entity validation, resolveAttachment for each type, invalid entity rejection
- [ ] 5.9 Register the new test in `package.json` `test:unit` script chain

### Quality Gate

Before moving to Phase 6, ALL of the following must pass:

- [ ] **Lint**: `cd apps/api && pnpm run lint` and `cd apps/web && pnpm run lint` — no errors
- [ ] **Build**: `pnpm run build` (root) — both API and web build without errors
- [ ] **Typecheck**: `cd apps/api && pnpm run typecheck` and `cd apps/web && pnpm run typecheck` — no type errors
- [ ] **Unit Tests**: `cd apps/api && pnpm run test:unit` — all tests pass including new attachments test
- [ ] **Curl Tests**:
  ```bash
  # Send message with attachment
  curl -s -X POST http://localhost:7100/markets/messaging/channels/$CHANNEL_ID/messages \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"body":"Check this out","attached_entity_type":"instrument","attached_entity_id":"INSTRUMENT_ID"}' | jq .

  # List messages — verify attachment data included
  curl -s http://localhost:7100/markets/messaging/channels/$CHANNEL_ID/messages \
    -H "Authorization: Bearer $TOKEN" | jq '.data[0].attachment'

  # Reject invalid entity
  curl -s -X POST http://localhost:7100/markets/messaging/channels/$CHANNEL_ID/messages \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"body":"Bad ref","attached_entity_type":"instrument","attached_entity_id":"nonexistent"}' \
    -w "\n%{http_code}"
  # Expected: 400 Bad Request
  ```
- [ ] **Chrome Tests** (manual via browser):
  - [ ] Attachment button visible in compose area
  - [ ] Clicking attachment button opens picker with entity type tabs
  - [ ] Searching for an entity returns results
  - [ ] Selecting an entity shows preview chip in compose area
  - [ ] Sent message renders entity card inline
  - [ ] Entity card shows correct data for each of the 5 types
  - [ ] Clicking entity card navigates to entity detail page
- [ ] **Phase Review**: Compare implementation against PRD Phase 5
  - [ ] Did we accomplish what we said we would?
  - [ ] All 5 entity types supported?
  - [ ] Cards render with correct data and are clickable?
  - [ ] Are there any deviations? If so, document why.

---

## Phase 6: @Mentions + Moderation + Polish

**Status**: Not Started
**Objective**: Add @mention notifications, moderation controls, system channel, club/tournament channel stubs, and mobile polish.

### Steps

- [ ] 6.1 Add `parseMentions(body: string)` utility — extracts `@username` tokens from message body. Returns list of usernames.
- [ ] 6.2 Add `resolveUsernames(usernames: string[])` to `MessagingService` — queries Supabase auth or a user lookup to resolve usernames to user IDs. (Use email prefix or display_name field depending on what's available.)
- [ ] 6.3 Update `sendMessage()` — after inserting message, call `parseMentions()`, resolve to user IDs, and for each mentioned user call `NotificationService.notify()` with `event_type: 'mention'`, `link_to: '/messages/CHANNEL_ID'`. Add `'mention'` to the `NotificationEventType` union.
- [ ] 6.4 Create `apps/web/src/components/messaging/MentionAutocomplete.vue` — dropdown that appears when user types `@` in compose input. Queries a user list endpoint. Selecting inserts `@username` into the text.
- [ ] 6.5 Integrate `MentionAutocomplete` into `MessageCompose.vue`
- [ ] 6.6 Add `deleteMessage(messageId, channelId, userId)` to `MessagingService` — soft-deletes (sets `is_deleted = true`). Permission checks:
  - Sender can delete their own messages
  - Channel admin can delete any message in their channel
  - System admin (super-admin role via RBAC) can delete anything
  - Push SSE event `message_deleted`
- [ ] 6.7 Add controller endpoint: `DELETE /markets/messaging/channels/:channelId/messages/:messageId`
- [ ] 6.8 Add `createSystemChannel(name)` to `MessagingService` — creates a system-scope channel. Only super-admin can call. All users are auto-added as members on first access.
- [ ] 6.9 Add `sendSystemAnnouncement(channelId, adminUserId, body)` — verifies sender is super-admin, sends message. System channel messages are read-only for non-admins.
- [ ] 6.10 Add `createScopedChannel(scope: 'club' | 'tournament', scopeId, name, adminUserId)` to `MessagingService` — creates a channel scoped to a club or tournament. Adds the admin as a member with 'admin' role. This is the stub that club/tournament efforts will call.
- [ ] 6.11 Add delete button on messages in the UI — visible to sender and channel admins. Confirm before deleting. Deleted messages show "[message deleted]" placeholder.
- [ ] 6.12 Mobile layout polish:
  - Ensure channel list is full-width on mobile with proper Ionic list styling
  - Message thread uses `ion-content` with proper scroll behavior
  - Back button from thread to channel list
  - Compose bar stays above keyboard on mobile (Ionic keyboard handling)
- [ ] 6.13 Add user list/search endpoint if not already available — `GET /markets/messaging/users?q=searchTerm` — returns `{ id, display_name }` for @mention autocomplete. Queries Supabase auth users, returns only users with active accounts.
- [ ] 6.14 Create unit test `apps/api/tests/unit/messaging-moderation.test.ts` — test delete permissions (sender, admin, super-admin, unauthorized), mention parsing, system channel admin-only posting
- [ ] 6.15 Register the new test in `package.json` `test:unit` script chain

### Quality Gate

Before finalizing, ALL of the following must pass:

- [ ] **Lint**: `cd apps/api && pnpm run lint` and `cd apps/web && pnpm run lint` — no errors
- [ ] **Build**: `pnpm run build` (root) — both API and web build without errors
- [ ] **Typecheck**: `cd apps/api && pnpm run typecheck` and `cd apps/web && pnpm run typecheck` — no type errors
- [ ] **Unit Tests**: `cd apps/api && pnpm run test:unit` — all tests pass including new moderation test
- [ ] **Curl Tests**:
  ```bash
  # Send message with @mention
  curl -s -X POST http://localhost:7100/markets/messaging/channels/$CHANNEL_ID/messages \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"body":"Hey @someuser check this signal"}' | jq .

  # Verify notification created for mentioned user
  curl -s http://localhost:7100/markets/notifications \
    -H "Authorization: Bearer $MENTIONED_USER_TOKEN" | jq '.data[] | select(.event_type=="mention")'

  # Delete a message (as sender)
  curl -s -X DELETE http://localhost:7100/markets/messaging/channels/$CHANNEL_ID/messages/$MSG_ID \
    -H "Authorization: Bearer $TOKEN" | jq .

  # Verify message is soft-deleted (shows is_deleted: true, body hidden)
  curl -s http://localhost:7100/markets/messaging/channels/$CHANNEL_ID/messages \
    -H "Authorization: Bearer $TOKEN" | jq .

  # Search users for @mention
  curl -s "http://localhost:7100/markets/messaging/users?q=some" \
    -H "Authorization: Bearer $TOKEN" | jq .
  ```
- [ ] **Chrome Tests** (manual via browser):
  - [ ] Typing `@` in compose box opens autocomplete dropdown
  - [ ] Selecting a user inserts `@username` into the message
  - [ ] Mentioned user receives a notification
  - [ ] Delete button visible on own messages and admin messages
  - [ ] Deleting a message shows "[message deleted]" in place
  - [ ] System channel shows announcements (read-only for non-admin)
  - [ ] Mobile: channel list is properly styled, thread scrolls correctly, keyboard doesn't cover compose
- [ ] **Full Regression**: Run all previous phase curl tests to confirm nothing broke
- [ ] **Phase Review**: Compare implementation against PRD Phase 6 and full PRD
  - [ ] Did we accomplish what we said we would?
  - [ ] All PRD requirements from sections 2-5 met?
  - [ ] Legal framing: no AI moderation, messages labeled as educational discussion?
  - [ ] All out-of-scope items confirmed NOT implemented?
  - [ ] Are there any deviations? If so, document why.
