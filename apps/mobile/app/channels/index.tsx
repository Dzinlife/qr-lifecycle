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
import { Button, Card, MainNavigation, Notice, colors, textStyles } from "@/components/ui";
import { useApp } from "@/context/app-context";
import { humanizeError } from "@/lib/pure";

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
  const { hydrated, session } = useApp();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <SafeAreaView edges={["bottom"]} style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} />}
      >
        <MainNavigation active="/channels" />

        <View style={styles.header}>
          <View style={styles.headerCopy}>
            <Text style={textStyles.eyebrow}>{session.deployment.productName}</Text>
            <Text style={textStyles.title}>群码</Text>
            <Text style={textStyles.muted}>查看稳定入口、有效期和识别结果。</Text>
          </View>
        </View>

        {error ? (
          <Card>
            <Notice tone="danger">{error}</Notice>
            <Button onPress={() => void load()}>重试</Button>
          </Card>
        ) : null}

        {loading ? <Text style={textStyles.muted}>正在读取频道…</Text> : null}
        {!loading && !error && channels.length === 0 ? (
          <Card>
            <Text style={textStyles.heading}>还没有发现群码</Text>
            <Text style={textStyles.muted}>把微信群或小红书群二维码保存到相册，“发现”会自动创建频道。</Text>
            <Button onPress={() => router.replace("/discover")}>去发现</Button>
          </Card>
        ) : null}

        {channels.map((channel) => {
          const expiry = expiryLabel(channel);
          return (
            <Pressable
              accessibilityHint="查看群码状态和手动修正"
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
  channelCard: { paddingVertical: 16 },
  channelTop: { alignItems: "center", flexDirection: "row", gap: 10 },
  arrow: { color: colors.muted, fontSize: 30, fontWeight: "300" },
  expiry: { color: colors.success, fontSize: 14, fontWeight: "700" },
  expiryUrgent: { color: colors.danger },
});
