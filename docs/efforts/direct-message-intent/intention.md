# Direct Message Intent

## Why
PR #58 shipped the Member Profile Drawer with a Message button, but `MemberProfileDrawer.messageUser()` only logs `[coming-soon] DM user <id>` because `/messages` has no new-DM bootstrap flow. The drawer's most useful social action is dead weight until this ships.

## What
Add a `/messages?to=<userId>` route behavior that either opens an existing 1:1 thread with that user or creates a new one and focuses the composer. Wire the drawer's Message button to navigate to it. Works across both the leaderboard drawer and the MEMBERS card drawer.

## Scope
- API: ensure a `getOrCreateDirectThread(userAId, userBId)` endpoint exists (or extend the existing thread-create endpoint to be idempotent for 1:1)
- Web route: `/messages?to=<userId>` — on mount, resolves the thread and scrolls to composer
- Drawer: replace `console.info` stub with `router.push('/messages?to=' + userId)`
- Closed-state: user can't DM themselves; show a disabled Message button with a tooltip

## Non-goals
- Group-thread intent
- Pre-seeded message body (e.g. "I saw your position in X…")
- Blocking / mute / report flows

## Success
- Clicking Message from the drawer always lands the user in a ready-to-type 1:1 thread with that person
- Idempotent: clicking twice never creates two threads
- Works whether or not the other user has ever DM'd before
