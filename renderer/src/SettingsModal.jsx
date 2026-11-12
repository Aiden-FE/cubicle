import React, { useEffect, useState } from "react";
import { AboutPanel } from "./AboutPanel.jsx";
import { EngineCenterPanel } from "./EngineCenterPanel.jsx";
import { ModelsPanel } from "./ModelsPanel.jsx";
import { useDialog } from "./useDialog.js";

const SETTINGS_TAB_KEY = "cubicle.settingsTab";
const TABS = [
  { key: "appearance", label: "外观" },
  { key: "models", label: "模型" },
  { key: "engine", label: "引擎中心" },
  { key: "about", label: "关于" },
];

/**
 * Unified Settings (ticket 14): one centered modal behind the top-right gear.
 * Appearance, the engine-agnostic model library, engine admission/probe and
 * About all live here; the office canvas stays untouched.
 *
 * @param {{
 *   viewPrefs: { plate: boolean },
 *   setViewPref: (key: "plate", value: boolean) => void,
 *   status: { state?: string, pid?: number, dataDir?: string },
 *   onClose: () => void,
 * }} props
 */
export function SettingsModal({ viewPrefs, setViewPref, status, onClose }) {
  const [tab, setTab] = useState(() => {
    try {
      const saved = window.localStorage.getItem(SETTINGS_TAB_KEY);
      return TABS.some((entry) => entry.key === saved) ? String(saved) : "appearance";
    } catch {
      return "appearance";
    }
  });
  const dialogRef = useDialog(onClose);

  useEffect(() => {
    try {
      window.localStorage.setItem(SETTINGS_TAB_KEY, tab);
    } catch {
      // settings must still open without storage
    }
  }, [tab]);

  return (
    <div className="settings-scrim" data-testid="settings-scrim" onClick={onClose}>
      <div
        className="settings-modal"
        data-testid="settings-modal"
        role="dialog"
        aria-modal="true"
        aria-label="设置"
        ref={dialogRef}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="settings-header">
          <div>
            <div className="settings-title">设置</div>
            <div className="settings-subtitle">与当前公司/项目组无关的全局配置</div>
          </div>
          <button type="button" className="settings-close" data-testid="settings-close" aria-label="关闭设置" onClick={onClose}>
            ✕
          </button>
        </header>

        <div className="settings-status" data-testid="settings-status" data-state={status.state ?? "unknown"}>
          <span className="settings-status-dot" aria-hidden="true" />
          <span>{statusLabel(status.state)}</span>
          {status.pid ? <span className="settings-status-meta">host pid {status.pid}</span> : null}
          {status.dataDir ? <span className="settings-status-meta" title={status.dataDir}>数据目录 {status.dataDir}</span> : null}
        </div>

        <div className="settings-body">
          <nav className="settings-tabs" role="tablist" aria-label="设置分区">
            {TABS.map((entry) => (
              <button
                key={entry.key}
                type="button"
                role="tab"
                aria-selected={tab === entry.key}
                className={tab === entry.key ? "settings-tab active" : "settings-tab"}
                data-testid={`settings-tab-${entry.key}`}
                onClick={() => setTab(entry.key)}
              >
                {entry.label}
              </button>
            ))}
          </nav>

          <section className="settings-content" role="tabpanel" data-testid={`settings-panel-${tab}`}>
            {tab === "appearance" ? (
              <div className="settings-appearance" data-testid="appearance-panel">
                <div className="settings-section-head">
                  <div>
                    <div className="settings-section-title">办公室显示</div>
                    <div className="settings-section-hint">画布上的员工姓名、角色和 token 名牌；员工状态由动作和电脑屏幕直接表达，不写状态文字。</div>
                  </div>
                </div>
                <label className="settings-check settings-check-card">
                  <input
                    type="checkbox"
                    data-testid="toggle-plate"
                    checked={viewPrefs.plate}
                    onChange={(event) => setViewPref("plate", event.target.checked)}
                  />
                  <span>
                    <strong>名牌</strong>
                    <small>显示员工姓名、角色和 token 汇总</small>
                  </span>
                </label>
              </div>
            ) : null}
            {tab === "models" ? <ModelsPanel /> : null}
            {tab === "engine" ? <EngineCenterPanel embedded /> : null}
            {tab === "about" ? <AboutPanel embedded /> : null}
          </section>
        </div>
      </div>
    </div>
  );
}

/** @param {string | undefined} state */
function statusLabel(state) {
  if (state === "online") return "引擎宿主在线";
  if (state === "starting") return "引擎宿主启动中";
  if (state === "offline") return "引擎宿主离线";
  return "引擎宿主未知";
}
