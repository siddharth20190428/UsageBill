from datetime import datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.pricing import Tier, validate_tiers


class TierIn(BaseModel):
    # null means unbounded; only the last tier may be unbounded.
    up_to: Decimal | None = Field(default=None, gt=0, max_digits=20, decimal_places=6)
    unit_price: Decimal = Field(ge=0, max_digits=20, decimal_places=6)


class PlanIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    name: str = Field(min_length=1, max_length=200)
    currency: str = Field(default="USD", pattern=r"^[A-Z]{3}$")
    base_fee: Decimal = Field(default=Decimal("0"), ge=0, max_digits=20, decimal_places=2)
    tiers: list[TierIn] = Field(min_length=1, max_length=50)

    @field_validator("tiers")
    @classmethod
    def tiers_must_be_well_formed(cls, tiers: list[TierIn]) -> list[TierIn]:
        # A ValueError here becomes a field-level 422 on "tiers" with the message below.
        validate_tiers([Tier(t.up_to, t.unit_price) for t in tiers])
        return tiers


class TierOut(BaseModel):
    position: int
    up_to: Decimal | None
    unit_price: Decimal


class PlanOut(BaseModel):
    id: UUID
    name: str
    currency: str
    base_fee: Decimal
    created_at: datetime
    tiers: list[TierOut]


class QuoteIn(BaseModel):
    quantity: Decimal = Field(ge=0, max_digits=20, decimal_places=6)


class QuoteLine(BaseModel):
    tier: int
    from_quantity: Decimal
    to_quantity: Decimal | None
    quantity: Decimal
    unit_price: Decimal
    amount: Decimal


class QuoteOut(BaseModel):
    plan_id: UUID
    currency: str
    quantity: Decimal
    base_fee: Decimal
    lines: list[QuoteLine]
    total: Decimal
