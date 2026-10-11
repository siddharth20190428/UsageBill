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

-- Plans are immutable once created. Changing a price means creating a new plan, so an
-- invoice recomputed later can never silently change because someone edited a price.
CREATE TABLE IF NOT EXISTS plans (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL UNIQUE CHECK (length(btrim(name)) > 0),
    currency    CHAR(3) NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$'),
    base_fee    NUMERIC(20, 2) NOT NULL DEFAULT 0 CHECK (base_fee >= 0),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Graduated pricing tiers. up_to is the cumulative upper bound; NULL means unbounded.
CREATE TABLE IF NOT EXISTS plan_tiers (
    plan_id     UUID NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
    position    INTEGER NOT NULL CHECK (position >= 1),
    up_to       NUMERIC(20, 6) CHECK (up_to > 0),
    unit_price  NUMERIC(20, 6) NOT NULL CHECK (unit_price >= 0),
    PRIMARY KEY (plan_id, position)
);

-- Database backstop: at most one unbounded tier per plan. (Ordering of up_to values is
-- validated in app/pricing.py before anything is written.)
CREATE UNIQUE INDEX IF NOT EXISTS plan_tiers_one_unbounded_idx
    ON plan_tiers (plan_id) WHERE up_to IS NULL;

-- Needed so the exclusion constraint below can combine "same customer" (equality) with
-- "overlapping time range".
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- A customer's plan over time. ends_at NULL means "still active".
-- The EXCLUDE constraint makes it impossible, at the database level, for one customer to have
-- two subscriptions that overlap in time. Overlap would mean billing the same time twice.
CREATE TABLE IF NOT EXISTS subscriptions (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id  UUID NOT NULL REFERENCES customers(id),
    plan_id      UUID NOT NULL REFERENCES plans(id),
    starts_at    TIMESTAMPTZ NOT NULL,
    ends_at      TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT subscriptions_period_valid CHECK (ends_at IS NULL OR ends_at > starts_at),
    CONSTRAINT subscriptions_no_overlap
        EXCLUDE USING gist (customer_id WITH =, tstzrange(starts_at, ends_at) WITH &&)
);

-- An invoice is the immutable record of one customer's calendar month (UTC).
-- UNIQUE (customer_id, period_start) is what makes invoice generation idempotent, and because
-- periods are whole calendar months, two invoices for one customer can never overlap.
CREATE TABLE IF NOT EXISTS invoices (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id   UUID NOT NULL REFERENCES customers(id),
    period_start  TIMESTAMPTZ NOT NULL,
    period_end    TIMESTAMPTZ NOT NULL,
    currency      CHAR(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    total         NUMERIC(20, 2) NOT NULL CHECK (total >= 0),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT invoices_period_valid CHECK (period_end > period_start),
    CONSTRAINT invoices_one_per_period UNIQUE (customer_id, period_start)
);

CREATE TABLE IF NOT EXISTS invoice_lines (
    invoice_id   UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    position     INTEGER NOT NULL CHECK (position >= 1),
    kind         TEXT NOT NULL CHECK (kind IN ('base_fee', 'usage')),
    description  TEXT NOT NULL,
    quantity     NUMERIC(20, 6),
    unit_price   NUMERIC(20, 6),
    amount       NUMERIC(20, 2) NOT NULL CHECK (amount >= 0),
    PRIMARY KEY (invoice_id, position)
);
