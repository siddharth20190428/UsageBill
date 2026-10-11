from fastapi import Request
from psycopg_pool import ConnectionPool


def get_pool(request: Request) -> ConnectionPool:
    return request.app.state.pool
