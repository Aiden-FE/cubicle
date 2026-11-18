import { createServer } from "node:http";
import { setTimeout as sleepFrames } from "node:timers/promises";

/**
 * Deterministic OpenAI-compatible mock model endpoint — the M0-proven trick
 * shared by the ticket e2e runs: the request path stays real pi SDK +
 * HTTP/SSE, only the model side is scripted.
 *
 * Each ticket supplies its own `planReply` (a per-scenario behaviour table);
 * this module owns the transport plumbing (SSE frames, request log), so a
 * third ticket's mock never copies it a third time.
 *
 * @typedef {object} ReplyFrame
 * @property {string} [content]
 * @property {{ id: string, name: string, args: string }} [toolCall]
 * @property {string} [finish]
 * @property {number} [pauseMs]
 *
 * @typedef {(messages: any[], planCtx: { chunkPauseMs: number }) => { frames: ReplyFrame[], slow?: boolean, usage?: { prompt_tokens: number, completion_tokens: number, total_tokens: number } | null }} ReplyPlanner
 *
 * `usage` (票 12): per-completion token accounting to demo the budget soft
 * gate and the 「未计量」 path. undefined = the long-standing default
 * (42/7/49 — older tickets unchanged); an object bills that request; null
 * omits the usage frame entirely — pi then reports nothing, and the app
 * must show 「未计量」, never a fake 0.
 *
 * @typedef {object} MockModelServer
 * @property {string} baseUrl
 * @property {() => Promise<void>} close
 * @property {Array<{ messageCount: number, hasToolResult: boolean, slow: boolean, userPreview: string, raw: string }>} requests
 *   `raw` (票 a04): the full JSON request body as received — 上下文断言打在原始请求上，不靠模型复述。
 */

const MODEL_ID = "cubicle-e2e-model";

/**
 * Flatten a message's content (string or content-part array) to text.
 *
 * @param {any} message
 * @returns {string}
 */
export function contentText(message) {
  const content = message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part) => (typeof part?.text === "string" ? part.text : "")).join("");
  }
  return "";
}

/**
 * The newest user message's text — scenario selectors read the sentence the
 * employee was actually told, not older turns in a grown session.
 *
 * @param {any[]} messages
 * @returns {string}
 */
export function lastUserText(messages) {
  return contentText([...messages].reverse().find((message) => message?.role === "user"));
}

/**
 * True when the CURRENT turn already contains a tool result — i.e. the
 * scripted tool call ran and the model is being asked for its closing line.
 * Scoped after the last user message so earlier turns' tool results (a
 * growing session) never leak into this turn's plan.
 *
 * @param {any[]} messages
 */
export function answeredThisTurn(messages) {
  const lastIndex = messages.map((message) => message?.role).lastIndexOf("user");
  return messages.slice(lastIndex + 1).some((message) => message?.role === "tool");
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
 * @param {{ planReply: ReplyPlanner, completionPrefix: string, chunkPauseMs?: number }} options
 * @returns {Promise<MockModelServer>}
 */
export async function startMockModelServer({ planReply, completionPrefix, chunkPauseMs = 10 }) {
  /** @type {MockModelServer["requests"]} */
  const requests = [];
  let completionSeq = 0;

  const server = createServer(async (req, res) => {
    if (req.method !== "POST" || !req.url?.endsWith("/chat/completions")) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: `unexpected ${req.method} ${req.url}` } }));
      return;
    }

    const rawText = await readBody(req);
    let body;
    try {
      body = JSON.parse(rawText);
    } catch {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "invalid JSON body" } }));
      return;
    }

    /** @type {any[]} */
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const hasToolResult = messages.some((message) => message?.role === "tool");
    const plan = planReply(messages, { chunkPauseMs });
    const slow = plan.slow === true;
    completionSeq += 1;
    const completionId = `${completionPrefix}-${completionSeq}`;
    requests.push({
      messageCount: messages.length,
      hasToolResult,
      slow,
      userPreview: lastUserText(messages).slice(0, 24),
      raw: rawText,
    });

    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    for (const frame of plan.frames) {
      res.write(frameToSse(completionId, frame));
      if (frame.pauseMs) await sleepFrames(frame.pauseMs);
    }
    // undefined keeps the historical default (tickets 04–09 unchanged); an
    // object bills this completion; null = the provider never reported usage.
    const usage = plan.usage === undefined ? { prompt_tokens: 42, completion_tokens: 7, total_tokens: 49 } : plan.usage;
    if (usage) {
      res.write(
        `data: ${JSON.stringify({
          id: completionId,
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model: MODEL_ID,
          choices: [],
          usage,
        })}\n\n`,
      );
    }
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
