import { useEffect, useState, type FormEvent } from "react";
import type { ChannelPlatform, CreateChannelInput } from "@qr-lifecycle/contracts";
import {
  ArrowLeft,
  Check,
  Disc3,
  Hash,
  LoaderCircle,
  MessageCircle,
  Shapes,
} from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, ApiError } from "../api/client";
import { ErrorState, LoadingState, PageHeading } from "../components/States";

const platforms: Array<{
  value: ChannelPlatform;
  label: string;
  description: string;
  icon: typeof MessageCircle;
  className: string;
}> = [
  { value: "wechat_group", label: "微信群", description: "群聊邀请二维码", icon: MessageCircle, className: "platform--wechat" },
  { value: "xiaohongshu_group", label: "小红书群", description: "群聊或社群二维码", icon: Shapes, className: "platform--red" },
  { value: "discord", label: "Discord", description: "服务器邀请入口", icon: Disc3, className: "platform--discord" },
  { value: "other", label: "其他", description: "任何二维码入口", icon: Hash, className: "platform--other" },
];

function toLocalDateTime(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function suggestedSlug(): string {
  return `group-${Date.now().toString(36).slice(-6)}`;
}

function messageFor(error: unknown): string {
  return error instanceof ApiError ? error.message : "保存失败，请稍后重试。";
}

export function ChannelFormPage() {
  const { channelId } = useParams();
  const editing = Boolean(channelId);
  const navigate = useNavigate();
  const [loading, setLoading] = useState(editing);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [platform, setPlatform] = useState<ChannelPlatform>("wechat_group");
  const [slug, setSlug] = useState(suggestedSlug);
  const [expiresAt, setExpiresAt] = useState("");
  const [reminderDays, setReminderDays] = useState("1");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!channelId) return;
    setLoading(true);
    api.getChannel(channelId).then(
      ({ channel }) => {
        setName(channel.name);
        setPlatform(channel.platform);
        setSlug(channel.slug);
        setExpiresAt(toLocalDateTime(channel.expiresAt));
        setReminderDays(String(channel.remindBeforeMinutes / 1_440));
        setLoading(false);
      },
      (error: unknown) => {
        setLoadError(messageFor(error));
        setLoading(false);
      },
    );
  }, [channelId]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setSaveError(null);
    const input: CreateChannelInput = {
      name: name.trim(),
      platform,
      slug: slug.trim().toLowerCase(),
      expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
      remindBeforeMinutes: Math.round(Number(reminderDays) * 1_440),
    };
    try {
      const { channel } = channelId
        ? await api.updateChannel(channelId, input)
        : await api.createChannel(input);
      navigate(`/channels/${channel.id}`, { replace: true });
    } catch (error) {
      setSaveError(messageFor(error));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="page"><LoadingState label="正在读取频道…" /></div>;
  if (loadError) return <div className="page"><ErrorState message={loadError} /></div>;

  return (
    <div className="page page--narrow">
      <Link className="back-link" to={channelId ? `/channels/${channelId}` : "/"}>
        <ArrowLeft size={16} /> {channelId ? "返回频道" : "返回工作台"}
      </Link>
      <PageHeading
        eyebrow={editing ? "频道设置" : "手动兜底"}
        title={editing ? "编辑频道" : "手动创建频道"}
        description={editing ? "修正手机识别的名称、公开地址和提醒时间。" : "只有手机无法识别图片时才需要手动创建；二维码仍由手机 App 添加。"}
      />

      <form className="editor-card" onSubmit={submit}>
        <section className="form-section">
          <div className="form-section__heading"><span>1</span><div><h2>选择平台</h2><p>用于区分频道和后续识别规则。</p></div></div>
          <div className="platform-picker">
            {platforms.map((item) => {
              const Icon = item.icon;
              return (
                <label className={`platform-option${platform === item.value ? " is-selected" : ""}`} key={item.value}>
                  <input
                    type="radio"
                    name="platform"
                    value={item.value}
                    checked={platform === item.value}
                    onChange={() => setPlatform(item.value)}
                  />
                  <span className={`platform-icon ${item.className}`}><Icon size={20} /></span>
                  <span><strong>{item.label}</strong><small>{item.description}</small></span>
                  <Check className="platform-option__check" size={16} />
                </label>
              );
            })}
          </div>
        </section>

        <section className="form-section">
          <div className="form-section__heading"><span>2</span><div><h2>频道信息</h2><p>名称只在管理端显示，公开地址可以长期分享。</p></div></div>
          <div className="form-grid">
            <label className="field field--full">
              <span>频道名称</span>
              <input required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：产品交流群 3 群" />
            </label>
            <label className="field field--full">
              <span>公开地址</span>
              <div className="input-prefix">
                <span>/q/</span>
                <input
                  required
                  minLength={3}
                  maxLength={64}
                  pattern="[a-z0-9][a-z0-9-]{1,62}[a-z0-9]"
                  value={slug}
                  onChange={(event) => setSlug(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                  placeholder="product-community"
                />
              </div>
              <small>保存后仍可修改，但已分享的旧地址会失效。</small>
            </label>
          </div>
        </section>

        <section className="form-section">
          <div className="form-section__heading"><span>3</span><div><h2>到期提醒</h2><p>若不确定准确时间，也可以先按平台常见周期设置。</p></div></div>
          <div className="form-grid form-grid--two">
            <label className="field">
              <span>预计到期时间</span>
              <input type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} />
              <small>不知道时可以留空，稍后再补。</small>
            </label>
            <label className="field">
              <span>提前多少天提醒</span>
              <input
                required
                type="number"
                min="0"
                max="30"
                step="0.5"
                value={reminderDays}
                onChange={(event) => setReminderDays(event.target.value)}
              />
              <small>默认提前 1 天发送手机通知。</small>
            </label>
          </div>
        </section>

        {saveError ? <p className="form-error" role="alert">{saveError}</p> : null}
        <footer className="editor-card__footer">
          <Link className="button button--ghost" to={channelId ? `/channels/${channelId}` : "/"}>取消</Link>
          <button className="button button--primary" disabled={saving}>
            {saving ? <LoaderCircle className="spin" size={17} /> : null}
            {editing ? "保存修改" : "创建并上传二维码"}
          </button>
        </footer>
      </form>
    </div>
  );
}
