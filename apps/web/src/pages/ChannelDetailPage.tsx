import { useCallback, useEffect, useState } from "react";
import type { Channel, QrVersion } from "@qr-lifecycle/contracts";
import {
  ArrowLeft,
  CalendarClock,
  Check,
  Copy,
  ExternalLink,
  History,
  Pencil,
  QrCode,
  Smartphone,
  Trash2,
} from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, ApiError } from "../api/client";
import { ErrorState, LoadingState, PageHeading } from "../components/States";
import { formatDateTime, getChannelStatus } from "../lib/channel-status";

function messageFor(error: unknown): string {
  return error instanceof ApiError ? error.message : "请求失败，请稍后重试。";
}

export function ChannelDetailPage() {
  const { channelId = "" } = useParams();
  const navigate = useNavigate();
  const [channel, setChannel] = useState<Channel | null>(null);
  const [versions, setVersions] = useState<QrVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.all([api.getChannel(channelId), api.listQrVersions(channelId)]).then(
      ([channelResponse, versionsResponse]) => {
        setChannel(channelResponse.channel);
        setVersions(versionsResponse.qrVersions);
        setLoading(false);
      },
      (loadError: unknown) => {
        setError(messageFor(loadError));
        setLoading(false);
      },
    );
  }, [channelId]);

  useEffect(load, [load]);
  const copyPublicUrl = async () => {
    if (!channel) return;
    await navigator.clipboard.writeText(`${api.getApiOrigin()}/q/${channel.slug}`);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  };

  const deleteChannel = async () => {
    if (!channel || !window.confirm(`确定删除“${channel.name}”？历史二维码也会失去访问入口。`)) return;
    try {
      await api.deleteChannel(channel.id);
      navigate("/", { replace: true });
    } catch (deleteError) {
      setError(messageFor(deleteError));
    }
  };

  if (loading) return <div className="page"><LoadingState label="正在读取频道…" /></div>;
  if (error || !channel) return <div className="page"><ErrorState message={error ?? "频道不存在。"} onRetry={load} /></div>;

  const status = getChannelStatus(channel);
  const publicUrl = `${api.getApiOrigin()}/q/${channel.slug}`;

  return (
    <div className="page">
      <Link className="back-link" to="/"><ArrowLeft size={16} /> 返回工作台</Link>
      <PageHeading
        eyebrow="频道详情"
        title={channel.name}
        description={publicUrl}
        action={
          <div className="button-group">
            <button className="button button--secondary" type="button" onClick={() => void copyPublicUrl()}>
              {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? "已复制" : "复制入口"}
            </button>
            <Link className="button button--primary" to={`/channels/${channel.id}/edit`}><Pencil size={16} /> 编辑</Link>
          </div>
        }
      />

      <section className="detail-grid">
        <article className="current-qr-card">
          <div className="card-heading">
            <div><p className="eyebrow">当前公开版本</p><h2>有效二维码</h2></div>
            <span className={`status-badge status-badge--${status.tone}`}><i />{status.label}</span>
          </div>
          <div className={`qr-preview${channel.activeQrVersionId ? "" : " qr-preview--empty"}`}>
            {channel.activeQrVersionId ? (
              <img
                src={`${api.getApiOrigin()}/q/${channel.slug}/image?v=${channel.activeQrVersionId}`}
                alt={`${channel.name} 当前二维码`}
              />
            ) : (
              <><QrCode size={54} /><strong>还没有二维码</strong><span>打开手机 App 保存群码，系统会自动创建当前版本</span></>
            )}
          </div>
          <dl className="detail-list">
            <div><dt><CalendarClock size={15} /> 到期时间</dt><dd>{formatDateTime(channel.expiresAt)}</dd></div>
            <div><dt><History size={15} /> 版本数量</dt><dd>{versions.length} 个</dd></div>
          </dl>
          <a className="button button--ghost button--wide" href={publicUrl} target="_blank" rel="noreferrer">
            查看公开页面 <ExternalLink size={15} />
          </a>
        </article>

        <article className="upload-card mobile-automation-card">
          <div className="card-heading">
            <div><p className="eyebrow">手机自动维护</p><h2>在相册中完成更新</h2></div>
            <Smartphone size={22} />
          </div>
          <div className="automation-steps">
            <p><strong>1</strong><span>在微信、小红书或 Discord 中保存新二维码。</span></p>
            <p><strong>2</strong><span>回到 Fallinlife，App 会在本机自动识别名称和到期时间。</span></p>
            <p><strong>3</strong><span>高置信度结果直接更新；不确定的结果只需点一次确认。</span></p>
          </div>
          <p className="upload-card__hint"><Smartphone size={14} /> Web 仅用于查看、纠错和运维，不会读取或分析你的图片。</p>
          <p className="upload-card__hint">需要授权其他浏览器时，请在手机 App 的“设置”中扫描新绑定码。</p>
        </article>
      </section>

      <section className="history-card">
        <div className="section-heading"><div><p className="eyebrow">留痕</p><h2>二维码历史</h2></div><span>{versions.length} 个版本</span></div>
        {versions.length === 0 ? (
          <div className="history-empty"><History size={22} /><span>手机自动发现并启用群码后，会在这里保留版本记录。</span></div>
        ) : (
          <div className="history-list">
            {versions.map((version, index) => (
              <div className="history-row" key={version.id}>
                <span className="history-row__index">{String(versions.length - index).padStart(2, "0")}</span>
                <div><strong>{version.id === channel.activeQrVersionId ? "当前启用版本" : "历史版本"}</strong><small>{formatDateTime(version.activatedAt)}</small></div>
                <code>{version.decodedPayloadHash.slice(0, 12)}…</code>
                {version.id === channel.activeQrVersionId ? <span className="status-badge status-badge--success"><i />使用中</span> : null}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="danger-zone">
        <div><strong>删除频道</strong><p>公开地址与版本历史将不再可用。此操作无法从管理端撤销。</p></div>
        <button className="button button--danger button--small" type="button" onClick={() => void deleteChannel()}><Trash2 size={15} /> 删除</button>
      </section>
    </div>
  );
}
