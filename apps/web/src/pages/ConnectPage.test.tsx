import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConnectPage } from "./ConnectPage";

const {
  consumeWebBinding,
  createWebBinding,
  getWebBindingStatus,
  toDataURL,
} = vi.hoisted(() => ({
  consumeWebBinding: vi.fn(),
  createWebBinding: vi.fn(),
  getWebBindingStatus: vi.fn(),
  toDataURL: vi.fn(),
}));

vi.mock("qrcode", () => ({ default: { toDataURL } }));
vi.mock("../api/client", () => ({
  api: { consumeWebBinding, createWebBinding, getWebBindingStatus },
  ApiError: class ApiError extends Error {},
}));

describe("ConnectPage", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    createWebBinding.mockReset().mockResolvedValue({
      binding: {
        id: "10000000-0000-4000-8000-000000000001",
        challenge: "challenge".repeat(4),
        qrValue: "qrlifecycle://web-bind/test",
        expiresAt: "2026-08-12T05:00:00.000Z",
      },
      browserSecret: "browser-secret",
    });
    toDataURL.mockReset().mockResolvedValue("data:image/png;base64,test");
    getWebBindingStatus.mockReset().mockResolvedValue({
      status: "approved",
      expiresAt: "2026-08-12T05:00:00.000Z",
    });
    consumeWebBinding.mockReset().mockResolvedValue({ connected: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("continues into the authenticated app after consuming an approved binding", async () => {
    const onAuthenticated = vi.fn().mockResolvedValue(undefined);
    render(<ConnectPage onAuthenticated={onAuthenticated} />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByRole("img", { name: /一次性二维码/ })).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(consumeWebBinding).toHaveBeenCalledTimes(1);
    expect(onAuthenticated).toHaveBeenCalledTimes(1);
  });
});
