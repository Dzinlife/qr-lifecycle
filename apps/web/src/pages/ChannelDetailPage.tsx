import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import type { Channel, QrVersion } from "@qr-lifecycle/contracts";
import {
  ArrowLeft,
  CalendarClock,
  Check,
  Copy,
  ExternalLink,
  FileImage,
  History,
  ImagePlus,
  LoaderCircle,
  Pencil,
  QrCode,
  Smartphone,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, ApiError } from "../api/client";
import { ErrorState, LoadingState, PageHeading } from "../components/States";
import { formatDateTime, getChannelStatus } from "../lib/channel-status";

function messageFor(error: unknown): string {
  return error instanceof ApiError ? error.message : "请求失败，请稍后重试。";
}

async function detectQr(file: File): Promise<string | null> {
  const BarcodeDetector = window.BarcodeDetector;
  if (!BarcodeDetector) return null;
  const bitmap = await createImageBitmap(file);
  try {
    const detector = new BarcodeDetector({ formats: ["qr_code"] });
    const [result] = await detector.detect(bitmap);
    return result?.rawValue ?? null;
  } finally {
    bitmap.close();
  }
}

export function ChannelDetailPage() {
  const { channelId = "" } = useParams();
  const navigate = useNavigate();
  const fileInput = useRef<HTMLInputElement>(null);
  const [channel, setChannel] = useState<Channel | null>(null);
  const [versions, setVersions] = useState<QrVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [payload, setPayload] = useState("");
  const [detecting, setDetecting] = useState(false);
  const [detectionNote, setDetectionNote] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

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
  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const chooseFile = async (nextFile: File) => {
    setUploadError(null);
    setDetectionNote(null);
    if (nextFile.size > 10 * 1024 * 1024) {
      setUploadError("图片不能超过 10 MiB。");
      return;
    }
    const supportedMime = /^image\/(png|jpeg|heic|heif)$/u.test(nextFile.type);
    const supportedExtension = /\.(png|jpe?g|heic|heif)$/iu.test(nextFile.name);
    if (!supportedMime && !supportedExtension) {
      setUploadError("请选择 PNG、JPEG 或 HEIC 图片。");
      return;
    }
    setFile(nextFile);
    setPayload("");
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(URL.createObjectURL(nextFile));
    setDetecting(true);
    try {
      const detected = await detectQr(nextFile);
      if (detected) {
        setPayload(detected);
        setDetectionNote("已在浏览器中识别二维码内容。上传后服务端只保存内容哈希。");
      } else {
        setDetectionNote("当前浏览器未识别出二维码，请粘贴二维码解码内容后上传。也可以改用手机 App。 ");
      }
    } catch {
      setDetectionNote("浏览器无法读取这张图片的二维码内容，请手动粘贴解码内容或改用手机 App。 ");
    } finally {
      setDetecting(false);
    }
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    const dropped = event.dataTransfer.files[0];
    if (dropped) void chooseFile(dropped);
  };

  const upload = async () => {
    if (!file || !payload.trim()) return;
    setUploading(true);
    setUploadError(null);
    try {
      const response = await api.uploadQrVersion(channelId, {
        image: file,
        decodedPayload: payload.trim(),
        capturedAt: new Date(file.lastModified).toISOString(),
      });
      setChannel(response.channel);
      setVersions((current) => [response.qrVersion, ...current.filter((item) => item.id !== response.qrVersion.id)]);
      setFile(null);
      setPayload("");
      setDetectionNote(null);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    } catch (nextError) {
      setUploadError(messageFor(nextError));
    } finally {
      setUploading(false);
    }
  };

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
              <><QrCode size={54} /><strong>还没有二维码</strong><span>在右侧上传第一个版本</span></>
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

        <article className="upload-card">
          <div className="card-heading">
            <div><p className="eyebrow">替换当前版本</p><h2>上传新二维码</h2></div>
            <ImagePlus size={22} />
          </div>
          <div
            className={`drop-zone${dragging ? " is-dragging" : ""}${previewUrl ? " has-preview" : ""}`}
            onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            {previewUrl ? (
              <img src={previewUrl} alt="待上传二维码预览" />
            ) : (
              <><span><UploadCloud size={25} /></span><strong>拖入新二维码图片</strong><p>PNG、JPEG 或 HEIC，最大 10 MiB</p></>
            )}
            <button className="button button--secondary button--small" type="button" onClick={() => fileInput.current?.click()}>
              <FileImage size={15} /> {file ? "重新选择" : "选择图片"}
            </button>
            <input
              ref={fileInput}
              className="visually-hidden"
              type="file"
              accept="image/png,image/jpeg,image/heic,image/heif"
              onChange={(event) => {
                const selected = event.target.files?.[0];
                if (selected) void chooseFile(selected);
              }}
            />
          </div>
          {file ? (
            <label className="field upload-payload">
              <span>{detecting ? "正在识别二维码…" : "二维码解码内容"}</span>
              <textarea
                required
                rows={3}
                value={payload}
                disabled={detecting}
                onChange={(event) => setPayload(event.target.value)}
                placeholder="浏览器无法识别时，请粘贴二维码解码后的链接或文本"
              />
              {detectionNote ? <small>{detectionNote}</small> : null}
            </label>
          ) : null}
          {uploadError ? <p className="form-error" role="alert">{uploadError}</p> : null}
          <button
            className="button button--primary button--wide"
            type="button"
            disabled={!file || !payload.trim() || detecting || uploading}
            onClick={() => void upload()}
          >
            {uploading ? <LoaderCircle className="spin" size={17} /> : <UploadCloud size={17} />}
            上传并立即启用
          </button>
          <p className="upload-card__hint"><Smartphone size={14} /> 手机 App 可直接从相册识别并更新，无需手动解码。</p>
        </article>
      </section>

      <section className="history-card">
        <div className="section-heading"><div><p className="eyebrow">留痕</p><h2>二维码历史</h2></div><span>{versions.length} 个版本</span></div>
        {versions.length === 0 ? (
          <div className="history-empty"><History size={22} /><span>上传后会在这里保留版本记录。</span></div>
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
