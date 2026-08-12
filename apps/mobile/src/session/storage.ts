import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";

import type { DeploymentInfo, ScanCursor } from "@qr-lifecycle/contracts";

import { clearPendingDetections } from "@/scanner/pending-detections";
import { clearReviewImages } from "@/scanner/review-images";

const SESSION_KEY = "fallinlife.mobile-session.v2";
const LEGACY_SESSION_KEY = "qr-lifecycle.mobile-session.v1";
const INSTALLATION_KEY = "fallinlife.installation-id.v1";
// v3 replaces the creation-time cursor with a bounded recent-asset ID window.
// Keeping a new key intentionally performs a one-time rescan after upgrading.
const SCAN_CURSOR_KEY = "qr-lifecycle.photo-cursor.global.v3";

export interface MobileSession {
  token: string;
  accountId: string;
  deviceId: string;
  deployment: DeploymentInfo;
}

export async function loadSession(): Promise<MobileSession | null> {
  await SecureStore.deleteItemAsync(LEGACY_SESSION_KEY);
  const value = await SecureStore.getItemAsync(SESSION_KEY);
  if (!value) return null;

  try {
    const parsed = JSON.parse(value) as Partial<MobileSession>;
    if (
      typeof parsed.token !== "string" ||
      typeof parsed.accountId !== "string" ||
      typeof parsed.deviceId !== "string" ||
      !parsed.deployment ||
      typeof parsed.deployment.apiOrigin !== "string"
    ) {
      await SecureStore.deleteItemAsync(SESSION_KEY);
      return null;
    }
    return parsed as MobileSession;
  } catch {
    await SecureStore.deleteItemAsync(SESSION_KEY);
    return null;
  }
}

export async function getOrCreateInstallationId(): Promise<string> {
  const existing = await SecureStore.getItemAsync(INSTALLATION_KEY);
  if (existing && /^[A-Za-z0-9_-]{43,128}$/u.test(existing)) return existing;
  const randomBytes = await Crypto.getRandomBytesAsync(32);
  const generated = Array.from(randomBytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  await SecureStore.setItemAsync(INSTALLATION_KEY, generated, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  return generated;
}

export async function saveSession(session: MobileSession): Promise<void> {
  const previous = await loadSession();
  if (previous && previous.deployment.apiOrigin !== session.deployment.apiOrigin) {
    await Promise.all([clearScanCursor(), clearPendingDetections(), clearReviewImages()]);
  }
  await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function clearSession(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(SESSION_KEY),
    clearScanCursor(),
    clearPendingDetections(),
    clearReviewImages(),
  ]);
}

/**
 * The ignored channel ID keeps older screens source-compatible while all scans now
 * share one photo-library cursor. A photo asset must never be re-scanned per channel.
 */
export async function loadScanCursor(_legacyChannelId?: string): Promise<ScanCursor | undefined> {
  const value = await SecureStore.getItemAsync(SCAN_CURSOR_KEY);
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as ScanCursor;
    if (!Array.isArray(parsed.seenAssetIds)) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

export async function saveScanCursor(cursor: ScanCursor): Promise<void>;
export async function saveScanCursor(legacyChannelId: string, cursor: ScanCursor): Promise<void>;
export async function saveScanCursor(
  cursorOrLegacyChannelId: ScanCursor | string,
  legacyCursor?: ScanCursor,
): Promise<void> {
  const cursor = typeof cursorOrLegacyChannelId === "string"
    ? legacyCursor
    : cursorOrLegacyChannelId;
  if (!cursor) throw new Error("Scan cursor is required");
  const compact: ScanCursor = {
    seenAssetIds: cursor.seenAssetIds.slice(0, 160),
    ...(cursor.lastCreationTime === undefined
      ? {}
      : { lastCreationTime: cursor.lastCreationTime }),
  };
  await SecureStore.setItemAsync(SCAN_CURSOR_KEY, JSON.stringify(compact), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function clearScanCursor(_legacyChannelId?: string): Promise<void> {
  await SecureStore.deleteItemAsync(SCAN_CURSOR_KEY);
}
