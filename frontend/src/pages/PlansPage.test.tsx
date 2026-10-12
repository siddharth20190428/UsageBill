import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiError, mockApi } from "../test/mockApi";
import { PlansPage } from "./PlansPage";

afterEach(() => vi.unstubAllGlobals());

const plan = {
  id: "p1", name: "Pro", currency: "USD", base_fee: "49.00", created_at: "2025-09-16T00:00:00Z",
  tiers: [
    { position: 1, up_to: "1000.000000", unit_price: "0.100000" },
    { position: 2, up_to: null, unit_price: "0.050000" },
  ],
};

describe("PlansPage", () => {
  it("lists plans with a readable tier summary and quotes a price", async () => {
    mockApi({
      "GET /plans": () => ({ body: [plan] }),
      "POST /plans/p1/quote": () => ({
        body: {
          plan_id: "p1", currency: "USD", quantity: "1500", base_fee: "49.00", total: "124.00",
          lines: [
            { tier: 1, from_quantity: "0", to_quantity: "1000", quantity: "1000", unit_price: "0.100000", amount: "100.00" },
            { tier: 2, from_quantity: "1000", to_quantity: null, quantity: "500", unit_price: "0.050000", amount: "25.00" },
          ],
        },
      }),
    });
    render(<PlansPage />);
    const tiers = await screen.findByRole("list", { name: "Pro tiers" });
    expect(within(tiers).getByText("0 to 1,000: USD 0.10 per unit")).toBeInTheDocument();
    expect(within(tiers).getByText("Above 1,000: USD 0.05 per unit")).toBeInTheDocument();

    await userEvent.click(screen.getByText("Price calculator"));
    await userEvent.type(screen.getByLabelText("Quantity in a month"), "1500");
    await userEvent.click(screen.getByRole("button", { name: "Calculate" }));
    expect(await screen.findByText("$124.00")).toBeInTheDocument();
  });

  it("catches tier mistakes locally, before any request", async () => {
    const api = mockApi({ "GET /plans": () => ({ body: [] }) });
    render(<PlansPage />);
    await screen.findByText("No plans yet");
    await userEvent.type(screen.getByLabelText("Name"), "Starter");
    await userEvent.click(screen.getByRole("button", { name: "Add tier" }));
    await userEvent.click(screen.getByRole("button", { name: "Add tier" }));
    await userEvent.type(screen.getByLabelText("Tier 1 up to"), "1000");
    await userEvent.type(screen.getByLabelText("Tier 1 price per unit"), "0.1");
    await userEvent.type(screen.getByLabelText("Tier 2 up to"), "500"); // not ascending
    await userEvent.type(screen.getByLabelText("Tier 2 price per unit"), "0.05");
    await userEvent.type(screen.getByLabelText("Tier 3 price per unit"), "0.01");
    await userEvent.click(screen.getByRole("button", { name: "Create plan" }));
    expect(screen.getByText(/Must be greater than the previous tier/)).toBeInTheDocument();
    expect(screen.getByLabelText("Tier 2 up to")).toHaveAttribute("aria-invalid", "true");
    expect(api.count("POST /plans")).toBe(0);
  });

  it("shows a server rejection at the right field, with a next step", async () => {
    mockApi({
      "GET /plans": () => ({ body: [] }),
      "POST /plans": () => apiError(409, "plan_name_taken", "A plan named 'Pro' already exists", "name"),
    });
    render(<PlansPage />);
    await screen.findByText("No plans yet");
    await userEvent.type(screen.getByLabelText("Name"), "Pro");
    await userEvent.type(screen.getByLabelText("Tier 1 price per unit"), "0.1");
    await userEvent.click(screen.getByRole("button", { name: "Create plan" }));
    expect(await screen.findByText("That plan name is already taken")).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText(/give the new version a new name/)).toBeInTheDocument();
  });

  it("maps server validation details onto tier fields", async () => {
    mockApi({
      "GET /plans": () => ({ body: [] }),
      "POST /plans": () =>
        apiError(422, "validation_error", "Invalid", null, [{ field: "tiers.0.unit_price", message: "Input should be greater than or equal to 0" }]),
    });
    render(<PlansPage />);
    await screen.findByText("No plans yet");
    await userEvent.type(screen.getByLabelText("Name"), "X");
    await userEvent.type(screen.getByLabelText("Tier 1 price per unit"), "1");
    await userEvent.click(screen.getByRole("button", { name: "Create plan" }));
    expect(await screen.findByText(/greater than or equal to 0/)).toBeInTheDocument();
    expect(screen.getByLabelText("Tier 1 price per unit")).toHaveAttribute("aria-invalid", "true");
  });
});
