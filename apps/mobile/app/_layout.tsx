import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { colors } from "@/components/ui";
import { AppProvider, useApp } from "@/context/app-context";
import { useNotificationRouting, usePushTokenRefresh } from "@/notifications/push";

function Navigation() {
  const { session, setDeviceId } = useApp();
  useNotificationRouting();
  usePushTokenRefresh(session, setDeviceId);
  return (
    <>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerBackButtonDisplayMode: "minimal",
          headerShadowVisible: false,
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.ink,
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="pair" options={{ title: "连接部署" }} />
        <Stack.Screen name="discover" options={{ headerShown: false }} />
        <Stack.Screen name="channels/index" options={{ headerShown: false }} />
        <Stack.Screen name="channels/[channelId]" options={{ title: "群码详情" }} />
        <Stack.Screen name="settings" options={{ headerShown: false }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AppProvider>
        <Navigation />
      </AppProvider>
    </SafeAreaProvider>
  );
}
