# Architecture

## Product boundary

QR Lifecycle serves individual creators, community operators, and small teams.
There is no enterprise edition. Hosted multi-tenancy exists only to isolate
accounts and workspaces in the managed service.

## Runtime layout

```text
Official mobile app
  ├─ Expo / React Native UI
  ├─ iOS PhotoKit + Vision QR/OCR adapter
  ├─ deterministic local field extraction and matching
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

The Worker is the single server security boundary. Web and mobile clients never
read D1 or R2 directly. Image understanding happens only on the phone: there is
no server-side or cloud-model image analysis path.

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
  scanSince(jobId: string, cursor?: ScanCursor, limit?: number): Promise<ScanResult>;
  cancelScan(jobId: string): void;
}
```

The iOS implementation uses PhotoKit incremental changes and
`VNDetectBarcodesRequest` plus `VNRecognizeTextRequest`. It detects QR codes on
small PhotoKit images first and only performs accurate OCR for QR hits. Native
jobs emit progress and track cancellable PhotoKit and Vision requests. A future Android
implementation can use MediaStore and ML Kit without changing application flows
or API contracts. React Native owns orchestration; native adapters return a
shared structured detection type.

## Core entities

- `users`: identities in a deployment.
- `tenants`: isolated workspaces.
- `memberships`: user roles within tenants.
- `sessions`: hashed web/mobile bearer tokens.
- `channels`: one expiring group invite and one stable public slug.
- `qr_versions`: immutable QR uploads; one version is active per channel.
- `detections`: idempotent, structured results produced by the phone, including
  confidence, decision state, and reversible action metadata.
- `channel_aliases`: tenant-scoped corrected names used for future matching.
- `devices`: APNs tokens and notification preferences.
- `pairing_codes`: short-lived handoff from authenticated web to mobile.
- `reminder_deliveries`: idempotency and APNs response history.

Every tenant-owned table carries `tenant_id`; every query must include it.

## Automatic discovery flow

1. The operator saves a new group QR image to Photos.
2. On launch or foreground entry, the app scans only newly inserted assets when
   possible. While active it can also react to PhotoKit changes.
3. Vision first decodes QR data from thumbnails, then OCRs only QR-bearing
   images locally. Deterministic platform adapters infer the
   platform, group name, explicit or relative expiration, and field confidence.
4. The app compares structured signals with the paired tenant's channels. A QR
   payload is never treated as channel identity because replacement codes change.
5. Before advancing the PhotoKit cursor, the app copies each detection and its
   image into a durable device outbox. Upload failure retries this outbox without
   repeating OCR. The app then sends one structured detection and its candidate image. It never sends
   unrelated Photos assets or requests cloud image understanding.
6. High-confidence discoveries are created or updated automatically; ambiguous
   discoveries enter the mobile inbox for one-tap acceptance, assignment, or
   ignore.
7. The Worker stores accepted images in R2, preserves immutable QR history, and
   records enough state to undo automatic actions. The stable `/q/:slug` page
   immediately follows the active version.

The server treats image bytes and decoded payload as untrusted input. It
validates size and MIME type and never fetches a client-provided URL.

## Reminder flow

Cloudflare Cron runs every 15 minutes in UTC. It selects channels whose next
reminder is due and inserts an idempotency record before attempting APNs. The
app opens the discovery screen, scans newly saved Photos assets, and matches the
replacement without asking the operator to select a channel first.

Expiration uses explicit OCR dates first, then relative phrases anchored to the
photo timestamp. Unknown values remain unknown instead of inventing an exact
date. The web UI remains an auxiliary place to correct metadata.

## Web boundary

The product is mobile-first because group QR codes are generated and saved on
phones. The web app provides bootstrap, phone pairing, status, stable-link copy,
history, correction, and manual channel creation as a fallback. It deliberately
does not offer QR image upload or browser OCR.

## APNs trust model

The official App ID uses a production-only, topic-specific APNs key. For fully
self-hosted official-app push, that credential is intentionally distributable,
as in Bark. Device tokens remain private and are never used as public routing
keys. Public push endpoints use separate random device keys and rate limits.

The code supports credential rotation by `key_id`; APNs JWTs are cached only
within their valid lifetime and regenerated safely after Worker cold starts.
