# Dashboard Attention and Signal Relevance

## Why

The current dashboard is not useful enough as a daily home view. It shows a broad mix of platform information, navigation cards, aggregate counts, clubs, summaries, alerts, and active signal cards, but it does not make the two most important returning-user questions easy to answer:

- What is happening with my current trades?
- Where do I stand in my active tournaments?

The dashboard should feel like an attention surface, not a catalog. A user should arrive and quickly understand their current exposure, active competitive standing, and the analysis that is most relevant to those two contexts.

The analysis feed also needs to become more discerning. Not every instrument deserves to show up just because analysis exists. Divinr should rank and filter analysis around the user's holdings, active tournaments, analyst affinity, watched/recent behavior, conviction, and disagreement.

## What

Create one effort that turns the dashboard into a focused home view built around:

1. **Current portfolio / active positions**
   - Show the user's open positions and recent portfolio state prominently.
   - Link each position to relevant new analysis for that instrument.
   - Provide a clear path to the full portfolio view.

2. **Current tournament standings**
   - Show active tournament entries and the user's current rank context.
   - Link directly into the tournament detail and leaderboard.
   - Keep this visible enough that tournament participation feels alive.

3. **Relevant analysis, not all analysis**
   - Filter and order dashboard analysis by user relevance.
   - Prefer analysis tied to explicit user preferences, current holdings, active tournament instruments, analyst affinity, high conviction, and meaningful disagreement.
   - Leave broad discovery to the Analyses page and instrument pages.

4. **Explicit user preferences**
   - Let users directly express what matters to them: followed analysts, watched instruments, muted instruments, and dashboard priority.
   - Use these preferences as the easiest-to-explain ranking inputs.
   - Keep implicit behavior-based signals as a fallback and secondary boost.

## Principles

- The dashboard answers: **what deserves my attention now?**
- Portfolio and tournament context are first-class; generic platform summary cards are secondary or removed.
- Analysis visibility is earned by relevance, conviction, disagreement, or user context.
- The user's preference model should combine explicit settings with existing product signals.
- Explicit preferences should be easy to inspect and change; implicit relevance should never feel mysterious.
- Keep broader browsing available, but separate it from the dashboard's attention surface.
- User-visible copy must say **analysis** or **signal**, not prediction/advice/recommendation.

## Preference Model Direction

Initial user preference inputs should include explicit choices:

- Followed analysts.
- Watched instruments.
- Muted instruments.
- Dashboard priority mode: portfolio first, tournaments first, or balanced.

Implicit preference inputs should still come from data already present or near-present in the product:

- Open portfolio positions and queued trades.
- Active tournament entries and allowed tournament instruments.
- Existing analyst affinity scores from user behavior.
- Recently viewed/browsed analyst signals.
- Watched or repeatedly viewed instruments, if already tracked or easy to add.
- High-confidence arbitrator synthesis.
- Analyst disagreement that is strong enough to be interesting.

The first relevance ordering should be deterministic and explainable:

1. Muted instruments are excluded from dashboard analysis.
2. Watched instruments and followed analysts get explicit boosts.
3. Analysis for current open positions.
4. Analysis for active tournament instruments.
5. Analysis from analysts with high affinity for the user.
6. High-conviction or high-disagreement analysis.
7. Recent analysis for already-tracked user activity, if an existing source is available.

The dashboard does not need to show everything after that.

## Success

- A returning user can see current positions and active tournament standing without scrolling past generic summary content.
- The dashboard has obvious links into relevant analysis, portfolios, and tournament detail.
- Dashboard analysis is materially smaller and more relevant than the full Analyses page.
- Users can explicitly follow analysts, watch instruments, mute instruments, and choose a dashboard priority mode.
- Existing `/predictions` broad discovery remains available as the place to browse the wider research universe.
- The implementation includes first-touch coverage and deep browser testing coverage for the changed surfaces.

## Non-goals

- Do not rebuild the entire portfolio product.
- Do not rebuild the tournament detail or leaderboard surfaces.
- Do not create a complex recommendation-tuning engine or freeform preference builder.
- Do not remove the Analyses page or instrument-level analysis history.
- Do not introduce real-money trading semantics.
