from datetime import datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, Field


class InvoiceIn(BaseModel):
    customer_id: UUID
    # A calendar month in UTC, e.g. "2025-09". Whole months only, so invoices for one customer can
    # never overlap and bill the same usage twice.
    period: str = Field(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")


class InvoiceLineOut(BaseModel):
    position: int
    kind: str
    description: str
    quantity: Decimal | None
    unit_price: Decimal | None
    amount: Decimal


class InvoiceOut(BaseModel):
    id: UUID
    customer_id: UUID
    period_start: datetime
    period_end: datetime
    currency: str
    total: Decimal
    created_at: datetime
    lines: list[InvoiceLineOut]
