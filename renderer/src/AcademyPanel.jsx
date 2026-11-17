import React, { useCallback, useEffect, useState } from "react";
import { useDialog } from "./useDialog.js";

const DOMAIN_TOPIC = "domain.changed";

/**
 * 票 a03 · 学院浮层：本机级资源库（来自 ~/.neo）的列表 / 装 / 下发。
 * 浮层不挤压主画布（硬约束）：position 走 .academy-panel（.rail-drawer 同族），
 * 画布 office-floor 永远 100%。数据只来自 academy.snapshot（投影缓存 +
 * vendored CLI），不硬编码任何资源。neo 不可用时降级只读并给可读提示。
 */

/**
 * @typedef {object} AcademyRowData
 * @property {string} resourceKey
 * @property {"domain" | "role"} layer
 * @property {string} name
 * @property {string} [domain]
 * @property {string} [role]
 * @property {string[]} domains
 * @property {string | null} hash
 * @property {"local" | "remote" | "written"} kind
 * @property {string | null} source
 * @property {string[]} referencedBy
 * @property {boolean} remoteAck
 */

/**
 * @typedef {object} AcademySnapshot
 * @property {{ available: boolean, version: string | null, reason: string | null }} probe
 * @property {string} neoHome
 * @property {boolean} readOnly
 * @property {{ name: string, skills: number }[]} domains
 * @property {{ key: string, name: string, domains: string[] }[]} neoRoles
 * @property {AcademyRowData[]} rows
 */

const KIND_LABEL = /** @type {const} */ ({
  local: "本机",
  remote: "远端",
  written: "手写",
});

/**
 * @param {{ onClose: () => void }} props
 */
export function AcademyPanel({ onClose }) {
  const dialogRef = useDialog(onClose);
  const [snap, setSnap] = useState(/** @type {AcademySnapshot | null} */ (null));
  const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));
  const [busy, setBusy] = useState(false);
  const [echo, setEcho] = useState(/** @type {{ kind: "ok" | "fail", text: string } | null} */ (null));

  // 装：源字符串 + 目标（领域/角色）+ 可选技能名单（空 = 全部）。
  const [source, setSource] = useState("");
  const [targetKind, setTargetKind] = useState("domain");
  const [targetName, setTargetName] = useState("");
  const [skills, setSkills] = useState("");

  // 下发：挑中的领域行 + 勾选的角色；远端来源未确认时挂起一次确认。
  const [dispatching, setDispatching] = useState(
    /** @type {{ domain: string, roles: string[], pendingConfirm: boolean } | null} */ (null),
  );

  const load = useCallback(async () => {
    try {
      setSnap(/** @type {AcademySnapshot} */ (await window.cubicle.invoke("academy.snapshot")));
      setLoadError(null);
    } catch (err) {
      setLoadError(/** @type {{ message?: string }} */ (err).message ?? String(err));
    }
  }, []);

  useEffect(() => {
    void load();
    const unsubscribe = window.cubicle.subscribe(DOMAIN_TOPIC, () => {
      // 学院下发会刷投影缓存（role 行跟着变）；任何 domain.changed 都让列表重读，
      // 「被引用角色」才真正实时。
      void load();
    });
    return unsubscribe;
  }, [load]);

  const readOnly = snap?.readOnly === true;

  async function doInstall() {
    setBusy(true);
    try {
      const out = /** @type {{ echo: string }} */ (
        await window.cubicle.invoke(
          "academy.install",
          {
            source,
            target: targetKind,
            targetName,
            ...(skills.trim().length > 0 ? { skills: skills.trim() } : {}),
          },
          // 装要走 vendored CLI + 上游 npx（可能联网）：放宽这一发的桥超时。
          { timeoutMs: 200_000 },
        )
      );
      setEcho({ kind: "ok", text: out.echo.length > 0 ? out.echo : "装好了。" });
      setSource("");
      setSkills("");
    } catch (err) {
      const e = /** @type {{ code?: string, message?: string }} */ (err);
      setEcho({ kind: "fail", text: e.message ?? String(err) });
    } finally {
      setBusy(false);
      void load();
    }
  }

  /** @param {string} domain @param {string[]} roles @param {boolean} confirmed */
  async function doDispatch(domain, roles, confirmed) {
    if (roles.length === 0) {
      setEcho({ kind: "fail", text: "先勾选至少一个要下发的角色。" });
      return;
    }
    setBusy(true);
    try {
      const out = /** @type {{ echo: string }} */ (
        await window.cubicle.invoke(
          "academy.dispatch",
          {
            domain,
            roles,
            ...(confirmed ? { confirmed: true } : {}),
          },
          // 下发 = role set + 每角色 update 收敛（可能联网拉源）：放宽这一发。
          { timeoutMs: 200_000 },
        )
      );
      setEcho({ kind: "ok", text: out.echo.length > 0 ? out.echo : "下发完成。" });
      setDispatching(null);
    } catch (err) {
      const e = /** @type {{ code?: string, message?: string }} */ (err);
      setEcho({ kind: "fail", text: e.message ?? String(err) });
      if (e.code === "academy_remote_unconfirmed") {
        setDispatching((prev) => (prev ? { ...prev, pendingConfirm: true } : prev));
      }
    } finally {
      setBusy(false);
      void load();
    }
  }

  /** @param {string} domain */
  function openDispatch(domain) {
    setDispatching({ domain, roles: [], pendingConfirm: false });
    setEcho(null);
  }

  /** @param {string} roleKey */
  function toggleDispatchRole(roleKey) {
    setDispatching((prev) =>
      prev
        ? {
            ...prev,
            roles: prev.roles.includes(roleKey) ? prev.roles.filter((k) => k !== roleKey) : [...prev.roles, roleKey],
          }
        : prev,
    );
  }

  return (
    <aside
      className="rail-drawer academy-panel"
      data-testid="academy-panel"
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label="学院"
      tabIndex={-1}
    >
      <header className="task-header">
        <div className="task-title">学院</div>
        <button type="button" className="task-close" data-testid="academy-close" onClick={onClose} aria-label="收起学院">
          ✕
        </button>
      </header>

      {loadError ? (
        <div className="task-note" data-testid="academy-error">
          学院加载失败：{loadError}
          <button type="button" className="task-mini-button" onClick={() => void load()}>重试</button>
        </div>
      ) : null}

      {snap?.readOnly ? (
        <div className="academy-degraded" data-testid="academy-degraded">
          neo 不可用，学院已降级为只读：{snap.probe.reason}
        </div>
      ) : null}

      {!readOnly ? (
        <section className="academy-install" aria-label="装">
          <div className="academy-section-title">装（neo add）</div>
          <input
            className="academy-input academy-source"
            data-testid="academy-source"
            placeholder="源：本机目录绝对路径 / git 仓库…"
            value={source}
            onChange={(e) => setSource(e.target.value)}
          />
          <div className="academy-install-row">
            <select
              className="academy-input"
              data-testid="academy-target-kind"
              value={targetKind}
              onChange={(e) => setTargetKind(e.target.value)}
            >
              <option value="domain">装进领域</option>
              <option value="role">装进角色</option>
            </select>
            <input
              className="academy-input"
              data-testid="academy-target-name"
              placeholder="名字（小写字母/数字/连字符）"
              value={targetName}
              onChange={(e) => setTargetName(e.target.value)}
            />
            <input
              className="academy-input"
              data-testid="academy-skills"
              placeholder="技能（留空 = 全部）"
              value={skills}
              onChange={(e) => setSkills(e.target.value)}
            />
            <button
              type="button"
              className="task-mini-button"
              data-testid="academy-install"
              disabled={busy || source.trim().length === 0 || targetName.trim().length === 0}
              onClick={() => void doInstall()}
            >
              装
            </button>
          </div>
        </section>
      ) : null}

      {echo ? (
        <div className={`academy-echo academy-echo-${echo.kind}`} data-testid="academy-echo" data-kind={echo.kind}>
          <pre>{echo.text}</pre>
        </div>
      ) : null}

      {snap && snap.rows.length === 0 ? (
        <div className="task-empty" data-testid="academy-empty">
          学院是空的：~/.neo 里还没有资源。{readOnly ? "（neo 恢复后可装/下发）" : "在上方「装」一个试试。"}
          <div className="academy-home">{snap.neoHome}</div>
        </div>
      ) : null}

      {snap && snap.rows.length > 0 ? (
        <div className="academy-table" role="table">
          <div className="academy-row academy-row-head" role="row">
            <span>名称</span>
            <span>领域</span>
            <span>来源</span>
            <span>哈希</span>
            <span>被引用角色</span>
            <span></span>
          </div>
          {snap.rows.map((row) => (
            <div
              className="academy-row"
              role="row"
              key={row.resourceKey}
              data-testid="academy-row"
              data-resource-key={row.resourceKey}
              data-layer={row.layer}
              data-kind={row.kind}
            >
              <span data-testid="academy-row-name" title={row.role ? `角色层：${row.role}` : ""}>{row.name}</span>
              <span data-testid="academy-row-domain">{row.layer === "domain" ? row.domain : (row.domains.join(", ") || "—")}</span>
              <span data-testid="academy-row-kind" title={row.source ?? ""}>{KIND_LABEL[row.kind]}</span>
              <span data-testid="academy-row-hash" title={row.hash ?? ""}>{row.hash ? row.hash.slice(0, 8) : "—"}</span>
              <span data-testid="academy-row-ref">{row.referencedBy.length > 0 ? row.referencedBy.join(", ") : "—"}</span>
              <span>
                {row.layer === "domain" && !readOnly ? (
                  <button
                    type="button"
                    className="task-mini-button"
                    data-testid="academy-dispatch"
                    data-domain={row.domain}
                    disabled={busy}
                    onClick={() => openDispatch(/** @type {string} */ (row.domain))}
                  >
                    下发
                  </button>
                ) : null}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {dispatching ? (
        <section className="academy-dispatch" aria-label="下发">
          <div className="academy-section-title">把领域「{dispatching.domain}」下发给角色（neo role set → update 收敛）</div>
          {snap?.neoRoles.length === 0 ? <div className="task-empty">~/.neo 里还没有可下发的角色。</div> : null}
          {(snap?.neoRoles ?? []).map((role) => (
            <label className="academy-role-pick" key={role.key}>
              <input
                type="checkbox"
                data-testid="academy-role-pick"
                data-role={role.key}
                checked={dispatching.roles.includes(role.key)}
                onChange={() => toggleDispatchRole(role.key)}
              />
              {role.name}
              {role.domains.includes(dispatching.domain) ? <em>（已声明）</em> : null}
            </label>
          ))}
          {dispatching.pendingConfirm ? (
            <div className="academy-confirm" data-testid="academy-confirm-note">
              这个领域里有远端来源的资源：第一次下发需要你确认一次（之后不再打扰）。
            </div>
          ) : null}
          <div className="academy-install-row">
            <button
              type="button"
              className="task-mini-button"
              data-testid={dispatching.pendingConfirm ? "academy-confirm" : "academy-dispatch-confirm"}
              disabled={busy}
              onClick={() =>
                void doDispatch(dispatching.domain, dispatching.roles, dispatching.pendingConfirm)
              }
            >
              {dispatching.pendingConfirm ? "确认远端来源并下发" : "下发"}
            </button>
            <button type="button" className="task-mini-button" data-testid="academy-dispatch-cancel" onClick={() => setDispatching(null)}>
              取消
            </button>
          </div>
        </section>
      ) : null}
    </aside>
  );
}
