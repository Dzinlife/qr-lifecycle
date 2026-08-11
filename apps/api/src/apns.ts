import { base64UrlEncode, pemToPkcs8 } from "./crypto";

export interface ApnsConfig {
  keyId: string;
  teamId: string;
  topic: string;
  privateKeyPem: string;
  environment: "production" | "sandbox";
}

export interface ApnsMessage {
  deviceToken: string;
  payload: Record<string, unknown>;
  collapseId?: string;
  expiration?: number;
}

export interface ApnsResult {
  ok: boolean;
  status: number;
  apnsId: string | null;
  reason: string | null;
}

export interface ApnsTransport {
  send(url: string, init: RequestInit): Promise<Response>;
}

const fetchTransport: ApnsTransport = {
  async send(url, init) {
    return fetch(url, init);
  },
};

// Provider tokens are deployment-level credentials, not request state. The
// isolate-local cache avoids minting a fresh token on every 15-minute cron run;
// a cold isolate safely recreates it.
const providerTokenCache = new Map<
  string,
  { value: Promise<string>; issuedAt: number }
>();

async function createProviderToken(
  config: ApnsConfig,
  issuedAtSeconds: number,
): Promise<string> {
  const header = base64UrlEncode(
    JSON.stringify({ alg: "ES256", kid: config.keyId }),
  );
  const claims = base64UrlEncode(
    JSON.stringify({ iss: config.teamId, iat: issuedAtSeconds }),
  );
  const signingInput = `${header}.${claims}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToPkcs8(config.privateKeyPem.replaceAll("\\n", "\n")),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`;
}

function responseReason(value: unknown): string | null {
  if (
    typeof value === "object" &&
    value !== null &&
    "reason" in value &&
    typeof value.reason === "string"
  ) {
    return value.reason;
  }
  return null;
}

export class ApnsProvider {
  readonly #config: ApnsConfig;
  readonly #transport: ApnsTransport;
  readonly #now: () => number;

  constructor(
    config: ApnsConfig,
    transport: ApnsTransport = fetchTransport,
    now: () => number = Date.now,
  ) {
    this.#config = config;
    this.#transport = transport;
    this.#now = now;
  }

  async #providerToken(): Promise<string> {
    const nowSeconds = Math.floor(this.#now() / 1_000);
    const cacheKey = `${this.#config.teamId}:${this.#config.keyId}`;
    const cached = providerTokenCache.get(cacheKey);
    if (
      cached &&
      nowSeconds - cached.issuedAt >= 0 &&
      nowSeconds - cached.issuedAt < 50 * 60
    ) {
      return cached.value;
    }
    if (providerTokenCache.size >= 8) providerTokenCache.clear();
    const value = createProviderToken(this.#config, nowSeconds);
    providerTokenCache.set(cacheKey, { value, issuedAt: nowSeconds });
    try {
      return await value;
    } catch (error) {
      providerTokenCache.delete(cacheKey);
      throw error;
    }
  }

  async send(message: ApnsMessage): Promise<ApnsResult> {
    const host =
      this.#config.environment === "sandbox"
        ? "api.sandbox.push.apple.com"
        : "api.push.apple.com";
    const headers = new Headers({
      authorization: `bearer ${await this.#providerToken()}`,
      "apns-push-type": "alert",
      "apns-topic": this.#config.topic,
      "apns-priority": "10",
      "content-type": "application/json",
    });
    if (message.collapseId) headers.set("apns-collapse-id", message.collapseId);
    if (message.expiration !== undefined) {
      headers.set("apns-expiration", String(message.expiration));
    }

    const response = await this.#transport.send(
      `https://${host}/3/device/${encodeURIComponent(message.deviceToken)}`,
      {
        method: "POST",
        headers,
        body: JSON.stringify(message.payload),
      },
    );
    let reason: string | null = null;
    if (!response.ok) {
      try {
        const body: unknown = await response.json();
        reason = responseReason(body);
      } catch {
        reason = "Invalid APNs error response";
      }
    }
    return {
      ok: response.ok,
      status: response.status,
      apnsId: response.headers.get("apns-id"),
      reason,
    };
  }
}

export function createApnsProviderFromEnv(env: Env): ApnsProvider | null {
  const privateKey: unknown = Reflect.get(env, "APNS_PRIVATE_KEY");
  const privateKeyPem =
    typeof privateKey === "string" && privateKey.trim().length > 0
      ? privateKey.trim()
      : undefined;
  if (
    !privateKeyPem ||
    !env.APNS_KEY_ID ||
    !env.APNS_TEAM_ID ||
    !env.APNS_TOPIC
  ) {
    return null;
  }
  return new ApnsProvider({
    keyId: env.APNS_KEY_ID,
    teamId: env.APNS_TEAM_ID,
    topic: env.APNS_TOPIC,
    privateKeyPem,
    environment: env.APNS_ENVIRONMENT,
  });
}
