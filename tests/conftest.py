import os

# Point the app at the test database BEFORE importing it.
os.environ["DATABASE_URL"] = os.environ.get(
    "TEST_DATABASE_URL",
    "postgresql://usagebill:usagebill@localhost:5432/usagebill_test",
)

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture(scope="session")
def client():
    # Entering the context runs the app lifespan: opens the pool and applies the schema.
    with TestClient(app) as c:
        yield c


@pytest.fixture(autouse=True)
def clean_db(client):
    """Every test starts from empty tables."""
    with app.state.pool.connection() as conn:
        conn.execute("TRUNCATE usage_events, customers CASCADE")
    yield


@pytest.fixture
def customer(client):
    resp = client.post("/customers", json={"name": "Acme Corp"})
    assert resp.status_code == 201
    return resp.json()
