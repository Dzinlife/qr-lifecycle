# API v1

Base path: `/api/v1`. Errors use:

```json
{ "error": { "code": "machine_code", "message": "Human-readable message" } }
```

Mobile requests use `Authorization: Bearer <token>`. Website sessions use only an
HttpOnly cookie; unsafe website requests require exact same origin.

## Mobile identity

- `POST /mobile/bootstrap` verifies `appTransactionJws` in production and returns
  the hidden account, stable device, mobile session token, and official origin.
- `POST /devices` registers APNs for the authenticated device.
- `DELETE /devices/:deviceId` disconnects only that same device.

`installationId` is always required as the stable device key. It is accepted as
the account identity only when the deployment explicitly enables the staging
development fallback.

## Website binding

- `POST /web-bindings` returns `{ binding, browserSecret }`.
- `GET /web-bindings/:id` reads status using `X-Binding-Secret`.
- `POST /web-bindings/:id/approve` requires mobile bearer plus the QR challenge.
- `POST /web-bindings/:id/consume` uses `X-Binding-Secret` and sets the web cookie.
- `GET /me` returns the hidden account and current session metadata.
- `POST /web/logout` revokes the current cookie.
- `GET /web-sessions` and `DELETE /web-sessions/:id` require mobile bearer.

Bindings expire after two minutes and can be consumed once.

## Channels and QR versions

- `GET /channels`
- `POST /channels` (mobile only; normal creation occurs through detections)
- `GET /channels/:channelId`
- `PATCH /channels/:channelId`
- `DELETE /channels/:channelId`
- `GET /channels/:channelId/qr-versions`
- `POST /channels/:channelId/qr-versions` (mobile multipart only)

The upload contains `image`, locally decoded `decodedPayload`, optional
`sourceAssetId`, and optional `capturedAt`. PNG, JPEG, and HEIC are accepted up to
10 MiB. Idempotency hashes `accountId + decodedPayload` inside a channel.

## Mobile discovery and review

- `POST /detections/commit` submits structured local OCR/QR metadata plus the one
  candidate image.
- `GET /inbox`
- `POST /inbox/:detectionId/accept`
- `POST /inbox/:detectionId/ignore`
- `POST /detections/:detectionId/undo`

The Worker does not recognize images. It validates metadata, rechecks account-local
matching, and is idempotent on `(accountId, clientDetectionId)`. New-channel
automation requires at least 0.90 identity confidence; replacement requires at
least 0.95 match confidence. Duplicate payloads do not create new QR versions.

## Public live code

- `GET /q/:slug`
- `GET /q/:slug/image` — stable, cross-origin embeddable image URL that always
  resolves to the current native group QR image. The URL never changes;
  `Cache-Control: no-cache` and ETag validation prevent an old version from
  remaining visible after the phone updates it.

Unknown, disabled, or empty channels return a branded unavailable page without
exposing private account state.
