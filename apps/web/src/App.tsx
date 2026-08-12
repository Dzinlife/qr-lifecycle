import { useCallback, useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import { api, ApiError, type MeResponse } from "./api/client";
import { AppShell } from "./components/AppShell";
import { ErrorState, LoadingState } from "./components/States";
import { ChannelDetailPage } from "./pages/ChannelDetailPage";
import { ChannelFormPage } from "./pages/ChannelFormPage";
import { ConnectPage } from "./pages/ConnectPage";
import { DashboardPage } from "./pages/DashboardPage";
import { SettingsPage } from "./pages/SettingsPage";

export function App() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [checking, setChecking] = useState(true);
  const [needsBinding, setNeedsBinding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const checkSession = useCallback(async () => {
    setChecking(true);
    setError(null);
    try {
      setMe(await api.me());
      setNeedsBinding(false);
    } catch (caught) {
      setMe(null);
      if (caught instanceof ApiError && caught.status === 401) {
        setNeedsBinding(true);
      } else {
        setError(caught instanceof ApiError ? caught.message : "服务暂时不可用。");
      }
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void checkSession();
  }, [checkSession]);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      setMe(null);
      setNeedsBinding(true);
    }
  }, []);

  if (checking) {
    return <div className="standalone-state"><LoadingState label="正在读取浏览器授权…" /></div>;
  }
  if (error) {
    return <div className="standalone-state"><ErrorState message={error} onRetry={() => void checkSession()} /></div>;
  }
  if (needsBinding || !me) {
    return <ConnectPage onAuthenticated={checkSession} />;
  }

  return (
    <AppShell me={me} onLogout={() => void logout()}>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/channels/:channelId" element={<ChannelDetailPage />} />
        <Route path="/channels/:channelId/edit" element={<ChannelFormPage />} />
        <Route path="/settings" element={<SettingsPage onLogout={() => void logout()} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  );
}
