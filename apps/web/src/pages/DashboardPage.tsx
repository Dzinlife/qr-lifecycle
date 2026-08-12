import { useCallback, useEffect, useMemo, useState } from "react";
import type { Channel, ChannelPlatform } from "@qr-lifecycle/contracts";
import {
  AlertTriangle,
  ArrowUpRight,
  Check,
  Clock3,
  Copy,
  Disc3,
  Hash,
  MessageCircle,
  QrCode,
  Shapes,
} from "lucide-react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../api/client";
import { EmptyState, ErrorState, LoadingState, PageHeading } from "../components/States";
import { formatDateTime, getChannelStatus } from "../lib/channel-status";

const platformDetails: Record<ChannelPlatform, { label: string; className: string; icon: typeof MessageCircle }> = {
  wechat_group: { label: "微信群", className: "platform--wechat", icon: MessageCircle },
  xiaohongshu_group: { label: "小红书群", className: "platform--red", icon: Shapes },
  discord: { label: "Discord", className: "platform--discord", icon: Disc3 },
  other: { label: "其他", className: "platform--other", icon: Hash },
};

function getErrorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "频道列表加载失败。";
}

export function DashboardPage() {
  const [channels, setChannels] = useState<Channel[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const loadChannels = useCallback(() => {
    setError(null);
    api.listChannels().then(
      ({ channels: nextChannels }) => setChannels(nextChannels),
      (loadError: unknown) => setError(getErrorMessage(loadError)),
    );
  }, []);

  useEffect(loadChannels, [loadChannels]);

  const sortedChannels = useMemo(
    () => [...(channels ?? [])].sort((a, b) => getChannelStatus(a).sortOrder - getChannelStatus(b).sortOrder),
    [channels],
  );
  const needsAttention = (channels ?? []).filter((channel) => getChannelStatus(channel).sortOrder <= 2).length;
  const healthy = (channels ?? []).filter((channel) => getChannelStatus(channel).tone === "success").length;

  const copyUrl = async (channel: Channel) => {
    const imageUrl = `${api.getApiOrigin()}/q/${channel.slug}/image`;
    await navigator.clipboard.writeText(imageUrl);
    setCopiedId(channel.id);
    window.setTimeout(() => setCopiedId(null), 1_600);
  };

  return (
    <div className="page page--dashboard">
      <PageHeading
        eyebrow="社群入口"
        title="频道状态"
        description="群码由手机 App 从相册自动发现；复制固定图片地址挂到网站，更新后 URL 不变。"
      />

      {channels && channels.length > 0 ? (
        <section className="stats-row" aria-label="频道概览">
          <div className="stat-card">
            <span className="stat-card__icon stat-card__icon--ink"><QrCode size={19} /></span>
            <div><strong>{channels.length}</strong><span>全部频道</span></div>
          </div>
          <div className="stat-card">
            <span className="stat-card__icon stat-card__icon--good"><Check size={19} /></span>
            <div><strong>{healthy}</strong><span>入口正常</span></div>
          </div>
          <div className="stat-card">
            <span className="stat-card__icon stat-card__icon--warn"><AlertTriangle size={19} /></span>
            <div><strong>{needsAttention}</strong><span>需要处理</span></div>
          </div>
        </section>
      ) : null}

      {channels === null && !error ? <LoadingState label="正在整理频道…" /> : null}
      {error ? <ErrorState message={error} onRetry={loadChannels} /> : null}
      {channels?.length === 0 ? (
        <EmptyState
          title="从手机自动发现第一个群码"
          description="在手机中保存微信群、小红书群或 Discord 二维码，再打开 Fallinlife。App 会自动识别、创建频道并生成稳定入口。"
        />
      ) : null}

      {sortedChannels.length > 0 ? (
        <section className="channel-section">
          <div className="section-heading">
            <h2>频道</h2>
            <span>按需要处理的优先级排列</span>
          </div>
          <div className="channel-grid">
            {sortedChannels.map((channel) => {
              const platform = platformDetails[channel.platform];
              const status = getChannelStatus(channel);
              const PlatformIcon = platform.icon;
              return (
                <article className="channel-card" key={channel.id}>
                  <div className="channel-card__top">
                    <span className={`platform-icon ${platform.className}`}><PlatformIcon size={20} /></span>
                    <span className={`status-badge status-badge--${status.tone}`}><i />{status.label}</span>
                  </div>
                  <div className="channel-card__body">
                    <span className="platform-label">{platform.label}</span>
                    <h3><Link to={`/channels/${channel.id}`}>{channel.name}</Link></h3>
                    <p className="channel-card__slug">{api.getApiOrigin().replace(/^https?:\/\//, "")}/q/{channel.slug}/image</p>
                  </div>
                  <div className="channel-card__meta">
                    <Clock3 size={15} />
                    <span>{status.detail}</span>
                    {channel.expiresAt ? <time>{formatDateTime(channel.expiresAt)}</time> : null}
                  </div>
                  <div className="channel-card__actions">
                    <button className="button button--ghost button--small" type="button" onClick={() => void copyUrl(channel)}>
                      {copiedId === channel.id ? <Check size={15} /> : <Copy size={15} />}
                      {copiedId === channel.id ? "已复制" : "复制图片地址"}
                    </button>
                    <Link className="button button--secondary button--small" to={`/channels/${channel.id}`}>
                      管理 <ArrowUpRight size={15} />
                    </Link>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}
