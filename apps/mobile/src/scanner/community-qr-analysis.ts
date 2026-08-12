import type {
  Channel,
  ChannelPlatform,
  DetectedCommunityQr,
  ExpirySource,
  FieldConfidences,
  QrCandidate,
} from "@qr-lifecycle/contracts";

export interface AnalyzeQrOptions {
  now?: Date;
}

interface ExpiryInference {
  expiresAt: string | null;
  source: ExpirySource;
  score: number;
}

interface ChannelMatch {
  channelId: string | null;
  confidence: number;
}

const BOILERPLATE_PATTERNS = [
  /二维码/u,
  /扫一扫/u,
  /识别图中/u,
  /长按.{0,8}识别/u,
  /邀请.{0,8}(加入|进入)/u,
  /(加入|进入).{0,8}(群聊|群组|服务器)/u,
  /群聊邀请/u,
  /保存.{0,8}(图片|相册)/u,
  /(有效|过期|失效|截止|到期)/u,
  /微信/u,
  /小红书/u,
  /xiaohongshu/iu,
  /discord/iu,
  /you.?ve been invited/iu,
  /join (this |the )?(server|group)/iu,
  /accept invite/iu,
  /members? online/iu,
  /^群聊$/u,
  /^群组$/u,
  /^server$/iu,
];

function clampScore(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 100) / 100;
}

function textFor(candidate: QrCandidate): string[] {
  return (candidate.ocrLines ?? [])
    .map((line) => line.text.replace(/[\u200B-\u200D\uFEFF]/gu, "").trim())
    .filter(Boolean);
}

function normalizedName(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, "")
    .replace(/(?:微信群|群聊|交流群|交流群组|小红书群|discord服务器)$/u, "");
}

function platformScore(candidate: QrCandidate): {
  platform: ChannelPlatform;
  score: number;
} {
  const text = `${candidate.payload}\n${textFor(candidate).join("\n")}`;
  const scores: Record<Exclude<ChannelPlatform, "other">, number> = {
    wechat_group: 0,
    xiaohongshu_group: 0,
    discord: 0,
  };

  if (/(weixin\.qq\.com|u\.wechat\.com|微信|微信群|微信扫描|群聊邀请)/iu.test(text)) {
    scores.wechat_group += 0.78;
  }
  if (/(邀请你加入群聊|诚邀你加入群聊|该二维码.{0,12}有效)/u.test(text)) {
    scores.wechat_group += 0.17;
  }
  if (/(xiaohongshu|xhslink\.com|小红书|REDnote|薯队长)/iu.test(text)) {
    scores.xiaohongshu_group += 0.88;
  }
  if (/(discord\.gg|discord\.com\/invite|discord|you.?ve been invited to join)/iu.test(text)) {
    scores.discord += 0.92;
  }

  const [platform, score] = (Object.entries(scores) as Array<[
    Exclude<ChannelPlatform, "other">,
    number,
  ]>).sort((lhs, rhs) => rhs[1] - lhs[1])[0] ?? ["wechat_group", 0];
  return score >= 0.5
    ? { platform, score: clampScore(score) }
    : { platform: "other", score: 0.25 };
}

function cleanCapturedName(value: string): string | null {
  const cleaned = value
    .replace(/^[\s“”"'「」『』【】\[\]：:]+|[\s“”"'「」『』【】\[\]：:]+$/gu, "")
    .replace(/^(?:群名称|群名|服务器|server)\s*[：:]\s*/iu, "")
    .trim();
  if (cleaned.length < 2 || cleaned.length > 120) return null;
  if (/^(?:群聊|群组|交流群|邀请|invite|unknown)$/iu.test(cleaned)) return null;
  return cleaned;
}

function explicitName(lines: string[]): string | null {
  const joined = lines.join("\n");
  const patterns = [
    /[“"「『【]([^\n”"」』】]{2,120})[”"」』】].{0,12}邀请.{0,8}(?:加入|进入)/u,
    /邀请你加入(?:群聊|群组)[：:\s]*[“"「『【]?([^\n”"」』】]{2,120})/u,
    /加入(?:群聊|群组)[：:\s]+[“"「『【]?([^\n”"」』】]{2,120})/u,
    /(?:群名称|群名|服务器|server)\s*[：:]\s*([^\n]{2,120})/iu,
    /([^\n]{2,120})的群二维码/u,
  ];

  for (const pattern of patterns) {
    const name = pattern.exec(joined)?.[1];
    if (name) {
      const cleaned = cleanCapturedName(name);
      if (cleaned && !BOILERPLATE_PATTERNS.some((item) => item.test(cleaned))) return cleaned;
    }
  }
  return null;
}

function isPlausibleTitle(line: string): boolean {
  const cleaned = cleanCapturedName(line);
  if (!cleaned) return false;
  if (BOILERPLATE_PATTERNS.some((pattern) => pattern.test(cleaned))) return false;
  if (/^(?:\d{1,2}[:：]\d{2}|\d+|[.·•_-]+)$/u.test(cleaned)) return false;
  if (/https?:\/\//iu.test(cleaned)) return false;
  return /[\p{L}\p{N}]/u.test(cleaned);
}

function inferName(lines: string[]): { name: string | null; score: number } {
  const captured = explicitName(lines);
  if (captured) return { name: captured, score: 0.95 };

  const invitationIndex = lines.findIndex((line) =>
    /(邀请|诚邀|join|invited|群聊邀请)/iu.test(line),
  );
  if (invitationIndex >= 0) {
    for (const offset of [-1, 1, -2, 2]) {
      const line = lines[invitationIndex + offset];
      if (line && isPlausibleTitle(line)) {
        return { name: cleanCapturedName(line), score: 0.76 };
      }
    }
  }

  const title = lines.find(isPlausibleTitle);
  return title
    ? { name: cleanCapturedName(title), score: 0.58 }
    : { name: null, score: 0 };
}

function validDate(year: number, month: number, day: number, hour: number, minute: number): Date | null {
  const date = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day ||
    date.getHours() !== hour ||
    date.getMinutes() !== minute
  ) {
    return null;
  }
  return date;
}

function inferExplicitExpiry(lines: string[], base: Date): Date | null {
  for (const line of lines) {
    if (!/(有效|过期|失效|截止|到期|expires?|valid until)/iu.test(line)) continue;

    const fullDate = /(?:(20\d{2})\s*[年/.\-])?(\d{1,2})\s*[月/.\-](\d{1,2})\s*日?(?:\s*(\d{1,2})\s*[时:：]\s*(\d{1,2})\s*分?)?/u.exec(line);
    if (!fullDate) continue;
    const explicitYear = fullDate[1] ? Number(fullDate[1]) : null;
    const month = Number(fullDate[2]);
    const day = Number(fullDate[3]);
    const hour = fullDate[4] ? Number(fullDate[4]) : 23;
    const minute = fullDate[5] ? Number(fullDate[5]) : 59;
    let year = explicitYear ?? base.getFullYear();
    let date = validDate(year, month, day, hour, minute);
    if (!date) continue;
    if (!explicitYear && date.getTime() < base.getTime() - 86_400_000) {
      year += 1;
      date = validDate(year, month, day, hour, minute);
    }
    if (date) return date;
  }
  return null;
}

function inferExpiry(candidate: QrCandidate, now: Date): ExpiryInference {
  const lines = textFor(candidate);
  const base = new Date(candidate.creationTime ?? now.getTime());
  const explicit = inferExplicitExpiry(lines, base);
  if (explicit) return { expiresAt: explicit.toISOString(), source: "explicit", score: 0.96 };

  for (const line of lines) {
    if (!/(有效|过期|失效|截止|到期|expires?)/iu.test(line)) continue;
    const relative = /(\d{1,3})\s*(分钟|小时|天|日|周|星期)(?:之?内|后)?/u.exec(line);
    if (!relative) continue;
    const amount = Number(relative[1]);
    const unit = relative[2];
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const multiplier =
      unit === "分钟"
        ? 60_000
        : unit === "小时"
          ? 3_600_000
          : unit === "周" || unit === "星期"
            ? 7 * 86_400_000
            : 86_400_000;
    return {
      expiresAt: new Date(base.getTime() + amount * multiplier).toISOString(),
      source: "relative",
      score: 0.86,
    };
  }

  return { expiresAt: null, source: "unknown", score: 0 };
}

function bigrams(value: string): Set<string> {
  const result = new Set<string>();
  if (value.length < 2) {
    if (value) result.add(value);
    return result;
  }
  for (let index = 0; index < value.length - 1; index += 1) {
    result.add(value.slice(index, index + 2));
  }
  return result;
}

function nameSimilarity(lhs: string, rhs: string): number {
  const left = normalizedName(lhs);
  const right = normalizedName(rhs);
  if (!left || !right) return 0;
  if (left === right) return 1;
  const leftPairs = bigrams(left);
  const rightPairs = bigrams(right);
  let intersection = 0;
  for (const pair of leftPairs) {
    if (rightPairs.has(pair)) intersection += 1;
  }
  return (2 * intersection) / (leftPairs.size + rightPairs.size);
}

function matchChannel(
  name: string | null,
  platform: ChannelPlatform,
  channels: readonly Channel[],
): ChannelMatch {
  if (!name) return { channelId: null, confidence: 0 };

  const scored = channels
    .filter((channel) => channel.disabledAt === null)
    .map((channel) => {
      const similarity = nameSimilarity(name, channel.name);
      const platformFactor =
        platform === "other" || channel.platform === "other"
          ? 0.88
          : platform === channel.platform
            ? 1
            : 0.3;
      return { channel, score: similarity * platformFactor };
    })
    .sort((lhs, rhs) => rhs.score - lhs.score);

  const best = scored[0];
  if (!best || best.score < 0.78) return { channelId: null, confidence: 0 };
  const runnerUp = scored[1];
  if (runnerUp && best.score - runnerUp.score < 0.12) {
    return { channelId: null, confidence: clampScore(best.score * 0.65) };
  }
  return {
    channelId: best.channel.id,
    confidence: clampScore(best.score >= 0.99 ? 0.98 : best.score),
  };
}

function clientDetectionId(candidate: QrCandidate): string {
  const input = `${candidate.assetId}\u0000${candidate.payload}`;
  const bytes = new Uint8Array(16);
  const seeds = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35];
  for (let block = 0; block < seeds.length; block += 1) {
    let hash = seeds[block] ?? 0;
    for (let index = 0; index < input.length; index += 1) {
      hash ^= input.charCodeAt(index) + block * 31;
      hash = Math.imul(hash, 0x01000193);
    }
    for (let offset = 0; offset < 4; offset += 1) {
      bytes[block * 4 + offset] = (hash >>> (offset * 8)) & 0xff;
    }
  }
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function enrichQrCandidate(
  candidate: QrCandidate,
  channels: readonly Channel[],
  options: AnalyzeQrOptions = {},
): QrCandidate {
  const lines = textFor(candidate);
  const platform = platformScore(candidate);
  const name = inferName(lines);
  const expiry = inferExpiry(candidate, options.now ?? new Date());
  const match = matchChannel(name.name, platform.platform, channels);

  return {
    ...candidate,
    platform: platform.platform,
    name: name.name,
    expiresAt: expiry.expiresAt,
    expirySource: expiry.source,
    fieldConfidences: {
      platform: platform.score,
      name: name.score,
      expiresAt: expiry.score,
    },
    suggestedChannelId: match.channelId,
    matchConfidence: match.confidence,
  };
}

export function enrichQrCandidates(
  candidates: readonly QrCandidate[],
  channels: readonly Channel[],
  options: AnalyzeQrOptions = {},
): QrCandidate[] {
  return candidates.map((candidate) => enrichQrCandidate(candidate, channels, options));
}

export function toDetectedCommunityQr(
  candidate: QrCandidate,
  channels: readonly Channel[],
  options: AnalyzeQrOptions = {},
): DetectedCommunityQr {
  const enriched = enrichQrCandidate(candidate, channels, options);
  const fieldConfidences: FieldConfidences = enriched.fieldConfidences ?? {
    platform: 0,
    name: 0,
    expiresAt: 0,
  };
  return {
    clientDetectionId: clientDetectionId(enriched),
    assetId: enriched.assetId,
    capturedAt:
      enriched.creationTime === null
        ? null
        : new Date(enriched.creationTime).toISOString(),
    creationTime: enriched.creationTime,
    decodedPayload: enriched.payload,
    ocrLines: enriched.ocrLines ?? [],
    platform: enriched.platform ?? null,
    name: enriched.name ?? null,
    expiresAt: enriched.expiresAt ?? null,
    expirySource: enriched.expirySource ?? "unknown",
    fieldConfidences,
    suggestedChannelId: enriched.suggestedChannelId ?? null,
    matchConfidence: enriched.matchConfidence ?? 0,
  };
}

export function toDetectedCommunityQrs(
  candidates: readonly QrCandidate[],
  channels: readonly Channel[],
  options: AnalyzeQrOptions = {},
): DetectedCommunityQr[] {
  return candidates.map((candidate) => toDetectedCommunityQr(candidate, channels, options));
}
