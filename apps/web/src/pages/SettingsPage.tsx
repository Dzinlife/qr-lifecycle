import { LogOut, ShieldCheck, Smartphone } from "lucide-react";

import { PageHeading } from "../components/States";

export function SettingsPage({ onLogout }: { onLogout: () => void }) {
  return (
    <div className="page page--settings">
      <PageHeading
        eyebrow="浏览器授权"
        title="设置"
        description="此浏览器通过手机扫码获得访问权限，没有独立账号、密码或工作区。"
      />

      <div className="settings-grid">
        <section className="settings-card settings-card--profile">
          <div className="settings-card__heading">
            <div><p className="eyebrow">当前状态</p><h2>手机已授权</h2></div>
            <ShieldCheck size={22} />
          </div>
          <div className="deployment-mode">
            <span className="deployment-mode__icon"><Smartphone size={22} /></span>
            <div>
              <strong>可以查看这台手机创建的频道</strong>
              <p>浏览器权限保存在 HttpOnly Cookie 中，网页脚本无法读取令牌。</p>
            </div>
            <span className="status-badge status-badge--success"><i />已连接</span>
          </div>
        </section>

        <section className="settings-card">
          <div className="settings-card__heading">
            <div><p className="eyebrow">权限控制</p><h2>撤销浏览器</h2></div>
            <LogOut size={22} />
          </div>
          <p className="settings-explanation">
            你可以在手机 App 的“设置”里查看所有已授权浏览器并逐个撤销。下方操作只断开当前浏览器。
          </p>
          <button className="button button--danger" type="button" onClick={onLogout}>
            <LogOut size={15} /> 断开此浏览器
          </button>
        </section>
      </div>
    </div>
  );
}
