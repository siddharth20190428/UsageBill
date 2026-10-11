from decimal import Decimal as D
from uuid import uuid4

from app.main import app

THREE_TIERS = [
    {"up_to": "100", "unit_price": "0.10"},
    {"up_to": "1000", "unit_price": "0.08"},
    {"up_to": None, "unit_price": "0.05"},
]


def plan_payload(**overrides):
    payload = {"name": "Growth", "currency": "USD", "base_fee": "20.00", "tiers": THREE_TIERS}
    payload.update(overrides)
    return payload


def create_plan(client, **overrides):
    resp = client.post("/plans", json=plan_payload(**overrides))
    assert resp.status_code == 201, resp.text
    return resp.json()


def count(table):
    with app.state.pool.connection() as conn:
        return conn.execute(f"SELECT count(*) AS n FROM {table}").fetchone()["n"]


# ---------------------------------------------------------------- create / get
def test_create_plan_returns_it_with_ordered_tiers(client):
    plan = create_plan(client)

    assert plan["name"] == "Growth"
    assert plan["currency"] == "USD"
    assert D(plan["base_fee"]) == D("20.00")
    assert [t["position"] for t in plan["tiers"]] == [1, 2, 3]
    assert [t["up_to"] for t in plan["tiers"]][-1] is None
    assert D(plan["tiers"][0]["unit_price"]) == D("0.10")


def test_get_plan_round_trips(client):
    created = create_plan(client)
    fetched = client.get(f"/plans/{created['id']}")
    assert fetched.status_code == 200
    assert fetched.json() == created


def test_get_unknown_plan_is_404(client):
    resp = client.get(f"/plans/{uuid4()}")
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "plan_not_found"


def test_duplicate_plan_name_is_409_and_leaves_no_partial_data(client):
    create_plan(client, name="Starter")
    resp = client.post("/plans", json=plan_payload(name="Starter"))

    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "plan_name_taken"
    assert resp.json()["error"]["field"] == "name"
    # The failed attempt must not have written orphan tiers.
    assert count("plans") == 1
    assert count("plan_tiers") == 3


def test_plan_name_is_trimmed_and_whitespace_only_is_rejected(client):
    assert create_plan(client, name="  Padded  ")["name"] == "Padded"
    resp = client.post("/plans", json=plan_payload(name="   "))
    assert resp.status_code == 422
    assert resp.json()["error"]["details"][0]["field"] == "name"


# ---------------------------------------------------------------- invalid tiers
def tiers_error(client, tiers):
    resp = client.post("/plans", json=plan_payload(tiers=tiers))
    assert resp.status_code == 422
    assert count("plans") == 0
    error = resp.json()["error"]
    assert error["code"] == "validation_error"
    return error


def test_tiers_must_not_be_empty(client):
    error = tiers_error(client, [])
    assert error["details"][0]["field"] == "tiers"


def test_last_tier_must_be_unbounded(client):
    error = tiers_error(client, [{"up_to": "100", "unit_price": "0.1"}])
    assert error["details"][0]["field"] == "tiers"
    assert "last tier must be unbounded" in error["details"][0]["message"]


def test_tiers_must_be_ascending(client):
    error = tiers_error(
        client,
        [
            {"up_to": "100", "unit_price": "0.1"},
            {"up_to": "50", "unit_price": "0.1"},
            {"up_to": None, "unit_price": "0.1"},
        ],
    )
    assert "greater than" in error["details"][0]["message"]


def test_only_the_last_tier_can_be_unbounded(client):
    error = tiers_error(
        client, [{"up_to": None, "unit_price": "0.1"}, {"up_to": None, "unit_price": "0.2"}]
    )
    assert "only the last tier can be unbounded" in error["details"][0]["message"]


def test_negative_unit_price_is_rejected(client):
    error = tiers_error(client, [{"up_to": None, "unit_price": "-0.1"}])
    assert error["details"][0]["field"] == "tiers.0.unit_price"


def test_unit_price_with_too_many_decimals_is_rejected_not_rounded(client):
    error = tiers_error(client, [{"up_to": None, "unit_price": "0.1234567"}])
    assert error["details"][0]["field"] == "tiers.0.unit_price"


def test_negative_base_fee_and_bad_currency_are_rejected(client):
    resp = client.post("/plans", json=plan_payload(base_fee="-1", currency="usd"))
    assert resp.status_code == 422
    fields = {d["field"] for d in resp.json()["error"]["details"]}
    assert fields == {"base_fee", "currency"}


def test_database_allows_only_one_unbounded_tier_per_plan(client):
    """The unique partial index is a backstop if something bypasses the API validation."""
    import psycopg
    import pytest

    plan = create_plan(client)
    with app.state.pool.connection() as conn:
        with pytest.raises(psycopg.errors.UniqueViolation):
            conn.execute(
                "INSERT INTO plan_tiers (plan_id, position, up_to, unit_price) VALUES (%s, 4, NULL, 0.01)",
                (plan["id"],),
            )


# ---------------------------------------------------------------- quote
def test_quote_across_all_tiers_includes_base_fee(client):
    plan = create_plan(client)
    resp = client.post(f"/plans/{plan['id']}/quote", json={"quantity": "1250"})

    assert resp.status_code == 200
    body = resp.json()
    assert [D(line["amount"]) for line in body["lines"]] == [D("10.00"), D("72.00"), D("12.50")]
    assert D(body["base_fee"]) == D("20.00")
    assert D(body["total"]) == D("114.50")  # 94.50 usage + 20.00 base fee
    assert body["currency"] == "USD"


def test_quote_total_equals_base_fee_plus_sum_of_lines(client):
    plan = create_plan(client, tiers=[{"up_to": None, "unit_price": "0.004"}])
    body = client.post(f"/plans/{plan['id']}/quote", json={"quantity": "3"}).json()
    assert D(body["total"]) == D(body["base_fee"]) + sum(D(l["amount"]) for l in body["lines"])


def test_quote_for_zero_usage_is_just_the_base_fee(client):
    plan = create_plan(client)
    body = client.post(f"/plans/{plan['id']}/quote", json={"quantity": "0"}).json()
    assert body["lines"] == []
    assert D(body["total"]) == D("20.00")


def test_quote_reports_tier_boundaries(client):
    plan = create_plan(client)
    lines = client.post(f"/plans/{plan['id']}/quote", json={"quantity": "1250"}).json()["lines"]
    assert lines[1]["from_quantity"] == "100.000000"
    assert lines[1]["to_quantity"] == "1000.000000"
    assert lines[2]["to_quantity"] is None


def test_quote_unknown_plan_is_404(client):
    resp = client.post(f"/plans/{uuid4()}/quote", json={"quantity": "1"})
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "plan_not_found"


def test_quote_negative_quantity_is_422(client):
    plan = create_plan(client)
    resp = client.post(f"/plans/{plan['id']}/quote", json={"quantity": "-1"})
    assert resp.status_code == 422
    assert resp.json()["error"]["details"][0]["field"] == "quantity"


def test_tiers_come_back_in_position_order_regardless_of_storage_order(client):
    """Insert tiers in reverse physical order; the API must still return them 1, 2, 3."""
    with app.state.pool.connection() as conn:
        plan_id = conn.execute(
            "INSERT INTO plans (name) VALUES ('Reverse') RETURNING id"
        ).fetchone()["id"]
        for position, up_to in [(3, None), (2, 1000), (1, 100)]:
            conn.execute(
                "INSERT INTO plan_tiers (plan_id, position, up_to, unit_price) VALUES (%s, %s, %s, 0.1)",
                (plan_id, position, up_to),
            )

    tiers = client.get(f"/plans/{plan_id}").json()["tiers"]
    assert [t["position"] for t in tiers] == [1, 2, 3]
    body = client.post(f"/plans/{plan_id}/quote", json={"quantity": "1250"}).json()
    assert [line["tier"] for line in body["lines"]] == [1, 2, 3]
