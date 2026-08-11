import * as SecureStore from "expo-secure-store";

import type { DeploymentInfo, ScanCursor } from "@qr-lifecycle/contracts";

import { channelCursorKey } from "@/lib/pure";

const SESSION_KEY = "qr-lifecycle.mobile-session.v1";

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
  await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function clearSession(): Promise<void> {
  await SecureStore.deleteItemAsync(SESSION_KEY);
}

export async function loadScanCursor(channelId: string): Promise<ScanCursor | undefined> {
  const value = await SecureStore.getItemAsync(channelCursorKey(channelId));
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as ScanCursor;
    if (!Array.isArray(parsed.seenAssetIds)) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

export async function saveScanCursor(channelId: string, cursor: ScanCursor): Promise<void> {
  const compact: ScanCursor = {
    seenAssetIds: cursor.seenAssetIds.slice(-50),
    ...(cursor.lastCreationTime === undefined
      ? {}
      : { lastCreationTime: cursor.lastCreationTime }),
  };
  await SecureStore.setItemAsync(channelCursorKey(channelId), JSON.stringify(compact), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function clearScanCursor(channelId: string): Promise<void> {
  await SecureStore.deleteItemAsync(channelCursorKey(channelId));
}
