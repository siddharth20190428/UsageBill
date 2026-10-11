from pathlib import Path

from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from app.errors import ApiError

SCHEMA_PATH = Path(__file__).parent / "schema.sql"


def make_pool(database_url: str) -> ConnectionPool:
    pool = ConnectionPool(
        database_url,
        min_size=1,
        max_size=10,
        kwargs={"row_factory": dict_row},
        open=False,
    )
    pool.open(wait=True, timeout=10)
    return pool


def apply_schema(pool: ConnectionPool) -> None:
    with pool.connection() as conn:
        conn.execute(SCHEMA_PATH.read_text())


def lock_customer(conn, customer_id) -> None:
    """Take a row lock on the customer for the rest of the transaction (or 404).

    Anything that must not interleave for one customer (changing a subscription, generating an
    invoice) takes this first. It also conflicts with the key-share lock that an in-flight usage
    insert holds through its foreign key, so an invoice cannot be built while a usage event for
    that customer is half-committed, and a usage insert has to wait while an invoice is built.
    """
    row = conn.execute("SELECT id FROM customers WHERE id = %s FOR UPDATE", (customer_id,)).fetchone()
    if row is None:
        raise ApiError(404, "customer_not_found", f"No customer with id {customer_id}", "customer_id")


def period_closed_after(conn, customer_id, instant) -> bool:
    """True if an invoice already covers any time after `instant` (so history there is frozen)."""
    row = conn.execute(
        "SELECT 1 FROM invoices WHERE customer_id = %s AND period_end > %s LIMIT 1",
        (customer_id, instant),
    ).fetchone()
    return row is not None
