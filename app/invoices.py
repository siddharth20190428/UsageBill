from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, Response
from psycopg_pool import ConnectionPool

from app.billing import MixedCurrencyError, Segment, build_invoice, month_bounds
from app.db import lock_customer
from app.deps import get_pool
from app.errors import ApiError
from app.invoice_schemas import InvoiceIn, InvoiceOut
from app.pricing import Tier

router = APIRouter(tags=["invoices"])

UTC = timezone.utc

SUBSCRIPTIONS_IN_PERIOD = """
    SELECT s.starts_at, s.ends_at, p.id AS plan_id, p.name, p.currency, p.base_fee
    FROM subscriptions s
    JOIN plans p ON p.id = s.plan_id
    WHERE s.customer_id = %s
      AND tstzrange(s.starts_at, s.ends_at) && tstzrange(%s, %s)
    ORDER BY s.starts_at
"""

# Usage in the period that no subscription covers. Silently skipping it would be revenue leakage,
# so the invoice refuses to generate until someone fixes the subscriptions.
UNPRICED_USAGE = """
    SELECT count(*) AS events, COALESCE(sum(u.quantity), 0) AS quantity
    FROM usage_events u
    WHERE u.customer_id = %s
      AND u.occurred_at >= %s AND u.occurred_at < %s
      AND NOT EXISTS (
          SELECT 1 FROM subscriptions s
          WHERE s.customer_id = u.customer_id
            AND u.occurred_at >= s.starts_at
            AND (s.ends_at IS NULL OR u.occurred_at < s.ends_at)
      )
"""


def load_invoice(conn, invoice_id: UUID) -> dict | None:
    invoice = conn.execute(
        "SELECT id, customer_id, period_start, period_end, currency, total, created_at "
        "FROM invoices WHERE id = %s",
        (invoice_id,),
    ).fetchone()
    if invoice is None:
        return None
    lines = conn.execute(
        "SELECT position, kind, description, quantity, unit_price, amount "
        "FROM invoice_lines WHERE invoice_id = %s ORDER BY position",
        (invoice_id,),
    ).fetchall()
    return {**invoice, "lines": lines}


@router.post("/invoices", response_model=InvoiceOut, status_code=201)
def create_invoice(body: InvoiceIn, response: Response, pool: ConnectionPool = Depends(get_pool)):
    """Generate the invoice for one customer and calendar month. Safe to call any number of times.

    - First call: 201, the invoice is created.
    - Any later call for the same customer and month: 200 with the same invoice. Nothing is
      recalculated, so an invoice never changes after it has been issued.

    Everything runs in one transaction under a per-customer lock. The lock makes concurrent calls
    line up (the second one finds the first one's invoice), and it also waits for any usage insert
    for this customer that is still in flight, so no usage can slip in after we sum it.
    """
    period_start, period_end = month_bounds(body.period)

    with pool.connection() as conn:
        lock_customer(conn, body.customer_id)

        existing = conn.execute(
            "SELECT id FROM invoices WHERE customer_id = %s AND period_start = %s",
            (body.customer_id, period_start),
        ).fetchone()
        if existing is not None:
            response.status_code = 200
            return load_invoice(conn, existing["id"])

        if period_end > datetime.now(UTC):
            raise ApiError(
                409,
                "period_not_ended",
                f"Billing period {body.period} has not ended yet; invoices are issued in arrears.",
                "period",
            )

        unpriced = conn.execute(UNPRICED_USAGE, (body.customer_id, period_start, period_end)).fetchone()
        if unpriced["events"] > 0:
            raise ApiError(
                409,
                "usage_without_subscription",
                f"{unpriced['events']} usage event(s) totalling {unpriced['quantity']} fall outside every "
                f"subscription in {body.period}. Fix the subscriptions before invoicing.",
                "period",
            )

        subs = conn.execute(SUBSCRIPTIONS_IN_PERIOD, (body.customer_id, period_start, period_end)).fetchall()
        if not subs:
            raise ApiError(
                409,
                "no_active_subscription",
                f"The customer has no subscription during {body.period}, so there is nothing to invoice.",
                "period",
            )

        tier_rows = conn.execute(
            "SELECT plan_id, position, up_to, unit_price FROM plan_tiers "
            "WHERE plan_id = ANY(%s) ORDER BY plan_id, position",
            ([s["plan_id"] for s in subs],),
        ).fetchall()
        tiers_by_plan: dict = {}
        for row in tier_rows:
            tiers_by_plan.setdefault(row["plan_id"], []).append(Tier(row["up_to"], row["unit_price"]))

        segments = []
        for sub in subs:
            # Clip the subscription to the billing period. [start, end) so adjacent segments never share an instant.
            start = max(sub["starts_at"].astimezone(UTC), period_start)
            end = min(sub["ends_at"].astimezone(UTC), period_end) if sub["ends_at"] else period_end
            usage = conn.execute(
                "SELECT COALESCE(SUM(quantity), 0) AS quantity FROM usage_events "
                "WHERE customer_id = %s AND occurred_at >= %s AND occurred_at < %s",
                (body.customer_id, start, end),
            ).fetchone()["quantity"]
            segments.append(
                Segment(
                    plan_name=sub["name"],
                    currency=sub["currency"],
                    base_fee=sub["base_fee"],
                    tiers=tuple(tiers_by_plan[sub["plan_id"]]),
                    start=start,
                    end=end,
                    usage=usage,
                )
            )

        try:
            draft = build_invoice(period_start, period_end, segments)
        except MixedCurrencyError as exc:
            raise ApiError(409, "mixed_currencies", str(exc), "period")

        invoice = conn.execute(
            "INSERT INTO invoices (customer_id, period_start, period_end, currency, total) "
            "VALUES (%s, %s, %s, %s, %s) RETURNING id",
            (body.customer_id, period_start, period_end, draft.currency, draft.total),
        ).fetchone()
        with conn.cursor() as cur:
            cur.executemany(
                "INSERT INTO invoice_lines (invoice_id, position, kind, description, quantity, unit_price, amount) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s)",
                [
                    (invoice["id"], i, line.kind, line.description, line.quantity, line.unit_price, line.amount)
                    for i, line in enumerate(draft.lines, start=1)
                ],
            )
        return load_invoice(conn, invoice["id"])


@router.get("/invoices/{invoice_id}", response_model=InvoiceOut)
def get_invoice(invoice_id: UUID, pool: ConnectionPool = Depends(get_pool)):
    with pool.connection() as conn:
        invoice = load_invoice(conn, invoice_id)
    if invoice is None:
        raise ApiError(404, "invoice_not_found", f"No invoice with id {invoice_id}", "invoice_id")
    return invoice
