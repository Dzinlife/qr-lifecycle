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

    expect(await screen.findByRole("heading", { name: "建立第一个长期入口" })).toBeTruthy();
    expect(screen.getAllByRole<HTMLAnchorElement>("link", { name: /新增频道/ })[0]?.getAttribute("href")).toBe("/channels/new");
  });
});
