from uuid import UUID

from fastapi import APIRouter, Depends
from psycopg.errors import ExclusionViolation
from psycopg_pool import ConnectionPool

from app.db import lock_customer, period_closed_after
from app.deps import get_pool
from app.errors import ApiError
from app.subscription_schemas import SubscriptionEndIn, SubscriptionIn, SubscriptionOut

router = APIRouter(tags=["subscriptions"])

COLUMNS = "id, customer_id, plan_id, starts_at, ends_at, created_at"


def closed_error(instant) -> ApiError:
    return ApiError(
        409,
        "billing_period_closed",
        f"An invoice already covers time after {instant.isoformat()}, so history there cannot change.",
    )


@router.post("/customers/{customer_id}/subscriptions", response_model=SubscriptionOut, status_code=201)
def start_subscription(customer_id: UUID, body: SubscriptionIn, pool: ConnectionPool = Depends(get_pool)):
    """Put a customer on a plan from `starts_at`.

    If the customer already has an open subscription, this is a plan change: the open one is ended
    at exactly `starts_at`, so the two are contiguous and no instant is covered twice or not at all.
    Everything happens in one transaction under a per-customer lock, so concurrent changes for the
    same customer line up instead of interleaving.
    """
    with pool.connection() as conn:
        lock_customer(conn, customer_id)

        plan = conn.execute("SELECT id FROM plans WHERE id = %s", (body.plan_id,)).fetchone()
        if plan is None:
            raise ApiError(404, "plan_not_found", f"No plan with id {body.plan_id}", "plan_id")

        if period_closed_after(conn, customer_id, body.starts_at):
            raise closed_error(body.starts_at)

        current = conn.execute(
            f"SELECT {COLUMNS} FROM subscriptions WHERE customer_id = %s AND ends_at IS NULL FOR UPDATE",
            (customer_id,),
        ).fetchone()

        if current is not None:
            if current["plan_id"] == body.plan_id:
                raise ApiError(409, "already_on_plan", "The customer is already on this plan.", "plan_id")
            if body.starts_at <= current["starts_at"]:
                raise ApiError(
                    409,
                    "subscription_overlap",
                    "A plan change must start after the current subscription started "
                    f"({current['starts_at'].isoformat()}).",
                    "starts_at",
                )
            conn.execute("UPDATE subscriptions SET ends_at = %s WHERE id = %s", (body.starts_at, current["id"]))

        try:
            return conn.execute(
                f"""INSERT INTO subscriptions (customer_id, plan_id, starts_at)
                    VALUES (%s, %s, %s) RETURNING {COLUMNS}""",
                (customer_id, body.plan_id, body.starts_at),
            ).fetchone()
        except ExclusionViolation:
            # Backstop: the database refuses any overlap the checks above did not anticipate.
            raise ApiError(
                409,
                "subscription_overlap",
                "That start time overlaps an existing subscription for this customer.",
                "starts_at",
            )


@router.post("/subscriptions/{subscription_id}/end", response_model=SubscriptionOut)
def end_subscription(subscription_id: UUID, body: SubscriptionEndIn, pool: ConnectionPool = Depends(get_pool)):
    with pool.connection() as conn:
        owner = conn.execute(
            "SELECT customer_id FROM subscriptions WHERE id = %s", (subscription_id,)
        ).fetchone()
        if owner is None:
            raise ApiError(404, "subscription_not_found", f"No subscription with id {subscription_id}")

        lock_customer(conn, owner["customer_id"])
        sub = conn.execute(
            f"SELECT {COLUMNS} FROM subscriptions WHERE id = %s FOR UPDATE", (subscription_id,)
        ).fetchone()

        if sub["ends_at"] is not None:
            raise ApiError(409, "subscription_already_ended", "This subscription has already ended.")
        if body.ends_at <= sub["starts_at"]:
            raise ApiError(
                422, "ends_at_before_start", "ends_at must be after the subscription's starts_at.", "ends_at"
            )
        if period_closed_after(conn, sub["customer_id"], body.ends_at):
            raise closed_error(body.ends_at)

        return conn.execute(
            f"UPDATE subscriptions SET ends_at = %s WHERE id = %s RETURNING {COLUMNS}",
            (body.ends_at, subscription_id),
        ).fetchone()


@router.get("/customers/{customer_id}/subscriptions", response_model=list[SubscriptionOut])
def list_subscriptions(customer_id: UUID, pool: ConnectionPool = Depends(get_pool)):
    with pool.connection() as conn:
        customer = conn.execute("SELECT id FROM customers WHERE id = %s", (customer_id,)).fetchone()
        if customer is None:
            raise ApiError(404, "customer_not_found", f"No customer with id {customer_id}", "customer_id")
        return conn.execute(
            f"SELECT {COLUMNS} FROM subscriptions WHERE customer_id = %s ORDER BY starts_at",
            (customer_id,),
        ).fetchall()
