import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Redirect, useRouter } from "expo-router";

import { Button, Card, Notice, Screen, colors, textStyles } from "@/components/ui";
import { useApp } from "@/context/app-context";
import { humanizeError } from "@/lib/pure";

export default function PairScreen() {
  const router = useRouter();
  const { hydrated, session, pair } = useApp();
  const [origin, setOrigin] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (hydrated && session) return <Redirect href="/discover" />;

  const submit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      await pair(origin, code);
      router.replace("/discover");
    } catch (caught) {
      setError(humanizeError(caught));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={styles.flex}
    >
      <Screen>
        <View style={styles.hero}>
          <Text style={textStyles.eyebrow}>QR Lifecycle</Text>
          <Text style={textStyles.title}>让群二维码保持可用</Text>
          <Text style={textStyles.body}>
            在网页管理端生成一次性配对码，然后把这台手机连接到你的 Cloudflare 部署。
          </Text>
        </View>

        <Card>
          <View>
            <Text style={textStyles.label}>部署地址</Text>
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              onChangeText={setOrigin}
              placeholder="your-worker.example.com"
              returnKeyType="next"
              style={styles.input}
              value={origin}
            />
          </View>
          <View>
            <Text style={textStyles.label}>配对码</Text>
            <TextInput
              autoCapitalize="characters"
              autoCorrect={false}
              onChangeText={setCode}
              placeholder="网页端显示的 10 分钟配对码"
              returnKeyType="done"
              style={styles.input}
              textContentType="oneTimeCode"
              value={code}
              onSubmitEditing={() => void submit()}
            />
            <Text style={textStyles.muted}>只填写 Web“连接手机”页面生成的 10 位代码，不要填写登录恢复码。</Text>
          </View>
          {error ? <Notice tone="danger">{error}</Notice> : null}
          <Button disabled={submitting || !origin.trim() || !code.trim()} onPress={() => void submit()}>
            {submitting ? "正在连接…" : "安全连接"}
          </Button>
        </Card>

        <Text style={textStyles.muted}>
          会话凭据只保存在系统 Keychain / Keystore 中。App 不经过中央目录寻找你的自托管部署。
        </Text>
      </Screen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  hero: { gap: 10, marginBottom: 6, marginTop: 20 },
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
