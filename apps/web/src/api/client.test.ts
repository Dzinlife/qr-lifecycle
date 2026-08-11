import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "./client";

describe("api client", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("adds the bearer token to authenticated requests", async () => {
    api.setSessionToken("test-session");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ channels: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await api.listChannels();

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer test-session");
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
