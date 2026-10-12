"""The read endpoints the frontend relies on."""
from decimal import Decimal as D
from uuid import uuid4

GROWTH = [
    {"up_to": "100", "unit_price": "0.10"},
    {"up_to": "1000", "unit_price": "0.08"},
    {"up_to": None, "unit_price": "0.05"},
]


# ---------------------------------------------------------------- customers
def test_list_customers_is_empty_then_newest_first(client):
    assert client.get("/customers").json() == []

    first = client.post("/customers", json={"name": "Acme"}).json()
    second = client.post("/customers", json={"name": "Globex"}).json()

    listed = client.get("/customers").json()
    assert [c["id"] for c in listed] == [second["id"], first["id"]]


def test_list_customers_limit_is_validated(client):
    assert client.get("/customers?limit=0").status_code == 422
    assert client.get("/customers?limit=501").status_code == 422


# ---------------------------------------------------------------- plans
def test_list_plans_includes_ordered_tiers_newest_first(client, make_plan):
    assert client.get("/plans").json() == []

    older = make_plan(name="Older", base_fee="5.00")
    newer = make_plan(name="Growth", base_fee="20.00", tiers=GROWTH)

    listed = client.get("/plans").json()
    assert [p["id"] for p in listed] == [newer["id"], older["id"]]
    assert [t["position"] for t in listed[0]["tiers"]] == [1, 2, 3]
    assert listed[0]["tiers"][-1]["up_to"] is None
    assert len(listed[1]["tiers"]) == 1


# ---------------------------------------------------------------- usage
def test_list_usage_is_most_recent_first_and_respects_limit(client, customer, add_usage):
    add_usage(customer, 1, "2025-09-01T00:00:00Z")
    add_usage(customer, 2, "2025-09-03T00:00:00Z")
    add_usage(customer, 3, "2025-09-02T00:00:00Z")

    listed = client.get(f"/customers/{customer['id']}/usage").json()
    assert [D(e["quantity"]) for e in listed] == [D("2"), D("3"), D("1")]
    assert "duplicate" not in listed[0]

    limited = client.get(f"/customers/{customer['id']}/usage?limit=2").json()
    assert len(limited) == 2


def test_list_usage_only_shows_that_customers_events(client, customer, add_usage):
    other = client.post("/customers", json={"name": "Globex"}).json()
    add_usage(customer, 1, "2025-09-01T00:00:00Z")
    add_usage(other, 9, "2025-09-01T00:00:00Z")
    listed = client.get(f"/customers/{customer['id']}/usage").json()
    assert [D(e["quantity"]) for e in listed] == [D("1")]


def test_list_usage_for_unknown_customer_is_404(client):
    resp = client.get(f"/customers/{uuid4()}/usage")
    assert (resp.status_code, resp.json()["error"]["code"]) == (404, "customer_not_found")


# ---------------------------------------------------------------- invoices
def test_list_customer_invoices_newest_month_first_with_lines(client, customer, make_plan, subscribe, add_usage):
    assert client.get(f"/customers/{customer['id']}/invoices").json() == []

    subscribe(customer, make_plan(base_fee="20.00", tiers=GROWTH), "2025-07-01T00:00:00Z")
    add_usage(customer, 150, "2025-08-10T00:00:00Z")
    add_usage(customer, 150, "2025-09-10T00:00:00Z")
    aug = client.post("/invoices", json={"customer_id": customer["id"], "period": "2025-08"}).json()
    sep = client.post("/invoices", json={"customer_id": customer["id"], "period": "2025-09"}).json()

    listed = client.get(f"/customers/{customer['id']}/invoices").json()

    assert [i["id"] for i in listed] == [sep["id"], aug["id"]]
    assert listed[0] == sep and listed[1] == aug  # identical to what generation returned, lines included
    assert [l["position"] for l in listed[0]["lines"]] == list(range(1, len(listed[0]["lines"]) + 1))


def test_list_invoices_only_shows_that_customers(client, customer, make_plan, subscribe):
    other = client.post("/customers", json={"name": "Globex"}).json()
    subscribe(other, make_plan(base_fee="1.00"), "2025-07-01T00:00:00Z")
    client.post("/invoices", json={"customer_id": other["id"], "period": "2025-08"})
    assert client.get(f"/customers/{customer['id']}/invoices").json() == []


def test_list_invoices_for_unknown_customer_is_404(client):
    resp = client.get(f"/customers/{uuid4()}/invoices")
    assert (resp.status_code, resp.json()["error"]["code"]) == (404, "customer_not_found")
