import assert from "node:assert/strict";
import { test } from "node:test";

import { isSandboxCrash, decideLaunchOutcome } from "../scripts/sandbox-degrade.mjs";

// 票 13：打包启动路径必须保留 start.mjs 的 --no-sandbox 降级（本机 Chromium
// 进程沙箱起不来 = 0x80000003，GUI 下还静默）。决策抽成纯函数：start.mjs
// 用它，打包的 Start-Cubicle.ps1 镜像它（e2e-13 现场证明镜像没漂）。

test("0x80000003（STATUS_BREAKPOINT）算沙箱崩溃 —— 有符号/无符号都认", () => {
  assert.equal(isSandboxCrash(-2147483645), true); // 0x80000003 as signed
  assert.equal(isSandboxCrash(2147483651), true); // same bits, unsigned
  assert.equal(isSandboxCrash(-1073741819), true); // 0xc0000005 ACCESS_VIOLATION
  assert.equal(isSandboxCrash(3221225477), true);
});

test("普通失败码不是沙箱崩溃", () => {
  assert.equal(isSandboxCrash(1), false);
  assert.equal(isSandboxCrash(0), false);
  assert.equal(isSandboxCrash(-1), false); // spawn error 的哨兵，不是崩溃签名
});

test("首跑沙箱崩溃且没带显式 flag → 唯一一次 --no-sandbox 重试", () => {
  assert.equal(decideLaunchOutcome({ code: -2147483645, attempt: 0, extraArgs: [] }), "retry-no-sandbox");
});

test("已经重试过 → 不再重试（失败要落地，不循环）", () => {
  assert.equal(decideLaunchOutcome({ code: -2147483645, attempt: 1, extraArgs: [] }), "failed");
});

test("用户显式带过 flag（CUBICLE_ELECTRON_ARGS）→ 不擅自加 --no-sandbox", () => {
  assert.equal(decideLaunchOutcome({ code: -2147483645, attempt: 0, extraArgs: ["--remote-debugging-port=0"] }), "failed");
});

test("非沙箱签名的失败 → 直接失败", () => {
  assert.equal(decideLaunchOutcome({ code: 1, attempt: 0, extraArgs: [] }), "failed");
});

test("code 0 → success", () => {
  assert.equal(decideLaunchOutcome({ code: 0, attempt: 0, extraArgs: [] }), "success");
});
