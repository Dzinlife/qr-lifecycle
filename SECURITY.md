# Security policy

## Intentional APNs trust model

Self-hosted releases are designed to support the official iOS app using a
production-only, topic-specific APNs credential, following Bark's distribution
model. That credential is not considered confidential. Its scope must be
limited to this app's notification topic and it must be replaceable by release
configuration.

The following values are always confidential and must never be committed,
logged, or included in public URLs:

- APNs device tokens
- device routing keys
- web and mobile session tokens
- pairing codes before use or expiry
- managed deployment credentials
- user-uploaded QR payloads and images unless exposed through their chosen
  public live-code page

Possession of the public APNs signing credential must not grant access to any
of those values.

## Reporting

Please report vulnerabilities privately to the repository owner. Include a
minimal reproduction and avoid accessing data belonging to another user.

## Baseline controls

- Hash bearer tokens and pairing codes before D1 storage.
- Scope every tenant-owned query by `tenant_id`.
- Generate security-sensitive IDs with Web Crypto.
- Enforce upload type and size before writing to R2.
- Keep device tokens out of response bodies after registration.
- Use idempotency records for reminders and QR activation.
- Rotate the public APNs credential through versioned release configuration.
