import itertools
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
        conn.execute("TRUNCATE usage_events, customers, plans CASCADE")
    yield


@pytest.fixture
def customer(client):
    resp = client.post("/customers", json={"name": "Acme Corp"})
    assert resp.status_code == 201
    return resp.json()


@pytest.fixture
def make_plan(client):
    """Factory: create a plan. Defaults to a flat 0.10/unit plan with no base fee."""
    counter = itertools.count(1)

    def _make(name=None, base_fee="0.00", tiers=None, currency="USD"):
        resp = client.post(
            "/plans",
            json={
                "name": name or f"plan-{next(counter)}",
                "currency": currency,
                "base_fee": base_fee,
                "tiers": tiers or [{"up_to": None, "unit_price": "0.10"}],
            },
        )
        assert resp.status_code == 201, resp.text
        return resp.json()

    return _make


@pytest.fixture
def subscribe(client):
    """Factory: put a customer on a plan from a timestamp (also used for plan changes)."""

    def _subscribe(customer, plan, starts_at):
        resp = client.post(
            f"/customers/{customer['id']}/subscriptions",
            json={"plan_id": plan["id"], "starts_at": starts_at},
        )
        assert resp.status_code == 201, resp.text
        return resp.json()

    return _subscribe


@pytest.fixture
def add_usage(client):
    """Factory: record usage with an auto-generated idempotency key."""
    counter = itertools.count(1)

    def _add(customer, quantity, occurred_at, key=None):
        resp = client.post(
            "/usage",
            json={
                "customer_id": customer["id"],
                "quantity": str(quantity),
                "occurred_at": occurred_at,
                "idempotency_key": key or f"auto-{next(counter)}",
            },
        )
        assert resp.status_code in (200, 201), resp.text
        return resp.json()

    return _add
