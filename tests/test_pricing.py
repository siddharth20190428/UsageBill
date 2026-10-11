"""Unit tests for the pure pricing function. These never touch the database."""
from decimal import Decimal as D

import pytest

from app.pricing import Tier, price_tiers, total_amount, validate_tiers

# first 100 @ 0.10, up to 1000 @ 0.08, beyond @ 0.05
THREE_TIERS = [
    Tier(D("100"), D("0.10")),
    Tier(D("1000"), D("0.08")),
    Tier(None, D("0.05")),
]


def price(quantity, tiers=THREE_TIERS):
    charges = price_tiers(tiers, D(quantity))
    return charges, total_amount(charges)


# ------------------------------------------------------------ graduated math
def test_quantity_spanning_all_three_tiers():
    charges, total = price("1250")
    # 100*0.10 + 900*0.08 + 250*0.05
    assert [c.amount for c in charges] == [D("10.00"), D("72.00"), D("12.50")]
    assert [c.quantity for c in charges] == [D("100"), D("900"), D("250")]
    assert total == D("94.50")


def test_quantity_inside_first_tier_only():
    charges, total = price("40")
    assert len(charges) == 1
    assert charges[0].tier == 1
    assert total == D("4.00")


def test_zero_quantity_has_no_charges():
    charges, total = price("0")
    assert charges == []
    assert total == D("0.00")


# ------------------------------------------------------------ tier boundaries
def test_quantity_exactly_on_a_boundary_stays_in_the_lower_tier():
    charges, total = price("100")
    assert len(charges) == 1
    assert charges[0].quantity == D("100")
    assert total == D("10.00")


def test_one_smallest_unit_past_a_boundary_enters_the_next_tier():
    charges, total = price("100.000001")
    assert len(charges) == 2
    assert charges[1].tier == 2
    assert charges[1].quantity == D("0.000001")
    # 100*0.10 + 0.000001*0.08 = 10.00000008 -> line 2 rounds to 0.00
    assert [c.amount for c in charges] == [D("10.00"), D("0.00")]
    assert total == D("10.00")


def test_quantity_exactly_on_the_second_boundary():
    charges, total = price("1000")
    assert [c.quantity for c in charges] == [D("100"), D("900")]
    assert total == D("82.00")


def test_boundary_values_are_reported_on_each_line():
    charges, _ = price("1250")
    assert (charges[0].from_quantity, charges[0].to_quantity) == (D("0"), D("100"))
    assert (charges[1].from_quantity, charges[1].to_quantity) == (D("100"), D("1000"))
    assert (charges[2].from_quantity, charges[2].to_quantity) == (D("1000"), None)


# ------------------------------------------------------------ rounding
def test_rounding_is_half_up_per_line():
    # 0.5 units @ 0.01 = 0.005 -> 0.01 (half up), not 0.00 (banker's rounding)
    charges, total = price("0.5", [Tier(None, D("0.01"))])
    assert charges[0].amount == D("0.01")
    assert total == D("0.01")


def test_total_is_the_sum_of_rounded_lines_not_a_separately_rounded_total():
    # Each line is 0.004 raw -> rounds to 0.00. Summing the raw values (0.012) and rounding once
    # would give 0.01. The invoice must add up as printed, so the total is 0.00.
    tiers = [Tier(D("1"), D("0.004")), Tier(D("2"), D("0.004")), Tier(None, D("0.004"))]
    charges, total = price("3", tiers)
    assert [c.amount for c in charges] == [D("0.00"), D("0.00"), D("0.00")]
    assert total == D("0.00")
    assert total == sum(c.amount for c in charges)


@pytest.mark.parametrize("unit_price, expected", [("1.005", "1.01"), ("2.675", "2.68"), ("0.285", "0.29")])
def test_half_cent_amounts_round_up_where_floats_would_round_down(unit_price, expected):
    # 1.005 is stored as 1.00499999999999989... in binary floating point, so round(1.005, 2) == 1.0.
    # Decimal holds it exactly and ROUND_HALF_UP gives the 1.01 a customer's calculator shows.
    charges, _ = price("1", [Tier(None, D(unit_price))])
    assert charges[0].amount == D(expected)


def test_very_large_quantities_do_not_lose_precision():
    big = D("99999999999999.999999")  # 20 significant digits, the schema maximum
    charges = price_tiers([Tier(None, D("0.999999"))], big)
    expected = (big * D("0.999999")).quantize(D("0.01"))
    assert charges[0].amount == expected


def test_free_tier_then_paid_tier():
    tiers = [Tier(D("1000"), D("0")), Tier(None, D("0.02"))]
    charges, total = price("1500", tiers)
    assert [c.amount for c in charges] == [D("0.00"), D("10.00")]
    assert total == D("10.00")


# ------------------------------------------------------------ validation
def test_negative_quantity_is_rejected():
    with pytest.raises(ValueError, match="negative"):
        price_tiers(THREE_TIERS, D("-1"))


@pytest.mark.parametrize(
    "tiers, message",
    [
        ([], "at least one tier"),
        ([Tier(D("100"), D("0.1"))], "last tier must be unbounded"),
        ([Tier(None, D("0.1")), Tier(None, D("0.2"))], "only the last tier can be unbounded"),
        ([Tier(D("100"), D("0.1")), Tier(D("50"), D("0.1")), Tier(None, D("0.1"))], "greater than"),
        ([Tier(D("100"), D("0.1")), Tier(D("100"), D("0.1")), Tier(None, D("0.1"))], "greater than"),
        ([Tier(None, D("-0.1"))], "negative"),
    ],
)
def test_malformed_tiers_are_rejected_with_a_clear_message(tiers, message):
    with pytest.raises(ValueError, match=message):
        validate_tiers(tiers)


def test_a_single_unbounded_tier_is_a_valid_flat_rate_plan():
    validate_tiers([Tier(None, D("0.25"))])
    _, total = price("10", [Tier(None, D("0.25"))])
    assert total == D("2.50")
