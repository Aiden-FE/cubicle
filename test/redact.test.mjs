import assert from "node:assert/strict";
import { test } from "node:test";

import { redactSecrets } from "../src/shared/redact.mjs";
import { explainRunFailure } from "../src/host/engine/failure.mjs";

test("provider keys and bearer tokens are redacted before they reach DB/UI/logs", () => {
  assert.equal(redactSecrets("key=sk-proj-abcdefghijklmnopqrstuvwxyz012345"), "key=[redacted]");
  assert.equal(redactSecrets("Authorization: Bearer abcdefghijklmnopqrstuvwxyz"), "Authorization: [redacted]");
  assert.equal(redactSecrets("CUBICLE_CODEX_KEY=sk-test-1234567890abcdef"), "[redacted]");
  assert.equal(redactSecrets("echo hello"), "echo hello");
});

test("a failure sentence that quotes a key is redacted too", () => {
  const sentence = explainRunFailure({
    status: "failed",
    events: [{ type: "error", code: "provider_error", message: "bad key sk-abcdefghijklmnopqrstuvwxyz" }],
  });
  assert.ok(sentence);
  assert.doesNotMatch(sentence, /sk-abcdefghijklmnopqrstuvwxyz/);
  assert.match(sentence, /\[redacted\]/);
});
