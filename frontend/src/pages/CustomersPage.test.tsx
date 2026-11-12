import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiError, mockApi } from "../test/mockApi";
import { CustomersPage } from "./CustomersPage";

const renderPage = () => render(<MemoryRouter><CustomersPage /></MemoryRouter>);
afterEach(() => vi.unstubAllGlobals());

const acme = { id: "c1", name: "Acme", created_at: "2025-09-16T00:00:00Z" };

async function openMenu(name: string, item: string) {
  await userEvent.click(await screen.findByRole("button", { name: `Actions for ${name}` }));
  await userEvent.click(screen.getByRole("menuitem", { name: item }));
}

describe("CustomersPage", () => {
  it("shows an empty state, then the customer after creating one in the dialog", async () => {
    let list: unknown[] = [];
    const api = mockApi({
      "GET /customers": () => ({ body: list }),
      "POST /customers": (b) => {
        const c = { id: "c1", name: (b as { name: string }).name, created_at: "2025-09-16T00:00:00Z" };
        list = [c];
        return { status: 201, body: c };
      },
    });
    renderPage();
    expect(await screen.findByText("No customers yet")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "New customer" }));
    const dialog = screen.getByRole("dialog", { name: "New customer" });
    await userEvent.type(within(dialog).getByLabelText("Name"), "Acme");
    await userEvent.click(within(dialog).getByRole("button", { name: "Create customer" }));
    expect(await screen.findByRole("link", { name: /Acme/ })).toHaveAttribute("href", "/customers/c1");
    expect(screen.getByText("Created “Acme”.")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(api.count("POST /customers")).toBe(1);
  });

  it("blocks a blank name on the client without calling the server", async () => {
    const api = mockApi({ "GET /customers": () => ({ body: [] }) });
    renderPage();
    await screen.findByText("No customers yet");
    await userEvent.click(screen.getByRole("button", { name: "New customer" }));
    const dialog = screen.getByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText("Name"), "   ");
    await userEvent.click(within(dialog).getByRole("button", { name: "Create customer" }));
    expect(within(dialog).getByText("Enter a customer name.")).toBeInTheDocument();
    expect(api.count("POST /customers")).toBe(0);
  });

  it("closes the dialog with Escape and Cancel, sending nothing", async () => {
    const api = mockApi({ "GET /customers": () => ({ body: [] }) });
    renderPage();
    await screen.findByText("No customers yet");
    await userEvent.click(screen.getByRole("button", { name: "New customer" }));
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "New customer" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(api.count("POST /customers")).toBe(0);
  });

  it("explains a failed load and retries", async () => {
    let up = false;
    mockApi({
      "GET /customers": () => (up ? { body: [acme] } : apiError(503, "unexpected", "down")),
    });
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("down");
    up = true;
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("link", { name: /Acme/ })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });

  it("says plainly when the server can't be reached", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    renderPage();
    expect(await screen.findByText("Can't reach the server")).toBeInTheDocument();
    expect(screen.getByText(/uvicorn/)).toBeInTheDocument();
  });

  describe("row actions", () => {
    it("keeps Edit and Delete out of sight until the row menu is opened", async () => {
      mockApi({ "GET /customers": () => ({ body: [acme] }) });
      renderPage();
      await screen.findByRole("link", { name: /Acme/ });
      expect(screen.queryByRole("menuitem")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^Delete/ })).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "Actions for Acme" }));
      expect(screen.getByRole("menuitem", { name: "Rename" })).toBeInTheDocument();
      expect(screen.getByRole("menuitem", { name: "Delete" })).toBeInTheDocument();
      await userEvent.keyboard("{Escape}");
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Actions for Acme" })).toHaveFocus();
    });

    it("renames a customer in a dialog", async () => {
      let current = acme;
      const api = mockApi({
        "GET /customers": () => ({ body: [current] }),
        "PATCH /customers/c1": (b) => {
          current = { ...acme, name: (b as { name: string }).name };
          return { body: current };
        },
      });
      renderPage();
      await openMenu("Acme", "Rename");
      const dialog = screen.getByRole("dialog", { name: "Rename customer" });
      const input = within(dialog).getByLabelText("Name");
      expect(input).toHaveValue("Acme");
      await userEvent.clear(input);
      await userEvent.type(input, "Acme Corp");
      await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
      expect(await screen.findByRole("link", { name: /Acme Corp/ })).toBeInTheDocument();
      expect(api.calls.find((c) => c.key === "PATCH /customers/c1")?.body).toEqual({ name: "Acme Corp" });
    });

    it("asks before deleting, and sends nothing until confirmed", async () => {
      let list = [acme];
      const api = mockApi({
        "GET /customers": () => ({ body: list }),
        "DELETE /customers/c1": () => {
          list = [];
          return { status: 204 };
        },
      });
      renderPage();
      await openMenu("Acme", "Delete");
      expect(screen.getByRole("dialog", { name: "Delete customer?" })).toBeInTheDocument();
      expect(api.count("DELETE /customers/c1")).toBe(0);

      await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(api.count("DELETE /customers/c1")).toBe(0);

      await openMenu("Acme", "Delete");
      await userEvent.click(screen.getByRole("button", { name: "Delete customer" }));
      expect(await screen.findByText("No customers yet")).toBeInTheDocument();
      expect(api.count("DELETE /customers/c1")).toBe(1);
      expect(screen.getByText("Deleted “Acme”.")).toBeInTheDocument();
    });

    it("explains why an invoiced customer can't be deleted, in the dialog, and keeps the row", async () => {
      mockApi({
        "GET /customers": () => ({ body: [acme] }),
        "DELETE /customers/c1": () => apiError(409, "customer_has_invoices", "This customer has 2 invoices, which are permanent billing records."),
      });
      renderPage();
      await openMenu("Acme", "Delete");
      await userEvent.click(screen.getByRole("button", { name: "Delete customer" }));
      const dialog = screen.getByRole("dialog");
      expect(await within(dialog).findByText("This customer has been invoiced")).toBeInTheDocument();
      expect(within(dialog).getByText(/2 invoices/)).toBeInTheDocument();
      await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
      expect(screen.getByRole("link", { name: /Acme/ })).toBeInTheDocument();
    });
  });
});
