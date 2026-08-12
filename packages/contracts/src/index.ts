import { z } from "zod";

export const channelPlatformSchema = z.enum([
  "wechat_group",
  "xiaohongshu_group",
  "discord",
  "other",
]);

export const channelSchema = z.object({
  id: z.string().uuid(),
  accountId: z.string().uuid(),
  name: z.string().min(1).max(120),
  platform: channelPlatformSchema,
  slug: z.string().min(3).max(64),
  expiresAt: z.string().datetime().nullable(),
  remindBeforeMinutes: z.number().int().min(0).max(43_200),
  activeQrVersionId: z.string().uuid().nullable(),
  disabledAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const createChannelSchema = z.object({
  name: z.string().trim().min(1).max(120),
  platform: channelPlatformSchema,
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/),
  expiresAt: z.string().datetime().nullable().default(null),
  remindBeforeMinutes: z.number().int().min(0).max(43_200).default(1_440),
});

export const updateChannelSchema = createChannelSchema.partial();

export const qrVersionSchema = z.object({
  id: z.string().uuid(),
  accountId: z.string().uuid(),
  channelId: z.string().uuid(),
  decodedPayloadHash: z.string(),
  sourceAssetId: z.string().nullable(),
  capturedAt: z.string().datetime().nullable(),
  activatedAt: z.string().datetime(),
  createdAt: z.string().datetime(),
});

export const deploymentInfoSchema = z.object({
  apiOrigin: z.string().url(),
  productName: z.string(),
});

export const accountSchema = z.object({
  id: z.string().uuid(),
  createdAt: z.string().datetime(),
});

export const mobileBootstrapResponseSchema = z.object({
  sessionToken: z.string().min(32),
  account: accountSchema,
  device: z.object({ id: z.string().uuid() }),
  deployment: deploymentInfoSchema,
});

export const webBindingSchema = z.object({
  id: z.string().uuid(),
  challenge: z.string().min(32),
  qrValue: z.string().min(1),
  expiresAt: z.string().datetime(),
});

export const webBindingStatusSchema = z.enum(["pending", "approved", "expired"]);

export const webSessionSchema = z.object({
  id: z.string().uuid(),
  userAgent: z.string().nullable(),
  createdAt: z.string().datetime(),
  lastUsedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
});

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});

export type ChannelPlatform = z.infer<typeof channelPlatformSchema>;
export type Channel = z.infer<typeof channelSchema>;
export type CreateChannelInput = z.infer<typeof createChannelSchema>;
export type UpdateChannelInput = z.infer<typeof updateChannelSchema>;
export type QrVersion = z.infer<typeof qrVersionSchema>;
export type DeploymentInfo = z.infer<typeof deploymentInfoSchema>;
export type Account = z.infer<typeof accountSchema>;
export type MobileBootstrapResponse = z.infer<typeof mobileBootstrapResponseSchema>;
export type WebBinding = z.infer<typeof webBindingSchema>;
export type WebBindingStatus = z.infer<typeof webBindingStatusSchema>;
export type WebSession = z.infer<typeof webSessionSchema>;

export interface PhotoPermission {
  status: "granted" | "limited" | "denied";
  canAskAgain: boolean;
}

export interface ScanCursor {
  lastCreationTime?: number;
  seenAssetIds: string[];
}

export interface QrCandidate {
  assetId: string;
  creationTime: number | null;
  payload: string;
  imageUri: string;
  ocrLines?: OcrLine[];
  platform?: ChannelPlatform | null;
  name?: string | null;
  expiresAt?: string | null;
  expirySource?: ExpirySource;
  fieldConfidences?: FieldConfidences;
  suggestedChannelId?: string | null;
  matchConfidence?: number;
}

export interface ScanResult {
  candidates: QrCandidate[];
  cursor: ScanCursor;
  hasIncrementalChanges: boolean;
  observedAssetCount?: number;
  scannedAssetCount?: number;
}

export const confidenceScoreSchema = z.number().min(0).max(1);

export const ocrLineSchema = z.object({
  text: z.string().trim().min(1).max(500),
  confidence: confidenceScoreSchema,
});

export const expirySourceSchema = z.enum([
  "explicit",
  "relative",
  "platform_default",
  "unknown",
]);

export const fieldConfidencesSchema = z.object({
  platform: confidenceScoreSchema,
  name: confidenceScoreSchema,
  expiresAt: confidenceScoreSchema,
});

const deviceCreationTimeSchema = z
  .number()
  .finite()
  .nonnegative()
  .transform((value) => Math.trunc(value));

/**
 * Structured, on-device recognition output. `imageUri` is deliberately absent:
 * it is a device-local handle and must never be serialized as detection metadata.
 */
export const detectedCommunityQrSchema = z.object({
  clientDetectionId: z.string().uuid(),
  assetId: z.string().min(1).max(512),
  capturedAt: z.string().datetime().nullable(),
  creationTime: deviceCreationTimeSchema.nullable(),
  decodedPayload: z.string().min(1).max(8_192),
  ocrLines: z.array(ocrLineSchema).max(200),
  platform: channelPlatformSchema.nullable(),
  name: z.string().trim().min(1).max(120).nullable(),
  expiresAt: z.string().datetime().nullable(),
  expirySource: expirySourceSchema,
  fieldConfidences: fieldConfidencesSchema,
  suggestedChannelId: z.string().uuid().nullable(),
  matchConfidence: confidenceScoreSchema,
});

export const detectionStatusSchema = z.enum([
  "needs_review",
  "committed",
  "ignored",
  "undone",
]);

export const detectionActionSchema = z.enum([
  "auto_create",
  "auto_update",
  "duplicate",
  "needs_review",
  "accepted_create",
  "accepted_update",
  "ignore",
  "undo",
]);

export const detectionSchema = z.object({
  id: z.string().uuid(),
  accountId: z.string().uuid(),
  clientDetectionId: z.string().uuid(),
  assetId: z.string(),
  capturedAt: z.string().datetime().nullable(),
  creationTime: z.number().int().nonnegative().nullable(),
  ocrLines: z.array(ocrLineSchema),
  platform: channelPlatformSchema.nullable(),
  name: z.string().nullable(),
  expiresAt: z.string().datetime().nullable(),
  expirySource: expirySourceSchema,
  fieldConfidences: fieldConfidencesSchema,
  suggestedChannelId: z.string().uuid().nullable(),
  matchConfidence: confidenceScoreSchema,
  status: detectionStatusSchema,
  action: detectionActionSchema,
  reason: z.string(),
  channelId: z.string().uuid().nullable(),
  qrVersionId: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  decidedAt: z.string().datetime().nullable(),
  undoneAt: z.string().datetime().nullable(),
});

export const detectionDecisionSchema = z.object({
  action: detectionActionSchema,
  automatic: z.boolean(),
  confidence: confidenceScoreSchema,
  reason: z.string(),
  channelId: z.string().uuid().nullable(),
  qrVersionId: z.string().uuid().nullable(),
});

export const inboxItemSchema = z.object({
  detection: detectionSchema,
  suggestedChannel: channelSchema.nullable(),
});

export const acceptInboxItemSchema = z
  .object({
    channelId: z.string().uuid().optional(),
    createNew: z.boolean().optional(),
    name: z.string().trim().min(1).max(120).optional(),
    platform: channelPlatformSchema.optional(),
    expiresAt: z.string().datetime().nullable().optional(),
  })
  .refine((value) => !(value.createNew && value.channelId), {
    message: "createNew and channelId cannot be used together",
  })
  .default({});

export const commitDetectionResponseSchema = z.object({
  detection: detectionSchema,
  decision: detectionDecisionSchema,
  channel: channelSchema.nullable(),
  qrVersion: qrVersionSchema.nullable(),
});

export const inboxResponseSchema = z.object({ items: z.array(inboxItemSchema) });
export const ignoreDetectionResponseSchema = z.object({ detection: detectionSchema });
export const undoDetectionResponseSchema = z.object({
  detection: detectionSchema,
  channel: channelSchema.nullable(),
});

export type OcrLine = z.infer<typeof ocrLineSchema>;
export type ExpirySource = z.infer<typeof expirySourceSchema>;
export type FieldConfidences = z.infer<typeof fieldConfidencesSchema>;
export type DetectedCommunityQr = z.infer<typeof detectedCommunityQrSchema>;
export type DetectionStatus = z.infer<typeof detectionStatusSchema>;
export type DetectionAction = z.infer<typeof detectionActionSchema>;
export type Detection = z.infer<typeof detectionSchema>;
export type DetectionDecision = z.infer<typeof detectionDecisionSchema>;
export type InboxItem = z.infer<typeof inboxItemSchema>;
export type AcceptInboxItemInput = z.infer<typeof acceptInboxItemSchema>;
export type CommitDetectionResponse = z.infer<
  typeof commitDetectionResponseSchema
>;
export type InboxResponse = z.infer<typeof inboxResponseSchema>;
export type IgnoreDetectionResponse = z.infer<
  typeof ignoreDetectionResponseSchema
>;
export type UndoDetectionResponse = z.infer<typeof undoDetectionResponseSchema>;
