import React, { useEffect, useState } from "react";
import { appearanceFor } from "./roleAppearance.js";
import { useDialog } from "./useDialog.js";
import { EMPLOYEE_LOOKS, lookFor } from "./scene/employeeLook.js";
import { LookPicker } from "./LookPicker.jsx";

/**
 * @param {any} library
 * @param {string} engine
 * @returns {string[]}
 */
function engineProtocols(library, engine) {
  return /** @type {any[]} */ (library?.engines ?? []).find((entry) => entry.engine === engine)?.protocols ?? [];
}

/**
 * Flat compatible model choices for one engine.
 * @param {any} library
 * @param {string} engine
 * @returns {{ ref: string, label: string, model: any }[]}
 */
function compatibleModels(library, engine) {
  const protocols = engineProtocols(library, engine);
  /** @type {{ ref: string, label: string, model: any }[]} */
  const result = [];
  for (const provider of library?.providers ?? []) {
    if (!protocols.includes(provider.protocol)) continue;
    for (const model of provider.models ?? []) {
      result.push({ ref: `${provider.key}/${model.id}`, label: `${model.displayName} · ${provider.displayName}`, model });
    }
  }
  return result;
}

/**
 * Three-step hiring wizard, opened by clicking an empty desk (decision 10:
 * hiring is a mid-screen modal — the office canvas stays the main stage).
 *
 *   step 1 — pick a preset role
 *   step 2 — review its capability manifest (persona / skills / tools / MCP /
 *            engine / cost), straight from the role row at this moment
 *   step 3 — name the hire and confirm; the host then freezes the role into
 *            the employee (snapshot semantics, decision 02)
 *
 * Steps go forward AND back; closing at any point hires nobody.
 *
 * @param {{
 *   desk: import("./App.jsx").DeskData,
 *   onClose: () => void,
 * }} props
 */
export function HireModal({ desk, onClose }) {
  const [step, setStep] = useState(1);
  const [roles, setRoles] = useState(/** @type {import("./App.jsx").RoleData[] | null} */ (null));
  const [roleId, setRoleId] = useState(/** @type {number | null} */ (null));
  const [engines, setEngines] = useState(/** @type {any[]} */ ([]));
  const [library, setLibrary] = useState(/** @type {any} */ (null));
  const [engine, setEngine] = useState("pi");
  const [modelRef, setModelRef] = useState("");
  const [reasoning, setReasoning] = useState("");
  const [name, setName] = useState("");
  // 票 18: the face is picked at hire time; the default follows the role so a
  // fast confirm still lands someone recognisable.
  const [appearance, setAppearance] = useState(EMPLOYEE_LOOKS[0].id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(/** @type {string | null} */ (null));
  const dialogRef = useDialog(onClose);

  const role = roles?.find((r) => r.id === roleId) ?? null;
  const models = compatibleModels(library, engine);
  const selectedModel = models.find((entry) => entry.ref === modelRef) ?? models[0] ?? null;
  const reasoningOptions = selectedModel?.model.reasoning
    ? Object.keys(selectedModel.model.reasoningLevels ?? {})
    : [];
  const engineInfo = engines.find((entry) => entry.engine === engine);
  const engineBlocked = !engineInfo?.enabled;
  const noModel = models.length === 0;

  // Picking a role picks its engine; the first compatible model follows.
  useEffect(() => {
    if (!role) return;
    setEngine(String(role.manifest.engine ?? "pi"));
    setModelRef("");
    setReasoning("");
    setAppearance(lookFor({ appearance: null, roleSnapshot: role }).id);
  }, [role]);

  useEffect(() => {
    if (!selectedModel) return;
    if (modelRef !== selectedModel.ref) setModelRef(selectedModel.ref);
    if (selectedModel.model.reasoning) {
      const levels = Object.keys(selectedModel.model.reasoningLevels ?? {});
      if (!levels.includes(reasoning)) setReasoning(levels.find((level) => level !== "off") ?? "off");
    } else if (reasoning) {
      setReasoning("");
    }
  }, [selectedModel, modelRef, reasoning]);

  useEffect(() => {
    let alive = true;
    Promise.all([
      window.cubicle.invoke("role.list"),
      window.cubicle.invoke("engine.list"),
      window.cubicle.invoke("model.library"),
    ])
      .then(([roleList, engineList, modelLibrary]) => {
        if (!alive) return;
        setRoles(/** @type {any} */ (roleList).roles);
        setEngines(/** @type {any} */ (engineList).engines);
        setLibrary(modelLibrary);
      })
      .catch((err) => {
        if (alive) setError(/** @type {any} */ (err).message ?? String(err));
      });
    return () => {
      alive = false;
    };
  }, []);

  /** Confirm on step 3: the one mutation of this whole wizard. */
  async function confirmHire() {
    if (!role || busy) return;
    setBusy(true);
    setError(null);
    try {
      const [provider, ...rest] = (selectedModel?.ref ?? "").split("/");
      const model = rest.join("/");
      if (!provider || !model) throw new Error("这个引擎没有兼容模型，先去设置 → 模型添加。");
      await window.cubicle.invoke("employee.hire", {
        deskId: desk.id,
        roleId: role.id,
        name,
        appearance,
        engine,
        provider,
        model,
        reasoningEffort: reasoning || null,
      });
      onClose();
    } catch (err) {
      setError(/** @type {Error} */ (err).message ?? String(err));
      setBusy(false);
    }
  }

  return (
    <div className="hire-scrim" data-testid="hire-scrim" onClick={busy ? undefined : onClose}>
      <div
        className="hire-modal"
        data-testid="hire-modal"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="招聘新员工"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="hire-header">
          <div>
            <div className="hire-title">招聘新员工</div>
            <div className="hire-subtitle">
              {desk.label} · 共 3 步
            </div>
          </div>
          <button type="button" className="hire-close" data-testid="hire-close" aria-label="关闭" onClick={onClose} disabled={busy}>
            ✕
          </button>
        </header>

        <div className="hire-steps" data-testid="hire-step" data-step={step} aria-label={`第 ${step} 步，共 3 步`}>
          {[1, 2, 3].map((n) => (
            <React.Fragment key={n}>
              {n > 1 ? <span className="hire-step-arrow" aria-hidden="true">→</span> : null}
              <span
                className={`hire-step-chip ${n === step ? "active" : n < step ? "done" : "upcoming"}`}
                aria-current={n === step ? "step" : undefined}
              >
                <span className="hire-step-no">{n < step ? "✓" : n}</span>
                <span className="hire-step-name">{n === 1 ? "选角色" : n === 2 ? "看能力清单" : "确认录用"}</span>
              </span>
            </React.Fragment>
          ))}
        </div>

        {error ? <div className="hire-error" data-testid="hire-error">{error}</div> : null}

        {step === 1 ? (
          <div className="hire-body">
            {roles === null && !error ? <div className="hire-loading">读取角色库…</div> : null}
            <div className="hire-roles">
              {(roles ?? []).map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className={`hire-role ${roleId === preset.id ? "selected" : ""}`}
                  data-testid="role-option"
                  data-role-key={preset.key}
                  onClick={() => setRoleId(preset.id)}
                >
                  <RoleGlyph roleKey={preset.key} />
                  <span className="hire-role-name">{preset.name}</span>
                  <span className="hire-role-tagline">{preset.tagline}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {step === 2 && role ? (
          <div className="hire-body" data-testid="capability-list" data-role-key={role.key}>
            <div className="cap-row" data-testid="cap-persona">
              <span className="cap-label">人格</span>
              <p className="cap-persona-text">{role.manifest.persona}</p>
            </div>
            <div className="cap-row" data-testid="cap-skills">
              <span className="cap-label">技能</span>
              <Chips items={role.manifest.skills ?? []} />
            </div>
            <div className="cap-row" data-testid="cap-tools">
              <span className="cap-label">工具</span>
              <Chips items={role.manifest.tools ?? []} />
            </div>
            <div className="cap-row" data-testid="cap-mcp">
              <span className="cap-label">MCP</span>
              <Chips items={role.manifest.mcpServers ?? []} emptyLabel="无" />
            </div>
            <div className="cap-row" data-testid="cap-engine">
              <span className="cap-label">引擎</span>
              <Chips items={[`${engine} · ${selectedModel?.label ?? "未选模型"}`]} />
            </div>
            <div className="cap-row" data-testid="cap-cost">
              <span className="cap-label">成本</span>
              <span className="cap-cost-text">
                {typeof role.manifest.cost?.tokenBudgetPerTask === "number"
                  ? `单任务软闸 ${Math.round(role.manifest.cost.tokenBudgetPerTask / 10000)} 万 token`
                  : "未配置"}
              </span>
            </div>
            <div className="hire-hint">录用时这份清单会快照进员工，之后改角色不影响他。</div>
          </div>
        ) : null}

        {step === 3 && role ? (
          <div className="hire-body">
            <div className="hire-summary">
              <RoleGlyph roleKey={role.key} />
              <div>
                <div className="hire-role-name">{role.name}</div>
                <div className="hire-role-tagline">{desk.label} · 引擎 {engine}</div>
              </div>
            </div>
            <label className="hire-name-label" htmlFor="hire-name">
              员工名字
              <input
                id="hire-name"
                data-testid="employee-name-input"
                value={name}
                placeholder={role.name}
                onChange={(e) => setName(e.target.value)}
                disabled={busy}
              />
            </label>
            <div className="hire-look-row">
              <div className="hire-look-title">员工形象</div>
              <LookPicker value={appearance} onChange={setAppearance} disabled={busy} testId="hire-look-picker" />
              <div className="hire-hint">办公室里没有姓名标签：桌面名牌写名字，形象让同事一眼认出是谁。</div>
            </div>
            <div className="settings-form-row">
              <label className="settings-field">
                引擎
                <select
                  data-testid="hire-engine"
                  value={engine}
                  disabled={busy}
                  onChange={(event) => {
                    setEngine(event.target.value);
                    setModelRef("");
                    setReasoning("");
                  }}
                >
                  {engines.map((entry) => (
                    <option key={entry.engine} value={entry.engine} disabled={entry.enabled !== true}>
                      {entry.engine}
                      {entry.enabled !== true ? "（未准入）" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label className="settings-field">
                模型
                <select
                  data-testid="hire-model"
                  value={selectedModel?.ref ?? ""}
                  disabled={busy || noModel}
                  onChange={(event) => setModelRef(event.target.value)}
                >
                  {models.length === 0 ? <option value="">没有兼容模型</option> : null}
                  {models.map((entry) => (
                    <option key={entry.ref} value={entry.ref}>{entry.label}</option>
                  ))}
                </select>
              </label>
            </div>
            {reasoningOptions.length > 0 ? (
              <label className="settings-field">
                推理档位
                <select
                  data-testid="hire-reasoning"
                  value={reasoning}
                  disabled={busy}
                  onChange={(event) => setReasoning(event.target.value)}
                >
                  {reasoningOptions.map((level) => (
                    <option key={level} value={level}>{level}</option>
                  ))}
                </select>
              </label>
            ) : null}
            {engineBlocked ? (
              <div className="hire-hint" data-testid="hire-engine-blocked">
                这个引擎还没准入：先去「设置 → 引擎中心」跑探针或带风险启用。
              </div>
            ) : null}
            {noModel ? (
              <div className="hire-hint" data-testid="hire-model-missing">
                这个引擎没有兼容模型：先去「设置 → 模型」添加供应商和模型。
              </div>
            ) : null}
            <div className="hire-hint">留空则用角色名。确认即刻录用并入座。</div>
          </div>
        ) : null}

        <footer className="hire-footer">
          <button
            type="button"
            className="hire-secondary"
            data-testid="hire-back"
            disabled={step === 1 || busy}
            onClick={() => setStep((s) => Math.max(1, s - 1))}
          >
            上一步
          </button>
          {step < 3 ? (
            <button
              type="button"
              className="hire-primary"
              data-testid="hire-next"
              disabled={step === 1 && !role}
              onClick={() => setStep((s) => Math.min(3, s + 1))}
            >
              下一步
            </button>
          ) : (
            <button
              type="button"
              className="hire-primary"
              data-testid="hire-confirm"
              disabled={busy || !role || engineBlocked || noModel}
              onClick={() => void confirmHire()}
            >
              {busy ? "录用中…" : "确认录用"}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

/**
 * @param {{ items: string[], emptyLabel?: string }} props
 */
function Chips({ items, emptyLabel = "无" }) {
  if (items.length === 0) return <span className="cap-chip empty">{emptyLabel}</span>;
  return (
    <span className="cap-chips">
      {items.map((item) => (
        <span key={item} className="cap-chip">
          {item}
        </span>
      ))}
    </span>
  );
}

/**
 * Tiny flat avatar so each preset role has a face in the picker.
 * @param {{ roleKey: string }} props
 */
export function RoleGlyph({ roleKey }) {
  const color = appearanceFor(roleKey);
  return (
    <svg className="role-glyph" viewBox="0 0 40 40" aria-hidden="true">
      <circle cx="20" cy="20" r="19" fill="rgba(43,38,32,0.06)" />
      <circle cx="20" cy="15" r="7.5" fill={color.skin} />
      <path d="M12.5 14.5 Q13 7.5 20 7.5 Q27 7.5 27.5 14.5 Q24 11.5 20 11.5 Q16 11.5 12.5 14.5 Z" fill={color.hair} />
      <path d="M8 32 Q8 23.5 20 23.5 Q32 23.5 32 32 L32 34 L8 34 Z" fill={color.top} />
      {color.decor === "glasses" ? (
        <g stroke="#2b2620" strokeWidth="1.1" fill="none">
          <circle cx="16.8" cy="15.4" r="2.6" />
          <circle cx="23.2" cy="15.4" r="2.6" />
          <line x1="19.4" y1="15.4" x2="20.6" y2="15.4" />
        </g>
      ) : null}
      {color.decor === "tie" ? <path d="M14.5 24.5 L20 28.5 L25.5 24.5 L23.5 30 L16.5 30 Z" fill="#c98a2c" /> : null}
      {color.decor === "headset" ? (
        <path d="M12.8 12 Q13 6.5 20 6.5 Q27 6.5 27.2 12" stroke={color.hair} strokeWidth="1.6" fill="none" />
      ) : null}
    </svg>
  );
}
