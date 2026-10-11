from datetime import datetime
from uuid import UUID

from pydantic import AwareDatetime, BaseModel


class SubscriptionIn(BaseModel):
    plan_id: UUID
    # Timezone-aware only, for the same reason as usage timestamps.
    starts_at: AwareDatetime


class SubscriptionEndIn(BaseModel):
    ends_at: AwareDatetime


class SubscriptionOut(BaseModel):
    id: UUID
    customer_id: UUID
    plan_id: UUID
    starts_at: datetime
    ends_at: datetime | None
    created_at: datetime
