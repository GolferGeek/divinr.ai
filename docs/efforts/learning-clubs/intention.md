# Effort: Investment Learning Clubs

## Problem

Solo users learn slower and churn faster. There's no way for groups — university classes, Discord communities, friend groups — to use Divinr together. Tournaments create competition, but clubs create community and retention.

## Intention

Build a club system where groups of users learn together by sharing tournament performance, analyst preferences, and analysis discussions. Clubs are explicitly "investment learning" — educational, not advisory. Clubs are the retention layer that turns tournament players into long-term users.

## Scope

### Club Entity
- Create a club with name, description, invite code
- Public vs. private toggle (public clubs appear in discovery, private are invite-only)
- Club profile page showing members, stats, activity

### Club Roles
- **Owner** — club creator. Full control. Can promote members to admin.
- **Admin** — can invite/remove members, create club tournaments, manage club analysts. Multiple admins allowed.
- **Member** — can play in tournaments, view club analytics, use club analysts.

### Club Membership
- Join via invite link/code (reuses existing invite infrastructure)
- "Invite by email" — if person isn't on Divinr yet, becomes signup + club join in one step
- Join/leave clubs
- View club member list with tournament performance

### Club Tournaments
- Club admin can create private tournaments for club members only
- Club leaderboard within a tournament
- Club aggregate stats: average return, best member, worst member

### Club Analysts
- Club admin writes a contract for a custom AI analyst (reuses existing contract editor)
- Club analyst runs in the same prediction pipeline alongside base analysts
- Club analyst results visible only to club members
- Club analyst appears as an option in club tournaments
- Club analyst gets calibrated and scored like any base analyst — full transparency
- Club can have multiple analysts (e.g., a value analyst and a momentum analyst)
- Hierarchy: base analysts (shared by all) → club analysts (shared by club) → custom analysts (Phase 2, individual)

### Learning Activities
- **Prediction challenges** — admin picks an instrument, members write their bull/bear thesis before seeing AI analysis. Then reveal and compare human vs. AI reasoning.
- **Consensus polls** — "What's the club's view on AAPL this week?" Bull/bear/neutral vote before seeing AI analysis. Track club consensus accuracy over time.
- **Post-mortems** — after a tournament ends, auto-generated summary: what the top performer did differently, which analysts they followed, when they went against the AI.
- **Strategy journals** — members write a one-liner when they make a trade ("Trusting Macro Mike because rates data supports his thesis"). Builds documenting-your-reasoning habit.
- **Contrarian spotlight** — when a member goes against club consensus AND wins, highlight it.

### Club Analytics
- Which analysts the club trusts most (aggregate affinity)
- Club-wide win rate, average return across tournaments
- "Club style" summary — are we contrarians? trend followers?
- Club learning score — are members getting better over time? Track accuracy improvement across tournaments.
- Common mistakes feed — patterns where club members lose money together
- Analyst trust evolution — how the club's collective analyst preferences shift over time

### Club Discovery
- Browse public clubs (opt-in visibility)
- Club size, win rate, tournament count as discovery signals

## Use Cases
- **University finance course**: Professor creates a club, writes a custom analyst that follows their curriculum's methodology, students compete in weekly tournaments and write prediction challenges
- **Trading Discord community**: Members get a structured platform with their own custom analyst tuned to their strategy
- **Value investing club**: Creates "Warren" — an analyst that only cares about fundamentals and margin of safety. Watch it compete against the base analysts.
- **Friend group**: Casual competition with people you know, no custom analyst needed
- **Financial literacy program**: Org creates a club for participants with structured learning activities

## Legal Framing
- "Investment Learning Club" — never "Investment Club" (SEC implications)
- No pooled money, no collective trading decisions
- Each member trades independently in their own tournament portfolio
- Educational framing throughout: "learn", "practice", "study"
- Club analysts produce "analysis" and "signals", never "advice" or "recommendations"

## Out of Scope
- In-app chat or messaging (use external tools)
- Club-pooled portfolios (legal minefield)
- Paid club tiers (future revenue)
- Public club rankings/leaderboards across clubs (future)
- Curriculum builder / structured multi-week courses (future)
- Mentor/mentee pairing (future)

## Dependencies
- Tournament system must ship first — clubs build on tournament infrastructure
