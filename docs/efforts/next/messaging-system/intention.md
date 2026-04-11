# Effort: Messaging System

## Problem

There's no way for users to communicate within the platform. Tournaments need announcements, clubs need discussion threads, and users need to be able to message each other. Without messaging, every social feature requires an external tool (Discord, text, email) — which fragments the experience and loses engagement.

## Intention

Build a messaging system that supports direct messages, group conversations, and scoped channels (club feeds, tournament chat). Messages can attach Divinr entities (predictions, instruments, tournaments, analysts, positions) as rich cards. Real-time delivery via the existing SSE infrastructure.

## Scope

### Message Entity
- `messages` table: sender_id, body, channel_id, parent_message_id (threading), attached_entity_type + attached_entity_id, created_at
- `channels` table: scope (dm, club, tournament, system), scope_id, name, created_at
- `channel_members` table: channel_id, user_id, role (member, admin), last_read_at

### Direct Messages
- User-to-user messaging
- Start a DM from any user profile or member list
- DM channel created on first message between two users
- Unread count in notification bell or separate messages icon

### Channel Types
- **DM** — private between two users
- **Club** — one channel per club, visible to all members. Club admins can moderate.
- **Tournament** — one channel per tournament, visible to all entrants. Auto-created when tournament starts, archived when it ends.
- **System** — platform announcements from Divinr admin. Read-only for users.

### Threaded Replies
- Any message can have replies (parent_message_id)
- Thread view expands inline or in a side panel
- Thread reply count shown on parent message

### Contextual Attachments
- Attach any Divinr entity to a message:
  - Prediction — renders as prediction card with direction, confidence, analysts
  - Instrument — renders as instrument card with current state
  - Tournament — renders as tournament card with status, leaderboard preview
  - Analyst — renders as analyst card with name, type, recent accuracy
  - Position — renders as position card with entry, PnL, direction
- Attachment picker in compose UI — search and select entity to attach
- Rich card renders inline in the message, clickable to navigate

### Real-Time Delivery
- Reuse existing SSE infrastructure from notification system
- New messages push to connected clients immediately
- Unread count updates in real-time

### Read/Unread Tracking
- Per-channel last_read_at timestamp per user
- Unread badge on channels with new messages
- "Mark all read" per channel

### @Mentions
- @username in message body — tagged user gets a notification
- Autocomplete dropdown when typing @

### Emoji Reactions
- React to any message with emoji
- `message_reactions` table: message_id, user_id, emoji
- Reaction counts shown under message
- Click to add/remove your reaction

### Pinned Messages
- Club/tournament admins can pin important messages
- Pinned messages shown at top of channel or in a "pinned" section

### Moderation
- Club admins can delete messages in their club channel
- Tournament admins can delete messages in their tournament channel
- System admins can delete anything
- Block user from DMs

## UI
- Messages icon in header toolbar (alongside notification bell)
- Messages view: channel list on left, message thread on right (desktop) or stacked (mobile)
- Compose box with text input, attachment picker, emoji picker
- Inline thread expansion

## Legal Framing
- Standard user-generated content terms in ToS
- No AI moderation of message content (users are responsible)
- Messages are "educational discussion" not "investment advice"

## Out of Scope
- Voice or video calls
- File/image uploads (text + entity attachments only)
- Message editing after send (delete and repost)
- End-to-end encryption
- Message search (future)
- Typing indicators

## Dependencies
- None — this is foundational infrastructure. Tournaments and clubs depend on it.
