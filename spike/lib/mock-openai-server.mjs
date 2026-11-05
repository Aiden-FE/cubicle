import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";

/**
 * A deterministic OpenAI-compatible endpoint used by the pi probe.
 *
 * Turn 1 streams text plus a `read` tool call; turn 2 (after the tool result
 * comes back as a `tool` message) streams the final answer. The probe is
 * therefore reproducible and needs no model credentials or network access.
 *
 * @typedef {object} MockServer
 * @property {string} baseUrl
 * @property {() => Promise<void>} close
 * @property {Array<{ path: string, messageCount: number, hasToolResult: boolean }>} requests
 */

const MODEL = "spike-model";

/**
 * @param {import("node:http").ServerResponse} res
 * @param {Record<string, unknown>} payload
 */
function writeChunk(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

/**
 * @param {string} id
 * @param {Record<string, unknown>} choice
 * @param {Record<string, unknown>} [extra]
 */
function chunk(id, choice, extra = {}) {
  return {
    id,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: MODEL,
    choices: [choice],
    ...extra,
  };
}

/**
 * @param {import("node:http").IncomingMessage} req
 * @returns {Promise<string>}
 */
async function readBody(req) {
  /** @type {Buffer[]} */
  const chunks = [];
  for await (const part of req) {
    chunks.push(Buffer.isBuffer(part) ? part : Buffer.from(part));
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * @returns {Promise<MockServer>}
 */
export async function startMockOpenAiServer() {
  /** @type {MockServer["requests"]} */
  const requests = [];
  let completionCount = 0;

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

    const messages = Array.isArray(body.messages) ? body.messages : [];
    const hasToolResult = messages.some((/** @type {any} */ message) => message?.role === "tool");
    completionCount += 1;
    const requestId = `chatcmpl-spike-${completionCount}`;
    requests.push({ path: req.url ?? "", messageCount: messages.length, hasToolResult });

    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });

    if (!hasToolResult) {
      // First response: some text, then a read tool call.
      for (const text of ["Reading ", "hello.txt", " now."]) {
        writeChunk(res, chunk(requestId, { index: 0, delta: { role: "assistant", content: text }, finish_reason: null }));
        await delay(10);
      }
      writeChunk(
        res,
        chunk(requestId, {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: 0,
                id: "call_spike_read",
                type: "function",
                function: { name: "read", arguments: '{"path":"hello.txt"}' },
              },
            ],
          },
          finish_reason: null,
        }),
      );
      await delay(10);
      writeChunk(res, chunk(requestId, { index: 0, delta: {}, finish_reason: "tool_calls" }));
    } else {
      for (const text of ["The file says: ", "hello from m0 fixture", "."]) {
        writeChunk(res, chunk(requestId, { index: 0, delta: { role: "assistant", content: text }, finish_reason: null }));
        await delay(10);
      }
      writeChunk(res, chunk(requestId, { index: 0, delta: {}, finish_reason: "stop" }));
    }

    writeChunk(res, {
      id: requestId,
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: MODEL,
      choices: [],
      usage: { prompt_tokens: 42, completion_tokens: 7, total_tokens: 49 },
    });
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
    close: async () => {
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve(undefined)));
      });
    },
  };
}
