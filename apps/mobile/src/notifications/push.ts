import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import * as Application from "expo-application";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { useRouter } from "expo-router";

import { registerDevice } from "@/api/client";
import { notificationChannelId } from "@/lib/pure";
import type { MobileSession } from "@/session/storage";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export type PushRegistrationState =
  | { status: "registered"; deviceId?: string }
  | { status: "denied" }
  | { status: "unavailable"; message: string };

async function apnsEnvironment(): Promise<"sandbox" | "production" | null> {
  const environment = await Application.getIosPushNotificationServiceEnvironmentAsync();
  if (environment === "development") return "sandbox";
  if (environment === "production") return "production";
  return null;
}

async function uploadNativeToken(
  session: MobileSession,
  token: Notifications.DevicePushToken,
): Promise<string | undefined> {
  if (token.type !== "ios" || typeof token.data !== "string" || !token.data) {
    throw new Error("系统没有返回可用的 APNs Token");
  }
  const environment = await apnsEnvironment();
  if (!environment) throw new Error("无法判断 APNs 环境，未上传 Token");
  return registerDevice(session, token.data, environment);
}

export async function enablePushNotifications(
  session: MobileSession,
): Promise<PushRegistrationState> {
  if (Platform.OS !== "ios") {
    return { status: "unavailable", message: "当前后端只支持 APNs，Android 推送将在后续版本接入" };
  }
  if (!Device.isDevice) {
    return { status: "unavailable", message: "iOS 模拟器不会生成真实 APNs Token，请使用真机" };
  }

  let permission = await Notifications.getPermissionsAsync();
  if (permission.status !== "granted") permission = await Notifications.requestPermissionsAsync();
  if (permission.status !== "granted") return { status: "denied" };

  try {
    const nativeToken = await Notifications.getDevicePushTokenAsync();
    const deviceId = await uploadNativeToken(session, nativeToken);
    return deviceId ? { status: "registered", deviceId } : { status: "registered" };
  } catch {
    return {
      status: "unavailable",
      message: "APNs 注册失败。请检查真机签名、Push Notifications capability 和网络后重试",
    };
  }
}

export function usePushTokenRefresh(
  session: MobileSession | null,
  onDeviceId: (deviceId: string | undefined) => Promise<void>,
) {
  useEffect(() => {
    if (Platform.OS !== "ios" || !session?.deviceId) return undefined;
    const subscription = Notifications.addPushTokenListener((token) => {
      void uploadNativeToken(session, token)
        .then(onDeviceId)
        .catch(() => {
          // A transient refresh failure is retried next time the user enables
          // notifications. No fake or stale token is uploaded.
        });
    });
    return () => subscription.remove();
  }, [onDeviceId, session]);
}

export function useNotificationRouting() {
  const router = useRouter();
  const handledInitial = useRef(false);

  useEffect(() => {
    const open = (response: Notifications.NotificationResponse | null) => {
      if (!response) return;
      const channelId = notificationChannelId(response.notification.request.content.data);
      if (channelId) {
        // Expiry reminders open discovery, not a preselected channel. The app
        // scans Photos on foreground and matches the saved replacement itself.
        router.push("/discover");
        Notifications.clearLastNotificationResponse();
      }
    };

    if (!handledInitial.current) {
      handledInitial.current = true;
      open(Notifications.getLastNotificationResponse());
    }
    const subscription = Notifications.addNotificationResponseReceivedListener(open);
    return () => subscription.remove();
  }, [router]);
}
