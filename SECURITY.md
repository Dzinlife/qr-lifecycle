# Security policy

## Reporting

Report vulnerabilities privately to the repository owner. Include a minimal
reproduction and do not access another person's data.

## Identity and sessions

- Production mobile identity is a server-verified Apple `AppTransaction` JWS.
  Its stable `appTransactionID` is hashed before storage.
- The development-installation fallback is staging-only and must be disabled in
  production.
- Mobile sessions use hashed bearer tokens. Web sessions are only accepted from
  HttpOnly, Secure, SameSite=Lax cookies.
- Unsafe web requests require an exact same-origin `Origin` header.
- Website binding uses separate random browser-secret and QR-challenge values,
  expires after two minutes, is one-time, and requires explicit phone approval.
- A phone can enumerate and revoke every browser session belonging to its hidden
  account.

## Data controls

- Every private query is scoped by `account_id`; the account is an internal
  isolation boundary, not a user-facing workspace.
- APNs device tokens, session tokens, binding secrets/challenges, QR payloads,
  private images, and Apple signed identity data must never be logged or committed.
- Only locally recognized candidate images are uploaded. The server performs no
  cloud image recognition and never fetches client-provided image URLs.
- Upload MIME type and size are validated before R2 activation. QR versions and
  reminder deliveries are idempotent.
- The official service owns the topic-specific APNs key as a Worker secret.
