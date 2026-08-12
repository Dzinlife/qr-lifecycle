# Contributing

The project uses a pnpm workspace and Node.js 22 or newer.

```bash
pnpm install
pnpm check
pnpm test
pnpm build
```

Keep changes within one application boundary when possible. Changes to
`packages/contracts` are API changes and should update `docs/api.md` plus all
affected clients.

Cloudflare configuration uses `wrangler.jsonc`. Never commit `.dev.vars`,
deployment tokens, device tokens, Apple identity JWS values, binding secrets, or
the official service's APNs credentials.

The generated `ios/` and `android/` projects are intentionally ignored. Native
mobile behavior belongs in Expo modules under `apps/mobile/modules` so it can
be reproduced by prebuild.

Run `pnpm --filter @qr-lifecycle/mobile native:generate` only when an Xcode or
Android Studio native project is needed. It is deliberately not named
`prebuild`, because package managers reserve that name as a lifecycle hook.
