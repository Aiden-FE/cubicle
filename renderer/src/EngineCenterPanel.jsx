import React, { useCallback, useEffect, useState } from "react";
import { useDialog } from "./useDialog.js";

// Topic name mirrored from src/shared/envelope.mjs TOPICS (process boundary).
const DOMAIN_TOPIC = "domain.changed";

const VERDICT_LABELS = /** @type {Record<string, string>} */ ({
  injection: "注入生效",
  tools: "工具可见",
  refusal: "拒绝可见",
  events: "事件完整",
});

const BADGE_LABELS = /** @type {Record<string, string>} */ ({
  logged_in: "已配置",
  needs_key: "待配 key",
  not_installed: "未装",
});

/**
 * 引擎中心（票 08 外壳 + 票 11 引擎卡）：引擎清单、徽章、四验结论、
 * 探针/带风险启用、BYOK 配置目录与示例提示。切换引擎仍在员工对话里
 * （需要具体 employeeId）；这里负责「引擎能不能用」。
 *
 * @param {{ onClose: () => void }} props
 */
export function EngineCenterPanel({ onClose }) {
  const [engines, setEngines] = useState(/** @type {EngineStateData[] | null} */ (null));
  const [configDirs, setConfigDirs] = useState(/** @type {Record<string, string>} */ ({}));
  const [error, setError] = useState(/** @type {string | null} */ (null));
  const [note, setNote] = useState(/** @type {string | null} */ (null));
  const [busyEngine, setBusyEngine] = useState(/** @type {string | null} */ (null));
  const dialogRef = useDialog(onClose);

  const load = useCallback(async () => {
    try {
      const [list, overview] = await Promise.all([
        window.cubicle.invoke("engine.list"),
        window.cubicle.invoke("engine.overview").catch(() => null),
      ]);
      setEngines(/** @type {{ engines: EngineStateData[] }} */ (list).engines);
      const dirs = /** @type {Record<string, string>} */ ({});
      for (const engine of /** @type {any} */ (overview)?.engines ?? []) dirs[engine.name] = engine.configDir;
      setConfigDirs(dirs);
      setError(null);
    } catch (err) {
      setError(/** @type {{ code?: string }} */ (err).code ?? "engine_overview_failed");
    }
  }, []);

  useEffect(() => {
    void load();
    const unsubscribe = window.cubicle.subscribe(DOMAIN_TOPIC, (envelope) => {
      const reason = /** @type {{ reason?: string }} */ (envelope.payload ?? {}).reason ?? "";
      if (reason.startsWith("engine.")) void load();
    });
    return unsubscribe;
  }, [load]);

  const runProbe = async (/** @type {string} */ engine) => {
    setNote(null);
    setBusyEngine(engine);
    try {
      await window.cubicle.invoke("engine.probe", { engine });
      setNote(`${engine} 的探针已启动，结果会写回这张卡。`);
      await load();
    } catch (err) {
      setNote(`探针没能启动：${/** @type {{ code?: string }} */ (err).code ?? "unknown"}`);
    } finally {
      setBusyEngine(null);
    }
  };

  const enableRisk = async (/** @type {string} */ engine) => {
    setNote(null);
    setBusyEngine(engine);
    try {
      await window.cubicle.invoke("engine.enable", { engine, manualOverride: true });
      await load();
    } catch (err) {
      setNote(`启用失败：${/** @type {{ code?: string }} */ (err).code ?? "unknown"}`);
    } finally {
      setBusyEngine(null);
    }
  };

  return (
    <aside className="rail-drawer" data-testid="engine-panel" ref={dialogRef} role="dialog" aria-modal="true" aria-label="引擎中心" tabIndex={-1}>
      <header className="task-header">
        <div className="task-title">引擎中心</div>
        <button type="button" className="task-close" data-testid="engine-close" onClick={onClose} aria-label="收起引擎中心">
          ✕
        </button>
      </header>
      <div className="engine-body">
        {error ? <div className="task-note" data-testid="engine-error">{`没能读到引擎清单：${error}`}</div> : null}
        {!engines && !error ? <div className="task-empty">正在查询引擎清单…</div> : null}
        <div className="engine-list" data-testid="engine-card-slot">
        {(engines ?? []).map((engine) => (
          <div key={engine.engine} className="engine-item" data-testid="engine-item" data-engine={engine.engine}>
            <div className="engine-head">
              <span className="engine-name">{engine.engine}</span>
              <span className={`engine-badge badge-${engine.badge}`} data-testid="engine-badge" data-badge={engine.badge}>
                {BADGE_LABELS[engine.badge] ?? engine.badge}
              </span>
              {engine.version ? <span className="engine-version">{engine.version}</span> : null}
              {engine.enabled ? <span className="engine-admitted">已准入</span> : <span className="engine-unadmitted">未准入</span>}
              {engine.manualOverride && engine.probeStatus !== "passed" ? (
                <span className="engine-risk" data-testid="engine-risk-flag" data-risk="true">⚠ 带风险启用</span>
              ) : null}
            </div>
            <div className="engine-probe" data-testid="engine-probe-status" data-status={engine.probeStatus}>
              <span className="engine-probe-title">准入探针：{probeStatusLabel(engine.probeStatus)}</span>
              {engine.probe?.verdicts ? (
                <span className="engine-verdicts">
                  {Object.entries(VERDICT_LABELS).map(([key, label]) => {
                    const verdict = /** @type {Record<string, { result: string, detail: string }>} */ (engine.probe?.verdicts)[key];
                    if (!verdict) return null;
                    return (
                      <span key={key} className={`engine-verdict verdict-${verdict.result}`} title={verdict.detail}>
                        {verdict.result === "pass" ? "✓" : "✗"} {label}
                      </span>
                    );
                  })}
                </span>
              ) : null}
              {engine.probe?.error ? <span className="engine-probe-error" title={engine.probe.error}>{engine.probe.error}</span> : null}
            </div>
            {configDirs[engine.engine] ? (
              <div className="engine-config">配置目录 <code data-testid="engine-config-dir">{configDirs[engine.engine]}</code></div>
            ) : null}
            <div className="engine-actions">
              <button
                type="button"
                className="engine-btn"
                data-testid={`engine-probe-${engine.engine}`}
                disabled={busyEngine === engine.engine}
                onClick={() => void runProbe(engine.engine)}
              >
                {busyEngine === engine.engine ? "启动中…" : "跑探针"}
              </button>
              <button
                type="button"
                className="engine-btn"
                data-testid={`engine-open-dir-${engine.engine}`}
                onClick={() => {
                  void window.cubicle.openEngineDir(engine.engine).then((message) => {
                    if (message) setNote(`打开配置目录失败：${message}`);
                  });
                }}
              >
                打开配置目录
              </button>
              {!engine.enabled && engine.probeStatus === "failed" ? (
                <button
                  type="button"
                  className="engine-btn engine-btn-risk"
                  data-testid={`engine-enable-risk-${engine.engine}`}
                  disabled={busyEngine === engine.engine}
                  onClick={() => void enableRisk(engine.engine)}
                >
                  带风险启用
                </button>
              ) : null}
            </div>
          </div>
        ))}
        </div>
        <div className="engine-config-note">
          BYOK：把 <code>models.json</code>（<code>baseUrl</code> / <code>apiKey</code> / <code>model</code>）放进对应引擎的配置目录。
          切换员工引擎请到员工的对话浮层。
        </div>
        {note ? <div className="task-note task-note-ok" data-testid="engine-note">{note}</div> : null}
      </div>
    </aside>
  );
}

/** @param {string} status */
function probeStatusLabel(status) {
  if (status === "passed") return "已通过";
  if (status === "failed") return "未通过";
  if (status === "running") return "运行中…";
  return "未跑";
}

/**
 * @typedef {object} EngineStateData
 * @property {string} engine
 * @property {boolean} enabled
 * @property {boolean} manualOverride
 * @property {boolean | null} installed
 * @property {string | null} version
 * @property {"unprobed" | "running" | "passed" | "failed"} probeStatus
 * @property {{ verdicts?: Record<string, { result: string, detail: string }>, error?: string } | null} probe
 * @property {"logged_in" | "needs_key" | "not_installed"} badge
 */
