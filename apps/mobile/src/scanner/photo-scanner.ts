import { Platform } from "react-native";

import type {
  Channel,
  DetectedCommunityQr,
  PhotoPermission,
  QrCandidate,
  ScanCursor,
  ScanResult,
} from "@qr-lifecycle/contracts";

import {
  PhotoQrScannerNative,
  type ScanProgress,
} from "../../modules/photo-qr-scanner";
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
  scanSince(
    jobId: string,
    cursor?: ScanCursor,
    channels?: readonly Channel[],
    limit?: number,
  ): Promise<ScanResult>;
  analyzeImageUri(
    jobId: string,
    imageUri: string,
    channels?: readonly Channel[],
    metadata?: SelectedImageMetadata,
  ): Promise<QrCandidate[]>;
  cancelScan(jobId: string): void;
  addProgressListener(listener: (progress: ScanProgress) => void): { remove(): void };
}

export class PhotoScannerUnsupportedError extends Error {
  constructor(message = "当前平台还不支持自动相册识别") {
    super(message);
    this.name = "PhotoScannerUnsupportedError";
  }
}

export class PhotoScanCancelledError extends Error {
  constructor() {
    super("扫描已停止");
    this.name = "PhotoScanCancelledError";
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

function translateNativeError(error: unknown): never {
  if (error instanceof Error && error.message.includes("ERR_SCAN_CANCELLED")) {
    throw new PhotoScanCancelledError();
  }
  throw error;
}

function ephemeralJobId(): string {
  return `scan-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export const photoQrScanner: PhotoQrScanner = {
  async requestPermission() {
    return requireScanner().requestPermission();
  },

  async scanSince(jobId, cursor, channels = [], limit = 100) {
    try {
      const result = await requireScanner().scanSince(
        jobId,
        cursor?.lastCreationTime ?? null,
        cursor?.seenAssetIds ?? [],
        Math.max(1, Math.min(Math.trunc(limit), 100)),
      );
      return {
        ...result,
        candidates: enrichQrCandidates(result.candidates, channels),
      };
    } catch (error) {
      translateNativeError(error);
    }
  },

  async analyzeImageUri(jobId, imageUri, channels = [], metadata = {}) {
    try {
      const result = await requireScanner().analyzeImage(jobId, imageUri);
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
    } catch (error) {
      translateNativeError(error);
    }
  },

  cancelScan(jobId) {
    requireScanner().cancelScan(jobId);
  },

  addProgressListener(listener) {
    return requireScanner().addListener("onScanProgress", listener);
  },
};

export async function analyzeQrCandidate(
  candidate: QrCandidate,
  channels: readonly Channel[],
): Promise<DetectedCommunityQr> {
  if (candidate.payload.trim()) return toDetectedCommunityQr(candidate, channels);
  const recognized = await photoQrScanner.analyzeImageUri(
    ephemeralJobId(),
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
        ephemeralJobId(),
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
