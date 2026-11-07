import { lastUserText, startMockModelServer } from "./e2e-mock-model-server.mjs";

/**
 * Deterministic scripted employee for the ticket 08 acceptance run — the
 * shared mock (scripts/e2e-mock-model-server.mjs) with a ticket-08 plan:
 *  - 快活工单: write WELCOME + commit + 收尾报告 (gets 通过 → 档案);
 *  - 慢活: three tool beats (each ~1.9s content + 3s powershell sleep) then
 *    a report — long enough that the 公司 A → 公司 B → 公司 A round trip
 *    happens WHILE the run streams, and fresh tool events keep arriving
 *    after the view returns (工位 busy again without any replay).
 *
 * @typedef {import("./e2e-mock-model-server.mjs").ReplyFrame} ReplyFrame
 */

/** @param {any[]} messages */
function toolResultsInTurn(messages) {
  const lastIndex = messages.map((message) => message?.role).lastIndexOf("user");
  return messages.slice(lastIndex + 1).filter((message) => message?.role === "tool").length;
}

const WORK_PLAN = /** @type {const} */ ([
  {
    say: "收到工单，先看一眼工作区。",
    tool: { id: "call_08_status", name: "powershell", args: '{"command":"git status --porcelain"}' },
  },
  {
    say: "给 greet.txt 加一行欢迎语。",
    tool: {
      id: "call_08_write_greet",
      name: "write",
      args: '{"path":"greet.txt","content":"hello\\nWelcome from Cubicle\\n"}',
    },
  },
  {
    say: "我自己提交这一单（不 push）。",
    tool: { id: "call_08_commit", name: "powershell", args: '{"command":"git add -A; git commit -m \\"feat: welcome line\\""}' },
  },
]);

const WORK_REPORT = [
  { content: "收尾报告\n", pauseMs: 10 },
  { content: "完成：greet.txt 加了 Welcome from Cubicle，已 commit。\n", pauseMs: 10 },
  { content: "未尽事项：无。", pauseMs: 10 },
  { finish: "stop" },
];

/** @param {number} index */
function sleepTool(index) {
  return {
    toolCall: {
      id: `call_08_sleep_${index}`,
      name: "powershell",
      args: '{"command":"Start-Sleep -Seconds 3; echo slow-step"}',
    },
  };
}

const SLOW_BEATS = 3;

/**
 * @param {any[]} messages
 * @param {{ chunkPauseMs: number }} options
 * @returns {{ frames: ReplyFrame[], slow?: boolean }}
 */
export function planReply08(messages, { chunkPauseMs }) {
  const user = lastUserText(messages);
  const step = toolResultsInTurn(messages);

  if (user.includes("慢")) {
    if (step >= SLOW_BEATS) {
      return {
        frames: [
          { content: "文档慢慢写完。\n", pauseMs: 400 },
          { content: "收尾报告：慢工出细活，写完了。", pauseMs: 10 },
          { finish: "stop" },
        ],
        slow: true,
      };
    }
    /** @type {ReplyFrame[]} */
    const frames = [];
    for (let i = 1; i <= 3; i += 1) {
      frames.push({ content: `慢工第 ${step + 1} 拍 ${i}……`, pauseMs: 450 });
    }
    frames.push(sleepTool(step));
    frames.push({ finish: "tool_calls" });
    return { frames, slow: true };
  }

  if (step >= WORK_PLAN.length) {
    return { frames: WORK_REPORT };
  }
  const entry = WORK_PLAN[step];
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
export async function startMockModelServer08({ chunkPauseMs = 10 } = {}) {
  return startMockModelServer({
    planReply: planReply08,
    completionPrefix: "chatcmpl-e2e-08",
    chunkPauseMs,
  });
}
