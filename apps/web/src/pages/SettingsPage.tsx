import { useCallback, useEffect, useState } from "react";
import {
  Check,
  Cloud,
  Copy,
  Database,
  KeyRound,
  LogOut,
  Server,
  ShieldCheck,
} from "lucide-react";
import { api, ApiError, type MeResponse } from "../api/client";
import { ErrorState, LoadingState, PageHeading } from "../components/States";

export function SettingsPage({ onLogout }: { onLogout: () => void }) {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(() => {
    setError(null);
    api.me().then(
      setMe,
      (loadError: unknown) => setError(loadError instanceof ApiError ? loadError.message : "设置加载失败。"),
    );
  }, []);

  useEffect(load, [load]);

  if (!me && !error) return <div className="page"><LoadingState label="正在读取部署信息…" /></div>;
  if (error || !me) return <div className="page"><ErrorState message={error ?? "部署信息不存在。"} onRetry={load} /></div>;

  const copyOrigin = async () => {
    await navigator.clipboard.writeText(me.deployment.apiOrigin);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  };

  return (
    <div className="page page--settings">
      <PageHeading eyebrow="偏好与部署" title="设置" description="查看当前工作区、部署模式和连接信息。" />

      <div className="settings-grid">
        <section className="settings-card settings-card--profile">
          <div className="settings-card__heading"><div><p className="eyebrow">账户</p><h2>个人与工作区</h2></div><ShieldCheck size={22} /></div>
          <dl className="settings-list">
            <div><dt>管理员</dt><dd>{me.user.displayName || "未设置称呼"}</dd></div>
            <div><dt>邮箱</dt><dd>{me.user.email}</dd></div>
            <div><dt>工作区</dt><dd>{me.tenant.name}</dd></div>
            <div><dt>角色</dt><dd><span className="mini-badge">{me.membership.role === "owner" ? "所有者" : me.membership.role}</span></dd></div>
          </dl>
        </section>

        <section className="settings-card">
          <div className="settings-card__heading"><div><p className="eyebrow">运行环境</p><h2>部署信息</h2></div><Cloud size={22} /></div>
          <div className="deployment-mode">
            <span className="deployment-mode__icon"><Server size={22} /></span>
            <div><strong>{me.deployment.mode === "self_hosted" ? "自托管部署" : "托管服务"}</strong><p>{me.deployment.mode === "self_hosted" ? "数据与密钥运行在你的 Cloudflare 账户中。" : "由续码托管和维护。"}</p></div>
            <span className="status-badge status-badge--success"><i />运行中</span>
          </div>
          <label className="field">
            <span>API 地址</span>
            <div className="copy-field"><code>{me.deployment.apiOrigin}</code><button type="button" onClick={() => void copyOrigin()}>{copied ? <Check size={16} /> : <Copy size={16} />}</button></div>
          </label>
          <div className="capability-row">
            <span><Database size={16} /> D1 数据库</span>
            <span><Cloud size={16} /> R2 图片存储</span>
            <span><KeyRound size={16} /> APNs 推送</span>
          </div>
        </section>
      </div>

      <section className="settings-card settings-card--wide">
        <div className="settings-card__heading"><div><p className="eyebrow">维护</p><h2>版本与更新</h2></div><span className="mini-badge">MVP</span></div>
        <div className="maintenance-row">
          <div><strong>{me.deployment.productName}</strong><p>开源版本与托管版本保持功能一致。自托管部署的升级由你控制。</p></div>
          <span className="mini-badge">v0.1.0 · 开源版</span>
        </div>
      </section>

      <section className="danger-zone">
        <div><strong>退出当前会话</strong><p>这只会清除此浏览器中的登录状态，不会影响手机 App。</p></div>
        <button
          className="button button--danger button--small"
          type="button"
          onClick={() => { api.clearSession(); onLogout(); }}
        ><LogOut size={15} /> 退出登录</button>
      </section>
    </div>
  );
}
