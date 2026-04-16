# Effort: Custom-to-Base Graduation

## Problem

User-authored custom content (analysts, instrument contracts, instruments) lives in the user-authored layer by default — only the author sees it, the author pays per-item fees and compute. But some authored content turns out to be broadly valuable: consistently-profitable, high-calibration, widely-useful patterns that deserve to be part of the base layer so every Divinr user benefits.

Two things need to happen for that to work:

1. The author consents to the donation (opt-in, not automatic — respects ownership)
2. The author is meaningfully recognized for the contribution (motivation beyond pride)

Without a mechanism, the only paths are (a) the author keeps paying forever in isolation, or (b) the author deletes their work and the value is lost to the system.

## Intention

Build an **opt-in graduation mechanism** that lets authors donate their custom content to the base layer. When donated:

- The content becomes part of base (available to every user, no per-item fee for any enabler including the original author)
- Compute cost shifts from the author to Divinr
- The author stops being billed the per-item fee for that donated item (a cost reduction — $20 or $60 removed from their monthly bill, depending on item type)
- The author is credited on the public **Community Board** surface with attribution and track record
- The author can continue to iterate privately — build a v2 of their analyst/instrument under their own authorship, paying the per-item fee for the new version, while v1 lives in base with their attribution

## Scope

### Opt-In Donation Flow

- Author navigates to their authored content page
- "Donate to Community" action surfaces a preview: "Your AAPL analyst will become available to all Divinr users. You'll be credited as the original author on the Community Analyst Board. Your $60/mo for this analyst will be removed from your next bill. You can still author a v2 privately. Are you proud of this?"
- One-click opt-in (with confirmation)
- System-side: the authored record flips `author_user_id` → `NULL` (base content), but a new `original_author_user_id` column retains attribution; per-item billing line removed on next cycle

### Economic Mechanics

- **Cost reduction as payment.** The $20/instrument or $60/analyst that the author was paying is removed from their bill — a concrete monetary reward for contributing.
- Compute cost for that content now paid by Divinr (it's base content, funded by the general Basic subscription pool)
- No royalties, no buyouts, no per-use payments — the mechanism is simple and self-balancing
- An author who donates 3 analysts ($60 × 3 = $180) has effectively "earned back" 3.6x their $50 Basic subscription — a real incentive to contribute quality work

### Recognition Mechanics

- Community Analyst Board and Community Instrument Board (new product surfaces, see `community-boards` sub-effort or folded here in PRD)
- Each graduated item shows: author name, donation date, track record (hit rate, P&L attribution over its lifetime via `entity-level-performance-attribution`), description, "enable in my portfolio" button
- Public, browsable, becomes a discovery surface for quality content
- "Top-earning custom analysts this month" as a headline metric

### Dual-Track Authorship (v1 on base, v2 private)

- After donating v1, the author can immediately begin authoring v2 under their own `author_user_id`
- v2 is billed at the standard per-item rate and appears in the author's private slot pool
- v1 stays in base with the original author's attribution; they don't own it anymore (can't modify it or withdraw it)
- Donations are irrevocable — once donated, the content is part of base forever (this is important for the stability of users who've enabled it)

### System-Initiated Graduation Invitations (optional, for PRD)

- When `entity-level-performance-attribution` identifies a high-performing custom item (calibration above threshold, sustained over time), the system can send the author a suggestion: "Hey, your China-aware AAPL analyst has outperformed base on growth stocks by 12% over 6 months. Would you consider donating it to the Community Board?"
- Never automatic — always requires author consent

### Admin Moderation (PRD decision)

- Should donations land immediately on the public board, or go through admin review first?
- Author attribution (is this real? is the name appropriate?) may need moderation
- Decision deferred to PRD

## Open Questions for PRD Phase

- Are donations truly irrevocable, or is there a grace period / "recall" window?
- What happens if the original author deletes their account after donating? Does the content stay (yes, probably) and attribution freeze to "Former Author" or remain with the archived name?
- How do we present cost-reduction on the monthly bill — line-item removal with annotation ("removed: AAPL analyst — donated 2026-07-12"), or just cleaner removal without explanation?
- Does the system-initiated invitation feature ship in v1, or is that a v2?
- Community boards moderation model — admin-gated approval vs. auto-promotion with flagging?
- Can donated content be "un-published" from the community board (hidden) while still remaining in base for existing enablers? (Probably no — simpler semantics.)
- If an author is gaming the system (authoring low-effort content, immediately donating, collecting the cost-reduction), how do we detect that? Probably: track donation-to-authorship time ratio, flag suspicious patterns for admin review.

## Success Criteria

- An author can donate an authored analyst or instrument in a single intentional action
- The donated content immediately becomes available to all users, with author attribution
- The per-item billing line is removed from the author's next statement
- The author can create a v2 of the same-named content under their own authorship without conflict
- The community board surfaces graduated content with real track-record data

## Out of Scope

- Royalty / buyout payment models (master intention picked cost-reduction only)
- Non-consensual graduation (system never auto-promotes without author opt-in)
- The community board UI as a whole separate browsable surface (may be folded here in PRD, or may be its own `community-boards` effort — decision during PRD phase)
- Advanced moderation infrastructure beyond basic admin review

## Dependencies

- `user-authored-custom-content` — must exist for there to be custom content to graduate
- `entity-level-performance-attribution` — provides the track-record data that makes graduation decisions and community-board displays meaningful
- `stripe-integration` — for line-item removal on donation
- `triple-model-reasoning-continuity` — triples need to be convertible from user-authored (`author_user_id` set) to base (`author_user_id` NULL, `original_author_user_id` retained)

---

*The "R&D pipeline for base content" — user-authored becomes the discovery layer, community board is the showcase, cost reduction is the reward. Individuals effectively function as paid R&D contributors whose successful work graduates into the shared system.*
