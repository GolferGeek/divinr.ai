-- Track which Stripe Price was used when this authored item was attached to
-- the user's subscription. Needed for the .edu-lapse re-pricing flow (Phase 4):
-- on lapse we walk every subscription item, look up the matching authored_items
-- row, and if its stripe_price_id is one of our student variants we swap it for
-- the regular equivalent via stripe.subscriptionItems.update.
--
-- Also useful for the "pending Stripe sync" admin display when stripe_subscription_item_id
-- is non-null but the user has been re-priced — the price column tells us which
-- variant they're currently on without a Stripe round-trip.

ALTER TABLE billing.authored_items ADD COLUMN IF NOT EXISTS stripe_price_id text;
