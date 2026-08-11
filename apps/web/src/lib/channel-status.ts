import type { Channel } from "@qr-lifecycle/contracts";

export type ChannelStatusTone = "muted" | "danger" | "warning" | "success";

export interface ChannelStatus {
  label: string;
  detail: string;
  tone: ChannelStatusTone;
  sortOrder: number;
}

const rtf = new Intl.RelativeTimeFormat("zh-CN", { numeric: "auto" });

export function getChannelStatus(channel: Channel, now = new Date()): ChannelStatus {
  if (channel.disabledAt) {
    return { label: "已停用", detail: "公开入口不可用", tone: "muted", sortOrder: 4 };
  }
  if (!channel.activeQrVersionId) {
    return { label: "待上传", detail: "还没有二维码", tone: "warning", sortOrder: 0 };
  }
  if (!channel.expiresAt) {
    return { label: "正常", detail: "未设置到期时间", tone: "success", sortOrder: 3 };
  }

  const deltaMinutes = Math.round((new Date(channel.expiresAt).getTime() - now.getTime()) / 60_000);
  if (deltaMinutes <= 0) {
    const days = Math.max(-30, Math.ceil(deltaMinutes / 1_440));
    return { label: "已到期", detail: rtf.format(days, "day"), tone: "danger", sortOrder: 1 };
  }

  if (deltaMinutes <= channel.remindBeforeMinutes) {
    const hours = Math.max(1, Math.ceil(deltaMinutes / 60));
    const detail = hours < 24 ? `${hours} 小时后到期` : `${Math.ceil(hours / 24)} 天后到期`;
    return { label: "即将到期", detail, tone: "warning", sortOrder: 2 };
  }

  const days = Math.max(1, Math.ceil(deltaMinutes / 1_440));
  return { label: "正常", detail: `${days} 天后到期`, tone: "success", sortOrder: 3 };
}

export function formatDateTime(value: string | null): string {
  if (!value) return "未设置";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
