import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeApiOrigin,
  notificationChannelId,
  parseWebBindingQr,
} from "./pure.ts";

test("normalizes the configured official service origin", () => {
  assert.equal(normalizeApiOrigin(" example.workers.dev/path "), "https://example.workers.dev");
});

test("rejects insecure remote deployment addresses", () => {
  assert.throws(() => normalizeApiOrigin("http://example.com"), /HTTPS/);
  assert.equal(normalizeApiOrigin("http://localhost:8787"), "http://localhost:8787");
});

test("only accepts an internal channel UUID from notification data", () => {
  assert.equal(
    notificationChannelId({ channelId: "123e4567-e89b-42d3-a456-426614174000" }),
    "123e4567-e89b-42d3-a456-426614174000",
  );
  assert.equal(notificationChannelId({ channelId: "../../settings" }), null);
});

test("only accepts a strict one-time website binding QR", () => {
  const challenge = "a".repeat(43);
  assert.deepEqual(
    parseWebBindingQr(
      `qrlifecycle://web-bind?id=123e4567-e89b-42d3-a456-426614174000&challenge=${challenge}`,
    ),
    {
      bindingId: "123e4567-e89b-42d3-a456-426614174000",
      challenge,
    },
  );
  assert.equal(parseWebBindingQr("https://example.com/web-bind"), null);
  assert.equal(
    parseWebBindingQr(
      `qrlifecycle://web-bind?id=123e4567-e89b-42d3-a456-426614174000&challenge=${challenge}&redirect=https://evil.example`,
    ),
    null,
  );
});
