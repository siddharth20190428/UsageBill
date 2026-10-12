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
});
