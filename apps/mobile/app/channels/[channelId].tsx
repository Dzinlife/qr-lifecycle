import { useCallback, useEffect, useState } from "react";
import { Alert, Linking, StyleSheet, Text, TextInput, View } from "react-native";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";

import type { Channel, ChannelPlatform, QrVersion } from "@qr-lifecycle/contracts";

import {
  getChannel,
  listQrVersions,
  updateChannelExpiry,
} from "@/api/client";
import { Button, Card, Loading, Notice, Screen, colors, textStyles } from "@/components/ui";
import { useApp } from "@/context/app-context";
import { humanizeError } from "@/lib/pure";

const platformNames: Record<ChannelPlatform, string> = {
  wechat_group: "微信群",
  xiaohongshu_group: "小红书群",
  discord: "Discord",
  other: "其他",
};

function parseExpiryDate(value: string): string | null {
  if (!value.trim()) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    throw new Error("过期日期请使用 YYYY-MM-DD 格式");
  }
  const date = new Date(`${value.trim()}T23:59:59`);
  if (Number.isNaN(date.getTime())) throw new Error("过期日期无效");
  return date.toISOString();
}

function expiryCopy(channel: Channel): string {
  if (!channel.expiresAt) return "系统暂时无法从图片中判断到期时间";
  const remaining = new Date(channel.expiresAt).getTime() - Date.now();
  if (remaining <= 0) return "已过期，保存新群码后回到“发现”即可更新";
  const days = Math.ceil(remaining / 86_400_000);
  return days <= 1 ? "预计 24 小时内过期" : `预计 ${days} 天后过期`;
}

export default function ChannelDetailScreen() {
  const params = useLocalSearchParams<{ channelId?: string | string[] }>();
  const channelId = typeof params.channelId === "string" ? params.channelId : null;
  const router = useRouter();
  const { hydrated, session } = useApp();
  const [channel, setChannel] = useState<Channel | null>(null);
  const [versions, setVersions] = useState<QrVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expiryInput, setExpiryInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session || !channelId) return;
    setLoading(true);
    setLoadError(null);
    try {
      const [nextChannel, nextVersions] = await Promise.all([
        getChannel(session, channelId),
        listQrVersions(session, channelId),
      ]);
      setChannel(nextChannel);
      setVersions(nextVersions);
      setExpiryInput(nextChannel.expiresAt?.slice(0, 10) ?? "");
    } catch (caught) {
      setLoadError(humanizeError(caught));
    } finally {
      setLoading(false);
    }
  }, [channelId, session]);

  useEffect(() => {
    void load();
  }, [load]);

  if (hydrated && !session) return <Redirect href="/pair" />;
  if (!session) return null;
  if (!channelId) return <Screen><Notice tone="danger">频道链接无效。</Notice></Screen>;
  if (loading) return <Loading label="正在读取群码…" />;
  if (loadError || !channel) {
    return (
      <Screen>
        <Notice tone="danger">{loadError ?? "找不到这个群码"}</Notice>
        <Button onPress={() => void load()}>重试</Button>
      </Screen>
    );
  }

  const saveExpiry = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await updateChannelExpiry(session, channel.id, parseExpiryDate(expiryInput));
      await load();
      Alert.alert("已保存", "到期时间已手动修正。");
    } catch (caught) {
      setSaveError(humanizeError(caught));
    } finally {
      setSaving(false);
    }
  };

  const stableUrl = `${session.deployment.apiOrigin}/q/${channel.slug}`;

  return (
    <Screen>
      <View style={styles.header}>
        <Text style={textStyles.eyebrow}>{platformNames[channel.platform]}</Text>
        <Text style={textStyles.title}>{channel.name}</Text>
        <Text style={textStyles.muted}>{expiryCopy(channel)}</Text>
      </View>

      <Card>
        <Text style={textStyles.heading}>稳定入口</Text>
        <Text selectable style={styles.link}>{stableUrl}</Text>
        <Button tone="secondary" onPress={() => void Linking.openURL(stableUrl)}>
          打开群码入口
        </Button>
      </Card>

      <Card>
        <Text style={textStyles.heading}>自动更新</Text>
        <Text style={textStyles.muted}>
          不需要先选择这个频道。把新二维码保存到相册后回到“发现”，系统会自动识别并匹配。
        </Text>
        <Button onPress={() => router.replace("/discover")}>返回发现</Button>
      </Card>

      <Card>
        <Text style={textStyles.heading}>识别历史</Text>
        {versions.length === 0 ? (
          <Text style={textStyles.muted}>还没有可用的二维码版本。</Text>
        ) : versions.slice(0, 8).map((version, index) => (
          <View key={version.id} style={styles.versionRow}>
            <View style={styles.versionCopy}>
              <Text style={styles.versionTitle}>{index === 0 ? "当前版本" : "历史版本"}</Text>
              <Text style={textStyles.muted}>
                {new Date(version.activatedAt).toLocaleString("zh-CN")}
              </Text>
            </View>
            {index === 0 ? <Text style={styles.activeBadge}>使用中</Text> : null}
          </View>
        ))}
      </Card>

      <Card>
        <Text style={textStyles.heading}>手动修正</Text>
        <Text style={textStyles.muted}>
          只有系统没有识别准确时才需要修改。留空表示未知，而不是永久有效。
        </Text>
        <View>
          <Text style={textStyles.label}>到期日期</Text>
          <TextInput
            autoCapitalize="none"
            keyboardType="numbers-and-punctuation"
            onChangeText={setExpiryInput}
            placeholder="YYYY-MM-DD"
            style={styles.input}
            value={expiryInput}
          />
        </View>
        {saveError ? <Notice tone="danger">{saveError}</Notice> : null}
        <Button disabled={saving} tone="secondary" onPress={() => void saveExpiry()}>
          {saving ? "正在保存…" : "保存修正"}
        </Button>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { gap: 5, marginBottom: 4 },
  link: { color: colors.primary, fontSize: 14, lineHeight: 20 },
  input: {
    backgroundColor: "#F7F8F5",
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    color: colors.ink,
    fontSize: 16,
    minHeight: 50,
    paddingHorizontal: 14,
  },
  versionRow: {
    alignItems: "center",
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
    paddingTop: 12,
  },
  versionCopy: { flex: 1, gap: 2 },
  versionTitle: { color: colors.ink, fontSize: 15, fontWeight: "700" },
  activeBadge: {
    backgroundColor: colors.successSurface,
    borderRadius: 999,
    color: colors.success,
    fontSize: 12,
    fontWeight: "700",
    overflow: "hidden",
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
});
