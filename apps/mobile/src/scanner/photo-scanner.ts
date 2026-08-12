import { Platform } from "react-native";

import type {
  Channel,
  DetectedCommunityQr,
  PhotoPermission,
  QrCandidate,
  ScanCursor,
  ScanResult,
} from "@qr-lifecycle/contracts";

import { PhotoQrScannerNative } from "../../modules/photo-qr-scanner";
import {
  enrichQrCandidates,
  toDetectedCommunityQr,
} from "./community-qr-analysis";

export interface SelectedImageMetadata {
  assetId?: string | undefined;
  creationTime?: number | null;
}

export interface PhotoQrScanner {
  requestPermission(): Promise<PhotoPermission>;
  scanSince(cursor?: ScanCursor, channels?: readonly Channel[]): Promise<ScanResult>;
  analyzeImageUri(
    imageUri: string,
    channels?: readonly Channel[],
    metadata?: SelectedImageMetadata,
  ): Promise<QrCandidate[]>;
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

function selectedAssetId(imageUri: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < imageUri.length; index += 1) {
    hash ^= imageUri.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `selected:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export const photoQrScanner: PhotoQrScanner = {
  async requestPermission() {
    return requireScanner().requestPermission();
  },

  async scanSince(cursor, channels = []) {
    const result = await requireScanner().scanSince(
      cursor?.lastCreationTime ?? null,
      cursor?.seenAssetIds ?? [],
    );
    return {
      ...result,
      candidates: enrichQrCandidates(result.candidates, channels),
    };
  },

  async analyzeImageUri(imageUri, channels = [], metadata = {}) {
    const result = await requireScanner().analyzeImage(imageUri);
    const assetId = metadata.assetId ?? selectedAssetId(imageUri);
    const creationTime = metadata.creationTime === undefined
      ? Date.now()
      : metadata.creationTime;
    return enrichQrCandidates(
      result.payloads.map((payload) => ({
        assetId,
        creationTime,
        payload,
        imageUri,
        ocrLines: result.ocrLines,
      })),
      channels,
    );
  },
};

export async function analyzeQrCandidate(
  candidate: QrCandidate,
  channels: readonly Channel[],
): Promise<DetectedCommunityQr> {
  if (candidate.payload.trim()) return toDetectedCommunityQr(candidate, channels);
  const recognized = await photoQrScanner.analyzeImageUri(
    candidate.imageUri,
    channels,
    {
      assetId: candidate.assetId,
      creationTime: candidate.creationTime,
    },
  );
  const first = recognized[0];
  if (!first) throw new Error("这张图片中没有识别到二维码");
  return toDetectedCommunityQr(first, channels);
}

export async function analyzeQrCandidates(
  candidates: readonly QrCandidate[],
  channels: readonly Channel[],
): Promise<DetectedCommunityQr[]> {
  const analyzed = await Promise.all(
    candidates.map(async (candidate) => {
      if (candidate.payload.trim()) return [toDetectedCommunityQr(candidate, channels)];
      const recognized = await photoQrScanner.analyzeImageUri(
        candidate.imageUri,
        channels,
        {
          assetId: candidate.assetId,
          creationTime: candidate.creationTime,
        },
      );
      return recognized.map((item) => toDetectedCommunityQr(item, channels));
    }),
  );
  return analyzed.flat();
}
