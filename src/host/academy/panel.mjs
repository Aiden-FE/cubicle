/**
 * 票 a03 — 学院浮层的 host 门：probe / snapshot（列表）/ install（装）/ dispatch（下发）。
 *
 * 所有对学院的写入都走 **vendored Neo CLI**（NEO_HOME 照旧生效；Cubicle 永不
 * 直接写 ~/.neo，见 impl/README「不写 ~/.neo」）。读侧 = 01 的投影缓存
 * （store 的 role 行）+ `neo list domains --json` + 对 `library/<domain>` 的
 * **只读**直读（缓存/UI 用途，同 a01 的 TODO(materialize) 限定）。
 *
 * 来源标记（本机 local / 远端 remote / 手写 written）是 **Cubicle 侧的账**
 * （store 的 academy_mark 表）：Neo 对 library 技能没有来源台账，而面板要
 * 记得「远端来源已经确认过哪一次」。键：容器级 `d:<domain>` / `r:<role>`，
 * 行级 `d:<domain>/<skill>`。判定优先级：面板标记 → 角色锁的 sourceType →
 * 手写。
 *
 * 下发按 vendor/README.md 的锁 dirty 宿主合同排序：
 * `neo role set --domains`（标脏）→ `neo update`（清脏）→ 投影刷新。
 * （materialize 永不清脏，装配时另行发生，不在这里。）
 *
 * MCP：面板与下发都 **不碰** —— 引擎侧 MCP 按 lead 外部验收（neo review
 * T1–T4）整体搁置，见 assembly.mjs 的 CUBICLE_ACADEMY_MCP 门。
 */
import path from "node:path";

import { appError } from "../../shared/apperror.mjs";
import { runNeoCli } from "./neo-cli.mjs";
import { dirContentSha, readNeoRoleProjections, readableChildDirs, resolveNeoHome } from "./neo-roles.mjs";

/** vendored 钉死能力（materialize + library/domain + role set）的最低版本。 */
export const REQUIRED_NEO_VERSION = "0.2.8";

/** Neo 的角色/领域名规则（core names.ts 同一份）。 */
const NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
/** Neo 的技能名规则（core names.ts SKILL_NAME_PATTERN）。 */
const SKILL_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * store.academy_mark 行的镜像形状（单一来源仍是 store.mjs 的 toAcademyMark）。
 * @typedef {object} AcademyMarkRow
 * @property {string} resourceKey
 * @property {"local" | "remote" | "written"} kind
 * @property {string | null} source
 * @property {boolean} remoteAck
 * @property {string} updatedAt
 */

/**
 * @param {string | null | undefined} version
 * @param {string} minimum
 * @returns {boolean}
 */
export function isNeoVersionAtLeast(version, minimum) {
  const a = String(version ?? "").match(/^(\d+)\.(\d+)\.(\d+)/);
  const b = String(minimum).match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!a || !b) return false;
  for (let i = 1; i <= 3; i += 1) {
    const x = Number(a[i]);
    const y = Number(b[i]);
    if (x !== y) return x > y;
  }
  return true;
}

/** 与 neo core inferSourceType 同源的推断：路径形态 = 本机，其余 = 远端。 */
/** @param {string} source @returns {boolean} */
function looksLocalPath(source) {
  return /^[a-zA-Z]:[\\/]/.test(source) || source.startsWith("/") || source.startsWith("\\\\") || source.startsWith("\\") || source.startsWith(".");
}

/** @param {unknown} err */
function errMessage(err) {
  return err instanceof Error ? err.message : String(err);
}

/**
 * @typedef {object} AcademyRowView
 * @property {string} resourceKey       `d:<domain>/<skill>` 或 `r:<role>/<skill>`
 * @property {"domain" | "role"} layer
 * @property {string} name              技能名
 * @property {string} [domain]          layer=domain：所属领域；layer=role：角色声明的领域列表在 domains
 * @property {string} [role]            layer=role：所属角色
 * @property {string[]} domains         该资源关联的领域（role 行 = 角色的 domains）
 * @property {string | null} hash
 * @property {"local" | "remote" | "written"} kind  来源标记（本机/远端/手写）
 * @property {string | null} source     标记里的源字符串（若有）
 * @property {string[]} referencedBy    被哪些角色引用（role 键）
 * @property {boolean} remoteAck        远端首次下发确认已落库（仅远端有意义）
 */

/**
 * @param {{
 *   store: ReturnType<import("../store.mjs").openStore>,
 *   nodeBinary: string,
 *   cliEntry: string,
 *   env?: Record<string, string | undefined>,
 * }} deps
 */
export function createAcademyPanel({ store, nodeBinary, cliEntry, env = process.env }) {
  /** @param {string[]} args @param {number} [timeoutMs] */
  function neo(args, timeoutMs = 30_000) {
    return runNeoCli({ nodeBinary, cliEntry, args, env: { ...env }, timeoutMs });
  }

  /**
   * 可用性探针：`--version` 起得来且 ≥ REQUIRED_NEO_VERSION。
   * 永不抛 —— 面板降级为只读全靠这个返回值（验收：不抛未捕获异常）。
   */
  async function probe() {
    try {
      const { stdout } = await neo(["--version"], 15_000);
      const version = stdout.trim().split(/\r?\n/)[0]?.trim() ?? "";
      if (!isNeoVersionAtLeast(version, REQUIRED_NEO_VERSION)) {
        return {
          available: /** @type {const} */ (false),
          version: version.length > 0 ? version : null,
          reason: `vendored neo CLI 版本 ${version.length > 0 ? version : "（读不到）"} 过老，学院需要 ≥ ${REQUIRED_NEO_VERSION}（materialize / 领域库 / role set）`,
        };
      }
      return { available: /** @type {const} */ (true), version, reason: null };
    } catch (err) {
      return {
        available: /** @type {const} */ (false),
        version: null,
        reason: `vendored neo CLI 起不来：${errMessage(err)}`,
      };
    }
  }

  /** `neo list domains --json` → [{name, skills}]；CLI 不可用/输出坏 = []（面板照常渲染缓存）。 */
  async function listDomains() {
    try {
      const { stdout } = await neo(["list", "domains", "--json"]);
      const parsed = /** @type {{ domains?: unknown }} */ (JSON.parse(stdout.trim()));
      if (!Array.isArray(parsed?.domains)) return [];
      return /** @type {{ name: string; skills: number }[]} */ (
        parsed.domains
          .filter((d) => typeof d?.name === "string" && d.name.length > 0)
          .map((d) => ({ name: d.name, skills: Number(d.skills ?? 0) }))
      );
    } catch {
      return [];
    }
  }

  /**
   * 面板标记优先 → 角色锁 sourceType → 手写。
   * @param {Map<string, AcademyMarkRow | null>} marks
   * @param {string} rowKey @param {string} containerKey @param {string | undefined} lockSourceType
   * @returns {{ kind: "local" | "remote" | "written", mark: AcademyMarkRow | null }}
   */
  function resolveKind(marks, rowKey, containerKey, lockSourceType) {
    const mark = marks.get(rowKey) ?? marks.get(containerKey) ?? null;
    if (mark) return { kind: mark.kind, mark };
    if (lockSourceType === "local") return { kind: "local", mark: null };
    if (lockSourceType === "git" || lockSourceType === "wellknown") return { kind: "remote", mark: null };
    return { kind: "written", mark: null };
  }

  /**
   * 列表快照（验收：数据全部来自 ~/.neo；空目录 = 空态）。
   * @param {{ probeResult?: Awaited<ReturnType<typeof probe>> }} [opts]
   */
  async function buildSnapshot({ probeResult } = {}) {
    const p = probeResult ?? (await probe());
    const neoHome = resolveNeoHome({ env });
    const marks = new Map(store.listAcademyMarks().map((m) => [m.resourceKey, m]));
    const neoRoles = store.listRoles().filter((role) => role.source === "neo");
    const domains = p.available ? await listDomains() : [];

    /** @type {AcademyRowView[]} */
    const rows = [];
    // 角色层：来自 a01 投影缓存（skills 名字 + hash + 锁 sourceType）。
    for (const role of neoRoles) {
      for (const skill of role.skills ?? []) {
        const resourceKey = `r:${role.key}/${skill.name}`;
        const { kind, mark } = resolveKind(marks, resourceKey, `r:${role.key}`, skill.sourceType);
        rows.push({
          resourceKey,
          layer: "role",
          role: role.key,
          name: skill.name,
          domains: role.domains ?? [],
          hash: typeof skill.hash === "string" ? skill.hash : null,
          kind,
          source: mark?.source ?? null,
          referencedBy: [role.key],
          remoteAck: mark?.remoteAck === true,
        });
      }
    }
    // 领域层：`list domains --json` 给领域，library/<domain>/<skill> 只读直读给名字 + 展示 hash。
    for (const domain of domains) {
      const skillNames = (await readableChildDirs(path.join(neoHome, "library", domain.name))).sort();
      for (const name of skillNames) {
        const resourceKey = `d:${domain.name}/${name}`;
        const { kind, mark } = resolveKind(marks, resourceKey, `d:${domain.name}`, undefined);
        rows.push({
          resourceKey,
          layer: "domain",
          domain: domain.name,
          name,
          domains: [domain.name],
          hash: await dirContentSha(path.join(neoHome, "library", domain.name, name)).catch(() => null),
          kind,
          source: mark?.source ?? null,
          // 「被哪些角色引用」= 声明了这个领域的角色（投影缓存现值 → 下发后实时跟着变）。
          referencedBy: neoRoles.filter((role) => (role.domains ?? []).includes(domain.name)).map((role) => role.key),
          remoteAck: marks.get(`d:${domain.name}`)?.remoteAck === true,
        });
      }
    }
    rows.sort((a, b) =>
      a.layer !== b.layer ? (a.layer < b.layer ? -1 : 1) : (a.domain ?? a.role ?? "") !== (b.domain ?? b.role ?? "")
        ? String(a.domain ?? a.role) < String(b.domain ?? b.role)
          ? -1
          : 1
        : a.name < b.name
          ? -1
          : a.name > b.name
            ? 1
            : 0,
    );

    return {
      probe: p,
      neoHome,
      readOnly: !p.available,
      domains,
      neoRoles: neoRoles.map((role) => ({ key: role.key, name: role.name, domains: role.domains ?? [] })),
      rows,
    };
  }

  async function refreshProjection() {
    try {
      store.syncRoleProjection(await readNeoRoleProjections(resolveNeoHome({ env })));
    } catch (err) {
      // 缓存刷新失败不能吞掉调用方的结果；写动作的成败以 CLI 回显为准。
      process.stderr.write(`academy panel projection refresh failed: ${errMessage(err)}\n`);
    }
  }

  /** @param {unknown} raw @returns {string[] | null} null = 默认全部 */
  function parseSkillSelection(raw) {
    if (raw === undefined || raw === null) return null;
    const items = Array.isArray(raw)
      ? raw.map((item) => String(item).trim()).filter((item) => item.length > 0)
      : String(raw)
          .split(",")
          .map((item) => item.trim())
          .filter((item) => item.length > 0);
    if (items.length === 0) return null;
    if (items.includes("*") && items.length > 1) {
      throw appError("invalid_payload", "技能选择里的 * 必须单独使用（表示全部）");
    }
    for (const item of items) {
      if (item !== "*" && !SKILL_NAME_PATTERN.test(item)) {
        throw appError("invalid_payload", `技能名 ${JSON.stringify(item)} 不符合 Neo 的名字规则`);
      }
    }
    return items;
  }

  /**
   * 装：`neo add <source> [--role|--domain] <name> -s <…|*>`（vendored CLI，
   * NEO_HOME 在 env 里）。成功回显上游输出；失败以 academy_cli_failed 抛回
   * （message = neo 自己的可读原因）。成功后把来源标记（本机/远端）落到
   * Cubicle 的 academy_mark 并刷投影缓存（部分成功也刷）。
   *
   * @param {{ source: unknown, target: unknown, targetName: unknown, skills?: unknown }} payload
   */
  async function install(payload) {
    const p = await probe();
    if (!p.available) throw appError("academy_neo_unavailable", `装不了：${p.reason ?? "neo 不可用"}`);
    const record = /** @type {Record<string, unknown>} */ (payload ?? {});
    const source = typeof record.source === "string" ? record.source.trim() : "";
    if (source.length === 0) {
      throw appError("invalid_payload", "装需要源字符串（本机目录的绝对路径，或 git 仓库 / 可安装源）");
    }
    if (record.target !== "role" && record.target !== "domain") {
      throw appError("invalid_payload", "装的目标只能是 role 或 domain");
    }
    const targetName = typeof record.targetName === "string" ? record.targetName.trim() : "";
    if (!NAME_PATTERN.test(targetName)) {
      throw appError("invalid_payload", `目标名 ${JSON.stringify(targetName)} 不符合 Neo 的名字规则（小写字母/数字/连字符）`);
    }
    const skills = parseSkillSelection(record.skills) ?? ["*"];
    const args = ["add", source, record.target === "domain" ? "--domain" : "--role", targetName, "-s", skills.join(",")];
    let stdout;
    try {
      // 上游 `npx skills` 可能要联网克隆 —— 给足超时。
      ({ stdout } = await neo(args, 180_000));
    } finally {
      await refreshProjection();
    }
    const kind = looksLocalPath(source) ? "local" : "remote";
    store.upsertAcademyMark({ resourceKey: `${record.target === "domain" ? "d" : "r"}:${targetName}`, kind, source });
    const echo = stdout.trim();
    return { ok: /** @type {const} */ (true), echo, snapshot: await buildSnapshot({ probeResult: p }) };
  }

  /**
   * 下发：把领域写进角色装配（`neo role set --domains` 全量并集），随后按
   * 宿主合同 `neo update` 收敛清脏，再刷投影缓存 —— 列表的「被引用角色」
   * 实时更新。远端来源第一次要确认（confirmed=true 再进来一次），确认一次
   * 永久落库；本机/手写来源从不问。
   *
   * @param {{ domain: unknown, roles: unknown, confirmed?: unknown }} payload
   */
  async function dispatch(payload) {
    const p = await probe();
    if (!p.available) throw appError("academy_neo_unavailable", `下发不了：${p.reason ?? "neo 不可用"}`);
    const record = /** @type {Record<string, unknown>} */ (payload ?? {});
    const domain = typeof record.domain === "string" ? record.domain.trim() : "";
    if (!NAME_PATTERN.test(domain)) {
      throw appError("invalid_payload", `领域名 ${JSON.stringify(domain)} 不符合 Neo 的名字规则`);
    }
    const roles = Array.isArray(record.roles) ? record.roles.map((r) => String(r).trim()) : [];
    if (roles.length === 0 || roles.some((r) => !NAME_PATTERN.test(r))) {
      throw appError("invalid_payload", "roles 必须是非空的 Neo 角色名列表");
    }

    const domains = await listDomains();
    if (!domains.some((d) => d.name === domain)) {
      throw appError("academy_unknown_domain", `~/.neo 里没有领域「${domain}」——先在学院里装一个资源进这个领域`);
    }

    // 远端来源首次下发：一次确认，永久落库（验收项）。
    const marks = new Map(store.listAcademyMarks().map((m) => [m.resourceKey, m]));
    const skillNames = await readableChildDirs(path.join(resolveNeoHome({ env }), "library", domain));
    const kinds = skillNames.map((name) => resolveKind(marks, `d:${domain}/${name}`, `d:${domain}`, undefined).kind);
    if (kinds.includes("remote") && marks.get(`d:${domain}`)?.remoteAck !== true) {
      if (record.confirmed !== true) {
        throw appError(
          "academy_remote_unconfirmed",
          `领域「${domain}」里有远端来源的资源：第一次下发需要你确认一次（之后不再询问）。确认请把 confirmed=true 再发一次。`,
        );
      }
      store.ackAcademyRemote(`d:${domain}`);
    }

    const projections = await readNeoRoleProjections(resolveNeoHome({ env }));
    const byKey = new Map(projections.map((projection) => [projection.key, projection]));
    const echoes = [];
    const touched = [];
    try {
      for (const role of roles) {
        const projection = byKey.get(role);
        if (!projection) {
          throw appError(
            "academy_unknown_role",
            `角色「${role}」不在 ~/.neo 里，下发只认 Neo 角色（预设角色还没迁进 Neo 之前不能下发）`,
          );
        }
        const current = projection.domains ?? [];
        if (current.includes(domain)) {
          echoes.push(`${role}：已声明领域「${domain}」，跳过`);
          continue;
        }
        const next = [...current, domain];
        await neo(["role", "set", role, "--domains", next.join(","), "--json"]);
        echoes.push(`${role}：写入 domains [${next.join(", ")}]（锁已标脏，正在收敛）`);
        touched.push(role);
      }

      // 宿主合同：角色写 → update/use 清脏（materialize 永不清脏）。失败不吞
      // 已完成的写入 —— 回显里点名，status 会把 lock-dirty 报出来。
      for (const role of touched) {
        try {
          const { stdout } = await neo(["update", "--role", role], 120_000);
          const line = stdout.trim().split(/\r?\n/).filter((l) => l.trim().length > 0).join(" / ");
          echoes.push(`${role}：收敛完成${line.length > 0 ? `（${line}）` : ""}`);
        } catch (err) {
          echoes.push(`${role}：收敛失败（锁可能仍脏，neo status 会报 lock-dirty）：${errMessage(err)}`);
        }
      }
    } finally {
      await refreshProjection();
    }
    return { ok: /** @type {const} */ (true), echo: echoes.join("\n"), snapshot: await buildSnapshot({ probeResult: p }) };
  }

  return {
    probe,
    snapshot: () => buildSnapshot(),
    install,
    dispatch,
  };
}
