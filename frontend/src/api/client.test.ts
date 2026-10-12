import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, NetworkError, api } from "./client";

function respond(status: number, body: unknown) {
  return vi.fn().mockResolvedValue(new Response(body === undefined ? "" : JSON.stringify(body), { status }));
}

afterEach(() => vi.unstubAllGlobals());

describe("api client", () => {
  it("returns data and status, so 201 vs 200 is visible", async () => {
    const fetchMock = respond(200, { id: "u1", duplicate: true });
    vi.stubGlobal("fetch", fetchMock);
    const r = await api.recordUsage({ customer_id: "c1", quantity: "5", occurred_at: "2025-09-16T00:00:00Z", idempotency_key: "k" });
    expect(r.status).toBe(200);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/usage");
    expect(fetchMock.mock.calls[0][1].method).toBe("POST");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).idempotency_key).toBe("k");
  });

  it("throws a structured ApiError from the error body", async () => {
    vi.stubGlobal("fetch", respond(409, { error: { code: "billing_period_closed", message: "closed", field: null, details: [] } }));
    const err = await api.listCustomers().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe("billing_period_closed");
    expect((err as ApiError).status).toBe(409);
  });

  it("turns a non-JSON error page into unexpected_response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>Bad Gateway</html>", { status: 502 })));
    const err = await api.listCustomers().catch((e: unknown) => e);
    expect((err as ApiError).code).toBe("unexpected_response");
    expect((err as ApiError).status).toBe(502);
  });

  it("turns a failed fetch into NetworkError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(api.listCustomers()).rejects.toBeInstanceOf(NetworkError);
  });
});
