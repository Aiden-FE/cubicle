/**
 * 应用数据目录的清单 (ticket 13: 数据库 / artifacts / engines 按预期创建).
 *
 * AGENTS.md 存储约定 = SQLite(WAL) + 文件系统（artifacts / engines / renders）。
 * 这份清单原本散在 openStore 的 for 循环里；票 13 把验收（"数据目录按预期
 * 创建"）也压到同一个契约上：AgentHost 首启按它建，打包 e2e 按它断言。
 * 清单只有一个主人，验收和产品不可能漂移。
 */
import path from "node:path";

/**
 * @typedef {{ name: string, dir: string }} DataFolder
 * @typedef {{ root: string, dbPath: string, folders: DataFolder[] }} DataLayout
 *
 * @param {string} dataDir 应用数据根（userData / CUBICLE_DATA_DIR）
 * @returns {DataLayout}
 */
export function dataLayout(dataDir) {
  return {
    root: dataDir,
    dbPath: path.join(dataDir, "cubicle.db"),
    folders: [
      { name: "artifacts", dir: path.join(dataDir, "artifacts") },
      { name: "engines", dir: path.join(dataDir, "engines") },
      { name: "renders", dir: path.join(dataDir, "renders") },
    ],
  };
}

/**
 * 缺哪些条目就报哪些名字（验收证据用人话，不猜路径）。
 *
 * @param {DataLayout} layout
 * @param {(p: string) => boolean} existsSync
 * @returns {string[]} 缺失条目名：db 报 "cubicle.db"，目录报目录名
 */
export function missingDataEntries(layout, existsSync) {
  const missing = [];
  if (!existsSync(layout.dbPath)) missing.push("cubicle.db");
  for (const folder of layout.folders) {
    if (!existsSync(folder.dir)) missing.push(folder.name);
  }
  return missing;
}
