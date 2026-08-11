import { z } from "zod";

export const channelPlatformSchema = z.enum([
  "wechat_group",
  "xiaohongshu_group",
  "discord",
  "other",
]);

export const channelSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
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
  tenantId: z.string().uuid(),
  channelId: z.string().uuid(),
  decodedPayloadHash: z.string(),
  sourceAssetId: z.string().nullable(),
  capturedAt: z.string().datetime().nullable(),
  activatedAt: z.string().datetime(),
  createdAt: z.string().datetime(),
});

export const deploymentInfoSchema = z.object({
  mode: z.enum(["self_hosted", "managed"]),
  apiOrigin: z.string().url(),
  productName: z.string(),
  registrationEnabled: z.boolean(),
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
}

export interface ScanResult {
  candidates: QrCandidate[];
  cursor: ScanCursor;
  hasIncrementalChanges: boolean;
}
