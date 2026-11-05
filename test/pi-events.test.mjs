import assert from "node:assert/strict";
import { test } from "node:test";

import { normalizePiEvent } from "../spike/lib/pi-events.mjs";

test("pi text and thinking deltas keep their text", () => {
  assert.deepEqual(
    normalizePiEvent({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "hello" },
    }),
    [{ type: "text_delta", text: "hello" }],
  );
  assert.deepEqual(
    normalizePiEvent({
      type: "message_update",
      assistantMessageEvent: { type: "thinking_delta", delta: "thinking..." },
    }),
    [{ type: "thinking_delta", text: "thinking..." }],
  );
});

test("pi tool boundaries keep the call id and tool name", () => {
  assert.deepEqual(
    normalizePiEvent({
      type: "tool_execution_start",
      toolCallId: "call_1",
      toolName: "read",
      args: { path: "hello.txt" },
    }),
    [
      {
        type: "tool_execution_start",
        toolCallId: "call_1",
        toolName: "read",
        args: { path: "hello.txt" },
      },
    ],
  );

  assert.deepEqual(
    normalizePiEvent({
      type: "tool_execution_end",
      toolCallId: "call_1",
      toolName: "read",
      isError: false,
      result: { content: [] },
    }),
    [
      {
        type: "tool_execution_end",
        toolCallId: "call_1",
        toolName: "read",
        isError: false,
        result: { content: [] },
      },
    ],
  );
});

test("pi agent_settled is the single terminal event", () => {
  assert.deepEqual(normalizePiEvent({ type: "agent_settled", aborted: false }), [
    { type: "agent_end", status: "ok" },
  ]);
  assert.deepEqual(normalizePiEvent({ type: "agent_settled", aborted: true }), [
    { type: "agent_end", status: "failed" },
  ]);
  assert.deepEqual(normalizePiEvent({ type: "agent_end", willRetry: true, messages: [] }), []);
});

test("failed pi turns are visible in turn_end status", () => {
  assert.deepEqual(normalizePiEvent({ type: "turn_end", message: { stopReason: "error" }, toolResults: [] }), [
    { type: "turn_end", status: "failed" },
  ]);
  assert.deepEqual(normalizePiEvent({ type: "turn_end", message: { stopReason: "stop" }, toolResults: [] }), [
    { type: "turn_end", status: "ok" },
  ]);
});

test("pi turn_end carries provider usage when present", () => {
  assert.deepEqual(
    normalizePiEvent({
      type: "turn_end",
      message: {
        stopReason: "stop",
        usage: { input: 12, output: 3, cacheRead: 4, cacheWrite: 5, totalTokens: 24 },
      },
      toolResults: [],
    }),
    [
      {
        type: "turn_end",
        status: "ok",
        usage: { input: 12, cachedInput: 4, cacheWrite: 5, output: 3, reasoning: 0 },
      },
    ],
  );
});

test("pi events outside the contract surface as unknown", () => {
  assert.deepEqual(normalizePiEvent({ type: "future_event", value: 1 }), [
    { type: "unknown", rawType: "future_event", payload: { type: "future_event", value: 1 } },
  ]);
  assert.deepEqual(normalizePiEvent({ type: "message_end", message: { role: "assistant" } }), []);
});
