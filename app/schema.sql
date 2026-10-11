-- UsageBill schema. Safe to re-run (IF NOT EXISTS everywhere).
-- Money and quantities are NUMERIC, never floating point.

CREATE TABLE IF NOT EXISTS customers (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL CHECK (length(btrim(name)) > 0),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per metered usage event.
-- The UNIQUE constraint is what makes ingestion idempotent: a retried request
-- with the same (customer_id, idempotency_key) can never create a second row,
-- even under concurrent requests. The database enforces it, not application code.
CREATE TABLE IF NOT EXISTS usage_events (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id      UUID NOT NULL REFERENCES customers(id),
    quantity         NUMERIC(20, 6) NOT NULL CHECK (quantity > 0),
    occurred_at      TIMESTAMPTZ NOT NULL,
    idempotency_key  TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 255),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT usage_events_idempotency_uq UNIQUE (customer_id, idempotency_key)
);

-- Invoice generation sums usage per customer per billing period.
CREATE INDEX IF NOT EXISTS usage_events_customer_time_idx
    ON usage_events (customer_id, occurred_at);
