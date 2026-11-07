import test from "node:test";
import assert from "node:assert/strict";

import { explainRunFailure } from "../src/host/engine/failure.mjs";

/**
 * 票 12 验收 1：失败显示人话原因（不是堆栈）。
 * explainRunFailure 是纯折叠函数：run 收尾状态 + 归一化事件尾巴 → 一句人话。
 * 断言只钉「人话里必须出现的字」与「绝不能出现的堆栈痕迹」，不钉整句措辞。
 */

/** Explain a failure and pin that an explanation exists (tests want the string). */
function explain(
  /** @type {{ status: "completed" | "aborted" | "failed" | "interrupted" | "paused", events: any[] }} */ facts,
) {
  const reason = explainRunFailure(facts);
  assert.notEqual(reason, null, "expected a human sentence, got none");
  return /** @type {string} */ (reason);
}

test("completed and paused runs need no failure explanation", () => {
  assert.equal(explainRunFailure({ status: "completed", events: [{ type: "agent_end", status: "ok" }] }), null);
  assert.equal(explainRunFailure({ status: "paused", events: [] }), null);
});

test("a cancelled run reads as 已取消, not as a crash", () => {
  const reason = explain({
    status: "aborted",
    events: [{ type: "agent_end", status: "failed" }],
  });
  assert.match(reason, /已取消/);
});

test("a known engine code becomes its own human sentence (bad model path)", () => {
  const reason = explain({
    status: "failed",
    events: [
      { type: "error", code: "engine_model_missing", message: "model cubicle/ghost is not configured" },
      { type: "agent_end", status: "failed" },
    ],
  });
  assert.match(reason, /模型/);
  assert.match(reason, /engine_model_missing/);
  // 人话而不是堆栈：没有 at 帧、没有多行栈
  assert.doesNotMatch(reason, /\n\s+at /);
});

test("engine_not_configured says the engine has no model config yet", () => {
  const reason = explain({
    status: "failed",
    events: [{ type: "error", code: "engine_not_configured", message: "引擎中心尚未配置模型" }, { type: "agent_end", status: "failed" }],
  });
  assert.match(reason, /引擎/);
  assert.match(reason, /配置/);
});

test("an unknown error code keeps the code and its message (traceable, still one line)", () => {
  const reason = explain({
    status: "failed",
    events: [{ type: "error", code: "weird_engine_code", message: "some provider detail" }, { type: "agent_end", status: "failed" }],
  });
  assert.match(reason, /weird_engine_code/);
  assert.match(reason, /some provider detail/);
  assert.doesNotMatch(reason, /\n/);
});

test("an engine that settled without agent_end says so in words", () => {
  const reason = explain({ status: "failed", events: [{ type: "session_start", sessionId: "1" }] });
  assert.match(reason, /没有回音|没有收尾/);
});

test("a failed turn without an error event points at the model-side stop", () => {
  const reason = explain({
    status: "failed",
    events: [{ type: "turn_end", status: "failed" }, { type: "agent_end", status: "failed" }],
  });
  assert.match(reason, /引擎|模型/);
  assert.match(reason, /失败/);
});

test("the LAST error event wins when several arrive", () => {
  const reason = explain({
    status: "failed",
    events: [
      { type: "error", code: "engine_not_configured", message: "先一个" },
      { type: "error", code: "engine_model_missing", message: "后一个" },
      { type: "agent_end", status: "failed" },
    ],
  });
  assert.match(reason, /engine_model_missing/);
  assert.doesNotMatch(reason, /engine_not_configured/);
});
