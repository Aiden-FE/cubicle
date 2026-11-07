/**
 * 票 10 — CLI-host crash hygiene: who the children are, and who sweeps them.
 *
 * Seam 1 (ledger): a small JSON ledger of spawned engine children, written
 * where the next host launch can find it even after a hard kill (no process
 * hook runs on taskkill /F — the file IS the memory).
 * Seam 2 (sweep): the next launch reads the ledger, confirms identity with a
 * probe (dead pid / recycled pid must never be killed blindly), kills only
 * confirmed orphans, then clears the ledger. The probe/killer are injected —
 * plus ONE real smoke cycle on Windows proving the default CIM probe and the
 * taskkill killer actually work together on a live victim.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";

import { createPidLedger, sweepPidLedger } from "../src/host/engine/child-ledger.mjs";

/**
 * @param {string} name
 */
async function withTempDir(name) {
  const dir = await mkdtemp(path.join(tmpdir(), `cubicle-ledger-${name}-`));
  return { dir, dispose: () => rm(dir, { recursive: true, force: true }) };
}

/** @param {string} dir */
const LEDGER_FILE = (dir) => path.join(dir, "engines", "codex", "children.json");

test("账本记录/遗忘/读取：落盘位置就是下次启动会看的位置；损坏文件读成空不炸", async () => {
  const { dir, dispose } = await withTempDir("record");
  try {
    const ledger = createPidLedger({ file: LEDGER_FILE(dir) });
    assert.deepEqual(ledger.read(), []);

    ledger.record({ pid: 111, name: "codex", startedAt: "2026-11-07T10:00:00.000Z" });
    ledger.record({ pid: 222, name: "codex", startedAt: "2026-11-07T10:05:00.000Z" });
    const onDisk = /** @type {{ pid: number }[]} */ (JSON.parse(await readFile(LEDGER_FILE(dir), "utf8")));
    assert.deepEqual(onDisk.map((e) => e.pid), [111, 222]);

    ledger.forget(111);
    assert.deepEqual(ledger.read().map((e) => e.pid), [222]);

    // same pid recorded twice = one row (a respawn reusing its pid stays honest)
    ledger.record({ pid: 222, name: "codex", startedAt: "2026-11-07T10:09:00.000Z" });
    assert.deepEqual(ledger.read().map((e) => e.pid), [222]);

    await mkdir(path.dirname(LEDGER_FILE(dir)), { recursive: true });
    await writeFile(LEDGER_FILE(dir), "{not json", "utf8");
    assert.deepEqual(ledger.read(), [], "损坏的账本读成空，绝不掀翻宿主启动");
  } finally {
    await dispose();
  }
});

test("清扫：活着的账本成员被杀、死掉的清账、pid 被复用的绝不盲杀；扫完账本清零", async () => {
  const { dir, dispose } = await withTempDir("sweep");
  try {
    const file = LEDGER_FILE(dir);
    const ledger = createPidLedger({ file });
    ledger.record({ pid: 1001, name: "codex", startedAt: "2026-11-07T10:00:00.000Z" }); // 活着、名字对得上 → 杀
    ledger.record({ pid: 1002, name: "codex", startedAt: "2026-11-07T10:01:00.000Z" }); // 进程已死 → 只清账
    ledger.record({ pid: 1003, name: "codex", startedAt: "2026-11-07T10:02:00.000Z" }); // pid 被别的程序复用 → 不杀但清账
    ledger.record({ pid: 1004, name: "codex", startedAt: "2026-11-07T10:03:00.000Z" }); // 同名但出生时间差一小时 → 不是它，不杀

    /** @type {number[]} */
    const killed = [];
    const probes = new Map([
      [1001, { name: "codex.exe", createdAt: "2026-11-07T10:00:01.000Z" }],
      [1002, null],
      [1003, { name: "chrome.exe", createdAt: "2026-11-07T10:02:00.000Z" }],
      [1004, { name: "codex.exe", createdAt: "2026-11-07T11:03:00.000Z" }],
    ]);
    const outcome = await sweepPidLedger({
      file,
      probeProcess: async (pid) => probes.get(pid) ?? null,
      killProcess: async (pid) => {
        killed.push(pid);
      },
    });

    assert.deepEqual(killed, [1001], "只有「同名 + 出生时间对得上」的确认孤儿会被杀");
    assert.equal(outcome.checked, 4);
    assert.equal(outcome.killed, 1);
    assert.equal(outcome.stale, 3);
    assert.deepEqual(ledger.read(), [], "扫完必须清账 —— 账本只描述一次崩溃现场");
  } finally {
    await dispose();
  }
});

test("清扫可容忍：账本文件不存在 = 无事发生；单个 kill 失败不阻断其余", async () => {
  const { dir, dispose } = await withTempDir("tolerant");
  try {
    const quiet = await sweepPidLedger({
      file: LEDGER_FILE(dir),
      probeProcess: async () => null,
      killProcess: async () => {},
    });
    assert.deepEqual(quiet, { checked: 0, killed: 0, orphanChildren: 0, stale: 0 });

    const file = LEDGER_FILE(dir);
    const ledger = createPidLedger({ file });
    ledger.record({ pid: 2001, name: "codex", startedAt: "2026-11-07T10:00:00.000Z" });
    ledger.record({ pid: 2002, name: "codex", startedAt: "2026-11-07T10:00:01.000Z" });
    /** @type {number[]} */
    const killed = [];
    const outcome = await sweepPidLedger({
      file,
      probeProcess: async () => ({ name: "codex.exe", createdAt: "2026-11-07T10:00:00.500Z" }),
      killProcess: async (pid) => {
        if (pid === 2001) throw new Error("taskkill refused");
        killed.push(pid);
      },
    });
    assert.deepEqual(killed, [2002], "一个杀不掉，其他的照杀（尽力而为，绝不半途而废）");
    assert.equal(outcome.killed, 1);
    assert.deepEqual(ledger.read(), [], "失败的 kill 也不留账（宿主下次启动面对的是同一个未知进程，不背这个账）");
  } finally {
    await dispose();
  }
});

test("清扫：账本条目已死时，它名下还活着的孤儿孩子也要杀掉（无主进程不靠自然老死）", async () => {
  const { dir, dispose } = await withTempDir("dead-parent-children");
  try {
    const file = LEDGER_FILE(dir);
    const ledger = createPidLedger({ file });
    ledger.record({ pid: 3001, name: "codex", startedAt: "2026-11-07T10:00:00.000Z" }); // 已死
    ledger.record({ pid: 3002, name: "codex", startedAt: "2026-11-07T10:00:01.000Z" }); // pid 被复用：它的孩子不碰！

    /** @type {number[]} */
    const killed = [];
    const outcome = await sweepPidLedger({
      file,
      probeProcess: async (pid) => {
        if (pid === 3001) return null; // 死了
        return { name: "chrome.exe", createdAt: "2026-11-07T10:00:01.000Z" }; // 3002 被别的程序复用
      },
      listChildren: async (pid) => (pid === 3001 ? [{ pid: 3101, name: "powershell.exe" }] : [{ pid: 3201, name: "notepad.exe" }]),
      killProcess: async (pid) => {
        killed.push(pid);
      },
    });
    assert.deepEqual(killed, [3101], "死账本条目名下的真孤儿被杀；pid 被复用条目的孩子不动（那是别人的进程）");
    assert.equal(outcome.orphanChildren, 1);
    assert.deepEqual(ledger.read(), []);
  } finally {
    await dispose();
  }
});

test("真机 smoke：默认 CIM 探针 + taskkill 杀掉一个真孤儿进程", async () => {
  if (process.platform !== "win32") {
    return; // 账本机制跨平台，默认探针/杀手是 Windows 实现（taskkill/CIM）
  }
  const { dir, dispose } = await withTempDir("smoke");
  try {
    // 真受害者：一个会活 30 秒的 cmd.exe（ping 等待），账本按 CLI 宿主的记录方式写。
    const victim = spawn("cmd.exe", ["/c", "ping -n 30 127.0.0.1 > NUL"], { windowsHide: true, stdio: "ignore" });
    if (!victim.pid) throw new Error("smoke victim did not spawn");
    const victimPid = victim.pid;
    const startedAt = new Date().toISOString();
    const file = LEDGER_FILE(dir);
    const ledger = createPidLedger({ file });
    ledger.record({ pid: victimPid, name: "cmd", startedAt });
    try {
      const { defaultListChildProcesses } = await import("../src/host/engine/child-ledger.mjs");
      const kidsBefore = await defaultListChildProcesses(victimPid);
      assert.ok(kidsBefore.length >= 1, "cmd /c ping 名下应有 ping.exe 孩子（CIM 默认可见）");
      const outcome = await sweepPidLedger({ file });
      assert.equal(outcome.checked, 1);
      assert.equal(outcome.killed, 1, "CIM 确认同名同生 → taskkill /T /F 落刀");
      assert.deepEqual(ledger.read(), []);
      const kidsAfter = await defaultListChildProcesses(victimPid);
      assert.equal(kidsAfter.length, 0, "/T 连孩子一起清（无主孙进程不留）");
      // 杀干净了吗？再探一次：进程应当已经不在。
      const { defaultProbeProcess } = await import("../src/host/engine/child-ledger.mjs");
      const after = await defaultProbeProcess(victimPid);
      assert.equal(after, null, "清扫后现场无孤儿（CIM 亲眼看）");
    } finally {
      try {
        victim.kill();
      } catch {
        // already dead — that is the point
      }
    }
  } finally {
    await dispose();
  }
});

test("身份守卫导出：同名但出生时间对不上（pid 复用）不算它；出生时间缺失时按名字放行但记 note", async () => {
  // 守卫是纯函数 —— 直接钉它的判定表，不借清扫的壳。
  const { identityMatches } = await import("../src/host/engine/child-ledger.mjs");
  assert.equal(identityMatches({ pid: 1, name: "codex", startedAt: "2026-11-07T10:00:00.000Z" }, { name: "codex.exe", createdAt: "2026-11-07T10:00:02.000Z" }), true);
  assert.equal(identityMatches({ pid: 1, name: "codex", startedAt: "2026-11-07T10:00:00.000Z" }, { name: "Codex.EXE", createdAt: "2026-11-07T10:00:02.000Z" }), true, "大小写不敏感");
  assert.equal(identityMatches({ pid: 1, name: "codex.exe", startedAt: "2026-11-07T10:00:00.000Z" }, { name: "codex.exe", createdAt: "2026-11-07T10:00:02.000Z" }), true, "账本记全名也认");
  assert.equal(identityMatches({ pid: 1, name: "codex", startedAt: "2026-11-07T10:00:00.000Z" }, { name: "node.exe", createdAt: "2026-11-07T10:00:02.000Z" }), false);
  assert.equal(identityMatches({ pid: 1, name: "codex", startedAt: "2026-11-07T10:00:00.000Z" }, { name: "codex.exe", createdAt: "2026-11-07T12:00:00.000Z" }), false, "同名但出生差 2 小时 = pid 复用，不是它");
  assert.equal(identityMatches({ pid: 1, name: "codex", startedAt: "2026-11-07T10:00:00.000Z" }, { name: "codex.exe", createdAt: null }), true, "探针给不出出生时间时按名字放行（保守只影响多杀与否的窗口，日志会带 note）");
  assert.equal(identityMatches({ pid: 1, name: "codex", startedAt: "2026-11-07T10:00:00.000Z" }, null), false);
});
