import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { dataLayout, missingDataEntries } from "../src/shared/data-layout.mjs";
import { openStore } from "../src/host/store.mjs";

// 票 13 验收 3：应用数据目录按预期创建（数据库 / artifacts / engines）。
// data-layout 是这份清单的唯一主人：AgentHost 首启按它建目录，e2e-13 按它
// 断言 —— 清单不可能和验收漂移。

test("数据目录清单 = cubicle.db + artifacts/engines/renders（决策：SQLite + 文件系统）", () => {
  const layout = dataLayout("D:\\app-data");
  assert.equal(layout.dbPath, path.join("D:\\app-data", "cubicle.db"));
  assert.deepEqual(
    layout.folders.map((f) => f.name).sort(),
    ["artifacts", "engines", "renders"],
  );
  assert.equal(layout.folders.find((f) => f.name === "engines")?.dir, path.join("D:\\app-data", "engines"));
});

test("缺一项就报那一项（验收断言用人话，不猜路径）", () => {
  const layout = dataLayout("/tmp/ghost-data");
  const present = new Set([layout.dbPath, path.join("/tmp/ghost-data", "artifacts")]);
  const missing = missingDataEntries(layout, (p) => present.has(p));
  assert.deepEqual(missing, ["engines", "renders"]);
});

test("全齐时 missing 为空", () => {
  const layout = dataLayout("/tmp/full-data");
  assert.deepEqual(missingDataEntries(layout, () => true), []);
});

test("AgentHost 首启（openStore）把清单每一项都建出来", () => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), "cubicle-layout-"));
  try {
    const store = openStore({ dataDir });
    store.close();
    const layout = dataLayout(dataDir);
    assert.deepEqual(missingDataEntries(layout, (p) => existsSync(p)), []);
    assert.equal(store.dbPath, layout.dbPath);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});
