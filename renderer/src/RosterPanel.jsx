import React from "react";

/**
 * 花名册（票 08 左轨入口）：员工列表浮层 —— 花名 / 角色 / 在岗。
 * 数据就是当前公司画布上看得见的工位与 occupant（快照语义不额外发明：
 * 浮层不改变快照，快照也不因浮层而变）。入口可用即可，招聘仍走工位。
 *
 * @param {{
 *   snapshot: import("./App.jsx").OfficeSnapshotData | null,
 *   onClose: () => void,
 * }} props
 */
export function RosterPanel({ snapshot, onClose }) {
  const desks = snapshot?.desks ?? [];
  const occupants = desks
    .map((desk) => ({ desk, occupant: desk.occupant }))
    .filter((entry) => entry.occupant !== null);
  const emptyDesks = desks.filter((desk) => desk.occupant === null);

  return (
    <aside className="rail-drawer" data-testid="roster-panel">
      <header className="task-header">
        <div className="task-title">花名册</div>
        <button type="button" className="task-close" data-testid="roster-close" onClick={onClose} aria-label="收起花名册">
          ✕
        </button>
      </header>
      <div className="roster-body">
        {occupants.length === 0 ? <div className="task-empty">这家公司还没有员工：点空工位招聘。</div> : null}
        {occupants.map(({ desk, occupant }) => (
          <div key={/** @type {number} */ (occupant?.id)} className="roster-row" data-testid="roster-row" data-seated="true">
            <span className="roster-name" data-testid="roster-name">{occupant?.name}</span>
            <span className="roster-role">{occupant?.roleSnapshot.name}</span>
            <span className="roster-seat">在岗 · {desk.label}</span>
          </div>
        ))}
        {emptyDesks.map((desk) => (
          <div key={desk.id} className="roster-row roster-row-empty" data-testid="roster-row" data-seated="false">
            <span className="roster-name">（空位）</span>
            <span className="roster-seat">{desk.label}</span>
          </div>
        ))}
      </div>
    </aside>
  );
}
