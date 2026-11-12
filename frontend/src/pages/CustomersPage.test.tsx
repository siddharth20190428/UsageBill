import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiError, mockApi } from "../test/mockApi";
import { CustomersPage } from "./CustomersPage";

const renderPage = () => render(<MemoryRouter><CustomersPage /></MemoryRouter>);
afterEach(() => vi.unstubAllGlobals());

describe("CustomersPage", () => {
  it("shows an empty state, then the customer after creating one", async () => {
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
    await userEvent.type(screen.getByLabelText("Name"), "Acme");
    await userEvent.click(screen.getByRole("button", { name: "Create customer" }));
    expect(await screen.findByRole("link", { name: "Acme" })).toHaveAttribute("href", "/customers/c1");
    expect(screen.getByText("Created “Acme”.")).toBeInTheDocument();
    expect(api.count("POST /customers")).toBe(1);
  });

  it("blocks a blank name on the client without calling the server", async () => {
    const api = mockApi({ "GET /customers": () => ({ body: [] }) });
    renderPage();
    await screen.findByText("No customers yet");
    await userEvent.type(screen.getByLabelText("Name"), "   ");
    await userEvent.click(screen.getByRole("button", { name: "Create customer" }));
    expect(screen.getByText("Enter a customer name.")).toBeInTheDocument();
    expect(api.count("POST /customers")).toBe(0);
  });

  it("explains a failed load and retries", async () => {
    let up = false;
    mockApi({
      "GET /customers": () => (up ? { body: [{ id: "c1", name: "Acme", created_at: "2025-09-16T00:00:00Z" }] } : apiError(503, "unexpected", "down")),
    });
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("down");
    up = true;
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("link", { name: "Acme" })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });

  it("says plainly when the server can't be reached", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    renderPage();
    expect(await screen.findByText("Can't reach the server")).toBeInTheDocument();
    expect(screen.getByText(/uvicorn/)).toBeInTheDocument();
  });

  describe("edit and delete", () => {
    const acme = { id: "c1", name: "Acme", created_at: "2025-09-16T00:00:00Z" };

    it("renames a customer inline", async () => {
      let current = acme;
      const api = mockApi({
        "GET /customers": () => ({ body: [current] }),
        "PATCH /customers/c1": (b) => {
          current = { ...acme, name: (b as { name: string }).name };
          return { body: current };
        },
      });
      renderPage();
      await userEvent.click(await screen.findByRole("button", { name: "Edit Acme" }));
      const input = screen.getByLabelText("Name", { selector: "#rename-c1" });
      expect(input).toHaveValue("Acme");
      await userEvent.clear(input);
      await userEvent.type(input, "Acme Corp");
      await userEvent.click(screen.getByRole("button", { name: "Save" }));
      expect(await screen.findByRole("link", { name: "Acme Corp" })).toBeInTheDocument();
      expect(api.calls.find((c) => c.key === "PATCH /customers/c1")?.body).toEqual({ name: "Acme Corp" });
    });

    it("won't save a blank name", async () => {
      const api = mockApi({ "GET /customers": () => ({ body: [acme] }) });
      renderPage();
      await userEvent.click(await screen.findByRole("button", { name: "Edit Acme" }));
      await userEvent.clear(screen.getByLabelText("Name", { selector: "#rename-c1" }));
      await userEvent.click(screen.getByRole("button", { name: "Save" }));
      expect(screen.getByText("Enter a customer name.")).toBeInTheDocument();
      expect(api.count("PATCH /customers/c1")).toBe(0);
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
      await userEvent.click(await screen.findByRole("button", { name: "Delete Acme" }));
      expect(screen.getByText(/This can't be undone/)).toBeInTheDocument();
      expect(api.count("DELETE /customers/c1")).toBe(0);

      await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(screen.queryByText(/This can't be undone/)).not.toBeInTheDocument();
      expect(api.count("DELETE /customers/c1")).toBe(0);

      await userEvent.click(screen.getByRole("button", { name: "Delete Acme" }));
      await userEvent.click(screen.getByRole("button", { name: "Yes, delete" }));
      expect(await screen.findByText("No customers yet")).toBeInTheDocument();
      expect(api.count("DELETE /customers/c1")).toBe(1);
    });

    it("explains why an invoiced customer can't be deleted and keeps the row", async () => {
      mockApi({
        "GET /customers": () => ({ body: [acme] }),
        "DELETE /customers/c1": () => apiError(409, "customer_has_invoices", "This customer has 2 invoices, which are permanent billing records."),
      });
      renderPage();
      await userEvent.click(await screen.findByRole("button", { name: "Delete Acme" }));
      await userEvent.click(screen.getByRole("button", { name: "Yes, delete" }));
      expect(await screen.findByText("This customer has been invoiced")).toBeInTheDocument();
      expect(screen.getByText(/2 invoices/)).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Acme" })).toBeInTheDocument();
    });
  });
});
