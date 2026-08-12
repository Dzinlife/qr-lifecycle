import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DashboardPage } from "./DashboardPage";

const { listChannels } = vi.hoisted(() => ({ listChannels: vi.fn() }));

vi.mock("../api/client", () => ({
  api: {
    listChannels,
    getApiOrigin: () => "https://qr.example.com",
  },
  ApiError: class ApiError extends Error {},
}));

describe("DashboardPage", () => {
  beforeEach(() => {
    listChannels.mockReset();
  });

  it("shows a useful empty state", async () => {
    listChannels.mockResolvedValue({ channels: [] });
    render(<MemoryRouter><DashboardPage /></MemoryRouter>);

    expect(await screen.findByRole("heading", { name: "从手机自动发现第一个群码" })).toBeTruthy();
    expect(screen.getByRole<HTMLAnchorElement>("link", { name: /连接手机/ }).getAttribute("href")).toBe("/pairing");
  });
});
