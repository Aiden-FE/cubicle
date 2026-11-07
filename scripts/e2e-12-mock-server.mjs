import { lastUserText, startMockModelServer } from "./e2e-mock-model-server.mjs";

/**
 * Scripted employees for the ticket 12 acceptance run — the shared mock
 * (scripts/e2e-mock-model-server.mjs) with a ticket-specific plan table.
 * Three stories, chosen from the sentence the employee actually receives:
 *
 *  - 正常活（重试剧本的第二轮）: write the welcome line + commit — same shape
 *    as ticket 06 so the retry round lands real commits and four artifacts;
 *  - 烧钱: every completion bills a fixed chunk (usage on the SSE frame) so
 *    the per-task soft gate crosses 80% (yellow dot), then 100% (auto-pause);
 *    after 「+50%」 the RESUME turn (prompt carries 「预算已被提到」) runs a
 *    cheap plan so the task finishes under the raised budget;
 *  - 未计量: the provider reports NOTHING (usage: null → no usage frame) —
 *    pi's zero placeholder must surface as 「未计量」, never a 0.
 *
 * @typedef {import("./e2e-mock-model-server.mjs").ReplyFrame} ReplyFrame
 */

/** @param {any[]} messages */
function toolResultsInTurn(messages) {
  const lastIndex = messages.map((message) => message?.role).lastIndexOf("user");
  return messages.slice(lastIndex + 1).filter((message) => message?.role === "tool").length;
}

// — 正常活 / 重试后的第二轮 (ticket 06 shape) —

const WORK_PLAN = [
  {
    say: "收到工单，先看一眼工作区。",
    tool: { id: "call_12_status", name: "powershell", args: '{"command":"git status --porcelain"}' },
  },
  {
    say: "给 greet.txt 加一行欢迎语。",
    tool: { id: "call_12_write", name: "write", args: '{"path":"greet.txt","content":"hello\\nwelcome from cubicle retry\\n"}' },
  },
  {
    say: "我自己提交这一单（不 push）。",
    tool: { id: "call_12_commit", name: "powershell", args: '{"command":"git add -A; git commit -m \\"feat: ticket12 welcome\\""}' },
  },
];

const WORK_REPORT = [
  { content: "收尾报告\n", pauseMs: 10 },
  { content: "完成：greet.txt 加了 welcome from cubicle retry，已 commit。\n", pauseMs: 10 },
  { finish: "stop" },
];

// — 烧钱 (budget soft gate) —
// Per-completion bills (usage frames): 160 → 250 (cum 410 ≥ 80% of 500:
// yellow dot) → 120 (cum 530 ≥ 500: exhausted, host pauses the run).
const BURN_STEPS = [
  {
    say: "第一步：数一遍 token。",
    tool: { id: "call_12_burn1", name: "powershell", args: '{"command":"echo burn-step-1"}' },
    usage: { prompt_tokens: 150, completion_tokens: 10, total_tokens: 160 },
  },
  {
    say: "第二步：再数一遍。",
    tool: { id: "call_12_burn2", name: "powershell", args: '{"command":"echo burn-step-2"}' },
    usage: { prompt_tokens: 230, completion_tokens: 20, total_tokens: 250 },
  },
  {
    say: "第三步：继续烧。",
    tool: { id: "call_12_burn3", name: "powershell", args: '{"command":"echo burn-step-3"}' },
    usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
  },
];

// After 「+50%」 the resume prompt carries 【预算】…从中断处继续 — the cheap
// plan lets the task settle UNDER the raised budget (530 + 60 < 750).
// (needle 与服务层 budgetResumePrompt 的原文对齐：「预算已被老板提到 750」
// 并不含「预算已被提到」，别再用那个半截短语。)
const BURN_RESUME_PLAN = [
  {
    say: "预算提到 750 了：小心收尾。",
    tool: { id: "call_12_burn4", name: "powershell", args: '{"command":"echo wrap-up"}' },
    usage: { prompt_tokens: 30, completion_tokens: 10, total_tokens: 40 },
  },
];

const BURN_REPORT = [
  { content: "收尾报告\n", pauseMs: 10 },
  { content: "烧钱工单完成：每一步的 token 都按账上报。\n", pauseMs: 10 },
  { finish: "stop" },
];

// — 未计量 (no usage frame at all) —

const UNMEASURED_PLAN = [
  {
    say: "这台引擎不报 token，我只干活。",
    tool: { id: "call_12_unmeasured", name: "powershell", args: '{"command":"echo unmeasured-step"}' },
  },
];

const UNMEASURED_REPORT = [
  { content: "收尾报告\n", pauseMs: 10 },
  { content: "未计量引擎的活干完了：账上应该显示「未计量」。", pauseMs: 10 },
  { finish: "stop" },
];

/**
 * @param {any[]} messages
 * @param {{ chunkPauseMs: number }} options
 * @returns {{ frames: ReplyFrame[], usage?: { prompt_tokens: number, completion_tokens: number, total_tokens: number } | null }}
 */
export function planReply12(messages, { chunkPauseMs }) {
  const user = lastUserText(messages);
  const step = toolResultsInTurn(messages);

  if (user.includes("未计量")) {
    if (step === 0) return { frames: stepFrames(UNMEASURED_PLAN[0], chunkPauseMs), usage: null };
    return { frames: UNMEASURED_REPORT, usage: null };
  }

  if (user.includes("烧钱")) {
    if (user.includes("从中断处继续")) {
      if (step === 0) return { frames: stepFrames(BURN_RESUME_PLAN[0], chunkPauseMs), usage: BURN_RESUME_PLAN[0].usage };
      return { frames: BURN_REPORT, usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } };
    }
    if (step < BURN_STEPS.length) return { frames: stepFrames(BURN_STEPS[step], chunkPauseMs), usage: BURN_STEPS[step].usage };
    return { frames: BURN_REPORT, usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } };
  }

  if (step >= WORK_PLAN.length) return { frames: WORK_REPORT };
  return { frames: stepFrames(WORK_PLAN[step], chunkPauseMs) };
}

/** @param {{ say: string, tool: { id: string, name: string, args: string } }} entry @param {number} chunkPauseMs */
function stepFrames(entry, chunkPauseMs) {
  return [
    { content: entry.say, pauseMs: chunkPauseMs },
    { toolCall: entry.tool, pauseMs: chunkPauseMs },
    { finish: "tool_calls" },
  ];
}

/**
 * @param {{ chunkPauseMs?: number }} [options]
 */
export async function startMockModelServer12({ chunkPauseMs = 120 } = {}) {
  return startMockModelServer({
    planReply: planReply12,
    completionPrefix: "chatcmpl-e2e-12",
    chunkPauseMs,
  });
}

/**
 * The two models.json shapes the runner swaps BETWEEN runs: the adapter
 * re-reads engines/pi/ on every open, so "坏模型路径" needs no restart —
 * removing the provider makes pickModel throw engine_model_missing, which
 * the app must surface as a human sentence (票 12 验收 1).
 *
 * @param {string} baseUrl
 * @param {boolean} healthy
 * @returns {string}
 */
export function modelsJson(baseUrl, healthy) {
  const providers = healthy
    ? {
        cubicle: {
          name: "Cubicle E2E",
          baseUrl,
          api: "openai-completions",
          apiKey: "e2e-local-key",
          models: [
            {
              type: "chat",
              id: "cubicle-e2e-model",
              name: "E2E Model",
              reasoning: false,
              input: ["text"],
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              contextWindow: 128000,
              maxTokens: 8192,
            },
          ],
        },
      }
    : {
        // 坏配置：provider 键换了名字 — adapter 的 pickModel 找不到 cubicle 的
        // 模型 → engine_model_missing（错误事件的人话来源）。
        cubicle_broken: {
          name: "Cubicle E2E (broken)",
          baseUrl,
          api: "openai-completions",
          apiKey: "e2e-local-key",
          models: [
            {
              type: "chat",
              id: "cubicle-e2e-model",
              name: "E2E Model",
              reasoning: false,
              input: ["text"],
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              contextWindow: 128000,
              maxTokens: 8192,
            },
          ],
        },
      };
  return `${JSON.stringify(
    {
      $schema: "https://pi.dev/schemas/models.schema.json",
      providers,
    },
    null,
    2,
  )}\n`;
}
