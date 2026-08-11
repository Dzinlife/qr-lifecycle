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

describe.sequential("QR Lifecycle Worker", () => {
  let token = "";
  let channelId = "";
  let tenantId = "";
  let recoveryCode = "";

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
    const otherToken = "z".repeat(48);
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
