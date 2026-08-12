import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { ApnsProvider, type ApnsTransport } from "../src/apns";
import { sha256 } from "../src/crypto";
import "../src/index";
import { sendDueReminders } from "../src/reminders";

interface ErrorResponse {
  error: { code: string; message: string };
}

async function fetchApi(path: string, init?: RequestInit): Promise<Response> {
  return exports.default.fetch(`https://api.example.test${path}`, init);
}

function detectionForm(
  overrides: Record<string, unknown> = {},
  imageBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
): FormData {
  const form = new FormData();
  form.set(
    "metadata",
    JSON.stringify({
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
    }),
  );
  form.set("image", new File([imageBytes], "qr.png", { type: "image/png" }));
  return form;
}

async function commitDetectionFor(token: string, form: FormData): Promise<Response> {
  return fetchApi("/api/v1/detections/commit", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
}

describe.sequential("QR Lifecycle Worker", () => {
  let token = "";
  let channelId = "";
  let tenantId = "";
  let recoveryCode = "";
  let otherToken = "";
  let autoCreatedDetectionId = "";

  it("bootstraps a self-hosted deployment exactly once", async () => {
    const initialHealth = await fetchApi("/health");
    expect(initialHealth.status).toBe(200);
    expect(await initialHealth.json()).toMatchObject({ ok: true, bootstrapped: false });

    const response = await fetchApi("/api/v1/bootstrap", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "owner@example.test",
        displayName: "Owner",
        tenantName: "Example workspace",
      }),
    });
    expect(response.status).toBe(201);
    const body = await response.json<{
      sessionToken: string;
      recoveryCode: string;
      tenant: { id: string };
    }>();
    token = body.sessionToken;
    recoveryCode = body.recoveryCode;
    expect(token.length).toBeGreaterThan(32);
    expect(recoveryCode.length).toBeGreaterThan(32);

    const repeated = await fetchApi("/api/v1/bootstrap", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(repeated.status).toBe(409);
    expect((await repeated.json<ErrorResponse>()).error.code).toBe(
      "already_bootstrapped",
    );
  });

  it("reissues a web session using the bootstrap recovery code", async () => {
    const requested = await fetchApi("/api/v1/auth/request-code", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "owner@example.test" }),
    });
    expect(requested.status).toBe(202);
    expect(await requested.json()).toMatchObject({ method: "recovery_code" });

    const verified = await fetchApi("/api/v1/auth/verify-code", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "owner@example.test",
        recoveryCode,
      }),
    });
    expect(verified.status).toBe(200);
    const body = await verified.json<{ sessionToken: string }>();
    expect(body.sessionToken).not.toBe(token);
  });

  it("authenticates hashed bearer sessions and manages channels", async () => {
    const unauthorized = await fetchApi("/api/v1/channels");
    expect(unauthorized.status).toBe(401);

    const created = await fetchApi("/api/v1/channels", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: "小红书交流群",
        platform: "xiaohongshu_group",
        slug: "xiaohongshu-friends",
        expiresAt: "2026-08-20T00:00:00.000Z",
      }),
    });
    expect(created.status).toBe(201);
    const body = await created.json<{ channel: { id: string; tenantId: string } }>();
    channelId = body.channel.id;
    tenantId = body.channel.tenantId;

    const listed = await fetchApi("/api/v1/channels", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(await listed.json()).toMatchObject({
      channels: [{ id: channelId, name: "小红书交流群" }],
    });

    const otherTenantId = crypto.randomUUID();
    const otherUserId = crypto.randomUUID();
    otherToken = "z".repeat(48);
    const now = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO users (id,email,display_name,created_at,updated_at) VALUES (?,?,?,?,?)",
      ).bind(otherUserId, "other@example.test", "Other", now, now),
      env.DB.prepare(
        "INSERT INTO tenants (id,name,slug,created_at,updated_at) VALUES (?,?,?,?,?)",
      ).bind(otherTenantId, "Other workspace", "other", now, now),
      env.DB.prepare(
        "INSERT INTO memberships (tenant_id,user_id,role,created_at) VALUES (?,?,'owner',?)",
      ).bind(otherTenantId, otherUserId, now),
      env.DB.prepare(
        `INSERT INTO sessions
         (id,tenant_id,user_id,token_hash,kind,expires_at,created_at,last_used_at)
         VALUES (?,?,?,?,'web',?,?,?)`,
      ).bind(
        crypto.randomUUID(),
        otherTenantId,
        otherUserId,
        await sha256(otherToken),
        "2030-01-01T00:00:00.000Z",
        now,
        now,
      ),
    ]);
    const isolated = await fetchApi(`/api/v1/channels/${channelId}`, {
      headers: { authorization: `Bearer ${otherToken}` },
    });
    expect(isolated.status).toBe(404);
  });

  it("stores an immutable QR image and serves the stable public URL", async () => {
    const form = new FormData();
    form.set(
      "image",
      new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], "qr.png", {
        type: "image/png",
      }),
    );
    form.set("decodedPayload", "https://example.test/invite/abc");
    const uploaded = await fetchApi(`/api/v1/channels/${channelId}/qr-versions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-length": "1024",
      },
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
    expect(await page.text()).toContain("小红书交流群");

    const image = await fetchApi("/q/xiaohongshu-friends/image");
    expect(image.status).toBe(200);
    expect(image.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(
      new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    );
  });

  it("pairs a mobile session once and registers an APNs device", async () => {
    const invalid = await fetchApi("/api/v1/pair", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: "this-is-a-recovery-code-and-not-a-pairing-code" }),
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({
      error: { code: "invalid_pairing_code" },
    });

    const pairingResponse = await fetchApi("/api/v1/pairing-codes", {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    });
    const pairing = await pairingResponse.json<{
      pairingCode: { code: string; expiresAt: string };
    }>();
    const paired = await fetchApi("/api/v1/pair", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: pairing.pairingCode.code }),
    });
    expect(paired.status).toBe(200);
    const pairedBody = await paired.json<{ sessionToken: string }>();

    const repeated = await fetchApi("/api/v1/pair", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: pairing.pairingCode.code }),
    });
    expect(repeated.status).toBe(410);

    const registered = await fetchApi("/api/v1/devices", {
      method: "POST",
      headers: {
        authorization: `Bearer ${pairedBody.sessionToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ apnsToken: "a".repeat(64) }),
    });
    expect(registered.status).toBe(201);
    expect(await registered.json()).toMatchObject({
      device: { platform: "ios", environment: "production" },
    });

    await env.DB.prepare(
      "UPDATE channels SET expires_at = ? WHERE id = ? AND tenant_id = ?",
    )
      .bind("2020-01-01T00:00:00.000Z", channelId, tenantId)
      .run();
    const reminderResult = await sendDueReminders(
      env,
      {
        async send() {
          return {
            ok: true,
            status: 200,
            apnsId: "reminder-apns-id",
            reason: null,
          };
        },
      },
      new Date("2026-08-12T00:00:00.000Z"),
    );
    expect(reminderResult).toMatchObject({ scanned: 1, sent: 1, failed: 0 });
  });

  it("auto-creates a high-confidence detection idempotently and disables it on undo", async () => {
    const clientDetectionId = crypto.randomUUID();
    const first = await commitDetectionFor(
      token,
      detectionForm({
        clientDetectionId,
        name: "微信产品交流群",
        creationTime: 1_786_496_400_000.875,
      }),
    );
    expect(first.status).toBe(200);
    const body = await first.json<{
      detection: { id: string; action: string; status: string; creationTime: number };
      decision: { action: string; automatic: boolean };
      channel: { id: string; slug: string; disabledAt: string | null };
      qrVersion: { id: string };
    }>();
    expect(body.decision).toMatchObject({ action: "auto_create", automatic: true });
    expect(body.detection.creationTime).toBe(1_786_496_400_000);
    expect(body.channel.slug).toMatch(/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/u);
    expect(body.channel.disabledAt).toBeNull();
    autoCreatedDetectionId = body.detection.id;

    const objectCountBeforeRetry = (
      await env.QR_BUCKET.list({ prefix: `tenants/${tenantId}/` })
    ).objects.length;

    const crossTenantUndo = await fetchApi(
      `/api/v1/detections/${body.detection.id}/undo`,
      { method: "POST", headers: { authorization: `Bearer ${otherToken}` } },
    );
    expect(crossTenantUndo.status).toBe(404);

    const repeated = await commitDetectionFor(
      token,
      detectionForm({
        clientDetectionId,
        assetId: "changed-on-retry",
        decodedPayload: "https://example.test/invite/changed-on-retry",
      }),
    );
    expect(repeated.status).toBe(200);
    expect(await repeated.json()).toMatchObject({
      detection: { id: body.detection.id, action: "auto_create" },
      channel: { id: body.channel.id },
      qrVersion: { id: body.qrVersion.id },
    });
    expect(
      (await env.QR_BUCKET.list({ prefix: `tenants/${tenantId}/` })).objects,
    ).toHaveLength(objectCountBeforeRetry);

    const undone = await fetchApi(`/api/v1/detections/${body.detection.id}/undo`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(undone.status).toBe(200);
    expect(await undone.json()).toMatchObject({
      detection: { status: "undone", action: "undo" },
      channel: { id: body.channel.id },
    });
    const disabled = await env.DB.prepare(
      "SELECT disabled_at FROM channels WHERE id = ? AND tenant_id = ?",
    )
      .bind(body.channel.id, tenantId)
      .first<{ disabled_at: string | null }>();
    expect(disabled?.disabled_at).not.toBeNull();
  });

  it("auto-updates a tenant-local suggested channel and restores it on undo", async () => {
    const before = await env.DB.prepare(
      "SELECT active_qr_version_id, expires_at FROM channels WHERE id = ? AND tenant_id = ?",
    )
      .bind(channelId, tenantId)
      .first<{ active_qr_version_id: string | null; expires_at: string | null }>();
    const response = await commitDetectionFor(
      token,
      detectionForm({
        name: "小红书交流群",
        platform: "xiaohongshu_group",
        suggestedChannelId: channelId,
        matchConfidence: 0.97,
        decodedPayload: "https://example.test/invite/new-xhs-code",
        expiresAt: "2026-08-22T00:00:00.000Z",
      }),
    );
    expect(response.status).toBe(200);
    const body = await response.json<{
      detection: { id: string };
      decision: { action: string };
      channel: { id: string; expiresAt: string; activeQrVersionId: string };
    }>();
    expect(body.decision.action).toBe("auto_update");
    expect(body.channel).toMatchObject({
      id: channelId,
      expiresAt: "2026-08-22T00:00:00.000Z",
    });
    expect(body.channel.activeQrVersionId).not.toBe(before?.active_qr_version_id);

    const undone = await fetchApi(`/api/v1/detections/${body.detection.id}/undo`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(undone.status).toBe(200);
    expect(await undone.json()).toMatchObject({
      detection: { status: "undone" },
      channel: {
        id: channelId,
        activeQrVersionId: before?.active_qr_version_id,
        expiresAt: before?.expires_at,
      },
    });
  });

  it("keeps low-confidence detections in the inbox and isolates review actions by tenant", async () => {
    const response = await commitDetectionFor(
      token,
      detectionForm({
        name: "不确定的群",
        fieldConfidences: { platform: 0.7, name: 0.72, expiresAt: 0.4 },
        suggestedChannelId: channelId,
        matchConfidence: 0.7,
      }),
    );
    expect(response.status).toBe(200);
    const body = await response.json<{
      detection: { id: string; suggestedChannelId: string | null };
      decision: { action: string };
    }>();
    expect(body.decision.action).toBe("needs_review");
    expect(body.detection.suggestedChannelId).toBe(channelId);

    const inbox = await fetchApi("/api/v1/inbox", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(await inbox.json()).toMatchObject({
      items: [
        {
          detection: { id: body.detection.id },
          suggestedChannel: { id: channelId },
        },
      ],
    });
    const otherInbox = await fetchApi("/api/v1/inbox", {
      headers: { authorization: `Bearer ${otherToken}` },
    });
    expect(await otherInbox.json()).toEqual({ items: [] });
    const crossTenantIgnore = await fetchApi(
      `/api/v1/inbox/${body.detection.id}/ignore`,
      { method: "POST", headers: { authorization: `Bearer ${otherToken}` } },
    );
    expect(crossTenantIgnore.status).toBe(404);
    const crossTenantAccept = await fetchApi(
      `/api/v1/inbox/${body.detection.id}/accept`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${otherToken}`,
          "content-type": "application/json",
        },
        body: "{}",
      },
    );
    expect(crossTenantAccept.status).toBe(404);

    const ignored = await fetchApi(`/api/v1/inbox/${body.detection.id}/ignore`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(ignored.status).toBe(200);
    expect(await ignored.json()).toMatchObject({
      detection: { id: body.detection.id, status: "ignored", action: "ignore" },
    });
  });

  it("accepts a low-confidence detection into a new channel", async () => {
    const response = await commitDetectionFor(
      token,
      detectionForm({
        name: null,
        platform: null,
        expiresAt: null,
        expirySource: "unknown",
        fieldConfidences: { platform: 0, name: 0, expiresAt: 0 },
      }),
    );
    const detection = await response.json<{ detection: { id: string } }>();
    const accepted = await fetchApi(`/api/v1/inbox/${detection.detection.id}/accept`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ name: "手动确认群", platform: "other" }),
    });
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toMatchObject({
      detection: { status: "committed", action: "accepted_create" },
      decision: { action: "accepted_create", automatic: false },
      channel: { name: "手动确认群", platform: "other" },
    });
  });

  it("does not trust a forged high-confidence suggested channel", async () => {
    const response = await commitDetectionFor(
      token,
      detectionForm({
        name: "完全不同的群",
        platform: "xiaohongshu_group",
        suggestedChannelId: channelId,
        matchConfidence: 0.99,
        fieldConfidences: { platform: 0.99, name: 0.99, expiresAt: 0.99 },
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      detection: { suggestedChannelId: channelId, status: "needs_review" },
      decision: { action: "needs_review", automatic: false, confidence: 0 },
    });
    expect(autoCreatedDetectionId).not.toBe("");
  });

  it("marks a second detection of the same QR as duplicate without replacing the active version", async () => {
    const payload = "https://example.test/invite/repeatable";
    const first = await commitDetectionFor(
      token,
      detectionForm({
        name: "小红书交流群",
        platform: "xiaohongshu_group",
        suggestedChannelId: channelId,
        matchConfidence: 0.98,
        decodedPayload: payload,
      }),
    );
    const firstBody = await first.json<{
      channel: { activeQrVersionId: string };
      qrVersion: { id: string };
    }>();
    const second = await commitDetectionFor(
      token,
      detectionForm({
        name: "小红书交流群",
        platform: "xiaohongshu_group",
        suggestedChannelId: channelId,
        matchConfidence: 0.98,
        decodedPayload: payload,
        assetId: "another-photo-of-the-same-code",
      }),
    );
    expect(second.status).toBe(200);
    const secondBody = await second.json<{
      detection: { id: string };
      decision: { action: string; automatic: boolean };
      channel: { activeQrVersionId: string };
      qrVersion: { id: string };
    }>();
    expect(secondBody).toMatchObject({
      decision: { action: "duplicate", automatic: true },
      channel: { activeQrVersionId: firstBody.channel.activeQrVersionId },
      qrVersion: { id: firstBody.qrVersion.id },
    });
    expect(
      await env.QR_BUCKET.head(
        `tenants/${tenantId}/detections/${secondBody.detection.id}`,
      ),
    ).toBeNull();
    const count = await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM qr_versions
       WHERE tenant_id = ? AND channel_id = ? AND decoded_payload_hash = ?`,
    )
      .bind(tenantId, channelId, await sha256(`${tenantId}${payload}`))
      .first<{ count: number }>();
    expect(count?.count).toBe(1);
  });
});

describe("APNs provider", () => {
  it("creates and reuses an ES256 provider JWT with an injectable transport", async () => {
    const keyPair = await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["sign", "verify"],
    );
    const pkcs8 = new Uint8Array(
      await crypto.subtle.exportKey("pkcs8", keyPair.privateKey),
    );
    let binary = "";
    for (const byte of pkcs8) binary += String.fromCharCode(byte);
    const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(binary)}\n-----END PRIVATE KEY-----`;
    const authorizations: string[] = [];
    const urls: string[] = [];
    const transport: ApnsTransport = {
      async send(url, init) {
        urls.push(url);
        authorizations.push(new Headers(init.headers).get("authorization") ?? "");
        return new Response(null, {
          status: 200,
          headers: { "apns-id": "test-apns-id" },
        });
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
    const message = {
      deviceToken: "b".repeat(64),
      payload: { aps: { alert: "Update" } },
    };
    expect((await provider.send(message)).ok).toBe(true);
    expect((await provider.send(message)).ok).toBe(true);
    expect(urls[0]).toContain("api.push.apple.com/3/device/");
    expect(authorizations[0]).toBe(authorizations[1]);
    expect(authorizations[0]?.replace("bearer ", "").split(".")).toHaveLength(3);
  });
});
