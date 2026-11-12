import React, { useEffect, useMemo, useState } from "react";
import { useDialog } from "./useDialog.js";
import { lookFor } from "./scene/employeeLook.js";
import { LookPicker } from "./LookPicker.jsx";

/**
 * Employee edit modal (ticket 14): name / engine / model / reasoning effort.
 * Model changes apply to the next run; a busy employee keeps finishing the
 * current one.
 *
 * @param {{
 *   employee: import("./App.jsx").RosterEmployeeData,
 *   onClose: () => void,
 *   onSaved: () => void,
 * }} props
 */
export function EmployeeEditModal({ employee, onClose, onSaved }) {
  const dialogRef = useDialog(onClose);
  const manifest = employee.roleSnapshot.manifest;
  const [name, setName] = useState(employee.name);
  const [appearance, setAppearance] = useState(() => lookFor(employee).id);
  const [engine, setEngine] = useState(String(manifest.engine ?? "pi"));
  const [modelRef, setModelRef] = useState(() => {
    if (typeof manifest.model === "string" && manifest.model.includes("/")) return manifest.model;
    if (manifest.provider && manifest.model && manifest.model !== "default") return `${manifest.provider}/${manifest.model}`;
    return "";
  });
  const [reasoning, setReasoning] = useState(/** @type {string} */ (typeof manifest.reasoningEffort === "string" ? manifest.reasoningEffort : ""));
  const [engines, setEngines] = useState(/** @type {any[]} */ ([]));
  const [library, setLibrary] = useState(/** @type {any} */ (null));
  const [error, setError] = useState(/** @type {string | null} */ (null));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.all([
      window.cubicle.invoke("engine.list"),
      window.cubicle.invoke("model.library"),
    ])
      .then(([engineList, modelLibrary]) => {
        if (!alive) return;
        setEngines(/** @type {any} */ (engineList).engines);
        setLibrary(modelLibrary);
        if (!modelRef) {
          const defaults = /** @type {any} */ (modelLibrary).defaults;
          if (defaults?.ref) setModelRef(defaults.ref);
        }
      })
      .catch((err) => {
        if (alive) setError(/** @type {any} */ (err).message ?? "读取引擎/模型失败");
      });
    return () => {
      alive = false;
    };
    // modelRef is only used to fill a missing starting value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const models = useMemo(() => {
    if (!library) return [];
    const protocols = engineProtocols(library, engine);
    /** @type {{ ref: string, label: string, model: any }[]} */
    const result = [];
    for (const provider of library.providers ?? []) {
      if (!protocols.includes(provider.protocol)) continue;
      for (const model of provider.models ?? []) {
        result.push({ ref: `${provider.key}/${model.id}`, label: `${model.displayName} · ${provider.displayName}`, model });
      }
    }
    return result;
  }, [library, engine]);

  const selectedModel = models.find((entry) => entry.ref === modelRef) ?? models[0] ?? null;
  const reasoningOptions = selectedModel?.model.reasoning
    ? Object.keys(selectedModel.model.reasoningLevels ?? {})
    : [];

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

  const engineInfo = engines.find((entry) => entry.engine === engine);
  const engineBlocked = !engineInfo?.enabled;
  const noModel = models.length === 0;

  async function save() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const [provider, ...rest] = (selectedModel?.ref ?? "").split("/");
      const model = rest.join("/");
      if (!provider || !model) throw new Error("先选择一个模型");
      await window.cubicle.invoke("employee.update", {
        employeeId: employee.id,
        name: name.trim(),
        appearance,
        engine,
        provider,
        model,
        reasoningEffort: reasoning || null,
      });
      onSaved();
    } catch (err) {
      setError(/** @type {any} */ (err).message ?? /** @type {any} */ (err).code ?? "保存失败");
      setBusy(false);
    }
  }

  return (
    <div className="hire-scrim" data-testid="employee-edit-scrim" onClick={busy ? undefined : onClose}>
      <div
        className="hire-modal employee-edit-modal"
        data-testid="employee-edit-modal"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`编辑员工 ${employee.name}`}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="hire-header">
          <div>
            <div className="hire-title">编辑员工</div>
            <div className="hire-subtitle">{employee.roleName} · 改动从下一轮派单开始生效</div>
          </div>
          <button type="button" className="hire-close" data-testid="employee-edit-close" aria-label="关闭" onClick={onClose} disabled={busy}>
            ✕
          </button>
        </header>

        {error ? <div className="hire-error" data-testid="employee-edit-error">{error}</div> : null}

        <div className="hire-body">
          <label className="hire-name-label" htmlFor="employee-edit-name">
            员工名字
            <input
              id="employee-edit-name"
              data-testid="employee-edit-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={busy}
            />
          </label>

          <div className="hire-look-row">
            <div className="hire-look-title">员工形象</div>
            <LookPicker value={appearance} onChange={setAppearance} disabled={busy} testId="edit-look-picker" />
          </div>

          <div className="settings-form-row">
            <label className="settings-field">
              引擎
              <select
                data-testid="employee-edit-engine"
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
                data-testid="employee-edit-model"
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
              <select data-testid="employee-edit-reasoning" value={reasoning} disabled={busy} onChange={(event) => setReasoning(event.target.value)}>
                {reasoningOptions.map((level) => (
                  <option key={level} value={level}>{level}</option>
                ))}
              </select>
            </label>
          ) : null}

          {engineBlocked ? (
            <div className="hire-hint" data-testid="employee-edit-engine-blocked">这个引擎还没准入：先去「设置 → 引擎中心」跑探针或带风险启用。</div>
          ) : null}
          {noModel ? (
            <div className="hire-hint" data-testid="employee-edit-model-missing">这个引擎没有兼容模型：先去「设置 → 模型」添加一个供应商和模型。</div>
          ) : null}
          {!noModel ? <div className="hire-hint">忙碌中也能保存：当前这轮用旧模型跑完，下一轮用新选择。</div> : null}
        </div>

        <footer className="hire-footer">
          <button type="button" className="hire-secondary" onClick={onClose} disabled={busy}>取消</button>
          <button
            type="button"
            className="hire-primary"
            data-testid="employee-edit-save"
            disabled={busy || engineBlocked || noModel}
            onClick={() => void save()}
          >
            保存
          </button>
        </footer>
      </div>
    </div>
  );
}

/**
 * @param {any} library
 * @param {string} engine
 * @returns {string[]}
 */
function engineProtocols(library, engine) {
  return /** @type {any[]} */ (library?.engines ?? []).find((entry) => entry.engine === engine)?.protocols ?? [];
}
