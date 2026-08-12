import { Directory, File, Paths } from "expo-file-system";

import type { DetectedCommunityQr, QrCandidate } from "@qr-lifecycle/contracts";

export interface PendingDetection {
  scope: string;
  detection: DetectedCommunityQr;
  candidate: QrCandidate;
  enqueuedAt: string;
}

interface PersistedQueue {
  version: 1;
  items: PendingDetection[];
}

const queueDirectory = new Directory(Paths.document, "pending-qr-detections");
const queueFile = new File(queueDirectory, "queue.json");
const MAX_PENDING_ITEMS = 100;

function ensureDirectory(): void {
  queueDirectory.create({ idempotent: true, intermediates: true });
}

function isPendingDetection(value: unknown): value is PendingDetection {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<PendingDetection>;
  return typeof item.scope === "string"
    && typeof item.enqueuedAt === "string"
    && typeof item.detection?.clientDetectionId === "string"
    && typeof item.candidate?.imageUri === "string";
}

async function readQueue(): Promise<PendingDetection[]> {
  if (!queueFile.exists) return [];
  try {
    const parsed = JSON.parse(await queueFile.text()) as Partial<PersistedQueue>;
    return Array.isArray(parsed.items) ? parsed.items.filter(isPendingDetection) : [];
  } catch {
    return [];
  }
}

function writeQueue(items: PendingDetection[]): void {
  ensureDirectory();
  queueFile.write(JSON.stringify({ version: 1, items } satisfies PersistedQueue));
}

function safeExtension(source: File): string {
  return /^\.[a-z0-9]{1,8}$/iu.test(source.extension) ? source.extension : ".jpg";
}

function removeImageIfPresent(uri: string): void {
  const file = new File(uri);
  if (file.exists) file.delete();
}

export async function enqueuePendingDetections(
  scope: string,
  detections: readonly DetectedCommunityQr[],
  candidates: readonly QrCandidate[],
): Promise<void> {
  if (detections.length !== candidates.length) {
    throw new Error("识别结果与本地图片数量不一致，请重新扫描");
  }

  ensureDirectory();
  const existing = await readQueue();
  const byId = new Map(existing.map((item) => [item.detection.clientDetectionId, item]));

  for (const [index, detection] of detections.entries()) {
    const candidate = candidates[index];
    if (!candidate) continue;
    const source = new File(candidate.imageUri);
    if (!source.exists) throw new Error("识别图片已不可用，请重新选择图片");
    const destination = new File(
      queueDirectory,
      `${detection.clientDetectionId}${safeExtension(source)}`,
    );
    if (source.uri !== destination.uri) {
      await source.copy(destination, { overwrite: true });
    }
    byId.set(detection.clientDetectionId, {
      scope,
      detection,
      candidate: { ...candidate, imageUri: destination.uri },
      enqueuedAt: new Date().toISOString(),
    });
  }

  const allItems = [...byId.values()].sort((lhs, rhs) =>
    lhs.enqueuedAt.localeCompare(rhs.enqueuedAt));
  const dropped = allItems.slice(0, Math.max(0, allItems.length - MAX_PENDING_ITEMS));
  dropped.forEach((item) => removeImageIfPresent(item.candidate.imageUri));
  writeQueue(allItems.slice(-MAX_PENDING_ITEMS));
}

export async function loadPendingDetections(scope: string): Promise<PendingDetection[]> {
  const items = await readQueue();
  return items.filter((item) => item.scope === scope && new File(item.candidate.imageUri).exists);
}

export async function removePendingDetection(clientDetectionId: string): Promise<void> {
  const items = await readQueue();
  const removed = items.find((item) => item.detection.clientDetectionId === clientDetectionId);
  if (!removed) return;
  writeQueue(items.filter((item) => item.detection.clientDetectionId !== clientDetectionId));
  removeImageIfPresent(removed.candidate.imageUri);
}

export async function clearPendingDetections(): Promise<void> {
  if (queueDirectory.exists) queueDirectory.delete();
}
