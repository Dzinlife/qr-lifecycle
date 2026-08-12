import { Buffer } from "node:buffer";

import { sha256 } from "./crypto";
import { HttpError } from "./http";

// Apple Root CA - G3, downloaded from Apple's certificate authority and
// fingerprinted as 63:34:3A:BF:B8:9A:6A:03:EB:B5:7E:9B:3F:5F:A7:BE:
// 7C:4F:5C:75:6F:30:17:B3:A8:C4:88:C3:65:3E:91:79.
const APPLE_ROOT_CA_G3 = Buffer.from(
  "MIICQzCCAcmgAwIBAgIILcX8iNLFS5UwCgYIKoZIzj0EAwMwZzEbMBkGA1UEAwwSQXBwbGUgUm9vdCBDQSAtIEczMSYwJAYDVQQLDB1BcHBsZSBDZXJ0aWZpY2F0aW9uIEF1dGhvcml0eTETMBEGA1UECgwKQXBwbGUgSW5jLjELMAkGA1UEBhMCVVMwHhcNMTQwNDMwMTgxOTA2WhcNMzkwNDMwMTgxOTA2WjBnMRswGQYDVQQDDBJBcHBsZSBSb290IENBIC0gRzMxJjAkBgNVBAsMHUFwcGxlIENlcnRpZmljYXRpb24gQXV0aG9yaXR5MRMwEQYDVQQKDApBcHBsZSBJbmMuMQswCQYDVQQGEwJVUzB2MBAGByqGSM49AgEGBSuBBAAiA2IABJjpLz1AcqTtkyJygRMc3RCV8cWjTnHcFBbZDuWmBSp3ZHtfTjjTuxxEtX/1H7YyYl3J6YRbTzBPEVoA/VhYDKX1DyxNB0cTddqXl5dvMVztK517IDvYuVTZXpmkOlEKMaNCMEAwHQYDVR0OBBYEFLuw3qFYM4iapIqZ3r6966/ayySrMA8GA1UdEwEB/wQFMAMBAf8wDgYDVR0PAQH/BAQDAgEGMAoGCCqGSM49BAMDA2gAMGUCMQCD6cHEFl4aXTQY2e3v9GwOAEZLuN+yRhHFD/3meoyhpmvOwgPUnPWTxnS4at+qIxUCMG1mihDK1A3UT82NQz60imOlM27jbdoXt2QfyFMm+YhidDkLF1vLUagM6BgD56KyKA==",
  "base64",
);

export interface VerifiedMobileIdentity {
  provider: "apple_app_transaction" | "development_installation";
  subjectHash: string;
  environment: "Production" | "Sandbox" | "Development";
}

function configuredEnvironments(env: Env): Set<string> {
  return new Set(
    env.APPLE_IDENTITY_ENVIRONMENTS.split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

function unverifiedReceiptType(jws: string): "Production" | "Sandbox" {
  const parts = jws.split(".");
  if (parts.length !== 3 || !parts[1]) {
    throw new HttpError(400, "invalid_app_identity", "App identity is not a valid JWS");
  }
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as {
      receiptType?: unknown;
    };
    if (payload.receiptType === "Production") return "Production";
    if (payload.receiptType === "Sandbox") return "Sandbox";
  } catch {
    // A generic public error is returned below; do not echo signed payload details.
  }
  throw new HttpError(400, "invalid_app_identity", "App identity environment is not supported");
}

async function verifiedAppleIdentity(jws: string, env: Env): Promise<VerifiedMobileIdentity> {
  if (jws.length > 65_536) {
    throw new HttpError(413, "app_identity_too_large", "App identity is too large");
  }
  const environment = unverifiedReceiptType(jws);
  if (!configuredEnvironments(env).has(environment)) {
    throw new HttpError(403, "app_identity_environment_denied", "App identity environment is not allowed");
  }
  const appAppleId = environment === "Production"
    ? Number.parseInt(env.APP_APPLE_ID, 10)
    : undefined;
  if (environment === "Production" && !Number.isSafeInteger(appAppleId)) {
    throw new Error("APP_APPLE_ID must be configured for production AppTransaction verification");
  }

  try {
    // Apple's package pulls in jsrsasign, which initializes random state when the
    // module is evaluated. Cloudflare forbids that work in global scope, so load
    // the official verifier inside the request handler instead.
    const { Environment, SignedDataVerifier } = await import(
      "@apple/app-store-server-library"
    );
    const verifierEnvironment = environment === "Production"
      ? Environment.PRODUCTION
      : Environment.SANDBOX;
    const verifier = new SignedDataVerifier(
      [APPLE_ROOT_CA_G3],
      false,
      verifierEnvironment,
      env.APP_BUNDLE_ID,
      appAppleId,
    );
    const decoded = await verifier.verifyAndDecodeAppTransaction(jws);
    if (!decoded.appTransactionId) {
      throw new Error("Verified AppTransaction has no appTransactionId");
    }
    return {
      provider: "apple_app_transaction",
      subjectHash: await sha256(`apple_app_transaction:${environment}:${decoded.appTransactionId}`),
      environment,
    };
  } catch (error) {
    console.error(JSON.stringify({
      message: "app transaction verification failed",
      error: error instanceof Error ? error.message : String(error),
    }));
    throw new HttpError(401, "invalid_app_identity", "Apple could not verify this app identity");
  }
}

async function developmentIdentity(
  installationId: string,
  env: Env,
): Promise<VerifiedMobileIdentity> {
  if (env.ALLOW_DEVELOPMENT_IDENTITY !== "true") {
    throw new HttpError(401, "app_identity_required", "A verified App Store identity is required");
  }
  if (!/^[A-Za-z0-9_-]{43,128}$/u.test(installationId)) {
    throw new HttpError(400, "invalid_installation_identity", "Development installation identity is invalid");
  }
  return {
    provider: "development_installation",
    subjectHash: await sha256(`development_installation:${installationId}`),
    environment: "Development",
  };
}

export async function verifyMobileIdentity(
  input: { appTransactionJws?: string; installationId?: string },
  env: Env,
): Promise<VerifiedMobileIdentity> {
  if (input.appTransactionJws) return verifiedAppleIdentity(input.appTransactionJws, env);
  if (input.installationId) return developmentIdentity(input.installationId, env);
  throw new HttpError(400, "app_identity_required", "A mobile app identity is required");
}
