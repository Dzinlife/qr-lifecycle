import { useRef, useState } from "react";
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
  const scanLocked = useRef(false);
  const [binding, setBinding] = useState<WebBindingQr | null>(null);
  const [invalidQr, setInvalidQr] = useState(false);
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (hydrated && !session) return <Redirect href="/onboarding" />;
  if (!session) return null;

  const connect = async (target: WebBindingQr) => {
    scanLocked.current = true;
    setBinding(target);
    setInvalidQr(false);
    setApproving(true);
    setError(null);
    try {
      await approveWebBinding(session, target.bindingId, target.challenge);
      router.replace("/settings");
    } catch (caught) {
      setError(humanizeError(caught));
      setApproving(false);
    }
  };

  const scanned = ({ data }: BarcodeScanningResult) => {
    if (scanLocked.current) return;
    const parsed = parseWebBindingQr(data);
    if (!parsed) {
      setInvalidQr(true);
      return;
    }

    void connect(parsed);
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

  return (
    <Screen>
      <View style={styles.intro}>
        <Text style={textStyles.heading}>扫描官网上的二维码</Text>
        <Text style={textStyles.muted}>
          识别到有效的一次性绑定码后会自动连接，无需再次确认。
        </Text>
      </View>

      <View style={styles.cameraFrame}>
        <CameraView
          active={!binding && !approving}
          barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
          onBarcodeScanned={binding || approving ? undefined : scanned}
          style={StyleSheet.absoluteFill}
        />
        <View pointerEvents="none" style={styles.guide} />
      </View>

      {invalidQr && !binding ? (
        <Notice tone="danger">这不是 fallinlife 官网生成的绑定二维码。</Notice>
      ) : null}
      {binding && approving ? (
        <Card>
          <Notice tone="success">已识别，正在连接浏览器…</Notice>
        </Card>
      ) : null}

      {binding && error ? (
        <Card>
          <Notice tone="danger">{error}</Notice>
          <Button onPress={() => void connect(binding)}>重试连接</Button>
          <Button
            tone="secondary"
            onPress={() => {
              scanLocked.current = false;
              setBinding(null);
              setError(null);
              setInvalidQr(false);
            }}
          >
            重新扫描
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
