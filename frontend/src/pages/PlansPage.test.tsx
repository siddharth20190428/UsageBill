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

async function openNewPlan() {
  await userEvent.click(await screen.findByRole("button", { name: "New plan" }));
  return screen.getByRole("dialog", { name: "New plan" });
}
async function openMenu(item: string) {
  await userEvent.click(await screen.findByRole("button", { name: "Actions for Pro" }));
  await userEvent.click(screen.getByRole("menuitem", { name: item }));
}

describe("PlansPage", () => {
  it("lists plans with a readable tier table and quotes a price", async () => {
    mockApi({
      "GET /plans": () => ({ body: [plan] }),
      "POST /plans/p1/quote": () => ({
        body: {
          plan_id: "p1", currency: "USD", quantity: "1500", base_fee: "49.00", total: "174.00",
          lines: [
            { tier: 1, from_quantity: "0", to_quantity: "1000", quantity: "1000", unit_price: "0.100000", amount: "100.00" },
            { tier: 2, from_quantity: "1000", to_quantity: null, quantity: "500", unit_price: "0.050000", amount: "25.00" },
          ],
        },
      }),
    });
    render(<PlansPage />);
    const tiers = await screen.findByRole("table", { name: "Pro tiers" });
    expect(within(tiers).getByText("0 – 1,000")).toBeInTheDocument();
    expect(within(tiers).getByText("USD 0.10")).toBeInTheDocument();
    expect(within(tiers).getByText("Above 1,000")).toBeInTheDocument();
    expect(within(tiers).getByText("USD 0.05")).toBeInTheDocument();

    await userEvent.click(screen.getByText("Price calculator"));
    await userEvent.type(screen.getByLabelText("Quantity in a month"), "1500");
    await userEvent.click(screen.getByRole("button", { name: "Calculate" }));
    expect(await screen.findByText("$174.00")).toBeInTheDocument();
  });

  it("catches tier mistakes locally, before any request", async () => {
    const api = mockApi({ "GET /plans": () => ({ body: [] }) });
    render(<PlansPage />);
    const dialog = await openNewPlan();
    await userEvent.type(within(dialog).getByLabelText("Name"), "Starter");
    await userEvent.click(within(dialog).getByRole("button", { name: "Add tier" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Add tier" }));
    await userEvent.type(within(dialog).getByLabelText("Tier 1 up to"), "1000");
    await userEvent.type(within(dialog).getByLabelText("Tier 1 price per unit"), "0.1");
    await userEvent.type(within(dialog).getByLabelText("Tier 2 up to"), "500"); // not ascending
    await userEvent.type(within(dialog).getByLabelText("Tier 2 price per unit"), "0.05");
    await userEvent.type(within(dialog).getByLabelText("Tier 3 price per unit"), "0.01");
    await userEvent.click(within(dialog).getByRole("button", { name: "Create plan" }));
    expect(within(dialog).getByText(/Must be greater than the previous tier/)).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Tier 2 up to")).toHaveAttribute("aria-invalid", "true");
    expect(api.count("POST /plans")).toBe(0);
  });

  it("creates a plan and closes the dialog", async () => {
    let list: unknown[] = [];
    mockApi({
      "GET /plans": () => ({ body: list }),
      "POST /plans": (b) => {
        list = [{ ...plan, name: (b as { name: string }).name }];
        return { status: 201, body: list[0] };
      },
    });
    render(<PlansPage />);
    const dialog = await openNewPlan();
    await userEvent.type(within(dialog).getByLabelText("Name"), "Pro");
    await userEvent.type(within(dialog).getByLabelText("Tier 1 price per unit"), "0.1");
    await userEvent.click(within(dialog).getByRole("button", { name: "Create plan" }));
    expect(await screen.findByText("Created plan “Pro”.")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows a server rejection at the right field, with a next step", async () => {
    mockApi({
      "GET /plans": () => ({ body: [] }),
      "POST /plans": () => apiError(409, "plan_name_taken", "A plan named 'Pro' already exists", "name"),
    });
    render(<PlansPage />);
    const dialog = await openNewPlan();
    await userEvent.type(within(dialog).getByLabelText("Name"), "Pro");
    await userEvent.type(within(dialog).getByLabelText("Tier 1 price per unit"), "0.1");
    await userEvent.click(within(dialog).getByRole("button", { name: "Create plan" }));
    expect(await within(dialog).findByText("That plan name is already taken")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Name")).toHaveAttribute("aria-invalid", "true");
    expect(within(dialog).getByText(/Choose a different name/)).toBeInTheDocument();
  });

  it("maps server validation details onto tier fields", async () => {
    mockApi({
      "GET /plans": () => ({ body: [] }),
      "POST /plans": () =>
        apiError(422, "validation_error", "Invalid", null, [{ field: "tiers.0.unit_price", message: "Input should be greater than or equal to 0" }]),
    });
    render(<PlansPage />);
    const dialog = await openNewPlan();
    await userEvent.type(within(dialog).getByLabelText("Name"), "X");
    await userEvent.type(within(dialog).getByLabelText("Tier 1 price per unit"), "1");
    await userEvent.click(within(dialog).getByRole("button", { name: "Create plan" }));
    expect(await within(dialog).findByText(/greater than or equal to 0/)).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Tier 1 price per unit")).toHaveAttribute("aria-invalid", "true");
  });

  describe("edit and delete", () => {
    it("edits a plan with the form prefilled and sends a PUT", async () => {
      let current = plan;
      const api = mockApi({
        "GET /plans": () => ({ body: [current] }),
        "PUT /plans/p1": (b) => {
          current = { ...plan, name: (b as { name: string }).name };
          return { body: current };
        },
      });
      render(<PlansPage />);
      await openMenu("Edit");
      const dialog = screen.getByRole("dialog", { name: "Edit Pro" });
      expect(within(dialog).getByLabelText("Tier 1 up to")).toHaveValue("1000");
      expect(within(dialog).getByLabelText("Tier 1 price per unit")).toHaveValue("0.10");
      expect(within(dialog).getByLabelText("Tier 2 up to")).toBeDisabled();

      await userEvent.clear(within(dialog).getByLabelText("Name"));
      await userEvent.type(within(dialog).getByLabelText("Name"), "Pro v2");
      await userEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));
      expect(await screen.findByRole("table", { name: "Pro v2 tiers" })).toBeInTheDocument();
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(api.calls.find((c) => c.key === "PUT /plans/p1")?.body).toEqual({
        name: "Pro v2", currency: "USD", base_fee: "49.00",
        tiers: [{ up_to: "1000", unit_price: "0.10" }, { up_to: null, unit_price: "0.05" }],
      });
    });

    it("explains that a plan in use can't change pricing, and keeps the dialog open", async () => {
      mockApi({
        "GET /plans": () => ({ body: [plan] }),
        "PUT /plans/p1": () => apiError(409, "plan_in_use", "3 subscriptions use this plan, so its pricing can't change."),
      });
      render(<PlansPage />);
      await openMenu("Edit");
      const dialog = screen.getByRole("dialog", { name: "Edit Pro" });
      await userEvent.clear(within(dialog).getByLabelText("Monthly base fee"));
      await userEvent.type(within(dialog).getByLabelText("Monthly base fee"), "59");
      await userEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));
      expect(await within(dialog).findByText("This plan is in use")).toBeInTheDocument();
      expect(within(dialog).getByText(/3 subscriptions use this plan/)).toBeInTheDocument();
    });

    it("cancel leaves the plan untouched and sends nothing", async () => {
      const api = mockApi({ "GET /plans": () => ({ body: [plan] }) });
      render(<PlansPage />);
      await openMenu("Edit");
      await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(api.count("PUT /plans/p1")).toBe(0);
    });

    it("deletes an unused plan after confirmation, and explains when it's in use", async () => {
      let list = [plan];
      let inUse = true;
      mockApi({
        "GET /plans": () => ({ body: list }),
        "DELETE /plans/p1": () => {
          if (inUse) return apiError(409, "plan_in_use", "1 subscription uses this plan, so it can't be deleted.");
          list = [];
          return { status: 204 };
        },
      });
      render(<PlansPage />);
      await openMenu("Delete");
      await userEvent.click(screen.getByRole("button", { name: "Delete plan" }));
      const dialog = screen.getByRole("dialog");
      expect(await within(dialog).findByText("This plan is in use")).toBeInTheDocument();
      expect(screen.getByRole("table", { name: "Pro tiers" })).toBeInTheDocument();

      inUse = false;
      await userEvent.click(within(dialog).getByRole("button", { name: "Delete plan" }));
      expect(await screen.findByText("No plans yet")).toBeInTheDocument();
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });
});
