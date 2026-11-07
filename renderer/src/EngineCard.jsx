import React, { useCallback, useEffect, useState } from "react";

// Topic name mirrored from src/shared/envelope.mjs TOPICS (process boundary).
const DOMAIN_TOPIC = "domain.changed";

/** 四验的人类可读名（探针结论写进引擎卡） */
const VERDICT_LABELS = {
  injection: "注入生效",
  tools: "工具可见",
  refusal: "拒绝可见",
  events: "事件完整",
};

const BADGE_LABELS = {
  logged_in: "已登录",
  needs_key: "待配 key",
  not_installed: "未装",
};

/**
 * Engine card (ticket 11): the CURRENT engine shows its badge (已登录 /
 * 待配 key / 未装) + the four probe verdicts; a failed/skipped probe that was
 * hand-enabled carries a visible 风险 flag; an uninstalled engine shows an
 * install guide. Other engines offer 切换 / 跑探针 / 带风险启用.
 *
 * @param {{ employee: import("./App.jsx").DeskOccupantData }} props
 */
export function EngineCard({ employee }) {
  const [engines, setEngines] = useState(/** @type {EngineStateData[] | null} */ (null));
  const [note, setNote] = useState(/** @type {string | null} */ (null));

  const load = useCallback(async () => {
    try {
      const result = /** @type {{ engines: EngineStateData[] }} */ (await window.cubicle.invoke("engine.list"));
      setEngines(result.engines);
    } catch {
      // keep the last snapshot
    }
  }, []);

  useEffect(() => {
    void load();
    // Probe completion / enable / detection all announce on domain.changed.
    const unsubscribe = window.cubicle.subscribe(DOMAIN_TOPIC, (envelope) => {
      const reason = String(/** @type {{ reason?: string }} */ (envelope.payload ?? {}).reason ?? "");
      if (reason.startsWith("engine.")) void load();
    });
    return unsubscribe;
  }, [load]);

  const currentEngine = employee.roleSnapshot.manifest.engine;
  const current = engines?.find((e) => e.engine === currentEngine) ?? null;
  const others = (engines ?? []).filter((e) => e.engine !== currentEngine);

  /** @param {string} engine */
  const runProbe = async (engine) => {
    setNote(null);
    try {
      await window.cubicle.invoke("engine.probe", { engine });
      void load();
    } catch (err) {
      setNote(errText(err, "探针没能启动"));
    }
  };

  /** @param {string} engine */
  const enableRisk = async (engine) => {
    setNote(null);
    try {
      await window.cubicle.invoke("engine.enable", { engine, manualOverride: true });
      void load();
    } catch (err) {
      setNote(errText(err, "启用失败"));
    }
  };

  /** @param {string} engine */
  const switchTo = async (engine) => {
    setNote(null);
    try {
      await window.cubicle.invoke("employee.setEngine", { employeeId: employee.id, engine });
      void load();
    } catch (err) {
      setNote(errText(err, "切换失败"));
    }
  };

  return (
    <div className="engine-card" data-testid="engine-card" data-current-engine={currentEngine}>
      {current ? (
        <div className="engine-current" data-testid="engine-current" data-engine={current.engine} data-badge={current.badge}>
          <div className="engine-head">
            <span className="engine-name">{current.engine}</span>
            <span className={`engine-badge badge-${current.badge}`} data-testid="engine-badge" data-badge={current.badge}>
              {BADGE_LABELS[current.badge] ?? current.badge}
            </span>
            {current.version ? <span className="engine-version">{current.version}</span> : null}
            {current.manualOverride && current.probeStatus !== "passed" ? (
              <span className="engine-risk" data-testid="engine-risk-flag" data-risk="true">
                ⚠ 带风险启用（探针未通过）
              </span>
            ) : null}
            {current.enabled ? <span className="engine-admitted" data-testid="engine-admitted">已准入</span> : <span className="engine-unadmitted" data-testid="engine-unadmitted">未准入</span>}
          </div>

          {current.badge === "not_installed" && current.installGuide ? (
            <div className="engine-guide" data-testid="engine-install-guide" data-engine={current.engine}>
              {current.installGuide}
            </div>
          ) : null}

          <div className="engine-probe" data-testid="engine-probe-status" data-status={current.probeStatus}>
            <span className="engine-probe-title">准入探针：{probeStatusLabel(current.probeStatus)}</span>
            {(() => {
              const verdicts = current.probe?.verdicts;
              if (!verdicts) return null;
              return (
                <div className="engine-verdicts">
                  {Object.entries(VERDICT_LABELS).map(([key, label]) => {
                    const verdict = /** @type {Record<string, { result: string; detail: string }>} */ (verdicts)[key];
                    if (!verdict) return null;
                    return (
                      <span
                        key={key}
                        className={`engine-verdict verdict-${verdict.result}`}
                        data-testid="engine-probe-verdict"
                        data-verdict={key}
                        data-result={verdict.result}
                        title={verdict.detail}
                      >
                        {verdict.result === "pass" ? "✓" : "✗"} {label}
                      </span>
                    );
                  })}
                </div>
              );
            })()}
          </div>

          <div className="engine-actions">
            <button type="button" className="engine-btn" data-testid="engine-probe-run" data-engine={current.engine} onClick={() => void runProbe(current.engine)}>
              重跑探针
            </button>
          </div>
        </div>
      ) : null}

      {others.map((engine) => (
        <div key={engine.engine} className="engine-alt" data-testid="engine-alt" data-engine={engine.engine} data-badge={engine.badge}>
          <span className="engine-name">{engine.engine}</span>
          <span className={`engine-badge badge-${engine.badge}`} data-testid="engine-badge" data-badge={engine.badge}>
            {BADGE_LABELS[engine.badge] ?? engine.badge}
          </span>
          {engine.badge === "not_installed" && engine.installGuide ? (
            <span className="engine-guide" data-testid="engine-install-guide" data-engine={engine.engine}>
              {engine.installGuide}
            </span>
          ) : null}
          {engine.manualOverride && engine.probeStatus !== "passed" ? (
            <span className="engine-risk" data-testid="engine-risk-flag" data-risk="true">
              ⚠ 带风险启用（探针未通过）
            </span>
          ) : null}
          <div className="engine-actions">
            {engine.enabled ? (
              <button type="button" className="engine-btn" data-testid={`engine-switch-${engine.engine}`} onClick={() => void switchTo(engine.engine)}>
                切到此引擎
              </button>
            ) : (
              <button type="button" className="engine-btn" data-testid={`engine-probe-${engine.engine}`} onClick={() => void runProbe(engine.engine)}>
                跑探针
              </button>
            )}
            {!engine.enabled && engine.probeStatus === "failed" ? (
              <button type="button" className="engine-btn engine-btn-risk" data-testid={`engine-enable-risk-${engine.engine}`} onClick={() => void enableRisk(engine.engine)}>
                带风险启用
              </button>
            ) : null}
          </div>
        </div>
      ))}

      {note ? (
        <div className="engine-note" data-testid="engine-note">
          {note}
        </div>
      ) : null}
    </div>
  );
}

/** @param {string} status */
function probeStatusLabel(status) {
  if (status === "passed") return "已通过";
  if (status === "failed") return "未通过";
  if (status === "running") return "运行中…";
  return "未跑";
}

/** @param {unknown} err @param {string} fallback */
function errText(err, fallback) {
  const code = /** @type {{ code?: string }} */ (err ?? {}).code;
  const message = /** @type {{ message?: string }} */ (err ?? {}).message;
  return message ?? (code ? `${fallback}（${code}）` : fallback);
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
 * @property {string | null} probeAt
 * @property {string} updatedAt
 * @property {"logged_in" | "needs_key" | "not_installed"} badge
 * @property {string | null} installGuide
 */
