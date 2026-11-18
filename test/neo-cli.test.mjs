/**
 * 票 a04 — the vendored materialize call must keep passing the host-contract
 * flags (vendor/README.md, pin 894e5bf): `--no-auth` (no credential copies in
 * any employee root) and `--agent-models` (Cubicle's model library stays the
 * ONLY model source). A stub CLI records its argv, so this stays hermetic —
 * no Neo home, no fixtures.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { runMaterialize } from "../src/host/academy/neo-cli.mjs";

test("runMaterialize passes --no-auth --agent-models --json and keeps the manifest's host fields", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "cubicle-neocli-"));
  try {
    const argvFile = path.join(dir, "argv.json");
    const stub = path.join(dir, "stub-cli.mjs");
    writeFileSync(
      stub,
      [
        "import { writeFileSync } from 'node:fs';",
        `writeFileSync(${JSON.stringify(argvFile)}, JSON.stringify(process.argv.slice(2)));`,
        "console.log(JSON.stringify({ ok: true, role: 'r', agent: 'pi', outDir: 'o', skills: [],",
        "  mcp: { file: null, servers: 0, envRefs: {} },",
        "  model: { file: null, providers: 0, default: null, owner: 'host', reason: 'agent-models: host supplies its own model config' },",
        "  authExcluded: true, hash: 'deadbeef' }));",
      ].join("\n"),
      "utf8",
    );
    const manifest = await runMaterialize({
      nodeBinary: process.execPath,
      cliEntry: stub,
      role: "r",
      agent: "pi",
      out: "o",
    });
    const argv = JSON.parse(readFileSync(argvFile, "utf8"));
    assert.deepEqual(argv, ["materialize", "--role", "r", "--agent", "pi", "--out", "o", "--no-auth", "--agent-models", "--json"]);
    assert.equal(manifest.authExcluded, true, "导出面声明：无凭据副本");
    assert.equal(manifest.model.owner, "host", "模型归属：宿主（Cubicle 模型库）");
    assert.deepEqual(manifest.mcp.envRefs, {});
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
