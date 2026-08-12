import { DynamicColorIOS, Platform } from "react-native";
import { NativeTabs } from "expo-router/unstable-native-tabs";

import { colors } from "@/components/ui";

const defaultIconColor = Platform.OS === "ios"
  ? DynamicColorIOS({ light: "#69736D", dark: "#AEB8B2" })
  : colors.muted;
const selectedColor = Platform.OS === "ios"
  ? DynamicColorIOS({ light: colors.primary, dark: "#73C9A2" })
  : colors.primary;

export default function TabLayout() {
  return (
    <NativeTabs
      iconColor={{ default: defaultIconColor, selected: selectedColor }}
      labelStyle={{
        default: { color: defaultIconColor, fontSize: 11 },
        selected: { color: selectedColor, fontSize: 11, fontWeight: "600" },
      }}
      minimizeBehavior="never"
      tintColor={selectedColor}
    >
      <NativeTabs.Trigger
        accessibilityLabel="发现新群码"
        contentStyle={{ backgroundColor: colors.background }}
        name="discover"
      >
        <NativeTabs.Trigger.Icon
          md="photo_library"
          sf={{ default: "photo.badge.plus", selected: "photo.badge.plus.fill" }}
        />
        <NativeTabs.Trigger.Label>发现</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger
        accessibilityLabel="查看群码"
        contentStyle={{ backgroundColor: colors.background }}
        name="channels"
      >
        <NativeTabs.Trigger.Icon md="qr_code" sf="qrcode" />
        <NativeTabs.Trigger.Label>群码</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger
        accessibilityLabel="打开设置"
        contentStyle={{ backgroundColor: colors.background }}
        name="settings"
      >
        <NativeTabs.Trigger.Icon
          md="settings"
          sf={{ default: "gearshape", selected: "gearshape.fill" }}
        />
        <NativeTabs.Trigger.Label>设置</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
