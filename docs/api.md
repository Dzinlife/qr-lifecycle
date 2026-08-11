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
