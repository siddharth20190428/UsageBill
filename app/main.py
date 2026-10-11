from contextlib import asynccontextmanager
from uuid import UUID

from fastapi import Depends, FastAPI, Response
from psycopg.errors import ForeignKeyViolation
from psycopg_pool import ConnectionPool

from app import config
from app.db import apply_schema, make_pool
from app.deps import get_pool
from app.errors import ApiError, register_error_handlers
from app.plans import router as plans_router
from app.invoices import router as invoices_router
from app.subscriptions import router as subscriptions_router
from app.schemas import CustomerIn, CustomerOut, UsageIn, UsageOut


@asynccontextmanager
async def lifespan(app: FastAPI):
    pool = make_pool(config.DATABASE_URL)
    apply_schema(pool)
    app.state.pool = pool
    yield
    pool.close()


app = FastAPI(title="UsageBill", lifespan=lifespan)
register_error_handlers(app)
app.include_router(plans_router)
app.include_router(subscriptions_router)
app.include_router(invoices_router)


@app.get("/health")
def health(pool: ConnectionPool = Depends(get_pool)):
    with pool.connection() as conn:
        conn.execute("SELECT 1")
    return {"status": "ok"}


# --------------------------------------------------------------------------
# Customers
# --------------------------------------------------------------------------
@app.post("/customers", response_model=CustomerOut, status_code=201)
def create_customer(body: CustomerIn, pool: ConnectionPool = Depends(get_pool)):
    with pool.connection() as conn:
        row = conn.execute(
            "INSERT INTO customers (name) VALUES (%s) RETURNING id, name, created_at",
            (body.name.strip(),),
        ).fetchone()
    return row


@app.get("/customers/{customer_id}", response_model=CustomerOut)
def get_customer(customer_id: UUID, pool: ConnectionPool = Depends(get_pool)):
    with pool.connection() as conn:
        row = conn.execute(
            "SELECT id, name, created_at FROM customers WHERE id = %s", (customer_id,)
        ).fetchone()
    if row is None:
        raise ApiError(404, "customer_not_found", f"No customer with id {customer_id}", "customer_id")
    return row


# --------------------------------------------------------------------------
# Usage ingestion (idempotent)
# --------------------------------------------------------------------------
INSERT_USAGE = """
    INSERT INTO usage_events (customer_id, quantity, occurred_at, idempotency_key)
    VALUES (%s, %s, %s, %s)
    ON CONFLICT (customer_id, idempotency_key) DO NOTHING
    RETURNING id, customer_id, quantity, occurred_at, idempotency_key
"""

SELECT_USAGE = """
    SELECT id, customer_id, quantity, occurred_at, idempotency_key
    FROM usage_events
    WHERE customer_id = %s AND idempotency_key = %s
"""


@app.post("/usage", response_model=UsageOut)
def ingest_usage(body: UsageIn, response: Response, pool: ConnectionPool = Depends(get_pool)):
    """Record one usage event, exactly once per (customer_id, idempotency_key).

    - First time: 201, the event is stored.
    - Retry with the same key and the same payload: 200, the original event is
      returned with duplicate=true. Nothing new is written.
    - Same key but a different payload: 409. That is a client bug (or a key
      collision), and silently accepting it would hide a billing error.

    Race safety comes from the UNIQUE constraint plus ON CONFLICT DO NOTHING,
    not from a "check, then insert" in Python. Two simultaneous requests with
    the same key cannot both insert: one wins, the other waits for it to commit,
    inserts nothing, and then reads the winner's row.
    """
    with pool.connection() as conn:
        try:
            created = conn.execute(
                INSERT_USAGE,
                (body.customer_id, body.quantity, body.occurred_at, body.idempotency_key),
            ).fetchone()
        except ForeignKeyViolation:
            raise ApiError(
                404, "customer_not_found", f"No customer with id {body.customer_id}", "customer_id"
            )

        if created is not None:
            # Usage for a month that has already been invoiced can no longer be billed, so refuse it
            # rather than accept it and silently never charge for it. (A retry of an event we already
            # recorded takes the duplicate path below and is still fine.) Raising rolls the insert back.
            closed = conn.execute(
                "SELECT 1 FROM invoices WHERE customer_id = %s AND period_start <= %s AND %s < period_end",
                (body.customer_id, body.occurred_at, body.occurred_at),
            ).fetchone()
            if closed is not None:
                raise ApiError(
                    409,
                    "billing_period_closed",
                    "An invoice has already been issued for the month containing occurred_at.",
                    "occurred_at",
                )
            response.status_code = 201
            return {**created, "duplicate": False}

        # Conflict: the key was already used. Read the original and compare.
        existing = conn.execute(SELECT_USAGE, (body.customer_id, body.idempotency_key)).fetchone()

    if existing["quantity"] != body.quantity or existing["occurred_at"] != body.occurred_at:
        raise ApiError(
            409,
            "idempotency_key_reuse",
            "This idempotency_key was already used with a different quantity or occurred_at.",
            "idempotency_key",
        )
    return {**existing, "duplicate": True}
