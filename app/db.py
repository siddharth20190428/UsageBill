from pathlib import Path

from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

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
