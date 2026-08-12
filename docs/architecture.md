# Architecture

## Product boundary

Fallinlife is one official, hosted, mobile-first product for individual community
operators. It has no registration, workspaces, enterprise edition, supported
self-deployment flow, or cloud image-analysis service.

```text
iOS app
  ├─ Apple AppTransaction identity
  ├─ PhotoKit incremental discovery
  ├─ Vision QR + OCR, deterministic adapters
  ├─ review inbox and APNs
  └─ website QR approval
             │ HTTPS bearer session
             ▼
Cloudflare Worker (one origin)
  ├─ REST API + React static assets + /q/:slug
  ├─ D1 private account state
  ├─ R2 accepted QR images
  ├─ Cron reminder scan
  └─ APNs provider
             ▲
             │ HttpOnly cookie after phone approval
             │
Official website
```

The Worker is the only server security boundary. Web and mobile clients never
read D1 or R2 directly.

## Hidden account model

The phone is the root identity. In production, the app sends Apple's signed
`AppTransaction` JWS; the Worker verifies signature, Bundle ID, environment, and
App Apple ID, then hashes `appTransactionID` into an internal `account_id`.
Staging may explicitly allow a stable installation identifier for Ad Hoc builds.

Core entities are `accounts`, `account_identities`, `devices`, `sessions`,
`web_bindings`, `channels`, `qr_versions`, `detections`, `channel_aliases`, and
`reminder_deliveries`. Every private record is scoped by `account_id`.

## Website binding

1. An unauthenticated browser requests a two-minute binding record.
2. The Worker returns a browser secret separately from a QR value containing the
   binding ID and random challenge. The secret stays in memory and never enters
   the QR or URL.
3. The app strictly parses the `qrlifecycle://web-bind` value, shows a confirmation,
   and approves it with a mobile bearer session.
4. The browser polls with its secret, consumes the approved record exactly once,
   and receives an HttpOnly cookie.
5. The phone can list and revoke browser sessions. Web mutations additionally
   require exact same-origin requests.

## Automatic discovery

The iOS adapter scans new Photos assets, runs barcode detection first, and performs
accurate Simplified Chinese/English OCR only for QR-bearing images. TypeScript
platform adapters infer platform, group name, explicit or relative expiration,
and confidence. A durable device outbox is written before the PhotoKit cursor
advances, so network retries do not repeat OCR.

The Worker treats all metadata as untrusted, rechecks account-local matching,
stores only accepted/pending candidate images, and records reversible decisions.
High-confidence discoveries create or update automatically; ambiguous results
remain in the mobile inbox. A future Android adapter can use MediaStore and ML Kit
without changing API contracts.

## Web and notification boundaries

The website can view status/history, copy stable links, and correct metadata. It
cannot upload images or create channels. Cloudflare Cron scans due expirations,
inserts an idempotency record, and sends through the official topic-specific APNs
credential stored as a Worker secret.
