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
 * @typedef {object} EmployeeSessionRow
 * @property {number} id
 * @property {number} employeeId
 * @property {string} engine
 * @property {string} agentDir
 * @property {string} sessionsDir
 * @property {string} workspaceDir
 * @property {string | null} sessionFile
 * @property {string} updatedAt
 *
 * @typedef {object} RunRow
 * @property {number} id
 * @property {number} employeeSessionId
 * @property {number} employeeId
 * @property {string} engine
 * @property {"running" | "completed" | "aborted" | "failed" | "interrupted"} status
 * @property {string} prompt
 * @property {string} startedAt
 * @property {string | null} endedAt
 *
 * @typedef {object} EngineStateRow
 * @property {string} engine
 * @property {boolean} enabled
 * @property {boolean} manualOverride           带风险手动启用（探针未过）
 * @property {boolean | null} installed         null = 尚未探测
 * @property {string | null} version
 * @property {"unprobed" | "running" | "passed" | "failed"} probeStatus
 * @property {unknown} probe                    { verdicts: { injection, tools, refusal, events }, … }
 * @property {string | null} probeAt
 * @property {string} updatedAt
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
CREATE TABLE IF NOT EXISTS employee_session (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employee(id),
  engine TEXT NOT NULL,
  agent_dir TEXT NOT NULL,
  sessions_dir TEXT NOT NULL,
  workspace_dir TEXT NOT NULL,
  session_file TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE (employee_id, engine)
);
CREATE TABLE IF NOT EXISTS run (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_session_id INTEGER NOT NULL REFERENCES employee_session(id),
  employee_id INTEGER NOT NULL REFERENCES employee(id),
  engine TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'aborted', 'failed', 'interrupted')),
  prompt TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT
);
CREATE TABLE IF NOT EXISTS engine_state (
  engine TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0,
  manual_override INTEGER NOT NULL DEFAULT 0,
  installed INTEGER,
  version TEXT,
  probe_status TEXT NOT NULL DEFAULT 'unprobed' CHECK (probe_status IN ('unprobed', 'running', 'passed', 'failed')),
  probe_json TEXT,
  probe_at TEXT,
  updated_at TEXT NOT NULL
);
`;

/**
 * Run outcomes. 'running' is set by createRun; finishRun moves a run to one
 * of the terminal states. A run still 'running' when the store opens (host
 * restart / crash) is marked 'interrupted' — ticket 10 builds recovery on
 * top of that fact.
 */
const TERMINAL_RUN_STATUSES = new Set(["completed", "aborted", "failed", "interrupted"]);

/**
 * The v1 preset roster (decision 05: 程序员 / 测试 / 产品经理, default
 * engine pi; cost semantics from decision 04: per-task token soft gate).
 * Inserted by key, so an existing database gains roles without duplicates.
 *
 * Shell tool = pi's `powershell` (ticket 07): the app is Windows-first, and
 * pi's `bash` tool resolves to Git-Bash/msys2, whose startup dies under this
 * machine's security policy (NtCreateDirectoryObject → 0xC0000022) — the
 *工位 would show永远失败的执行. PowerShell is the native Windows shell and
 * survives the same policy.
 */
const PRESET_ROLES = [
  {
    key: "programmer",
    name: "程序员",
    tagline: "加功能、修 bug；工作区主力，自主 commit 不 push",
    manifest: {
      persona: "严谨务实的程序员：测试先行、小步提交、不主动 push，回滚靠重新派任务。",
      skills: ["git 工作流", "测试先行"],
      tools: ["read", "write", "edit", "powershell", "grep"],
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
      tools: ["read", "powershell", "grep"],
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
 * @param {Record<string, unknown>} row
 * @returns {EmployeeSessionRow}
 */
function toEmployeeSession(row) {
  return {
    id: Number(row.id),
    employeeId: Number(row.employee_id),
    engine: String(row.engine),
    agentDir: String(row.agent_dir),
    sessionsDir: String(row.sessions_dir),
    workspaceDir: String(row.workspace_dir),
    sessionFile: row.session_file === null || row.session_file === undefined ? null : String(row.session_file),
    updatedAt: String(row.updated_at),
  };
}

/**
 * @param {Record<string, unknown>} row
 * @returns {RunRow}
 */
function toRun(row) {
  return {
    id: Number(row.id),
    employeeSessionId: Number(row.employee_session_id),
    employeeId: Number(row.employee_id),
    engine: String(row.engine),
    status: /** @type {RunRow["status"]} */ (String(row.status)),
    prompt: String(row.prompt),
    startedAt: String(row.started_at),
    endedAt: row.ended_at === null || row.ended_at === undefined ? null : String(row.ended_at),
  };
}

/**
 * @param {Record<string, unknown>} row
 * @returns {EngineStateRow}
 */
function toEngineState(row) {
  /** @type {unknown} */
  let probe = null;
  if (typeof row.probe_json === "string" && row.probe_json.length > 0) {
    try {
      probe = JSON.parse(row.probe_json);
    } catch {
      probe = null;
    }
  }
  return {
    engine: String(row.engine),
    enabled: Number(row.enabled) === 1,
    manualOverride: Number(row.manual_override) === 1,
    installed: row.installed === null || row.installed === undefined ? null : Number(row.installed) === 1,
    version: row.version === null || row.version === undefined ? null : String(row.version),
    probeStatus: /** @type {EngineStateRow["probeStatus"]} */ (String(row.probe_status)),
    probe,
    probeAt: row.probe_at === null || row.probe_at === undefined ? null : String(row.probe_at),
    updatedAt: String(row.updated_at),
  };
}

/**
 * Engines the app ships with. pi is enabled out of the box (its SDK is
 * bundled — ticket 04 already runs on it); every other engine must clear
 * the admission probe (ticket 11) or be hand-enabled with the risk flag
 * before it can take work.
 */
const ENGINE_SEEDS = [
  { engine: "pi", enabled: true, installed: true },
  { engine: "codex", enabled: false, installed: null },
];

/** @param {DatabaseSync} db */
function seedEngineStates(db) {
  const now = new Date().toISOString();
  const insert = db.prepare(
    "INSERT INTO engine_state (engine, enabled, installed, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(engine) DO NOTHING",
  );
  for (const seed of ENGINE_SEEDS) {
    insert.run(seed.engine, seed.enabled ? 1 : 0, seed.installed === null ? null : seed.installed ? 1 : 0, now);
  }
}

/**
 * One-shot schema repair for pre-ticket-11 databases: the old table pinned
 * the per-employee UNIQUE on the column, so a second (engine-switched)
 * session row was impossible. Rebuild with UNIQUE (employee_id, engine),
 * keeping ids — run rows reference them.
 *
 * @param {DatabaseSync} db
 */
function migrateEmployeeSessionPerEngine(db) {
  const table = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'employee_session'").get();
  const sql = String(/** @type {Record<string, unknown>} */ (table ?? {}).sql ?? "");
  if (!/employee_id\s+INTEGER\s+NOT\s+NULL\s+UNIQUE/i.test(sql)) return;
  db.exec("BEGIN");
  try {
    db.exec("ALTER TABLE employee_session RENAME TO employee_session_pre11");
    db.exec(SCHEMA_SESSION_ONLY);
    db.exec(`
      INSERT INTO employee_session (id, employee_id, engine, agent_dir, sessions_dir, workspace_dir, session_file, updated_at)
      SELECT id, employee_id, engine, agent_dir, sessions_dir, workspace_dir, session_file, updated_at FROM employee_session_pre11
    `);
    db.exec("DROP TABLE employee_session_pre11");
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

/** The employee_session DDL, duplicated here so the migration can create
 *  exactly that table without re-running unrelated schema statements. */
const SCHEMA_SESSION_ONLY = `
CREATE TABLE employee_session (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employee(id),
  engine TEXT NOT NULL,
  agent_dir TEXT NOT NULL,
  sessions_dir TEXT NOT NULL,
  workspace_dir TEXT NOT NULL,
  session_file TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE (employee_id, engine)
);
`;

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
  // Ticket 11 widens employee_session from one-per-employee to one-per
  // employee × engine (switching engines keeps each engine's resume story).
  // Databases built before that carry the UNIQUE on the column itself —
  // rebuild them in place, ids first (run rows reference those ids).
  migrateEmployeeSessionPerEngine(db);
  // A host that died (or was killed) mid-run must not leave phantom 'running'
  // rows behind: they become 'interrupted' the moment a host opens the store.
  markInterruptedRuns(db);
  seedIfFirstRun(db);
  seedRoles(db);
  seedEngineStates(db);

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
     * @param {number} employeeId
     * @returns {(EmployeeOccupant & { companyId: number }) | null}
     */
    employeeById(employeeId) {
      const row = db
        .prepare("SELECT id, company_id, name, role_id, role_snapshot, hired_at FROM employee WHERE id = ?")
        .get(employeeId);
      if (!row) return null;
      return {
        id: Number(row.id),
        companyId: Number(row.company_id),
        name: String(row.name),
        roleId: Number(row.role_id),
        roleSnapshot: /** @type {RoleSnapshot} */ (JSON.parse(String(row.role_snapshot))),
        hiredAt: String(row.hired_at),
      };
    },

    /**
     * One conversation session per employee × engine (ticket 04: 同一员工连续
     * 两次对话复用同一会话; ticket 11: 切换引擎后每个引擎各自保留自己的会话与
     * 恢复指针，换回原引擎照常续). The row also carries the engine-owned
     * directory layout and — once the engine has written one — the resume
     * pointer (session file). Directories are only applied on creation; the
     * session entity is the stable thing, not the paths.
     *
     * @param {{ employeeId: number, engine: string, agentDir: string, sessionsDir: string, workspaceDir: string }} input
     * @returns {EmployeeSessionRow}
     */
    getOrCreateEmployeeSession({ employeeId, engine, agentDir, sessionsDir, workspaceDir }) {
      if (!db.prepare("SELECT id FROM employee WHERE id = ?").get(employeeId)) {
        throw appError("unknown_employee", `no employee with id ${employeeId}`);
      }
      const existing = db
        .prepare("SELECT * FROM employee_session WHERE employee_id = ? AND engine = ?")
        .get(employeeId, engine);
      if (existing) return toEmployeeSession(/** @type {Record<string, unknown>} */ (existing));
      const now = new Date().toISOString();
      const info = db
        .prepare(
          "INSERT INTO employee_session (employee_id, engine, agent_dir, sessions_dir, workspace_dir, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(employeeId, engine, agentDir, sessionsDir, workspaceDir, now);
      return toEmployeeSession(
        /** @type {Record<string, unknown>} */ (
          db.prepare("SELECT * FROM employee_session WHERE id = ?").get(Number(info.lastInsertRowid))
        ),
      );
    },

    /**
     * Record the engine adapter's resume pointer (its session file).
     *
     * @param {{ employeeSessionId: number, sessionFile: string }} input
     */
    setEmployeeSessionFile({ employeeSessionId, sessionFile }) {
      db.prepare("UPDATE employee_session SET session_file = ?, updated_at = ? WHERE id = ?").run(
        sessionFile,
        new Date().toISOString(),
        employeeSessionId,
      );
    },

    /** @param {number} employeeSessionId @returns {EmployeeSessionRow | null} */
    employeeSessionById(employeeSessionId) {
      const row = db.prepare("SELECT * FROM employee_session WHERE id = ?").get(employeeSessionId);
      return row ? toEmployeeSession(/** @type {Record<string, unknown>} */ (row)) : null;
    },

    /**
     * @param {{ employeeId: number, employeeSessionId: number, engine: string, prompt: string }} input
     * @returns {RunRow}
     */
    createRun({ employeeId, employeeSessionId, engine, prompt }) {
      const startedAt = new Date().toISOString();
      const info = db
        .prepare(
          "INSERT INTO run (employee_session_id, employee_id, engine, status, prompt, started_at) VALUES (?, ?, ?, 'running', ?, ?)",
        )
        .run(employeeSessionId, employeeId, engine, prompt, startedAt);
      return toRun(/** @type {Record<string, unknown>} */ (db.prepare("SELECT * FROM run WHERE id = ?").get(Number(info.lastInsertRowid))));
    },

    /**
     * @param {{ runId: number, status: "completed" | "aborted" | "failed" | "interrupted" }} input
     * @returns {RunRow}
     */
    finishRun({ runId, status }) {
      if (!TERMINAL_RUN_STATUSES.has(status)) {
        throw appError("invalid_payload", `run cannot finish with status ${status}`);
      }
      db.prepare("UPDATE run SET status = ?, ended_at = ? WHERE id = ? AND status = 'running'").run(
        status,
        new Date().toISOString(),
        runId,
      );
      const row = db.prepare("SELECT * FROM run WHERE id = ?").get(runId);
      if (!row) throw appError("unknown_run", `no run with id ${runId}`);
      return toRun(/** @type {Record<string, unknown>} */ (row));
    },

    /** @param {number} employeeId @returns {RunRow | null} */
    latestRunForEmployee(employeeId) {
      const row = db.prepare("SELECT * FROM run WHERE employee_id = ? ORDER BY id DESC LIMIT 1").get(employeeId);
      return row ? toRun(/** @type {Record<string, unknown>} */ (row)) : null;
    },

    // — engine admission state (ticket 11: 徽章三态 + 准入探针 + 风险启用) —

    /**
     * @param {string} engine
     * @returns {EngineStateRow | null}
     */
    engineState(engine) {
      const row = db.prepare("SELECT * FROM engine_state WHERE engine = ?").get(engine);
      return row ? toEngineState(/** @type {Record<string, unknown>} */ (row)) : null;
    },

    /** @returns {EngineStateRow[]} */
    listEngineStates() {
      const rows = db.prepare("SELECT * FROM engine_state ORDER BY engine").all();
      return rows.map((row) => toEngineState(/** @type {Record<string, unknown>} */ (row)));
    },

    /**
     * Record what engine detection (版本探测) learned about the binary.
     *
     * @param {{ engine: string, installed: boolean, version?: string | null }} input
     */
    setEngineInstalled({ engine, installed, version = null }) {
      db.prepare(
        `INSERT INTO engine_state (engine, installed, version, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(engine) DO UPDATE SET installed = excluded.installed, version = excluded.version, updated_at = excluded.updated_at`,
      ).run(engine, installed ? 1 : 0, version, new Date().toISOString());
    },

    /**
     * Persist an admission probe's four verdicts. A pass is an admission:
     * it enables the engine and clears any hand-enabled risk flag.
     *
     * @param {{ engine: string, status: "running" | "passed" | "failed", probe?: unknown }} input
     */
    setEngineProbeResult({ engine, status, probe }) {
      const now = new Date().toISOString();
      const json = probe === undefined ? null : JSON.stringify(probe);
      db.prepare(
        `INSERT INTO engine_state (engine, probe_status, probe_json, probe_at, enabled, manual_override, updated_at)
         VALUES (?, ?, ?, ?, 0, 0, ?)
         ON CONFLICT(engine) DO UPDATE SET
           probe_status = excluded.probe_status,
           probe_json = COALESCE(excluded.probe_json, engine_state.probe_json),
           probe_at = excluded.probe_at,
           updated_at = excluded.updated_at`,
      ).run(engine, status, json, now, now);
      if (status === "passed") {
        db.prepare("UPDATE engine_state SET enabled = 1, manual_override = 0, updated_at = ? WHERE engine = ?").run(now, engine);
      }
    },

    /**
     * Enable/disable an engine. manualOverride marks a hand-enable after a
     * failed (or skipped) probe — the engine card must show it as a risk.
     *
     * @param {{ engine: string, enabled: boolean, manualOverride?: boolean }} input
     */
    setEngineEnabled({ engine, enabled, manualOverride = false }) {
      if (!db.prepare("SELECT engine FROM engine_state WHERE engine = ?").get(engine)) {
        throw appError("unknown_engine", `no engine state for ${engine}`);
      }
      db.prepare("UPDATE engine_state SET enabled = ?, manual_override = ?, updated_at = ? WHERE engine = ?").run(
        enabled ? 1 : 0,
        manualOverride ? 1 : 0,
        new Date().toISOString(),
        engine,
      );
    },

    /**
     * @param {string} name
     * @returns {{ id: number, companyId: number, name: string, roleId: number, roleSnapshot: RoleSnapshot, hiredAt: string } | null}
     */
    employeeByName(name) {
      const row = db
        .prepare("SELECT id, company_id, name, role_id, role_snapshot, hired_at FROM employee WHERE name = ?")
        .get(name);
      if (!row) return null;
      return {
        id: Number(row.id),
        companyId: Number(row.company_id),
        name: String(row.name),
        roleId: Number(row.role_id),
        roleSnapshot: /** @type {RoleSnapshot} */ (JSON.parse(String(row.role_snapshot))),
        hiredAt: String(row.hired_at),
      };
    },

    /**
     * Hidden desk-less employee used by the admission probe (ticket 11):
     * conversation plumbing works for it (run-manager only needs an
     * employee row) while the office view — driven by desks — never sees it.
     *
     * @param {{ name: string, engine: string, roleSnapshot: RoleSnapshot }} input
     * @returns {{ id: number, companyId: number, name: string, roleId: number, roleSnapshot: RoleSnapshot, hiredAt: string }}
     */
    ensureProbeEmployee({ name, engine, roleSnapshot }) {
      const existing = this.employeeByName(name);
      if (existing) {
        // Re-runs must not drift onto another engine mid-probe history: keep
        // one probe employee per engine.
        if (existing.roleSnapshot?.manifest?.engine === engine) return existing;
      }
      const company = db.prepare("SELECT id FROM company ORDER BY id LIMIT 1").get();
      const role = db.prepare("SELECT id FROM role ORDER BY id LIMIT 1").get();
      if (!company || !role) throw appError("invalid_state", "probe employee needs a company and a role");
      const hiredAt = new Date().toISOString();
      const info = db
        .prepare("INSERT INTO employee (company_id, name, role_id, role_snapshot, hired_at) VALUES (?, ?, ?, ?, ?)")
        .run(Number(company.id), name, Number(role.id), JSON.stringify(roleSnapshot), hiredAt);
      const id = Number(info.lastInsertRowid);
      return {
        id,
        companyId: Number(company.id),
        name,
        roleId: Number(role.id),
        roleSnapshot,
        hiredAt,
      };
    },

    /**
     * Switch an employee's engine by rewriting the frozen role snapshot's
     * manifest.engine — the snapshot stays frozen for everything else
     * (decision 02: 入职冻结, but the ticket-11 switch is an explicit act).
     *
     * @param {{ employeeId: number, engine: string }} input
     * @returns {{ id: number, companyId: number, name: string, roleId: number, roleSnapshot: RoleSnapshot, hiredAt: string }}
     */
    setEmployeeEngine({ employeeId, engine }) {
      const row = db.prepare("SELECT role_snapshot FROM employee WHERE id = ?").get(employeeId);
      if (!row) throw appError("unknown_employee", `no employee with id ${employeeId}`);
      const snapshot = JSON.parse(String(row.role_snapshot));
      if (!snapshot.manifest || typeof snapshot.manifest !== "object") snapshot.manifest = {};
      snapshot.manifest.engine = engine;
      db.prepare("UPDATE employee SET role_snapshot = ? WHERE id = ?").run(JSON.stringify(snapshot), employeeId);
      return /** @type {any} */ (this.employeeById(employeeId));
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
 * Runs left 'running' belong to a host that is no longer alive: close that
 * chapter before any new host starts. Ticket 10 (crash recovery) builds the
 * resume story on top of this marker.
 *
 * @param {DatabaseSync} db
 */
function markInterruptedRuns(db) {
  const running = db.prepare("SELECT id FROM run WHERE status = 'running'").all();
  if (running.length === 0) return;
  const endedAt = new Date().toISOString();
  const finish = db.prepare("UPDATE run SET status = 'interrupted', ended_at = ? WHERE id = ?");
  for (const row of running) finish.run(endedAt, Number(/** @type {Record<string, unknown>} */ (row).id));
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
