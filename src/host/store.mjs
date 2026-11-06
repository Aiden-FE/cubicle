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

import { appError } from "../shared/apperror.mjs";

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
 * @property {EmployeeOccupant | null} occupant
 *
 * @typedef {object} EmployeeOccupant
 * @property {number} id
 * @property {string} name
 * @property {number} roleId
 * @property {string} hiredAt
 * @property {RoleSnapshot} roleSnapshot
 *
 * @typedef {object} RoleSnapshot
 * @property {string} key
 * @property {string} name
 * @property {string} tagline
 * @property {RoleManifest} manifest
 *
 * @typedef {object} RoleManifest
 * @property {string} persona
 * @property {string[]} skills
 * @property {string[]} tools
 * @property {string[]} mcpServers
 * @property {string} engine
 * @property {string} model
 * @property {{ tokenBudgetPerTask: number }} cost
 *
 * @typedef {object} RoleRow
 * @property {number} id
 * @property {string} key
 * @property {string} name
 * @property {string} tagline
 * @property {RoleManifest} manifest
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
CREATE TABLE IF NOT EXISTS role (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  tagline TEXT NOT NULL,
  manifest TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS employee (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES company(id),
  name TEXT NOT NULL,
  role_id INTEGER NOT NULL REFERENCES role(id),
  role_snapshot TEXT NOT NULL,
  hired_at TEXT NOT NULL
);
`;

/**
 * The v1 preset roster (decision 05: 程序员 / 测试 / 产品经理, default
 * engine pi; cost semantics from decision 04: per-task token soft gate).
 * Inserted by key, so an existing database gains roles without duplicates.
 */
const PRESET_ROLES = [
  {
    key: "programmer",
    name: "程序员",
    tagline: "加功能、修 bug；工作区主力，自主 commit 不 push",
    manifest: {
      persona: "严谨务实的程序员：测试先行、小步提交、不主动 push，回滚靠重新派任务。",
      skills: ["git 工作流", "测试先行"],
      tools: ["read", "write", "edit", "bash", "grep"],
      mcpServers: [],
      engine: "pi",
      model: "default",
      cost: { tokenBudgetPerTask: 500000 },
    },
  },
  {
    key: "tester",
    name: "测试",
    tagline: "跑测试、验收辅助；只读代码 + 执行测试",
    manifest: {
      persona: "苛刻的测试工程师：一切清单化，优先跑测试，不改动被测试的代码。",
      skills: ["测试清单化"],
      tools: ["read", "bash", "grep"],
      mcpServers: [],
      engine: "pi",
      model: "default",
      cost: { tokenBudgetPerTask: 500000 },
    },
  },
  {
    key: "pm",
    name: "产品经理",
    tagline: "写文档、做规划；只读写文档，不碰 shell",
    manifest: {
      persona: "有条理的产品经理：先讲清目标与验收标准，再谈方案与文档。",
      skills: ["文档结构约定"],
      tools: ["read", "write"],
      mcpServers: [],
      engine: "pi",
      model: "default",
      cost: { tokenBudgetPerTask: 500000 },
    },
  },
];

/** Layout slots for the four desks every project group owns. */
const DESK_SLOTS = [
  { x: 140, y: 140 },
  { x: 380, y: 140 },
  { x: 140, y: 300 },
  { x: 380, y: 300 },
];

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

/** Shared columns for reading a desk row joined with its occupant's employee row. */
const DESK_JOIN = `d.*,
  e.id AS e_id, e.name AS e_name, e.role_id AS e_role_id,
  e.role_snapshot AS e_role_snapshot, e.hired_at AS e_hired_at`;

/**
 * @param {Record<string, unknown>} row desk row joined with its occupant
 * @returns {DeskRow}
 */
function toDesk(row) {
  const occupantId = row.e_id === null || row.e_id === undefined ? null : Number(row.e_id);
  return {
    id: Number(row.id),
    groupId: Number(row.group_id),
    label: String(row.label),
    x: Number(row.x),
    y: Number(row.y),
    occupant:
      occupantId === null
        ? null
        : {
            id: occupantId,
            name: String(row.e_name),
            roleId: Number(row.e_role_id),
            hiredAt: String(row.e_hired_at),
            roleSnapshot: /** @type {RoleSnapshot} */ (JSON.parse(String(row.e_role_snapshot))),
          },
  };
}

/**
 * @param {Record<string, unknown>} row
 * @returns {RoleRow}
 */
function toRole(row) {
  return {
    id: Number(row.id),
    key: String(row.key),
    name: String(row.name),
    tagline: String(row.tagline),
    manifest: /** @type {RoleManifest} */ (JSON.parse(String(row.manifest))),
  };
}

/**
 * Freeze a role row into the snapshot shape stored on every employee:
 * identity + manifest, as it is right now.
 *
 * @param {RoleRow} role
 * @returns {RoleSnapshot}
 */
function toRoleSnapshot(role) {
  return { key: role.key, name: role.name, tagline: role.tagline, manifest: role.manifest };
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
  seedRoles(db);

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
      if (!company) throw appError("unknown_company", `no company with id ${companyId}`);
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
      const rows = db
        .prepare(`SELECT ${DESK_JOIN} FROM desk d LEFT JOIN employee e ON e.id = d.employee_id WHERE d.group_id = ? ORDER BY d.id`)
        .all(groupId);
      return rows.map((row) => toDesk(/** @type {Record<string, unknown>} */ (row)));
    },

    /**
     * Factory roles, in seed order. The roster is (re)inserted by key on
     * every open, so old databases gain new presets without duplicates.
     *
     * @returns {RoleRow[]}
     */
    listRoles() {
      const rows = db.prepare("SELECT * FROM role ORDER BY id").all();
      return rows.map((row) => toRole(/** @type {Record<string, unknown>} */ (row)));
    },

    /**
     * Hire an employee onto a free desk, freezing the role as it is right now
     * into the employee (decision 02: hiring takes a snapshot; later role
     * edits never infect people already hired). One transaction so a desk is
     * never half-occupied.
     *
     * @param {{ deskId: number, roleId: number, name?: string }} input
     * @returns {{ employee: { id: number, companyId: number, name: string, roleId: number, roleSnapshot: RoleSnapshot, hiredAt: string }, desk: DeskRow | null }}
     */
    hireEmployee({ deskId, roleId, name }) {
      const deskRow = db
        .prepare(
          `SELECT ${DESK_JOIN}, g.company_id AS g_company_id
           FROM desk d
           JOIN project_group g ON g.id = d.group_id
           LEFT JOIN employee e ON e.id = d.employee_id
           WHERE d.id = ?`,
        )
        .get(deskId);
      if (!deskRow) throw appError("unknown_desk", `no desk with id ${deskId}`);
      if (deskRow.e_id !== null && deskRow.e_id !== undefined) {
        throw appError("desk_occupied", `desk ${deskId} already has an occupant`);
      }
      const roleRow = db.prepare("SELECT * FROM role WHERE id = ?").get(roleId);
      if (!roleRow) throw appError("unknown_role", `no role with id ${roleId}`);

      const role = toRole(/** @type {Record<string, unknown>} */ (roleRow));
      const roleSnapshot = toRoleSnapshot(role);
      const employeeName = name !== undefined && name.trim().length > 0 ? name.trim() : role.name;
      const hiredAt = new Date().toISOString();
      let employeeId = 0;

      db.exec("BEGIN");
      try {
        const info = db
          .prepare("INSERT INTO employee (company_id, name, role_id, role_snapshot, hired_at) VALUES (?, ?, ?, ?, ?)")
          .run(Number(deskRow.g_company_id), employeeName, role.id, JSON.stringify(roleSnapshot), hiredAt);
        employeeId = Number(info.lastInsertRowid);
        // Guard against a racing occupy inside this transaction.
        const occupied = db
          .prepare("UPDATE desk SET employee_id = ? WHERE id = ? AND employee_id IS NULL")
          .run(employeeId, deskId);
        if (occupied.changes !== 1) throw appError("desk_occupied", `desk ${deskId} already has an occupant`);
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }

      return {
        employee: {
          id: employeeId,
          companyId: Number(deskRow.g_company_id),
          name: employeeName,
          roleId: role.id,
          roleSnapshot,
          hiredAt,
        },
        desk: this.listDesks({ groupId: Number(deskRow.group_id) }).find((d) => d.id === deskId) ?? null,
      };
    },

    /**
     * Remember which company / project group the office view follows.
     * Partial updates are allowed: pass companyId, groupId, or both.
     *
     * @param {{ companyId?: number, groupId?: number }} selection
     */
    setActive({ companyId, groupId }) {
      const current = readActive(db);
      const next = {
        companyId: companyId ?? current.companyId,
        groups: { ...current.groups },
      };
      if (groupId !== undefined) {
        if (companyId === undefined) throw appError("invalid_payload", "groupId requires companyId");
        next.groups[companyId] = groupId;
      }
      writeActive(db, next);
    },

    /**
     * @returns {OfficeSnapshot}
     */
    officeSnapshot() {
      const companies = db.prepare("SELECT * FROM company ORDER BY id").all().map((row) =>
        toCompany(/** @type {Record<string, unknown>} */ (row)),
      );
      const active = readActive(db);
      let activeCompanyId = companies.some((c) => c.id === active.companyId)
        ? active.companyId
        : (companies[0]?.id ?? 0);
      const groups = this.listGroups({ companyId: activeCompanyId });
      const chosen = active.groups[activeCompanyId];
      const activeGroupId = groups.some((g) => g.id === chosen)
        ? chosen
        : (groups.at(-1)?.id ?? null);
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
 * The office view's current selection, persisted in meta as one JSON value:
 * { companyId, groups: { [companyId]: groupId } }. Unknown ids fall back at
 * read time, so a deleted row never wedges the snapshot.
 *
 * @param {DatabaseSync} db
 * @returns {{ companyId: number, groups: Record<number, number> }}
 */
function readActive(db) {
  const row = db.prepare("SELECT value FROM meta WHERE key = 'active'").get();
  try {
    const parsed = JSON.parse(String(row?.value ?? "null"));
    return {
      companyId: Number(parsed?.companyId) || 0,
      groups: Object.fromEntries(
        Object.entries(parsed?.groups ?? {}).map(([k, v]) => [Number(k), Number(v)]),
      ),
    };
  } catch {
    return { companyId: 0, groups: {} };
  }
}

/**
 * @param {DatabaseSync} db
 * @param {{ companyId: number, groups: Record<number, number> }} active
 */
function writeActive(db, active) {
  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('active', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify(active));
}

/**
 * Insert any preset role this database is missing (by key). Runs on every
 * open, so upgrading an older database picks up the factory roster without
 * touching rows users may already reference.
 *
 * @param {DatabaseSync} db
 */
function seedRoles(db) {
  const createdAt = new Date().toISOString();
  const insert = db.prepare(
    "INSERT INTO role (key, name, tagline, manifest, created_at) VALUES (?, ?, ?, ?, ?)",
  );
  const exists = db.prepare("SELECT 1 FROM role WHERE key = ?");
  for (const preset of PRESET_ROLES) {
    if (exists.get(preset.key)) continue;
    insert.run(preset.key, preset.name, preset.tagline, JSON.stringify(preset.manifest), createdAt);
  }
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
