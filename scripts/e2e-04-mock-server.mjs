import { startMockModelServer as startSharedMockServer } from "./e2e-mock-model-server.mjs";

/**
 * Ticket 04's scripted model side on top of the shared mock-model transport
 * (scripts/e2e-mock-model-server.mjs). Scripted behaviour, kept verbatim:
 *  - newest user text contains 慢慢念 → a SLOW, long answer, so the run is
 *    still mid-flight when the acceptance clicks 中止;
 *  - messages already carry a `tool` result → the final answer;
 *  - otherwise → some text, then a `read hello.txt` tool call.
 *
 * @typedef {import("./e2e-mock-model-server.mjs").MockModelServer} MockModelServer
 */

const SLOW_MARKER = "慢慢念";

/**
 * The reply plan for one chat completion request (ticket 04 semantics —
 * exactly as it shipped, including the session-wide `answered` check).
 *
 * @param {any[]} messages
 * @param {{ chunkPauseMs: number }} options
 * @returns {{ frames: import("./e2e-mock-model-server.mjs").ReplyFrame[], slow: boolean }}
 */
function planReply(messages, { chunkPauseMs }) {
  const lastUser = contentText([...messages].reverse().find((message) => message?.role === "user"));
  if (lastUser.includes(SLOW_MARKER)) {
    const frames = [];
    for (let i = 1; i <= 40; i += 1) {
      frames.push({ content: `第${i}段…`, pauseMs: 300 });
    }
    frames.push({ finish: "stop" });
    return { frames, slow: true };
  }

  const answered = messages.some((message) => message?.role === "tool");
  if (answered) {
    return {
      slow: false,
      frames: [
        { content: "文件里写着：", pauseMs: chunkPauseMs },
        { content: "hello from e2e fixture", pauseMs: chunkPauseMs },
        { content: "。", pauseMs: chunkPauseMs },
        { finish: "stop" },
      ],
    };
  }

  return {
    slow: false,
    frames: [
      { content: "好的，我先", pauseMs: chunkPauseMs },
      { content: "读一下 hello.txt", pauseMs: chunkPauseMs },
      { content: "。", pauseMs: chunkPauseMs },
      {
        toolCall: { id: "call_e2e_read", name: "read", args: '{"path":"hello.txt"}' },
        pauseMs: chunkPauseMs,
      },
      { finish: "tool_calls" },
    ],
  };
}

/** Flatten a message's content (string or parts) — same as the shared helper. @param {any} message */
function contentText(message) {
  const content = message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part) => (typeof part?.text === "string" ? part.text : "")).join("");
  }
  return "";
}

/**
 * @param {{ chunkPauseMs?: number }} [options]
 * @returns {Promise<MockModelServer>}
 */
export async function startMockModelServer({ chunkPauseMs = 10 } = {}) {
  return startSharedMockServer({
    planReply,
    completionPrefix: "chatcmpl-e2e-04",
    chunkPauseMs,
  });
}
