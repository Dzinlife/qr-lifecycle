import { useCallback, useState } from "react";
import { Linking, StyleSheet, Text, View } from "react-native";
import {
  Redirect,
  useFocusEffect,
  useLocalSearchParams,
  useRouter,
} from "expo-router";

import type { WebSession } from "@qr-lifecycle/contracts";

import { listWebSessions, revokeWebSession } from "@/api/client";

import {
  Button,
  Card,
  Notice,
  Screen,
  textStyles,
} from "@/components/ui";
import { useApp } from "@/context/app-context";
import {
  enablePushNotifications,
  type PushRegistrationState,
} from "@/notifications/push";

export default function SettingsScreen() {
  const router = useRouter();
  const { bindingApprovedAt } = useLocalSearchParams<{ bindingApprovedAt?: string }>();
  const { hydrated, session, setDeviceId, disconnect } = useApp();
  const [pushState, setPushState] = useState<PushRegistrationState | null>(null);
  const [enablingPush, setEnablingPush] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [webSessions, setWebSessions] = useState<WebSession[]>([]);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [bindingStatusVisible, setBindingStatusVisible] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const refreshWebSessions = useCallback(async () => {
    if (!session) return;
    try {
      setWebSessions(await listWebSessions(session));
      setSessionsError(null);
    } catch {
      setSessionsError("暂时无法读取已授权浏览器");
    }
  }, [session]);

  useFocusEffect(useCallback(() => {
    let cancelled = false;
    const refresh = () => {
      if (!cancelled) void refreshWebSessions();
    };

    refresh();
    if (!bindingApprovedAt) {
      return () => {
        cancelled = true;
      };
    }

    setBindingStatusVisible(true);
    const retryTimers = [1_200, 3_000, 5_000].map((delay) => setTimeout(refresh, delay));
    const finishTimer = setTimeout(() => {
      if (cancelled) return;
      setBindingStatusVisible(false);
      router.setParams({ bindingApprovedAt: undefined });
    }, 5_500);

    return () => {
      cancelled = true;
      retryTimers.forEach(clearTimeout);
      clearTimeout(finishTimer);
    };
  }, [bindingApprovedAt, refreshWebSessions, router]));

  if (hydrated && !session) return <Redirect href="/onboarding" />;
  if (!session) return null;

  const enablePush = async () => {
    setEnablingPush(true);
    const state = await enablePushNotifications(session);
    setPushState(state);
    if (state.status === "registered") await setDeviceId(state.deviceId);
    setEnablingPush(false);
  };

  const disconnectDeployment = async () => {
    setDisconnecting(true);
    await disconnect();
  };

  return (
    <Screen progressiveTopBlur>
      <View style={styles.header}>
        <Text style={textStyles.eyebrow}>自动化设置</Text>
        <Text style={textStyles.title}>设置</Text>
      </View>

      <Card>
        <Text style={textStyles.heading}>官方网站</Text>
        <Text style={textStyles.muted}>
          在电脑打开官网并显示绑定码，用这台手机扫描后会自动完成绑定。无需注册或输入密码。
        </Text>
        <Button onPress={() => router.push("/web-bind")}>扫描网站绑定码</Button>
        {bindingStatusVisible ? (
          <Notice tone="success">绑定码已授权，正在同步浏览器状态…</Notice>
        ) : null}
        {sessionsError ? <Notice tone="danger">{sessionsError}</Notice> : null}
        {!bindingStatusVisible && !sessionsError && webSessions.length === 0 ? (
          <Text style={textStyles.muted}>尚未绑定浏览器。</Text>
        ) : null}
        {webSessions.map((webSession) => (
          <View key={webSession.id} style={styles.webSession}>
            <View style={styles.webSessionCopy}>
              <Text numberOfLines={1} style={textStyles.body}>
                {webSession.userAgent ?? "未知浏览器"}
              </Text>
              <Text style={textStyles.muted}>
                最近使用 {new Date(webSession.lastUsedAt).toLocaleDateString("zh-CN")}
              </Text>
            </View>
            <Button
              disabled={revokingId === webSession.id}
              tone="danger"
              onPress={() => {
                setRevokingId(webSession.id);
                void revokeWebSession(session, webSession.id)
                  .then(refreshWebSessions)
                  .finally(() => setRevokingId(null));
              }}
            >
              {revokingId === webSession.id ? "撤销中…" : "撤销"}
            </Button>
          </View>
        ))}
      </Card>

      <Card>
        <Text style={textStyles.heading}>到期提醒</Text>
        <Text style={textStyles.muted}>
          收到提醒后只需保存新的群二维码，再打开 App；“发现”会自动扫描并更新。
        </Text>
        {pushState?.status === "registered" ? (
          <Notice tone="success">此设备已经连接到 APNs。</Notice>
        ) : null}
        {pushState?.status === "denied" ? (
          <>
            <Notice tone="danger">通知权限已关闭，请到系统设置中允许通知。</Notice>
            <Button tone="secondary" onPress={() => void Linking.openSettings()}>
              打开系统设置
            </Button>
          </>
        ) : null}
        {pushState?.status === "unavailable" ? <Notice>{pushState.message}</Notice> : null}
        <Button disabled={enablingPush} onPress={() => void enablePush()}>
          {enablingPush ? "正在注册…" : "启用或刷新通知"}
        </Button>
      </Card>

      <Card>
        <Text style={textStyles.heading}>相册识别</Text>
        <Text style={textStyles.muted}>
          二维码、群名和到期时间都在本机识别。完整照片不会发送到任何图像分析服务。
        </Text>
        <Button tone="secondary" onPress={() => void Linking.openSettings()}>
          管理相册权限
        </Button>
      </Card>

      <Card>
        <Text style={textStyles.heading}>当前手机身份</Text>
        <Text style={textStyles.body}>{session.deployment.productName}</Text>
        <Text style={textStyles.muted}>
          频道归属于这台手机建立的私密账号。重装 App 后，App Store 版本可以自动找回。
        </Text>
        <Button
          disabled={disconnecting}
          tone="danger"
          onPress={() => void disconnectDeployment()}
        >
          {disconnecting ? "正在重置…" : "重置这台设备"}
        </Button>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { gap: 5, marginBottom: 4 },
  webSession: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    paddingTop: 12,
  },
  webSessionCopy: { flex: 1, minWidth: 0 },
});
