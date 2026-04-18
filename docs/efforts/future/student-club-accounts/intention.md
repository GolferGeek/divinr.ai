# Effort: Student Club Accounts (Cost-Pass-Through Pricing)

## Problem

Students are a high-leverage early audience — they're already coordinating in investing clubs (St. Thomas Investing Club is the proof point), they have time to engage deeply, and a graduating student becomes a working professional with a Divinr habit. But the $50/mo Basic tier — designed to recover full cost plus markup for regular users — is steep for students. And free-for-students is unsustainable once the system has real compute costs.

The right answer: let students pay **at cost**, using the `cost-modeling-system` to dynamically calculate their actual compute usage. No markup, no profit, but no hit to Divinr either. Break-even pricing for students; regular users pay the same cost plus a significant markup.

## Intention

Create a **Student** membership modifier — gated on `.edu` email verification, priced at the user's actual compute cost (as calculated by the cost-modeling-system), with zero profit margin. Student membership lives on top of the existing user account; the `.edu` credential naturally expires when the student graduates, providing a self-cleaning offboarding mechanism into regular Basic pricing.

## Scope

### .edu Membership Gating

- Students verify a `.edu` email at signup or upgrade
- Periodic re-verification (cadence TBD — probably annual + bounce-triggered)
- Loss of `.edu` validity → graceful transition to regular $50/mo Basic, not a hard kick

### Cost-Pass-Through Pricing

- Student's monthly bill = their actual compute cost as calculated by `cost-modeling-system`
- No per-item authorship markup (if they author custom content, they pay the compute cost, not the $20/$60 markup-inclusive per-item fee)
- Floor price: some minimum (e.g., $10/mo) to prevent truly-zero-usage accounts
- Ceiling: none (if a student authors a lot and runs heavy workflows, they pay for what they use)

### UI / Transparency

- Student dashboard shows **real-time cost breakdown** — "this month so far: $7.42 across 3 instruments and 2 analysts"
- Educational value in the transparency: students literally see the economics of AI workflows
- Monthly statement itemizes compute by stage, model, and triple

### Student Clubs (Social, Unchanged from Basic)

- Student status doesn't change club behavior — clubs remain social-only and free
- St. Thomas Investing Club operates as a regular social club whose members happen to be students
- "Student Club" isn't a separate billable entity — it's a social convention (a club full of verified students)

### Alumni Off-Ramp

- Student graduates → `.edu` lapses
- System offers conversion to regular $50/mo Basic
- Portfolio, predictions, authored content, history all stay intact through the transition
- Authored content transitions to regular per-item pricing at the transition date

## Success Criteria

- St. Thomas Investing Club members operate as Student Accounts with cost-pass-through pricing
- A student's monthly bill accurately reflects their compute consumption (within the headroom of the cost-modeling-system)
- Student dashboard shows transparent per-item / per-stage cost breakdown
- Graduation transitions cleanly to regular Basic without data loss

## Out of Scope

- A separate "Student Club" billing entity (removed — students use normal social clubs)
- Free-for-all student tier (removed — cost-pass-through instead)
- Faculty/advisor admin tooling beyond standard club admin

## Dependencies

- **`cost-modeling-system` must land first and be reasonably accurate** — student pricing depends entirely on it. Without accurate cost calculation, cost-pass-through is uncalibrated.
- `divinr-basic-club-model` — for the broader Basic membership model to slot into

## Open Questions for PRD Phase

- What's the minimum floor — $10/mo? $5/mo? Free-with-ads? Should inform the prevent-abuse mechanics.
- How aggressive is `.edu` re-verification — annual? Login-based? Only on bounce?
- Can a club admin (e.g., faculty advisor) manually approve non-.edu members for edge cases (grad students on alt emails, etc.)?
- Does the student "educational transparency" dashboard live only for students, or should all users see cost breakdowns eventually? (Probably all users; start with students.)

---

*Rescoped after removing club-based billing. The "Student Club" concept dissolves into "Student Accounts" — .edu-gated users with cost-pass-through pricing.*
