/**
 * AgentHost persistence: the application's single SQLite writer.
 *
 * One database file (`cubicle.db`, WAL) plus the artifact folders live inside
 * the data directory handed in by the main process — never the user's home.
 * Opening a store applies the schema and, on first run, seeds the default
 * company with one project group and four empty desks so the office always
 * has something to show.
 */
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

/**
 * @typedef {object} CompanyRow
 * @property {number} id
 * @property {string} name
 * @property {string} createdAt
 *
 * @typedef {object} GroupRow
 * @property {number} id
 * @property {number} companyId
 * @property {string} name
 * @property {string} createdAt
 *
 * @typedef {object} DeskRow
 * @property {number} id
 * @property {number} groupId
 * @property {string} label
 * @property {number} x
 * @property {number} y
 * @property {null} occupant
 *
 * @typedef {object} OfficeSnapshot
 * @property {CompanyRow[]} companies
 * @property {number} activeCompanyId
 * @property {GroupRow[]} groups
 * @property {number | null} activeGroupId
 * @property {DeskRow[]} desks
 */

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS company (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS project_group (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES company(id),
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS desk (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL REFERENCES project_group(id),
  label TEXT NOT NULL,
  x REAL NOT NULL,
  y REAL NOT NULL,
  employee_id INTEGER
);
`;

/** Layout slots for the four desks every project group owns. */
const DESK_SLOTS = [
  { x: 140, y: 140 },
  { x: 380, y: 140 },
  { x: 140, y: 300 },
  { x: 380, y: 300 },
];

/**
 * @param {string} code
 * @param {string} message
 * @returns {Error & { code: string }}
 */
function storeError(code, message) {
  const err = /** @type {Error & { code: string }} */ (new Error(`${code}: ${message}`));
  err.code = code;
  return err;
}

/**
 * @param {Record<string, unknown>} row
 * @returns {CompanyRow}
 */
function toCompany(row) {
  return { id: Number(row.id), name: String(row.name), createdAt: String(row.created_at) };
}

/**
 * @param {Record<string, unknown>} row
 * @returns {GroupRow}
 */
function toGroup(row) {
  return {
    id: Number(row.id),
    companyId: Number(row.company_id),
    name: String(row.name),
    createdAt: String(row.created_at),
  };
}

/**
 * @param {Record<string, unknown>} row
 * @returns {DeskRow}
 */
function toDesk(row) {
  return {
    id: Number(row.id),
    groupId: Number(row.group_id),
    label: String(row.label),
    x: Number(row.x),
    y: Number(row.y),
    occupant: null,
  };
}

/**
 * @param {{ dataDir: string }} options
 */
export function openStore({ dataDir }) {
  const dbPath = path.join(dataDir, "cubicle.db");
  mkdirSync(dataDir, { recursive: true });
  for (const folder of ["artifacts", "engines", "renders"]) {
    mkdirSync(path.join(dataDir, folder), { recursive: true });
  }

  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(SCHEMA);
  seedIfFirstRun(db);

  return {
    dataDir,
    dbPath,

    /** @returns {string} */
    journalMode() {
      return String(db.prepare("PRAGMA journal_mode").get()?.journal_mode);
    },

    /** @param {string} folder @returns {boolean} */
    directoryExists(folder) {
      return existsSync(path.join(dataDir, folder));
    },

    /** @param {{ name: string }} input @returns {CompanyRow} */
    createCompany({ name }) {
      const createdAt = new Date().toISOString();
      const info = db.prepare("INSERT INTO company (name, created_at) VALUES (?, ?)").run(name, createdAt);
      return { id: Number(info.lastInsertRowid), name, createdAt };
    },

    /** @param {{ companyId: number, name: string }} input @returns {GroupRow} */
    createProjectGroup({ companyId, name }) {
      const company = db.prepare("SELECT id FROM company WHERE id = ?").get(companyId);
      if (!company) throw storeError("unknown_company", `no company with id ${companyId}`);
      const createdAt = new Date().toISOString();
      const info = db
        .prepare("INSERT INTO project_group (company_id, name, created_at) VALUES (?, ?, ?)")
        .run(companyId, name, createdAt);
      const groupId = Number(info.lastInsertRowid);
      insertProjectGroupDesks(db, groupId);
      return { id: groupId, companyId, name, createdAt };
    },

    /** @param {{ companyId: number }} input @returns {GroupRow[]} */
    listGroups({ companyId }) {
      const rows = db
        .prepare("SELECT * FROM project_group WHERE company_id = ? ORDER BY id")
        .all(companyId);
      return rows.map((row) => toGroup(/** @type {Record<string, unknown>} */ (row)));
    },

    /** @param {{ groupId: number }} input @returns {DeskRow[]} */
    listDesks({ groupId }) {
      const rows = db.prepare("SELECT * FROM desk WHERE group_id = ? ORDER BY id").all(groupId);
      return rows.map((row) => toDesk(/** @type {Record<string, unknown>} */ (row)));
    },

    /** @returns {OfficeSnapshot} */
    officeSnapshot() {
      const companies = db.prepare("SELECT * FROM company ORDER BY id").all().map((row) =>
        toCompany(/** @type {Record<string, unknown>} */ (row)),
      );
      const activeCompanyId = companies[0]?.id ?? 0;
      const groups = this.listGroups({ companyId: activeCompanyId });
      const activeGroupId = groups[0]?.id ?? null;
      const desks = activeGroupId === null ? [] : this.listDesks({ groupId: activeGroupId });
      return { companies, activeCompanyId, groups, activeGroupId, desks };
    },

    close() {
      db.close();
    },
  };
}

/**
 * @param {DatabaseSync} db
 * @param {number} groupId
 */
function insertProjectGroupDesks(db, groupId) {
  const insert = db.prepare("INSERT INTO desk (group_id, label, x, y) VALUES (?, ?, ?, ?)");
  DESK_SLOTS.forEach((slot, index) => {
    insert.run(groupId, `工位 ${index + 1}`, slot.x, slot.y);
  });
}

/**
 * @param {DatabaseSync} db
 */
function seedIfFirstRun(db) {
  const seeded = db.prepare("SELECT value FROM meta WHERE key = 'seeded'").get();
  if (seeded) return;
  db.exec("BEGIN");
  try {
    const createdAt = new Date().toISOString();
    const company = db
      .prepare("INSERT INTO company (name, created_at) VALUES (?, ?)")
      .run("默认公司", createdAt);
    const group = db
      .prepare("INSERT INTO project_group (company_id, name, created_at) VALUES (?, ?, ?)")
      .run(Number(company.lastInsertRowid), "默认项目组", createdAt);
    insertProjectGroupDesks(db, Number(group.lastInsertRowid));
    db.prepare("INSERT INTO meta (key, value) VALUES ('seeded', '1')").run();
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
