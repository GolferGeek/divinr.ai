import type { RouteLocationRaw } from 'vue-router';
import { DISCLAIMERS } from './disclaimers';

/**
 * Content for per-user first-touch walkthroughs.
 *
 * Keys are dotted surface identifiers; see
 * docs/efforts/current/onboarding-tour-extended/prd.md Appendix A for the
 * locked inventory (105 keys). Keys whose views do not yet exist are still
 * authored here so they activate the moment the view ships — tracked in
 * apps/web/src/onboarding/pending-surfaces.md.
 */
export interface SurfaceContent {
  title: string;
  body: string;
  cta?: { label: string; to: RouteLocationRaw };
}

export const surfaceContent: Record<string, SurfaceContent> = {
  // ───────────────────────── Top-level sections ─────────────────────────
  dashboard: {
    title: 'Welcome to your dashboard',
    body:
      "This is where the day kicks off. You'll see what analysts are watching, " +
      "how yesterday's trades landed, and anything urgent that came in overnight. " +
      'Scroll around — nothing here commits you to anything.',
  },
  predictions: {
    title: "Today's analyses",
    body:
      "Each card is one analyst's read on one instrument: direction, conviction, " +
      'and the reasoning behind it. Tap a card to see the full debate and decide for yourself.',
  },
  instruments: {
    title: 'Research — the tickers we watch',
    body:
      'Every ticker we cover lives here. Open one to see how our analysts frame ' +
      'it — what debates they run, how they disagree, and what they think is ' +
      'happening right now.',
  },
  portfolios: {
    title: 'Your portfolios',
    body:
      'Paper portfolios tracking analyst signals. Flip between your analysts to ' +
      'see how each one is doing with real positions over time.',
  },
  performance: {
    title: 'How our analysts are doing',
    body:
      'Equity curves, calibration charts, leaderboards — how we keep score. ' +
      'Credible models stay; noisy ones get retired by the learning loop.',
  },
  analysts: {
    title: 'Meet the analysts',
    body:
      "Every analyst has a name, a published contract (what they look at, how " +
      'they reason), and a running track record. Click into one to audit their ' +
      'work — nothing is a black box.',
  },
  clubs: {
    title: 'Clubs are the social layer',
    body:
      "A club is where you and your friends meet inside Divinr — shared analysts, " +
      'tournaments, messaging, curricula. Totally optional, but most folks have fun once they try one.',
  },
  tournaments: {
    title: 'Tournaments',
    body:
      "Timed trading contests. Pick a universe, a window, a rulebook — then you " +
      'and the AI analysts compete on the same set of instruments. Good for ' +
      'calibrating both sides: your instincts and the machine.',
  },
  messages: {
    title: 'Club chat and DMs',
    body:
      'Conversations with your club, your mentor, or any friend. React, thread, ' +
      'and share analyst signals inline — send a signal card instead of a screenshot.',
  },
  notifications: {
    title: 'Your inbox',
    body:
      'Rank changes, tournament pings, mentor nudges, system updates. We try not ' +
      'to be noisy — if something is here, it probably matters.',
  },
  settings: {
    title: 'Settings',
    body:
      'Your preferences live here: what you author, how you get notified, ' +
      'walkthrough controls, billing. Poke around — nothing is saved until you act.',
  },

  // ───────────────────── Analyses & trade path ──────────────────────
  'prediction.card': {
    title: 'Anatomy of an analysis',
    body:
      'A card surfaces one analyst on one instrument: direction arrow, ' +
      "conviction bar, and the headline reasoning. Tap it to see the full analysis " +
      "and every analyst's position on this instrument.",
  },
  'prediction.detail': {
    title: 'The whole analysis',
    body:
      'All five analysts side by side. Arbitrator synthesis up top; the raw ' +
      'disagreements below. Open two rationales that conflict and read both — that ' +
      'is usually where the learning is.',
  },
  'prediction.trade-cta': {
    title: 'About the trade button',
    body:
      "When conviction is high enough, you'll see a trade CTA. It's a paper trade " +
      'by default — nothing touches real money unless you explicitly wire up a ' +
      "broker. Divinr shows analysis and signals; the decision is always yours.",
  },
  'prediction.sources': {
    title: 'Where the analysis came from',
    body:
      "The articles your analyst cited for this specific call. Tap a title to " +
      "open the original article in a new tab. Older analyses (before this " +
      "feature shipped) show a best-effort list of recent articles instead.",
  },
  'tournament.picker': {
    title: 'Pick a tournament',
    body:
      'Filter by window, universe, or club to find one that fits your style. ' +
      'Tournaments are short by design — try one as a low-stakes warmup.',
  },

  // ───────────────────────── Instrument surfaces ───────────────────────
  'instrument.detail': {
    title: 'Everything Divinr thinks about this ticker',
    body:
      'Arbitrator synthesis up top; each analyst side by side below; tabs for ' +
      'raw scoring, history, and the debate transcript. The whole picture in one page.',
  },
  'instrument.debate': {
    title: 'Blue vs. Red vs. Arbiter',
    body:
      'One agent argues the bull case, one argues the bear case, and the arbiter ' +
      'synthesizes. The whole transcript is readable — the AI is not one voice, ' +
      "it's a structured disagreement you can audit.",
  },
  'instrument.variant-switcher': {
    title: 'Switch analyst variants',
    body:
      'Different analyst configurations see the same instrument differently. ' +
      'Flip between variants to compare how each one weighs the inputs.',
  },
  'instrument.article-relevance': {
    title: 'Articles scored for this ticker',
    body:
      "This is where our analysts score the articles they've read for how " +
      'relevant each one is to this ticker. Higher scores mean the article likely ' +
      "fed into a recent analyst signal. Use this tab to audit which news shaped today's take.",
  },

  // ────────────────────────── Analyst surfaces ─────────────────────────
  'analyst.detail': {
    title: "An analyst's page",
    body:
      'Their published contract, their history of calls, their running ' +
      'performance. Read a few rationales end-to-end before you decide whether to ' +
      'trust them.',
  },
  'analyst.contract-viewer': {
    title: 'The contract — their rulebook',
    body:
      'Exactly what this analyst looks at, how they reason, and what updates ' +
      "when the learning loop nudges them. Read this before you decide whether to " +
      'trust a call.',
  },
  'analyst.calibration-drilldown': {
    title: 'Are they calibrated?',
    body:
      'How often a 70%-confidence call actually wins 70% of the time. A ' +
      'well-calibrated analyst is a trustworthy one; a miscalibrated one is a ' +
      'loud one.',
  },
  'analyst.affinity': {
    title: 'Who agrees with this analyst',
    body:
      'Not everyone who agrees is right, but when analysts cluster together ' +
      "you learn something about the structure of the debate.",
  },

  // ──────────────────────────── Portfolio ──────────────────────────────
  'portfolio.my-triples': {
    title: 'Your enabled triples',
    body:
      "A triple is analyst × universe × strategy — the unit of what's running for " +
      'you. Toggle them on and off; your portfolios update on the next tick.',
  },
  'portfolio.add-triple': {
    title: 'Add a new triple',
    body:
      'Pick an analyst, a universe, and a strategy. Anything you enable starts ' +
      "running on paper right away. You're not locked in — flip it off any time.",
  },
  'portfolio.position-row': {
    title: 'What a position line means',
    body:
      'Entry, current price, running P&L, and the signal trail that got you in. ' +
      'Click through for the analyst-level reasoning behind every trade.',
  },
  'portfolio.detail': {
    title: 'Your portfolio, up close',
    body:
      'Open positions, realized P&L, and the trail of decisions. Everything is ' +
      'paper by default; real money only lights up if you wire up a broker, and ' +
      "we'll nudge you hard before anything goes live.",
  },

  // ─────────────────────────── Performance ─────────────────────────────
  'performance.equity-curve': {
    title: 'Equity curves',
    body:
      'Analyst returns plotted against SPY. Hover for the point-in-time picks; ' +
      'click to drill into any period that surprised you.',
  },
  'performance.attribution': {
    title: 'Where the returns came from',
    body:
      'Which analyst, which signal, which instrument drove the P&L. Good for ' +
      'separating lucky calls from repeatable ones.',
  },
  'performance.author-retention': {
    title: 'Who stuck around',
    body:
      'A view of how authored analysts are performing and retaining relative to ' +
      'the base roster. Matters most if you author custom analysts yourself.',
  },
  'performance.leaderboard': {
    title: 'Leaderboard',
    body:
      'Top analysts by risk-adjusted returns over the window you pick. The ' +
      'learning loop uses this (and calibration) to retire the laggards.',
  },

  // ─────────────────────────────── Clubs ───────────────────────────────
  'club.discover': {
    title: 'Find a club',
    body:
      'Browse or search for clubs to join. Each one sets its own universe, ' +
      'tournament cadence, and analyst picks — find one that matches how you trade.',
  },
  'club.create': {
    title: 'Start your own club',
    body:
      "You pick the name, the members, and the tone. We'll handle the " +
      'infrastructure — analysts, tournaments, messaging all wire up for free.',
  },
  'club.detail': {
    title: "Inside a club",
    body:
      'Members, tournaments, analysts, activities, curricula, mentoring. Every ' +
      'tab is optional — most clubs lean on two or three of them.',
  },
  'club.activities': {
    title: 'Recent activity',
    body:
      'The club feed: trades, debates, new analysts, leaderboard shuffles. A ' +
      "good place to catch up if you've been away for a few days.",
  },
  'club.mentoring': {
    title: 'Mentoring',
    body:
      'Pair up with someone more experienced (or offer to mentor someone newer). ' +
      'Mentor pairs get shared curricula and a dedicated thread.',
  },
  'club.curriculum': {
    title: 'Curricula',
    body:
      'Structured learning paths the club runs together — reading a new ' +
      "instrument, interpreting a risk debate, authoring your first analyst. Opt-in, " +
      'no grades.',
  },
  'club.analysts': {
    title: "Your club's analyst roster",
    body:
      "The analysts this club has enabled. Different clubs run different " +
      'personalities — which means the same tournament can produce different signals ' +
      'for different clubs.',
  },
  'club.opt-outs': {
    title: 'Opt out of club features',
    body:
      "Not every club feature is for everybody. Mute tournaments, skip curricula, " +
      "hide the mentor pairing — choose what actually fits your style.",
  },

  // ─────────────────────────── Tournaments ─────────────────────────────
  'tournament.list': {
    title: 'All tournaments',
    body:
      'Active, upcoming, and past contests. Each one has its own universe, ' +
      "window, and rulebook; pick one to see the specifics before you join.",
  },
  'tournament.detail.info': {
    title: 'Tournament rulebook',
    body:
      'Universe, start/end, entry rules, scoring. Read this first — the rulebook ' +
      "is half the fun.",
  },
  'tournament.detail.trade': {
    title: 'Trade inside a tournament',
    body:
      "The trade desk scoped to this tournament's universe and window. Every " +
      "signal fires through the tournament's rules — no accidental spillover to " +
      'your main portfolio.',
  },
  'tournament.detail.leaderboard': {
    title: 'Live tournament leaderboard',
    body:
      'You and the AI analysts ranked on the same scale. Updates in real time ' +
      "as signals land. Watch the standings shift — it's a good lens on how your " +
      'instincts compare.',
  },
  'tournament.detail.my-positions': {
    title: 'Your tournament positions',
    body:
      'Just the trades you made in this tournament — separated from your main ' +
      "portfolio so you can evaluate each one on its own terms.",
  },
  'tournament.avatar-stack': {
    title: 'Who is in this tournament',
    body:
      'Humans and AI analysts competing together. Click an avatar for their ' +
      'running P&L and the trades they made in this tournament.',
  },

  // ──────────────────────────── Messaging ──────────────────────────────
  'messages.dm': {
    title: 'Direct messages',
    body:
      "Your 1:1s. React, thread, and share analyst signals or tournament entries " +
      'inline. Messages are encrypted at rest; nobody else is reading them.',
  },
  'messages.channel': {
    title: 'Club channels',
    body:
      'A channel is a topic inside a club. React, thread, pin — same tools as ' +
      "any modern chat, but with Divinr cards embedded as first-class messages.",
  },
  'messages.direct-message-intent': {
    title: 'About to DM someone?',
    body:
      "You can always revoke a DM intent before it lands. Club members see a small " +
      'notice when you opt into DMs from them.',
  },

  // ──────────────────────────── Authoring ──────────────────────────────
  'authoring.custom-analyst.create': {
    title: 'Start a custom analyst',
    body:
      "Your own analyst with your own thesis. You'll pick a name, a universe, " +
      "sources, and relationships — then the editor walks you through the contract. " +
      "Everything is editable later.",
  },
  'authoring.custom-analyst.editor': {
    title: 'The contract editor',
    body:
      "This is where you shape how your analyst reasons. It's dense on purpose — " +
      "every section is auditable by anyone who reads the contract. Save often; " +
      "nothing is published until you flip Live.",
  },
  'authoring.custom-instrument.create': {
    title: 'Define a new instrument',
    body:
      "Pick a ticker or asset, a universe, and the data sources we should watch. " +
      "Once created, any of your analysts (or club analysts) can cover it.",
  },
  'authoring.custom-instrument.editor': {
    title: 'Edit an instrument',
    body:
      "Update data sources, universes, or the variant set. Changes apply to all " +
      'analysts that cover the instrument on the next run.',
  },
  'authoring.contract-section.predictor-generation': {
    title: 'Signal generation',
    body:
      "How your analyst produces candidate setups from raw data. Be specific " +
      "here — vague signal generators lead to vague calls.",
  },
  'authoring.contract-section.risk-assessment': {
    title: 'Risk assessment',
    body:
      "Where the bull/bear debate rubric lives. This is what the arbiter uses to " +
      "synthesize the final signal — specify what evidence counts.",
  },
  'authoring.contract-section.prediction-generation': {
    title: 'Analysis generation',
    body:
      "How candidate setups become direction + conviction. Spell out your " +
      "thresholds so the learning loop can nudge them later from real outcomes.",
  },
  'authoring.contract-section.learning': {
    title: 'Learning rules',
    body:
      "What the system should adapt when your analyst is wrong — and what it " +
      "should leave alone. The best contracts have clear learning scopes.",
  },
  'authoring.contract-section.adaptations': {
    title: 'Adaptations',
    body:
      "Recorded changes to the contract over time, human-readable. Review these " +
      "to see how the learning loop has been shaping your analyst's behavior.",
  },
  'authoring.byo-llm': {
    title: 'Bring your own model',
    body:
      "Plug in your own LLM credentials — OpenAI, Anthropic, local Ollama. Your " +
      "custom analysts use whatever model you pick; the base roster stays on the " +
      "shared backend.",
  },
  'authoring.relationship-selection': {
    title: 'How analysts relate',
    body:
      "The wiring matrix. Which analysts feed yours, which ones your analyst " +
      "feeds, and how strongly. Most authors keep this simple at first.",
  },
  'authoring.source-selection': {
    title: 'Source selection',
    body:
      "Which data sources your analyst is allowed to cite. Fewer, higher-quality " +
      "sources usually beat more, noisier ones.",
  },

  // ──────────────────────── Authored content ───────────────────────────
  'authored.overview': {
    title: 'Everything you author',
    body:
      "Your custom analysts, instruments, and contracts — all in one place. Run " +
      "counts, latest adaptations, and a quick jump to the editor.",
  },
  'authored.attribution.mine': {
    title: 'Credit for your authored work',
    body:
      "How often your analysts are cited in other folks' trades and tournaments. " +
      "Fun to watch; also used in power-user tier calculations down the line.",
  },

  // ───────────────────────── Risk & sentiment ──────────────────────────
  'risk-dashboard': {
    title: 'Today\u2019s risk picture',
    body:
      "Cross-instrument risk assessments and the live debates behind them. Good " +
      "as a morning scan — where are the bull/bear disagreements loudest today?",
  },
  'fear-greed-alerts': {
    title: 'Fear & Greed alerts',
    body:
      "Sentiment pings when the market-wide emotion dial swings. Calibration " +
      "notes attached so you know when to trust the signal and when to shrug.",
  },

  // ──────────────────────────── Coordination ───────────────────────────
  'analyst.coordination': {
    title: 'How analysts coordinate',
    body:
      "When multiple analysts agree (or don't), this is where that consensus is " +
      "scored and reconciled. Affects which analyses get promoted to the " +
      "top of your dashboard.",
  },

  // ────────────────────────────── Sources ──────────────────────────────
  sources: {
    title: 'The sources we read',
    body:
      "Every article, filing, and feed our analysts pull from. Filter by quality " +
      "or recency; click into any source to see what was extracted.",
  },
  'source.quality': {
    title: 'Source quality',
    body:
      "Our running take on which sources produce useful signal vs. noise. " +
      "Sources drift; we track them so you don't have to.",
  },

  // ────────────────────── Per-instrument attribution ───────────────────
  'instrument.attribution': {
    title: 'Where this ticker\u2019s signal came from',
    body:
      "For the selected instrument: which sources contributed what, and how much " +
      "the arbiter weighted each one. Helpful when a call surprises you.",
  },

  // ───────────────────── Curriculum & learning ─────────────────────────
  'learning-dashboard': {
    title: 'What Divinr is learning',
    body:
      "The learning loop in action — which contracts adapted today, which got " +
      "nudged, which retired. You don't have to follow this to use Divinr, but " +
      "it's fun to peek.",
  },
  'curriculum.dashboard': {
    title: 'Your curriculum',
    body:
      "Progress through the learning path your club picked. Pick up where you " +
      "left off — curricula are self-paced, no due dates.",
  },
  'curriculum.create': {
    title: 'Start a curriculum',
    body:
      "A structured sequence of topics and tournaments — good for onboarding new " +
      "club members, or for working through a theme (options, macro, crypto).",
  },
  'curriculum.detail': {
    title: 'Curriculum detail',
    body:
      "Lessons, related tournaments, and how your club is doing on them. Jump " +
      "into any lesson; the dashboard remembers where you were.",
  },

  // ────────────────────────────── Mentor ───────────────────────────────
  'mentor.dashboard': {
    title: 'Your mentees',
    body:
      "If you've offered mentoring in your club, this is where you see who's " +
      "paired with you, how their trades are going, and any threads awaiting " +
      "your reply.",
  },

  // ───────────────────────── Tournaments extra ─────────────────────────
  'tournament.create': {
    title: 'Host a tournament',
    body:
      "Pick a universe, a window, and a rulebook — then invite your club (or " +
      "open it up). You can copy a past tournament as a template to save time.",
  },
  'tournament.history': {
    title: 'Past tournaments',
    body:
      "Every tournament you've entered, with final standings and the trades you " +
      "made. Great for a post-mortem or for cloning a ruleset you liked.",
  },
  'tournament.invite-landing': {
    title: 'You were invited',
    body:
      "Here are the basics of the tournament — universe, window, rulebook, who's " +
      "hosting. No commitment until you click Join.",
  },

  // ───────────────────────── Clubs extra ───────────────────────────────
  'club.compare': {
    title: 'Compare clubs',
    body:
      "Head-to-head across tournaments, portfolios, and calibration. Fun as a " +
      "measuring stick; don't take it too seriously — clubs trade different " +
      "universes.",
  },
  'club.rankings': {
    title: 'Club rankings',
    body:
      "Our take on how clubs are doing across the site. Risk-adjusted, so a " +
      "small club running tight isn't crushed by a big club running wide.",
  },
  'club.invite-landing': {
    title: "You're invited to a club",
    body:
      "Here's what this club is about, who's in it, and what tournaments they " +
      "run. No pressure — you can browse the club without joining.",
  },
  'club.join-signup': {
    title: 'Join and sign up',
    body:
      "One step: make an account and join the club that invited you. You can " +
      "change clubs or leave any time.",
  },

  // ─────────────────────────── Auth & onboarding ───────────────────────
  'auth.invite-signup': {
    title: 'You were invited',
    body:
      "The person who invited you has set up a starter profile for you. Pick a " +
      "password, check the handle, and you're in.",
  },
  'welcome-modal': {
    title: 'Thanks for coming',
    body:
      "Divinr has a lot going on — five AI analysts, risk debates, portfolios, " +
      "clubs, tournaments. Want a 10-minute tour? Or skip and poke around on " +
      "your own. Either way, welcome.",
  },

  // ─────────────────────── Cost & billing ──────────────────────────────
  'billing.summary': {
    title: 'Billing summary',
    body:
      "Your current plan, what you're using, and what the next invoice will " +
      "look like. Usage-based; nothing surprise-bills you mid-month.",
  },
  'billing.compute-breakdown': {
    title: 'Where compute went',
    body:
      "LLM inference is the main cost; this page shows exactly which analysts " +
      "and tournaments used what. Good for debugging a bill that surprises you.",
  },
  'billing.student-accrual': {
    title: 'Student accrual',
    body:
      'Students on cost-pass-through accounts see accrued inference usage here ' +
      "so it's clear what's accumulating against the monthly floor.",
  },
  'billing.trial-countdown': {
    title: 'Your free trial',
    body:
      "You're on the free trial. This chip shows how many days you have left " +
      "before the account converts or goes read-only. " +
      "If a payment ever fails, this same chip turns yellow with “Payment failed — retrying” " +
      "while Stripe automatically retries the charge — your account stays fully usable. " +
      "If you haven’t added a card yet, the chip becomes a blue “Add a card” button that opens " +
      "Stripe’s hosted Checkout in one click.",
  },
  'billing.read-only-banner': {
    title: 'Your trial has ended',
    body:
      'Your data is still here — the account is just read-only until a card is ' +
      'added. You can keep browsing analyses and portfolios; new authored content ' +
      'and trading actions resume the moment billing is active.',
  },
  'billing.bill-overview': {
    title: "What's on your bill",
    body:
      "Your monthly total rolls up the $50 Basic subscription plus any authored " +
      "analysts ($60 each) or authored instruments ($20 each) you own, plus a $10 " +
      "BYO platform fee if you're using your own API key. Expand a rollup row to " +
      "see the per-item detail.",
  },
  'pricing.overview': {
    title: 'Divinr pricing',
    body:
      "One plan, $50/month, 30-day free trial. Authored content is add-on: $60/mo " +
      "per custom analyst, $20/mo per custom instrument, $10/mo BYO platform fee. " +
      "Everything else — analyses, signals, risk debates, reasoning, performance, " +
      "clubs — is included in Basic.",
  },

  // ────────────────────────────── Admin ────────────────────────────────
  'admin.user-billing': {
    title: 'Admin user billing',
    body:
      "Read-only analyst view of a single user's billing picture: subscription state, " +
      "authored items (custom analysts, instruments, BYO platform fee), the audit " +
      "trail of subscription events, and the itemized monthly total. No write actions " +
      "here — Stripe reactivation and manual overrides live in their own surfaces.",
  },
  'admin.cost-modeling.calibration': {
    title: 'Cost calibration',
    body:
      "How our estimated vs. actual inference cost is tracking over time. " +
      "Use this before adjusting quotas or pricing tiers.",
  },
  'admin.cost-modeling.defensibility': {
    title: 'Cost defensibility',
    body:
      "Per-analyst margin analysis under different pricing assumptions. Helpful " +
      "when deciding which analysts to include in lower tiers.",
  },
  'admin.cost-modeling.experiments': {
    title: 'Cost experiments',
    body:
      "A/B tests on prompt shape, model choice, and run cadence. Runs that " +
      "don't pay for themselves in quality get pruned here.",
  },
  'admin.llm-usage': {
    title: 'LLM usage dashboard',
    body:
      "Current model throughput, queue depth, and error rates. Serial-by-design " +
      "on local hardware, so the queue graph is the page to watch.",
  },
  'admin.day-trader-runs': {
    title: 'Day-trader runs',
    body:
      "Intraday run history: when each analyst fired, what signals came out, " +
      "how long each took. Useful for debugging a stale analysis.",
  },
  'admin.findings-inbox': {
    title: 'Audit findings inbox',
    body:
      "Automated sanity checks that flagged something — calibration drift, " +
      "missing data, suspicious rationales. Triage before they become user-facing " +
      "bugs.",
  },
  'admin.evaluations': {
    title: 'Evaluations',
    body:
      "Running scorecards across analyst contracts and their adaptations. " +
      "Also powers the learning-loop retirement decisions.",
  },
  'admin.runs.list': {
    title: 'All runs',
    body:
      "Every pipeline run on the box: stage, elapsed, status. Click into any " +
      "run to see the per-stage breakdown and logs.",
  },
  'admin.runs.detail': {
    title: 'Run detail',
    body:
      "Stage-by-stage trace of one run. Inputs, outputs, artifacts, and elapsed. " +
      "Start here when something looks off in production.",
  },
  'admin.canonical-day': {
    title: 'Canonical day',
    body:
      "The reference day used to dry-run contract changes. Changes that don't " +
      "reproduce the canonical day's signals get flagged.",
  },
  'admin.proposals': {
    title: 'Proposals',
    body:
      "Contract adaptations proposed by the learning loop that await review. " +
      "Approve, reject, or edit before they land.",
  },
  'admin.graduation-candidates': {
    title: 'Graduation candidates',
    body:
      "Authored analysts whose track records qualify them to graduate into the " +
      "shared base roster. Review and promote here.",
  },
  'admin.contract-editor': {
    title: 'Admin contract editor',
    body:
      "Full-power editor for the base-roster contracts. Same UI as authoring, " +
      "but every change ships to every user — so proceed carefully.",
  },
  'admin.notification-debug': {
    title: 'Notification debug',
    body:
      "Trace and replay notifications. Useful when a user reports they didn't " +
      "get paged for a rank change or alert.",
  },
  'admin.attribution': {
    title: 'Attribution admin',
    body:
      "Global view of which authored analysts and instruments are earning " +
      "citation credit — raw data behind the authoring attribution reports.",
  },
  'admin.domain-dashboard': {
    title: 'Domain dashboard',
    body:
      "Per-domain (stocks, crypto, macro) health: article throughput, analyst " +
      "coverage, debate quality. Helps decide where to add sources next.",
  },

  // ───────────────────────────── Settings ──────────────────────────────
  'settings.onboarding': {
    title: 'Onboarding controls',
    body:
      "Turn walkthroughs off, replay a section, or show every intro again. " +
      "Handy when Divinr adds new surfaces — or when you're bringing a friend " +
      "aboard.",
  },
  'settings.opt-outs': {
    title: 'Opt-outs',
    body:
      "Mute whole categories of surfaces — tournaments, authoring, curricula. " +
      "Nothing is deleted; you can flip any of them back on later.",
  },
  'settings.social-opt-outs': {
    title: 'Visibility & social',
    body:
      "Choose where on Divinr your name shows up — club rosters, messaging " +
      "search, tournament pages, leaderboards, and platform notifications. " +
      "Toggling anything off keeps the underlying feature working; only the " +
      "social surface changes.",
  },
  'settings.byo-credentials': {
    title: 'Your model credentials',
    body:
      "Plug in the LLM keys your custom analysts use. Credentials are stored " +
      "encrypted and only used by analyst runs you own.",
  },
  'settings.profile': {
    title: 'Your profile',
    body:
      "Handle, display name, avatar, email. What other people see in clubs and " +
      "DMs. Easy to change any time.",
  },
  'settings.terms': {
    title: 'Terms of service',
    body: DISCLAIMERS.short,
  },
};
