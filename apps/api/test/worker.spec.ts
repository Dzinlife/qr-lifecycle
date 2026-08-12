import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { ApnsProvider, type ApnsTransport } from "../src/apns";
import { sha256 } from "../src/crypto";
import "../src/index";
import { sendDueReminders } from "../src/reminders";

interface ErrorResponse {
  error: { code: string; message: string };
}

interface MobileIdentity {
  token: string;
  accountId: string;
  deviceId: string;
}

async function fetchApi(path: string, init?: RequestInit): Promise<Response> {
  return exports.default.fetch(`https://api.example.test${path}`, init);
}

async function bootstrapMobile(seed: string): Promise<MobileIdentity> {
  const response = await fetchApi("/api/v1/mobile/bootstrap", {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "Fallinlife iOS test" },
    body: JSON.stringify({
      installationId: seed.repeat(64),
      deviceName: `iPhone ${seed}`,
    }),
  });
  expect(response.status).toBe(201);
  const body = await response.json<{
    sessionToken: string;
    account: { id: string };
    device: { id: string };
  }>();
  return {
    token: body.sessionToken,
    accountId: body.account.id,
    deviceId: body.device.id,
  };
}

function mobileHeaders(token: string, json = false): HeadersInit {
  return {
    authorization: `Bearer ${token}`,
    ...(json ? { "content-type": "application/json" } : {}),
  };
}

function detectionMetadata(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    clientDetectionId: crypto.randomUUID(),
    assetId: `asset-${crypto.randomUUID()}`,
    capturedAt: "2026-08-12T01:00:00.000Z",
    creationTime: 1_786_496_400_000,
    decodedPayload: `https://example.test/invite/${crypto.randomUUID()}`,
    ocrLines: [{ text: "创作者交流群", confidence: 0.99 }],
    platform: "wechat_group",
    name: "创作者交流群",
    expiresAt: "2026-08-19T01:00:00.000Z",
    expirySource: "relative",
    fieldConfidences: { platform: 0.98, name: 0.99, expiresAt: 0.91 },
    suggestedChannelId: null,
    matchConfidence: 0,
    ...overrides,
  };
}

async function commitDetectionFor(
  token: string,
  metadata: Record<string, unknown>,
): Promise<Response> {
  return fetchApi("/api/v1/detections/commit", {
    method: "POST",
    headers: mobileHeaders(token, true),
    body: JSON.stringify(metadata),
  });
}

function confirmationForm(input: Record<string, unknown> = {}): FormData {
  const form = new FormData();
  form.set("input", JSON.stringify(input));
  form.set(
    "image",
    new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], "qr.png", {
      type: "image/png",
    }),
  );
  return form;
}

describe.sequential("Fallinlife official Worker", () => {
  let mobile: MobileIdentity;
  let otherMobile: MobileIdentity;
  let webCookie = "";
  let webSessionId = "";
  let channelId = "";

  it("creates a stable hidden account from the mobile installation identity", async () => {
    const health = await fetchApi("/health");
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({
      ok: true,
      deployment: { productName: "Fallinlife" },
    });

    const oldBootstrap = await fetchApi("/api/v1/bootstrap", { method: "POST" });
    expect(oldBootstrap.status).toBe(404);

    mobile = await bootstrapMobile("a");
    const restored = await bootstrapMobile("a");
    expect(restored.accountId).toBe(mobile.accountId);
    expect(restored.deviceId).toBe(mobile.deviceId);
    expect(restored.token).not.toBe(mobile.token);
    mobile = restored;

    otherMobile = await bootstrapMobile("b");
    expect(otherMobile.accountId).not.toBe(mobile.accountId);
  });

  it("binds a browser by QR, creates an HttpOnly cookie, and consumes the code once", async () => {
    const created = await fetchApi("/api/v1/web-bindings", {
      method: "POST",
      headers: { "user-agent": "Test Browser 1" },
    });
    expect(created.status).toBe(201);
    const body = await created.json<{
      binding: { id: string; challenge: string; qrValue: string };
      browserSecret: string;
    }>();
    expect(body.binding.qrValue).toContain("qrlifecycle://web-bind");
    expect(body.binding.qrValue).not.toContain(body.browserSecret);

    const statusHeaders = { "x-binding-secret": body.browserSecret };
    const pending = await fetchApi(`/api/v1/web-bindings/${body.binding.id}`, {
      headers: statusHeaders,
    });
    expect(await pending.json()).toMatchObject({ status: "pending" });

    const approved = await fetchApi(
      `/api/v1/web-bindings/${body.binding.id}/approve`,
      {
        method: "POST",
        headers: mobileHeaders(mobile.token, true),
        body: JSON.stringify({ challenge: body.binding.challenge }),
      },
    );
    expect(approved.status).toBe(204);

    const ready = await fetchApi(`/api/v1/web-bindings/${body.binding.id}`, {
      headers: statusHeaders,
    });
    expect(await ready.json()).toMatchObject({ status: "approved" });

    const consumed = await fetchApi(
      `/api/v1/web-bindings/${body.binding.id}/consume`,
      { method: "POST", headers: statusHeaders },
    );
    expect(consumed.status).toBe(200);
    const setCookie = consumed.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("__Host-fallinlife_session=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("SameSite=Lax");
    webCookie = setCookie.split(";", 1)[0] ?? "";

    const repeated = await fetchApi(
      `/api/v1/web-bindings/${body.binding.id}/consume`,
      { method: "POST", headers: statusHeaders },
    );
    expect(repeated.status).toBe(409);

    const me = await fetchApi("/api/v1/me", { headers: { cookie: webCookie } });
    expect(me.status).toBe(200);
    const meBody = await me.json<{
      account: { id: string };
      session: { id: string; kind: string };
    }>();
    expect(meBody).toMatchObject({
      account: { id: mobile.accountId },
      session: { kind: "web" },
    });
    webSessionId = meBody.session.id;

    const cookieToken = webCookie.split("=")[1] ?? "";
    const bearerAttempt = await fetchApi("/api/v1/me", {
      headers: { authorization: `Bearer ${cookieToken}` },
    });
    expect(bearerAttempt.status).toBe(401);
  });

  it("isolates accounts and only lets mobile create channels", async () => {
    const webCreate = await fetchApi("/api/v1/channels", {
      method: "POST",
      headers: {
        cookie: webCookie,
        origin: "https://api.example.test",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: "不应创建",
        platform: "other",
        slug: "web-cannot-create",
      }),
    });
    expect(webCreate.status).toBe(401);

    const created = await fetchApi("/api/v1/channels", {
      method: "POST",
      headers: mobileHeaders(mobile.token, true),
      body: JSON.stringify({
        name: "小红书交流群",
        platform: "xiaohongshu_group",
        slug: "xiaohongshu-friends",
        expiresAt: "2026-08-20T00:00:00.000Z",
      }),
    });
    expect(created.status).toBe(201);
    const body = await created.json<{ channel: { id: string; accountId: string } }>();
    channelId = body.channel.id;
    expect(body.channel.accountId).toBe(mobile.accountId);

    const browserList = await fetchApi("/api/v1/channels", {
      headers: { cookie: webCookie },
    });
    expect(await browserList.json()).toMatchObject({
      channels: [{ id: channelId, name: "小红书交流群" }],
    });

    const isolated = await fetchApi(`/api/v1/channels/${channelId}`, {
      headers: mobileHeaders(otherMobile.token),
    });
    expect(isolated.status).toBe(404);

    const missingOrigin = await fetchApi(`/api/v1/channels/${channelId}`, {
      method: "PATCH",
      headers: { cookie: webCookie, "content-type": "application/json" },
      body: JSON.stringify({ name: "缺少 Origin" }),
    });
    expect(missingOrigin.status).toBe(403);

    const updated = await fetchApi(`/api/v1/channels/${channelId}`, {
      method: "PATCH",
      headers: {
        cookie: webCookie,
        origin: "https://api.example.test",
        "content-type": "application/json",
      },
      body: JSON.stringify({ name: "小红书交流群" }),
    });
    expect(updated.status).toBe(200);
  });

  it("stores an immutable mobile QR image and serves its stable public URL", async () => {
    const form = new FormData();
    const imageBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    form.set("image", new File([imageBytes], "qr.png", { type: "image/png" }));
    form.set("decodedPayload", "https://example.test/invite/abc");
    const uploaded = await fetchApi(`/api/v1/channels/${channelId}/qr-versions`, {
      method: "POST",
      headers: { ...mobileHeaders(mobile.token), "content-length": "1024" },
      body: form,
    });
    expect(uploaded.status).toBe(201);
    const uploadBody = await uploaded.json<{
      qrVersion: { id: string };
      channel: { activeQrVersionId: string };
    }>();
    expect(uploadBody.channel.activeQrVersionId).toBe(uploadBody.qrVersion.id);

    const page = await fetchApi("/q/xiaohongshu-friends");
    expect(page.status).toBe(200);
    const pageHtml = await page.text();
    expect(pageHtml).toContain("小红书交流群");
    expect(pageHtml).toContain('src="/q/xiaohongshu-friends/image"');
    expect(pageHtml).not.toContain("/image?v=");

    const relayQr = await fetchApi("/q/xiaohongshu-friends/relay.png");
    expect(relayQr.status).toBe(200);
    expect(relayQr.headers.get("content-type")).toBe("image/png");
    expect(relayQr.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(relayQr.headers.get("content-disposition")).toContain(
      "fallinlife-permanent-qr.png",
    );
    const relayBytes = new Uint8Array(await relayQr.arrayBuffer());
    expect(relayBytes.byteLength).toBeGreaterThan(1_000);
    expect([...relayBytes.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);

    const image = await fetchApi("/q/xiaohongshu-friends/image");
    expect(image.status).toBe(200);
    expect(image.headers.get("content-type")).toBe("image/png");
    expect(image.headers.get("cache-control")).toBe("public, no-cache, must-revalidate");
    expect(image.headers.get("access-control-allow-origin")).toBe("*");
    expect(image.headers.get("cross-origin-resource-policy")).toBe("cross-origin");
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(imageBytes);

    const oldEtag = image.headers.get("etag");
    expect(oldEtag).toBeTruthy();
    const replacementBytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4]);
    const replacement = new FormData();
    replacement.set(
      "image",
      new File([replacementBytes], "replacement.png", { type: "image/png" }),
    );
    replacement.set("decodedPayload", "https://example.test/invite/replacement");
    const replaced = await fetchApi(`/api/v1/channels/${channelId}/qr-versions`, {
      method: "POST",
      headers: { ...mobileHeaders(mobile.token), "content-length": "1024" },
      body: replacement,
    });
    expect(replaced.status).toBe(201);

    const sameStableUrl = await fetchApi("/q/xiaohongshu-friends/image", {
      headers: { "if-none-match": oldEtag ?? "" },
    });
    expect(sameStableUrl.status).toBe(200);
    expect(sameStableUrl.headers.get("etag")).not.toBe(oldEtag);
    expect(new Uint8Array(await sameStableUrl.arrayBuffer())).toEqual(replacementBytes);

    const currentEtag = sameStableUrl.headers.get("etag");
    const unchanged = await fetchApi("/q/xiaohongshu-friends/image", {
      headers: { "if-none-match": currentEtag ?? "" },
    });
    expect(unchanged.status).toBe(304);
    expect(unchanged.headers.get("cache-control")).toBe(
      "public, no-cache, must-revalidate",
    );
  });

  it("registers the current mobile device and delivers one reminder", async () => {
    const registered = await fetchApi("/api/v1/devices", {
      method: "POST",
      headers: mobileHeaders(mobile.token, true),
      body: JSON.stringify({
        platform: "ios",
        apnsToken: "a".repeat(64),
        environment: "sandbox",
        notificationsEnabled: true,
      }),
    });
    expect(registered.status).toBe(201);
    expect(await registered.json()).toMatchObject({
      device: { id: mobile.deviceId, platform: "ios", environment: "sandbox" },
    });

    await env.DB.prepare(
      "UPDATE channels SET expires_at = ? WHERE id = ? AND account_id = ?",
    )
      .bind("2020-01-01T00:00:00.000Z", channelId, mobile.accountId)
      .run();
    const result = await sendDueReminders(
      env,
      {
        async send() {
          return { ok: true, status: 200, apnsId: "reminder-id", reason: null };
        },
      },
      new Date("2026-08-12T00:00:00.000Z"),
    );
    expect(result).toMatchObject({ scanned: 1, sent: 1, failed: 0 });
  });

  it("queues every detection until confirmation and keeps commits idempotent", async () => {
    const clientDetectionId = crypto.randomUUID();
    const first = await commitDetectionFor(
      mobile.token,
      detectionMetadata({
        clientDetectionId,
        name: "微信产品交流群",
        creationTime: 1_786_496_400_000.875,
      }),
    );
    expect(first.status).toBe(200);
    const body = await first.json<{
      detection: { id: string; creationTime: number };
      decision: { action: string; automatic: boolean };
      channel: null;
      qrVersion: null;
    }>();
    expect(body.decision).toMatchObject({ action: "needs_review", automatic: false });
    expect(body.detection.creationTime).toBe(1_786_496_400_000);
    expect(body.channel).toBeNull();
    expect(body.qrVersion).toBeNull();

    const objectCount = (
      await env.QR_BUCKET.list({ prefix: `accounts/${mobile.accountId}/` })
    ).objects.length;
    const repeated = await commitDetectionFor(
      mobile.token,
      detectionMetadata({
        clientDetectionId,
        assetId: "changed-on-retry",
        decodedPayload: "https://example.test/invite/changed-on-retry",
      }),
    );
    expect(await repeated.json()).toMatchObject({
      detection: { id: body.detection.id },
      decision: { action: "needs_review", automatic: false },
      channel: null,
      qrVersion: null,
    });
    expect(
      (await env.QR_BUCKET.list({ prefix: `accounts/${mobile.accountId}/` })).objects,
    ).toHaveLength(objectCount);

    const accepted = await fetchApi(`/api/v1/inbox/${body.detection.id}/accept`, {
      method: "POST",
      headers: mobileHeaders(mobile.token),
      body: confirmationForm({
        name: "微信产品交流群",
        platform: "wechat_group",
        createNew: true,
      }),
    });
    const acceptedBody = await accepted.json<{
      detection: { id: string };
      channel: { id: string; slug: string };
      qrVersion: { id: string };
    }>();
    expect(acceptedBody).toMatchObject({
      detection: { id: body.detection.id },
      channel: { id: expect.any(String), slug: expect.any(String) },
      qrVersion: { id: expect.any(String) },
    });
    expect(acceptedBody.channel.slug).toMatch(/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/u);

    const crossAccount = await fetchApi(`/api/v1/detections/${body.detection.id}/undo`, {
      method: "POST",
      headers: mobileHeaders(otherMobile.token),
    });
    expect(crossAccount.status).toBe(404);

    const undone = await fetchApi(`/api/v1/detections/${body.detection.id}/undo`, {
      method: "POST",
      headers: mobileHeaders(mobile.token),
    });
    expect(await undone.json()).toMatchObject({
      detection: { status: "undone", action: "undo" },
      channel: { id: acceptedBody.channel.id },
    });
  });

  it("keeps uncertain detections in a private inbox and accepts them manually", async () => {
    const objectsBeforeDetection = (
      await env.QR_BUCKET.list({ prefix: `accounts/${mobile.accountId}/` })
    ).objects.length;
    const response = await commitDetectionFor(
      mobile.token,
      detectionMetadata({
        name: null,
        platform: null,
        expiresAt: null,
        expirySource: "unknown",
        fieldConfidences: { platform: 0, name: 0, expiresAt: 0 },
      }),
    );
    const body = await response.json<{
      detection: { id: string };
      decision: { action: string };
    }>();
    expect(body.decision.action).toBe("needs_review");
    expect(
      (await env.QR_BUCKET.list({ prefix: `accounts/${mobile.accountId}/` })).objects,
    ).toHaveLength(objectsBeforeDetection);

    const otherInbox = await fetchApi("/api/v1/inbox", {
      headers: mobileHeaders(otherMobile.token),
    });
    expect(await otherInbox.json()).toEqual({ items: [] });

    const accepted = await fetchApi(`/api/v1/inbox/${body.detection.id}/accept`, {
      method: "POST",
      headers: mobileHeaders(mobile.token),
      body: confirmationForm({ name: "手动确认群", platform: "other" }),
    });
    expect(await accepted.json()).toMatchObject({
      detection: { status: "committed", action: "accepted_create" },
      decision: { action: "accepted_create", automatic: false },
      channel: { name: "手动确认群", platform: "other" },
    });
    expect(
      (await env.QR_BUCKET.list({ prefix: `accounts/${mobile.accountId}/` })).objects,
    ).toHaveLength(objectsBeforeDetection + 1);
  });

  it("marks the same payload as duplicate without storing a second QR version", async () => {
    const payload = "https://example.test/invite/repeatable";
    const first = await commitDetectionFor(
      mobile.token,
      detectionMetadata({
        name: "小红书交流群",
        platform: "xiaohongshu_group",
        suggestedChannelId: channelId,
        matchConfidence: 0.98,
        decodedPayload: payload,
      }),
    );
    const firstReview = await first.json<{
      detection: { id: string };
      decision: { action: string; automatic: boolean };
    }>();
    expect(firstReview.decision).toMatchObject({ action: "needs_review", automatic: false });
    const firstAccepted = await fetchApi(`/api/v1/inbox/${firstReview.detection.id}/accept`, {
      method: "POST",
      headers: mobileHeaders(mobile.token),
      body: confirmationForm({ channelId }),
    });
    const firstBody = await firstAccepted.json<{
      channel: { activeQrVersionId: string };
      qrVersion: { id: string };
    }>();
    const second = await commitDetectionFor(
      mobile.token,
      detectionMetadata({
        name: "小红书交流群",
        platform: "xiaohongshu_group",
        suggestedChannelId: channelId,
        matchConfidence: 0.98,
        decodedPayload: payload,
        assetId: "another-photo-of-the-same-code",
      }),
    );
    const secondReview = await second.json<{
      detection: { id: string };
      decision: { action: string; automatic: boolean };
    }>();
    expect(secondReview.decision).toMatchObject({ action: "needs_review", automatic: false });
    const secondAccepted = await fetchApi(`/api/v1/inbox/${secondReview.detection.id}/accept`, {
      method: "POST",
      headers: mobileHeaders(mobile.token),
      body: confirmationForm({ channelId }),
    });
    const secondBody = await secondAccepted.json<{
      detection: { id: string };
      decision: { action: string; automatic: boolean };
      channel: { activeQrVersionId: string };
      qrVersion: { id: string };
    }>();
    expect(secondBody).toMatchObject({
      decision: { action: "duplicate", automatic: false },
      channel: { activeQrVersionId: firstBody.channel.activeQrVersionId },
      qrVersion: { id: firstBody.qrVersion.id },
    });
    expect(
      await env.QR_BUCKET.head(
        `accounts/${mobile.accountId}/detections/${secondBody.detection.id}`,
      ),
    ).toBeNull();
    const count = await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM qr_versions
       WHERE account_id = ? AND channel_id = ? AND decoded_payload_hash = ?`,
    )
      .bind(mobile.accountId, channelId, await sha256(`${mobile.accountId}${payload}`))
      .first<{ count: number }>();
    expect(count?.count).toBe(1);
  });

  it("lets the phone enumerate and revoke the browser cookie", async () => {
    const listed = await fetchApi("/api/v1/web-sessions", {
      headers: mobileHeaders(mobile.token),
    });
    expect(await listed.json()).toMatchObject({
      sessions: [{ id: webSessionId, userAgent: "Test Browser 1" }],
    });

    const crossAccount = await fetchApi(`/api/v1/web-sessions/${webSessionId}`, {
      method: "DELETE",
      headers: mobileHeaders(otherMobile.token),
    });
    expect(crossAccount.status).toBe(404);

    const revoked = await fetchApi(`/api/v1/web-sessions/${webSessionId}`, {
      method: "DELETE",
      headers: mobileHeaders(mobile.token),
    });
    expect(revoked.status).toBe(204);

    const rejected = await fetchApi("/api/v1/me", { headers: { cookie: webCookie } });
    expect(rejected.status).toBe(401);
  });
});

describe("APNs provider", () => {
  it("creates and reuses an ES256 provider JWT with an injectable transport", async () => {
    const keyPair = await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["sign", "verify"],
    );
    const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", keyPair.privateKey));
    let binary = "";
    for (const byte of pkcs8) binary += String.fromCharCode(byte);
    const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(binary)}\n-----END PRIVATE KEY-----`;
    const authorizations: string[] = [];
    const urls: string[] = [];
    const transport: ApnsTransport = {
      async send(url, init) {
        urls.push(url);
        authorizations.push(new Headers(init.headers).get("authorization") ?? "");
        return new Response(null, { status: 200, headers: { "apns-id": "test-apns-id" } });
      },
    };
    const provider = new ApnsProvider(
      {
        keyId: "ABCDEFGHIJ",
        teamId: "KLMNOPQRST",
        topic: "app.example.qr",
        privateKeyPem: pem,
        environment: "production",
      },
      transport,
      () => 1_800_000_000_000,
    );
    const message = { deviceToken: "b".repeat(64), payload: { aps: { alert: "Update" } } };
    expect((await provider.send(message)).ok).toBe(true);
    expect((await provider.send(message)).ok).toBe(true);
    expect(urls[0]).toContain("api.push.apple.com/3/device/");
    expect(authorizations[0]).toBe(authorizations[1]);
    expect(authorizations[0]?.replace("bearer ", "").split(".")).toHaveLength(3);
  });
});
