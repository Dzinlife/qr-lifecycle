import { requireOptionalNativeModule } from "expo";

import type { OcrLine, PhotoPermission, ScanCursor, ScanResult } from "@qr-lifecycle/contracts";

export interface ImageQrAnalysis {
  payloads: string[];
  ocrLines: OcrLine[];
}

interface PhotoQrScannerNativeModule {
  requestPermission(): Promise<PhotoPermission>;
  scanSince(lastCreationTime: number | null, seenAssetIds: string[]): Promise<ScanResult>;
  analyzeImage(imageUri: string): Promise<ImageQrAnalysis>;
}

export const PhotoQrScannerNative =
  requireOptionalNativeModule<PhotoQrScannerNativeModule>("PhotoQrScanner");

export type { PhotoPermission, ScanCursor, ScanResult };
