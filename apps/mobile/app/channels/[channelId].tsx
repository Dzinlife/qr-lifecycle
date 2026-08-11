import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Image,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { Redirect, useLocalSearchParams } from "expo-router";

import type { Channel, QrCandidate } from "@qr-lifecycle/contracts";

import {
  getChannel,
  updateChannelExpiry,
  uploadQrCandidate,
} from "@/api/client";
import { Button, Card, Loading, Notice, Screen, colors, textStyles } from "@/components/ui";
import { useApp } from "@/context/app-context";
import { humanizeError } from "@/lib/pure";
import {
  clearScanCursor,
  loadScanCursor,
  saveScanCursor,
} from "@/session/storage";
import {
  photoQrScanner,
  PhotoScannerUnsupportedError,
} from "@/scanner/photo-scanner";

type ScanPhase =
  | "idle"
  | "permission"
  | "scanning"
  | "ready"
  | "empty"
  | "denied"
  | "unsupported"
  | "error";

function parseExpiryDate(value: string): string | null {
  if (!value.trim()) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    throw new Error("过期日期请使用 YYYY-MM-DD 格式");
  }
  const date = new Date(`${value.trim()}T23:59:59`);
  if (Number.isNaN(date.getTime())) throw new Error("过期日期无效");
  return date.toISOString();
}

function CandidateCard({
  candidate,
  onChoose,
}: {
  candidate: QrCandidate;
  onChoose(): void;
}) {
  return (
    <Pressable accessibilityRole="button" onPress={onChoose}>
      <Card style={styles.candidateCard}>
        <Image accessibilityLabel="识别到的二维码" source={{ uri: candidate.imageUri }} style={styles.preview} />
        <View style={styles.candidateCopy}>
          <Text style={textStyles.heading}>发现一个二维码</Text>
          <Text numberOfLines={3} selectable style={styles.payload}>{candidate.payload}</Text>
          <Text style={textStyles.muted}>
            {candidate.creationTime === null
              ? "拍摄时间未知"
              : new Date(candidate.creationTime).toLocaleString("zh-CN")}
          </Text>
        </View>
      </Card>
    </Pressable>
  );
}

export default function ChannelDetailScreen() {
  const params = useLocalSearchParams<{ channelId?: string | string[] }>();
  const channelId = typeof params.channelId === "string" ? params.channelId : null;
  const { hydrated, session } = useApp();
  const [channel, setChannel] = useState<Channel | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [phase, setPhase] = useState<ScanPhase>("idle");
  const [scanMessage, setScanMessage] = useState<string | null>(null);
  const [limitedAccess, setLimitedAccess] = useState(false);
  const [candidates, setCandidates] = useState<QrCandidate[]>([]);
  const [selected, setSelected] = useState<QrCandidate | null>(null);
  const [manualImage, setManualImage] = useState<QrCandidate | null>(null);
  const [manualPayload, setManualPayload] = useState("");
  const [expiryInput, setExpiryInput] = useState("");
  const [initialExpiryInput, setInitialExpiryInput] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session || !channelId) return;
    setLoading(true);
    setLoadError(null);
    try {
      const value = await getChannel(session, channelId);
      const expiryDate = value.expiresAt?.slice(0, 10) ?? "";
      setChannel(value);
      setExpiryInput(expiryDate);
      setInitialExpiryInput(expiryDate);
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
  if (loading) return <Loading label="正在读取频道…" />;
  if (loadError || !channel) {
    return (
      <Screen>
        <Notice tone="danger">{loadError ?? "找不到这个频道"}</Notice>
        <Button onPress={() => void load()}>重试</Button>
      </Screen>
    );
  }

  const scan = async (fullScan = false) => {
    setScanMessage(null);
    setSelected(null);
    setCandidates([]);
    setPhase("permission");
    try {
      const permission = await photoQrScanner.requestPermission();
      if (permission.status === "denied") {
        setPhase("denied");
        return;
      }
      setLimitedAccess(permission.status === "limited");
      setPhase("scanning");
      if (fullScan) await clearScanCursor(channelId);
      const cursor = fullScan ? undefined : await loadScanCursor(channelId);
      const result = await photoQrScanner.scanSince(cursor);
      await saveScanCursor(channelId, result.cursor);
      const sorted = [...result.candidates].sort(
        (a, b) => (b.creationTime ?? 0) - (a.creationTime ?? 0),
      );
      setCandidates(sorted);
      setPhase(sorted.length ? "ready" : "empty");
    } catch (caught) {
      if (caught instanceof PhotoScannerUnsupportedError) {
        setPhase("unsupported");
      } else {
        setPhase("error");
      }
      setScanMessage(humanizeError(caught));
    }
  };

  const pickManualImage = async () => {
    setUploadError(null);
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: false,
      quality: 1,
      selectionLimit: 1,
    });
    const asset = result.assets?.[0];
    if (result.canceled || !asset) return;
    setManualPayload("");
    setManualImage({
      assetId: asset.assetId ?? "",
      creationTime: null,
      payload: "",
      imageUri: asset.uri,
    });
    setSelected(null);
  };

  const confirmUpload = async (candidate: QrCandidate) => {
    const payload = (candidate === manualImage ? manualPayload : candidate.payload).trim();
    if (!payload) {
      setUploadError("手动上传时必须粘贴二维码解码内容");
      return;
    }
    setUploading(true);
    setUploadError(null);
    try {
      await uploadQrCandidate(session, channelId, { ...candidate, payload });
      if (expiryInput !== initialExpiryInput) {
        await updateChannelExpiry(session, channelId, parseExpiryDate(expiryInput));
      }
      Alert.alert("更新成功", "稳定入口已经切换到新的二维码。", [
        { text: "好", onPress: () => void load() },
      ]);
      setSelected(null);
      setManualImage(null);
      setCandidates([]);
      setPhase("idle");
    } catch (caught) {
      setUploadError(humanizeError(caught));
    } finally {
      setUploading(false);
    }
  };

  const candidateForConfirmation = selected ?? manualImage;

  return (
    <Screen>
      <View style={styles.header}>
        <Text style={textStyles.eyebrow}>更新频道</Text>
        <Text style={textStyles.title}>{channel.name}</Text>
        <Text style={textStyles.muted}>稳定地址：/q/{channel.slug}</Text>
      </View>

      <Card>
        <Text style={textStyles.heading}>1. 从相册自动识别</Text>
        <Text style={textStyles.muted}>
          先在微信或小红书中保存新二维码，再回来扫描新增照片。识别过程完全在本机完成。
        </Text>
        {Platform.OS === "android" ? (
          <Notice>Android 自动识别尚未实现；当前可以使用下方手动上传。</Notice>
        ) : null}
        {limitedAccess ? (
          <Notice>当前是“有限照片访问”。只能扫描你允许本 App 读取的照片。</Notice>
        ) : null}
        {phase === "denied" ? (
          <>
            <Notice tone="danger">没有相册读取权限，无法自动寻找二维码。</Notice>
            <Button tone="secondary" onPress={() => void Linking.openSettings()}>打开系统设置</Button>
          </>
        ) : null}
        {phase === "empty" ? (
          <Notice>新增照片中没有识别到二维码。确认图片已保存，或执行一次完整扫描。</Notice>
        ) : null}
        {phase === "unsupported" || phase === "error" ? (
          <Notice tone={phase === "error" ? "danger" : "warning"}>
            {scanMessage ?? "自动识别当前不可用"}
          </Notice>
        ) : null}
        <Button
          disabled={phase === "permission" || phase === "scanning" || Platform.OS === "android"}
          onPress={() => void scan(false)}
        >
          {phase === "permission"
            ? "正在请求权限…"
            : phase === "scanning"
              ? "正在识别新增照片…"
              : "扫描新增照片"}
        </Button>
        {phase === "empty" ? (
          <Button tone="secondary" onPress={() => void scan(true)}>扫描最近 100 张照片</Button>
        ) : null}
      </Card>

      {candidates.length ? (
        <View style={styles.section}>
          <Text style={textStyles.heading}>2. 选择正确的二维码</Text>
          <Text style={textStyles.muted}>发现 {candidates.length} 个候选项。选择后仍需再次确认。</Text>
          {candidates.map((candidate, index) => (
            <CandidateCard
              candidate={candidate}
              key={`${candidate.assetId}-${candidate.payload}-${index}`}
              onChoose={() => {
                setManualImage(null);
                setSelected(candidate);
              }}
            />
          ))}
        </View>
      ) : null}

      <Card>
        <Text style={textStyles.heading}>手动上传</Text>
        <Text style={textStyles.muted}>自动识别不可用时，可以自己选择图片并粘贴二维码内容。</Text>
        <Button tone="secondary" onPress={() => void pickManualImage()}>从相册选择图片</Button>
      </Card>

      {candidateForConfirmation ? (
        <Card>
          <Text style={textStyles.heading}>确认替换</Text>
          <Image source={{ uri: candidateForConfirmation.imageUri }} style={styles.confirmPreview} />
          {candidateForConfirmation === manualImage ? (
            <View>
              <Text style={textStyles.label}>二维码解码内容</Text>
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                multiline
                onChangeText={setManualPayload}
                placeholder="粘贴二维码中包含的链接或文本"
                style={[styles.input, styles.payloadInput]}
                value={manualPayload}
              />
            </View>
          ) : (
            <View>
              <Text style={textStyles.label}>识别内容</Text>
              <Text selectable style={styles.payload}>{candidateForConfirmation.payload}</Text>
            </View>
          )}
          <View>
            <Text style={textStyles.label}>新的过期日期（可选）</Text>
            <TextInput
              autoCapitalize="none"
              keyboardType="numbers-and-punctuation"
              onChangeText={setExpiryInput}
              placeholder="YYYY-MM-DD；留空表示不过期"
              style={styles.input}
              value={expiryInput}
            />
          </View>
          <Notice>确认后，公开稳定入口会立即显示这张图片。</Notice>
          {uploadError ? <Notice tone="danger">{uploadError}</Notice> : null}
          <Button disabled={uploading} onPress={() => void confirmUpload(candidateForConfirmation)}>
            {uploading ? "正在上传并激活…" : "确认替换当前二维码"}
          </Button>
          <Button
            tone="secondary"
            onPress={() => {
              setSelected(null);
              setManualImage(null);
              setUploadError(null);
            }}
          >
            取消
          </Button>
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { gap: 5, marginBottom: 4 },
  section: { gap: 12 },
  candidateCard: { flexDirection: "row", gap: 14 },
  candidateCopy: { flex: 1, gap: 6 },
  preview: { backgroundColor: "#EEF0EC", borderRadius: 12, height: 104, width: 104 },
  confirmPreview: { alignSelf: "center", backgroundColor: "#EEF0EC", borderRadius: 16, height: 230, width: 230 },
  payload: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  input: {
    backgroundColor: "#F7F8F5",
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    color: colors.ink,
    fontSize: 16,
    minHeight: 50,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  payloadInput: { minHeight: 90, textAlignVertical: "top" },
});
