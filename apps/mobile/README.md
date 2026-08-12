# Mobile app

Expo SDK 57 development-build app for pairing with either a self-hosted or
managed QR Lifecycle deployment. Expo Go is not supported because photo QR
scanning uses the local `photo-qr-scanner` native module.

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
- Vision scans QR symbols locally; decoded payloads never leave the phone until
  the user confirms an update.
- The first scan inspects at most the newest 100 accessible photos. Subsequent
  scans use a per-channel creation-time cursor and same-timestamp asset IDs.
- Android deliberately reports `unsupported` until the MediaStore + ML Kit
  implementation is added. It never pretends that the manual picker is an
  automatic scanner.
- Manual image upload remains available. Because manual picking does not decode
  a QR payload in the MVP, the operator must paste the decoded destination.

APNs registration only sends a real native device token. Simulators, denied
permission, missing push entitlements, Expo Go, and registration failures are
shown as recoverable states; no synthetic token is stored or uploaded.
