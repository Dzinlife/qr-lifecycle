# Architecture

## Product boundary

QR Lifecycle serves individual creators, community operators, and small teams.
There is no enterprise edition. Hosted multi-tenancy exists only to isolate
accounts and workspaces in the managed service.

## Runtime layout

```text
Official mobile app
  ├─ Expo / React Native UI
  ├─ iOS PhotoKit + Vision adapter
  ├─ APNs registration
  └─ deployment pairing credential
             │ HTTPS
             ▼
Cloudflare Worker
  ├─ REST API, public /q/:slug page, and Web static assets
  ├─ D1 relational state
  ├─ R2 QR images
  ├─ Cron reminder scan
  └─ direct APNs provider requests
             │
             ▼
Web management app
```

The Worker is the single security boundary. Web and mobile clients never read
D1 or R2 directly.

## Distribution modes

The same code supports two deployment modes:

- `self_hosted`: one bootstrap owner by default; additional workspaces remain
  supported. Releases may install the official app's public, topic-specific
  production APNs credential using the Bark trust model.
- `managed`: many tenants share one deployment. The same APNs credential is a
  Worker secret and billing controls hosted access only.

## Mobile choice

Use Expo SDK 57 with a development build, not Expo Go. Cross-platform screens,
networking, authentication, and state are TypeScript. Platform photo scanning
is an adapter:

```ts
interface PhotoQrScanner {
  requestPermission(): Promise<PhotoPermission>;
  scanSince(cursor?: ScanCursor): Promise<ScanResult>;
}
```

The iOS implementation uses PhotoKit incremental changes and
`VNDetectBarcodesRequest`. A future Android implementation can use MediaStore
and ML Kit without changing application flows or API contracts.

## Core entities

- `users`: identities in a deployment.
- `tenants`: isolated workspaces.
- `memberships`: user roles within tenants.
- `sessions`: hashed web/mobile bearer tokens.
- `channels`: one expiring group invite and one stable public slug.
- `qr_versions`: immutable QR uploads; one version is active per channel.
- `devices`: APNs tokens and notification preferences.
- `pairing_codes`: short-lived handoff from authenticated web to mobile.
- `reminder_deliveries`: idempotency and APNs response history.

Every tenant-owned table carries `tenant_id`; every query must include it.

## QR update flow

1. The operator saves a new group QR image to Photos.
2. The app scans only newly inserted assets when possible.
3. Vision decodes QR candidates locally.
4. The app matches decoded candidates against a selected channel or asks once.
5. The image and decoded payload hash are uploaded to the paired deployment.
6. The Worker stores the object in R2 and atomically activates a new version.
7. The stable `/q/:slug` page immediately serves the new QR image.

The server treats image bytes and decoded payload as untrusted input. It
validates size and MIME type and never fetches a client-provided URL.

## Reminder flow

Cloudflare Cron runs every 15 minutes in UTC. It selects channels whose next
reminder is due and inserts an idempotency record before attempting APNs. The
app opens directly to the relevant channel update screen.

Expiration is user-configured in MVP because platform QR formats do not expose
a dependable expiry timestamp. Later versions may learn defaults from observed
replacement history.

## APNs trust model

The official App ID uses a production-only, topic-specific APNs key. For fully
self-hosted official-app push, that credential is intentionally distributable,
as in Bark. Device tokens remain private and are never used as public routing
keys. Public push endpoints use separate random device keys and rate limits.

The code supports credential rotation by `key_id`; APNs JWTs are cached only
within their valid lifetime and regenerated safely after Worker cold starts.
