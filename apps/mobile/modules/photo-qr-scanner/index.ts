import { NativeModule, requireOptionalNativeModule } from "expo";

import type { OcrLine, PhotoPermission, ScanCursor, ScanResult } from "@qr-lifecycle/contracts";

export interface ImageQrAnalysis {
  payloads: string[];
  ocrLines: OcrLine[];
}

export interface ScanProgress {
  jobId: string;
  stage: "detecting" | "recognizing";
  processed: number;
  total: number;
}

interface PhotoQrScannerEvents extends Record<string, (...args: any[]) => void> {
  onScanProgress(event: ScanProgress): void;
}

declare class PhotoQrScannerNativeModule extends NativeModule<PhotoQrScannerEvents> {
  requestPermission(): Promise<PhotoPermission>;
  scanSince(
    jobId: string,
    lastCreationTime: number | null,
    seenAssetIds: string[],
    limit: number,
  ): Promise<ScanResult>;
  analyzeImage(jobId: string, imageUri: string): Promise<ImageQrAnalysis>;
  cancelScan(jobId: string): void;
}

export const PhotoQrScannerNative =
  requireOptionalNativeModule<PhotoQrScannerNativeModule>("PhotoQrScanner");

export type { PhotoPermission, ScanCursor, ScanResult };
