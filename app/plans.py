from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends
from psycopg.errors import UniqueViolation
from psycopg_pool import ConnectionPool

from app.deps import get_pool
from app.errors import ApiError
from app.plan_schemas import PlanIn, PlanOut, QuoteIn, QuoteOut
from app.pricing import Tier, price_tiers, total_amount

QUANTITY_STEP = Decimal("0.000001")

router = APIRouter(prefix="/plans", tags=["plans"])


def load_plan(conn, plan_id: UUID) -> dict | None:
    plan = conn.execute(
        "SELECT id, name, currency, base_fee, created_at FROM plans WHERE id = %s", (plan_id,)
    ).fetchone()
    if plan is None:
        return None
    tiers = conn.execute(
        "SELECT position, up_to, unit_price FROM plan_tiers WHERE plan_id = %s ORDER BY position",
        (plan_id,),
    ).fetchall()
    return {**plan, "tiers": tiers}


def plan_or_404(conn, plan_id: UUID) -> dict:
    plan = load_plan(conn, plan_id)
    if plan is None:
        raise ApiError(404, "plan_not_found", f"No plan with id {plan_id}", "plan_id")
    return plan


@router.post("", response_model=PlanOut, status_code=201)
def create_plan(body: PlanIn, pool: ConnectionPool = Depends(get_pool)):
    """Create a plan and its tiers in one transaction: either all of it exists or none of it."""
    with pool.connection() as conn:
        try:
            plan = conn.execute(
                "INSERT INTO plans (name, currency, base_fee) VALUES (%s, %s, %s) RETURNING id",
                (body.name, body.currency, body.base_fee),
            ).fetchone()
        except UniqueViolation:
            raise ApiError(409, "plan_name_taken", f"A plan named '{body.name}' already exists", "name")

        with conn.cursor() as cur:
            cur.executemany(
                "INSERT INTO plan_tiers (plan_id, position, up_to, unit_price) VALUES (%s, %s, %s, %s)",
                [(plan["id"], i, t.up_to, t.unit_price) for i, t in enumerate(body.tiers, start=1)],
            )
        # Re-read so the response shows exactly what was stored (e.g. 0.1 -> 0.100000).
        return load_plan(conn, plan["id"])


@router.get("/{plan_id}", response_model=PlanOut)
def get_plan(plan_id: UUID, pool: ConnectionPool = Depends(get_pool)):
    with pool.connection() as conn:
        return plan_or_404(conn, plan_id)


@router.post("/{plan_id}/quote", response_model=QuoteOut)
def quote(plan_id: UUID, body: QuoteIn, pool: ConnectionPool = Depends(get_pool)):
    """Price a quantity against a plan without recording anything."""
    with pool.connection() as conn:
        plan = plan_or_404(conn, plan_id)

    tiers = [Tier(t["up_to"], t["unit_price"]) for t in plan["tiers"]]
    lines = price_tiers(tiers, body.quantity)
    return {
        "plan_id": plan["id"],
        "currency": plan["currency"],
        "quantity": body.quantity.quantize(QUANTITY_STEP),
        "base_fee": plan["base_fee"],
        "lines": lines,
        "total": plan["base_fee"] + total_amount(lines),
    }
