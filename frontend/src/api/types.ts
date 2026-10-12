// Shapes returned by the UsageBill API. Money and quantities are strings on purpose: the server sends
// exact decimals, and turning them into JavaScript numbers would reintroduce floating-point error.

export interface Customer {
  id: string;
  name: string;
  created_at: string;
}

export interface PlanTier {
  position: number;
  up_to: string | null; // null = unbounded (the last tier)
  unit_price: string;
}

export interface Plan {
  id: string;
  name: string;
  currency: string;
  base_fee: string;
  created_at: string;
  tiers: PlanTier[];
}

export interface PlanInput {
  name: string;
  currency: string;
  base_fee: string;
  tiers: { up_to: string | null; unit_price: string }[];
}

export interface QuoteLine {
  tier: number;
  from_quantity: string;
  to_quantity: string | null;
  quantity: string;
  unit_price: string;
  amount: string;
}

export interface Quote {
  plan_id: string;
  currency: string;
  quantity: string;
  base_fee: string;
  lines: QuoteLine[];
  total: string;
}

export interface Subscription {
  id: string;
  customer_id: string;
  plan_id: string;
  starts_at: string;
  ends_at: string | null; // null = still active
  created_at: string;
}

export interface UsageEvent {
  id: string;
  customer_id: string;
  quantity: string;
  occurred_at: string;
  idempotency_key: string;
  created_at: string;
}

export interface UsageInput {
  customer_id: string;
  quantity: string;
  occurred_at: string;
  idempotency_key: string;
}

export interface UsageResult {
  id: string;
  customer_id: string;
  quantity: string;
  occurred_at: string;
  idempotency_key: string;
  duplicate: boolean; // true when this request was a retry of an event already recorded
}

export interface InvoiceLine {
  position: number;
  kind: "base_fee" | "usage";
  description: string;
  quantity: string | null;
  unit_price: string | null;
  amount: string;
}

export interface Invoice {
  id: string;
  customer_id: string;
  period_start: string;
  period_end: string;
  currency: string;
  total: string;
  created_at: string;
  lines: InvoiceLine[];
}
