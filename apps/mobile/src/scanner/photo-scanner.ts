import { Platform } from "react-native";

import type { PhotoPermission, ScanCursor, ScanResult } from "@qr-lifecycle/contracts";

import { PhotoQrScannerNative } from "../../modules/photo-qr-scanner";

export interface PhotoQrScanner {
  requestPermission(): Promise<PhotoPermission>;
  scanSince(cursor?: ScanCursor): Promise<ScanResult>;
}

export class PhotoScannerUnsupportedError extends Error {
  constructor(message = "当前平台还不支持自动相册识别") {
    super(message);
    this.name = "PhotoScannerUnsupportedError";
  }
}

function requireScanner() {
  if (Platform.OS !== "ios") {
    throw new PhotoScannerUnsupportedError("Android 自动相册识别尚未实现，请使用手动上传");
  }
  if (!PhotoQrScannerNative) {
    throw new PhotoScannerUnsupportedError("自动识别需要重新构建 Development Build，Expo Go 不支持此功能");
  }
  return PhotoQrScannerNative;
}

export const photoQrScanner: PhotoQrScanner = {
  async requestPermission() {
    return requireScanner().requestPermission();
  },

  async scanSince(cursor) {
    return requireScanner().scanSince(
      cursor?.lastCreationTime ?? null,
      cursor?.seenAssetIds ?? [],
    );
  },
};
