import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
import * as Device from "expo-device";

import { bootstrapMobile, unregisterDevice } from "@/api/client";
import { AppIdentityNative } from "../../modules/app-identity";
import {
  clearSession,
  getOrCreateInstallationId,
  loadSession,
  saveSession,
  type MobileSession,
} from "@/session/storage";

const OFFICIAL_API_ORIGIN =
  process.env.EXPO_PUBLIC_API_ORIGIN ?? "https://qr-lifecycle-staging.fallinlife.com";

interface AppContextValue {
  hydrated: boolean;
  initializing: boolean;
  session: MobileSession | null;
  initialize(): Promise<void>;
  setDeviceId(deviceId: string | undefined): Promise<void>;
  disconnect(): Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: PropsWithChildren) {
  const [hydrated, setHydrated] = useState(false);
  const [initializing, setInitializing] = useState(false);
  const [session, setSession] = useState<MobileSession | null>(null);

  useEffect(() => {
    let active = true;
    void loadSession()
      .then((stored) => {
        if (active) setSession(stored);
      })
      .finally(() => {
        if (active) setHydrated(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const initialize = useCallback(async () => {
    if (initializing) return;
    setInitializing(true);
    try {
      const installationId = await getOrCreateInstallationId();
      let appTransactionJws: string | undefined;
      if (AppIdentityNative) {
        try {
          appTransactionJws = (await AppIdentityNative.getAppTransactionJws()) ?? undefined;
        } catch {
          // Ad Hoc and development builds are not App Store downloads. The official
          // production service rejects this fallback; staging explicitly permits it.
        }
      }
      const result = await bootstrapMobile(OFFICIAL_API_ORIGIN, {
        installationId,
        deviceName: Device.deviceName ?? Device.modelName ?? "iPhone",
        ...(appTransactionJws ? { appTransactionJws } : {}),
      });
      const next: MobileSession = {
        token: result.sessionToken,
        accountId: result.account.id,
        deviceId: result.device.id,
        deployment: result.deployment,
      };
      await saveSession(next);
      setSession(next);
    } finally {
      setInitializing(false);
    }
  }, [initializing]);

  const setDeviceId = useCallback(
    async (deviceId: string | undefined) => {
      if (!session || !deviceId || deviceId === session.deviceId) return;
      const next: MobileSession = { ...session, deviceId };
      await saveSession(next);
      setSession(next);
    },
    [session],
  );

  const disconnect = useCallback(async () => {
    const current = session;
    setSession(null);
    await clearSession();
    if (current) {
      try {
        await unregisterDevice(current);
      } catch {
        // Local authority is removed even when the official service is unavailable.
      }
    }
  }, [session]);

  const value = useMemo(
    () => ({ hydrated, initializing, session, initialize, setDeviceId, disconnect }),
    [disconnect, hydrated, initialize, initializing, session, setDeviceId],
  );
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) throw new Error("useApp must be used inside AppProvider");
  return value;
}
