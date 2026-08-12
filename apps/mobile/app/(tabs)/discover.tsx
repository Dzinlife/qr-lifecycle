import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Animated,
  AppState,
  Image,
  Linking,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { Redirect, useFocusEffect, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaView } from "react-native-safe-area-context";

import type {
  AcceptInboxItemInput,
  Channel,
  ChannelPlatform,
  CommitDetectionResponse,
  DetectedCommunityQr,
  InboxItem,
  QrCandidate,
  ScanCursor,
} from "@qr-lifecycle/contracts";

import {
  acceptInboxItem,
  commitDetection,
  ignoreInboxItem,
  listChannels,
  listInbox,
  undoDetection,
} from "@/api/client";
import {
  Button,
  Card,
  Notice,
  ProgressiveTopScrollView,
  colors,
  textStyles,
} from "@/components/ui";
import { useApp } from "@/context/app-context";
import { humanizeError } from "@/lib/pure";
import {
  photoQrScanner,
  PhotoScanCancelledError,
  PhotoScannerUnsupportedError,
} from "@/scanner/photo-scanner";
import { toDetectedCommunityQrs } from "@/scanner/community-qr-analysis";
import {
  enqueuePendingDetections,
  loadPendingDetections,
  removePendingDetection,
} from "@/scanner/pending-detections";
import {
  loadReviewImageUris,
  preserveReviewImage,
  removeReviewImage,
} from "@/scanner/review-images";
import {
  clearScanCursor,
  loadScanCursor,
  saveScanCursor,
} from "@/session/storage";

type ScanPhase =
  | "idle"
  | "permission"
  | "scanning"
  | "analyzing"
  | "committing"
  | "cancelling"
  | "cancelled"
  | "done"
  | "limited"
  | "denied"
  | "unsupported"
  | "error";

interface ScanSummary {
  scanned: number;
  needsReview: number;
  alreadyProcessed: number;
}

interface RecentDecision {
  detectionId: string;
  action: "accepted_create" | "accepted_update";
  name: string;
}

interface ActiveScanJob {
  controller: AbortController;
  id: string;
}

interface PickedImage {
  uri: string;
  assetId?: string;
}

const DISCOVERY_CURSOR = "discovery";

const platformNames: Record<ChannelPlatform, string> = {
  wechat_group: "微信群",
  xiaohongshu_group: "小红书群",
  discord: "Discord",
  other: "其他群码",
};

function decisionName(response: CommitDetectionResponse): string {
  return response.channel?.name
    ?? response.detection.name
    ?? (response.detection.platform ? platformNames[response.detection.platform] : null)
    ?? "新群码";
}

function expiryLabel(value: string | null): string {
  if (!value) return "到期时间待确认";
  const remaining = new Date(value).getTime() - Date.now();
  if (remaining <= 0) return "已过期";
  const days = Math.ceil(remaining / 86_400_000);
  return days <= 1 ? "预计 24 小时内过期" : `预计 ${days} 天后过期`;
}

function phaseLabel(phase: ScanPhase, processed: number, total: number): string | null {
  if (phase === "permission") return "正在请求相册权限…";
  if (phase === "scanning") {
    return total ? `正在快速检查照片（${processed}/${total}）…` : "正在读取新增照片…";
  }
  if (phase === "analyzing") return "发现二维码，正在本机识别群名和到期时间…";
  if (phase === "committing") return `正在保存检测结果（${processed}/${total}）…`;
  if (phase === "cancelling") return "正在停止扫描…";
  if (phase === "cancelled") return "扫描已停止，已处理的照片不会丢失";
  return null;
}

function acceptanceInput(item: InboxItem, name: string): AcceptInboxItemInput {
  if (item.suggestedChannel) return { channelId: item.suggestedChannel.id };
  return {
    createNew: true,
    name: name.trim() || item.detection.name || undefined,
    platform: item.detection.platform ?? "other",
  };
}

function throwIfCancelled(signal: AbortSignal): void {
  if (signal.aborted) throw new PhotoScanCancelledError();
}

function InboxCard({
  item,
  imageUri,
  name,
  busy,
  onNameChange,
  onAccept,
  onIgnore,
}: {
  item: InboxItem;
  imageUri: string | undefined;
  name: string;
  busy: boolean;
  onNameChange(name: string): void;
  onAccept(name?: string): void;
  onIgnore(): void;
}) {
  const { detection, suggestedChannel } = item;
  const { height: windowHeight } = useWindowDimensions();
  const [previewOpen, setPreviewOpen] = useState(false);
  const previewTranslateY = useRef(new Animated.Value(0)).current;
  const closePreview = () => {
    Animated.timing(previewTranslateY, {
      duration: 180,
      toValue: windowHeight,
      useNativeDriver: true,
    }).start(() => {
      setPreviewOpen(false);
      previewTranslateY.setValue(0);
    });
  };
  const openPreview = () => {
    previewTranslateY.stopAnimation();
    previewTranslateY.setValue(0);
    setPreviewOpen(true);
  };
  const previewPanResponder = PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) =>
      Math.abs(gesture.dy) > 8 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
    onPanResponderMove: (_, gesture) => {
      previewTranslateY.setValue(gesture.dy >= 0 ? gesture.dy : gesture.dy * 0.12);
    },
    onPanResponderRelease: (_, gesture) => {
      if (gesture.dy > Math.min(160, windowHeight * 0.16) || gesture.vy > 1.05) {
        closePreview();
        return;
      }
      Animated.spring(previewTranslateY, {
        damping: 22,
        mass: 0.8,
        stiffness: 240,
        toValue: 0,
        useNativeDriver: true,
      }).start();
    },
    onPanResponderTerminate: () => {
      Animated.spring(previewTranslateY, {
        damping: 22,
        stiffness: 240,
        toValue: 0,
        useNativeDriver: true,
      }).start();
    },
  });
  const previewProgress = previewTranslateY.interpolate({
    inputRange: [0, windowHeight * 0.7],
    outputRange: [0, 1],
    extrapolate: "clamp",
  });
  const previewBackdropOpacity = previewProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 0.12],
  });
  const previewScale = previewProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 0.88],
  });
  const title = detection.name ?? suggestedChannel?.name ?? "未命名群码";
  const platform = detection.platform
    ? platformNames[detection.platform]
    : "平台待确认";
  const confidence = Math.round(
    Math.max(detection.matchConfidence, detection.fieldConfidences.name) * 100,
  );

  return (
    <Card>
      {imageUri ? (
        <Pressable
          accessibilityLabel="查看检测原图"
          accessibilityRole="button"
          onPress={openPreview}
        >
          <Image resizeMode="contain" source={{ uri: imageUri }} style={styles.reviewImage} />
          <Text style={styles.imageHint}>点击查看原图</Text>
        </Pressable>
      ) : (
        <Notice tone="danger">本机原图已不可用，请忽略后重新扫描。</Notice>
      )}
      <View style={styles.rowBetween}>
        <View style={styles.flexCopy}>
          <Text style={textStyles.heading}>{title}</Text>
          <Text style={textStyles.muted}>
            {platform} · {expiryLabel(detection.expiresAt)}
          </Text>
        </View>
        <Text style={styles.confidence}>{confidence}%</Text>
      </View>
      {suggestedChannel ? (
        <Notice>系统推测它是“{suggestedChannel.name}”的新二维码。</Notice>
      ) : (
        <Notice>系统认为这是一个新频道，请确认后创建。</Notice>
      )}
      {!suggestedChannel ? (
        <View>
          <Text style={textStyles.label}>群名称</Text>
          <TextInput
            maxLength={120}
            onChangeText={onNameChange}
            placeholder="识别不到时在这里修正"
            style={styles.input}
            value={name}
          />
        </View>
      ) : null}
      <View style={styles.actionRow}>
        <View style={styles.flexButton}>
          <Button
            disabled={
              busy
              || !imageUri
              || (!suggestedChannel && !detection.name && !name.trim())
            }
            onPress={() => onAccept(name.trim() || undefined)}
          >
            {busy ? "处理中…" : suggestedChannel ? "更新该频道" : "创建该频道"}
          </Button>
        </View>
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={onIgnore}
          style={styles.ignoreButton}
        >
          <Text style={styles.ignoreText}>忽略</Text>
        </Pressable>
      </View>
      <Modal
        animationType="fade"
        hardwareAccelerated
        onRequestClose={closePreview}
        presentationStyle="overFullScreen"
        statusBarTranslucent
        transparent
        visible={previewOpen}
      >
        {previewOpen ? <StatusBar style="light" /> : null}
        <View style={styles.previewScreen}>
          <Animated.View
            pointerEvents="none"
            style={[styles.previewBackdrop, { opacity: previewBackdropOpacity }]}
          />
          <Animated.View
            style={[
              styles.previewContent,
              {
                transform: [
                  { translateY: previewTranslateY },
                  { scale: previewScale },
                ],
              },
            ]}
            {...previewPanResponder.panHandlers}
          >
            <SafeAreaView style={styles.previewSafeArea}>
              <View style={styles.previewHeader}>
                <Text style={styles.previewTitle}>检测原图</Text>
                <Pressable
                  accessibilityRole="button"
                  hitSlop={12}
                  onPress={closePreview}
                  style={styles.previewClose}
                >
                  <Text style={styles.previewCloseText}>完成</Text>
                </Pressable>
              </View>
              {imageUri ? (
                <Image resizeMode="contain" source={{ uri: imageUri }} style={styles.previewImage} />
              ) : null}
            </SafeAreaView>
          </Animated.View>
        </View>
      </Modal>
    </Card>
  );
}

export default function DiscoverScreen() {
  const router = useRouter();
  const { hydrated, session } = useApp();
  const [phase, setPhase] = useState<ScanPhase>("idle");
  const [progress, setProgress] = useState({ processed: 0, total: 0 });
  const [summary, setSummary] = useState<ScanSummary | null>(null);
  const [recent, setRecent] = useState<RecentDecision[]>([]);
  const [inbox, setInbox] = useState<InboxItem[]>([]);
  const [inboxLoading, setInboxLoading] = useState(true);
  const [reviewImageUris, setReviewImageUris] = useState<Record<string, string>>({});
  const [nameDrafts, setNameDrafts] = useState<Record<string, string>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [limitedAccess, setLimitedAccess] = useState(false);
  const [scanStats, setScanStats] = useState<{ observed: number; scanned: number } | null>(null);
  const [busyInboxId, setBusyInboxId] = useState<string | null>(null);
  const [bulkAction, setBulkAction] = useState<"accept" | "ignore" | null>(null);
  const [undoingId, setUndoingId] = useState<string | null>(null);
  const scanningRef = useRef(false);
  const activeJobRef = useRef<ActiveScanJob | null>(null);
  const pickingRef = useRef(false);
  const lastForegroundScanAt = useRef(0);

  const loadInboxItems = useCallback(async (showRefresh = false) => {
    if (!session) return;
    if (showRefresh) setRefreshing(true);
    else setInboxLoading(true);
    try {
      const items = await listInbox(session);
      const imageUris = await loadReviewImageUris(
        session.deployment.apiOrigin,
        items.map((item) => item.detection.id),
      );
      setInbox(items);
      setReviewImageUris(imageUris);
      setNameDrafts((current) => Object.fromEntries(items.map((item) => [
        item.detection.id,
        current[item.detection.id] ?? item.detection.name ?? "",
      ])));
    } catch (caught) {
      setError(humanizeError(caught));
    } finally {
      setRefreshing(false);
      setInboxLoading(false);
    }
  }, [session]);

  const drainPendingDetections = useCallback(async (signal: AbortSignal) => {
    if (!session) return;
    const pending = await loadPendingDetections(session.deployment.apiOrigin);
    const nextSummary: ScanSummary = {
      scanned: pending.length,
      needsReview: 0,
      alreadyProcessed: 0,
    };
    setPhase("committing");
    setProgress({ processed: 0, total: pending.length });
    setSummary(nextSummary);
    for (const [index, item] of pending.entries()) {
      throwIfCancelled(signal);
      const response = await commitDetection(
        session,
        item.detection,
        signal,
      );
      if (response.decision.action === "needs_review") {
        await preserveReviewImage(
          session.deployment.apiOrigin,
          response.detection.id,
          item.candidate.imageUri,
        );
        nextSummary.needsReview += 1;
      } else {
        nextSummary.alreadyProcessed += 1;
      }
      await removePendingDetection(item.detection.clientDetectionId);
      setProgress({ processed: index + 1, total: pending.length });
      setSummary({ ...nextSummary });
    }
  }, [session]);

  const runScan = useCallback(async ({
    full = false,
    pickedImage,
  }: {
    full?: boolean;
    pickedImage?: PickedImage;
  } = {}) => {
    if (!session || scanningRef.current) return;
    scanningRef.current = true;
    const job: ActiveScanJob = {
      id: `scan-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      controller: new AbortController(),
    };
    activeJobRef.current = job;
    setError(null);
    setSummary(null);
    setRecent([]);
    setScanStats(null);
    try {
      const channels: Channel[] = await listChannels(session);
      throwIfCancelled(job.controller.signal);

      if (pickedImage) {
        setPhase("analyzing");
        setProgress({ processed: 0, total: 1 });
        const candidates = await photoQrScanner.analyzeImageUri(
          job.id,
          pickedImage.uri,
          channels,
          { assetId: pickedImage.assetId, creationTime: null },
        );
        if (!candidates.length) {
          throw new Error("这张图片中没有识别到二维码，请选择包含完整群码的图片");
        }
        const detections = toDetectedCommunityQrs(candidates, channels);
        await enqueuePendingDetections(
          session.deployment.apiOrigin,
          detections,
          candidates,
        );
      } else {
        setPhase("permission");
        const permission = await photoQrScanner.requestPermission();
        throwIfCancelled(job.controller.signal);
        if (permission.status === "denied") {
          setPhase("denied");
          return;
        }
        if (permission.status === "limited") {
          setLimitedAccess(true);
          setPhase("limited");
          return;
        }
        setLimitedAccess(false);
        if (full) await clearScanCursor(DISCOVERY_CURSOR);
        const cursor: ScanCursor | undefined = full
          ? undefined
          : await loadScanCursor(DISCOVERY_CURSOR);
        setPhase("scanning");
        setProgress({ processed: 0, total: 0 });
        const result = await photoQrScanner.scanSince(
          job.id,
          cursor,
          channels,
          cursor ? 100 : 20,
        );
        setScanStats({
          observed: result.observedAssetCount ?? 0,
          scanned: result.scannedAssetCount ?? 0,
        });
        if (result.candidates.length > 0) {
          setPhase("analyzing");
          setProgress({ processed: 0, total: result.candidates.length });
          const detections = toDetectedCommunityQrs(result.candidates, channels);
          await enqueuePendingDetections(
            session.deployment.apiOrigin,
            detections,
            result.candidates,
          );
        }
        // Persist after the durable local queue, independently of network upload success.
        await saveScanCursor(DISCOVERY_CURSOR, result.cursor);
      }
      throwIfCancelled(job.controller.signal);
      await drainPendingDetections(job.controller.signal);
      await loadInboxItems();
      setPhase("done");
    } catch (caught) {
      if (caught instanceof PhotoScanCancelledError || job.controller.signal.aborted) {
        setPhase("cancelled");
      } else {
        if (caught instanceof PhotoScannerUnsupportedError) setPhase("unsupported");
        else setPhase("error");
        setError(humanizeError(caught));
      }
    } finally {
      if (activeJobRef.current?.id === job.id) activeJobRef.current = null;
      scanningRef.current = false;
      lastForegroundScanAt.current = Date.now();
    }
  }, [drainPendingDetections, loadInboxItems, session]);

  const stopScan = useCallback(() => {
    const job = activeJobRef.current;
    if (!job || job.controller.signal.aborted) return;
    setPhase("cancelling");
    job.controller.abort();
    try {
      photoQrScanner.cancelScan(job.id);
    } catch {
      // Cancellation of the native job is best effort; the JS abort still stops uploads.
    }
  }, []);

  useEffect(() => () => {
    const job = activeJobRef.current;
    if (!job) return;
    job.controller.abort();
    try {
      photoQrScanner.cancelScan(job.id);
    } catch {
      // The module may be unavailable on an unsupported platform.
    }
  }, []);

  useEffect(() => {
    if (!session) return undefined;
    try {
      const subscription = photoQrScanner.addProgressListener((nextProgress) => {
        if (
          nextProgress.jobId !== activeJobRef.current?.id
          || activeJobRef.current.controller.signal.aborted
        ) return;
        setProgress({ processed: nextProgress.processed, total: nextProgress.total });
        setPhase(nextProgress.stage === "recognizing" ? "analyzing" : "scanning");
      });
      return () => subscription.remove();
    } catch {
      return undefined;
    }
  }, [session]);

  useFocusEffect(useCallback(() => {
    if (!session) return undefined;
    void loadInboxItems();
    if (Date.now() - lastForegroundScanAt.current >= 750) void runScan();
    return undefined;
  }, [loadInboxItems, runScan, session]));

  useEffect(() => {
    if (!session) return undefined;
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      if (pickingRef.current) return;
      if (Date.now() - lastForegroundScanAt.current < 2_000) return;
      void runScan();
    });
    return () => subscription.remove();
  }, [runScan, session]);

  if (hydrated && !session) return <Redirect href="/onboarding" />;
  if (!session) return null;

  const pickImage = async () => {
    setError(null);
    pickingRef.current = true;
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: false,
        quality: 1,
        selectionLimit: 1,
      });
      const asset = result.assets?.[0];
      if (result.canceled || !asset) return;
      await runScan({
        pickedImage: {
          uri: asset.uri,
          ...(asset.assetId ? { assetId: asset.assetId } : {}),
        },
      });
    } catch (caught) {
      setPhase(caught instanceof PhotoScannerUnsupportedError ? "unsupported" : "error");
      setError(humanizeError(caught));
    } finally {
      pickingRef.current = false;
    }
  };

  const handleAccept = async (item: InboxItem, name?: string) => {
    const imageUri = reviewImageUris[item.detection.id];
    if (!imageUri) {
      setError("本机原图已不可用，请忽略后重新扫描");
      return;
    }
    setBusyInboxId(item.detection.id);
    setError(null);
    try {
      const response = await acceptInboxItem(
        session,
        item.detection.id,
        acceptanceInput(item, name ?? nameDrafts[item.detection.id] ?? ""),
        imageUri,
      );
      if (
        response.decision.action === "accepted_create"
        || response.decision.action === "accepted_update"
      ) {
        const action = response.decision.action;
        setRecent((items) => [{
          detectionId: response.detection.id,
          action,
          name: decisionName(response),
        }, ...items]);
      }
      await removeReviewImage(item.detection.id);
      await loadInboxItems();
    } catch (caught) {
      setError(humanizeError(caught));
    } finally {
      setBusyInboxId(null);
    }
  };

  const handleIgnore = async (item: InboxItem) => {
    setBusyInboxId(item.detection.id);
    setError(null);
    try {
      await ignoreInboxItem(session, item.detection.id);
      await removeReviewImage(item.detection.id);
      await loadInboxItems();
    } catch (caught) {
      setError(humanizeError(caught));
    } finally {
      setBusyInboxId(null);
    }
  };

  const handleAcceptAll = async () => {
    const unavailable = inbox.filter((item) => !reviewImageUris[item.detection.id]);
    const unnamed = inbox.filter((item) =>
      !item.suggestedChannel
      && !(nameDrafts[item.detection.id] ?? item.detection.name ?? "").trim());
    if (unavailable.length || unnamed.length) {
      setError(
        unavailable.length
          ? `还有 ${unavailable.length} 条检测缺少本机原图，请先忽略并重新扫描`
          : `还有 ${unnamed.length} 条检测缺少群名称，请先补充`,
      );
      return;
    }

    setBulkAction("accept");
    setError(null);
    const accepted: RecentDecision[] = [];
    try {
      for (const item of inbox) {
        const imageUri = reviewImageUris[item.detection.id];
        if (!imageUri) continue;
        setBusyInboxId(item.detection.id);
        const response = await acceptInboxItem(
          session,
          item.detection.id,
          acceptanceInput(item, nameDrafts[item.detection.id] ?? ""),
          imageUri,
        );
        if (
          response.decision.action === "accepted_create"
          || response.decision.action === "accepted_update"
        ) {
          accepted.push({
            detectionId: response.detection.id,
            action: response.decision.action,
            name: decisionName(response),
          });
        }
        await removeReviewImage(item.detection.id);
        setInbox((items) => items.filter((entry) => entry.detection.id !== item.detection.id));
      }
      setRecent((items) => [...accepted.reverse(), ...items]);
    } catch (caught) {
      setError(humanizeError(caught));
    } finally {
      setBusyInboxId(null);
      setBulkAction(null);
      await loadInboxItems();
    }
  };

  const handleIgnoreAll = async () => {
    setBulkAction("ignore");
    setError(null);
    try {
      for (const item of inbox) {
        setBusyInboxId(item.detection.id);
        await ignoreInboxItem(session, item.detection.id);
        await removeReviewImage(item.detection.id);
        setInbox((items) => items.filter((entry) => entry.detection.id !== item.detection.id));
      }
    } catch (caught) {
      setError(humanizeError(caught));
    } finally {
      setBusyInboxId(null);
      setBulkAction(null);
      await loadInboxItems();
    }
  };

  const confirmIgnoreAll = () => {
    Alert.alert(
      "忽略全部检测结果？",
      `将忽略当前 ${inbox.length} 条结果，频道不会发生变化。`,
      [
        { text: "取消", style: "cancel" },
        { text: "全部忽略", style: "destructive", onPress: () => void handleIgnoreAll() },
      ],
    );
  };

  const handleUndo = async (decision: RecentDecision) => {
    setUndoingId(decision.detectionId);
    setError(null);
    try {
      await undoDetection(session, decision.detectionId);
      setRecent((items) => items.filter((item) => item.detectionId !== decision.detectionId));
      await loadInboxItems();
    } catch (caught) {
      setError(humanizeError(caught));
    } finally {
      setUndoingId(null);
    }
  };

  const phaseCopy = phaseLabel(phase, progress.processed, progress.total);
  const scanning = ["permission", "scanning", "analyzing", "committing", "cancelling"].includes(phase);

  return (
    <ProgressiveTopScrollView
      contentContainerStyle={styles.content}
      refreshControl={(
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => void loadInboxItems(true)}
        />
      )}
      style={styles.safeArea}
    >
        <View style={styles.hero}>
          <Text style={textStyles.eyebrow}>{session.deployment.productName}</Text>
          <Text style={textStyles.title}>保存群码，剩下的交给这里</Text>
          <Text style={textStyles.body}>
            App 会在本机识别相册中的二维码、群名和到期时间，再由你决定更新、创建或忽略。
          </Text>
        </View>

        <Card style={scanning ? styles.scanningCard : undefined}>
          <View style={styles.rowBetween}>
            <View style={styles.flexCopy}>
              <Text style={textStyles.heading}>{scanning ? "正在自动发现" : "自动发现"}</Text>
              <Text style={textStyles.muted}>
                {phaseCopy ?? (phase === "done" ? "本次扫描已完成" : "打开 App 时会自动扫描新增照片")}
              </Text>
            </View>
            <View style={[styles.statusDot, scanning && styles.statusDotScanning]} />
          </View>

          {limitedAccess || phase === "limited" ? (
            <>
              <Notice tone="danger">
                当前是“部分照片”权限。iOS 不会把以后保存的新图片交给 App，因此自动扫描无法工作；请改为“完全访问”。
              </Notice>
              <Button tone="secondary" onPress={() => void Linking.openSettings()}>
                打开设置并允许完全访问
              </Button>
            </>
          ) : null}
          {phase === "denied" ? (
            <>
              <Notice tone="danger">没有相册读取权限，无法自动发现群二维码。</Notice>
              <Button tone="secondary" onPress={() => void Linking.openSettings()}>
                打开系统设置
              </Button>
            </>
          ) : null}
          {phase === "unsupported" ? (
            <Notice>
              {Platform.OS === "android"
                ? "Android 端侧识别正在接入，当前版本请使用 iPhone。"
                : error ?? "当前构建不包含相册识别模块。"}
            </Notice>
          ) : null}
          {phase === "error" && error ? <Notice tone="danger">{error}</Notice> : null}

          <View style={styles.actionRow}>
            <View style={styles.flexButton}>
              <Button
                onPress={scanning ? stopScan : () => void runScan()}
                tone={scanning ? "danger" : "primary"}
              >
                {phase === "cancelling" ? "正在停止…" : scanning ? "停止扫描" : "扫描新增照片"}
              </Button>
            </View>
            <View style={styles.flexButton}>
              <Button disabled={scanning} tone="secondary" onPress={() => void pickImage()}>
                选择图片
              </Button>
            </View>
          </View>
          <Pressable
            accessibilityRole="button"
            disabled={scanning}
            onPress={() => void runScan({ full: true })}
          >
            <Text style={styles.rescanText}>重新扫描最近照片</Text>
          </Pressable>
          {scanStats ? (
            <Text style={textStyles.muted}>
              本次原生观察到 {scanStats.observed} 张最近照片，实际检查 {scanStats.scanned} 张新增照片。
            </Text>
          ) : null}
        </Card>

        {error && phase !== "error" && phase !== "unsupported" ? (
          <Notice tone="danger">{error}</Notice>
        ) : null}

        {summary ? (
          <Card>
            <Text style={textStyles.heading}>
              {summary.scanned ? `本次发现 ${summary.scanned} 个群码` : "没有新的群码"}
            </Text>
            <View style={styles.summaryGrid}>
              <View style={styles.summaryItem}>
                <Text style={styles.summaryNumber}>{summary.needsReview}</Text>
                <Text style={textStyles.muted}>等待确认</Text>
              </View>
              <View style={styles.summaryItem}>
                <Text style={styles.summaryNumber}>{summary.alreadyProcessed}</Text>
                <Text style={textStyles.muted}>此前已处理</Text>
              </View>
            </View>
          </Card>
        ) : null}

        {recent.map((decision) => (
          <Notice key={decision.detectionId} tone="success">
            {decision.action.endsWith("create") ? "已创建" : "已更新"}“{decision.name}”　
            <Text
              disabled={undoingId === decision.detectionId}
              onPress={() => void handleUndo(decision)}
              style={styles.undoText}
            >
              {undoingId === decision.detectionId ? "撤销中…" : "撤销"}
            </Text>
          </Notice>
        ))}

        <View style={styles.sectionHeader}>
          <View style={styles.flexCopy}>
            <Text style={textStyles.heading}>检测结果</Text>
            <Text style={textStyles.muted}>每一条都由你确认，系统不会自动修改频道。</Text>
          </View>
          {inbox.length ? <Text style={styles.inboxCount}>{inbox.length}</Text> : null}
        </View>

        {inbox.length ? (
          <View style={styles.bulkActions}>
            <View style={styles.flexButton}>
              <Button
                disabled={bulkAction !== null || busyInboxId !== null}
                onPress={() => void handleAcceptAll()}
              >
                {bulkAction === "accept" ? "全部处理中…" : "全部更新"}
              </Button>
            </View>
            <View style={styles.flexButton}>
              <Button
                disabled={bulkAction !== null || busyInboxId !== null}
                onPress={confirmIgnoreAll}
                tone="secondary"
              >
                {bulkAction === "ignore" ? "全部忽略中…" : "全部忽略"}
              </Button>
            </View>
          </View>
        ) : null}

        {inboxLoading ? <Text style={textStyles.muted}>正在读取待确认项目…</Text> : null}
        {!inboxLoading && inbox.length === 0 ? (
          <Card>
            <Text style={textStyles.heading}>已经处理完了</Text>
            <Text style={textStyles.muted}>没有等待处理的群码。</Text>
          </Card>
        ) : null}
        {inbox.map((item) => (
          <InboxCard
            busy={bulkAction !== null || busyInboxId === item.detection.id}
            imageUri={reviewImageUris[item.detection.id]}
            item={item}
            key={item.detection.id}
            name={nameDrafts[item.detection.id] ?? item.detection.name ?? ""}
            onNameChange={(name) => setNameDrafts((items) => ({
              ...items,
              [item.detection.id]: name,
            }))}
            onAccept={(name) => void handleAccept(item, name)}
            onIgnore={() => void handleIgnore(item)}
          />
        ))}

        {inbox.length ? (
          <Button tone="secondary" onPress={() => router.push("/channels")}>查看全部群码</Button>
        ) : null}
    </ProgressiveTopScrollView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  content: { gap: 16, padding: 20, paddingBottom: 40 },
  hero: { gap: 9, marginBottom: 4, marginTop: 4 },
  scanningCard: { borderColor: colors.primary },
  rowBetween: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
  },
  flexCopy: { flex: 1, gap: 4 },
  statusDot: { backgroundColor: colors.success, borderRadius: 999, height: 10, width: 10 },
  statusDotScanning: { backgroundColor: colors.warning },
  actionRow: { alignItems: "center", flexDirection: "row", gap: 10 },
  flexButton: { flex: 1 },
  bulkActions: { flexDirection: "row", gap: 10 },
  ignoreButton: { paddingHorizontal: 12, paddingVertical: 14 },
  ignoreText: { color: colors.muted, fontSize: 15, fontWeight: "700" },
  rescanText: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: "600",
    paddingVertical: 2,
    textAlign: "center",
  },
  summaryGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  summaryItem: {
    backgroundColor: "#F7F8F5",
    borderRadius: 12,
    flexBasis: "46%",
    flexGrow: 1,
    gap: 2,
    padding: 12,
  },
  summaryNumber: { color: colors.ink, fontSize: 25, fontWeight: "800" },
  undoText: { color: colors.success, fontWeight: "800", textDecorationLine: "underline" },
  sectionHeader: { alignItems: "center", flexDirection: "row", gap: 12, marginTop: 4 },
  inboxCount: {
    backgroundColor: colors.warningSurface,
    borderRadius: 999,
    color: colors.warning,
    fontSize: 13,
    fontWeight: "800",
    minWidth: 28,
    overflow: "hidden",
    paddingHorizontal: 9,
    paddingVertical: 5,
    textAlign: "center",
  },
  confidence: { color: colors.primary, fontSize: 14, fontWeight: "800" },
  reviewImage: {
    backgroundColor: "#EEF0EC",
    borderRadius: 14,
    height: 240,
    width: "100%",
  },
  imageHint: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: "700",
    marginTop: 8,
    textAlign: "center",
  },
  previewScreen: { flex: 1 },
  previewBackdrop: {
    backgroundColor: "#090B0A",
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  previewContent: { flex: 1 },
  previewSafeArea: { backgroundColor: "transparent", flex: 1 },
  previewHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  previewTitle: { color: "#FFFFFF", fontSize: 17, fontWeight: "700" },
  previewClose: { paddingHorizontal: 4, paddingVertical: 8 },
  previewCloseText: { color: "#8BD8B7", fontSize: 16, fontWeight: "700" },
  previewImage: { flex: 1, width: "100%" },
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
});
