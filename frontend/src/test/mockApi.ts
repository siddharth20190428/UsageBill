import { vi } from "vitest";

type Handler = (body: unknown, url: string) => { status?: number; body?: unknown } | Promise<{ status?: number; body?: unknown }>;

/** Route table keyed "METHOD /path" (path without the /api prefix and without the query string). */
export function mockApi(routes: Record<string, Handler>) {
  const calls: { key: string; body: unknown }[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input).replace(/^\/api/, "");
    const key = `${init?.method ?? "GET"} ${url.split("?")[0]}`;
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ key, body });
    const handler = routes[key];
    if (!handler) return new Response(JSON.stringify({ error: { code: "not_found", message: `no mock for ${key}` } }), { status: 404 });
    const r = await handler(body, url);
    return new Response(r.body === undefined ? "" : JSON.stringify(r.body), { status: r.status ?? 200 });
  });
  vi.stubGlobal("fetch", fn);
  return { calls, count: (key: string) => calls.filter((c) => c.key === key).length };
}

export const apiError = (status: number, code: string, message: string, field: string | null = null, details: unknown[] = []) => ({
  status,
  body: { error: { code, message, field, details } },
});
