import React, { useEffect, useRef, useState } from "react";
import { tokenText } from "./scene/tokenReadout.js";

/**
 * 公司 · 项目组切换器（票 08 起收进左轨）：Lists and "create" live in
 * dropdown panels — the office canvas stays untouched. 公司列表带各公司
 * 活跃数（进行中/待验收，来自 office.get 快照里的 taskCounts 聚合）。
 *
 * @param {{
 *   snapshot: import("./App.jsx").OfficeSnapshotData | null,
 *   onChanged: () => Promise<void> | void,
 * }} props
 */
export function Switcher({ snapshot, onChanged }) {
  const [openPanel, setOpenPanel] = useState(/** @type {"company" | "group" | null} */ (null));
  const [companyName, setCompanyName] = useState("");
  const [groupName, setGroupName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(/** @type {string | null} */ (null));
  const zoneRef = useRef(/** @type {HTMLDivElement | null} */ (null));

  const companies = snapshot?.companies ?? [];
  const groups = snapshot?.groups ?? [];
  const activeCompany = companies.find((c) => c.id === snapshot?.activeCompanyId);
  const activeGroup = groups.find((g) => g.id === snapshot?.activeGroupId);

  useEffect(() => {
    if (!openPanel) return;
    const onDown = (/** @type {MouseEvent} */ event) => {
      if (zoneRef.current && !zoneRef.current.contains(/** @type {Node} */ (event.target))) setOpenPanel(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [openPanel]);

  /** @param {() => Promise<unknown>} action */
  async function run(action) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await onChanged();
    } catch (err) {
      setError(/** @type {Error} */ (err).message ?? String(err));
    } finally {
      setBusy(false);
    }
  }

  /** @param {number} companyId */
  const pickCompany = (companyId) =>
    run(() => window.cubicle.invoke("office.setActive", { companyId }));

  /**
   * @param {number} companyId
   * @param {number} groupId
   */
  const pickGroup = (companyId, groupId) =>
    run(() => window.cubicle.invoke("office.setActive", { companyId, groupId }));

  return (
    <div className="switcher" ref={zoneRef}>
      <div className="switcher-bar">
        <button
          type="button"
          className="switcher-trigger"
          data-testid="company-switcher"
          aria-expanded={openPanel === "company"}
          onClick={() => setOpenPanel((p) => (p === "company" ? null : "company"))}
        >
          <span className="switcher-value" data-testid="company-name">
            {activeCompany?.name ?? "未选择公司"}
          </span>
          <span className="switcher-caret">▾</span>
        </button>
        <span className="dot-sep">·</span>
        <button
          type="button"
          className="switcher-trigger"
          data-testid="group-switcher"
          aria-expanded={openPanel === "group"}
          onClick={() => setOpenPanel((p) => (p === "group" ? null : "group"))}
        >
          <span className="switcher-value" data-testid="group-name">
            {activeGroup?.name ?? "暂无项目组"}
          </span>
          <span className="switcher-caret">▾</span>
        </button>
      </div>

      {openPanel === "company" ? (
        <div className="switcher-panel" data-testid="company-panel">
          <div className="switcher-panel-title">公司</div>
          <div className="switcher-options">
            {companies.map((company) => {
              const counts = snapshot?.taskCounts?.[String(company.id)];
              return (
                <button
                  key={company.id}
                  type="button"
                  data-testid="company-item"
                  data-running={String(counts?.running ?? 0)}
                  data-review={String(counts?.review ?? 0)}
                  className={company.id === snapshot?.activeCompanyId ? "active" : ""}
                  disabled={busy}
                  onClick={() => {
                    setOpenPanel(null);
                    void pickCompany(company.id);
                  }}
                >
                  {company.name}
                  <span className="switcher-active-count" data-testid="company-active">
                    进行中 {counts?.running ?? 0} · 待验收 {counts?.review ?? 0}
                  </span>
                  {/* 票 12 验收 3: 公司级 token 聚合（host 聚合走信封；未计量不是 0） */}
                  <span
                    className="switcher-token-count"
                    data-testid="company-tokens"
                    data-measured={snapshot?.companyTokens?.[String(company.id)]?.measured === true ? "true" : "false"}
                  >
                    tokens {tokenText(snapshot?.companyTokens?.[String(company.id)])}
                  </span>
                </button>
              );
            })}
          </div>
          <form
            className="switcher-form"
            onSubmit={(event) => {
              event.preventDefault();
              const name = companyName.trim();
              if (!name || busy) return;
              void run(async () => {
                await window.cubicle.invoke("company.create", { name });
                setCompanyName("");
                setOpenPanel(null);
              });
            }}
          >
            <input
              data-testid="company-name-input"
              placeholder="新公司名字"
              value={companyName}
              onChange={(event) => setCompanyName(event.target.value)}
            />
            <button data-testid="company-create" type="submit" disabled={busy}>
              新建公司
            </button>
          </form>
        </div>
      ) : null}

      {openPanel === "group" ? (
        <div className="switcher-panel" data-testid="group-panel">
          <div className="switcher-panel-title">项目组（自动配 4 个工位）</div>
          <div className="switcher-options">
            {groups.length === 0 ? <div className="switcher-empty">这家公司还没有项目组</div> : null}
            {groups.map((group) => (
              <button
                key={group.id}
                type="button"
                data-testid="group-item"
                className={group.id === snapshot?.activeGroupId ? "active" : ""}
                disabled={busy}
                onClick={() => {
                  setOpenPanel(null);
                  void pickGroup(group.companyId, group.id);
                }}
              >
                {group.name}
              </button>
            ))}
          </div>
          <form
            className="switcher-form"
            onSubmit={(event) => {
              event.preventDefault();
              const name = groupName.trim();
              const companyId = snapshot?.activeCompanyId;
              if (!name || busy || !companyId) return;
              void run(async () => {
                await window.cubicle.invoke("projectGroup.create", { companyId, name });
                setGroupName("");
                setOpenPanel(null);
              });
            }}
          >
            <input
              data-testid="group-name-input"
              placeholder="新项目组名字"
              value={groupName}
              onChange={(event) => setGroupName(event.target.value)}
            />
            <button data-testid="group-create" type="submit" disabled={busy}>
              新建项目组
            </button>
          </form>
          <div className="switcher-hint">新项目组建好后办公室会直接切过去。</div>
        </div>
      ) : null}

      {error ? <div className="switcher-error">{error}</div> : null}
    </div>
  );
}

