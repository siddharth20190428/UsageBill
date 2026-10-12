import type {
  Customer,
  Invoice,
  Plan,
  PlanInput,
  Quote,
  Subscription,
  UsageEvent,
  UsageInput,
  UsageResult,
} from "./types";

// In development this is the Vite dev server's /api proxy; set VITE_API_BASE to point elsewhere.
const BASE: string = import.meta.env.VITE_API_BASE ?? "/api";

export interface ErrorDetail {
  field: string | null;
  message: string;
}

/** The server answered, but with an error. Carries the structured body the API always returns. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly field?: string,
    public readonly details: ErrorDetail[] = [],
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** The request never got an answer (server down, offline, blocked). */
export class NetworkError extends Error {
  constructor() {
    super("Could not reach the server.");
    this.name = "NetworkError";
  }
}

export interface ApiResult<T> {
  status: number;
  data: T;
}

function toApiError(status: number, body: unknown): ApiError {
  const error = typeof body === "object" && body !== null ? (body as { error?: unknown }).error : undefined;
  if (typeof error === "object" && error !== null) {
    const e = error as { code?: unknown; message?: unknown; field?: unknown; details?: unknown };
    if (typeof e.code === "string") {
      return new ApiError(
        status,
        e.code,
        typeof e.message === "string" ? e.message : "",
        typeof e.field === "string" ? e.field : undefined,
        Array.isArray(e.details) ? (e.details as ErrorDetail[]) : [],
      );
    }
  }
  return new ApiError(status, "unexpected_response", `The server returned an unexpected response (HTTP ${status}).`);
}

async function request<T>(method: string, path: string, body?: unknown): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new NetworkError();
  }

  let parsed: unknown = null;
  const text = await response.text();
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null; // e.g. an HTML error page from a proxy
    }
  }

  if (!response.ok) throw toApiError(response.status, parsed);
  return { status: response.status, data: parsed as T };
}

const data = async <T>(promise: Promise<ApiResult<T>>): Promise<T> => (await promise).data;

export const api = {
  // customers
  listCustomers: () => data(request<Customer[]>("GET", "/customers")),
  getCustomer: (id: string) => data(request<Customer>("GET", `/customers/${id}`)),
  createCustomer: (name: string) => data(request<Customer>("POST", "/customers", { name })),

  // plans
  listPlans: () => data(request<Plan[]>("GET", "/plans")),
  createPlan: (plan: PlanInput) => data(request<Plan>("POST", "/plans", plan)),
  quote: (planId: string, quantity: string) =>
    data(request<Quote>("POST", `/plans/${planId}/quote`, { quantity })),

  // subscriptions
  listSubscriptions: (customerId: string) =>
    data(request<Subscription[]>("GET", `/customers/${customerId}/subscriptions`)),
  startSubscription: (customerId: string, planId: string, startsAt: string) =>
    data(
      request<Subscription>("POST", `/customers/${customerId}/subscriptions`, {
        plan_id: planId,
        starts_at: startsAt,
      }),
    ),
  endSubscription: (subscriptionId: string, endsAt: string) =>
    data(request<Subscription>("POST", `/subscriptions/${subscriptionId}/end`, { ends_at: endsAt })),

  // usage. Returns the status too: 201 means recorded, 200 means "we already had this one".
  listUsage: (customerId: string, limit = 20) =>
    data(request<UsageEvent[]>("GET", `/customers/${customerId}/usage?limit=${limit}`)),
  recordUsage: (input: UsageInput) => request<UsageResult>("POST", "/usage", input),

  // invoices. Returns the status too: 201 means created, 200 means "already issued".
  listInvoices: (customerId: string) => data(request<Invoice[]>("GET", `/customers/${customerId}/invoices`)),
  generateInvoice: (customerId: string, period: string) =>
    request<Invoice>("POST", "/invoices", { customer_id: customerId, period }),
};
