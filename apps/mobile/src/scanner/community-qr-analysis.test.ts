import assert from "node:assert/strict";
import test from "node:test";

import type { Channel, OcrLine, QrCandidate } from "@qr-lifecycle/contracts";

import {
  enrichQrCandidate,
  toDetectedCommunityQr,
} from "./community-qr-analysis.ts";

const CAPTURED_AT = new Date("2026-08-12T04:00:00.000Z").getTime();

function ocr(...lines: string[]): OcrLine[] {
  return lines.map((text) => ({ text, confidence: 0.97 }));
}

function candidate(overrides: Partial<QrCandidate> = {}): QrCandidate {
  return {
    assetId: "asset-1",
    creationTime: CAPTURED_AT,
    payload: "https://example.com/qr/1",
    imageUri: "file:///tmp/qr.png",
    ocrLines: [],
    ...overrides,
  };
}

function channel(overrides: Partial<Channel> = {}): Channel {
  return {
    id: "123e4567-e89b-42d3-a456-426614174000",
    tenantId: "223e4567-e89b-42d3-a456-426614174000",
    name: "Fallinlife 创作者交流群",
    platform: "wechat_group",
    slug: "fallinlife-creators",
    expiresAt: null,
    remindBeforeMinutes: 1_440,
    activeQrVersionId: null,
    disabledAt: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

test("extracts a WeChat group title and relative expiry", () => {
  const result = enrichQrCandidate(
    candidate({
      payload: "https://weixin.qq.com/g/abc",
      ocrLines: ocr(
        "群聊邀请",
        "“Fallinlife 创作者交流群”邀请你加入群聊",
        "该二维码7天内有效",
        "长按识别图中二维码",
      ),
    }),
    [],
  );

  assert.equal(result.platform, "wechat_group");
  assert.equal(result.name, "Fallinlife 创作者交流群");
  assert.equal(result.expirySource, "relative");
  assert.equal(result.expiresAt, "2026-08-19T04:00:00.000Z");
  assert.ok((result.fieldConfidences?.platform ?? 0) >= 0.9);
});

test("extracts a Xiaohongshu group and an explicit expiry", () => {
  const result = enrichQrCandidate(
    candidate({
      payload: "https://xhslink.com/a1b2",
      ocrLines: ocr(
        "小红书群聊",
        "群名称：设计师灵感交流",
        "二维码有效期至 2026年8月15日 18:30",
      ),
    }),
    [],
  );

  assert.equal(result.platform, "xiaohongshu_group");
  assert.equal(result.name, "设计师灵感交流");
  assert.equal(result.expirySource, "explicit");
  assert.equal(result.expiresAt, new Date(2026, 7, 15, 18, 30).toISOString());
});

test("extracts the Xiaohongshu English template from the real Scripod image", () => {
  const result = enrichQrCandidate(
    candidate({
      payload: "http://xhslink.com/m/4h7P0wgQG9L",
      ocrLines: ocr(
        "Scripod（17）",
        "Valid for 28 days （until 2026.9.9）",
        "Scan the OR code",
        "to join the group chat",
        "小红书",
      ),
    }),
    [],
  );

  assert.equal(result.platform, "xiaohongshu_group");
  assert.equal(result.name, "Scripod");
  assert.equal(result.expirySource, "explicit");
  assert.equal(result.expiresAt, new Date(2026, 8, 9, 23, 59).toISOString());
});

test("falls back to Xiaohongshu's English duration when the final date is not read", () => {
  const result = enrichQrCandidate(
    candidate({
      payload: "https://xhslink.com/fallback",
      ocrLines: ocr("Scripod(17)", "Valid for 28 days", "Scan the OR code", "小红书"),
    }),
    [],
  );

  assert.equal(result.name, "Scripod");
  assert.equal(result.expirySource, "relative");
  assert.equal(result.expiresAt, "2026-09-09T04:00:00.000Z");
});

test("recognizes Discord without inventing an expiry", () => {
  const result = enrichQrCandidate(
    candidate({
      payload: "https://discord.gg/fallinlife",
      ocrLines: ocr("You've been invited to join", "Fallinlife Builders", "ACCEPT INVITE"),
    }),
    [],
  );

  assert.equal(result.platform, "discord");
  assert.equal(result.name, "Fallinlife Builders");
  assert.equal(result.expirySource, "unknown");
  assert.equal(result.expiresAt, null);
});

test("does not strip a parenthesized number outside the Xiaohongshu adapter", () => {
  const result = enrichQrCandidate(
    candidate({
      payload: "https://discord.gg/fallinlife",
      ocrLines: ocr("You've been invited to join", "Builders (17)", "ACCEPT INVITE"),
    }),
    [],
  );

  assert.equal(result.name, "Builders (17)");
});

test("keeps the name null when OCR only contains boilerplate", () => {
  const result = enrichQrCandidate(
    candidate({
      payload: "https://weixin.qq.com/g/abc",
      ocrLines: ocr("微信", "扫一扫", "长按识别图中二维码", "7天内有效"),
    }),
    [],
  );

  assert.equal(result.name, null);
  assert.equal(result.suggestedChannelId, null);
  assert.equal(result.matchConfidence, 0);
});

test("suggests one same-name channel but rejects an ambiguous duplicate", () => {
  const input = candidate({
    payload: "https://weixin.qq.com/g/new",
    ocrLines: ocr("“Fallinlife 创作者交流群”邀请你加入群聊"),
  });
  const existing = channel();

  const matched = enrichQrCandidate(input, [existing]);
  assert.equal(matched.suggestedChannelId, existing.id);
  assert.ok((matched.matchConfidence ?? 0) >= 0.95);

  const ambiguous = enrichQrCandidate(input, [
    existing,
    channel({
      id: "323e4567-e89b-42d3-a456-426614174000",
      slug: "fallinlife-creators-2",
    }),
  ]);
  assert.equal(ambiguous.suggestedChannelId, null);
  assert.ok((ambiguous.matchConfidence ?? 0) > 0);
});

test("builds stable flattened detection metadata without a local image URI", () => {
  const input = candidate({
    creationTime: CAPTURED_AT + 0.875,
    payload: "https://discord.gg/fallinlife",
    ocrLines: ocr("You've been invited to join", "Fallinlife Builders"),
  });
  const first = toDetectedCommunityQr(input, []);
  const second = toDetectedCommunityQr(input, []);

  assert.equal(first.clientDetectionId, second.clientDetectionId);
  assert.match(first.clientDetectionId, /^[0-9a-f-]{36}$/u);
  assert.equal(first.decodedPayload, input.payload);
  assert.equal("imageUri" in first, false);
  assert.equal(first.capturedAt, "2026-08-12T04:00:00.000Z");
  assert.equal(first.creationTime, CAPTURED_AT);
});
