# Effort: Investment Learning Clubs

## Problem

Solo users learn slower and churn faster. There's no way for groups — university classes, Discord communities, friend groups — to use Divinr together. Tournaments create competition, but clubs create community and retention.

## Intention

Build a club system where groups of users learn together by sharing tournament performance, analyst preferences, and analysis discussions. Clubs are explicitly "investment learning" — educational, not advisory. Clubs are the retention layer that turns tournament players into long-term users.

## Scope

### Club Entity
- Create a club with name, description, invite code
- Club creator is admin (can invite/remove members)
- Members join via invite link/code (reuses existing invite infrastructure)
- Club profile page showing members, stats, activity

### Club Membership
- Join/leave clubs
- View club member list with tournament performance
- Club-level analytics: "Our club tends to favor bullish analysts"

### Club Tournaments
- Club admin can create private tournaments for club members only
- Club leaderboard within a tournament
- Club aggregate stats: average return, best member, worst member

### Club Analytics
- Which analysts the club trusts most (aggregate affinity)
- Club-wide win rate, average return across tournaments
- "Club style" summary — are we contrarians? trend followers?

### Club Discovery
- Browse public clubs (opt-in visibility)
- Club size, win rate, tournament count as discovery signals

## Use Cases
- **University finance course**: Professor creates a club, students compete in weekly tournaments, professor sees who's engaging with the analysis
- **Trading Discord community**: Members get a structured platform instead of just chat
- **Friend group**: Casual competition with people you know
- **Financial literacy program**: Org creates a club for participants

## Legal Framing
- "Investment Learning Club" — never "Investment Club" (SEC implications)
- No pooled money, no collective trading decisions
- Each member trades independently in their own tournament portfolio
- Educational framing throughout: "learn", "practice", "study"

## Out of Scope
- In-app chat or messaging (use external tools)
- Club-pooled portfolios (legal minefield)
- Paid club tiers (future, Phase 2 revenue)
- Public club rankings/leaderboards across clubs (future)

## Dependencies
- Tournament system must ship first — clubs build on tournament infrastructure
