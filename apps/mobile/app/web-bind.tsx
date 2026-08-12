import { useState } from "react";
import { Linking, StyleSheet, Text, View } from "react-native";
import {
  CameraView,
  useCameraPermissions,
  type BarcodeScanningResult,
} from "expo-camera";
import { Redirect, useRouter } from "expo-router";

import { approveWebBinding } from "@/api/client";
import { Button, Card, Notice, Screen, colors, textStyles } from "@/components/ui";
import { useApp } from "@/context/app-context";
import { humanizeError, parseWebBindingQr, type WebBindingQr } from "@/lib/pure";

export default function WebBindScreen() {
  const router = useRouter();
  const { hydrated, session } = useApp();
  const [permission, requestPermission] = useCameraPermissions();
  const [binding, setBinding] = useState<WebBindingQr | null>(null);
  const [invalidQr, setInvalidQr] = useState(false);
  const [approving, setApproving] = useState(false);
  const [approved, setApproved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (hydrated && !session) return <Redirect href="/onboarding" />;
  if (!session) return null;

  const scanned = ({ data }: BarcodeScanningResult) => {
    const parsed = parseWebBindingQr(data);
    if (!parsed) {
      setInvalidQr(true);
      return;
    }
    setInvalidQr(false);
    setError(null);
    setBinding(parsed);
  };

  const approve = async () => {
    if (!binding) return;
    setApproving(true);
    setError(null);
    try {
      await approveWebBinding(session, binding.bindingId, binding.challenge);
      setApproved(true);
    } catch (caught) {
      setError(humanizeError(caught));
    } finally {
      setApproving(false);
    }
  };

  if (!permission) {
    return <Screen><Text style={textStyles.muted}>正在读取相机权限…</Text></Screen>;
  }

  if (!permission.granted) {
    return (
      <Screen>
        <Card>
          <Text style={textStyles.heading}>允许相机扫描绑定码</Text>
          <Text style={textStyles.muted}>
            相机只用于读取 fallinlife 官网显示的一次性二维码，不会上传画面。
          </Text>
          {permission.canAskAgain ? (
            <Button onPress={() => void requestPermission()}>允许相机</Button>
          ) : (
            <Button onPress={() => void Linking.openSettings()}>打开系统设置</Button>
          )}
        </Card>
      </Screen>
    );
  }

  if (approved) {
    return (
      <Screen>
        <Card>
          <Notice tone="success">网站已获授权，可以查看这台手机创建的群码。</Notice>
          <Text style={textStyles.muted}>浏览器会自行完成绑定；此二维码不能再次使用。</Text>
          <Button onPress={() => router.replace("/settings")}>完成</Button>
        </Card>
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={styles.intro}>
        <Text style={textStyles.heading}>扫描官网上的二维码</Text>
        <Text style={textStyles.muted}>
          扫到后还需要你确认。陌生网页无法在后台自动获得访问权限。
        </Text>
      </View>

      <View style={styles.cameraFrame}>
        <CameraView
          active={!binding}
          barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
          onBarcodeScanned={binding ? undefined : scanned}
          style={StyleSheet.absoluteFill}
        />
        <View pointerEvents="none" style={styles.guide} />
      </View>

      {invalidQr && !binding ? (
        <Notice tone="danger">这不是 fallinlife 官网生成的绑定二维码。</Notice>
      ) : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}

      {binding ? (
        <Card>
          <Text style={textStyles.heading}>允许这个浏览器查看群码？</Text>
          <Text style={textStyles.muted}>
            授权仅用于查看和辅助管理当前手机账号下的频道，可随时在设置中撤销。
          </Text>
          <Button disabled={approving} onPress={() => void approve()}>
            {approving ? "正在授权…" : "确认授权"}
          </Button>
          <Button
            disabled={approving}
            tone="secondary"
            onPress={() => {
              setBinding(null);
              setError(null);
            }}
          >
            取消，重新扫描
          </Button>
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  intro: { gap: 7 },
  cameraFrame: {
    aspectRatio: 1,
    overflow: "hidden",
    borderRadius: 22,
    backgroundColor: "#101713",
  },
  guide: {
    position: "absolute",
    left: "17%",
    right: "17%",
    top: "17%",
    bottom: "17%",
    borderWidth: 3,
    borderColor: colors.surface,
    borderRadius: 20,
  },
});
