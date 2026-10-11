"""Unit tests for proration and invoice building. Pure functions; these never touch the database."""
from datetime import datetime, timedelta, timezone
from decimal import Decimal as D

import pytest

from app.billing import MixedCurrencyError, Segment, build_invoice, month_bounds, prorate
from app.pricing import Tier

UTC = timezone.utc
SEP_START, SEP_END = month_bounds("2025-09")  # 30 days
OCT_START, OCT_END = month_bounds("2025-10")  # 31 days


def at(day, hour=0):
    return datetime(2025, 9, day, hour, tzinfo=UTC)


FLAT = (Tier(None, D("0.10")),)
GROWTH = (Tier(D("100"), D("0.10")), Tier(D("1000"), D("0.08")), Tier(None, D("0.05")))


def segment(start=SEP_START, end=SEP_END, base_fee="0", tiers=FLAT, usage="0", plan="Plan", currency="USD"):
    return Segment(plan, currency, D(base_fee), tiers, start, end, D(usage))


def amounts(draft):
    return [line.amount for line in draft.lines]


# ------------------------------------------------------------ month_bounds
@pytest.mark.parametrize(
    "period, start, end",
    [
        ("2025-09", (2025, 9, 1), (2025, 10, 1)),
        ("2025-12", (2025, 12, 1), (2026, 1, 1)),  # year rollover
        ("2024-02", (2024, 2, 1), (2024, 3, 1)),  # leap year: 29 days
        ("2025-02", (2025, 2, 1), (2025, 3, 1)),  # 28 days
    ],
)
def test_month_bounds(period, start, end):
    s, e = month_bounds(period)
    assert (s, e) == (datetime(*start, tzinfo=UTC), datetime(*end, tzinfo=UTC))


# ------------------------------------------------------------ prorate
def test_full_period_is_the_full_amount():
    assert prorate(D("20.00"), SEP_END - SEP_START, SEP_END - SEP_START) == D("20.00")


def test_half_the_period_is_half_the_amount():
    assert prorate(D("20.00"), timedelta(days=15), timedelta(days=30)) == D("10.00")


def test_proration_is_time_based_not_whole_days():
    # 12 hours of a 30-day month: 31.00 * (0.5 / 30) = 0.516666... -> 0.52
    assert prorate(D("31.00"), timedelta(hours=12), timedelta(days=30)) == D("0.52")


def test_proration_rounds_half_up_once():
    # 0.05 * 1/2 = 0.025 -> 0.03 (half up), not 0.02 (banker's rounding)
    assert prorate(D("0.05"), timedelta(days=15), timedelta(days=30)) == D("0.03")


def test_zero_coverage_is_zero():
    assert prorate(D("20.00"), timedelta(0), timedelta(days=30)) == D("0.00")


def test_proration_works_on_exact_fractions_even_when_float_would_not():
    # one third of 10.00 is 3.3333...; the same fraction via float seconds can drift
    assert prorate(D("10.00"), timedelta(days=10), timedelta(days=30)) == D("3.33")
    assert prorate(D("10.00"), timedelta(days=20), timedelta(days=30)) == D("6.67")


@pytest.mark.parametrize("covered, total", [(timedelta(days=31), timedelta(days=30)), (timedelta(days=-1), timedelta(days=30)), (timedelta(days=1), timedelta(0))])
def test_prorate_rejects_nonsense_inputs(covered, total):
    with pytest.raises(ValueError):
        prorate(D("1.00"), covered, total)


# ------------------------------------------------------------ one plan, full period
def test_full_month_one_plan_has_base_fee_and_tiered_usage():
    draft = build_invoice(SEP_START, SEP_END, [segment(base_fee="20.00", tiers=GROWTH, usage="1250", plan="Growth")])
    assert [l.kind for l in draft.lines] == ["base_fee", "usage", "usage", "usage"]
    assert amounts(draft) == [D("20.00"), D("10.00"), D("72.00"), D("12.50")]
    assert draft.total == D("114.50")
    assert draft.currency == "USD"
    assert draft.lines[0].description == "Base fee: Growth"  # not prorated


def test_zero_base_fee_produces_no_base_fee_line():
    draft = build_invoice(SEP_START, SEP_END, [segment(base_fee="0", usage="10")])
    assert [l.kind for l in draft.lines] == ["usage"]


def test_no_usage_is_just_the_base_fee():
    draft = build_invoice(SEP_START, SEP_END, [segment(base_fee="20.00")])
    assert amounts(draft) == [D("20.00")]
    assert draft.total == D("20.00")


def test_free_plan_with_no_usage_is_a_valid_zero_invoice():
    draft = build_invoice(SEP_START, SEP_END, [segment()])
    assert draft.lines == []
    assert draft.total == D("0.00")


# ------------------------------------------------------------ proration in an invoice
def test_subscription_starting_mid_month_prorates_the_base_fee():
    # Sept has 30 days; starting on the 16th covers 15 of them.
    draft = build_invoice(SEP_START, SEP_END, [segment(start=at(16), base_fee="20.00")])
    assert amounts(draft) == [D("10.00")]
    assert "prorated, 2025-09-16 to 2025-09-30" in draft.lines[0].description


def test_subscription_ending_mid_month_prorates_the_base_fee():
    draft = build_invoice(SEP_START, SEP_END, [segment(end=at(11), base_fee="30.00")])
    assert amounts(draft) == [D("10.00")]  # 10 of 30 days
    assert "prorated, 2025-09-01 to 2025-09-10" in draft.lines[0].description


def test_proration_uses_the_length_of_the_actual_month():
    # 31 days in October: 16 days covered of a 31.00 fee is exactly 16.00
    draft = build_invoice(OCT_START, OCT_END, [segment(start=datetime(2025, 10, 16, tzinfo=UTC), end=OCT_END, base_fee="31.00")])
    assert amounts(draft) == [D("16.00")]


# ------------------------------------------------------------ plan change mid-period
def test_plan_change_prices_each_segment_on_its_own_plan():
    a = segment(end=at(16), base_fee="30.00", tiers=FLAT, usage="100", plan="Starter")  # 0.10/unit
    b = segment(start=at(16), base_fee="60.00", tiers=(Tier(None, D("0.20")),), usage="100", plan="Pro")
    draft = build_invoice(SEP_START, SEP_END, [a, b])
    # base: 30*15/30 = 15.00 and 60*15/30 = 30.00; usage: 100*0.10 = 10.00 and 100*0.20 = 20.00
    assert [l.description.split(" (")[0] for l in draft.lines] == [
        "Base fee: Starter",
        "Usage: Starter, tier 1",
        "Base fee: Pro",
        "Usage: Pro, tier 1",
    ]
    assert amounts(draft) == [D("15.00"), D("10.00"), D("30.00"), D("20.00")]
    assert draft.total == D("75.00")


def test_tier_thresholds_restart_after_a_plan_change():
    # Same tiered plan before and after; 150 units in each half. If tiers did not reset, the second
    # half would all be priced in the cheaper tiers. They restart: 100@0.10 + 50@0.08 each time.
    a = segment(end=at(16), tiers=GROWTH, usage="150", plan="G1")
    b = segment(start=at(16), tiers=GROWTH, usage="150", plan="G2")
    draft = build_invoice(SEP_START, SEP_END, [a, b])
    assert amounts(draft) == [D("10.00"), D("4.00"), D("10.00"), D("4.00")]
    assert draft.total == D("28.00")


def test_segments_with_a_gap_only_bill_the_covered_time():
    a = segment(end=at(11), base_fee="30.00")  # 10 days
    b = segment(start=at(21), base_fee="30.00")  # 10 days
    draft = build_invoice(SEP_START, SEP_END, [a, b])
    assert amounts(draft) == [D("10.00"), D("10.00")]


# ------------------------------------------------------------ invariants
def test_total_always_equals_the_sum_of_the_printed_lines():
    a = segment(end=at(11), base_fee="10.00", tiers=(Tier(None, D("0.004")),), usage="3")
    b = segment(start=at(11), end=at(21), base_fee="10.00", tiers=(Tier(None, D("0.004")),), usage="3")
    c = segment(start=at(21), base_fee="10.00", tiers=(Tier(None, D("0.004")),), usage="3")
    draft = build_invoice(SEP_START, SEP_END, [a, b, c])
    assert draft.total == sum(l.amount for l in draft.lines)


def test_mixed_currencies_are_refused():
    a = segment(end=at(16), currency="USD")
    b = segment(start=at(16), currency="EUR")
    with pytest.raises(MixedCurrencyError, match="EUR, USD"):
        build_invoice(SEP_START, SEP_END, [a, b])


def test_no_segments_is_an_error():
    with pytest.raises(ValueError, match="at least one"):
        build_invoice(SEP_START, SEP_END, [])


def test_overlapping_segments_are_rejected():
    a = segment(end=at(20))
    b = segment(start=at(10))
    with pytest.raises(ValueError, match="overlap"):
        build_invoice(SEP_START, SEP_END, [a, b])


def test_a_segment_past_the_period_is_rejected():
    with pytest.raises(ValueError, match="past the billing period"):
        build_invoice(SEP_START, SEP_END, [segment(end=OCT_END)])
