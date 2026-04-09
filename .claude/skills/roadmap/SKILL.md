---
name: roadmap
description: View, discuss, and update the efforts roadmap. Shows the big picture of what's been done, what's in progress, and what's coming next. Use this to reprioritize, add/remove efforts, or just get oriented.
user-invocable: true
allowed-tools: Read Write Edit Grep Glob Bash Agent
---

# Efforts Roadmap

The roadmap lives at `docs/efforts/roadmap.md`. It tracks the full arc of divinr.ai's development across multiple efforts — what's done, what's current, what's next, and what's future.

## When Invoked

1. **Read the roadmap** at `docs/efforts/roadmap.md`.
2. **Read the current effort's status** — check `docs/efforts/current/` for which documents exist (intention.md, prd.md, plan.md, completion-report.md) to determine where the current effort stands.
3. **Present a concise status** to the user:
   - What's current and where it stands (intention written? PRD built? plan running? complete?)
   - What's next in the queue
   - Any blockers or decision points

4. **Then listen.** The user may want to:
   - **Discuss priorities** — "should we move X ahead of Y?"
   - **Add a new effort** — describe it briefly, place it in next/future
   - **Remove or defer an effort** — move it to future or drop it
   - **Reprioritize** — reorder next/future efforts
   - **Get oriented** — "remind me why we're doing this before that"
   - **Mark completion** — when an effort finishes, move it to completed, update current/next
   - **Just talk** — sometimes the user wants to think out loud about where the project is going

5. **Update the roadmap** after any changes. Always:
   - Update the "Last updated" date
   - Keep the dependency graph consistent with the effort list
   - Keep descriptions concise — the roadmap is an index, not a plan
   - Preserve the document structure (Completed → Current → Next → Future → Dependency Graph)

## Guidelines

- **The roadmap is the big picture.** It answers "what are we building and why in this order." It does NOT contain implementation details — those live in each effort's intention/PRD/plan.
- **Efforts in "Next" should have enough definition to write an intention from.** If an effort is too vague for that, it belongs in "Future."
- **Efforts in "Future" can be rough.** One paragraph is fine. They're ideas, not commitments.
- **Dependencies matter.** When reordering, check whether the new order respects the dependency graph. If it doesn't, flag the conflict to the user.
- **Don't over-plan.** The roadmap should have 2-3 "Next" efforts and a handful of "Future" ones. If the list grows past ~10 future efforts, consolidate or prune.
- **Key decisions from conversations belong here** — especially scope decisions and "why this order" rationale. These are the things that get lost when conversation context compresses.
- **When an effort completes:** move it to the Completed table, promote the first "Next" to "Current" (or ask the user which one), and adjust the dependency graph.
