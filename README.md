# QR Lifecycle

Working name for an open-source QR-code lifecycle manager for expiring group
invites, including WeChat and Xiaohongshu group QR codes.

The product has two distributions with feature parity:

- Self-hosted: deploy the Cloudflare backend and use the official mobile app.
- Managed: subscribe in the mobile app and use the hosted service.

The paid plan sells hosting and maintenance, not locked product features.

## Repository

- `apps/api`: Cloudflare Worker API, scheduled reminders, D1 and R2.
- `apps/web`: tenant-aware status, correction, pairing, and operations UI.
- `apps/mobile`: automation-first Expo/React Native app with native photo-library
  QR and OCR scanning.
- `packages/contracts`: shared schemas and API types.
- `docs`: architecture and protocol decisions.

## Status

The mobile-first V2 vertical slice is implemented:

- Cloudflare Worker API with tenant-isolated D1 state, R2 images, Cron reminders,
  and direct APNs provider requests.
- Responsive React status UI, self-host bootstrap/recovery, auxiliary channel
  correction, QR history, pairing, and stable public QR pages. The web app does
  not scan or upload group-code images.
- Expo SDK 57 mobile app with local iOS PhotoKit + Vision QR/OCR discovery,
  confidence-based channel creation and matching, an exception inbox, APNs
  registration, deep links, and reversible automatic activation.
- Android-compatible application boundaries; the MediaStore + ML Kit scanner is
  explicitly deferred rather than silently falling back.

The staging Worker and web app are live at
<https://qr-lifecycle-staging.fallinlife.com>. It is intentionally separate
from production. Physical-iPhone signing and App Store delivery are the next
milestone.

## Development

Requirements: Node.js 22+, pnpm 10.28.1, and Xcode for the iOS development
client.

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm build
```

Run the local API, web UI, and mobile Metro server in separate terminals:

```sh
pnpm dev:api
pnpm dev:web
pnpm dev:mobile
```

Expo Go is not supported because QR/OCR discovery uses a local native module. See
`apps/mobile/README.md` for development-build instructions.

## Self-hosting on Cloudflare

1. Create a D1 database and R2 bucket.
2. Copy their names and the D1 database ID into an environment in
   `apps/api/wrangler.jsonc`.
3. Build the web assets, apply migrations, and deploy the Worker:

```sh
pnpm --filter @qr-lifecycle/web build
pnpm --filter @qr-lifecycle/api exec wrangler d1 migrations apply <database> --remote
pnpm --filter @qr-lifecycle/api exec wrangler deploy
```

4. Open the deployed URL, create the first owner, and save the one-time recovery
   code in a password manager.
5. Configure `APNS_KEY_ID`, `APNS_TEAM_ID`, and `APNS_TOPIC`, then store the
   private key with `wrangler secret put APNS_PRIVATE_KEY`. Never commit it.

See `docs/architecture.md`, `docs/api.md`, and `SECURITY.md` before exposing a
deployment publicly.
