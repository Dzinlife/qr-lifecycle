# Mobile app

Expo SDK 57 development-build app for pairing with either a self-hosted or
managed QR Lifecycle deployment. Expo Go is not supported because local photo
QR/OCR recognition uses the `photo-qr-scanner` native module.

## Local development

From the repository root, install the workspace dependencies, then run:

```sh
pnpm --filter @qr-lifecycle/mobile native:generate
pnpm --filter @qr-lifecycle/mobile ios
```

`native:generate` generates `ios/` and `android/` locally; neither directory is
committed. Native module changes require rebuilding the development client.

The provisional App ID is `com.fallinlife.qrlifecycle`. The backend APNs topic
and the signed app's Bundle ID must stay identical if that identifier changes.

## Photo scanning behavior

- iOS requests PhotoKit read/write access and accepts full or limited access.
- Vision detects QR symbols and recognizes Simplified Chinese/English text in
  one local pass. Deterministic TypeScript parsers infer platform, group name,
  explicit/relative expiration, and confidence without a cloud model.
- The first scan inspects at most the newest 100 accessible photos. Subsequent
  scans use one deployment-wide creation-time cursor and same-timestamp asset
  IDs. Opening or returning to the app triggers an incremental scan.
- High-confidence results create or update a channel automatically with undo.
  Ambiguous results enter the discovery inbox for one-tap confirmation.
- Selecting one image runs the same native recognition pipeline; the operator
  never has to paste a decoded QR payload.
- Android deliberately reports `unsupported` until the MediaStore + ML Kit
  implementation is added. It never pretends to have automatic recognition.

Only recognized candidate images and structured device-produced metadata are
sent to the paired deployment for stable QR serving. There is no cloud or
server-side image-analysis path.

APNs registration only sends a real native device token. Simulators, denied
permission, missing push entitlements, Expo Go, and registration failures are
shown as recoverable states; no synthetic token is stored or uploaded.
