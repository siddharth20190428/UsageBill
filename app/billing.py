"""Invoice math. Pure functions: no database, no clock, Decimal only.

Billing periods are calendar months in UTC: [first of month 00:00, first of next month 00:00).
A customer's period is split into *segments*, one per subscription (plan) that was active
during it. Each segment is priced on its own:

  * Base fee: prorated by the exact fraction of the period the segment covers (microsecond
    resolution), then rounded once to the cent (half-up).
  * Usage: the usage that occurred inside the segment is priced with that segment's plan
    tiers. Tier thresholds count from the start of the segment, so a plan change resets them.

Segments are half-open [start, end), so a usage event exactly at a plan-change instant belongs
to the new plan and can never be counted twice.
"""
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal, localcontext
from typing import Sequence

from app.pricing import CENT, Tier, price_tiers

MICROSECOND = timedelta(microseconds=1)
ZERO_AMOUNT = Decimal("0.00")


class MixedCurrencyError(ValueError):
    """Plans in different currencies were active in one billing period."""


@dataclass(frozen=True)
class Segment:
    plan_name: str
    currency: str
    base_fee: Decimal
    tiers: tuple[Tier, ...]
    start: datetime  # inclusive
    end: datetime  # exclusive
    usage: Decimal  # total usage that occurred in [start, end)


@dataclass(frozen=True)
class InvoiceLine:
    kind: str  # "base_fee" or "usage"
    description: str
    quantity: Decimal | None
    unit_price: Decimal | None
    amount: Decimal


@dataclass(frozen=True)
class InvoiceDraft:
    currency: str
    lines: list[InvoiceLine]
    total: Decimal


def month_bounds(period: str) -> tuple[datetime, datetime]:
    """'2025-09' -> (2025-09-01T00:00Z, 2025-10-01T00:00Z)."""
    year, month = int(period[:4]), int(period[5:7])
    start = datetime(year, month, 1, tzinfo=timezone.utc)
    end = datetime(year + (month == 12), month % 12 + 1, 1, tzinfo=timezone.utc)
    return start, end


def prorate(amount: Decimal, covered: timedelta, total: timedelta) -> Decimal:
    """`amount` scaled by covered/total, rounded once to the cent (half-up).

    Uses integer microseconds so the fraction is exact; a fully covered period returns
    `amount` unchanged.
    """
    if total <= timedelta(0):
        raise ValueError("the billing period must have a positive length")
    if covered < timedelta(0) or covered > total:
        raise ValueError("the covered time must be between zero and the full period")
    with localcontext() as ctx:
        ctx.prec = 60
        scaled = amount * (covered // MICROSECOND) / (total // MICROSECOND)
        return scaled.quantize(CENT, rounding=ROUND_HALF_UP)


def build_invoice(period_start: datetime, period_end: datetime, segments: Sequence[Segment]) -> InvoiceDraft:
    if not segments:
        raise ValueError("an invoice needs at least one subscription segment")

    currencies = {s.currency for s in segments}
    if len(currencies) > 1:
        raise MixedCurrencyError(
            f"cannot put plans in different currencies ({', '.join(sorted(currencies))}) on one invoice"
        )

    previous_end = period_start
    for seg in segments:
        if seg.start >= seg.end:
            raise ValueError("a segment must have a positive length")
        if seg.start < previous_end:
            raise ValueError("segments must be in order and must not overlap")
        if seg.end > period_end:
            raise ValueError("a segment cannot extend past the billing period")
        previous_end = seg.end

    period = period_end - period_start
    lines: list[InvoiceLine] = []

    for seg in segments:
        covered = seg.end - seg.start

        if seg.base_fee > 0:
            label = f"Base fee: {seg.plan_name}"
            if covered != period:
                last_day = seg.end - MICROSECOND  # show an inclusive end date
                label += f" (prorated, {seg.start:%Y-%m-%d} to {last_day:%Y-%m-%d})"
            lines.append(InvoiceLine("base_fee", label, None, None, prorate(seg.base_fee, covered, period)))

        for charge in price_tiers(list(seg.tiers), seg.usage):
            lines.append(
                InvoiceLine(
                    "usage",
                    f"Usage: {seg.plan_name}, tier {charge.tier}",
                    charge.quantity,
                    charge.unit_price,
                    charge.amount,
                )
            )

    total = sum((line.amount for line in lines), ZERO_AMOUNT)
    return InvoiceDraft(currency=segments[0].currency, lines=lines, total=total)
