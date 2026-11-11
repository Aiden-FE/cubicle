import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  deleteModel,
  deleteProvider,
  deriveDshPatch,
  derivePiModels,
  ensureDshProfile,
  publicModelLibrary,
  readModelLibrary,
  resolveModelForManifest,
  saveModel,
  saveProvider,
  setDefaults,
  testModelConnection,
  writePiModels,
} from "../src/host/models/library.mjs";

/** @param {string} name */
function withDir(name) {
  const dir = mkdtempSync(path.join(tmpdir(), `cubicle-models-${name}-`));
  return { dir, dispose: () => rmSync(dir, { recursive: true, force: true }) };
}

/** @param {string} dir */
function seedAcme(dir) {
  saveProvider(dir, {
    displayName: "Acme Gateway",
    key: "acme",
    baseUrl: "http://127.0.0.1:9/v1",
    apiKey: "sk-test-9f2a",
    protocol: "openai-responses",
  });
  saveModel(dir, "acme", {
    id: "acme-max",
    displayName: "Acme Max",
    contextWindow: 1_000_000,
    maxTokens: 128_000,
    input: ["text", "image"],
    reasoning: true,
    reasoningLevels: { off: null, low: "low", medium: "medium", high: "high", max: "max" },
  });
  return readModelLibrary(dir);
}

test("an empty library throws engine_model_missing instead of inventing a model", () => {
  const { dir, dispose } = withDir("empty");
  try {
    const library = readModelLibrary(dir);
    assert.equal(library.providers.length, 0);
    assert.throws(
      () => resolveModelForManifest(library, "pi", {}),
      (/** @type {any} */ err) => err.code === "engine_model_missing",
    );
  } finally {
    dispose();
  }
});

test("saving a provider masks the key and gives it a stable lowercase slug", () => {
  const { dir, dispose } = withDir("provider");
  try {
    saveProvider(dir, {
      displayName: "My Gateway!",
      key: "my-gateway",
      baseUrl: "https://gateway.example/v1",
      apiKey: "sk-secret-abcd",
      protocol: "openai-completions",
    });
    const library = readModelLibrary(dir);
    assert.equal(library.providers[0].key, "my-gateway");
    assert.equal(library.providers[0].apiKey, "sk-secret-abcd");
    const pub = publicModelLibrary(library);
    assert.equal(/** @type {any} */ (pub.providers[0]).apiKey, undefined);
    assert.equal(pub.providers[0].hasKey, true);
    assert.equal(pub.providers[0].apiKeyMasked, "sk-…abcd");

    // Editing without a key keeps the stored key; editing with a new one replaces it.
    saveProvider(dir, {
      key: "my-gateway",
      displayName: "My Gateway",
      baseUrl: "https://gateway.example/v1",
      apiKey: "",
      protocol: "openai-completions",
    });
    assert.equal(readModelLibrary(dir).providers[0].apiKey, "sk-secret-abcd");
    saveProvider(dir, {
      key: "my-gateway",
      displayName: "My Gateway",
      baseUrl: "https://gateway.example/v1",
      apiKey: "sk-new-1111",
      protocol: "openai-completions",
    });
    assert.equal(readModelLibrary(dir).providers[0].apiKey, "sk-new-1111");
    assert.equal(publicModelLibrary(readModelLibrary(dir)).providers[0].apiKeyMasked, "sk-…1111");
  } finally {
    dispose();
  }
});

test("model defaults are 1M context / 128K output / text+image and reasoning levels are normalized", () => {
  const { dir, dispose } = withDir("model-defaults");
  try {
    saveProvider(dir, {
      displayName: "Acme",
      key: "acme",
      baseUrl: "https://acme.example/v1",
      apiKey: "sk-1234",
      protocol: "openai-responses",
    });
    saveModel(dir, "acme", { id: "m1", reasoning: true, reasoningLevels: { low: "low", max: "max" } });
    const model = readModelLibrary(dir).providers[0].models[0];
    assert.equal(model.contextWindow, 1_000_000);
    assert.equal(model.maxTokens, 128_000);
    assert.deepEqual(model.input, ["text", "image"]);
    assert.equal(model.reasoning, true);
    assert.equal(model.reasoningLevels?.off, null);
    assert.equal(model.reasoningLevels?.low, "low");
    assert.equal(model.reasoningLevels?.max, "max");
  } finally {
    dispose();
  }
});

test("default resolution and engine compatibility: codex only takes Responses", () => {
  const { dir, dispose } = withDir("resolve");
  try {
    saveProvider(dir, {
      displayName: "Acme",
      key: "acme",
      baseUrl: "https://acme.example/v1",
      apiKey: "sk-1234",
      protocol: "openai-responses",
    });
    saveModel(dir, "acme", {
      id: "acme-max",
      reasoning: true,
      reasoningLevels: { off: null, low: "low", high: "high", max: "max" },
    });
    saveProvider(dir, {
      displayName: "Chat Only",
      key: "chat-only",
      baseUrl: "https://chat.example/v1",
      apiKey: "sk-5678",
      protocol: "openai-completions",
    });
    saveModel(dir, "chat-only", { id: "chat-model" });

    const library = readModelLibrary(dir);
    assert.equal(library.defaultProvider, "acme");
    assert.equal(library.defaultModel, "acme-max");
    assert.equal(resolveModelForManifest(library, "pi", {}).ref, "acme/acme-max");
    assert.equal(resolveModelForManifest(library, "codex", {}).ref, "acme/acme-max");
    assert.equal(resolveModelForManifest(library, "pi", { provider: "chat-only", model: "chat-model" }).ref, "chat-only/chat-model");
    assert.throws(
      () => resolveModelForManifest(library, "codex", { provider: "chat-only", model: "chat-model" }),
      (/** @type {any} */ err) => err.code === "model_incompatible",
    );
    assert.throws(
      () => resolveModelForManifest(library, "pi", { provider: "acme", model: "missing" }),
      (/** @type {any} */ err) => err.code === "engine_model_missing",
    );
    assert.equal(resolveModelForManifest(library, "pi", { model: "acme-max" }).ref, "acme/acme-max");
    assert.equal(resolveModelForManifest(library, "pi", { provider: "acme", model: "acme-max", reasoningEffort: "max" }).reasoningEffort, "max");
    assert.equal(resolveModelForManifest(library, "pi", { provider: "acme", model: "acme-max", reasoningEffort: "off" }).reasoningEffort, "off");
  } finally {
    dispose();
  }
});

test("changing defaults and deleting the default provider fall back to the first remaining model", () => {
  const { dir, dispose } = withDir("defaults");
  try {
    saveProvider(dir, {
      displayName: "A",
      key: "a",
      baseUrl: "https://a.example/v1",
      apiKey: "sk-a",
      protocol: "openai-responses",
    });
    saveModel(dir, "a", { id: "a1" });
    saveProvider(dir, {
      displayName: "B",
      key: "b",
      baseUrl: "https://b.example/v1",
      apiKey: "sk-b",
      protocol: "openai-responses",
    });
    saveModel(dir, "b", { id: "b1" });
    setDefaults(dir, { providerKey: "b", modelId: "b1" });
    assert.equal(readModelLibrary(dir).defaultProvider, "b");
    deleteProvider(dir, "b");
    const library = readModelLibrary(dir);
    assert.equal(library.defaultProvider, "a");
    assert.equal(library.defaultModel, "a1");
    deleteModel(dir, "a", "a1");
    const empty = readModelLibrary(dir);
    assert.equal(empty.defaultProvider, null);
    assert.equal(empty.defaultModel, null);
  } finally {
    dispose();
  }
});

test("pi derivation carries thinkingLevelMap and the DSH patch references env keys, not secrets", () => {
  const { dir, dispose } = withDir("derive");
  try {
    const library = seedAcme(dir);
    const pi = derivePiModels(library);
    assert.ok(pi);
    const provider = /** @type {any} */ (pi).providers.acme;
    assert.equal(provider.api, "openai-responses");
    assert.equal(provider.models[0].thinkingLevelMap.max, "max");
    assert.deepEqual(provider.models[0].input, ["text", "image"]);
    assert.equal(provider.models[0].contextWindow, 1_000_000);

    const patch = deriveDshPatch(library);
    assert.ok(patch);
    assert.ok(patch.includes("apiKeyEnv"));
    assert.ok(!patch.includes("sk-test-9f2a"), "DSH patch must not contain the raw key");
    const profile = ensureDshProfile(dir, library);
    assert.ok(profile);
    assert.ok(profile.env.CUBICLE_DSH_KEY_ACME === "sk-test-9f2a");
    assert.ok(readFileSync(path.join(profile.profile, "cordis.patch.yml"), "utf8").includes("provider: \"acme\""));

    writePiModels(dir, library);
    const piFile = readFileSync(path.join(dir, "engines", "pi", "models.json"), "utf8");
    assert.ok(piFile.includes("acme-max"));
  } finally {
    dispose();
  }
});

test("test connection sends a minimal protocol-shaped request and reports the result", async () => {
  const { dir, dispose } = withDir("test-connection");
  /** @type {{ url: string | undefined, body: any }[]} */
  const requests = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    requests.push({ url: req.url, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
    res.writeHead(req.url === "/v1/responses" ? 200 : 401, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: req.url === "/v1/responses" }));
  });
  const port = await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(/** @type {any} */ (server.address()).port));
  });
  try {
    const ok = await testModelConnection({
      baseUrl: `http://127.0.0.1:${port}/v1`,
      apiKey: "sk-test",
      protocol: "openai-responses",
      model: { id: "m1" },
    });
    assert.equal(ok.ok, true);
    assert.equal(ok.status, 200);
    assert.equal(requests[0].url, "/v1/responses");
    assert.equal(requests[0].body.model, "m1");
    assert.equal(requests[0].body.max_output_tokens, 16);

    const bad = await testModelConnection({
      baseUrl: `http://127.0.0.1:${port}`,
      apiKey: "sk-test",
      protocol: "openai-completions",
      model: { id: "m1" },
    });
    assert.equal(bad.ok, false);
    assert.equal(bad.status, 401);
  } finally {
    await new Promise((resolve) => server.close(() => resolve(undefined)));
    dispose();
  }
});

test("a corrupt library is reported, never thrown, and reads as empty", () => {
  const { dir, dispose } = withDir("corrupt");
  try {
    mkdirSync(path.join(dir, "settings"), { recursive: true });
    writeFileSync(path.join(dir, "settings", "models.json"), "{not json", "utf8");
    const library = readModelLibrary(dir);
    assert.equal(library.providers.length, 0);
    assert.match(library.loadError ?? "", /无法解析/);
  } finally {
    dispose();
  }
});
