import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ChannelDetailPage } from "./ChannelDetailPage";

const { deleteChannel, getChannel, listQrVersions } = vi.hoisted(() => ({
  deleteChannel: vi.fn(),
  getChannel: vi.fn(),
  listQrVersions: vi.fn(),
}));

vi.mock("../api/client", () => ({
  api: {
    deleteChannel,
    getApiOrigin: () => "https://qr.example.com",
    getChannel,
    listQrVersions,
  },
  ApiError: class ApiError extends Error {},
}));

const channel = {
  id: "10000000-0000-4000-8000-000000000001",
  accountId: "10000000-0000-4000-8000-000000000002",
  name: "Scripod",
  platform: "xiaohongshu_group" as const,
  slug: "scripod-group",
  expiresAt: "2026-09-09T23:59:59.000Z",
  remindBeforeMinutes: 1_440,
  activeQrVersionId: "10000000-0000-4000-8000-000000000003",
  disabledAt: null,
  createdAt: "2026-08-12T00:00:00.000Z",
  updatedAt: "2026-08-12T00:00:00.000Z",
};

describe("ChannelDetailPage", () => {
  beforeEach(() => {
    getChannel.mockReset().mockResolvedValue({ channel });
    listQrVersions.mockReset().mockResolvedValue({ qrVersions: [] });
    deleteChannel.mockReset();
  });

  it("keeps the permanent relay QR and current native image as separate actions", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator.clipboard, "writeText", {
      configurable: true,
      value: writeText,
    });
    render(
      <MemoryRouter initialEntries={[`/channels/${channel.id}`]}>
        <Routes>
          <Route path="/channels/:channelId" element={<ChannelDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: "永久中转码" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "当前原生群码" })).toBeTruthy();

    const relayImage = screen.getByRole("img", { name: "Scripod 永久中转二维码" });
    expect(relayImage.getAttribute("src")).toBe(
      "https://qr.example.com/q/scripod-group/relay.png",
    );
    const currentImage = screen.getByRole("img", { name: "Scripod 当前二维码" });
    expect(currentImage.getAttribute("src")).toBe(
      "https://qr.example.com/q/scripod-group/image",
    );

    const download = screen.getByRole("link", { name: /保存中转码/ });
    expect(download.getAttribute("download")).toBe("scripod-group-permanent-qr.png");
    await user.click(screen.getByRole("button", { name: /复制永久地址/ }));
    expect(writeText).toHaveBeenCalledWith(
      "https://qr.example.com/q/scripod-group",
    );
  });
});
