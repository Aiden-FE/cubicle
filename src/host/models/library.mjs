/**
 * Engine-agnostic model library (ticket 14).
 *
 * One plain-text file — `<dataDir>/settings/models.json` — is the single
 * source of truth for provider connections and model capabilities. Engine
 * configs (pi models.json, codex homes, DSH profile) are derived from it.
 *
 * Secrets never leave the host: renderer-facing reads return only a masked
 * key. The file is written atomically with 0600 permissions.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { appError } from "../../shared/apperror.mjs";
import {
  ENGINE_PROTOCOLS,
  INITIAL_REASONING_LEVELS,
  MODEL_PROTOCOLS,
  REASONING_LEVELS,
  defaultReasoningLevels,
  maskApiKey,
  modelRef,
  protocolsForEngine,
} from "../../shared/model-catalog.mjs";

const DEFAULT_CONTEXT = 1_000_000;
const DEFAULT_MAX_TOKENS = 128_000;
const PROVIDER_KEY_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

/**
 * @typedef {"off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max"} ReasoningLevel
 * @typedef {"openai-responses" | "openai-completions"} ModelProtocol
 *
 * @typedef {object} LibraryModel
 * @property {string} id
 * @property {string} displayName
 * @property {number} contextWindow
 * @property {number} maxTokens
 * @property {string[]} input
 * @property {boolean} reasoning
 * @property {Record<string, string | null> | null} reasoningLevels
 *
 * @typedef {object} LibraryProvider
 * @property {string} key
 * @property {string} displayName
 * @property {string} baseUrl
 * @property {string} apiKey
 * @property {ModelProtocol} protocol
 * @property {LibraryModel[]} models
 *
 * @typedef {object} ModelLibrary
 * @property {number} version
 * @property {LibraryProvider[]} providers
 * @property {string | null} defaultProvider
 * @property {string | null} defaultModel
 * @property {string | null} [loadError]
 *
 * @typedef {object} ResolvedModel
 * @property {LibraryProvider} provider
 * @property {LibraryModel} model
 * @property {string} ref
 * @property {string | null} reasoningEffort
 */

/** @param {string} dataDir */
export function modelLibraryPath(dataDir) {
  return path.join(dataDir, "settings", "models.json");
}

/** @returns {ModelLibrary} */
function emptyLibrary() {
  return { version: 1, providers: [], defaultProvider: null, defaultModel: null };
}

/** @param {unknown} value */
function asObject(value) {
  return /** @type {Record<string, any>} */ (value && typeof value === "object" && !Array.isArray(value) ? value : {});
}

/**
 * @param {unknown} value
 * @param {number} fallback
 */
function positiveInt(value, fallback) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function normalizeInput(value) {
  const raw = Array.isArray(value) ? value : ["text", "image"];
  const allowed = raw.filter((item) => item === "text" || item === "image");
  const result = ["text", ...allowed.filter((item) => item !== "text")];
  return result.length > 0 ? [...new Set(result)] : ["text"];
}

/**
 * @param {unknown} value
 * @returns {Record<string, string | null> | null}
 */
function normalizeReasoningLevels(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return defaultReasoningLevels();
  /** @type {Record<string, string | null>} */
  const result = {};
  for (const level of REASONING_LEVELS) {
    const raw = /** @type {Record<string, unknown>} */ (value)[level];
    if (raw === undefined) continue;
    if (level === "off") {
      result.off = null;
      continue;
    }
    if (typeof raw === "string" && raw.trim().length > 0) result[level] = raw.trim();
    // null / missing = this level is not offered
  }
  const offered = Object.keys(result).filter((level) => level !== "off" && result[level] !== null);
  if (offered.length === 0) return defaultReasoningLevels();
  if (!("off" in result)) result.off = null;
  return result;
}

/**
 * @param {unknown} value
 * @param {string} fallbackId
 * @returns {LibraryModel | null}
 */
function normalizeModel(value, fallbackId = "") {
  const raw = asObject(value);
  const id = String(raw.id ?? fallbackId).trim();
  if (id.length === 0) return null;
  const contextWindow = positiveInt(raw.contextWindow, DEFAULT_CONTEXT);
  const maxTokens = Math.min(positiveInt(raw.maxTokens, DEFAULT_MAX_TOKENS), contextWindow);
  const reasoning = raw.reasoning === true;
  return {
    id,
    displayName: String(raw.displayName ?? raw.name ?? id).trim() || id,
    contextWindow,
    maxTokens,
    input: normalizeInput(raw.input),
    reasoning,
    reasoningLevels: reasoning ? normalizeReasoningLevels(raw.reasoningLevels) : null,
  };
}

/**
 * @param {unknown} value
 * @returns {LibraryProvider | null}
 */
function normalizeProvider(value) {
  const raw = asObject(value);
  const key = String(raw.key ?? "").trim();
  if (!PROVIDER_KEY_RE.test(key)) return null;
  const baseUrl = String(raw.baseUrl ?? raw.baseURL ?? "").trim();
  const protocol = MODEL_PROTOCOLS.includes(raw.protocol) ? raw.protocol : "openai-responses";
  const models = (Array.isArray(raw.models) ? raw.models : [])
    .map((model) => normalizeModel(model))
    .filter((model) => model !== null);
  const ids = new Set();
  const uniqueModels = models.filter((model) => {
    if (ids.has(model.id)) return false;
    ids.add(model.id);
    return true;
  });
  return {
    key,
    displayName: String(raw.displayName ?? raw.name ?? key).trim() || key,
    baseUrl,
    apiKey: typeof raw.apiKey === "string" ? raw.apiKey : "",
    protocol,
    models: uniqueModels,
  };
}

/**
 * @param {unknown} value
 * @returns {ModelLibrary}
 */
export function normalizeLibrary(value) {
  const raw = asObject(value);
  const providers = (Array.isArray(raw.providers) ? raw.providers : [])
    .map((provider) => normalizeProvider(provider))
    .filter((provider) => provider !== null);
  const keys = new Set();
  const uniqueProviders = providers.filter((provider) => {
    if (keys.has(provider.key)) return false;
    keys.add(provider.key);
    return true;
  });
  const library = {
    version: 1,
    providers: uniqueProviders,
    defaultProvider: typeof raw.defaultProvider === "string" ? raw.defaultProvider : null,
    defaultModel: typeof raw.defaultModel === "string" ? raw.defaultModel : null,
  };
  fixDefaults(library);
  return library;
}

/** @param {ModelLibrary} library */
function fixDefaults(library) {
  const defaultProvider = library.providers.find((provider) => provider.key === library.defaultProvider) ?? null;
  if (defaultProvider && defaultProvider.models.length > 0) {
    const model = defaultProvider.models.find((entry) => entry.id === library.defaultModel) ?? defaultProvider.models[0];
    library.defaultProvider = defaultProvider.key;
    library.defaultModel = model.id;
    return;
  }
  const firstWithModels = library.providers.find((provider) => provider.models.length > 0) ?? null;
  library.defaultProvider = firstWithModels?.key ?? null;
  library.defaultModel = firstWithModels?.models[0]?.id ?? null;
}

/**
 * Read + normalize. A corrupt file is reported through `loadError` and treated
 * as empty, so a broken settings file can never take the office down.
 * @param {string} dataDir
 * @returns {ModelLibrary}
 */
export function readModelLibrary(dataDir) {
  const file = modelLibraryPath(dataDir);
  if (!existsSync(file)) return emptyLibrary();
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return normalizeLibrary(parsed);
  } catch (err) {
    return {
      ...emptyLibrary(),
      loadError: `settings/models.json 无法解析：${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * @param {string} file
 * @param {string} content
 * @param {number} mode
 */
function writeAtomic(file, content, mode) {
  mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
  try {
    writeFileSync(temp, content, { encoding: "utf8", mode });
    renameSync(temp, file);
  } catch (err) {
    rmSync(temp, { force: true });
    throw err;
  }
}

/**
 * @param {string} dataDir
 * @param {ModelLibrary} library
 */
function writeModelLibrary(dataDir, library) {
  const normalized = normalizeLibrary(library);
  fixDefaults(normalized);
  const file = modelLibraryPath(dataDir);
  writeAtomic(file, `${JSON.stringify(normalized, null, 2)}\n`, 0o600);
  return normalized;
}

/** @param {unknown} name */
function slugify(name) {
  const slug = String(name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug.length > 0 && /^[a-z0-9]/.test(slug) ? slug : "provider";
}

/**
 * @param {ModelLibrary} library
 * @param {string} desired
 * @param {string} [except]
 */
function uniqueProviderKey(library, desired, except) {
  const base = slugify(desired);
  let candidate = base;
  let n = 2;
  while (library.providers.some((provider) => provider.key !== except && provider.key === candidate)) {
    candidate = `${base}-${n++}`;
  }
  return candidate;
}

/** @param {string} value */
function validateUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw appError("invalid_base_url", "Base URL 必须是完整的 http(s) 地址");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw appError("invalid_base_url", "Base URL 必须是 http(s) 地址");
  }
}

/**
 * Masked, renderer-safe view. Never includes `apiKey`.
 * @param {ModelLibrary} library
 */
export function publicModelLibrary(library) {
  const resolved = resolveDefault(library);
  /** @param {string} engine */
  const compatibleRefs = (engine) => listCompatible(library, engine).map((entry) => entry.ref);
  return {
    providers: library.providers.map((provider) => ({
      key: provider.key,
      displayName: provider.displayName,
      baseUrl: provider.baseUrl,
      protocol: provider.protocol,
      hasKey: provider.apiKey.length > 0,
      apiKeyMasked: maskApiKey(provider.apiKey),
      models: provider.models.map((model) => ({
        id: model.id,
        displayName: model.displayName,
        contextWindow: model.contextWindow,
        maxTokens: model.maxTokens,
        input: model.input,
        reasoning: model.reasoning,
        reasoningLevels: model.reasoningLevels,
      })),
    })),
    defaults: {
      providerKey: library.defaultProvider,
      modelId: library.defaultModel,
      ref: resolved?.ref ?? null,
    },
    engines: Object.keys(ENGINE_PROTOCOLS).map((engine) => ({
      engine,
      protocols: protocolsForEngine(engine),
      compatibleRefs: compatibleRefs(engine),
    })),
    loadError: library.loadError ?? null,
  };
}

/**
 * @param {ModelLibrary} library
 * @param {string} ref
 * @returns {ResolvedModel | null}
 */
export function findModelByRef(library, ref) {
  const slash = ref.indexOf("/");
  if (slash <= 0) return null;
  const providerKey = ref.slice(0, slash);
  const modelId = ref.slice(slash + 1);
  const provider = library.providers.find((entry) => entry.key === providerKey);
  const model = provider?.models.find((entry) => entry.id === modelId);
  if (!provider || !model) return null;
  return { provider, model, ref, reasoningEffort: defaultReasoningFor(model) };
}

/**
 * The global default (first provider/model if unset). No engine filter.
 * @param {ModelLibrary} library
 * @returns {ResolvedModel | null}
 */
export function resolveDefault(library) {
  const provider =
    library.providers.find((entry) => entry.key === library.defaultProvider && entry.models.length > 0) ??
    library.providers.find((entry) => entry.models.length > 0) ??
    null;
  if (!provider) return null;
  const model = provider.models.find((entry) => entry.id === library.defaultModel) ?? provider.models[0];
  return { provider, model, ref: modelRef(provider.key, model.id), reasoningEffort: defaultReasoningFor(model) };
}

/** @param {LibraryModel} model */
function defaultReasoningFor(model) {
  if (!model.reasoning || !model.reasoningLevels) return null;
  const levels = Object.keys(model.reasoningLevels).filter(
    (level) => level !== "off" && model.reasoningLevels?.[level] !== null,
  );
  return levels[0] ?? "off";
}

/**
 * @param {ModelLibrary} library
 * @param {string} engine
 * @returns {{ ref: string, providerKey: string, providerName: string, protocol: string, model: LibraryModel }[]}
 */
export function listCompatible(library, engine) {
  const protocols = protocolsForEngine(engine);
  /** @type {{ ref: string, providerKey: string, providerName: string, protocol: string, model: LibraryModel }[]} */
  const result = [];
  for (const provider of library.providers) {
    if (!protocols.includes(provider.protocol)) continue;
    for (const model of provider.models) {
      result.push({
        ref: modelRef(provider.key, model.id),
        providerKey: provider.key,
        providerName: provider.displayName,
        protocol: provider.protocol,
        model,
      });
    }
  }
  return result;
}

/**
 * Resolve the model an employee manifest asks for.
 *
 * Order: explicit `provider/model` > global default (when compatible) > first
 * compatible model. A missing/incompatible explicit request is an error, not
 * a silent fallback — the hire/edit UI is supposed to prevent it.
 *
 * @param {ModelLibrary} library
 * @param {string} engine
 * @param {Record<string, unknown>} [manifest]
 * @returns {ResolvedModel}
 */
export function resolveModelForManifest(library, engine, manifest = {}) {
  const protocols = protocolsForEngine(engine);
  if (protocols.length === 0) throw appError("unknown_engine", `no engine ${engine}`);
  /** @type {ResolvedModel | null} */
  let explicit = null;

  const providerKey = typeof manifest.provider === "string" ? manifest.provider.trim() : "";
  const modelValue = typeof manifest.model === "string" ? manifest.model.trim() : "";
  if (modelValue && modelValue !== "default") {
    if (modelValue.includes("/")) {
      explicit = findModelByRef(library, modelValue);
    } else if (providerKey) {
      explicit = findModelByRef(library, modelRef(providerKey, modelValue));
    } else {
      const matches = library.providers.flatMap((provider) =>
        provider.models
          .filter((model) => model.id === modelValue)
          .map((model) => ({ provider, model })),
      );
      const compatible = matches.find((match) => protocols.includes(match.provider.protocol));
      if (compatible) {
        explicit = {
          provider: compatible.provider,
          model: compatible.model,
          ref: modelRef(compatible.provider.key, compatible.model.id),
          reasoningEffort: defaultReasoningFor(compatible.model),
        };
      }
    }
    if (!explicit) {
      throw appError(
        "engine_model_missing",
        `${engine} 找不到员工指定的模型「${providerKey ? `${providerKey}/` : ""}${modelValue}」（模型库）`,
      );
    }
  }

  if (explicit) {
    if (!protocols.includes(explicit.provider.protocol)) {
      throw appError(
        "model_incompatible",
        `${explicit.ref} 的协议 ${explicit.provider.protocol} 不能用于 ${engine}（需要 ${protocols.join(" / ")}）`,
      );
    }
  } else {
    const fallback = resolveDefault(library);
    if (fallback && protocols.includes(fallback.provider.protocol)) explicit = fallback;
    else explicit = listCompatible(library, engine)
      .map((entry) => ({ ...entry, model: entry.model }))
      .map((entry) => {
        const provider = library.providers.find((candidate) => candidate.key === entry.providerKey);
        return provider ? { provider, model: entry.model, ref: entry.ref, reasoningEffort: defaultReasoningFor(entry.model) } : null;
      })
      .find((entry) => entry !== null) ?? null;
  }

  if (!explicit) {
    throw appError(
      "engine_model_missing",
      `${engine} 还没有可用模型：去「设置 → 模型」添加一个 ${protocols.join(" / ")} 协议的供应商和模型`,
    );
  }

  const requestedLevel = typeof manifest.reasoningEffort === "string" ? manifest.reasoningEffort : "";
  let reasoningEffort = defaultReasoningFor(explicit.model);
  if (!explicit.model.reasoning) reasoningEffort = null;
  else if (requestedLevel === "off") reasoningEffort = "off";
  else if (requestedLevel && explicit.model.reasoningLevels?.[requestedLevel] !== null) {
    reasoningEffort = requestedLevel;
  }
  return { ...explicit, reasoningEffort };
}

/**
 * Validate + save a provider. `apiKey` blank on edit keeps the existing key.
 * @param {string} dataDir
 * @param {Record<string, unknown>} input
 */
export function saveProvider(dataDir, input) {
  const library = readModelLibrary(dataDir);
  const displayName = String(input.displayName ?? "").trim();
  if (displayName.length === 0) throw appError("invalid_payload", "供应商显示名不能为空");
  const baseUrl = String(input.baseUrl ?? "").trim().replace(/\/+$/, "");
  validateUrl(baseUrl);
  const protocol = String(input.protocol ?? "openai-responses");
  if (!MODEL_PROTOCOLS.includes(/** @type {ModelProtocol} */ (protocol))) {
    throw appError("invalid_protocol", `不支持的协议：${protocol}`);
  }
  const requestedKey = typeof input.key === "string" ? input.key.trim() : "";
  const existing = requestedKey ? library.providers.find((provider) => provider.key === requestedKey) : undefined;
  if (requestedKey && !existing && !PROVIDER_KEY_RE.test(requestedKey)) {
    throw appError("invalid_provider_key", "供应商 key 只能是小写字母、数字和连字符");
  }
  const key = existing?.key ?? uniqueProviderKey(library, requestedKey || displayName);
  const apiKeyInput = typeof input.apiKey === "string" ? input.apiKey.trim() : "";
  const apiKey = apiKeyInput.length > 0 ? apiKeyInput : (existing?.apiKey ?? "");
  if (apiKey.length === 0) throw appError("missing_api_key", "新建供应商需要 API Key");

  /** @type {LibraryProvider} */
  const next = {
    key,
    displayName,
    baseUrl,
    apiKey,
    protocol: /** @type {ModelProtocol} */ (protocol),
    models: existing?.models ?? [],
  };
  const providers = existing
    ? library.providers.map((provider) => (provider.key === key ? next : provider))
    : [...library.providers, next];
  const saved = writeModelLibrary(dataDir, { ...library, providers, loadError: null });
  return publicModelLibrary(saved);
}

/**
 * @param {string} dataDir
 * @param {string} providerKey
 */
export function deleteProvider(dataDir, providerKey) {
  const library = readModelLibrary(dataDir);
  const provider = library.providers.find((entry) => entry.key === providerKey);
  if (!provider) throw appError("unknown_provider", `no provider ${providerKey}`);
  const saved = writeModelLibrary(dataDir, {
    ...library,
    providers: library.providers.filter((entry) => entry.key !== providerKey),
    loadError: null,
  });
  return publicModelLibrary(saved);
}

/**
 * @param {string} dataDir
 * @param {string} providerKey
 * @param {Record<string, unknown>} input
 */
export function saveModel(dataDir, providerKey, input) {
  const library = readModelLibrary(dataDir);
  const provider = library.providers.find((entry) => entry.key === providerKey);
  if (!provider) throw appError("unknown_provider", `no provider ${providerKey}`);
  const model = normalizeModel(input);
  if (!model) throw appError("invalid_model", "模型 ID 不能为空");
  const exists = provider.models.some((entry) => entry.id === model.id);
  const models = exists
    ? provider.models.map((entry) => (entry.id === model.id ? model : entry))
    : [...provider.models, model];
  const providers = library.providers.map((entry) => (entry.key === providerKey ? { ...entry, models } : entry));
  const saved = writeModelLibrary(dataDir, { ...library, providers, loadError: null });
  return publicModelLibrary(saved);
}

/**
 * @param {string} dataDir
 * @param {string} providerKey
 * @param {string} modelId
 */
export function deleteModel(dataDir, providerKey, modelId) {
  const library = readModelLibrary(dataDir);
  const provider = library.providers.find((entry) => entry.key === providerKey);
  if (!provider) throw appError("unknown_provider", `no provider ${providerKey}`);
  if (!provider.models.some((entry) => entry.id === modelId)) throw appError("unknown_model", `no model ${modelId}`);
  const providers = library.providers.map((entry) =>
    entry.key === providerKey ? { ...entry, models: entry.models.filter((model) => model.id !== modelId) } : entry,
  );
  const saved = writeModelLibrary(dataDir, { ...library, providers, loadError: null });
  return publicModelLibrary(saved);
}

/**
 * @param {string} dataDir
 * @param {{ providerKey?: string, modelId?: string }} input
 */
export function setDefaults(dataDir, input) {
  const library = readModelLibrary(dataDir);
  const provider = library.providers.find((entry) => entry.key === input.providerKey);
  if (!provider) throw appError("unknown_provider", `no provider ${input.providerKey ?? ""}`);
  const model = provider.models.find((entry) => entry.id === input.modelId);
  if (!model) throw appError("unknown_model", `no model ${input.modelId ?? ""}`);
  const saved = writeModelLibrary(dataDir, {
    ...library,
    defaultProvider: provider.key,
    defaultModel: model.id,
    loadError: null,
  });
  return publicModelLibrary(saved);
}

/**
 * The pi models.json generated from the library. The pi SDK resolves
 * `provider/model` refs against these provider keys.
 * @param {ModelLibrary} library
 */
export function derivePiModels(library) {
  const providers = library.providers.filter((provider) => provider.baseUrl.length > 0 && provider.models.length > 0);
  if (providers.length === 0) return null;
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const provider of providers) {
    out[provider.key] = {
      name: provider.displayName,
      baseUrl: provider.baseUrl,
      api: provider.protocol,
      apiKey: provider.apiKey,
      models: provider.models.map((model) => ({
        type: "chat",
        id: model.id,
        name: model.displayName,
        ...(model.reasoning
          ? { reasoning: true, thinkingLevelMap: model.reasoningLevels ?? defaultReasoningLevels() }
          : { reasoning: false }),
        input: model.input,
        contextWindow: model.contextWindow,
        maxTokens: model.maxTokens,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      })),
    };
  }
  return { $schema: "https://pi.dev/schemas/models.schema.json", providers: out };
}

/**
 * Write the derived pi config, only when its content changed, so live pi
 * sessions are retired exactly on a real model-library edit.
 * @param {string} dataDir
 * @param {ModelLibrary} library
 * @returns {string | null}
 */
export function writePiModels(dataDir, library) {
  const derived = derivePiModels(library);
  if (!derived) return null;
  const file = path.join(dataDir, "engines", "pi", "models.json");
  const text = `${JSON.stringify(derived, null, 2)}\n`;
  try {
    if (existsSync(file) && readFileSync(file, "utf8") === text) return file;
  } catch {
    // fall through to rewrite
  }
  writeAtomic(file, text, 0o600);
  return file;
}

/**
 * The DSH profile patch: providers carry apiKeyEnv references, never raw keys.
 * @param {ModelLibrary} library
 */
export function deriveDshPatch(library) {
  const providers = library.providers.filter((provider) => provider.baseUrl.length > 0 && provider.models.length > 0);
  if (providers.length === 0) return null;
  /** @param {string} value */
  const q = (value) => JSON.stringify(String(value));
  /** @param {string} key */
  const keyFor = (key) => `CUBICLE_DSH_KEY_${key.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
  const lines = ["- id: llm-pi-ai", "  config:", "    providers:"];
  for (const provider of providers) {
    lines.push(`      ${provider.key}:`);
    lines.push(`        displayName: ${q(provider.displayName)}`);
    lines.push(`        apiKeyEnv: ${q(keyFor(provider.key))}`);
    lines.push(`        api: ${provider.protocol}`);
    lines.push(`        baseURL: ${q(provider.baseUrl)}`);
    lines.push(`        models:`);
    for (const model of provider.models) {
      lines.push(`          - id: ${q(model.id)}`);
      lines.push(`            name: ${q(model.displayName)}`);
      lines.push(`            contextWindow: ${model.contextWindow}`);
      lines.push(`            maxTokens: ${model.maxTokens}`);
      lines.push(`            input: [${model.input.map((item) => q(item)).join(", ")}]`);
      if (model.reasoning && model.reasoningLevels) {
        lines.push("            reasoningEfforts:");
        for (const [level, value] of Object.entries(model.reasoningLevels)) {
          lines.push(`              ${level}: ${value === null ? "null" : q(value)}`);
        }
      }
    }
  }
  const fallback = resolveDefault(library);
  if (fallback) {
    lines.push("- id: agent-default-model", "  config:");
    lines.push(`    provider: ${q(fallback.provider.key)}`);
    lines.push(`    model: ${q(fallback.model.id)}`);
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Create the Cubicle-owned DSH home + profile patch. Never touches ~/.dsh.
 * @param {string} dataDir
 * @param {ModelLibrary} library
 * @returns {{ home: string, profile: string, env: Record<string, string>, defaultRef: string | null } | null}
 */
export function ensureDshProfile(dataDir, library) {
  const patch = deriveDshPatch(library);
  if (!patch) return null;
  const home = path.join(dataDir, "engines", "dsh", "home");
  const profile = path.join(home, "profiles", "acp");
  mkdirSync(profile, { recursive: true });
  const file = path.join(profile, "cordis.patch.yml");
  try {
    if (!existsSync(file) || readFileSync(file, "utf8") !== patch) writeFileSync(file, patch, "utf8");
  } catch {
    writeFileSync(file, patch, "utf8");
  }
  /** @type {Record<string, string>} */
  const env = {};
  for (const provider of library.providers) {
    env[`CUBICLE_DSH_KEY_${provider.key.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`] = provider.apiKey;
  }
  const fallback = resolveDefault(library);
  return {
    home,
    profile,
    env,
    defaultRef: fallback?.ref ?? null,
  };
}

/** @param {string} baseUrl @param {string} protocol */
function endpointFor(baseUrl, protocol) {
  const url = new URL(baseUrl);
  let pathname = url.pathname.replace(/\/+$/, "");
  if (!/\/v1$/.test(pathname)) pathname = `${pathname}/v1`;
  pathname = `${pathname}/${protocol === "openai-responses" ? "responses" : "chat/completions"}`;
  url.pathname = pathname;
  return url.toString();
}

/**
 * The smallest real request that proves baseUrl + key + protocol + model id.
 * Never charges employee/task tokens; the caller displays the result only.
 *
 * @param {{ baseUrl: string, apiKey: string, protocol: string, model: { id: string } }} input
 * @returns {Promise<{ ok: boolean, status: number, latencyMs: number, detail: string }>}
 */
export async function testModelConnection({ baseUrl, apiKey, protocol, model }) {
  const started = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const url = endpointFor(baseUrl, protocol);
    const body =
      protocol === "openai-responses"
        ? { model: model.id, input: "ping", max_output_tokens: 16, stream: false }
        : { model: model.id, messages: [{ role: "user", content: "ping" }], max_tokens: 16, stream: false };
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const latencyMs = Date.now() - started;
    const text = await response.text();
    if (!response.ok) {
      let detail = `${response.status} ${response.statusText}`;
      try {
        const parsed = JSON.parse(text);
        const message = parsed?.error?.message ?? parsed?.message;
        if (typeof message === "string") detail = `${response.status}：${message}`;
      } catch {
        if (text.trim()) detail = `${response.status}：${text.trim().slice(0, 240)}`;
      }
      return { ok: false, status: response.status, latencyMs, detail };
    }
    return {
      ok: true,
      status: response.status,
      latencyMs,
      detail: `连接成功 · ${latencyMs}ms`,
    };
  } catch (err) {
    const latencyMs = Date.now() - started;
    const message = err instanceof Error && err.name === "AbortError" ? "请求超时（15s）" : err instanceof Error ? err.message : String(err);
    return { ok: false, status: 0, latencyMs, detail: message.slice(0, 240) };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Test a model by provider key + model id against the stored key.
 * @param {string} dataDir
 * @param {string} providerKey
 * @param {string} modelId
 */
export async function testStoredModel(dataDir, providerKey, modelId) {
  const library = readModelLibrary(dataDir);
  const provider = library.providers.find((entry) => entry.key === providerKey);
  const model = provider?.models.find((entry) => entry.id === modelId);
  if (!provider || !model) throw appError("unknown_model", "找不到要测试的供应商/模型");
  return testModelConnection({ baseUrl: provider.baseUrl, apiKey: provider.apiKey, protocol: provider.protocol, model });
}

export { DEFAULT_CONTEXT, DEFAULT_MAX_TOKENS, PROVIDER_KEY_RE, INITIAL_REASONING_LEVELS };
