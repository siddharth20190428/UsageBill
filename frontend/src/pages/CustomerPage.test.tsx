import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiError, mockApi } from "../test/mockApi";
import { CustomerPage } from "./CustomerPage";

afterEach(() => vi.unstubAllGlobals());

const customer = { id: "c1", name: "Acme", created_at: "2025-09-01T00:00:00Z" };
const plan = { id: "p1", name: "Pro", currency: "USD", base_fee: "49.00", created_at: "2025-09-01T00:00:00Z", tiers: [{ position: 1, up_to: null, unit_price: "0.100000" }] };
const usageRow = { id: "u1", customer_id: "c1", quantity: "5.000000", occurred_at: "2025-09-16T00:00:00Z", idempotency_key: "k-1", created_at: "2025-09-16T00:00:00Z" };
const invoice = {
  id: "i1", customer_id: "c1", period_start: "2025-09-01T00:00:00Z", period_end: "2025-10-01T00:00:00Z", currency: "USD", total: "49.50", created_at: "2025-10-02T00:00:00Z",
  lines: [
    { position: 1, kind: "base_fee", description: "Base fee", quantity: null, unit_price: null, amount: "49.00" },
    { position: 2, kind: "usage", description: "Usage tier 1", quantity: "5.000000", unit_price: "0.100000", amount: "0.50" },
  ],
};

const base = {
  "GET /customers/c1": () => ({ body: customer }),
  "GET /plans": () => ({ body: [plan] }),
  "GET /customers/c1/subscriptions": () => ({ body: [] }),
  "GET /customers/c1/usage": () => ({ body: [] }),
  "GET /customers/c1/invoices": () => ({ body: [] }),
};

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={["/customers/c1"]}>
      <Routes><Route path="/customers/:customerId" element={<CustomerPage />} /></Routes>
    </MemoryRouter>,
  );

async function fillUsage(quantity: string) {
  const form = await screen.findByRole("form", { name: "Record usage" });
  await userEvent.type(within(form).getByLabelText("Quantity"), quantity);
  return form;
}

describe("customer page: usage", () => {
  it("records usage, rotates the key, and a retry of the same request says 'Already recorded'", async () => {
    const api = mockApi({
      ...base,
      "POST /usage": (b) => {
        const first = api.count("POST /usage") === 1;
        return { status: first ? 201 : 200, body: { ...usageRow, ...(b as object), duplicate: !first } };
      },
    });
    renderPage();
    const form = await fillUsage("5");
    const keyBefore = (within(form).getByLabelText("Idempotency key") as HTMLInputElement).value;
    await userEvent.click(within(form).getByRole("button", { name: "Record usage" }));
    expect(await screen.findByText("Recorded 5 units.")).toBeInTheDocument();
    expect((within(form).getByLabelText("Idempotency key") as HTMLInputElement).value).not.toBe(keyBefore);

    await userEvent.click(screen.getByRole("button", { name: "Retry the same request" }));
    expect(await screen.findByText("Already recorded.")).toBeInTheDocument();
    const sent = api.calls.filter((c) => c.key === "POST /usage").map((c) => (c.body as { idempotency_key: string }).idempotency_key);
    expect(sent).toEqual([keyBefore, keyBefore]);
  });

  it("keeps the same key after a failure so a retry cannot double-count", async () => {
    let fail = true;
    const api = mockApi({
      ...base,
      "POST /usage": (b) => (fail ? apiError(503, "boom", "temporarily unavailable") : { status: 201, body: { ...usageRow, ...(b as object), duplicate: false } }),
    });
    renderPage();
    const form = await fillUsage("5");
    const key = (within(form).getByLabelText("Idempotency key") as HTMLInputElement).value;
    await userEvent.click(within(form).getByRole("button", { name: "Record usage" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("temporarily unavailable");
    expect((within(form).getByLabelText("Idempotency key") as HTMLInputElement).value).toBe(key);
    expect((within(form).getByLabelText("Quantity") as HTMLInputElement).value).toBe("5");
    fail = false;
    await userEvent.click(within(form).getByRole("button", { name: "Record usage" }));
    expect(await screen.findByText("Recorded 5 units.")).toBeInTheDocument();
    expect(api.calls.filter((c) => c.key === "POST /usage").every((c) => (c.body as { idempotency_key: string }).idempotency_key === key)).toBe(true);
  });

  it("ignores a double-click while a request is in flight", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const api = mockApi({
      ...base,
      "POST /usage": async (b) => {
        await gate;
        return { status: 201, body: { ...usageRow, ...(b as object), duplicate: false } };
      },
    });
    renderPage();
    const form = await fillUsage("5");
    const button = within(form).getByRole("button", { name: "Record usage" });
    await userEvent.dblClick(button);
    release();
    await screen.findByText("Recorded 5 units.");
    expect(api.count("POST /usage")).toBe(1);
  });

  it("rejects bad quantities locally and explains a reused key", async () => {
    const api = mockApi({
      ...base,
      "POST /usage": () => apiError(409, "idempotency_key_reuse", "Key 'k' was already used with different details"),
    });
    renderPage();
    const form = await fillUsage("0");
    await userEvent.click(within(form).getByRole("button", { name: "Record usage" }));
    expect(screen.getByText("Quantity must be greater than zero.")).toBeInTheDocument();
    expect(api.count("POST /usage")).toBe(0);

    await userEvent.clear(within(form).getByLabelText("Quantity"));
    await userEvent.type(within(form).getByLabelText("Quantity"), "3");
    await userEvent.click(within(form).getByRole("button", { name: "Record usage" }));
    expect(await screen.findByText("That idempotency key was already used for a different event")).toBeInTheDocument();
  });
});

describe("customer page: invoices", () => {
  it("distinguishes a new invoice from an already-issued one", async () => {
    let n = 0;
    mockApi({
      ...base,
      "POST /invoices": () => ({ status: n++ === 0 ? 201 : 200, body: invoice }),
    });
    renderPage();
    const form = await screen.findByRole("form", { name: "Generate invoice" });
    await userEvent.click(within(form).getByRole("button", { name: "Generate invoice" }));
    expect(await screen.findByText("Invoice created")).toBeInTheDocument();
    await userEvent.click(within(form).getByRole("button", { name: "Generate invoice" }));
    expect(await screen.findByText("Already issued.")).toBeInTheDocument();
    expect(screen.queryByText("Invoice created")).not.toBeInTheDocument();
  });

  it("turns a usage-without-subscription error into a next step", async () => {
    mockApi({
      ...base,
      "POST /invoices": () => apiError(409, "usage_without_subscription", "2 usage events fall outside any subscription"),
    });
    renderPage();
    const form = await screen.findByRole("form", { name: "Generate invoice" });
    await userEvent.click(within(form).getByRole("button", { name: "Generate invoice" }));
    expect(await screen.findByText("Some usage isn't covered by a subscription")).toBeInTheDocument();
    expect(screen.getByText(/Add or adjust a subscription/)).toBeInTheDocument();
    expect(screen.getByText(/2 usage events fall outside/)).toBeInTheDocument();
  });

  it("lists existing invoices with their lines and total", async () => {
    mockApi({ ...base, "GET /customers/c1/invoices": () => ({ body: [invoice] }) });
    renderPage();
    const table = await screen.findByRole("table", { name: "Invoice for September 2025" });
    expect(within(table).getByText("Base fee")).toBeInTheDocument();
    expect(within(table).getAllByText("$49.50").length).toBeGreaterThan(0);
  });
});

describe("customer page: subscriptions and loading", () => {
  it("starts a subscription and shows an overlap error with guidance", async () => {
    let subs: unknown[] = [];
    mockApi({
      ...base,
      "GET /customers/c1/subscriptions": () => ({ body: subs }),
      "POST /customers/c1/subscriptions": () => {
        if (subs.length === 0) {
          subs = [{ id: "s1", customer_id: "c1", plan_id: "p1", starts_at: "2025-09-01T00:00:00Z", ends_at: null, created_at: "x" }];
          return { status: 201, body: subs[0] };
        }
        return apiError(409, "subscription_overlap", "Overlaps subscription s1");
      },
    });
    renderPage();
    await screen.findByText("No subscription yet");
    const form = screen.getByRole("form", { name: "Start subscription" });
    await userEvent.click(within(form).getByRole("button", { name: "Start subscription" }));
    expect(screen.getByText("Choose a plan.")).toBeInTheDocument();
    await userEvent.selectOptions(within(form).getByLabelText("Plan"), "p1");
    await userEvent.click(within(form).getByRole("button", { name: "Start subscription" }));
    expect(await screen.findByText(/Subscription saved/)).toBeInTheDocument();
    expect(await screen.findByText("Active")).toBeInTheDocument();

    await userEvent.click(within(form).getByRole("button", { name: "Change plan" }));
    expect(await screen.findByText("That start time overlaps the current subscription")).toBeInTheDocument();
  });

  it("shows a not-found customer with a way out", async () => {
    mockApi({ "GET /customers/c1": () => apiError(404, "customer_not_found", "Customer c1 not found") });
    renderPage();
    expect(await screen.findByText("That customer no longer exists")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("form", { name: "Record usage" })).not.toBeInTheDocument());
  });
});
