import assert from "node:assert/strict";
import test from "node:test";

import {
  isValidPairingCode,
  normalizeApiOrigin,
  normalizePairingCode,
  notificationChannelId,
  parsePairPayload,
} from "./pure.ts";

test("normalizes a deployment host and pairing code", () => {
  assert.equal(normalizeApiOrigin(" example.workers.dev/path "), "https://example.workers.dev");
  assert.equal(normalizePairingCode(" ab 12-cd "), "AB12-CD");
  assert.equal(isValidPairingCode(" 23456 ABCDE "), true);
  assert.equal(isValidPairingCode("a recovery code that is much too long"), false);
});

test("rejects insecure remote deployment addresses", () => {
  assert.throws(() => normalizeApiOrigin("http://example.com"), /HTTPS/);
  assert.equal(normalizeApiOrigin("http://localhost:8787"), "http://localhost:8787");
});

test("parses the fixed pairing response", () => {
  assert.deepEqual(
    parsePairPayload({
      sessionToken: "secret",
      deployment: {
        mode: "self_hosted",
        apiOrigin: "https://example.workers.dev",
        productName: "群码续期",
        registrationEnabled: false,
      },
    }),
    {
      sessionToken: "secret",
      deployment: {
        mode: "self_hosted",
        apiOrigin: "https://example.workers.dev",
        productName: "群码续期",
        registrationEnabled: false,
      },
    },
  );
});

test("only accepts an internal channel UUID from notification data", () => {
  assert.equal(
    notificationChannelId({ channelId: "123e4567-e89b-42d3-a456-426614174000" }),
    "123e4567-e89b-42d3-a456-426614174000",
  );
  assert.equal(notificationChannelId({ channelId: "../../settings" }), null);
});
