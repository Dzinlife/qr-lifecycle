# Fallinlife QR Lifecycle

An open-source, mobile-first lifecycle manager for expiring community QR codes,
including WeChat, Xiaohongshu, and Discord invites.

The supported product is one official hosted service. There is no registration,
email login, workspace selector, enterprise edition, or supported community
deployment. The source remains MIT licensed, while the product experience stays
focused on a phone app and the official website.

## Product flow

1. Save a community QR image on the phone.
2. Fallinlife detects the QR, name, platform, and expiration locally with
   PhotoKit and Vision. Images are never sent to a cloud image-analysis model.
3. Confident results create or update a channel automatically; uncertain results
   enter a one-tap inbox.
4. Every channel has both a permanent relay QR (`/q/:slug/relay.png`) that
   encodes the stable `/q/:slug` page, and a stable `/q/:slug/image` address
   that directly serves the latest accepted native QR image for website embeds.
5. To view channels on the website, scan its one-time QR with the app and confirm.
   The browser receives an HttpOnly cookie and can be revoked from the phone.

## Repository

- `apps/api`: official Cloudflare Worker, D1, R2, Cron, APNs, and static assets.
- `apps/web`: scan-to-bind channel status and auxiliary metadata correction.
- `apps/mobile`: Expo/React Native UI plus native iOS PhotoKit/Vision analysis.
- `packages/contracts`: shared validation schemas and API types.
- `docs`: architecture, protocol, and release decisions.

## Development

Requirements: Node.js 22+, pnpm 10.28.1, and Xcode for iOS builds.

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm build
```

Run local services in separate terminals:

```sh
pnpm dev:api
pnpm dev:web
pnpm dev:mobile
```

Expo Go is unsupported because the app uses local native QR/OCR and StoreKit
identity modules. See `apps/mobile/README.md` for native development details.

The staging service is <https://qr-lifecycle-staging.fallinlife.com>. Staging
accepts a development-installation identity for Ad Hoc testing. Production must
verify Apple `AppTransaction` and must never enable that fallback.
