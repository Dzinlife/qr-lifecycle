import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";

import { pairDeployment, unregisterDevice } from "@/api/client";
import { normalizeApiOrigin, normalizePairingCode } from "@/lib/pure";
import {
  clearSession,
  loadSession,
  saveSession,
  type MobileSession,
} from "@/session/storage";

interface AppContextValue {
  hydrated: boolean;
  session: MobileSession | null;
  pair(origin: string, code: string): Promise<void>;
  setDeviceId(deviceId: string | undefined): Promise<void>;
  disconnect(): Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: PropsWithChildren) {
  const [hydrated, setHydrated] = useState(false);
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

  const pair = useCallback(async (originInput: string, codeInput: string) => {
    const origin = normalizeApiOrigin(originInput);
    const code = normalizePairingCode(codeInput);
    if (!code) throw new Error("请输入配对码");
    const paired = await pairDeployment(origin, code);
    const next: MobileSession = {
      token: paired.sessionToken,
      deployment: paired.deployment,
    };
    await saveSession(next);
    setSession(next);
  }, []);

  const setDeviceId = useCallback(
    async (deviceId: string | undefined) => {
      if (!session) return;
      const next: MobileSession = {
        ...session,
        ...(deviceId === undefined ? {} : { deviceId }),
      };
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
        // Local authority is removed even if a self-hosted deployment is offline.
      }
    }
  }, [session]);

  const value = useMemo(
    () => ({ hydrated, session, pair, setDeviceId, disconnect }),
    [disconnect, hydrated, pair, session, setDeviceId],
  );
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) throw new Error("useApp must be used inside AppProvider");
  return value;
}
