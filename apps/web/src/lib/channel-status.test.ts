import type { Channel } from "@qr-lifecycle/contracts";
import { describe, expect, it } from "vitest";
import { getChannelStatus } from "./channel-status";

const baseChannel: Channel = {
  id: "11111111-1111-4111-8111-111111111111",
  tenantId: "22222222-2222-4222-8222-222222222222",
  name: "产品交流群",
  platform: "wechat_group",
  slug: "product-group",
  expiresAt: "2026-08-15T12:00:00.000Z",
  remindBeforeMinutes: 1_440,
  activeQrVersionId: "33333333-3333-4333-8333-333333333333",
  disabledAt: null,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

describe("getChannelStatus", () => {
  const now = new Date("2026-08-15T00:00:00.000Z");

  it("prioritizes channels without a QR version", () => {
    expect(getChannelStatus({ ...baseChannel, activeQrVersionId: null }, now)).toMatchObject({
      label: "待上传",
      tone: "warning",
      sortOrder: 0,
    });
  });

  it("marks a channel inside its reminder window", () => {
    expect(getChannelStatus(baseChannel, now)).toMatchObject({
      label: "即将到期",
      detail: "12 小时后到期",
      tone: "warning",
    });
  });

  it("marks an expired channel", () => {
    expect(
      getChannelStatus({ ...baseChannel, expiresAt: "2026-08-14T00:00:00.000Z" }, now),
    ).toMatchObject({ label: "已到期", tone: "danger", sortOrder: 1 });
  });
});
