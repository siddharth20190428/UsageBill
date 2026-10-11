from datetime import datetime
from decimal import Decimal
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, Field


class CustomerIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)


class CustomerOut(BaseModel):
    id: UUID
    name: str
    created_at: datetime


class UsageIn(BaseModel):
    customer_id: UUID
    # Decimal, never float. Matches NUMERIC(20, 6) in the database.
    quantity: Decimal = Field(gt=0, max_digits=20, decimal_places=6)
    # Timezone-aware only: a naive timestamp is ambiguous when billing periods are involved.
    occurred_at: AwareDatetime
    idempotency_key: str = Field(min_length=1, max_length=255)


class UsageOut(BaseModel):
    id: UUID
    customer_id: UUID
    quantity: Decimal
    occurred_at: datetime
    idempotency_key: str
    # True when this request was a retry of one we had already recorded.
    duplicate: bool
