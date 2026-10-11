"""Graduated tiered pricing. Pure functions: no database, no I/O, Decimal only.

Graduated means each tier prices only the units that fall inside it. With tiers
    first 100 units @ 0.10, up to 1000 @ 0.08, beyond that @ 0.05
1,250 units cost 100*0.10 + 900*0.08 + 250*0.05, not 1,250*0.05.

`up_to` is the cumulative upper bound of a tier, and a quantity exactly on the
boundary belongs to the lower tier. The last tier is unbounded (up_to is None).

Rounding policy: each tier's charge is rounded once to the cent (ROUND_HALF_UP)
and the total is the sum of those rounded lines. That way an invoice's lines
always add up to its total exactly, which is what a finance team checks first.
"""
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal, localcontext
from typing import Sequence

CENT = Decimal("0.01")
ZERO = Decimal("0")
QUANTITY_ZERO = Decimal("0.000000")  # quantities carry 6 decimal places everywhere


@dataclass(frozen=True)
class Tier:
    up_to: Decimal | None  # cumulative upper bound; None means unbounded
    unit_price: Decimal


@dataclass(frozen=True)
class TierCharge:
    tier: int  # 1-based position
    from_quantity: Decimal  # exclusive lower bound of this tier
    to_quantity: Decimal | None  # inclusive upper bound; None means unbounded
    quantity: Decimal  # units that landed in this tier
    unit_price: Decimal
    amount: Decimal  # quantity * unit_price, rounded to the cent


def validate_tiers(tiers: Sequence[Tier]) -> None:
    """Raise ValueError with a message a human can act on if the tiers are malformed."""
    if not tiers:
        raise ValueError("a plan needs at least one tier")

    previous = ZERO
    for position, tier in enumerate(tiers, start=1):
        if tier.unit_price < 0:
            raise ValueError(f"tier {position}: unit_price must not be negative")

        is_last = position == len(tiers)
        if is_last:
            if tier.up_to is not None:
                raise ValueError("the last tier must be unbounded (up_to must be null)")
        else:
            if tier.up_to is None:
                raise ValueError(f"tier {position}: only the last tier can be unbounded")
            if tier.up_to <= previous:
                raise ValueError(
                    f"tier {position}: up_to must be greater than the previous tier's up_to ({previous})"
                )
            previous = tier.up_to


def price_tiers(tiers: Sequence[Tier], quantity: Decimal) -> list[TierCharge]:
    """Split `quantity` across the tiers and price each slice.

    Tiers that receive no units are omitted, so a quantity of zero yields no charges.
    """
    validate_tiers(tiers)
    if quantity < 0:
        raise ValueError("quantity must not be negative")

    charges: list[TierCharge] = []
    remaining = quantity
    lower = QUANTITY_ZERO

    # Quantities carry 6 decimal places and prices 6 more; the default 28-digit
    # context could silently round very large products, so use a roomy local one.
    with localcontext() as ctx:
        ctx.prec = 60
        for position, tier in enumerate(tiers, start=1):
            if remaining <= 0:
                break
            capacity = remaining if tier.up_to is None else tier.up_to - lower
            used = min(remaining, capacity)
            amount = (used * tier.unit_price).quantize(CENT, rounding=ROUND_HALF_UP)
            charges.append(TierCharge(position, lower, tier.up_to, used, tier.unit_price, amount))
            remaining -= used
            if tier.up_to is not None:
                lower = tier.up_to

    return charges


def total_amount(charges: Sequence[TierCharge]) -> Decimal:
    """Sum of the already-rounded line amounts."""
    return sum((c.amount for c in charges), Decimal("0.00"))
