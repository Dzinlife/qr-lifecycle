import {
  useCallback,
  useLayoutEffect,
  useRef,
  type PropsWithChildren,
  type ReactNode,
} from "react";
import {
  ActivityIndicator,
  Animated,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollViewProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
  type Edges,
} from "react-native-safe-area-context";
import { EdgeFadeView } from "react-native-edge-fade";
import { ScrollViewMarker } from "react-native-screens/experimental";
import { Stack } from "expo-router";
import { BlurView } from "expo-blur";

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

export function Screen({
  children,
  edges = ["bottom"],
  progressiveTopBlur = false,
}: PropsWithChildren<{ edges?: Edges; progressiveTopBlur?: boolean }>) {
  if (progressiveTopBlur) {
    return (
      <ProgressiveTopScrollView
        contentContainerStyle={styles.screen}
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </ProgressiveTopScrollView>
    );
  }

  return (
    <SafeAreaView edges={edges} style={styles.safeArea}>
      <ScrollView
        automaticallyAdjustKeyboardInsets={Platform.OS === "ios"}
        contentContainerStyle={styles.screen}
        keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
        keyboardShouldPersistTaps="handled"
        contentInsetAdjustmentBehavior="automatic"
      >
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

export function ProgressiveTopScrollView({
  style,
  ...props
}: ScrollViewProps) {
  const scrollView = (
    <ScrollView
      automaticallyAdjustKeyboardInsets={Platform.OS === "ios"}
      contentInsetAdjustmentBehavior="automatic"
      keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
      keyboardShouldPersistTaps="handled"
      style={style}
      {...props}
    />
  );

  if (Platform.OS !== "ios") {
    return (
      <SafeAreaView edges={["top"]} style={styles.safeArea}>
        {scrollView}
      </SafeAreaView>
    );
  }

  return (
    <EdgeFadeView
      blurRadius={24}
      curve="soft"
      frostProgression={1}
      mode="blur"
      style={styles.safeArea}
      top={88}
    >
      <ScrollViewMarker
        scrollEdgeEffects={{ top: "hidden" }}
        style={styles.safeArea}
      >
        {scrollView}
      </ScrollViewMarker>
    </EdgeFadeView>
  );
}

export function NavigationDetailScreen({ children }: PropsWithChildren) {
  const insets = useSafeAreaInsets();
  const scrollViewRef = useRef<ScrollView>(null);
  const scrollDistance = useRef(new Animated.Value(0)).current;
  const headerInset = insets.top + 44;
  const initialOffsetY = Platform.OS === "ios" ? -headerInset : 0;
  const dividerOpacity = scrollDistance.interpolate({
    inputRange: [1, 11],
    outputRange: [0, 1],
    extrapolate: "clamp",
  });
  useLayoutEffect(() => {
    scrollDistance.setValue(0);
    scrollViewRef.current?.scrollTo({ animated: false, y: initialOffsetY });
  }, [initialOffsetY, scrollDistance]);
  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const distance = event.nativeEvent.contentOffset.y - initialOffsetY;
    scrollDistance.setValue(distance > 1 ? distance : 0);
  }, [initialOffsetY, scrollDistance]);

  return (
    <>
      <Stack.Screen
        options={{
          headerBackground: () => (
            <Animated.View
              pointerEvents="none"
              style={[styles.navigationHeaderBackground, { opacity: dividerOpacity }]}
            >
              <BlurView
                intensity={70}
                style={styles.navigationBlur}
                tint="systemThinMaterial"
              />
              <View style={styles.navigationDivider} />
            </Animated.View>
          ),
        }}
      />
      <View style={styles.safeArea}>
        <Animated.ScrollView
          automaticallyAdjustKeyboardInsets={Platform.OS === "ios"}
          contentContainerStyle={styles.screen}
          contentInset={{ top: headerInset }}
          contentInsetAdjustmentBehavior="never"
          contentOffset={{ x: 0, y: initialOffsetY }}
          keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
          keyboardShouldPersistTaps="handled"
          onScroll={handleScroll}
          ref={scrollViewRef}
          scrollEventThrottle={16}
          scrollIndicatorInsets={{ bottom: insets.bottom }}
        >
          {children}
        </Animated.ScrollView>
      </View>
    </>
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
  navigationDivider: {
    backgroundColor: "rgba(23, 33, 28, 0.18)",
    bottom: 0,
    height: StyleSheet.hairlineWidth,
    left: 0,
    position: "absolute",
    right: 0,
  },
  navigationHeaderBackground: { flex: 1 },
  navigationBlur: {
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
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
