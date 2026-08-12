import { useEffect, useState } from "react";
import {
  ArrowRight,
  Check,
  Copy,
  LoaderCircle,
  LockKeyhole,
  QrCode,
  RefreshCw,
  Smartphone,
} from "lucide-react";
import { api, ApiError } from "../api/client";
import { PageHeading } from "../components/States";

function formatRemaining(expiresAt: string, now: number): string {
  const seconds = Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now) / 1_000));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export function PairingPage() {
  const [pairing, setPairing] = useState<{ code: string; expiresAt: string } | null>(null);
  const [now, setNow] = useState(Date.now());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!pairing) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [pairing]);

  const createCode = async () => {
    setLoading(true);
    setError(null);
    try {
      const { pairingCode } = await api.createPairingCode();
      setPairing(pairingCode);
      setNow(Date.now());
    } catch (createError) {
      setError(createError instanceof ApiError ? createError.message : "无法生成配对码。 ");
    } finally {
      setLoading(false);
    }
  };

  const expired = pairing ? new Date(pairing.expiresAt).getTime() <= now : false;
  const visibleCode = pairing?.code.replace(/[^A-Za-z0-9]/g, "").toUpperCase() ?? "";

  return (
    <div className="page page--pairing">
      <PageHeading
        eyebrow="手机 App"
        title="连接这台部署"
        description="配对后，手机可以从相册识别新二维码并直接更新对应频道。"
      />

      <section className="pairing-layout">
        <article className="pairing-card">
          <div className="pairing-card__visual" aria-hidden="true">
            <div className="phone-outline">
              <span className="phone-outline__speaker" />
              <QrCode size={66} strokeWidth={1.35} />
              <span>连接部署</span>
            </div>
            <div className="pairing-pulse pairing-pulse--one" />
            <div className="pairing-pulse pairing-pulse--two" />
          </div>
          <div className="pairing-card__content">
            {!pairing ? (
              <>
                <span className="pairing-card__icon"><Smartphone size={23} /></span>
                <h2>生成一次性配对码</h2>
                <p>配对码只在 10 分钟内有效，使用后立即失效。手机将自动保存这个部署的 API 地址和会话。</p>
                {error ? <p className="form-error" role="alert">{error}</p> : null}
                <button className="button button--primary button--wide" type="button" disabled={loading} onClick={() => void createCode()}>
                  {loading ? <LoaderCircle className="spin" size={17} /> : <LockKeyhole size={17} />}
                  生成配对码
                </button>
              </>
            ) : (
              <>
                <p className="eyebrow">在手机 App 中输入</p>
                <div className={`pair-code${expired ? " is-expired" : ""}`} aria-label={`配对码 ${visibleCode}`}>
                  {visibleCode.split("").map((character, index) => <span key={`${character}-${index}`}>{character}</span>)}
                </div>
                <div className="pair-code__meta">
                  {expired ? <strong>已过期</strong> : <><span>剩余时间</span><strong>{formatRemaining(pairing.expiresAt, now)}</strong></>}
                </div>
                <div className="button-group button-group--center">
                  <button
                    className="button button--secondary"
                    type="button"
                    disabled={expired}
                    onClick={() => {
                      void navigator.clipboard.writeText(visibleCode);
                      setCopied(true);
                      window.setTimeout(() => setCopied(false), 1_500);
                    }}
                  >
                    {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? "已复制" : "复制配对码"}
                  </button>
                  <button className="button button--ghost" type="button" disabled={loading} onClick={() => void createCode()}>
                    <RefreshCw size={16} /> 重新生成
                  </button>
                </div>
              </>
            )}
          </div>
        </article>

        <aside className="pairing-steps">
          <p className="eyebrow">连接步骤</p>
          <ol>
            <li><span>1</span><div><strong>打开续码 App</strong><p>在欢迎页面选择“连接已有部署”。</p></div></li>
            <li><span>2</span><div><strong>填写部署地址与配对码</strong><p>部署地址是 {window.location.origin}，配对码只填写上方显示的 10 位代码。</p></div></li>
            <li><span>3</span><div><strong>允许相册与通知</strong><p>相册识别在手机本地完成，服务器只接收你确认更新的图片。</p></div></li>
          </ol>
          <div className="pairing-security"><LockKeyhole size={17} /><p><strong>一次性凭证</strong><br />配对码不会出现在日志中，也不能重复使用。</p></div>
          <a className="text-link" href="#app-download">还没有安装 App？查看安装方式 <ArrowRight size={15} /></a>
        </aside>
      </section>
    </div>
  );
}
