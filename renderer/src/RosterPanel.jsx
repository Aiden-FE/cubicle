import React, { useCallback, useEffect, useState } from "react";
import { useDialog } from "./useDialog.js";

const DOMAIN_TOPIC = "domain.changed";

/**
 * 花名册（票 08 左轨入口）：公司全量员工，不只当前项目组 —— 切换项目组
 * 不该让其他组的同事从花名册里消失。招聘仍走工位；这里只读。
 *
 * @param {{
 *   snapshot: import("./App.jsx").OfficeSnapshotData | null,
 *   onClose: () => void,
 *   onEditEmployee?: (employee: import("./App.jsx").RosterEmployeeData) => void,
 * }} props
 */
export function RosterPanel({ snapshot, onClose, onEditEmployee }) {
  const companyId = snapshot?.activeCompanyId ?? null;
  const [employees, setEmployees] = useState(/** @type {import("./App.jsx").RosterEmployeeData[]} */ ([]));
  const [error, setError] = useState(false);
  const dialogRef = useDialog(onClose);

  const load = useCallback(async () => {
    if (companyId === null) return;
    try {
      const result = /** @type {{ employees: typeof employees }} */ (
        await window.cubicle.invoke("employee.list", { companyId })
      );
      setEmployees(result.employees);
      setError(false);
    } catch {
      setError(true);
    }
  }, [companyId]);

  useEffect(() => {
    void load();
    const unsubscribe = window.cubicle.subscribe(DOMAIN_TOPIC, (envelope) => {
      const reason = /** @type {{ reason?: string }} */ (envelope.payload ?? {}).reason ?? "";
      if (reason.startsWith("employee.") || reason === "office.setActive") void load();
    });
    return unsubscribe;
  }, [load]);

  return (
    <aside className="rail-drawer" data-testid="roster-panel" ref={dialogRef} role="dialog" aria-modal="true" aria-label="花名册" tabIndex={-1}>
      <header className="task-header">
        <div className="task-title">花名册</div>
        <button type="button" className="task-close" data-testid="roster-close" onClick={onClose} aria-label="收起花名册">
          ✕
        </button>
      </header>
      <div className="roster-body">
        {error ? (
          <div className="task-note" data-testid="roster-error">
            花名册加载失败。
            <button type="button" className="task-mini-button" onClick={() => void load()}>重试</button>
          </div>
        ) : null}
        {!error && employees.length === 0 ? <div className="task-empty">这家公司还没有员工：点空工位招聘。</div> : null}
        {employees.map((employee) => (
          <div key={employee.id} className="roster-row" data-testid="roster-row" data-seated="true">
            <span className="roster-name" data-testid="roster-name">{employee.name}</span>
            <span className="roster-role">{employee.roleName}</span>
            <span className="roster-seat">在岗 · {employee.deskLabel} · {employee.groupName}</span>
            {onEditEmployee ? (
              <button
                type="button"
                className="task-mini-button roster-edit"
                data-testid="roster-edit"
                onClick={() => onEditEmployee(employee)}
              >
                编辑
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </aside>
  );
}
