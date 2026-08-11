import { useEffect, useState, type FormEvent } from "react";
import {
  ArrowRight,
  BellRing,
  Check,
  Cloud,
  Copy,
  KeyRound,
  LoaderCircle,
  QrCode,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { api, ApiError, type SessionResponse } from "../api/client";

type AuthMode = "bootstrap" | "login";
const PENDING_BOOTSTRAP_KEY = "qr-lifecycle.pending-bootstrap";

function readPendingBootstrap(): SessionResponse | null {
  try {
    const value = window.sessionStorage.getItem(PENDING_BOOTSTRAP_KEY);
    return value ? (JSON.parse(value) as SessionResponse) : null;
  } catch {
    return null;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "发生未知错误，请稍后重试。";
}

export function AuthPage({ onAuthenticated }: { onAuthenticated: () => void }) {
  const [pendingBootstrap, setPendingBootstrap] = useState<SessionResponse | null>(readPendingBootstrap);
  const [mode, setMode] = useState<AuthMode>(() => pendingBootstrap ? "bootstrap" : "login");
  const [checking, setChecking] = useState(() => !pendingBootstrap);
  const [productName, setProductName] = useState("续码");
  const [deploymentMode, setDeploymentMode] = useState<"self_hosted" | "managed">("self_hosted");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [tenantName, setTenantName] = useState("");
  const [code, setCode] = useState("");
  const [codeRequested, setCodeRequested] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recoveryCode, setRecoveryCode] = useState<string | null>(() => pendingBootstrap?.recoveryCode ?? null);
  const [recoverySaved, setRecoverySaved] = useState(false);
  const [recoveryCopied, setRecoveryCopied] = useState(false);

  const checkDeployment = () => {
    setChecking(true);
    setError(null);
    api.health().then(
      (health) => {
        setMode(
          health.deployment.mode === "self_hosted" && !health.bootstrapped
            ? "bootstrap"
            : "login",
        );
        setProductName(health.deployment.productName);
        setDeploymentMode(health.deployment.mode);
        setChecking(false);
      },
      (healthError: unknown) => {
        setError(errorMessage(healthError));
        setChecking(false);
      },
    );
  };

  useEffect(() => {
    if (!pendingBootstrap) checkDeployment();
  }, []);

  const completeSession = (session: SessionResponse) => {
    api.setSessionToken(session.sessionToken);
    onAuthenticated();
  };

  const submitBootstrap = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const session = await api.bootstrap({ email, displayName, tenantName });
      if (session.recoveryCode) {
        window.sessionStorage.setItem(PENDING_BOOTSTRAP_KEY, JSON.stringify(session));
        setPendingBootstrap(session);
        setRecoveryCode(session.recoveryCode);
      } else {
        completeSession(session);
      }
    } catch (submitError) {
      setError(errorMessage(submitError));
    } finally {
      setSubmitting(false);
    }
  };

  const submitLogin = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      if (deploymentMode === "self_hosted") {
        completeSession(await api.verifyRecoveryCode(email, code.trim()));
      } else if (!codeRequested) {
        await api.requestCode(email);
        setCodeRequested(true);
      } else {
        completeSession(await api.verifyCode(email, code.replace(/\s/g, "")));
      }
    } catch (submitError) {
      setError(errorMessage(submitError));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="auth-layout">
      <section className="auth-story">
        <div className="auth-brand">
          <span className="brand__mark"><QrCode size={24} /></span>
          <span><strong>{productName}</strong><small>QR Lifecycle</small></span>
        </div>
        <div className="auth-story__copy">
          <p className="eyebrow">二维码会过期，入口不应该</p>
          <h1>把每个社群入口，<br />变成一个长期地址。</h1>
          <p>管理微信群、小红书群和 Discord 邀请二维码。到期前提醒，手机识别后几步完成替换。</p>
          <div className="auth-features">
            <span><BellRing size={17} /> 到期通知</span>
            <span><RefreshCw size={17} /> 快速换码</span>
            <span><ShieldCheck size={17} /> 数据在自己的 Cloudflare</span>
          </div>
        </div>
        <div className="auth-flow" aria-hidden="true">
          <div className="auth-flow__node"><span>01</span>保存新二维码</div>
          <div className="auth-flow__line" />
          <div className="auth-flow__node"><span>02</span>手机自动识别</div>
          <div className="auth-flow__line" />
          <div className="auth-flow__node auth-flow__node--active"><Check size={16} />入口已更新</div>
        </div>
      </section>

      <section className="auth-panel">
        <div className="auth-card">
          {checking ? (
            <div className="auth-checking" role="status">
              <LoaderCircle className="spin" />
              <h2>正在连接部署</h2>
              <p>确认这是首次配置还是已有工作区。</p>
            </div>
          ) : mode === "bootstrap" ? (
            <>
              {recoveryCode ? (
                <>
                  <div className="auth-card__heading">
                    <span className="auth-card__icon"><KeyRound size={21} /></span>
                    <div><p className="eyebrow">仅显示一次</p><h2>立即保存恢复码</h2></div>
                  </div>
                  <p className="auth-card__intro">浏览器登录过期或换设备后，需要邮箱和这段恢复码重新进入管理端。服务器只保存哈希，无法替你找回。</p>
                  <div className="recovery-code">
                    <code>{recoveryCode}</code>
                    <button
                      type="button"
                      aria-label="复制恢复码"
                      onClick={() => {
                        void navigator.clipboard.writeText(recoveryCode);
                        setRecoveryCopied(true);
                        window.setTimeout(() => setRecoveryCopied(false), 1_500);
                      }}
                    >{recoveryCopied ? <Check size={17} /> : <Copy size={17} />}</button>
                  </div>
                  <label className="recovery-confirm">
                    <input type="checkbox" checked={recoverySaved} onChange={(event) => setRecoverySaved(event.target.checked)} />
                    <span>我已将恢复码保存到密码管理器或其他安全位置</span>
                  </label>
                  <button
                    className="button button--primary button--wide"
                    type="button"
                    disabled={!recoverySaved || !pendingBootstrap}
                    onClick={() => {
                      if (!pendingBootstrap) return;
                      window.sessionStorage.removeItem(PENDING_BOOTSTRAP_KEY);
                      completeSession(pendingBootstrap);
                    }}
                  >
                    进入工作台 <ArrowRight size={17} />
                  </button>
                </>
              ) : (
                <>
                  <div className="auth-card__heading">
                    <span className="auth-card__icon"><Cloud size={21} /></span>
                    <div><p className="eyebrow">首次部署</p><h2>创建管理员</h2></div>
                  </div>
                  <p className="auth-card__intro">这是一个全新的自托管实例。创建首位管理员和默认工作区即可开始。</p>
                  <form className="form-stack" onSubmit={submitBootstrap}>
                    <label className="field">
                      <span>你的称呼</span>
                      <input required autoComplete="name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="例如：小王" />
                    </label>
                    <label className="field">
                      <span>邮箱</span>
                      <input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" />
                    </label>
                    <label className="field">
                      <span>工作区名称</span>
                      <input required value={tenantName} onChange={(event) => setTenantName(event.target.value)} placeholder="例如：独立运营工作室" />
                    </label>
                    {error ? <p className="form-error" role="alert">{error}</p> : null}
                    <button className="button button--primary button--wide" disabled={submitting}>
                      {submitting ? <LoaderCircle className="spin" size={17} /> : null}
                      创建管理员 <ArrowRight size={17} />
                    </button>
                  </form>
                </>
              )}
            </>
          ) : (
            <>
              <div className="auth-card__heading">
                <span className="auth-card__icon">{deploymentMode === "self_hosted" ? <KeyRound size={21} /> : <QrCode size={21} />}</span>
                <div><p className="eyebrow">欢迎回来</p><h2>{deploymentMode === "self_hosted" ? "恢复管理员会话" : codeRequested ? "输入验证码" : "登录工作台"}</h2></div>
              </div>
              <p className="auth-card__intro">
                {deploymentMode === "self_hosted"
                  ? "输入首次部署时保存的管理员邮箱和恢复码。凭证只会发送给这台部署。"
                  : codeRequested ? `验证码已发送到 ${email}` : "输入管理员邮箱，我们会发送一次性登录验证码。"}
              </p>
              <form className="form-stack" onSubmit={submitLogin}>
                {deploymentMode === "self_hosted" ? (
                  <>
                    <label className="field">
                      <span>管理员邮箱</span>
                      <input required autoFocus type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" />
                    </label>
                    <label className="field">
                      <span>恢复码</span>
                      <input required autoComplete="current-password" value={code} onChange={(event) => setCode(event.target.value)} placeholder="首次部署时保存的恢复码" />
                    </label>
                  </>
                ) : codeRequested ? (
                  <label className="field">
                    <span>6 位验证码</span>
                    <input
                      required
                      autoFocus
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      className="code-input"
                      maxLength={8}
                      value={code}
                      onChange={(event) => setCode(event.target.value)}
                      placeholder="000 000"
                    />
                  </label>
                ) : (
                  <label className="field">
                    <span>邮箱</span>
                    <input
                      required
                      autoFocus
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="you@example.com"
                    />
                  </label>
                )}
                {error ? <p className="form-error" role="alert">{error}</p> : null}
                <button className="button button--primary button--wide" disabled={submitting}>
                  {submitting ? <LoaderCircle className="spin" size={17} /> : null}
                  {deploymentMode === "self_hosted" ? "恢复并登录" : codeRequested ? "验证并登录" : "发送验证码"} <ArrowRight size={17} />
                </button>
              </form>
              {deploymentMode === "managed" && codeRequested ? (
                <button
                  className="text-button auth-mode-switch"
                  type="button"
                  onClick={() => { setCodeRequested(false); setCode(""); setError(null); }}
                >
                  更换邮箱
                </button>
              ) : null}
            </>
          )}
          {!checking && error && !email ? (
            <button className="button button--secondary button--wide" type="button" onClick={checkDeployment}>
              <RefreshCw size={16} /> 重新连接
            </button>
          ) : null}
        </div>
        <p className="auth-panel__footnote">开源、自托管，与托管版功能一致。</p>
      </section>
    </main>
  );
}
