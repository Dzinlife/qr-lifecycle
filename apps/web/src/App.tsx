import { useCallback, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { api } from "./api/client";
import { AppShell } from "./components/AppShell";
import { AuthPage } from "./pages/AuthPage";
import { ChannelDetailPage } from "./pages/ChannelDetailPage";
import { ChannelFormPage } from "./pages/ChannelFormPage";
import { DashboardPage } from "./pages/DashboardPage";
import { PairingPage } from "./pages/PairingPage";
import { SettingsPage } from "./pages/SettingsPage";

export function App() {
  const [authenticated, setAuthenticated] = useState(() => Boolean(api.getSessionToken()));
  const logout = useCallback(() => {
    api.clearSession();
    setAuthenticated(false);
  }, []);

  if (!authenticated) {
    return <AuthPage onAuthenticated={() => setAuthenticated(true)} />;
  }

  return (
    <AppShell onLogout={logout}>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/channels/new" element={<ChannelFormPage />} />
        <Route path="/channels/:channelId" element={<ChannelDetailPage />} />
        <Route path="/channels/:channelId/edit" element={<ChannelFormPage />} />
        <Route path="/pairing" element={<PairingPage />} />
        <Route path="/settings" element={<SettingsPage onLogout={logout} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  );
}
