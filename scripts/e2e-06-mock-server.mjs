import { lastUserText, startMockModelServer } from "./e2e-mock-model-server.mjs";

/**
 * Deterministic scripted employee for the ticket 06 acceptance run — the
 * shared M0-proven mock (scripts/e2e-mock-model-server.mjs) with a
 * ticket-specific plan table: the request path stays real pi SDK + HTTP/SSE.
 *
 * Three scenarios, chosen from the sentence the employee actually receives:
 *  - 首轮工单: write a WELCOME line (mixed case — it will get 打回) + commit;
 *  - 打回后迭代: the prompt carries 【打回意见】 → fix to lowercase + commit;
 *  - 慢活: a long streaming reply so 取消 has a live run to terminate.
 *
 * Every step inside the turn advances by how many tool results the CURRENT
 * turn already carries (a grown session keeps earlier turns' results).
 *
 * @typedef {import("./e2e-mock-model-server.mjs").ReplyFrame} ReplyFrame
 */

/** @param {any[]} messages */
function toolResultsInTurn(messages) {
  const lastIndex = messages.map((message) => message?.role).lastIndexOf("user");
  return messages.slice(lastIndex + 1).filter((message) => message?.role === "tool").length;
}

const FIRST_PLAN = /** @type {const} */ ([
  {
    say: "收到工单，先看一眼工作区。",
    tool: { id: "call_06_status", name: "powershell", args: '{"command":"git status --porcelain"}' },
  },
  {
    say: "给 greet.txt 加一行欢迎语。",
    tool: {
      id: "call_06_write_greet",
      name: "write",
      args: '{"path":"greet.txt","content":"hello\\nWelcome from Cubicle\\n"}',
    },
  },
  {
    say: "我自己提交这一单（不 push）。",
    tool: { id: "call_06_commit", name: "powershell", args: '{"command":"git add -A; git commit -m \\"feat: welcome line\\""}' },
  },
]);

const FIRST_REPORT = [
  { content: "收尾报告\n", pauseMs: 10 },
  { content: "完成：greet.txt 加了 Welcome from Cubicle。\n", pauseMs: 10 },
  { content: "变更：greet.txt（改），已 commit（feat: welcome line）。\n", pauseMs: 10 },
  { content: "未尽事项：无。", pauseMs: 10 },
  { finish: "stop" },
];

const REJECT_PLAN = /** @type {const} */ ([
  {
    say: "打回意见收到：欢迎语必须全小写。先确认历史。",
    tool: { id: "call_06_log", name: "powershell", args: '{"command":"git log --oneline -3"}' },
  },
  {
    say: "把欢迎语改成全小写。",
    tool: {
      id: "call_06_fix_greet",
      name: "write",
      args: '{"path":"greet.txt","content":"hello\\nwelcome from cubicle\\n"}',
    },
  },
  {
    say: "再提交一轮。",
    tool: { id: "call_06_commit2", name: "powershell", args: '{"command":"git add -A; git commit -m \\"fix: lowercase the welcome line\\""}' },
  },
]);

const REJECT_REPORT = [
  { content: "收尾报告\n", pauseMs: 10 },
  { content: "打回意见已处理：欢迎语改为全小写 welcome from cubicle。\n", pauseMs: 10 },
  { content: "变更：greet.txt（改），已 commit（fix: lowercase the welcome line）。\n", pauseMs: 10 },
  { content: "未尽事项：无。", pauseMs: 10 },
  { finish: "stop" },
];

/** Frames for the 慢活 scenario: streaming stays open long enough that 取消
 *  (abort) arrives while the run is still alive. */
function slowFrames() {
  /** @type {ReplyFrame[]} */
  const frames = [];
  for (let i = 1; i <= 14; i += 1) {
    frames.push({ content: `慢工 ${i}……`, pauseMs: 350 });
  }
  frames.push({ toolCall: { id: "call_06_sleep", name: "powershell", args: '{"command":"Start-Sleep -Seconds 3; echo slow-step"}' } });
  frames.push({ finish: "tool_calls" });
  return frames;
}

function slowTailFrames() {
  /** @type {ReplyFrame[]} */
  const frames = [];
  for (let i = 1; i <= 14; i += 1) {
    frames.push({ content: `续慢 ${i}……`, pauseMs: 350 });
  }
  frames.push({ content: "\n收尾报告：还没写完就被打断了。", pauseMs: 10 });
  frames.push({ finish: "stop" });
  return frames;
}

/**
 * @param {any[]} messages
 * @param {{ chunkPauseMs: number }} options
 * @returns {{ frames: ReplyFrame[], slow?: boolean }}
 */
export function planReply06(messages, { chunkPauseMs }) {
  const user = lastUserText(messages);
  const step = toolResultsInTurn(messages);

  if (user.includes("慢")) {
    if (step === 0) return { frames: slowFrames(), slow: true };
    return { frames: slowTailFrames(), slow: true };
  }

  const plan = user.includes("打回意见") ? REJECT_PLAN : FIRST_PLAN;
  const report = user.includes("打回意见") ? REJECT_REPORT : FIRST_REPORT;
  if (step >= plan.length) {
    return { frames: report };
  }
  const entry = plan[step];
  return {
    frames: [
      { content: entry.say, pauseMs: chunkPauseMs },
      { toolCall: entry.tool, pauseMs: chunkPauseMs },
      { finish: "tool_calls" },
    ],
  };
}

/**
 * @param {{ chunkPauseMs?: number }} [options]
 */
export async function startMockModelServer06({ chunkPauseMs = 10 } = {}) {
  return startMockModelServer({
    planReply: planReply06,
    completionPrefix: "chatcmpl-e2e-06",
    chunkPauseMs,
  });
}
