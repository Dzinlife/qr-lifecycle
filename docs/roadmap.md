# MVP roadmap

## Milestone 1: local vertical slice

- Bootstrap a self-hosted owner.
- Create and edit WeChat, Xiaohongshu, Discord, and generic channels.
- Upload a QR image from the web.
- Serve the current image through a stable public URL.
- Pair the mobile app to a deployment.
- Discover a saved QR image on iOS and activate it.
- Run a reminder scan with an APNs test transport.

Exit criterion: one local test creates a channel, activates two versions, and
confirms that the public route switches to the second R2 object.

## Milestone 2: real devices and Cloudflare

- Create D1 and R2 resources in staging.
- Deploy the API and web application.
- Register the official App ID and APNs topic-specific production key.
- Validate pairing, photo-library limited access, Vision decoding, upload, APNs
  delivery, deep link, and credential rotation on a physical iPhone.

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
- automatic platform-specific expiry inference
- browser extensions and chat-platform bots
- enterprise identity, compliance, SLA, or dedicated deployments
