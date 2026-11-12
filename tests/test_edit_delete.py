from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

from fastapi.testclient import TestClient

from app.main import app

THREE_TIERS = [
    {"up_to": "100", "unit_price": "0.10"},
    {"up_to": "1000", "unit_price": "0.08"},
    {"up_to": None, "unit_price": "0.05"},
]


def count(table, where="TRUE", params=()):
    with app.state.pool.connection() as conn:
        return conn.execute(f"SELECT count(*) AS n FROM {table} WHERE {where}", params).fetchone()["n"]


def plan_body(**changes):
    body = {"name": "Edited", "currency": "USD", "base_fee": "9.00", "tiers": [{"up_to": None, "unit_price": "0.02"}]}
    return {**body, **changes}


# ---------------------------------------------------------------- customers: rename
def test_rename_customer(client, customer):
    r = client.patch(f"/customers/{customer['id']}", json={"name": "  New Name  "})
    assert r.status_code == 200
    assert r.json()["name"] == "New Name" and r.json()["id"] == customer["id"]
    assert client.get(f"/customers/{customer['id']}").json()["name"] == "New Name"


def test_rename_rejects_a_blank_name_and_keeps_the_old_one(client, customer):
    r = client.patch(f"/customers/{customer['id']}", json={"name": "   "})
    assert r.status_code == 422
    assert client.get(f"/customers/{customer['id']}").json()["name"] == "Acme Corp"


def test_rename_unknown_customer_is_404(client):
    r = client.patch("/customers/00000000-0000-0000-0000-000000000000", json={"name": "X"})
    assert r.status_code == 404 and r.json()["error"]["code"] == "customer_not_found"


# ---------------------------------------------------------------- customers: delete
def test_delete_customer_removes_their_usage_and_subscriptions(client, customer, make_plan, subscribe, add_usage):
    other = client.post("/customers", json={"name": "Keeper"}).json()
    plan = make_plan()
    subscribe(customer, plan, "2025-09-01T00:00:00Z")
    add_usage(customer, 5, "2025-09-10T00:00:00Z")
    add_usage(other, 7, "2025-09-10T00:00:00Z")

    assert client.delete(f"/customers/{customer['id']}").status_code == 204

    assert client.get(f"/customers/{customer['id']}").status_code == 404
    assert count("usage_events", "customer_id = %s", (customer["id"],)) == 0
    assert count("subscriptions", "customer_id = %s", (customer["id"],)) == 0
    assert count("usage_events", "customer_id = %s", (other["id"],)) == 1  # nobody else is touched
    assert [c["id"] for c in client.get("/customers").json()] == [other["id"]]


def test_a_customer_with_an_invoice_cannot_be_deleted(client, customer, make_plan, subscribe, add_usage):
    subscribe(customer, make_plan(base_fee="5.00"), "2025-08-01T00:00:00Z")
    add_usage(customer, 10, "2025-09-05T00:00:00Z")
    assert client.post("/invoices", json={"customer_id": customer["id"], "period": "2025-09"}).status_code == 201

    r = client.delete(f"/customers/{customer['id']}")

    assert r.status_code == 409 and r.json()["error"]["code"] == "customer_has_invoices"
    assert client.get(f"/customers/{customer['id']}").status_code == 200
    assert count("usage_events") == 1 and count("subscriptions") == 1 and count("invoices") == 1  # nothing half-deleted


def test_delete_unknown_customer_is_404(client):
    r = client.delete("/customers/00000000-0000-0000-0000-000000000000")
    assert r.status_code == 404 and r.json()["error"]["code"] == "customer_not_found"


def test_usage_for_a_deleted_customer_is_refused_not_a_500(client, customer):
    client.delete(f"/customers/{customer['id']}")
    r = client.post(
        "/usage",
        json={"customer_id": customer["id"], "quantity": "1", "occurred_at": "2025-09-01T00:00:00Z", "idempotency_key": "k"},
    )
    assert r.status_code == 404 and r.json()["error"]["code"] == "customer_not_found"


def test_deleting_a_customer_frees_their_plan_for_deletion(client, customer, make_plan, subscribe):
    plan = make_plan()
    subscribe(customer, plan, "2025-09-01T00:00:00Z")
    assert client.delete(f"/plans/{plan['id']}").status_code == 409
    client.delete(f"/customers/{customer['id']}")
    assert client.delete(f"/plans/{plan['id']}").status_code == 204


# ---------------------------------------------------------------- plans: edit
def test_edit_an_unused_plan_replaces_its_pricing_and_tiers(client, make_plan):
    plan = make_plan(name="Original", tiers=THREE_TIERS)
    r = client.put(f"/plans/{plan['id']}", json=plan_body())
    assert r.status_code == 200
    got = r.json()
    assert got["id"] == plan["id"] and got["name"] == "Edited" and got["base_fee"] == "9.00"
    assert [t["unit_price"] for t in got["tiers"]] == ["0.020000"]  # the 3 old tiers are gone, not appended to
    assert client.get(f"/plans/{plan['id']}").json() == got
    assert count("plan_tiers", "plan_id = %s", (plan["id"],)) == 1


def test_edit_with_invalid_tiers_is_rejected_and_the_old_plan_survives(client, make_plan):
    plan = make_plan(name="Original", tiers=THREE_TIERS)
    bad = plan_body(tiers=[{"up_to": "500", "unit_price": "0.1"}, {"up_to": "100", "unit_price": "0.1"}, {"up_to": None, "unit_price": "0.1"}])
    r = client.put(f"/plans/{plan['id']}", json=bad)
    assert r.status_code == 422
    after = client.get(f"/plans/{plan['id']}").json()
    assert after["name"] == "Original" and len(after["tiers"]) == 3


def test_edit_to_a_name_another_plan_has_is_a_conflict_and_changes_nothing(client, make_plan):
    make_plan(name="Taken")
    plan = make_plan(name="Mine", tiers=THREE_TIERS)
    r = client.put(f"/plans/{plan['id']}", json=plan_body(name="Taken"))
    assert r.status_code == 409 and r.json()["error"]["code"] == "plan_name_taken"
    after = client.get(f"/plans/{plan['id']}").json()
    assert after["name"] == "Mine" and len(after["tiers"]) == 3 and after["base_fee"] == "0.00"


def test_saving_a_plan_under_its_own_name_is_not_a_conflict(client, make_plan):
    plan = make_plan(name="Same")
    assert client.put(f"/plans/{plan['id']}", json=plan_body(name="Same")).status_code == 200


def test_pricing_of_a_plan_in_use_cannot_change(client, customer, make_plan, subscribe):
    plan = make_plan(name="Live", base_fee="5.00", tiers=THREE_TIERS)
    subscribe(customer, plan, "2025-09-01T00:00:00Z")

    for change in (
        plan_body(name="Live", base_fee="6.00", tiers=THREE_TIERS),                       # base fee
        plan_body(name="Live", base_fee="5.00", tiers=[{"up_to": None, "unit_price": "0.1"}]),  # tiers
        plan_body(name="Live", base_fee="5.00", currency="EUR", tiers=THREE_TIERS),         # currency
    ):
        r = client.put(f"/plans/{plan['id']}", json=change)
        assert r.status_code == 409 and r.json()["error"]["code"] == "plan_in_use"

    assert client.get(f"/plans/{plan['id']}").json() == plan  # untouched


def test_a_plan_in_use_can_still_be_renamed(client, customer, make_plan, subscribe):
    plan = make_plan(name="Live", base_fee="5.00", tiers=THREE_TIERS)
    subscribe(customer, plan, "2025-09-01T00:00:00Z")
    same_pricing_other_scale = plan_body(
        name="Renamed",
        base_fee="5",
        tiers=[{"up_to": "100.0", "unit_price": "0.1"}, {"up_to": "1000", "unit_price": "0.080"}, {"up_to": None, "unit_price": "0.05"}],
    )
    r = client.put(f"/plans/{plan['id']}", json=same_pricing_other_scale)
    assert r.status_code == 200
    assert r.json()["name"] == "Renamed" and r.json()["tiers"] == plan["tiers"]


def test_edit_unknown_plan_is_404(client):
    r = client.put("/plans/00000000-0000-0000-0000-000000000000", json=plan_body())
    assert r.status_code == 404 and r.json()["error"]["code"] == "plan_not_found"


# ---------------------------------------------------------------- plans: delete
def test_delete_an_unused_plan_and_its_tiers(client, make_plan):
    plan = make_plan(tiers=THREE_TIERS)
    assert client.delete(f"/plans/{plan['id']}").status_code == 204
    assert client.get(f"/plans/{plan['id']}").status_code == 404
    assert count("plan_tiers") == 0


def test_a_plan_in_use_cannot_be_deleted(client, customer, make_plan, subscribe):
    plan = make_plan()
    subscribe(customer, plan, "2025-09-01T00:00:00Z")
    r = client.delete(f"/plans/{plan['id']}")
    assert r.status_code == 409 and r.json()["error"]["code"] == "plan_in_use"
    assert client.get(f"/plans/{plan['id']}").status_code == 200


def test_delete_unknown_plan_is_404(client):
    r = client.delete("/plans/00000000-0000-0000-0000-000000000000")
    assert r.status_code == 404 and r.json()["error"]["code"] == "plan_not_found"


def test_subscribing_to_a_deleted_plan_is_404(client, customer, make_plan):
    plan = make_plan()
    client.delete(f"/plans/{plan['id']}")
    r = client.post(f"/customers/{customer['id']}/subscriptions", json={"plan_id": plan["id"], "starts_at": "2025-09-01T00:00:00Z"})
    assert r.status_code == 404 and r.json()["error"]["code"] == "plan_not_found"


# ---------------------------------------------------------------- races
def test_deleting_a_plan_while_someone_subscribes_never_leaves_a_dangling_subscription(client, make_plan):
    """Whichever request wins, we must end with a consistent state and no 500."""
    for round_ in range(12):
        plan = make_plan(name=f"race-{round_}")
        cust = client.post("/customers", json={"name": f"Racer {round_}"}).json()
        barrier = Barrier(2)

        def subscribe_now():
            barrier.wait()
            return TestClient(app).post(
                f"/customers/{cust['id']}/subscriptions", json={"plan_id": plan["id"], "starts_at": "2025-09-01T00:00:00Z"}
            )

        def delete_now():
            barrier.wait()
            return TestClient(app).delete(f"/plans/{plan['id']}")

        with ThreadPoolExecutor(max_workers=2) as pool:
            sub, dele = pool.submit(subscribe_now), pool.submit(delete_now)
            sub, dele = sub.result(), dele.result()

        assert (sub.status_code, dele.status_code) in {(201, 409), (404, 204)}, (sub.status_code, dele.status_code, sub.text, dele.text)
        plan_exists = count("plans", "id = %s", (plan["id"],)) == 1
        subs = count("subscriptions", "plan_id = %s", (plan["id"],))
        assert plan_exists == (subs == 1)
