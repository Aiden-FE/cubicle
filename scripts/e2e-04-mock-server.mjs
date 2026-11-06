import { createServer } from "node:http";
import { setTimeout as sleepFrames } from "node:timers/promises";

/**
 * Deterministic OpenAI-compatible model endpoint for the ticket 04
 * acceptance run — the M0-proven trick: the request path stays real pi SDK
 * + HTTP/SSE, only the model side is scripted.
 *
 * The reply for each request is planned up front as a list of SSE frames
 * (text deltas, one tool call, the finish reason), then streamed with small
 * pauses — so the script reads as data, not as callback soup.
 *
 * Scripted behaviour:
 *  - newest user text contains 慢慢念 → a SLOW, long answer, so the run is
 *    still mid-flight when the acceptance clicks 中止;
 *  - messages already carry a `tool` result → the final answer;
 *  - otherwise → some text, then a `read hello.txt` tool call.
 *
 * @typedef {object} MockModelServer
 * @property {string} baseUrl
 * @property {() => Promise<void>} close
 * @property {Array<{ messageCount: number, hasToolResult: boolean, slow: boolean, userPreview: string }>} requests
 *
 * @typedef {{ content?: string, toolCall?: { id: string, name: string, args: string }, finish?: string, pauseMs?: number }} ReplyFrame
 */

const MODEL_ID = "cubicle-e2e-model";
const SLOW_MARKER = "慢慢念";

/**
 * The reply plan for one chat completion request.
 *
 * @param {any[]} messages
 * @param {{ chunkPauseMs: number }} options
 * @returns {{ frames: ReplyFrame[], slow: boolean }}
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

/**
 * Flatten a message's content (string or content-part array) to text.
 *
 * @param {any} message
 * @returns {string}
 */
function contentText(message) {
  const content = message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part) => (typeof part?.text === "string" ? part.text : "")).join("");
  }
  return "";
}

/**
 * @param {string} completionId
 * @param {ReplyFrame} frame
 * @returns {string} one SSE `data:` line
 */
function frameToSse(completionId, frame) {
  /** @type {{ role: string, content?: string, tool_calls?: Array<{ index: number, id: string, type: string, function: { name: string, arguments: string } }> }} */
  const delta = { role: "assistant" };
  if (frame.content !== undefined) delta.content = frame.content;
  if (frame.toolCall) {
    delta.tool_calls = [
      {
        index: 0,
        id: frame.toolCall.id,
        type: "function",
        function: { name: frame.toolCall.name, arguments: frame.toolCall.args },
      },
    ];
  }
  const body = {
    id: completionId,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: MODEL_ID,
    choices: [{ index: 0, delta, finish_reason: frame.finish ?? null }],
  };
  return `data: ${JSON.stringify(body)}\n\n`;
}

/**
 * @param {import("node:http").IncomingMessage} req
 * @returns {Promise<string>}
 */
async function readBody(req) {
  const parts = [];
  for await (const part of req) {
    parts.push(Buffer.isBuffer(part) ? part : Buffer.from(part));
  }
  return Buffer.concat(parts).toString("utf8");
}

/**
 * @param {{ chunkPauseMs?: number }} [options]
 * @returns {Promise<MockModelServer>}
 */
export async function startMockModelServer({ chunkPauseMs = 10 } = {}) {
  /** @type {MockModelServer["requests"]} */
  const requests = [];
  let completionSeq = 0;

  const server = createServer(async (req, res) => {
    if (req.method !== "POST" || !req.url?.endsWith("/chat/completions")) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: `unexpected ${req.method} ${req.url}` } }));
      return;
    }

    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "invalid JSON body" } }));
      return;
    }

    /** @type {any[]} */
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const hasToolResult = messages.some((message) => message?.role === "tool");
    const { frames, slow } = planReply(messages, { chunkPauseMs });
    completionSeq += 1;
    const completionId = `chatcmpl-e2e-04-${completionSeq}`;
    requests.push({
      messageCount: messages.length,
      hasToolResult,
      slow,
      userPreview: contentText([...messages].reverse().find((message) => message?.role === "user")).slice(0, 24),
    });

    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    for (const frame of frames) {
      res.write(frameToSse(completionId, frame));
      if (frame.pauseMs) await sleepFrames(frame.pauseMs);
    }
    res.write(
      `data: ${JSON.stringify({
        id: completionId,
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model: MODEL_ID,
        choices: [],
        usage: { prompt_tokens: 42, completion_tokens: 7, total_tokens: 49 },
      })}\n\n`,
    );
    res.write("data: [DONE]\n\n");
    res.end();
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(undefined));
  });

  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("mock server did not bind to a TCP port");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    requests,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve(undefined)));
      }),
  };
}
