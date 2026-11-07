import { lastUserText, startMockModelServer } from "./e2e-mock-model-server.mjs";

/**
 * Deterministic scripted employee for the ticket 09 acceptance run — the
 * shared mock (scripts/e2e-mock-model-server.mjs) with a ticket-09 plan:
 * the 慢活 NEVER ends on its own: one ~1.3s beat (text + powershell sleep 1)
 * forever, until the host clock-out aborts it. That is exactly the property
 * the ticket tests — 下班宽限内工具照常、宽限到期 abort、暂停后 0 新工具调用、
 * 上班续跑工具恢复。
 *
 * @typedef {import("./e2e-mock-model-server.mjs").ReplyFrame} ReplyFrame
 */

/** @param {any[]} messages */
function toolResultsInTurn(messages) {
  const lastIndex = messages.map((message) => message?.role).lastIndexOf("user");
  return messages.slice(lastIndex + 1).filter((message) => message?.role === "tool").length;
}

/**
 * @param {any[]} messages
 * @param {{ chunkPauseMs: number }} options
 * @returns {{ frames: ReplyFrame[], slow?: boolean }}
 */
export function planReply09(messages, { chunkPauseMs }) {
  const user = lastUserText(messages);
  if (!user.includes("慢")) {
    return { frames: [{ content: "收到。", pauseMs: chunkPauseMs }, { finish: "stop" }] };
  }
  const step = toolResultsInTurn(messages);
  /** @type {ReplyFrame[]} */
  const frames = [
    { content: `慢工节拍 ${step + 1}……`, pauseMs: 200 },
    {
      toolCall: {
        id: `call_09_beat_${step + 1}`,
        name: "powershell",
        args: '{"command":"Start-Sleep -Seconds 1; echo tick"}',
      },
    },
    { finish: "tool_calls" },
  ];
  return { frames, slow: true };
}

/**
 * @param {{ chunkPauseMs?: number }} [options]
 */
export async function startMockModelServer09({ chunkPauseMs = 10 } = {}) {
  return startMockModelServer({
    planReply: planReply09,
    completionPrefix: "chatcmpl-e2e-09",
    chunkPauseMs,
  });
}
