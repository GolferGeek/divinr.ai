# Effort: Tournament System

## Problem

Divinr has a complete AI analysis + paper trading platform, but no social or competitive layer. Solo users have no reason to come back daily or invite friends. The portfolio system tracks performance but there's no game around it.

## Intention

Build a tournament system where users compete on paper-trading performance using the AI analyst signals. Tournaments are the acquisition and engagement hook — "play the market with AI analysts." Explicitly a game, not investment advice.

## Scope

### Tournament Entity
- Create, configure, and manage tournaments
- Tournament types: open (anyone joins), invite-only (club tournaments)
- Configurable: start/end dates, starting balance, allowed instruments (all or sector-restricted)
- Tournament statuses: upcoming, active, completed, archived

### Tournament Portfolios
- Each user gets an isolated tournament portfolio on entry
- Same trading mechanics as main portfolio (queue trades, positions, PnL)
- Tournament portfolio is separate from the user's main portfolio
- Starting balance is equal for all entrants

### Tournament Leaderboard
- Live leaderboard during tournament: rank, return %, PnL, win rate, Sharpe
- Final results page after tournament ends
- Highlight winner, top 3, notable stats

### Tournament Types (initial set)
- **Weekly Sprint** — fresh start Monday, scored Friday close
- **Sector Challenge** — restricted instrument set (e.g., tech only)
- **Analyst Draft** — pick N analysts, only get signals from your picks

### Entry & Registration
- Browse upcoming/active tournaments
- One-click entry (creates tournament portfolio)
- View your active tournaments from dashboard

### Results & History
- Past tournament results with final standings
- Personal tournament history (your rank in each)

## Legal Framing
- All tournaments use virtual/paper money only
- Prominent disclaimer: "Divinr is an AI analysis game. Virtual portfolios use simulated trades for educational and entertainment purposes. Not investment advice."
- No real money prizes (avoid gambling regulations)
- Language: "players" not "investors", "game" not "trading"

## Out of Scope
- Real money or prizes
- Club-based team tournaments (that's learning-clubs effort)
- Chat or messaging between players (future)
- Badges and achievements (future, after tournaments prove out)
