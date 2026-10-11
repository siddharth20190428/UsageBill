from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from uuid import uuid4

import psycopg
import pytest
from fastapi.testclient import TestClient

from app.main import app


def parse(ts):
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))


def list_subs(client, customer):
    resp = client.get(f"/customers/{customer['id']}/subscriptions")
    assert resp.status_code == 200
    return resp.json()


# ---------------------------------------------------------------- start / change
def test_first_subscription_is_open_ended(client, customer, make_plan):
    plan = make_plan()
    resp = client.post(
        f"/customers/{customer['id']}/subscriptions",
        json={"plan_id": plan["id"], "starts_at": "2025-09-01T00:00:00Z"},
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["ends_at"] is None
    assert body["plan_id"] == plan["id"]


def test_a_plan_change_ends_the_old_subscription_exactly_where_the_new_one_starts(client, customer, make_plan, subscribe):
    a, b = make_plan(), make_plan()
    subscribe(customer, a, "2025-08-01T00:00:00Z")
    subscribe(customer, b, "2025-09-16T00:00:00Z")

    subs = list_subs(client, customer)
    assert [s["plan_id"] for s in subs] == [a["id"], b["id"]]
    assert parse(subs[0]["ends_at"]) == parse(subs[1]["starts_at"])  # contiguous, no gap, no overlap
    assert subs[1]["ends_at"] is None


def test_changing_to_the_same_plan_is_refused(client, customer, make_plan, subscribe):
    plan = make_plan()
    subscribe(customer, plan, "2025-08-01T00:00:00Z")
    resp = client.post(
        f"/customers/{customer['id']}/subscriptions",
        json={"plan_id": plan["id"], "starts_at": "2025-09-01T00:00:00Z"},
    )
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "already_on_plan"
    assert len(list_subs(client, customer)) == 1


@pytest.mark.parametrize("starts_at", ["2025-08-01T00:00:00Z", "2025-07-15T00:00:00Z"])
def test_a_change_must_start_after_the_current_subscription_started(client, customer, make_plan, subscribe, starts_at):
    a, b = make_plan(), make_plan()
    subscribe(customer, a, "2025-08-01T00:00:00Z")
    resp = client.post(
        f"/customers/{customer['id']}/subscriptions", json={"plan_id": b["id"], "starts_at": starts_at}
    )
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "subscription_overlap"
    # The failed change must not have closed the existing subscription.
    assert list_subs(client, customer)[0]["ends_at"] is None


def test_unknown_customer_and_plan_are_404s(client, customer, make_plan):
    plan = make_plan()
    r1 = client.post(f"/customers/{uuid4()}/subscriptions", json={"plan_id": plan["id"], "starts_at": "2025-09-01T00:00:00Z"})
    r2 = client.post(f"/customers/{customer['id']}/subscriptions", json={"plan_id": str(uuid4()), "starts_at": "2025-09-01T00:00:00Z"})
    assert (r1.status_code, r1.json()["error"]["code"]) == (404, "customer_not_found")
    assert (r2.status_code, r2.json()["error"]["code"]) == (404, "plan_not_found")


def test_starts_at_without_a_timezone_is_rejected(client, customer, make_plan):
    plan = make_plan()
    resp = client.post(
        f"/customers/{customer['id']}/subscriptions",
        json={"plan_id": plan["id"], "starts_at": "2025-09-01T00:00:00"},
    )
    assert resp.status_code == 422
    assert resp.json()["error"]["details"][0]["field"] == "starts_at"


def test_two_customers_can_be_on_the_same_plan_at_the_same_time(client, customer, make_plan, subscribe):
    plan = make_plan()
    other = client.post("/customers", json={"name": "Globex"}).json()
    subscribe(customer, plan, "2025-09-01T00:00:00Z")
    subscribe(other, plan, "2025-09-01T00:00:00Z")


def test_concurrent_plan_changes_for_one_customer_do_not_both_succeed(client, customer, make_plan, subscribe):
    """Two simultaneous changes at the same instant: exactly one wins, and the history stays clean."""
    base, b, c = make_plan(), make_plan(), make_plan()
    subscribe(customer, base, "2025-08-01T00:00:00Z")

    def change(plan):
        return TestClient(app).post(
            f"/customers/{customer['id']}/subscriptions",
            json={"plan_id": plan["id"], "starts_at": "2025-09-01T00:00:00Z"},
        )

    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(change, [b, c]))

    assert sorted(r.status_code for r in responses) == [201, 409]
    subs = list_subs(client, customer)
    assert len(subs) == 2
    assert sum(1 for s in subs if s["ends_at"] is None) == 1  # exactly one open subscription


# ---------------------------------------------------------------- database backstop
def test_the_database_itself_refuses_overlapping_subscriptions(client, customer, make_plan, subscribe):
    """Bypass the API entirely: the EXCLUDE constraint must still stop an overlap."""
    plan = make_plan()
    subscribe(customer, plan, "2025-09-01T00:00:00Z")  # open-ended
    with app.state.pool.connection() as conn:
        with pytest.raises(psycopg.errors.ExclusionViolation):
            conn.execute(
                "INSERT INTO subscriptions (customer_id, plan_id, starts_at, ends_at) "
                "VALUES (%s, %s, '2025-09-10T00:00:00Z', '2025-09-20T00:00:00Z')",
                (customer["id"], plan["id"]),
            )


def test_back_to_back_subscriptions_are_not_an_overlap(client, customer, make_plan):
    """[a, b) and [b, c) touch but do not overlap; the constraint must allow that."""
    plan = make_plan()
    with app.state.pool.connection() as conn:
        conn.execute(
            "INSERT INTO subscriptions (customer_id, plan_id, starts_at, ends_at) VALUES "
            "(%s, %s, '2025-09-01T00:00:00Z', '2025-09-16T00:00:00Z'), "
            "(%s, %s, '2025-09-16T00:00:00Z', NULL)",
            (customer["id"], plan["id"], customer["id"], plan["id"]),
        )


# ---------------------------------------------------------------- ending
def test_ending_a_subscription_sets_ends_at(client, customer, make_plan, subscribe):
    sub = subscribe(customer, make_plan(), "2025-08-01T00:00:00Z")
    resp = client.post(f"/subscriptions/{sub['id']}/end", json={"ends_at": "2025-09-16T00:00:00Z"})
    assert resp.status_code == 200
    assert parse(resp.json()["ends_at"]) == parse("2025-09-16T00:00:00Z")


def test_ending_twice_is_a_conflict(client, customer, make_plan, subscribe):
    sub = subscribe(customer, make_plan(), "2025-08-01T00:00:00Z")
    client.post(f"/subscriptions/{sub['id']}/end", json={"ends_at": "2025-09-16T00:00:00Z"})
    again = client.post(f"/subscriptions/{sub['id']}/end", json={"ends_at": "2025-09-20T00:00:00Z"})
    assert again.status_code == 409
    assert again.json()["error"]["code"] == "subscription_already_ended"


def test_ending_before_it_started_is_rejected(client, customer, make_plan, subscribe):
    sub = subscribe(customer, make_plan(), "2025-08-01T00:00:00Z")
    resp = client.post(f"/subscriptions/{sub['id']}/end", json={"ends_at": "2025-07-01T00:00:00Z"})
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "ends_at_before_start"


def test_ending_an_unknown_subscription_is_a_404(client):
    resp = client.post(f"/subscriptions/{uuid4()}/end", json={"ends_at": "2025-09-16T00:00:00Z"})
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "subscription_not_found"


def test_listing_subscriptions_for_an_unknown_customer_is_a_404(client):
    assert client.get(f"/customers/{uuid4()}/subscriptions").status_code == 404
