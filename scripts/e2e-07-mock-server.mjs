import { startMockModelServer as startSharedMockServer, lastUserText, answeredThisTurn } from "./e2e-mock-model-server.mjs";

/**
 * Ticket 07's scripted model side: one deterministic scenario per sentence.
 * The acceptance runner sends these exact sentences, so the工位动画 run is
 * driven by a fixed sequence of REAL tool executions (read/write/bash in the
 * employee's private workspace) — including a policy-blocked one.
 *
 * Scenario table (last user text → this turn's first reply):
 *   读一下     → read hello.txt
 *   写一份     → write weekly-draft.md
 *   跑一条命令 → powershell echo…               (执行)
 *   测试要过   → powershell node test_ok.mjs     (测试 · 绿)
 *   测试要挂   → powershell node test_fail.mjs   (测试 · 红 — non-zero exit → isError)
 *   危险命令   → powershell Remove-Item -Recurse -Force (策略拦截 → 可见拒绝提示)
 * once this turn's tool result is in, every scenario answers with text.
 *
 * @typedef {import("./e2e-mock-model-server.mjs").MockModelServer} MockModelServer
 */

/** @type {readonly { marker: string, tool?: { name: string, args: string }, doneText: string }[]} */
const SCENARIOS = [
  { marker: "读一下", tool: { name: "read", args: '{"path":"hello.txt"}' }, doneText: "读完了，里面写着 hello from e2e fixture。" },
  { marker: "写一份", tool: { name: "write", args: '{"path":"weekly-draft.md","content":"周报草稿 v1：工位动画上线了。"}' }, doneText: "周报草稿已经写进 weekly-draft.md。" },
  { marker: "跑一条命令", tool: { name: "powershell", args: '{"command":"echo building; echo done"}' }, doneText: "命令跑完了。" },
  { marker: "测试要过", tool: { name: "powershell", args: '{"command":"node test_ok.mjs"}' }, doneText: "测试全部通过。" },
  { marker: "测试要挂", tool: { name: "powershell", args: '{"command":"node test_fail.mjs"}' }, doneText: "测试挂了，我先看看输出。" },
  { marker: "危险命令", tool: { name: "powershell", args: '{"command":"Remove-Item -Recurse -Force important.txt"}' }, doneText: "这条命令被拦下了，我不会去删 important.txt。" },
];

let callSeq = 0;

/**
 * The closing answer for a turn, streamed over several frames: the gap
 * between the tool finishing and agent settling is where the工位 screen
 * holds the tool's picture (读/写/执行/测试 + 红/绿 tone) — the acceptance
 * samples the DOM on ~60ms ticks, so the mock deliberately lets that window
 * last a few hundred ms instead of answering instantly.
 *
 * @param {string} text
 * @param {number} chunkPauseMs
 */
function closing(text, chunkPauseMs) {
  const half = Math.ceil(text.length / 2);
  return [
    { content: text.slice(0, half), pauseMs: chunkPauseMs },
    { content: text.slice(half), pauseMs: chunkPauseMs },
    { content: "就这样。", pauseMs: chunkPauseMs },
    { finish: "stop" },
  ];
}

/**
 * @param {any[]} messages
 * @param {{ chunkPauseMs: number }} options
 * @returns {{ frames: import("./e2e-mock-model-server.mjs").ReplyFrame[], slow?: boolean }}
 */
function planReply(messages, { chunkPauseMs }) {
  const asked = lastUserText(messages);
  const scenario = SCENARIOS.find((entry) => asked.includes(entry.marker));
  const closingFrames = (/** @type {string} */ text) => closing(text, chunkPauseMs);

  if (!scenario) return { frames: closingFrames("收到。") };
  if (answeredThisTurn(messages) || !scenario.tool) return { frames: closingFrames(scenario.doneText) };

  callSeq += 1;
  return {
    frames: [
      { content: `好的，我${scenario.marker.replace(/[。.]$/, "")}。`, pauseMs: chunkPauseMs },
      {
        toolCall: { id: `call_e2e07_${callSeq}`, name: scenario.tool.name, args: scenario.tool.args },
        pauseMs: 10,
      },
      { finish: "tool_calls" },
    ],
  };
}

/**
 * @param {{ chunkPauseMs?: number }} [options]
 * @returns {Promise<MockModelServer>}
 */
export async function startMockModelServer({ chunkPauseMs = 10 } = {}) {
  return startSharedMockServer({
    planReply,
    completionPrefix: "chatcmpl-e2e-07",
    chunkPauseMs,
  });
}
