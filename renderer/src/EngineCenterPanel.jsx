import React, { useEffect, useState } from "react";

/**
 * 引擎中心（票 08 外壳）：引擎名 + 配置目录路径（走类型化信封
 * engine.overview）。这里刻意**不做**引擎卡徽章 / 可用性探针 —— 那是票 11
 * 的地盘；留一个插槽（engine-card-slot），票 11 往里面挂卡即可，不动外壳。
 *
 * @param {{ onClose: () => void }} props
 */
export function EngineCenterPanel({ onClose }) {
  const [overview, setOverview] = useState(/** @type {EngineOverviewData | null} */ (null));
  const [error, setError] = useState(/** @type {string | null} */ (null));

  useEffect(() => {
    let alive = true;
    void window.cubicle
      .invoke("engine.overview")
      .then((result) => {
        if (alive) setOverview(/** @type {EngineOverviewData} */ (result));
      })
      .catch((err) => {
        if (alive) setError(/** @type {{ code?: string }} */ (err).code ?? "engine_overview_failed");
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <aside className="rail-drawer" data-testid="engine-panel">
      <header className="task-header">
        <div className="task-title">引擎中心</div>
        <button type="button" className="task-close" data-testid="engine-close" onClick={onClose} aria-label="收起引擎中心">
          ✕
        </button>
      </header>
      <div className="engine-body">
        {error ? <div className="task-note" data-testid="engine-error">{`没能读到引擎清单：${error}`}</div> : null}
        {!overview && !error ? <div className="task-empty">正在查询引擎清单…</div> : null}
        {overview?.engines.map((engine) => (
          <div key={engine.name} className="engine-item" data-testid="engine-item" data-engine={engine.name}>
            <div className="engine-name">{engine.name}</div>
            <div className="engine-config">
              配置目录 <code data-testid="engine-config-dir">{engine.configDir}</code>
            </div>
            {/* 票 11 插槽：引擎卡徽章 / 可用性探针挂这里，外壳不再长大。 */}
            <div className="engine-card-slot" data-testid="engine-card-slot">
              引擎卡与可用性探针 · 票 11 地盘
            </div>
          </div>
        ))}
        {overview && overview.engines.length === 0 ? (
          <div className="task-empty">还没有引擎：预设角色都带引擎，招一名员工就会出现在这里。</div>
        ) : null}
        {overview ? <div className="engine-data-dir">数据目录 <code>{overview.dataDir}</code></div> : null}
      </div>
    </aside>
  );
}

/**
 * Renderer mirror of the host engine.overview payload (process boundary).
 * @typedef {{ engines: { name: string, configDir: string }[], dataDir: string }} EngineOverviewData
 */
