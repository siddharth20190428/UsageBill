# Subscriptions, proration and invoices

Billing periods are **calendar months in UTC**: `2025-09` means `[2025-09-01 00:00Z, 2025-10-01 00:00Z)`.

## Try it

```bash
# A customer, a plan ($20/month base fee, graduated usage tiers), and a subscription
CUSTOMER=$(curl -s -X POST localhost:8000/customers -H 'content-type: application/json' \
  -d '{"name": "Acme Corp"}' | python -c "import sys,json;print(json.load(sys.stdin)['id'])")

PLAN=$(curl -s -X POST localhost:8000/plans -H 'content-type: application/json' -d '{
  "name": "Growth", "base_fee": "20.00",
  "tiers": [{"up_to": "100", "unit_price": "0.10"}, {"up_to": "1000", "unit_price": "0.08"}, {"up_to": null, "unit_price": "0.05"}]
}' | python -c "import sys,json;print(json.load(sys.stdin)['id'])")

curl -s -X POST localhost:8000/customers/$CUSTOMER/subscriptions -H 'content-type: application/json' \
  -d "{\"plan_id\": \"$PLAN\", \"starts_at\": \"2025-08-01T00:00:00Z\"}"

# Usage during September
curl -s -X POST localhost:8000/usage -H 'content-type: application/json' -d "{
  \"customer_id\": \"$CUSTOMER\", \"quantity\": \"1250\",
  \"occurred_at\": \"2025-09-10T12:00:00Z\", \"idempotency_key\": \"sept-1\"}"

# Invoice September: 201 the first time, 200 with the identical invoice every time after
curl -s -X POST localhost:8000/invoices -H 'content-type: application/json' \
  -d "{\"customer_id\": \"$CUSTOMER\", \"period\": \"2025-09\"}"
```

That invoice has a $20.00 base fee plus usage of 100 x 0.10 + 900 x 0.08 + 250 x 0.05, a total of **$114.50**.

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/customers/{id}/subscriptions` | Start a subscription, or change plan if one is open |
| POST | `/subscriptions/{id}/end` | End a subscription at a given time |
| GET | `/customers/{id}/subscriptions` | A customer's subscription history |
| POST | `/invoices` | Generate the invoice for `{customer_id, period}` (idempotent) |
| GET | `/invoices/{id}` | Fetch an invoice with its lines |

## Rules

**Proration.** The base fee is scaled by the exact fraction of the month a subscription covers, measured
in microseconds and rounded once to the cent (half-up). A subscription that starts on 16 September covers
15 of 30 days, so a $20.00 fee becomes $10.00.

**Plan change mid-month.** The old subscription ends at exactly the instant the new one starts, so no
moment is covered twice or not at all. Each part is priced on its own plan: its base fee is prorated and
its usage uses its own tiers. Tier thresholds count from the start of each part, so a plan change restarts
them (and they also restart each month).

**Boundaries are half-open.** A usage event at exactly the change instant belongs to the new plan, never to both.

**Invoices never guess.**

- Usage that no subscription covers blocks the invoice (`usage_without_subscription`), because skipping it would silently under-bill.
- A month that has not ended cannot be invoiced (`period_not_ended`); invoices are issued in arrears.
- Plans in different currencies in one month are refused (`mixed_currencies`).

**Issued invoices are frozen.**

- Generating again returns the same invoice and recalculates nothing.
- Usage dated inside an invoiced month is rejected (`billing_period_closed`), because it could never be billed. A retry of an event recorded *before* the invoice still succeeds.
- Subscription changes that would rewrite history inside an invoiced month are rejected with the same code.

## Design decisions

**One transaction, one lock per customer.** Generating an invoice, changing a subscription and ending one all
first lock the customer row. Concurrent requests for the same customer line up instead of interleaving, so
two simultaneous invoice requests produce one invoice (the second finds the first). The same lock conflicts
with the key-share lock an in-flight usage insert holds through its foreign key, so an invoice waits for any
half-committed usage event instead of summing without it. `test_invoice_waits_for_an_in_flight_usage_insert_instead_of_missing_it`
holds an uncommitted insert open and proves the invoice waits.

**The database enforces the invariants too.** `UNIQUE (customer_id, period_start)` on invoices makes
generation idempotent even if the application check were bypassed. An `EXCLUDE USING gist` constraint on
subscriptions makes overlapping subscriptions for one customer impossible. The application checks come first
and give clear errors; the constraints are the backstop for bugs and direct writes.

**The math is pure.** `app/billing.py` takes plain values and returns lines and a total, with no database or
clock. The database layer only gathers inputs, which is why proration and plan-change edge cases are
unit-tested directly.

**Invoice lines always add up.** Each line is rounded once to the cent, and the total is the sum of the
printed lines.

## Known limits

- Proration is by time, not by billable days; a subscription changing three times in a month can differ from the
  full fee by a cent or two of rounding.
- Plans cannot be edited (create a new one), and there are no credit notes or invoice corrections yet.
- Rounding is to 2 decimal places, which is wrong for currencies with other minor units.
- Billing is always calendar months in UTC.
