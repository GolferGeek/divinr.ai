# Messaging System — Product Requirements Document

## 1. Overview

Build an in-platform messaging system so users can communicate directly, within clubs, within tournaments, and receive system announcements — eliminating the need for external tools like Discord or email. Messages support rich entity attachments (predictions, instruments, analysts, positions, tournaments) rendered as inline cards, threaded replies, emoji reactions, pinned messages, @mentions, and real-time delivery via the existing SSE infrastructure.

This is foundational infrastructure. Tournaments and clubs both depend on messaging channels being available before they can ship.

## 2. Goals & Success Criteria

| Goal | Success Metric |
|------|----------------|
| Users can send and receive direct messages | DM channel created on first message; messages appear in <2s via SSE |
| Channel types support all social scopes | DM, club, tournament, and system channels all functional |
| Rich entity attachments work inline | All 5 entity types (prediction, instrument, tournament, analyst, position) render as clickable cards |
| Threaded replies keep conversations organized | Parent messages show reply count; thread view expands inline or in side panel |
| Real-time delivery via existing SSE | New messages push to connected clients immediately; unread counts update live |
| Read/unread tracking per channel per user | Unread badges on channels with new messages; mark-all-read works |
| @mentions generate notifications | Typing @ triggers autocomplete; tagged user gets a notification |
| Emoji reactions on messages | Users can add/remove reactions; counts display under messages |
| Pinned messages for admins | Club/tournament admins can pin; pinned messages shown at top of channel |
| Moderation controls | Club admins moderate club channels; tournament admins moderate tournament channels; system admins moderate everything; users can block DMs |

## 3. User Stories / Use Cases

**Direct Messages**
- As a user, I can start a DM conversation with any other user from their profile or a member list.
- As a user, I see an unread count on my messages icon when I have unread DMs.
- As a user, I can block another user from sending me DMs.

**Club Channels**
- As a club member, I can post messages in my club's channel visible to all club members.
- As a club admin, I can delete inappropriate messages in my club channel.
- As a club admin, I can pin important messages to the top of the channel.

**Tournament Channels**
- As a tournament entrant, I can chat with other entrants in the tournament channel.
- As a tournament admin, I can moderate messages in the tournament channel.
- The tournament channel is auto-created when the tournament starts and archived when it ends.

**System Announcements**
- As a Divinr admin, I can broadcast read-only announcements to all users via a system channel.
- As a user, I see system announcements in a dedicated system channel.

**Entity Attachments**
- As a user composing a message, I can search for and attach a Divinr entity (prediction, instrument, analyst, position, or tournament).
- The attached entity renders as a rich card inline in the message, showing key data and clickable to navigate to the entity.

**Threads & Reactions**
- As a user, I can reply to any message, creating a thread. The parent message shows a reply count.
- As a user, I can react to any message with an emoji. Reaction counts are visible.

**@Mentions**
- As a user, I can type @ to get an autocomplete dropdown of usernames.
- When mentioned, I receive a notification linking to the message.

## 4. Technical Requirements

### 4.1 Architecture

The messaging system adds a new `messaging` schema in PostgreSQL alongside the existing `prediction` schema. A new `MessagingService` NestJS service handles all messaging logic, following the established pattern of `@Inject(DATABASE_SERVICE)` and raw SQL queries via `DatabaseService.rawQuery()`.

Real-time delivery reuses the existing `ObservabilityEventsService.push()` mechanism with new event types (`message_created`, `reaction_added`, `message_deleted`). The frontend listens on the existing SSE stream and routes messaging events to a new Pinia store.

**New backend components:**
- `MessagingService` — core message CRUD, channel management, read tracking
- `MessagingSchemaService` — DDL for `messaging.*` tables (idempotent `CREATE TABLE IF NOT EXISTS` pattern matching `MarketsSchemaService`)
- Controller endpoints added to `MarketsController` under `/markets/messaging/*`

**New frontend components:**
- `messaging.store.ts` — Pinia store for channels, messages, unread counts
- `MessagesView.vue` — main messages page (channel list + message thread)
- `MessageCompose.vue` — text input with attachment picker and emoji picker
- `MessageThread.vue` — inline thread expansion
- `EntityAttachmentCard.vue` — renders attached entity as rich card
- `AttachmentPicker.vue` — search and select entities to attach

### 4.2 Data Model Changes

All tables live in a new `messaging` schema.

```sql
CREATE SCHEMA IF NOT EXISTS messaging;

-- Channels
CREATE TABLE IF NOT EXISTS messaging.channels (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  scope TEXT NOT NULL CHECK (scope IN ('dm', 'club', 'tournament', 'system')),
  scope_id TEXT,                    -- club_id, tournament_id, or NULL for dm/system
  name TEXT,                        -- display name (NULL for DMs, auto-generated)
  is_archived BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Channel members (with read tracking)
CREATE TABLE IF NOT EXISTS messaging.channel_members (
  channel_id TEXT NOT NULL REFERENCES messaging.channels(id),
  user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'admin')),
  last_read_at TIMESTAMPTZ DEFAULT now(),
  is_blocked BOOLEAN DEFAULT false,  -- for DM blocking
  PRIMARY KEY (channel_id, user_id)
);

-- Messages
CREATE TABLE IF NOT EXISTS messaging.messages (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  channel_id TEXT NOT NULL REFERENCES messaging.channels(id),
  sender_id TEXT NOT NULL,
  body TEXT NOT NULL,
  parent_message_id TEXT REFERENCES messaging.messages(id),
  attached_entity_type TEXT CHECK (
    attached_entity_type IN ('prediction', 'instrument', 'tournament', 'analyst', 'position')
  ),
  attached_entity_id TEXT,
  is_pinned BOOLEAN DEFAULT false,
  is_deleted BOOLEAN DEFAULT false,  -- soft delete for moderation
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Emoji reactions
CREATE TABLE IF NOT EXISTS messaging.message_reactions (
  message_id TEXT NOT NULL REFERENCES messaging.messages(id),
  user_id TEXT NOT NULL,
  emoji TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (message_id, user_id, emoji)
);

-- DM blocks (user-level, not channel-level)
CREATE TABLE IF NOT EXISTS messaging.user_blocks (
  blocker_id TEXT NOT NULL,
  blocked_id TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id)
);
```

**Indexes:**
```sql
CREATE INDEX IF NOT EXISTS idx_messages_channel_created
  ON messaging.messages(channel_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_parent
  ON messaging.messages(parent_message_id) WHERE parent_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_channel_members_user
  ON messaging.channel_members(user_id);
CREATE INDEX IF NOT EXISTS idx_channels_scope
  ON messaging.channels(scope, scope_id);
```

### 4.3 API Changes

All endpoints under `GET/POST/PATCH/DELETE /markets/messaging/*`, guarded by `JwtAuthGuard` and `requireWriteAccess` for mutations.

**Channel endpoints:**
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/messaging/channels` | List channels for authenticated user (with unread counts) |
| `POST` | `/messaging/channels/dm` | Create or get existing DM channel with target user |
| `GET` | `/messaging/channels/:channelId` | Get channel details |

**Message endpoints:**
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/messaging/channels/:channelId/messages` | Paginated messages (cursor-based, newest first) |
| `POST` | `/messaging/channels/:channelId/messages` | Send a message |
| `GET` | `/messaging/channels/:channelId/threads/:messageId` | Get thread replies |
| `DELETE` | `/messaging/channels/:channelId/messages/:messageId` | Soft-delete (moderation) |

**Read tracking:**
| Method | Path | Description |
|--------|------|-------------|
| `PATCH` | `/messaging/channels/:channelId/read` | Update last_read_at to now |
| `GET` | `/messaging/unread-counts` | Get unread counts for all user channels |

**Reactions:**
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/messaging/messages/:messageId/reactions` | Add reaction `{ emoji }` |
| `DELETE` | `/messaging/messages/:messageId/reactions/:emoji` | Remove reaction |

**Pinning:**
| Method | Path | Description |
|--------|------|-------------|
| `PATCH` | `/messaging/messages/:messageId/pin` | Toggle pin (admin only) |
| `GET` | `/messaging/channels/:channelId/pinned` | Get pinned messages |

**Blocking:**
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/messaging/blocks` | Block user `{ blocked_id }` |
| `DELETE` | `/messaging/blocks/:blockedId` | Unblock user |

**Request/Response shapes:**

```typescript
// Send message
POST /messaging/channels/:channelId/messages
Body: {
  body: string;
  parent_message_id?: string;
  attached_entity_type?: 'prediction' | 'instrument' | 'tournament' | 'analyst' | 'position';
  attached_entity_id?: string;
}
Response: { data: Message }

// List messages (cursor pagination)
GET /messaging/channels/:channelId/messages?before=<messageId>&limit=50
Response: { data: Message[], has_more: boolean }

// Channel list with unread counts
GET /messaging/channels
Response: { data: ChannelWithUnread[] }
```

### 4.4 Frontend Changes

**New views and components:**

1. **Messages icon in header toolbar** — alongside the existing notification bell. Shows total unread count badge. Clicking opens the messages view.

2. **MessagesView** (`/messages` route) — split layout:
   - Desktop: channel list on left, message thread on right
   - Mobile: stacked — channel list view, tap to enter thread view

3. **Channel list panel** — shows all user channels grouped by type (DMs, Clubs, Tournaments, System). Each channel row shows name, last message preview, unread badge.

4. **Message thread panel** — scrollable message list with infinite scroll (load older on scroll up). Each message shows sender avatar/name, timestamp, body, attached entity card (if any), reaction row, reply count (if threaded). Compose box at bottom.

5. **MessageCompose** — text input with:
   - Attachment picker button → modal to search/select entities
   - Emoji picker button → emoji selection popover
   - @mention autocomplete → dropdown on `@` keystroke, queries user list
   - Send button

6. **EntityAttachmentCard** — polymorphic component rendering the attached entity:
   - **Prediction**: direction arrow, confidence %, analyst name, instrument symbol
   - **Instrument**: symbol, name, asset type, current state summary
   - **Tournament**: name, status, entrant count, leaderboard top 3
   - **Analyst**: display name, analyst type, accuracy stats
   - **Position**: symbol, direction, entry price, current PnL

7. **Thread view** — inline expansion below parent message, or side panel on desktop. Shows all replies, compose box for new reply.

**Pinia store (`messaging.store.ts`):**
- State: `channels[]`, `activeChannelId`, `messages{}` (keyed by channelId), `unreadCounts{}`, `loading`
- Actions: `fetchChannels()`, `fetchMessages(channelId, before?)`, `sendMessage(channelId, body, opts)`, `markRead(channelId)`, `addReaction(messageId, emoji)`, `removeReaction(messageId, emoji)`, `togglePin(messageId)`, `blockUser(userId)`, `unblockUser(userId)`
- SSE listener: on `message_created` event, push to appropriate channel's message list and increment unread if not active channel

### 4.5 Infrastructure Requirements

- **Database**: New `messaging` schema with tables as specified in 4.2. No new database instances needed — uses existing PostgreSQL via Supabase.
- **SSE**: No new infrastructure. Reuses `ObservabilityEventsService.push()` with new hook event types: `message_created`, `reaction_added`, `message_deleted`, `message_pinned`.
- **Storage**: Text-only messages (no file uploads). Storage growth bounded by message volume.

## 5. Non-Functional Requirements

**Performance:**
- Message send-to-display latency < 2 seconds via SSE for connected clients
- Channel list loads in < 500ms for users with up to 50 channels
- Message history pagination: 50 messages per page, cursor-based for consistent ordering
- Unread count queries use indexed lookups on `channel_members.last_read_at` vs `messages.created_at`

**Security:**
- All endpoints require JWT authentication
- Mutation endpoints require `requireWriteAccess` (blocks beta_reader role)
- Users can only read messages in channels they are members of
- DM channel creation checks that neither user has blocked the other
- Soft-delete for moderation preserves audit trail (messages marked `is_deleted`, not removed)
- Moderation permission checks: club admins for club channels, tournament admins for tournament channels, system admins (super-admin role) for all channels

**Scalability:**
- Cursor-based pagination avoids offset performance degradation
- Indexed queries on `(channel_id, created_at)` for message fetching
- Unread counts computed from `last_read_at` comparison, not row counting

## 6. Out of Scope

- Voice or video calls
- File or image uploads (text + entity attachments only)
- Message editing after send (delete and repost instead)
- End-to-end encryption
- Message search (future effort)
- Typing indicators
- Read receipts (showing who has read a message)
- Push notifications to mobile (SSE only for now)
- AI moderation of message content (users are responsible per ToS)

## 7. Dependencies & Risks

**Dependencies:**
- None blocking. This is foundational infrastructure that clubs and tournaments will depend on.
- Club and tournament tables do not yet exist. Club/tournament channel creation will be invoked by the club/tournament efforts when they ship. This effort builds the channel infrastructure and the DM + system channel types end-to-end.

**Risks:**

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| SSE event volume spikes in active channels | Medium | Medium | Debounce unread count updates; batch SSE events per channel if needed |
| DM spam between users | Low | Medium | Block user feature; rate limiting on message sends (future) |
| Orphaned club/tournament channels if those efforts change schema | Low | Low | Channels use loose `scope` + `scope_id` reference, not foreign keys — resilient to schema changes |
| Large thread depth causing slow renders | Low | Low | Cap thread display at 100 replies with "load more"; threads are flat (no nested threading) |

## 8. Phasing

### Phase 1: Schema + Core Message CRUD
- Create `messaging` schema with all tables and indexes
- `MessagingSchemaService` with idempotent DDL (matching `MarketsSchemaService` pattern)
- `MessagingService` with: create channel, send message, list messages (paginated), get channel details
- Controller endpoints for channel creation and message send/list
- Unit tests for service methods

**Gate**: Messages can be created, stored, and retrieved via API. Schema is idempotent.

### Phase 2: DM Channels + Read Tracking
- DM channel creation endpoint (find-or-create between two users)
- `channel_members` management for DMs
- `last_read_at` update endpoint
- Unread count query (per-channel and total)
- Block/unblock user for DMs
- Integration tests for DM flow

**Gate**: Two users can exchange DMs. Unread counts are accurate. Blocking prevents new DMs.

### Phase 3: Real-Time Delivery + Frontend Shell
- SSE push on message create via `ObservabilityEventsService.push()`
- `messaging.store.ts` Pinia store with SSE listener
- Messages icon in header toolbar with unread badge
- `MessagesView` with channel list and message thread panels
- `MessageCompose` with basic text input and send
- Route setup (`/messages`, `/messages/:channelId`)

**Gate**: Sending a message from one browser tab appears in another connected tab within 2 seconds. Messages view navigable from header icon.

### Phase 4: Threading + Reactions + Pins
- Thread replies (parent_message_id)
- Thread view component (inline expansion)
- Reply count on parent messages
- Emoji reactions (add/remove/display counts)
- Emoji picker component
- Pin/unpin endpoints and UI
- Pinned messages section in channel

**Gate**: Users can reply to messages in threads. Reactions work. Admins can pin messages.

### Phase 5: Entity Attachments
- Attachment picker component (search entities by type)
- `EntityAttachmentCard` component with renderers for all 5 entity types
- Backend validation that attached entity exists and user has access
- Entity card data fetched on message load (join or secondary query)

**Gate**: Users can attach any of the 5 entity types. Cards render with correct data and navigate on click.

### Phase 6: @Mentions + Moderation + Polish
- @mention parsing in message body
- Autocomplete dropdown for usernames
- Notification created for mentioned users (via existing `NotificationService`)
- Moderation: delete message (soft delete) with permission checks
- System channel (admin-only posting, all users read)
- Club/tournament channel stubs (create channel for scope — actual integration deferred to those efforts)
- Mobile responsive layout adjustments

**Gate**: @mentions trigger notifications. Admins can moderate. System announcements work. UI is responsive on mobile.

## Legal Framing

- Messages are user-generated content governed by Terms of Service
- No AI moderation — users are responsible for their own messages
- Messages constitute "educational discussion" and do not constitute investment advice or recommendations
- Platform provides analysis and signals, not advice — this applies to shared message content as well
