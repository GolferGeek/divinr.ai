-- Slot-based triple enablement: tracks which (author, analyst, instrument) triples
-- each user has enabled in their portfolio view.

CREATE TABLE IF NOT EXISTS prediction.user_enabled_triples (
  id              text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id         text        NOT NULL,
  author_user_id  text,
  analyst_id      text        NOT NULL REFERENCES prediction.market_analysts(id),
  instrument_id   text        NOT NULL REFERENCES prediction.instruments(id),
  enabled_at      timestamptz NOT NULL DEFAULT now(),
  disabled_at     timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_user_enabled_triple
  ON prediction.user_enabled_triples (
    user_id,
    COALESCE(author_user_id, 'base'),
    analyst_id,
    instrument_id
  );

CREATE INDEX IF NOT EXISTS idx_user_enabled_triples_active
  ON prediction.user_enabled_triples (user_id)
  WHERE disabled_at IS NULL;
