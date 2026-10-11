from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import app


def usage_payload(customer_id, key="evt-1", quantity="10.5", occurred_at="2026-10-01T12:00:00Z"):
    return {
        "customer_id": customer_id,
        "quantity": quantity,
        "occurred_at": occurred_at,
        "idempotency_key": key,
    }


def count_events():
    with app.state.pool.connection() as conn:
        return conn.execute("SELECT count(*) AS n FROM usage_events").fetchone()["n"]


# ---------------------------------------------------------------- happy path
def test_first_event_is_created(client, customer):
    resp = client.post("/usage", json=usage_payload(customer["id"]))
    assert resp.status_code == 201
    body = resp.json()
    assert body["duplicate"] is False
    assert Decimal(body["quantity"]) == Decimal("10.5")
    assert count_events() == 1


# ---------------------------------------------------------------- idempotency
def test_retry_with_same_key_and_payload_returns_original(client, customer):
    first = client.post("/usage", json=usage_payload(customer["id"]))
    second = client.post("/usage", json=usage_payload(customer["id"]))

    assert first.status_code == 201
    assert second.status_code == 200
    assert second.json()["duplicate"] is True
    assert second.json()["id"] == first.json()["id"]
    assert count_events() == 1


def test_same_value_in_a_different_representation_is_still_a_duplicate(client, customer):
    """10.5 and 10.500000 are the same quantity; a retry must not be treated as a conflict."""
    client.post("/usage", json=usage_payload(customer["id"], quantity="10.5"))
    retry = client.post("/usage", json=usage_payload(customer["id"], quantity="10.500000"))
    assert retry.status_code == 200
    assert count_events() == 1


def test_same_instant_in_a_different_timezone_is_still_a_duplicate(client, customer):
    client.post("/usage", json=usage_payload(customer["id"], occurred_at="2026-10-01T12:00:00Z"))
    retry = client.post(
        "/usage", json=usage_payload(customer["id"], occurred_at="2026-10-01T17:30:00+05:30")
    )
    assert retry.status_code == 200
    assert count_events() == 1


def test_same_key_with_different_quantity_is_a_conflict(client, customer):
    client.post("/usage", json=usage_payload(customer["id"], quantity="10"))
    resp = client.post("/usage", json=usage_payload(customer["id"], quantity="99"))

    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "idempotency_key_reuse"
    assert count_events() == 1


def test_same_key_for_different_customers_is_allowed(client, customer):
    other = client.post("/customers", json={"name": "Globex"}).json()
    a = client.post("/usage", json=usage_payload(customer["id"], key="shared"))
    b = client.post("/usage", json=usage_payload(other["id"], key="shared"))

    assert a.status_code == 201
    assert b.status_code == 201
    assert count_events() == 2


def test_concurrent_requests_with_same_key_create_exactly_one_event(client, customer):
    """The race the UNIQUE constraint exists for: 20 simultaneous identical requests."""
    payload = usage_payload(customer["id"], key="race")

    def send(_):
        # A client per thread; the app (and its pool) is already running from the session fixture.
        return TestClient(app).post("/usage", json=payload)

    with ThreadPoolExecutor(max_workers=20) as pool:
        responses = list(pool.map(send, range(20)))

    statuses = sorted(r.status_code for r in responses)
    assert statuses == [200] * 19 + [201]
    assert len({r.json()["id"] for r in responses}) == 1
    assert count_events() == 1


# ---------------------------------------------------------------- errors
def test_unknown_customer_is_a_404_with_a_structured_error(client):
    resp = client.post("/usage", json=usage_payload(str(uuid4())))
    assert resp.status_code == 404
    error = resp.json()["error"]
    assert error["code"] == "customer_not_found"
    assert error["field"] == "customer_id"
    assert count_events() == 0


def test_validation_errors_are_field_level(client, customer):
    resp = client.post(
        "/usage",
        json={
            "customer_id": customer["id"],
            "quantity": "-5",
            "occurred_at": "2026-10-01T12:00:00",  # no timezone
            "idempotency_key": "",
        },
    )
    assert resp.status_code == 422
    error = resp.json()["error"]
    assert error["code"] == "validation_error"
    fields = {d["field"] for d in error["details"]}
    assert fields == {"quantity", "occurred_at", "idempotency_key"}
    assert count_events() == 0


def test_zero_quantity_is_rejected(client, customer):
    resp = client.post("/usage", json=usage_payload(customer["id"], quantity="0"))
    assert resp.status_code == 422
    assert resp.json()["error"]["details"][0]["field"] == "quantity"


def test_too_many_decimal_places_is_rejected_not_silently_rounded(client, customer):
    resp = client.post("/usage", json=usage_payload(customer["id"], quantity="1.1234567"))
    assert resp.status_code == 422
    assert resp.json()["error"]["details"][0]["field"] == "quantity"
    assert count_events() == 0


def test_get_missing_customer_is_a_404(client):
    resp = client.get(f"/customers/{uuid4()}")
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "customer_not_found"
