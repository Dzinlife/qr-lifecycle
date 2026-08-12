import { DefaultTheme, Stack, ThemeProvider } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { colors } from "@/components/ui";
import { AppProvider, useApp } from "@/context/app-context";
import { useNotificationRouting, usePushTokenRefresh } from "@/notifications/push";

const appTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: colors.background,
    border: colors.border,
    card: colors.background,
    primary: colors.primary,
    text: colors.ink,
  },
};

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
        <Stack.Screen name="onboarding" options={{ headerShown: false }} />
        <Stack.Screen name="web-bind" options={{ title: "绑定官方网站" }} />
        <Stack.Screen
          name="channels/[channelId]"
          options={{
            headerBlurEffect: "systemThinMaterial",
            headerStyle: { backgroundColor: "transparent" },
            headerTransparent: true,
            scrollEdgeEffects: {
              bottom: "hidden",
              left: "hidden",
              right: "hidden",
              top: "hidden",
            },
            title: "群码详情",
          }}
        />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AppProvider>
        <ThemeProvider value={appTheme}>
          <Navigation />
        </ThemeProvider>
      </AppProvider>
    </SafeAreaProvider>
  );
}
