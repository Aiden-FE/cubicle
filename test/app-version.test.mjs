import assert from "node:assert/strict";
import { test } from "node:test";

import { readPackageVersion, resolveAboutVersion } from "../src/main/app-version.mjs";

// 票 13 验收 5：关于页显示版本号，且打包 metadata 与 package.json 一致。
// seam 钉两件事：从 package.json 文本里诚实取版本（坏 JSON 不装懂）；
// app.getVersion()（打包后 = exe metadata）与 package.json 版本对表，
// 漂移要能说出来 —— 关于页显示哪个、漂移与否，都是显式决定。

test("package.json 文本 → 版本字符串", () => {
  assert.equal(readPackageVersion('{"name":"cubicle","version":"0.1.0"}'), "0.1.0");
});

test("坏 JSON / 没有 version 字段 / version 不是字符串 → null（诚实）", () => {
  assert.equal(readPackageVersion("{not json"), null);
  assert.equal(readPackageVersion('{"name":"cubicle"}'), null);
  assert.equal(readPackageVersion('{"version":42}'), null);
});

test("app.getVersion() 与 package.json 一致 → 用它，无漂移", () => {
  assert.deepEqual(resolveAboutVersion({ appVersion: "0.1.0", packageVersion: "0.1.0" }), {
    version: "0.1.0",
    versionSource: "app",
    mismatch: false,
  });
});

test("打包 metadata 与 package.json 漂移 → 显示 app 版本但 mismatch=true", () => {
  const r = resolveAboutVersion({ appVersion: "0.2.0", packageVersion: "0.1.0" });
  assert.equal(r.version, "0.2.0");
  assert.equal(r.mismatch, true);
});

test("读不到 package.json（null）→ 不算漂移（未知 ≠ 不一致）", () => {
  const r = resolveAboutVersion({ appVersion: "0.1.0", packageVersion: null });
  assert.equal(r.version, "0.1.0");
  assert.equal(r.mismatch, false);
});

test("app.getVersion() 缺失（不该发生）→ 退回 package.json，再退 0.0.0-dev", () => {
  assert.equal(resolveAboutVersion({ appVersion: "", packageVersion: "0.1.0" }).version, "0.1.0");
  assert.equal(resolveAboutVersion({ appVersion: "", packageVersion: null }).version, "0.0.0-dev");
});
