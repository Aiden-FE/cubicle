import React, { useState } from "react";

/**
 * Left-rail floating panel: companies and project groups live here — never on
 * the office canvas itself.
 *
 * @param {{
 *   snapshot: import("./App.jsx").OfficeSnapshotData | null,
 *   onChanged: () => Promise<void> | void,
 * }} props
 */
export function RailPanel({ snapshot, onChanged }) {
  const [companyName, setCompanyName] = useState("");
  const [groupCompanyId, setGroupCompanyId] = useState(/** @type {number | null} */ (null));
  const [groupName, setGroupName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(/** @type {string | null} */ (null));

  const companies = snapshot?.companies ?? [];
  const groups = snapshot?.groups ?? [];
  const targetCompanyId = groupCompanyId ?? snapshot?.activeCompanyId ?? companies[0]?.id ?? 0;

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

  return (
    <aside className="rail-panel">
      <div className="rail-title">公司 / 项目组</div>

      <section className="rail-section">
        <div className="rail-section-title">公司</div>
        <ul className="rail-list">
          {companies.map((company) => (
            <li key={company.id} data-testid="company-item" className={company.id === snapshot?.activeCompanyId ? "active" : ""}>
              {company.name}
            </li>
          ))}
        </ul>
        <form
          className="rail-form"
          onSubmit={(event) => {
            event.preventDefault();
            const name = companyName.trim();
            if (!name || busy) return;
            void run(async () => {
              await window.cubicle.invoke("company.create", { name });
              setCompanyName("");
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
            建公司
          </button>
        </form>
      </section>

      <section className="rail-section">
        <div className="rail-section-title">项目组（挂在一家公司下 · 自动配 4 个工位）</div>
        <ul className="rail-list">
          {groups.map((group) => (
            <li key={group.id} data-testid="group-item" className={group.id === snapshot?.activeGroupId ? "active" : ""}>
              {group.name}
            </li>
          ))}
        </ul>
        <form
          className="rail-form"
          onSubmit={(event) => {
            event.preventDefault();
            const name = groupName.trim();
            if (!name || busy || !targetCompanyId) return;
            void run(async () => {
              await window.cubicle.invoke("projectGroup.create", { companyId: targetCompanyId, name });
              setGroupName("");
            });
          }}
        >
          <select data-testid="group-company-select" value={targetCompanyId} onChange={(event) => setGroupCompanyId(Number(event.target.value))}>
            {companies.map((company) => (
              <option key={company.id} value={company.id}>
                {company.name}
              </option>
            ))}
          </select>
          <input
            data-testid="group-name-input"
            placeholder="新项目组名字"
            value={groupName}
            onChange={(event) => setGroupName(event.target.value)}
          />
          <button data-testid="group-create" type="submit" disabled={busy}>
            建项目组
          </button>
          <div className="rail-hint">先在上边建（或选中）一家公司，项目组会建进这家公司的下拉里。</div>
        </form>
      </section>

      {error ? <div className="rail-error">{error}</div> : null}
    </aside>
  );
}
