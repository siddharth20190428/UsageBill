import time
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal as D
from uuid import uuid4

import psycopg
import pytest
from fastapi.testclient import TestClient

from app import config
from app.main import app

GROWTH_TIERS = [
    {"up_to": "100", "unit_price": "0.10"},
    {"up_to": "1000", "unit_price": "0.08"},
    {"up_to": None, "unit_price": "0.05"},
]


def count(table):
    with app.state.pool.connection() as conn:
        return conn.execute(f"SELECT count(*) AS n FROM {table}").fetchone()["n"]


def generate(client, customer, period="2025-09"):
    return client.post("/invoices", json={"customer_id": customer["id"], "period": period})


def invoice_of(client, customer, period="2025-09"):
    resp = generate(client, customer, period)
    assert resp.status_code == 201, resp.text
    inv = resp.json()
    assert_adds_up(inv)
    return inv


def assert_adds_up(invoice):
    """An invoice's lines must sum to its total exactly, and positions must be 1..n."""
    assert D(invoice["total"]) == sum((D(l["amount"]) for l in invoice["lines"]), D("0.00"))
    assert [l["position"] for l in invoice["lines"]] == list(range(1, len(invoice["lines"]) + 1))


def amounts(invoice):
    return [D(l["amount"]) for l in invoice["lines"]]


# ---------------------------------------------------------------- the basic invoice
def test_full_month_invoice_has_base_fee_and_tiered_usage(client, customer, make_plan, subscribe, add_usage):
    growth = make_plan(name="Growth", base_fee="20.00", tiers=GROWTH_TIERS)
    subscribe(customer, growth, "2025-08-01T00:00:00Z")
    add_usage(customer, 400, "2025-09-03T10:00:00Z")
    add_usage(customer, 850, "2025-09-20T10:00:00Z")  # 1,250 in total for September
    add_usage(customer, 999, "2025-08-31T23:59:59Z")  # August: must not leak into September
    add_usage(customer, 999, "2025-10-01T00:00:00Z")  # October: must not leak either

    inv = invoice_of(client, customer)

    assert [l["kind"] for l in inv["lines"]] == ["base_fee", "usage", "usage", "usage"]
    assert amounts(inv) == [D("20.00"), D("10.00"), D("72.00"), D("12.50")]
    assert D(inv["total"]) == D("114.50")
    assert inv["currency"] == "USD"
    assert inv["period_start"].startswith("2025-09-01T00:00:00")
    assert inv["period_end"].startswith("2025-10-01T00:00:00")


def test_get_invoice_returns_what_was_generated(client, customer, make_plan, subscribe, add_usage):
    subscribe(customer, make_plan(base_fee="5.00"), "2025-08-01T00:00:00Z")
    add_usage(customer, 10, "2025-09-05T00:00:00Z")
    created = invoice_of(client, customer)
    fetched = client.get(f"/invoices/{created['id']}")
    assert fetched.status_code == 200
    assert fetched.json() == created


def test_a_free_plan_with_no_usage_gives_a_zero_invoice(client, customer, make_plan, subscribe):
    subscribe(customer, make_plan(base_fee="0.00"), "2025-08-01T00:00:00Z")
    inv = invoice_of(client, customer)
    assert inv["lines"] == []
    assert D(inv["total"]) == D("0.00")


def test_each_month_is_invoiced_independently_and_tiers_restart_monthly(client, customer, make_plan, subscribe, add_usage):
    subscribe(customer, make_plan(tiers=GROWTH_TIERS), "2025-08-01T00:00:00Z")
    add_usage(customer, 150, "2025-09-10T00:00:00Z")
    add_usage(customer, 150, "2025-10-10T00:00:00Z")

    sept = invoice_of(client, customer, "2025-09")
    octo = invoice_of(client, customer, "2025-10")

    assert D(sept["total"]) == D("14.00") == D(octo["total"])  # 100*0.10 + 50*0.08, each month
    assert sept["id"] != octo["id"]


# ---------------------------------------------------------------- idempotency
def test_generating_twice_returns_the_same_invoice_and_creates_one_row(client, customer, make_plan, subscribe, add_usage):
    subscribe(customer, make_plan(base_fee="5.00"), "2025-08-01T00:00:00Z")
    add_usage(customer, 10, "2025-09-05T00:00:00Z")

    first = generate(client, customer)
    second = generate(client, customer)

    assert (first.status_code, second.status_code) == (201, 200)
    assert second.json() == first.json()
    assert count("invoices") == 1
    assert count("invoice_lines") == len(first.json()["lines"])


def test_concurrent_requests_create_exactly_one_invoice(client, customer, make_plan, subscribe, add_usage):
    subscribe(customer, make_plan(base_fee="5.00"), "2025-08-01T00:00:00Z")
    add_usage(customer, 10, "2025-09-05T00:00:00Z")

    def send(_):
        return TestClient(app).post("/invoices", json={"customer_id": customer["id"], "period": "2025-09"})

    with ThreadPoolExecutor(max_workers=8) as pool:
        responses = list(pool.map(send, range(8)))

    assert sorted(r.status_code for r in responses) == [200] * 7 + [201]
    assert len({r.json()["id"] for r in responses}) == 1
    assert count("invoices") == 1


def test_an_issued_invoice_does_not_change_when_things_change_afterwards(client, customer, make_plan, subscribe, add_usage):
    a, b = make_plan(base_fee="10.00"), make_plan(base_fee="99.00")
    subscribe(customer, a, "2025-08-01T00:00:00Z")
    add_usage(customer, 10, "2025-09-05T00:00:00Z")
    before = invoice_of(client, customer)

    subscribe(customer, b, "2025-10-01T00:00:00Z")  # a later plan change is fine...
    again = generate(client, customer)

    assert again.status_code == 200
    assert again.json() == before  # ...and September's invoice is untouched


# ---------------------------------------------------------------- proration
def test_a_subscription_that_starts_mid_month_prorates_the_base_fee(client, customer, make_plan, subscribe, add_usage):
    subscribe(customer, make_plan(base_fee="20.00"), "2025-09-16T00:00:00Z")  # 15 of 30 days
    add_usage(customer, 100, "2025-09-20T00:00:00Z")

    inv = invoice_of(client, customer)

    assert amounts(inv) == [D("10.00"), D("10.00")]  # prorated base fee, then 100 * 0.10
    assert "prorated, 2025-09-16 to 2025-09-30" in inv["lines"][0]["description"]


def test_a_subscription_that_ends_mid_month_prorates_the_base_fee(client, customer, make_plan, subscribe, add_usage):
    sub = subscribe(customer, make_plan(base_fee="30.00"), "2025-08-01T00:00:00Z")
    add_usage(customer, 100, "2025-09-05T00:00:00Z")
    ended = client.post(f"/subscriptions/{sub['id']}/end", json={"ends_at": "2025-09-11T00:00:00Z"})
    assert ended.status_code == 200

    inv = invoice_of(client, customer)

    assert amounts(inv) == [D("10.00"), D("10.00")]  # 30.00 * 10/30, then 100 * 0.10


# ---------------------------------------------------------------- plan change mid-month
def test_a_plan_change_mid_month_prices_each_part_on_its_own_plan(client, customer, make_plan, subscribe, add_usage):
    a = make_plan(name="Starter", base_fee="30.00", tiers=[{"up_to": None, "unit_price": "0.10"}])
    b = make_plan(name="Pro", base_fee="60.00", tiers=[{"up_to": None, "unit_price": "0.20"}])
    subscribe(customer, a, "2025-08-01T00:00:00Z")
    subscribe(customer, b, "2025-09-16T00:00:00Z")
    add_usage(customer, 100, "2025-09-10T00:00:00Z")  # Starter period
    add_usage(customer, 100, "2025-09-20T00:00:00Z")  # Pro period

    inv = invoice_of(client, customer)

    assert [l["description"].split(" (")[0] for l in inv["lines"]] == [
        "Base fee: Starter",
        "Usage: Starter, tier 1",
        "Base fee: Pro",
        "Usage: Pro, tier 1",
    ]
    assert amounts(inv) == [D("15.00"), D("10.00"), D("30.00"), D("20.00")]
    assert D(inv["total"]) == D("75.00")


def test_usage_exactly_at_the_change_instant_belongs_to_the_new_plan(client, customer, make_plan, subscribe, add_usage):
    a = make_plan(name="Starter", tiers=[{"up_to": None, "unit_price": "0.10"}])
    b = make_plan(name="Pro", tiers=[{"up_to": None, "unit_price": "0.20"}])
    subscribe(customer, a, "2025-08-01T00:00:00Z")
    subscribe(customer, b, "2025-09-16T00:00:00Z")
    add_usage(customer, 100, "2025-09-16T00:00:00Z")  # exactly the instant of the change

    inv = invoice_of(client, customer)

    assert [l["description"] for l in inv["lines"]] == ["Usage: Pro, tier 1"]  # counted once, on Pro
    assert D(inv["total"]) == D("20.00")


def test_mixed_currencies_in_one_month_are_refused(client, customer, make_plan, subscribe):
    subscribe(customer, make_plan(currency="USD"), "2025-08-01T00:00:00Z")
    subscribe(customer, make_plan(currency="EUR"), "2025-09-16T00:00:00Z")
    resp = generate(client, customer)
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "mixed_currencies"
    assert count("invoices") == 0


# ---------------------------------------------------------------- refusing to guess
def test_usage_outside_every_subscription_blocks_the_invoice(client, customer, make_plan, subscribe, add_usage):
    subscribe(customer, make_plan(), "2025-09-16T00:00:00Z")
    add_usage(customer, 7, "2025-09-05T00:00:00Z")  # before the subscription began
    resp = generate(client, customer)

    assert resp.status_code == 409
    error = resp.json()["error"]
    assert error["code"] == "usage_without_subscription"
    assert "1 usage event" in error["message"]
    assert count("invoices") == 0


def test_usage_after_a_subscription_ended_blocks_the_invoice(client, customer, make_plan, subscribe, add_usage):
    sub = subscribe(customer, make_plan(), "2025-08-01T00:00:00Z")
    client.post(f"/subscriptions/{sub['id']}/end", json={"ends_at": "2025-09-11T00:00:00Z"})
    add_usage(customer, 7, "2025-09-20T00:00:00Z")
    assert generate(client, customer).json()["error"]["code"] == "usage_without_subscription"


def test_no_subscription_in_the_month_means_nothing_to_invoice(client, customer, make_plan, subscribe):
    resp = generate(client, customer)  # no subscriptions at all
    assert (resp.status_code, resp.json()["error"]["code"]) == (409, "no_active_subscription")

    sub = subscribe(customer, make_plan(), "2025-06-01T00:00:00Z")
    client.post(f"/subscriptions/{sub['id']}/end", json={"ends_at": "2025-08-01T00:00:00Z"})
    resp = generate(client, customer)  # subscription ended before September
    assert (resp.status_code, resp.json()["error"]["code"]) == (409, "no_active_subscription")


def test_a_month_that_has_not_ended_cannot_be_invoiced(client, customer, make_plan, subscribe):
    subscribe(customer, make_plan(), "2025-08-01T00:00:00Z")
    resp = generate(client, customer, "2099-01")
    assert (resp.status_code, resp.json()["error"]["code"]) == (409, "period_not_ended")


@pytest.mark.parametrize("period", ["2025-13", "2025-00", "2025-9", "September", "2025-09-01", ""])
def test_malformed_periods_are_a_field_level_422(client, customer, period):
    resp = generate(client, customer, period)
    assert resp.status_code == 422
    assert resp.json()["error"]["details"][0]["field"] == "period"


def test_unknown_customer_and_unknown_invoice_are_404s(client):
    resp = client.post("/invoices", json={"customer_id": str(uuid4()), "period": "2025-09"})
    assert (resp.status_code, resp.json()["error"]["code"]) == (404, "customer_not_found")
    resp = client.get(f"/invoices/{uuid4()}")
    assert (resp.status_code, resp.json()["error"]["code"]) == (404, "invoice_not_found")


# ---------------------------------------------------------------- closed periods
def test_usage_for_an_invoiced_month_is_rejected_but_retries_and_later_months_are_fine(client, customer, make_plan, subscribe, add_usage):
    subscribe(customer, make_plan(), "2025-08-01T00:00:00Z")
    add_usage(customer, 10, "2025-09-05T00:00:00Z", key="recorded-before")
    invoice_of(client, customer)
    events_before = count("usage_events")

    # New usage for the invoiced month would never be billed, so it is refused (and not stored).
    late = client.post(
        "/usage",
        json={"customer_id": customer["id"], "quantity": "5", "occurred_at": "2025-09-20T00:00:00Z", "idempotency_key": "late"},
    )
    assert late.status_code == 409
    assert late.json()["error"]["code"] == "billing_period_closed"
    assert late.json()["error"]["field"] == "occurred_at"
    assert count("usage_events") == events_before

    # A retry of an event recorded BEFORE the invoice is still idempotent, not an error.
    retry = client.post(
        "/usage",
        json={"customer_id": customer["id"], "quantity": "10", "occurred_at": "2025-09-05T00:00:00Z", "idempotency_key": "recorded-before"},
    )
    assert (retry.status_code, retry.json()["duplicate"]) == (200, True)

    # The next month is still open.
    nxt = client.post(
        "/usage",
        json={"customer_id": customer["id"], "quantity": "5", "occurred_at": "2025-10-02T00:00:00Z", "idempotency_key": "october"},
    )
    assert nxt.status_code == 201


def test_history_inside_an_invoiced_month_cannot_be_rewritten_by_subscription_changes(client, customer, make_plan, subscribe):
    a, b = make_plan(), make_plan()
    sub = subscribe(customer, a, "2025-08-01T00:00:00Z")
    invoice_of(client, customer)  # September is now closed

    change = client.post(f"/customers/{customer['id']}/subscriptions", json={"plan_id": b["id"], "starts_at": "2025-09-15T00:00:00Z"})
    end = client.post(f"/subscriptions/{sub['id']}/end", json={"ends_at": "2025-09-20T00:00:00Z"})
    assert (change.status_code, change.json()["error"]["code"]) == (409, "billing_period_closed")
    assert (end.status_code, end.json()["error"]["code"]) == (409, "billing_period_closed")

    # Nothing was modified by the refused attempts.
    subs = client.get(f"/customers/{customer['id']}/subscriptions").json()
    assert len(subs) == 1 and subs[0]["ends_at"] is None

    # A change that takes effect exactly when the invoiced month ends is allowed.
    ok = client.post(f"/customers/{customer['id']}/subscriptions", json={"plan_id": b["id"], "starts_at": "2025-10-01T00:00:00Z"})
    assert ok.status_code == 201


# ---------------------------------------------------------------- concurrency with usage
def test_invoice_waits_for_an_in_flight_usage_insert_instead_of_missing_it(client, customer, make_plan, subscribe):
    """A usage insert that has not committed yet must be included in a concurrent invoice.

    Without the per-customer lock, the invoice would sum usage, miss the uncommitted row, and the
    event would then commit into an already-invoiced month and never be billed.
    """
    subscribe(customer, make_plan(tiers=[{"up_to": None, "unit_price": "1.00"}]), "2025-08-01T00:00:00Z")

    other = psycopg.connect(config.DATABASE_URL)
    try:
        other.execute(
            "INSERT INTO usage_events (customer_id, quantity, occurred_at, idempotency_key) "
            "VALUES (%s, 5, '2025-09-10T00:00:00Z', 'in-flight')",
            (customer["id"],),
        )  # not committed yet

        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(
                lambda: TestClient(app).post("/invoices", json={"customer_id": customer["id"], "period": "2025-09"})
            )
            time.sleep(0.7)
            assert not future.done(), "the invoice should be waiting for the in-flight usage insert"
            other.commit()
            resp = future.result(timeout=10)
    finally:
        other.rollback()
        other.close()

    assert resp.status_code == 201
    assert D(resp.json()["total"]) == D("5.00")  # the in-flight event was included


def test_invoice_lines_in_the_database_always_sum_to_the_total(client, customer, make_plan, subscribe, add_usage):
    subscribe(customer, make_plan(base_fee="12.34", tiers=GROWTH_TIERS), "2025-09-07T00:00:00Z")
    add_usage(customer, "333.333333", "2025-09-20T00:00:00Z")
    invoice_of(client, customer)
    with app.state.pool.connection() as conn:
        row = conn.execute(
            "SELECT i.total, COALESCE(sum(l.amount), 0) AS lines FROM invoices i "
            "LEFT JOIN invoice_lines l ON l.invoice_id = i.id GROUP BY i.id"
        ).fetchone()
    assert row["total"] == row["lines"]
