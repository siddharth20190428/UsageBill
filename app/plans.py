from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends, Response
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


@router.get("", response_model=list[PlanOut])
def list_plans(pool: ConnectionPool = Depends(get_pool)):
    """All plans, newest first, each with its tiers in order."""
    with pool.connection() as conn:
        plans = conn.execute(
            "SELECT id, name, currency, base_fee, created_at FROM plans ORDER BY created_at DESC, name"
        ).fetchall()
        tiers = conn.execute(
            "SELECT plan_id, position, up_to, unit_price FROM plan_tiers ORDER BY plan_id, position"
        ).fetchall()
    by_plan: dict = {}
    for t in tiers:
        by_plan.setdefault(t["plan_id"], []).append(
            {"position": t["position"], "up_to": t["up_to"], "unit_price": t["unit_price"]}
        )
    return [{**p, "tiers": by_plan.get(p["id"], [])} for p in plans]


@router.get("/{plan_id}", response_model=PlanOut)
def get_plan(plan_id: UUID, pool: ConnectionPool = Depends(get_pool)):
    with pool.connection() as conn:
        return plan_or_404(conn, plan_id)


def _lock_plan(conn, plan_id: UUID) -> dict:
    """Lock the plan row (404 if missing). Conflicts with the key-share lock a new subscription takes."""
    row = conn.execute("SELECT id FROM plans WHERE id = %s FOR UPDATE", (plan_id,)).fetchone()
    if row is None:
        raise ApiError(404, "plan_not_found", f"No plan with id {plan_id}", "plan_id")
    return load_plan(conn, plan_id)


def _subscription_count(conn, plan_id: UUID) -> int:
    return conn.execute("SELECT count(*) AS n FROM subscriptions WHERE plan_id = %s", (plan_id,)).fetchone()["n"]


def _pricing_changed(existing: dict, body: PlanIn) -> bool:
    old = (existing["currency"], existing["base_fee"], [(t["up_to"], t["unit_price"]) for t in existing["tiers"]])
    new = (body.currency, body.base_fee, [(t.up_to, t.unit_price) for t in body.tiers])
    return old != new  # Decimal compares by value, so 0.1 == 0.100000


@router.put("/{plan_id}", response_model=PlanOut)
def update_plan(plan_id: UUID, body: PlanIn, pool: ConnectionPool = Depends(get_pool)):
    """Edit a plan.

    Prices are only editable while no customer is subscribed to the plan. Once a plan is in use,
    changing its prices would silently re-price usage that has not been invoiced yet, so only the
    name can change (409 plan_in_use otherwise): create a new plan for new pricing.
    """
    with pool.connection() as conn:
        existing = _lock_plan(conn, plan_id)
        in_use = _subscription_count(conn, plan_id)
        if in_use and _pricing_changed(existing, body):
            raise ApiError(
                409,
                "plan_in_use",
                f"{in_use} subscription{'s use' if in_use != 1 else ' uses'} this plan, so its pricing can't change.",
            )
        try:
            conn.execute(
                "UPDATE plans SET name = %s, currency = %s, base_fee = %s WHERE id = %s",
                (body.name, body.currency, body.base_fee, plan_id),
            )
        except UniqueViolation:
            raise ApiError(409, "plan_name_taken", f"A plan named '{body.name}' already exists", "name")
        if not in_use:
            conn.execute("DELETE FROM plan_tiers WHERE plan_id = %s", (plan_id,))
            with conn.cursor() as cur:
                cur.executemany(
                    "INSERT INTO plan_tiers (plan_id, position, up_to, unit_price) VALUES (%s, %s, %s, %s)",
                    [(plan_id, i, t.up_to, t.unit_price) for i, t in enumerate(body.tiers, start=1)],
                )
        return load_plan(conn, plan_id)


@router.delete("/{plan_id}", status_code=204)
def delete_plan(plan_id: UUID, pool: ConnectionPool = Depends(get_pool)):
    """Delete a plan nobody is subscribed to (409 plan_in_use otherwise)."""
    with pool.connection() as conn:
        _lock_plan(conn, plan_id)
        in_use = _subscription_count(conn, plan_id)
        if in_use:
            raise ApiError(
                409,
                "plan_in_use",
                f"{in_use} subscription{'s use' if in_use != 1 else ' uses'} this plan, so it can't be deleted.",
            )
        conn.execute("DELETE FROM plans WHERE id = %s", (plan_id,))  # tiers cascade
    return Response(status_code=204)


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
