/**
 * E2E fixtures for ticket 14's model library.
 *
 * The app no longer reads `engines/<engine>/models.json`; tests must seed the
 * engine-agnostic `<dataDir>/settings/models.json`. These helpers keep the
 * old per-engine fixture shapes as inputs, so the ticket-04..13 mock servers
 * can stay untouched.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const DEFAULT_REASONING = { off: null, low: "low", medium: "medium", high: "high" };

/**
 * @param {string} dataDir
 * @param {{ providers: Record<string, any>, defaultProvider?: string, defaultModel?: string }} input
 */
export function writeModelLibrary(dataDir, input) {
  const providers = Object.entries(input.providers).map(([key, provider]) => ({
    key,
    displayName: String(provider.name ?? key),
    baseUrl: String(provider.baseUrl ?? provider.baseURL ?? ""),
    apiKey: String(provider.apiKey ?? ""),
    protocol: provider.api === "openai-responses" || provider.api === "azure-openai-responses"
      ? "openai-responses"
      : "openai-completions",
    models: (provider.models ?? []).map((/** @type {any} */ model) => ({
      id: String(model.id),
      displayName: String(model.name ?? model.id),
      contextWindow: Number(model.contextWindow ?? 1_000_000),
      maxTokens: Number(model.maxTokens ?? 128_000),
      input: Array.isArray(model.input) && model.input.length > 0 ? model.input : ["text", "image"],
      reasoning: model.reasoning === true,
      reasoningLevels: model.reasoning === true
        ? (model.thinkingLevelMap ?? model.reasoningEfforts ?? DEFAULT_REASONING)
        : null,
    })),
  }));
  const first = providers.find((provider) => provider.models.length > 0);
  const defaultProvider = input.defaultProvider ?? first?.key ?? null;
  const defaultModel = input.defaultModel ?? first?.models[0]?.id ?? null;
  mkdirSync(path.join(dataDir, "settings"), { recursive: true });
  writeFileSync(
    path.join(dataDir, "settings", "models.json"),
    `${JSON.stringify(
      {
        version: 1,
        providers,
        defaultProvider,
        defaultModel,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  return { defaultProvider, defaultModel };
}

/**
 * Convert the pi models.json fixture shape (one/many providers) to the
 * app-level library.
 * @param {string} dataDir
 * @param {any} piConfig
 */
export function writeLibraryFromPiConfig(dataDir, piConfig) {
  return writeModelLibrary(dataDir, {
    providers: piConfig.providers ?? {},
    defaultProvider: Object.keys(piConfig.providers ?? {})[0],
    defaultModel: Object.values(piConfig.providers ?? {})[0]?.models?.[0]?.id,
  });
}

/**
 * Seed one OpenAI-compatible provider.
 * @param {string} dataDir
 * @param {{
 *   baseUrl: string,
 *   apiKey?: string,
 *   protocol?: "openai-responses" | "openai-completions",
 *   modelId?: string,
 *   displayName?: string,
 *   providerKey?: string,
 *   reasoning?: boolean,
 * }} input
 */
export function seedModelLibrary(dataDir, input) {
  const providerKey = input.providerKey ?? "cubicle";
  const modelId = input.modelId ?? "cubicle-e2e-model";
  return writeModelLibrary(dataDir, {
    providers: {
      [providerKey]: {
        name: "Cubicle E2E",
        baseUrl: input.baseUrl,
        apiKey: input.apiKey ?? "e2e-local-key",
        api: input.protocol ?? "openai-completions",
        models: [
          {
            id: modelId,
            name: "E2E Model",
            reasoning: input.reasoning === true,
            input: ["text", "image"],
            contextWindow: 1_000_000,
            maxTokens: 128_000,
          },
        ],
      },
    },
    defaultProvider: providerKey,
    defaultModel: modelId,
  });
}

/** @param {string} dataDir @param {string} providerKey */
export function removeProvider(dataDir, providerKey) {
  const file = path.join(dataDir, "settings", "models.json");
  const library = JSON.parse(readFileSync(file, "utf8"));
  library.providers = library.providers.filter((/** @type {any} */ entry) => entry.key !== providerKey);
  const first = library.providers.find((/** @type {any} */ entry) => entry.models.length > 0);
  if (!library.providers.some((/** @type {any} */ entry) => entry.key === library.defaultProvider)) {
    library.defaultProvider = first?.key ?? null;
    library.defaultModel = first?.models[0]?.id ?? null;
  }
  writeFileSync(file, `${JSON.stringify(library, null, 2)}\n`, "utf8");
}

/** @param {string} dataDir @param {string} providerKey @param {string} [apiKey] */
export function setProviderKey(dataDir, providerKey, apiKey = "e2e-local-key") {
  const file = path.join(dataDir, "settings", "models.json");
  const library = JSON.parse(readFileSync(file, "utf8"));
  const provider = library.providers.find((/** @type {any} */ entry) => entry.key === providerKey);
  if (provider) provider.apiKey = apiKey;
  writeFileSync(file, `${JSON.stringify(library, null, 2)}\n`, "utf8");
}

/** @param {string} dataDir @param {string} providerKey @param {string | null} baseUrl */
export function setProviderBaseUrl(dataDir, providerKey, baseUrl) {
  const file = path.join(dataDir, "settings", "models.json");
  const library = JSON.parse(readFileSync(file, "utf8"));
  const provider = library.providers.find((/** @type {any} */ entry) => entry.key === providerKey);
  if (provider && baseUrl !== null) provider.baseUrl = baseUrl;
  writeFileSync(file, `${JSON.stringify(library, null, 2)}\n`, "utf8");
}
