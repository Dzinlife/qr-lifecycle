# Mobile automation roadmap

## Milestone 1: automation-first iOS slice

- Bootstrap a self-hosted owner.
- Scan recent and incremental Photos assets for QR and OCR entirely on device.
- Infer WeChat, Xiaohongshu, Discord, group name, and expiration with confidence.
- Automatically create or match channels without selecting one first.
- Send ambiguous discoveries to a one-tap mobile inbox.
- Serve the current image through a stable public URL.
- Pair the mobile app to a deployment.
- Preserve history and undo automatic creation or replacement.
- Run a reminder scan with an APNs test transport.

Exit criterion: saving a recognizable screenshot and returning to the app creates
or updates the correct channel without opening a form, while an ambiguous image
requires at most one confirmation.

## Milestone 2: real devices and Cloudflare

- Create D1 and R2 resources in staging.
- Deploy the API and web application.
- Register the official App ID and APNs topic-specific production key.
- Validate pairing, photo-library limited access, local Vision QR/OCR, automatic
  commit, undo, APNs delivery, deep link, and credential rotation on a physical
  iPhone.

Exit criterion: replacing a Xiaohongshu or WeChat group QR from Photos updates
the stable public page in under one minute.

## Milestone 3: managed subscription

- Add production email sign-in and tenant provisioning.
- Add StoreKit subscription state and App Store server notifications.
- Gate managed hosting availability, not product features.
- Add backup, observability, abuse limits, and operational dashboards.

Exit criterion: a new subscriber can sign in and use the service without any
Cloudflare or Apple setup.

## Explicitly deferred

- Android photo scanning implementation
- cloud or server-side image analysis
- web image upload and browser OCR
- browser extensions and chat-platform bots
- enterprise identity, compliance, SLA, or dedicated deployments
