# Product roadmap

## Current milestone: official iOS beta

- Verify the hidden mobile identity and website scan-to-bind cookie flow.
- Validate incremental/cancellable PhotoKit scanning and local Vision QR/OCR on a
  physical iPhone, including WeChat and Xiaohongshu templates.
- Validate automatic create/update, inbox review, undo, stable public pages, and
  APNs reminders against the staging Cloudflare environment.
- Add abuse controls, backup/restore drills, and production observability.

Exit criterion: saving a recognizable QR screenshot and returning to the app
updates the correct stable link without a form; a browser can view it only after
explicit phone approval and loses access immediately when revoked.

## Production release

- Configure the numeric App Apple ID and production AppTransaction verification.
- Complete App Store delivery and subscription entitlement decisions.
- Migrate staging data only when explicitly required; production starts on the new
  account schema.

## Explicitly deferred

- Android MediaStore + ML Kit scanner
- cloud/server-side image analysis
- web image upload or browser OCR
- email/password/social login and workspaces
- community self-deployment support
- enterprise identity, compliance, SLA, or dedicated deployments
