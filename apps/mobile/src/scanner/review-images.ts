import { Directory, File, Paths } from "expo-file-system";

interface ReviewImageRecord {
  detectionId: string;
  scope: string;
  uri: string;
}

interface ReviewImageIndex {
  version: 1;
  items: ReviewImageRecord[];
}

const reviewDirectory = new Directory(Paths.document, "review-qr-images");
const indexFile = new File(reviewDirectory, "index.json");

function ensureDirectory(): void {
  reviewDirectory.create({ idempotent: true, intermediates: true });
}

function safeExtension(source: File): string {
  return /^\.[a-z0-9]{1,8}$/iu.test(source.extension) ? source.extension : ".jpg";
}

async function readIndex(): Promise<ReviewImageRecord[]> {
  if (!indexFile.exists) return [];
  try {
    const parsed = JSON.parse(await indexFile.text()) as Partial<ReviewImageIndex>;
    if (!Array.isArray(parsed.items)) return [];
    return parsed.items.filter((item): item is ReviewImageRecord =>
      typeof item?.detectionId === "string"
      && typeof item.scope === "string"
      && typeof item.uri === "string");
  } catch {
    return [];
  }
}

function writeIndex(items: ReviewImageRecord[]): void {
  ensureDirectory();
  indexFile.write(JSON.stringify({ version: 1, items } satisfies ReviewImageIndex));
}

function deleteIfPresent(uri: string): void {
  const file = new File(uri);
  if (file.exists) file.delete();
}

export async function preserveReviewImage(
  scope: string,
  detectionId: string,
  sourceUri: string,
): Promise<void> {
  const source = new File(sourceUri);
  if (!source.exists) return;
  ensureDirectory();
  const destination = new File(reviewDirectory, `${detectionId}${safeExtension(source)}`);
  if (source.uri !== destination.uri) await source.copy(destination, { overwrite: true });

  const items = await readIndex();
  const previous = items.find((item) => item.detectionId === detectionId);
  if (previous && previous.uri !== destination.uri) deleteIfPresent(previous.uri);
  writeIndex([
    ...items.filter((item) => item.detectionId !== detectionId),
    { detectionId, scope, uri: destination.uri },
  ]);
}

export async function loadReviewImageUris(
  scope: string,
  detectionIds: readonly string[],
): Promise<Record<string, string>> {
  const wanted = new Set(detectionIds);
  const result: Record<string, string> = {};
  for (const item of await readIndex()) {
    if (item.scope !== scope || !wanted.has(item.detectionId)) continue;
    if (new File(item.uri).exists) result[item.detectionId] = item.uri;
  }
  return result;
}

export async function removeReviewImage(detectionId: string): Promise<void> {
  const items = await readIndex();
  const removed = items.find((item) => item.detectionId === detectionId);
  if (!removed) return;
  deleteIfPresent(removed.uri);
  writeIndex(items.filter((item) => item.detectionId !== detectionId));
}

export function clearReviewImages(): void {
  if (reviewDirectory.exists) reviewDirectory.delete();
}
