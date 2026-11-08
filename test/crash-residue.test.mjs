/**
 * 票 10 — engine capability flags + the crash-residue sweep wiring (main side).
 *
 * Seam A: adapters declare what they can honestly promise. `resumes: true`
 * means "this engine keeps its own conversation and can continue from our
 * recorded pointer". Absent/false ⇒ the UI only ever offers 重跑 — 宁可给重跑.
 *
 * Seam B: crash-residue — the main process records the AgentHost pid in the
 * same ledger mechanism, and at next launch sweeps BOTH ledgers (orphan host,
 * orphan engine children) before the first frame is up. Injected probes/killers;
 * the CIM/taskkill defaults are smoke-tested in child-ledger.test.mjs.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { createPiAdapter } from "../src/host/engine/pi/adapter.mjs";
import { createCodexAdapter } from "../src/host/engine/codex/adapter.mjs";
import { sweepCrashResidue, hostPidFile, recordHostPid } from "../src/main/crash-residue.mjs";
import { createPidLedger } from "../src/host/engine/child-ledger.mjs";

test("引擎能力声明：pi 与 codex 都声明 resumes=true；没声明的引擎按不可恢复办", async () => {
  const pi = createPiAdapter({ dataDir: "C:/unused" });
  const codex = createCodexAdapter({ dataDir: "C:/unused" });
  assert.equal(pi.resumes, true, "pi SDK 的会话文件就是恢复指针（04 票已实证跨重启续话）");
  assert.equal(codex.resumes, true, "codex exec resume <thread_id>（11 票已实证）");
});

test("crash-residue：下次启动把「孤儿宿主」与「引擎孤儿」两本账都扫掉", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), `cubicle-residue-`));
  try {
    const now = new Date().toISOString();
    const hostLedger = createPidLedger({ file: hostPidFile(dataDir) });
    hostLedger.record({ pid: 501, name: "electron", startedAt: now });
    const codexLedger = createPidLedger({ file: path.join(dataDir, "engines", "codex", "children.json") });
    codexLedger.record({ pid: 601, name: "codex", startedAt: now });

    /** @type {number[]} */
    const killed = [];
    const outcome = await sweepCrashResidue({
      dataDir,
      probeProcess: async (/** @type {number} */ pid) => ({
        name: pid === 501 ? "electron.exe" : "codex.exe",
        createdAt: now,
      }),
      killProcess: async (/** @type {number} */ pid) => {
        killed.push(pid);
      },
    });
    assert.deepEqual(killed, [601, 501], "两本账的确认孤儿都被杀（引擎子进程先、宿主后）");
    assert.equal(outcome.host.killed, 1);
    assert.equal(outcome.engines.codex.killed, 1);
    assert.deepEqual(hostLedger.read(), []);
    assert.deepEqual(codexLedger.read(), []);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("crash-residue：宿主 pid 记账每次 spawn 追加（supervisor 重启的每一代宿主都是清扫候选）", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), `cubicle-residue-pid-`));
  try {
    recordHostPid({ dataDir, pid: 111, startedAt: new Date().toISOString() });
    recordHostPid({ dataDir, pid: 222, startedAt: new Date().toISOString() });
    const ledger = createPidLedger({ file: hostPidFile(dataDir) });
    assert.deepEqual(ledger.read().map((e) => e.pid), [111, 222], "追加式记录：活过又死过的每一代宿主都留账，死宿主名下的工具孤儿才有账可扫");
    const expectedName = path.basename(process.execPath).replace(/\.exe$/i, "").toLowerCase();
    assert.ok(
      ledger.read().every((entry) => entry.name === expectedName),
      "宿主映像名来自实际可执行文件（打包后是 cubicle，不是写死的 electron）",
    );

    const outcome = await sweepCrashResidue({
      dataDir,
      probeProcess: async () => null, // 上代宿主都死了：不杀本体，只清账
      listChildren: async () => [],
      killProcess: async () => {
        throw new Error("must not kill");
      },
    });
    assert.equal(outcome.host.killed, 0);
    assert.equal(outcome.host.stale, 2);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});
