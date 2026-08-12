import type { PropsWithChildren, ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { Link } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

export const colors = {
  background: "#F5F4EF",
  surface: "#FFFFFF",
  ink: "#17211C",
  muted: "#68716B",
  primary: "#176B4D",
  primaryPressed: "#10543B",
  border: "#DDE1DB",
  warning: "#8A5A14",
  warningSurface: "#FFF5D9",
  danger: "#A4382A",
  dangerSurface: "#FCE8E5",
  success: "#237A4E",
  successSurface: "#E4F4EA",
};

export function Screen({ children }: PropsWithChildren) {
  return (
    <SafeAreaView edges={["bottom"]} style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.screen}
        keyboardShouldPersistTaps="handled"
        contentInsetAdjustmentBehavior="automatic"
      >
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

type MainRoute = "/discover" | "/channels" | "/settings";

const mainRoutes: Array<{ href: MainRoute; label: string }> = [
  { href: "/discover", label: "发现" },
  { href: "/channels", label: "群码" },
  { href: "/settings", label: "设置" },
];

export function MainNavigation({ active }: { active: MainRoute }) {
  return (
    <View accessibilityRole="tablist" style={styles.mainNavigation}>
      {mainRoutes.map((route) => (
        <Link asChild href={route.href} key={route.href}>
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected: route.href === active }}
            style={StyleSheet.flatten([
              styles.mainNavigationItem,
              route.href === active && styles.mainNavigationItemActive,
            ])}
          >
            <Text
              style={[
                styles.mainNavigationLabel,
                route.href === active && styles.mainNavigationLabelActive,
              ]}
            >
              {route.label}
            </Text>
          </Pressable>
        </Link>
      ))}
    </View>
  );
}

export function Card({
  children,
  style,
}: PropsWithChildren<{ style?: StyleProp<ViewStyle> }>) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Button({
  children,
  onPress,
  disabled = false,
  tone = "primary",
}: {
  children: ReactNode;
  onPress: () => void;
  disabled?: boolean;
  tone?: "primary" | "secondary" | "danger";
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        tone === "secondary" && styles.secondaryButton,
        tone === "danger" && styles.dangerButton,
        pressed && !disabled && styles.buttonPressed,
        disabled && styles.buttonDisabled,
      ]}
    >
      <Text style={[styles.buttonText, tone === "secondary" && styles.secondaryButtonText]}>
        {children}
      </Text>
    </Pressable>
  );
}

export function Notice({
  children,
  tone = "warning",
}: PropsWithChildren<{ tone?: "warning" | "danger" | "success" }>) {
  return (
    <View
      style={[
        styles.notice,
        tone === "danger" && styles.dangerNotice,
        tone === "success" && styles.successNotice,
      ]}
    >
      <Text
        style={[
          styles.noticeText,
          tone === "danger" && styles.dangerNoticeText,
          tone === "success" && styles.successNoticeText,
        ]}
      >
        {children}
      </Text>
    </View>
  );
}

export function Loading({ label = "正在加载…" }: { label?: string }) {
  return (
    <View style={styles.loading}>
      <ActivityIndicator color={colors.primary} />
      <Text style={styles.muted}>{label}</Text>
    </View>
  );
}

export const textStyles = StyleSheet.create({
  eyebrow: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  title: { color: colors.ink, fontSize: 30, fontWeight: "800", letterSpacing: -0.5 },
  heading: { color: colors.ink, fontSize: 19, fontWeight: "700" },
  body: { color: colors.ink, fontSize: 16, lineHeight: 23 },
  muted: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  label: { color: colors.ink, fontSize: 14, fontWeight: "700", marginBottom: 7 },
});

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  screen: { flexGrow: 1, gap: 16, padding: 20, paddingBottom: 40 },
  mainNavigation: {
    backgroundColor: "#E8ECE8",
    borderRadius: 14,
    flexDirection: "row",
    gap: 3,
    padding: 3,
  },
  mainNavigationItem: {
    alignItems: "center",
    borderRadius: 11,
    flex: 1,
    justifyContent: "center",
    minHeight: 40,
    paddingHorizontal: 12,
  },
  mainNavigationItemActive: { backgroundColor: colors.surface },
  mainNavigationLabel: { color: colors.muted, fontSize: 14, fontWeight: "700" },
  mainNavigationLabelActive: { color: colors.primary },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 12,
    padding: 18,
  },
  button: {
    alignItems: "center",
    backgroundColor: colors.primary,
    borderRadius: 13,
    justifyContent: "center",
    minHeight: 50,
    paddingHorizontal: 18,
    paddingVertical: 13,
  },
  secondaryButton: { backgroundColor: "#E8ECE8" },
  dangerButton: { backgroundColor: colors.danger },
  buttonPressed: { backgroundColor: colors.primaryPressed, opacity: 0.9 },
  buttonDisabled: { opacity: 0.45 },
  buttonText: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" },
  secondaryButtonText: { color: colors.ink },
  notice: { backgroundColor: colors.warningSurface, borderRadius: 12, padding: 13 },
  dangerNotice: { backgroundColor: colors.dangerSurface },
  successNotice: { backgroundColor: colors.successSurface },
  noticeText: { color: colors.warning, fontSize: 14, lineHeight: 20 },
  dangerNoticeText: { color: colors.danger },
  successNoticeText: { color: colors.success },
  loading: { alignItems: "center", flex: 1, gap: 12, justifyContent: "center", padding: 40 },
  muted: { color: colors.muted, fontSize: 14 },
});
