import { useCallback, useEffect, useRef, useState } from "react";
import { Check, LoaderCircle, QrCode, RefreshCw, ShieldCheck, Smartphone } from "lucide-react";
import QRCode from "qrcode";

import { api, ApiError, type CreateWebBindingResponse } from "../api/client";

type ConnectPhase = "creating" | "waiting" | "approved" | "expired" | "error";

export function ConnectPage({
  onAuthenticated,
}: {
  onAuthenticated: () => void | Promise<void>;
}) {
  const generation = useRef(0);
  const [request, setRequest] = useState<CreateWebBindingResponse | null>(null);
  const [qrImage, setQrImage] = useState<string | null>(null);
  const [phase, setPhase] = useState<ConnectPhase>("creating");
  const [error, setError] = useState<string | null>(null);

  const create = useCallback(async () => {
    const current = ++generation.current;
    setPhase("creating");
    setError(null);
    setRequest(null);
    setQrImage(null);
    try {
      const next = await api.createWebBinding();
      const image = await QRCode.toDataURL(next.binding.qrValue, {
        width: 420,
        margin: 2,
        errorCorrectionLevel: "M",
        color: { dark: "#17201c", light: "#ffffff" },
      });
      if (generation.current !== current) return;
      setRequest(next);
      setQrImage(image);
      setPhase("waiting");
    } catch (caught) {
      if (generation.current !== current) return;
      setError(caught instanceof ApiError ? caught.message : "无法生成绑定二维码。");
      setPhase("error");
    }
  }, []);

  useEffect(() => {
    void create();
    return () => {
      generation.current += 1;
    };
  }, [create]);

  useEffect(() => {
    if (!request) return;
    const current = generation.current;
    let timer: number | undefined;
    let stopped = false;

    const poll = async () => {
      try {
        const result = await api.getWebBindingStatus(
          request.binding.id,
          request.browserSecret,
        );
        if (stopped || generation.current !== current) return;
        if (result.status === "expired") {
          setPhase("expired");
          return;
        }
        if (result.status === "approved") {
          setPhase("approved");
          await api.consumeWebBinding(request.binding.id, request.browserSecret);
          if (!stopped && generation.current === current) await onAuthenticated();
          return;
        }
        timer = window.setTimeout(() => void poll(), 1_200);
      } catch (caught) {
        if (stopped || generation.current !== current) return;
        setError(caught instanceof ApiError ? caught.message : "绑定状态读取失败。");
        setPhase("error");
      }
    };

    timer = window.setTimeout(() => void poll(), 500);
    return () => {
      stopped = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [onAuthenticated, request]);

  return (
    <main className="auth-layout">
      <section className="auth-story">
        <div className="auth-brand">
          <span className="brand__mark"><QrCode size={23} /></span>
          <span><strong>Fallinlife</strong><small>QR Lifecycle</small></span>
        </div>
        <div className="auth-story__copy">
          <p className="eyebrow">手机就是你的账号</p>
          <h1>不用注册，扫码查看手机里的群码。</h1>
          <p>
            频道由手机从相册自动发现和更新。网站只负责查看公开入口、状态与必要的人工纠错。
          </p>
          <div className="auth-features">
            <span><ShieldCheck size={14} /> 一次性绑定码</span>
            <span><Smartphone size={14} /> 手机确认授权</span>
            <span><Check size={14} /> 随时在 App 撤销</span>
          </div>
        </div>
        <div className="auth-flow" aria-hidden="true">
          <span className="auth-flow__node auth-flow__node--active"><span>01</span> 官网显示二维码</span>
          <i className="auth-flow__line" />
          <span className="auth-flow__node"><span>02</span> 手机扫码确认</span>
          <i className="auth-flow__line" />
          <span className="auth-flow__node"><span>03</span> 浏览器安全 Cookie</span>
        </div>
      </section>

      <section className="auth-panel">
        <div className="auth-card connect-card">
          <div className="auth-card__heading">
            <span className="auth-card__icon"><Smartphone size={21} /></span>
            <div><p className="eyebrow">连接手机</p><h2>用 Fallinlife 扫码</h2></div>
          </div>
          <p className="auth-card__intro">
            打开 App「设置 → 扫描网站绑定码」，扫码后在手机上确认。
          </p>

          <div className="connect-qr" aria-live="polite">
            {qrImage && phase !== "expired" && phase !== "error" ? (
              <img src={qrImage} alt="用于绑定 Fallinlife 手机 App 的一次性二维码" />
            ) : (
              <div className="connect-qr__placeholder">
                {phase === "creating" ? <LoaderCircle className="spin" size={28} /> : <QrCode size={42} />}
              </div>
            )}
          </div>

          {phase === "waiting" ? <p className="connect-status"><LoaderCircle className="spin" size={14} /> 等待手机确认…</p> : null}
          {phase === "approved" ? <p className="connect-status connect-status--success"><Check size={14} /> 已确认，正在进入…</p> : null}
          {phase === "expired" ? <p className="form-error">二维码已过期，请刷新后重新扫描。</p> : null}
          {phase === "error" ? <p className="form-error">{error}</p> : null}
          {phase === "expired" || phase === "error" ? (
            <button className="button button--secondary button--wide" type="button" onClick={() => void create()}>
              <RefreshCw size={16} /> 重新生成
            </button>
          ) : null}
          <p className="auth-panel__footnote">二维码约 2 分钟有效，且只能使用一次。</p>
        </div>
      </section>
    </main>
  );
}
