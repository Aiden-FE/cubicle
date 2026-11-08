import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const preload = readFileSync(new URL("../src/preload/index.cjs", import.meta.url), "utf8");
const main = readFileSync(new URL("../src/main/index.mjs", import.meta.url), "utf8");

test("main and preload agree on every IPC channel name", () => {
  for (const channel of ["cubicle:invoke", "cubicle:reply", "cubicle:events", "cubicle:app-info", "cubicle:open-workspace", "cubicle:open-engine-dir"]) {
    assert.ok(main.includes(`"${channel}"`), `main missing channel ${channel}`);
    assert.ok(preload.includes(`"${channel}"`), `preload missing channel ${channel}`);
  }
});

test("CSP is shipped in the renderer document", () => {
  const html = readFileSync(new URL("../renderer/index.html", import.meta.url), "utf8");
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /script-src 'self'/);
  assert.match(html, /default-src 'none'/);
});
