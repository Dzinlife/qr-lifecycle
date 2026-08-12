import { Stack } from "expo-router";

import { colors } from "@/components/ui";

export default function ChannelsLayout() {
  return (
    <Stack
      screenOptions={{
        contentStyle: { backgroundColor: colors.background },
        headerBackButtonDisplayMode: "minimal",
        headerShadowVisible: false,
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.ink,
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="[channelId]" options={{ title: "群码详情" }} />
    </Stack>
  );
}
