import { useState } from "react";
import { Linking, StyleSheet, Text, View } from "react-native";
import { Redirect } from "expo-router";

import {
  Button,
  Card,
  MainNavigation,
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
  const { hydrated, session, setDeviceId, disconnect } = useApp();
  const [pushState, setPushState] = useState<PushRegistrationState | null>(null);
  const [enablingPush, setEnablingPush] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  if (hydrated && !session) return <Redirect href="/pair" />;
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
    <Screen>
      <MainNavigation active="/settings" />

      <View style={styles.header}>
        <Text style={textStyles.eyebrow}>自动化设置</Text>
        <Text style={textStyles.title}>设置</Text>
      </View>

      <Card>
        <Text style={textStyles.heading}>到期提醒</Text>
        <Text style={textStyles.muted}>
          收到提醒后只需保存新的群二维码，再打开 App；“发现”会自动扫描并更新。
        </Text>
        {session.deviceId ? (
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
        {!session.deviceId ? (
          <Button disabled={enablingPush} onPress={() => void enablePush()}>
            {enablingPush ? "正在注册…" : "启用通知"}
          </Button>
        ) : null}
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
        <Text style={textStyles.heading}>当前部署</Text>
        <Text style={textStyles.body}>{session.deployment.productName}</Text>
        <Text selectable style={textStyles.muted}>{session.deployment.apiOrigin}</Text>
        <Button
          disabled={disconnecting}
          tone="danger"
          onPress={() => void disconnectDeployment()}
        >
          {disconnecting ? "正在断开…" : "断开部署"}
        </Button>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { gap: 5, marginBottom: 4 },
});
