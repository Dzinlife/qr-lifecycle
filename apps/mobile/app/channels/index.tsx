import { useCallback, useEffect, useState } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Redirect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import type { Channel, ChannelPlatform } from "@qr-lifecycle/contracts";

import { listChannels } from "@/api/client";
import { Button, Card, Notice, colors, textStyles } from "@/components/ui";
import { useApp } from "@/context/app-context";
import { humanizeError } from "@/lib/pure";
import {
  enablePushNotifications,
  type PushRegistrationState,
  usePushTokenRefresh,
} from "@/notifications/push";

const platformNames: Record<ChannelPlatform, string> = {
  wechat_group: "微信群",
  xiaohongshu_group: "小红书群",
  discord: "Discord",
  other: "其他",
};

function expiryLabel(channel: Channel): { label: string; urgent: boolean } {
  if (!channel.expiresAt) return { label: "未设置过期时间", urgent: false };
  const expires = new Date(channel.expiresAt);
  const minutes = Math.floor((expires.getTime() - Date.now()) / 60_000);
  if (minutes <= 0) return { label: "已过期，请立即更新", urgent: true };
  if (minutes < 24 * 60) return { label: `${Math.max(1, Math.ceil(minutes / 60))} 小时后过期`, urgent: true };
  return { label: `${Math.ceil(minutes / 1_440)} 天后过期`, urgent: false };
}

export default function ChannelsScreen() {
  const router = useRouter();
  const { hydrated, session, setDeviceId, disconnect } = useApp();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pushState, setPushState] = useState<PushRegistrationState | null>(null);
  const [enablingPush, setEnablingPush] = useState(false);

  usePushTokenRefresh(session, setDeviceId);

  const load = useCallback(async (refresh = false) => {
    if (!session) return;
    refresh ? setRefreshing(true) : setLoading(true);
    setError(null);
    try {
      setChannels(await listChannels(session));
    } catch (caught) {
      setError(humanizeError(caught));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [session]);

  useEffect(() => {
    void load();
  }, [load]);

  if (hydrated && !session) return <Redirect href="/pair" />;
  if (!session) return null;

  const enablePush = async () => {
    setEnablingPush(true);
    const state = await enablePushNotifications(session);
    setPushState(state);
    if (state.status === "registered") await setDeviceId(state.deviceId);
    setEnablingPush(false);
  };

  return (
    <SafeAreaView edges={["bottom"]} style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} />}
      >
        <View style={styles.header}>
          <View style={styles.headerCopy}>
            <Text style={textStyles.eyebrow}>{session.deployment.productName}</Text>
            <Text style={textStyles.title}>需要维护的群码</Text>
            <Text numberOfLines={1} style={textStyles.muted}>{session.deployment.apiOrigin}</Text>
          </View>
          <Pressable accessibilityRole="button" onPress={() => void disconnect()}>
            <Text style={styles.disconnect}>断开</Text>
          </Pressable>
        </View>

        {!session.deviceId && pushState?.status !== "registered" ? (
          <Card>
            <Text style={textStyles.heading}>打开到期提醒</Text>
            <Text style={textStyles.muted}>允许通知后，到期提醒可以直接打开对应群码的更新页。</Text>
            {pushState?.status === "denied" ? <Notice tone="danger">通知权限已关闭，请到系统设置中允许通知。</Notice> : null}
            {pushState?.status === "unavailable" ? <Notice>{pushState.message}</Notice> : null}
            <Button disabled={enablingPush} onPress={() => void enablePush()}>
              {enablingPush ? "正在注册…" : "启用通知"}
            </Button>
          </Card>
        ) : (
          <Notice tone="success">此设备已连接到 APNs，到期通知会打开对应频道。</Notice>
        )}

        {error ? (
          <Card>
            <Notice tone="danger">{error}</Notice>
            <Button onPress={() => void load()}>重试</Button>
          </Card>
        ) : null}

        {loading ? <Text style={textStyles.muted}>正在读取频道…</Text> : null}
        {!loading && !error && channels.length === 0 ? (
          <Card>
            <Text style={textStyles.heading}>还没有频道</Text>
            <Text style={textStyles.muted}>请先在网页管理端创建微信群、小红书群或 Discord 频道。</Text>
          </Card>
        ) : null}

        {channels.map((channel) => {
          const expiry = expiryLabel(channel);
          return (
            <Pressable
              accessibilityHint="打开相册识别并更新二维码"
              accessibilityRole="button"
              key={channel.id}
              onPress={() => router.push(`/channels/${channel.id}`)}
            >
              <Card style={styles.channelCard}>
                <View style={styles.channelTop}>
                  <View style={styles.headerCopy}>
                    <Text style={textStyles.heading}>{channel.name}</Text>
                    <Text style={textStyles.muted}>{platformNames[channel.platform]} · /q/{channel.slug}</Text>
                  </View>
                  <Text style={styles.arrow}>›</Text>
                </View>
                <Text style={[styles.expiry, expiry.urgent && styles.expiryUrgent]}>{expiry.label}</Text>
              </Card>
            </Pressable>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  content: { gap: 14, padding: 20, paddingBottom: 40 },
  header: { alignItems: "flex-start", flexDirection: "row", gap: 16, justifyContent: "space-between", marginBottom: 4 },
  headerCopy: { flex: 1, gap: 4 },
  disconnect: { color: colors.danger, fontSize: 15, fontWeight: "700", paddingVertical: 8 },
  channelCard: { paddingVertical: 16 },
  channelTop: { alignItems: "center", flexDirection: "row", gap: 10 },
  arrow: { color: colors.muted, fontSize: 30, fontWeight: "300" },
  expiry: { color: colors.success, fontSize: 14, fontWeight: "700" },
  expiryUrgent: { color: colors.danger },
});
