import assert from "node:assert/strict";
import { test } from "node:test";

import { normalizePiEvent } from "../src/host/engine/pi/normalize.mjs";

// The pi event shapes below are literals captured from the M0 spike's live
// pi 1.5.0 session (docs/spike-m0.md §2) — an independent source of truth
// for the mapping, not recomputed from the implementation.

test("message_update carries token-level text and thinking deltas", () => {
  assert.deepEqual(
    normalizePiEvent({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "Reading " },
    }),
    [{ type: "text_delta", text: "Reading " }],
  );
  assert.deepEqual(
    normalizePiEvent({
      type: "message_update",
      assistantMessageEvent: { type: "thinking_delta", delta: "先读文件…" },
    }),
    [{ type: "thinking_delta", text: "先读文件…" }],
  );
  // other assistantMessageEvent kinds (toolcall_*) ride on other raw events
  assert.deepEqual(
    normalizePiEvent({ type: "message_update", assistantMessageEvent: { type: "text_start" } }),
    [],
  );
});

test("tool execution boundaries keep id, tool name, args and outcome", () => {
  assert.deepEqual(
    normalizePiEvent({
      type: "tool_execution_start",
      toolCallId: "call_spike_read",
      toolName: "read",
      args: { path: "hello.txt" },
    }),
    [{ type: "tool_execution_start", toolCallId: "call_spike_read", toolName: "read", args: { path: "hello.txt" } }],
  );
  assert.deepEqual(
    normalizePiEvent({
      type: "tool_execution_end",
      toolCallId: "call_spike_read",
      toolName: "read",
      isError: true,
      result: { error: "ENOENT" },
    }),
    [{ type: "tool_execution_end", toolCallId: "call_spike_read", toolName: "read", isError: true, result: { error: "ENOENT" } }],
  );
});

test("agent_settled is the single terminal event; aborted settles as failed", () => {
  assert.deepEqual(normalizePiEvent({ type: "agent_settled", aborted: false }), [
    { type: "agent_end", status: "ok" },
  ]);
  assert.deepEqual(normalizePiEvent({ type: "agent_settled", aborted: true }), [
    { type: "agent_end", status: "failed" },
  ]);
  // agent_end in pi can be followed by retries — it must NOT terminate a run
  assert.deepEqual(normalizePiEvent({ type: "agent_end", willRetry: false, messages: [] }), []);
});

test("turn boundaries report status and usage", () => {
  assert.deepEqual(normalizePiEvent({ type: "turn_start" }), [{ type: "turn_start" }]);
  assert.deepEqual(
    normalizePiEvent({ type: "turn_end", message: { stopReason: "stop" }, toolResults: [] }),
    [{ type: "turn_end", status: "ok" }],
  );
  assert.deepEqual(
    normalizePiEvent({ type: "turn_end", message: { stopReason: "aborted" }, toolResults: [] }),
    [{ type: "turn_end", status: "failed" }],
  );
  assert.deepEqual(
    normalizePiEvent({
      type: "turn_end",
      message: {
        stopReason: "stop",
        usage: { input: 42, output: 7, cacheRead: 3, cacheWrite: 1, reasoning: 2 },
      },
      toolResults: [],
    }),
    [{ type: "turn_end", status: "ok", usage: { input: 42, cachedInput: 3, cacheWrite: 1, output: 7, reasoning: 2 } }],
  );
});

test("票 12: pi 的全 0 usage 占位（provider 没报）折叠成「没报」，不是 0", () => {
  // pi's assistant-message shell starts with an all-zero usage placeholder; a
  // provider that never reports usage leaves it at zero. Folding that as a
  // real 0 would make 「未计量」 engines lie — 06 principle: never invent.
  assert.deepEqual(
    normalizePiEvent({
      type: "turn_end",
      message: {
        stopReason: "stop",
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 },
      },
      toolResults: [],
    }),
    [{ type: "turn_end", status: "ok" }],
  );
  // a single non-zero number is a report — it must survive
  assert.deepEqual(
    normalizePiEvent({
      type: "turn_end",
      message: { stopReason: "stop", usage: { input: 0, output: 3, cacheRead: 0, cacheWrite: 0, reasoning: 0 } },
      toolResults: [],
    }),
    [{ type: "turn_end", status: "ok", usage: { input: 0, cachedInput: 0, cacheWrite: 0, output: 3, reasoning: 0 } }],
  );
});

test("chatty pi bookkeeping events are ignored, unknown ones surface", () => {
  for (const raw of [
    { type: "message_start", message: { role: "assistant" } },
    { type: "message_end", message: { role: "assistant" } },
    { type: "tool_execution_update", toolCallId: "c1", progress: 1 },
    { type: "compaction_start" },
    { type: "auto_retry_start", attempt: 1 },
    { type: "queue_update", length: 0 },
    { type: "session_info_changed", name: "x" },
    { type: "model_select", provider: "p", modelId: "m" },
  ]) {
    assert.deepEqual(normalizePiEvent(raw), [], `expected ${raw.type} to be ignored`);
  }
  assert.deepEqual(normalizePiEvent({ type: "yet_unknown_event", value: 9 }), [
    { type: "unknown", rawType: "yet_unknown_event", payload: { type: "yet_unknown_event", value: 9 } },
  ]);
  assert.deepEqual(normalizePiEvent(null), [{ type: "unknown", rawType: "invalid", payload: null }]);
});
