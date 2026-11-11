import React, { useCallback, useEffect, useState } from "react";
import { MODEL_PROTOCOLS, REASONING_LEVELS, defaultReasoningLevels } from "../../src/shared/model-catalog.mjs";

/**
 * Settings → Model. The engine-agnostic library is the single source of
 * truth: provider connections + model capabilities. Engine configs are
 * derived by the host; this panel never sees a key after save.
 *
 * @typedef {object} PublicModel
 * @property {string} id
 * @property {string} displayName
 * @property {number} contextWindow
 * @property {number} maxTokens
 * @property {string[]} input
 * @property {boolean} reasoning
 * @property {Record<string, string | null> | null} reasoningLevels
 *
 * @typedef {object} PublicProvider
 * @property {string} key
 * @property {string} displayName
 * @property {string} baseUrl
 * @property {string} protocol
 * @property {boolean} hasKey
 * @property {string} apiKeyMasked
 * @property {PublicModel[]} models
 *
 * @typedef {object} PublicLibrary
 * @property {PublicProvider[]} providers
 * @property {{ providerKey: string | null, modelId: string | null, ref: string | null }} defaults
 * @property {{ engine: string, protocols: string[], compatibleRefs: string[] }[]} engines
 * @property {string | null} loadError
 */
export function ModelsPanel() {
  const [library, setLibrary] = useState(/** @type {PublicLibrary | null} */ (null));
  const [error, setError] = useState(/** @type {string | null} */ (null));
  const [note, setNote] = useState(/** @type {string | null} */ (null));
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(/** @type {string | null} */ (null));
  /** @type {[any, any]} */
  const [providerForm, setProviderForm] = useState(/** @type {any} */ (null));
  /** @type {[any, any]} */
  const [modelForm, setModelForm] = useState(/** @type {any} */ (null));
  const [testResult, setTestResult] = useState(/** @type {{ key: string, text: string, ok: boolean } | null} */ (null));

  const load = useCallback(async () => {
    try {
      const data = /** @type {PublicLibrary} */ (await window.cubicle.invoke("model.library"));
      setLibrary(data);
      setError(data.loadError ?? null);
    } catch (err) {
      setError(/** @type {any} */ (err).code ?? "model_library_failed");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!providerForm && !modelForm) return;
    const selector = providerForm ? '[data-testid="provider-editor"]' : '[data-testid="model-editor"]';
    const timer = setTimeout(() => document.querySelector(selector)?.scrollIntoView({ block: "nearest" }), 0);
    return () => clearTimeout(timer);
  }, [providerForm, modelForm]);

  /** @param {() => Promise<unknown>} action @param {string} [okNote] @returns {Promise<boolean>} */
  async function run(action, okNote) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await load();
      if (okNote) setNote(okNote);
      return true;
    } catch (err) {
      setError(/** @type {any} */ (err).message ?? /** @type {any} */ (err).code ?? "保存失败");
      return false;
    } finally {
      setBusy(false);
    }
  }

  const providers = library?.providers ?? [];
  const defaultProvider = providers.find((provider) => provider.key === library?.defaults.providerKey) ?? providers[0] ?? null;
  const defaultModels = defaultProvider?.models ?? [];

  /** @param {PublicProvider | null} provider */
  function openProvider(provider) {
    setModelForm(null);
    setConfirmDelete(null);
    setProviderForm({
      mode: provider ? "edit" : "new",
      key: provider?.key ?? "",
      displayName: provider?.displayName ?? "",
      baseUrl: provider?.baseUrl ?? "",
      protocol: provider?.protocol ?? "openai-responses",
      apiKey: "",
      masked: provider?.apiKeyMasked ?? "",
    });
  }

  /**
   * @param {PublicProvider} provider
   * @param {PublicModel | null} model
   */
  function openModel(provider, model) {
    setProviderForm(null);
    setConfirmDelete(null);
    const levels = model?.reasoning && model.reasoningLevels
      ? Object.entries(model.reasoningLevels).map(([level, value]) => ({ level, value }))
      : Object.entries(defaultReasoningLevels()).map(([level, value]) => ({ level, value }));
    setModelForm({
      mode: model ? "edit" : "new",
      providerKey: provider.key,
      id: model?.id ?? "",
      displayName: model?.displayName ?? "",
      contextWindow: String(model?.contextWindow ?? 1_000_000),
      maxTokens: String(model?.maxTokens ?? 128_000),
      input: model?.input ?? ["text", "image"],
      reasoning: model?.reasoning ?? false,
      levels,
    });
  }

  /** @param {string} providerKey @param {PublicModel} model */
  async function testModel(providerKey, model) {
    setTestResult({ key: `${providerKey}/${model.id}`, text: "测试中…", ok: true });
    try {
      const result = /** @type {any} */ (
        await window.cubicle.invoke("model.test", { providerKey, modelId: model.id })
      );
      setTestResult({ key: `${providerKey}/${model.id}`, text: result.detail, ok: result.ok });
    } catch (err) {
      setTestResult({ key: `${providerKey}/${model.id}`, text: /** @type {any} */ (err).message ?? "测试失败", ok: false });
    }
  }

  /** @param {string} providerKey */
  function toggleDelete(providerKey) {
    setConfirmDelete(confirmDelete === providerKey ? null : providerKey);
  }

  return (
    <div className="settings-models" data-testid="models-panel">
      {error ? <div className="task-note" data-testid="models-error">模型库读取/保存失败：{error}</div> : null}
      {!library && !error ? <div className="task-empty">正在读取模型库…</div> : null}

      {library ? (
        <>
          <div className="settings-section-head">
            <div>
              <div className="settings-section-title">模型库</div>
              <div className="settings-section-hint">
                所有引擎共用同一份模型配置。保存后由宿主生成 pi / codex / DSH 的派生配置。
              </div>
            </div>
            <button type="button" className="settings-primary" data-testid="provider-add" disabled={busy} onClick={() => openProvider(null)}>
              添加供应商
            </button>
          </div>

          {providers.length === 0 ? (
            <div className="task-empty" data-testid="models-empty">
              还没有供应商。添加一个 OpenAI Responses 或 Chat Completions 端点后，招聘时就能选模型。
            </div>
          ) : null}

          <div className="provider-list">
            {providers.map((provider) => (
              <div key={provider.key} className="provider-card" data-testid="provider-card" data-provider={provider.key}>
                <div className="provider-head">
                  <div className="provider-identity">
                    <span className="provider-name" data-testid="provider-name">{provider.displayName}</span>
                    <span className="provider-tag">{provider.protocol === "openai-responses" ? "Responses" : "Chat"}</span>
                    <span className="provider-key">{provider.key}</span>
                  </div>
                  <div className="provider-actions">
                    <button type="button" className="task-mini-button" data-testid="provider-edit" onClick={() => openProvider(provider)}>
                      编辑
                    </button>
                    <button
                      type="button"
                      className={confirmDelete === provider.key ? "task-mini-button task-mini-danger" : "task-mini-button"}
                      data-testid="provider-delete"
                      disabled={busy}
                      onClick={() => (confirmDelete === provider.key ? void run(() => window.cubicle.invoke("model.provider.delete", { providerKey: provider.key }), "供应商已删除，引用它的员工已回迁默认模型。") : toggleDelete(provider.key))}
                    >
                      {confirmDelete === provider.key ? "再点一次删除" : "删除"}
                    </button>
                  </div>
                </div>
                <div className="provider-meta">
                  <span className="provider-url" title={provider.baseUrl}>{provider.baseUrl}</span>
                  <span className={provider.hasKey ? "provider-key-state ok" : "provider-key-state"}>
                    {provider.hasKey ? `Key ${provider.apiKeyMasked}` : "未配置 Key"}
                  </span>
                </div>

                <div className="model-list">
                  {provider.models.length === 0 ? <div className="task-empty model-empty">这个供应商还没有模型。</div> : null}
                  {provider.models.map((model) => (
                    <div key={model.id} className="model-row" data-testid="model-row" data-model={model.id}>
                      <div className="model-main">
                        <span className="model-name">{model.displayName}</span>
                        <span className="model-id">{model.id}</span>
                        <span className="model-meta">
                          {Math.round(model.contextWindow / 1000)}k ctx · {Math.round(model.maxTokens / 1000)}k out · {model.input.join("+")}
                          {model.reasoning ? " · 推理" : ""}
                        </span>
                        {model.reasoning ? (
                          <span className="model-levels">
                            {Object.keys(model.reasoningLevels ?? {}).map((level) => (
                              <span key={level} className="model-level">{level}</span>
                            ))}
                          </span>
                        ) : null}
                      </div>
                      <div className="model-actions">
                        <button
                          type="button"
                          className="task-mini-button"
                          data-testid="model-test"
                          disabled={busy || !provider.hasKey}
                          onClick={() => void testModel(provider.key, model)}
                        >
                          测试连接
                        </button>
                        <button type="button" className="task-mini-button" data-testid="model-edit" onClick={() => openModel(provider, model)}>
                          编辑
                        </button>
                        <button
                          type="button"
                          className={confirmDelete === `${provider.key}/${model.id}` ? "task-mini-button task-mini-danger" : "task-mini-button"}
                          data-testid="model-delete"
                          disabled={busy}
                          onClick={() =>
                            confirmDelete === `${provider.key}/${model.id}`
                              ? void run(
                                  () => window.cubicle.invoke("model.model.delete", { providerKey: provider.key, modelId: model.id }),
                                  "模型已删除，引用它的员工已回迁默认模型。",
                                )
                              : setConfirmDelete(`${provider.key}/${model.id}`)
                          }
                        >
                          {confirmDelete === `${provider.key}/${model.id}` ? "再点一次删除" : "删除"}
                        </button>
                      </div>
                      {testResult?.key === `${provider.key}/${model.id}` ? (
                        <div className={testResult.ok ? "model-test-result ok" : "model-test-result bad"} data-testid="model-test-result">
                          {testResult.text}
                        </div>
                      ) : null}
                    </div>
                  ))}
                  <button type="button" className="settings-secondary" data-testid="model-add" disabled={busy} onClick={() => openModel(provider, null)}>
                    添加模型
                  </button>
                </div>
              </div>
            ))}
          </div>

          {providers.length > 0 ? (
            <div className="settings-defaults" data-testid="model-defaults">
              <div className="settings-section-title">默认模型</div>
              <div className="settings-section-hint">员工/角色没有指定模型时用它；未指定则取第一个兼容模型。</div>
              <div className="settings-form-row">
                <label className="settings-field">
                  默认供应商
                  <select
                    data-testid="default-provider"
                    value={library.defaults.providerKey ?? defaultProvider?.key ?? ""}
                    onChange={(event) => {
                      const provider = providers.find((entry) => entry.key === event.target.value);
                      const model = provider?.models[0];
                      if (provider && model) void run(() => window.cubicle.invoke("model.defaults.set", { providerKey: provider.key, modelId: model.id }), "默认模型已更新。");
                    }}
                  >
                    {providers.map((provider) => (
                      <option key={provider.key} value={provider.key}>{provider.displayName}</option>
                    ))}
                  </select>
                </label>
                <label className="settings-field">
                  默认模型
                  <select
                    data-testid="default-model"
                    value={library.defaults.modelId ?? defaultModels[0]?.id ?? ""}
                    onChange={(event) => {
                      if (!defaultProvider) return;
                      void run(() => window.cubicle.invoke("model.defaults.set", { providerKey: defaultProvider.key, modelId: event.target.value }), "默认模型已更新。");
                    }}
                  >
                    {defaultModels.map((model) => (
                      <option key={model.id} value={model.id}>{model.displayName}</option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
          ) : null}

          {providerForm ? (
            <div className="settings-editor" data-testid="provider-editor">
              <div className="settings-editor-title">{providerForm.mode === "new" ? "添加供应商" : `编辑 ${providerForm.displayName}`}</div>
              <div className="settings-form-row">
                <label className="settings-field">
                  显示名
                  <input
                    data-testid="provider-form-name"
                    value={providerForm.displayName}
                    onChange={(event) => setProviderForm({ ...providerForm, displayName: event.target.value })}
                  />
                </label>
                <label className="settings-field">
                  协议
                  <select
                    data-testid="provider-form-protocol"
                    value={providerForm.protocol}
                    onChange={(event) => setProviderForm({ ...providerForm, protocol: event.target.value })}
                  >
                    {MODEL_PROTOCOLS.map((protocol) => (
                      <option key={protocol} value={protocol}>{protocol === "openai-responses" ? "OpenAI Responses" : "OpenAI Chat Completions"}</option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="settings-field">
                Base URL
                <input
                  data-testid="provider-form-url"
                  value={providerForm.baseUrl}
                  placeholder="https://api.example.com/v1"
                  onChange={(event) => setProviderForm({ ...providerForm, baseUrl: event.target.value })}
                />
              </label>
              <label className="settings-field">
                API Key
                <input
                  data-testid="provider-form-key"
                  type="password"
                  value={providerForm.apiKey}
                  placeholder={providerForm.mode === "edit" ? `已保存 ${providerForm.masked}，留空不修改` : "sk-…"}
                  onChange={(event) => setProviderForm({ ...providerForm, apiKey: event.target.value })}
                />
              </label>
              <div className="settings-editor-actions">
                <button type="button" className="settings-secondary" onClick={() => setProviderForm(null)}>取消</button>
                <button
                  type="button"
                  className="settings-primary"
                  data-testid="provider-form-save"
                  disabled={busy}
                  onClick={() => {
                    void run(
                      () =>
                        window.cubicle.invoke("model.provider.save", {
                          key: providerForm.mode === "edit" ? providerForm.key : undefined,
                          displayName: providerForm.displayName,
                          baseUrl: providerForm.baseUrl,
                          protocol: providerForm.protocol,
                          apiKey: providerForm.apiKey,
                        }),
                      "供应商已保存。",
                    ).then((ok) => {
                      if (ok) setProviderForm(null);
                    });
                  }}
                >
                  保存供应商
                </button>
              </div>
            </div>
          ) : null}

          {modelForm ? (
            <div className="settings-editor" data-testid="model-editor">
              <div className="settings-editor-title">
                {modelForm.mode === "new" ? "添加模型" : `编辑 ${modelForm.displayName || modelForm.id}`} · {modelForm.providerKey}
              </div>
              <div className="settings-form-row">
                <label className="settings-field">
                  模型 ID
                  <input
                    data-testid="model-form-id"
                    value={modelForm.id}
                    disabled={modelForm.mode === "edit"}
                    onChange={(event) => setModelForm({ ...modelForm, id: event.target.value })}
                  />
                </label>
                <label className="settings-field">
                  显示名
                  <input
                    data-testid="model-form-name"
                    value={modelForm.displayName}
                    onChange={(event) => setModelForm({ ...modelForm, displayName: event.target.value })}
                  />
                </label>
              </div>
              <div className="settings-form-row">
                <label className="settings-field">
                  上下文窗口
                  <input
                    data-testid="model-form-context"
                    type="number"
                    min="1"
                    value={modelForm.contextWindow}
                    onChange={(event) => setModelForm({ ...modelForm, contextWindow: event.target.value })}
                  />
                </label>
                <label className="settings-field">
                  最大输出
                  <input
                    data-testid="model-form-max"
                    type="number"
                    min="1"
                    value={modelForm.maxTokens}
                    onChange={(event) => setModelForm({ ...modelForm, maxTokens: event.target.value })}
                  />
                </label>
              </div>
              <fieldset className="settings-field">
                <legend>输入模态</legend>
                <div className="settings-check-row">
                  {["text", "image"].map((modality) => (
                    <label key={modality} className="settings-check">
                      <input
                        type="checkbox"
                        checked={modelForm.input.includes(modality)}
                        onChange={(event) => {
                          const next = event.target.checked
                            ? [...modelForm.input, modality]
                            : modelForm.input.filter((/** @type {string} */ item) => item !== modality);
                          setModelForm({ ...modelForm, input: next.length > 0 ? next : ["text"] });
                        }}
                      />
                      {modality}
                    </label>
                  ))}
                </div>
              </fieldset>
              <label className="settings-check" data-testid="model-form-reasoning">
                <input
                  type="checkbox"
                  checked={modelForm.reasoning}
                  onChange={(event) => {
                    const on = event.target.checked;
                    setModelForm({
                      ...modelForm,
                      reasoning: on,
                      levels: on && modelForm.levels.length === 0
                        ? Object.entries(defaultReasoningLevels()).map(([level, value]) => ({ level, value }))
                        : modelForm.levels,
                    });
                  }}
                />
                支持推理
              </label>
              {modelForm.reasoning ? (
                <div className="reasoning-editor" data-testid="reasoning-editor">
                  {modelForm.levels.map((/** @type {{ level: string, value: string | null }} */ row, /** @type {number} */ index) => (
                    <div key={`${row.level}-${index}`} className="reasoning-row">
                      <select
                        className="settings-select"
                        value={row.level}
                        onChange={(event) => {
                          const level = event.target.value;
                          const value = level === "off" ? null : (row.value && row.value !== "off" ? row.value : level);
                          setModelForm({
                            ...modelForm,
                            levels: modelForm.levels.map((/** @type {any} */ item, /** @type {number} */ at) => (at === index ? { level, value } : item)),
                          });
                        }}
                      >
                        {REASONING_LEVELS.filter((level) => level === row.level || !modelForm.levels.some((/** @type {any} */ item) => item.level === level)).map((level) => (
                          <option key={level} value={level}>{level}</option>
                        ))}
                      </select>
                      <input
                        className="settings-input"
                        value={row.value ?? ""}
                        placeholder={row.level === "off" ? "不发送" : row.level}
                        disabled={row.level === "off"}
                        onChange={(event) =>
                          setModelForm({
                            ...modelForm,
                            levels: modelForm.levels.map((/** @type {any} */ item, /** @type {number} */ at) =>
                              at === index ? { ...item, value: event.target.value } : item,
                            ),
                          })
                        }
                      />
                      <button
                        type="button"
                        className="task-mini-button"
                        aria-label={`删除推理档 ${row.level}`}
                        onClick={() =>
                          setModelForm({ ...modelForm, levels: modelForm.levels.filter((/** @type {any} */ _item, /** @type {number} */ at) => at !== index) })
                        }
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="settings-secondary"
                    data-testid="reasoning-add"
                    disabled={modelForm.levels.length >= REASONING_LEVELS.length}
                    onClick={() => {
                      const level = REASONING_LEVELS.find((candidate) => !modelForm.levels.some((/** @type {any} */ item) => item.level === candidate));
                      if (!level) return;
                      setModelForm({
                        ...modelForm,
                        levels: [...modelForm.levels, { level, value: level === "off" ? null : level }],
                      });
                    }}
                  >
                    添加推理档
                  </button>
                </div>
              ) : null}
              <div className="settings-editor-actions">
                <button type="button" className="settings-secondary" onClick={() => setModelForm(null)}>取消</button>
                <button
                  type="button"
                  className="settings-primary"
                  data-testid="model-form-save"
                  disabled={busy}
                  onClick={() => {
                    if (modelForm.reasoning && !modelForm.levels.some((/** @type {any} */ row) => row.level !== "off" && String(row.value ?? "").trim().length > 0)) {
                      setError("开启推理后至少要有一个非 off 的推理档位");
                      return;
                    }
                    const levels = Object.fromEntries(modelForm.levels.map((/** @type {any} */ row) => [row.level, row.level === "off" ? null : String(row.value ?? "").trim() || null]));
                    const contextWindow = Number(modelForm.contextWindow);
                    const maxTokens = Math.min(Number(modelForm.maxTokens), contextWindow);
                    void run(
                      () =>
                        window.cubicle.invoke("model.model.save", {
                          providerKey: modelForm.providerKey,
                          id: modelForm.id,
                          displayName: modelForm.displayName,
                          contextWindow,
                          maxTokens,
                          input: modelForm.input,
                          reasoning: modelForm.reasoning,
                          reasoningLevels: modelForm.reasoning ? levels : null,
                        }),
                      "模型已保存。",
                    ).then((ok) => {
                      if (ok) setModelForm(null);
                    });
                  }}
                >
                  保存模型
                </button>
              </div>
            </div>
          ) : null}

          {note ? <div className="task-note task-note-ok" data-testid="models-note">{note}</div> : null}
        </>
      ) : null}
    </div>
  );
}
