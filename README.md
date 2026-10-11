# UsageBill

A usage-based billing service. Customers send metered usage events; the service
will price them (tiers, proration) and generate invoices that can never double-bill.

**Status:** usage ingestion and tiered pricing plans are done and tested. Proration and invoice generation come next.

## Run it in GitHub Codespaces

Open the repo on GitHub, then **Code > Codespaces > Create codespace on main**. The dev container
starts Python 3.12 and Postgres 16 and installs dependencies. When it finishes, in the terminal:

```bash
pytest                              # tests run against the bundled Postgres
uvicorn app.main:app --reload       # Codespaces forwards port 8000; open it from the Ports tab
```

## Run it locally

Requires Python 3.11+ and Docker.

```bash
# 1. Start Postgres (also creates the usagebill_test database)
docker compose up -d

# 2. Install dependencies
python -m venv .venv
source .venv/bin/activate          # Windows PowerShell: .venv\Scripts\Activate.ps1
pip install -r requirements.txt

# 3. Run the tests
pytest

# 4. Start the API (docs at http://localhost:8000/docs)
uvicorn app.main:app --reload
```

If the init script didn't create the test database (it only runs the first time the
volume is created), run: `docker compose exec db createdb -U usagebill usagebill_test`

## Try it

```bash
# Create a customer
curl -s -X POST localhost:8000/customers -H 'content-type: application/json' \
  -d '{"name": "Acme Corp"}'

# Record usage (run it twice: the second call returns the same event with duplicate=true)
curl -s -X POST localhost:8000/usage -H 'content-type: application/json' -d '{
  "customer_id": "<id from above>",
  "quantity": "10.5",
  "occurred_at": "2026-10-01T12:00:00Z",
  "idempotency_key": "evt-1"
}'
```

### Plans and quotes

```bash
# A plan: $20 base fee, first 100 units @ 0.10, up to 1000 @ 0.08, beyond that @ 0.05
curl -s -X POST localhost:8000/plans -H 'content-type: application/json' -d '{
  "name": "Growth",
  "base_fee": "20.00",
  "tiers": [
    {"up_to": "100",  "unit_price": "0.10"},
    {"up_to": "1000", "unit_price": "0.08"},
    {"up_to": null,   "unit_price": "0.05"}
  ]
}'

# What would 1,250 units cost? (100*0.10 + 900*0.08 + 250*0.05 + 20.00 = 114.50)
curl -s -X POST localhost:8000/plans/<plan id>/quote -H 'content-type: application/json' \
  -d '{"quantity": "1250"}'
```

## Design decisions

**Graduated tiers.** Each tier prices only the units that fall inside it, so 1,250 units are
split 100 / 900 / 250 across the tiers above. A quantity exactly on a boundary belongs to the
lower tier. The logic is a pure function in `app/pricing.py` (no database, no I/O), so the
edge cases are unit-tested directly.

**Rounding.** Each tier's charge is rounded once to the cent (half-up) and the total is the sum
of those rounded lines, so an invoice always adds up exactly as printed. Half-cent amounts like
1.005 round to 1.01, which binary floats get wrong (`round(1.005, 2) == 1.0`), another reason
everything is `Decimal`.

**Plans are immutable.** There is no update endpoint. Changing a price means creating a new plan,
so an invoice recomputed later can never change because someone edited a price.

**Create is all-or-nothing.** A plan and its tiers are written in one transaction, so a failure
never leaves a plan without tiers or orphan tiers behind.

**Validation in layers.** Malformed tiers (empty, out of order, bounded last tier, negative price)
are rejected with a field-level 422 before anything is written. The database adds a backstop: a
partial unique index allows at most one unbounded tier per plan.

**Idempotency lives in the database.** `usage_events` has `UNIQUE (customer_id, idempotency_key)`
and ingestion uses `INSERT ... ON CONFLICT DO NOTHING`. A "check if it exists, then insert" in
Python has a race window: two simultaneous retries both see "not found" and both insert. The
constraint closes that window, and `test_concurrent_requests_with_same_key_create_exactly_one_event`
fires 20 simultaneous identical requests to prove it.

**Retry vs. conflict.** Same key and same payload returns the original event (200,
`duplicate: true`). Same key with a different payload returns 409, because silently accepting it
would hide a client bug that changes what a customer is billed.

**No floats for money or quantities.** `Decimal` in Python, `NUMERIC(20, 6)` in Postgres. Extra
decimal places are rejected with a 422 instead of being silently rounded.

**Timezone-aware timestamps only.** A naive timestamp is ambiguous once billing periods exist.

**Structured errors.** Every error has the shape `{"error": {"code", "message", "field", "details"}}`,
so a UI can show what to fix instead of a generic failure.

## Known limits

- The schema is applied at startup with `CREATE TABLE IF NOT EXISTS`. A real deployment would use
  migrations (Alembic).
- One metric per customer for now.
- Amounts are rounded to 2 decimal places, which is right for USD/EUR/INR but not for currencies
  with other minor units (e.g. JPY has none).
