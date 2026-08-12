import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "./client";

describe("api client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses cookie credentials without exposing a bearer token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ channels: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await api.listChannels();

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.credentials).toBe("include");
    expect(new Headers(init.headers).has("Authorization")).toBe(false);
  });

  it("keeps the binding secret in a request header", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: "pending", expiresAt: new Date().toISOString() }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await api.getWebBindingStatus("binding-id", "browser-secret");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).not.toContain("browser-secret");
    expect(new Headers(init.headers).get("X-Binding-Secret")).toBe("browser-secret");
  });

  it("surfaces the API error envelope", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { code: "slug_taken", message: "地址已被占用" } }), {
          status: 409,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    await expect(api.listChannels()).rejects.toMatchObject({
      code: "slug_taken",
      status: 409,
      message: "地址已被占用",
    } satisfies Partial<ApiError>);
  });
});
