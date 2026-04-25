-- Cache Stripe-side fields we read often enough to want a local mirror:
-- latest invoice id, default payment method, the Price variant the user is on,
-- and the card-display fields ("card ending 4242, expires 12/29") so the
-- billing summary view doesn't round-trip Stripe on every render.

ALTER TABLE billing.subscriptions ADD COLUMN IF NOT EXISTS stripe_latest_invoice_id text;
ALTER TABLE billing.subscriptions ADD COLUMN IF NOT EXISTS stripe_default_payment_method_id text;
ALTER TABLE billing.subscriptions ADD COLUMN IF NOT EXISTS stripe_price_id_basic text;
ALTER TABLE billing.subscriptions ADD COLUMN IF NOT EXISTS card_last4 text;
ALTER TABLE billing.subscriptions ADD COLUMN IF NOT EXISTS card_exp_month smallint;
ALTER TABLE billing.subscriptions ADD COLUMN IF NOT EXISTS card_exp_year smallint;
