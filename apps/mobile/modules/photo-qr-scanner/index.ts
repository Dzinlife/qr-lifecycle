import { requireOptionalNativeModule } from "expo";

import type { PhotoPermission, ScanCursor, ScanResult } from "@qr-lifecycle/contracts";

interface PhotoQrScannerNativeModule {
  requestPermission(): Promise<PhotoPermission>;
  scanSince(lastCreationTime: number | null, seenAssetIds: string[]): Promise<ScanResult>;
}

export const PhotoQrScannerNative =
  requireOptionalNativeModule<PhotoQrScannerNativeModule>("PhotoQrScanner");

export type { PhotoPermission, ScanCursor, ScanResult };
