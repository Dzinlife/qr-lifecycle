# Mobile app

Expo SDK 57 development-build app for the official Fallinlife service. Expo Go is
unsupported because local PhotoKit/Vision recognition and StoreKit identity use
native modules.

## Local development

```sh
pnpm --filter @qr-lifecycle/mobile native:generate
pnpm --filter @qr-lifecycle/mobile ios
```

Generated `ios/` and `android/` directories are ignored. Native module changes
require rebuilding the development client. Bundle ID and APNs topic are
`com.fallinlife.qrlifecycle`.

## Identity and website access

Production calls `AppTransaction.shared` and sends only Apple's signed JWS for
server verification. Ad Hoc builds do not reliably have an App Store transaction,
so staging explicitly accepts the device's stable installation identity; production
must refuse it.

The app scans the official website's `qrlifecycle://web-bind` QR with Expo Camera,
shows an explicit confirmation, and can enumerate/revoke authorized browsers.

## Photo scanning

- A fast barcode pass runs on new PhotoKit assets; accurate Chinese/English OCR
  runs only for QR hits.
- Deterministic adapters infer platform, name, explicit/relative expiration, and
  confidence without a cloud model.
- Foreground scans are incremental, report progress, and can be cancelled.
- Candidate images enter a persistent outbox before the cursor advances, so network
  retries never require re-running OCR.
- Confident results create/update automatically; ambiguous results enter the mobile
  inbox for one-tap confirmation.
- Android deliberately reports unsupported until MediaStore + ML Kit is implemented.

Only QR-bearing candidate images and structured local metadata reach the official
service. APNs registration only sends a real native device token.
