import * as SecureStore from "expo-secure-store";

import type { DeploymentInfo, ScanCursor } from "@qr-lifecycle/contracts";

import { clearPendingDetections } from "@/scanner/pending-detections";

const SESSION_KEY = "qr-lifecycle.mobile-session.v1";
const SCAN_CURSOR_KEY = "qr-lifecycle.photo-cursor.global.v2";

export interface MobileSession {
  token: string;
  deployment: DeploymentInfo;
  deviceId?: string;
}

export async function loadSession(): Promise<MobileSession | null> {
  const value = await SecureStore.getItemAsync(SESSION_KEY);
  if (!value) return null;

  try {
    const parsed = JSON.parse(value) as Partial<MobileSession>;
    if (
      typeof parsed.token !== "string" ||
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

export async function saveSession(session: MobileSession): Promise<void> {
  const previous = await loadSession();
  if (previous && previous.deployment.apiOrigin !== session.deployment.apiOrigin) {
    await Promise.all([clearScanCursor(), clearPendingDetections()]);
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
    seenAssetIds: cursor.seenAssetIds.slice(-50),
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
