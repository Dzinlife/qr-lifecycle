import { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Redirect, useRouter } from "expo-router";

import { Button, Card, Notice, Screen, textStyles } from "@/components/ui";
import { useApp } from "@/context/app-context";
import { humanizeError } from "@/lib/pure";

export default function OnboardingScreen() {
  const router = useRouter();
  const { hydrated, initializing, session, initialize } = useApp();
  const attempted = useRef(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    setError(null);
    try {
      await initialize();
      router.replace("/discover");
    } catch (caught) {
      setError(humanizeError(caught));
    }
  };

  useEffect(() => {
    if (!hydrated || session || attempted.current) return;
    attempted.current = true;
    void start();
  }, [hydrated, session]);

  if (hydrated && session) return <Redirect href="/discover" />;

  return (
    <Screen>
      <View style={styles.hero}>
        <Text style={textStyles.eyebrow}>FALLINLIFE</Text>
        <Text style={textStyles.title}>让群二维码自己续上</Text>
        <Text style={textStyles.body}>
          无需注册或选择服务器。App 会在本机识别相册中的群码，并安全同步到官方网站。
        </Text>
      </View>

      <Card>
        <Text style={textStyles.heading}>
          {initializing ? "正在建立安全身份…" : error ? "暂时无法连接" : "正在准备"}
        </Text>
        <Text style={textStyles.muted}>
          App Store 身份只用于找回你的频道，不会获取姓名、邮箱或 Apple ID。
        </Text>
        {error ? <Notice tone="danger">{error}</Notice> : null}
        {error ? (
          <Button disabled={initializing} onPress={() => void start()}>
            重新连接
          </Button>
        ) : null}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { gap: 12, marginBottom: 8, marginTop: 48 },
});
