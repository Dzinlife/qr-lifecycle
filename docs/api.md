# API v1

Base path: `/api/v1`. JSON errors use:

```json
{ "error": { "code": "machine_code", "message": "Human-readable message" } }
```

Authenticated requests send `Authorization: Bearer <token>`. Tokens are scoped
to a tenant and stored only as hashes in D1.

## Deployment

- `GET /health`
- `POST /bootstrap` creates the first owner in a new self-hosted deployment.
- `POST /auth/request-code` requests an email sign-in code in managed mode.
- `POST /auth/verify-code` exchanges a sign-in code for a session.
- `GET /me` returns the current user, tenant and deployment capabilities.

## Channels

- `GET /channels`
- `POST /channels`
- `GET /channels/:channelId`
- `PATCH /channels/:channelId`
- `DELETE /channels/:channelId`
- `POST /channels/:channelId/qr-versions` uploads and activates an image.
- `GET /channels/:channelId/qr-versions`

Supported platform values are `wechat_group`, `xiaohongshu_group`, `discord`,
and `other`. `expiresAt` is an ISO-8601 instant. `remindBeforeMinutes` defaults
to 1440.

QR upload uses `multipart/form-data`:

- `image`: PNG, JPEG, or HEIC; maximum 10 MiB.
- `decodedPayload`: locally decoded QR string.
- `sourceAssetId`: optional opaque photo-library identifier.
- `capturedAt`: optional ISO-8601 instant.

Idempotency is the SHA-256 hash of `tenantId + channelId + decodedPayload`.

Direct channel upload remains a compatibility and manual-operations endpoint.
The product's normal mobile flow uses detections below.

## Mobile discovery and review

- `POST /detections/commit` submits one phone-recognized QR candidate.
- `GET /inbox` lists ambiguous detections requiring confirmation.
- `POST /inbox/:detectionId/accept` creates a channel or assigns the detection
  to an existing channel.
- `POST /inbox/:detectionId/ignore` dismisses a detection and removes its
  uncommitted image.
- `POST /detections/:detectionId/undo` reverses an automatic create or update.

Detection commit uses `multipart/form-data`:

- `metadata`: JSON produced by local QR/OCR analysis. It contains a stable
  `clientDetectionId`, asset/timestamp fields, decoded QR payload, recognized
  text lines, inferred platform/name/expiration, per-field confidence, and an
  optional tenant-local channel suggestion.
- `image`: only the image containing the recognized QR; maximum 10 MiB.

The Worker does not perform image recognition. It validates the structured
metadata, rechecks tenant ownership and channel matching, stores accepted or
pending images in R2, and persists only the decoded-payload hash. A commit is
idempotent on `(tenantId, clientDetectionId)`.

High-confidence new channels require at least `0.90` identity confidence.
Automatic replacement requires at least `0.95` channel-match confidence.
Everything else enters the inbox. Duplicate payloads are recorded but do not
create a new QR version. Automatic actions preserve prior channel state so they
can be undone; an automatically created channel is disabled rather than deleted.

## Mobile pairing and devices

- `POST /pairing-codes` creates a ten-minute one-time pairing code.
- `POST /pair` exchanges a code for a mobile session and deployment metadata.
- `POST /devices` upserts an APNs token for the current mobile session.
- `DELETE /devices/:deviceId` unregisters the device.

Pairing responses include the canonical API origin so the app can support any
self-hosted deployment without maintaining a central directory.

## Public live code

- `GET /q/:slug` serves an HTML page with the current QR image and refresh
  metadata.
- `GET /q/:slug/image` streams the active R2 object with ETag and cache headers.

Unknown, disabled, or empty channels return a branded unavailable page rather
than leaking tenant state.
