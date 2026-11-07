import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { createCodexNormalizer } from "../src/host/engine/codex/normalize.mjs";

const fixtureUrl = new URL("./fixtures/codex-exec.jsonl", import.meta.url);
const liveFixtureUrl = new URL("./fixtures/codex-exec-live.jsonl", import.meta.url);

async function fixtureLines(url = fixtureUrl) {
  const text = await readFile(url, "utf8");
  return text.trim().split(/\r?\n/);
}

test("codex JSONL becomes the normalized event stream", async () => {
  const normalizer = createCodexNormalizer();

  for (const line of await fixtureLines()) {
    normalizer.push(line);
  }

  assert.deepEqual(normalizer.end(), [
    { type: "session_start", sessionId: "thread-spike" },
    { type: "turn_start" },
    { type: "thinking_delta", text: "Run the command once, then reply." },
    {
      type: "tool_execution_start",
      toolCallId: "item_1",
      toolName: "shell",
      args: { command: "\"pwsh.exe\" -Command 'echo m0-codex'" },
    },
    {
      type: "tool_execution_end",
      toolCallId: "item_1",
      toolName: "shell",
      isError: false,
      result: { output: "m0-codex\n", exitCode: 0, status: "completed" },
    },
    { type: "text_delta", text: "DONE" },
    {
      type: "turn_end",
      status: "ok",
      usage: {
        input: 100,
        cachedInput: 0,
        cacheWrite: 0,
        output: 5,
        reasoning: 0,
      },
    },
    { type: "agent_end", status: "ok" },
  ]);
});

test("a failed turn emits an error and a failed turn_end", () => {
  const normalizer = createCodexNormalizer();

  normalizer.push('{"type":"turn.started"}');
  normalizer.push('{"type":"turn.failed","error":{"message":"model overloaded"}}');

  assert.deepEqual(normalizer.end(), [
    { type: "turn_start" },
    { type: "error", code: "turn_failed", message: "model overloaded" },
    { type: "turn_end", status: "failed" },
    { type: "agent_end", status: "failed" },
  ]);
});

test("non-JSON diagnostics are ignored and counted", () => {
  const normalizer = createCodexNormalizer();

  normalizer.push("Reading additional input from stdin...");
  normalizer.push('{"type":"turn.started"}');
  normalizer.push("2026-11-05T09:15:53Z ERROR codex_core::tools::router: boom");
  normalizer.push('{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":2}}');

  assert.deepEqual(normalizer.end(), [
    { type: "turn_start" },
    {
      type: "turn_end",
      status: "ok",
      usage: {
        input: 1,
        cachedInput: 0,
        cacheWrite: 0,
        output: 2,
        reasoning: 0,
      },
    },
    { type: "agent_end", status: "ok" },
  ]);
  assert.equal(normalizer.ignoredLines, 2);
});

test("unknown records survive as diagnostic events", () => {
  const normalizer = createCodexNormalizer();

  normalizer.push('{"type":"thread.started","thread_id":"t"}');
  normalizer.push('{"type":"item.completed","item":{"id":"item_9","type":"mcp_tool_call"}}');
  normalizer.push('{"type":"future.event","payload":{"x":1}}');

  assert.deepEqual(normalizer.end(), [
    { type: "session_start", sessionId: "t" },
    {
      type: "unknown",
      rawType: "item.completed",
      payload: { id: "item_9", type: "mcp_tool_call" },
    },
    {
      type: "unknown",
      rawType: "future.event",
      payload: { type: "future.event", payload: { x: 1 } },
    },
    { type: "agent_end", status: "unknown" },
  ]);
});

test("item-level errors ride as error events, known benign warnings are counted away", () => {
  const normalizer = createCodexNormalizer();

  normalizer.push('{"type":"turn.started"}');
  normalizer.push(
    '{"type":"item.completed","item":{"id":"item_0","type":"error","message":"`--dangerously-bypass-hook-trust` is enabled. Enabled hooks may run without review for this invocation."}}',
  );
  normalizer.push(
    '{"type":"item.completed","item":{"id":"item_1","type":"error","message":"Model metadata for `cubicle-e2e-model` not found. Defaulting to fallback metadata."}}',
  );
  normalizer.push('{"type":"item.completed","item":{"id":"item_2","type":"error","message":"sandbox escape detected"}}');
  normalizer.push('{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":1}}');

  assert.deepEqual(normalizer.end(), [
    { type: "turn_start" },
    { type: "error", code: "codex_item_error", message: "sandbox escape detected" },
    {
      type: "turn_end",
      status: "ok",
      usage: { input: 1, cachedInput: 0, cacheWrite: 0, output: 1, reasoning: 0 },
    },
    { type: "agent_end", status: "ok" },
  ]);
  assert.equal(normalizer.warningLines, 2);
});

test("a command_execution that fails is an error-ended tool call, not a stream error", () => {
  const normalizer = createCodexNormalizer();

  normalizer.push('{"type":"item.started","item":{"id":"item_5","type":"command_execution","command":"exit 3","aggregated_output":"","exit_code":null,"status":"in_progress"}}');
  normalizer.push('{"type":"item.completed","item":{"id":"item_5","type":"command_execution","command":"exit 3","aggregated_output":"boom","exit_code":3,"status":"failed"}}');

  assert.deepEqual(normalizer.end(), [
    {
      type: "tool_execution_start",
      toolCallId: "item_5",
      toolName: "shell",
      args: { command: "exit 3" },
    },
    {
      type: "tool_execution_end",
      toolCallId: "item_5",
      toolName: "shell",
      isError: true,
      result: { output: "boom", exitCode: 3, status: "failed" },
    },
    { type: "agent_end", status: "unknown" },
  ]);
});

test("the sanitized live capture parses a successful tool call", async () => {
  const normalizer = createCodexNormalizer();

  for (const line of await fixtureLines(liveFixtureUrl)) {
    normalizer.push(line);
  }

  const events = normalizer.end();
  const toolEnd = events.find((event) => event.type === "tool_execution_end");
  const turnEnd = events.find((event) => event.type === "turn_end");

  assert.deepEqual(toolEnd, {
    type: "tool_execution_end",
    toolCallId: "item_1",
    toolName: "shell",
    isError: false,
    result: { output: "m0-codex\r\n", exitCode: 0, status: "completed" },
  });
  assert.deepEqual(turnEnd, {
    type: "turn_end",
    status: "ok",
    usage: {
      input: 30894,
      cachedInput: 29440,
      cacheWrite: 0,
      output: 111,
      reasoning: 0,
    },
  });
});
