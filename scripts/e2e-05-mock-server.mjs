import { createServer } from "node:http";
import { setTimeout as sleepFrames } from "node:timers/promises";

/**
 * Deterministic OpenAI-compatible model endpoint for the ticket 05
 * acceptance run — same M0-proven trick as ticket 04: the request path
 * stays real pi SDK + HTTP/SSE, only the model side is scripted.
 *
 * The scripted employee (driven by the work-order prompt) does the whole
 * job with real tools inside the app's AgentHost: it reads the repo,
 * writes greet.txt + a node --test file, RUNS the tests, and commits —
 * the commit is produced by the employee itself (its engine's bash tool),
 * never by the app.
 *
 * Each reply is one planned frame list; the next step is chosen by how
 * many tool results the conversation already carries.
 *
 * @typedef {object} MockModelServer05
 * @property {string} baseUrl
 * @property {() => Promise<void>} close
 * @property {Array<{ messageCount: number, toolResults: number, userPreview: string }>} requests
 *
 * @typedef {{ content?: string, toolCall?: { id: string, name: string, args: string }, finish?: string, pauseMs?: number }} ReplyFrame
 */

const MODEL_ID = "cubicle-e2e-05-model";

/**
 * The employee's scripted work plan. Every command runs for real — via the
 * POWERSHELL tool: on this machine Git Bash (msys2) cannot initialize
 * inside electron.exe (NtCreateDirectoryObject 0xC0000022), while
 * powershell.exe spawns fine (ticket-05 spike). PS 5.1 syntax: `;` not `&&`.
 */
const PLAN = /** @type {const} */ ([
  {
    say: "收到工单，先看一眼工作区的 git 状态。",
    tool: { id: "call_e2e_gitstatus", name: "powershell", args: '{"command":"git status --porcelain; git log --oneline -3"}' },
  },
  {
    say: "给 greet.txt 加一行欢迎语。",
    tool: { id: "call_e2e_write_greet", name: "write", args: '{"path":"greet.txt","content":"hello\\nwelcome from cubicle\\n"}' },
  },
  {
    say: "补一个测试钉住这两行。",
    tool: {
      id: "call_e2e_write_test",
      name: "write",
      args: '{"path":"greet.test.mjs","content":"import test from \\"node:test\\";\\nimport assert from \\"node:assert/strict\\";\\nimport { readFileSync } from \\"node:fs\\";\\n\\ntest(\\"greeting keeps hello\\", () => {\\n  assert.match(readFileSync(\\"greet.txt\\", \\"utf8\\"), /hello/);\\n});\\n\\ntest(\\"greeting has the welcome line\\", () => {\\n  assert.match(readFileSync(\\"greet.txt\\", \\"utf8\\"), /welcome from cubicle/);\\n});\\n"}',
    },
  },
  {
    say: "跑一遍测试确认。",
    tool: { id: "call_e2e_test", name: "powershell", args: '{"command":"node --test"}' },
  },
  {
    say: "测试通过，我自己提交这一单（不 push）。",
    tool: { id: "call_e2e_commit", name: "powershell", args: '{"command":"git add -A; git commit -m \\"feat: welcome line + greeting tests\\""}' },
  },
]);

const REPORT_FRAMES = [
  { content: "收尾报告\n", pauseMs: 10 },
  { content: "完成：greet.txt 加了 welcome from cubicle，并补了 greet.test.mjs。\n", pauseMs: 10 },
  { content: "变更：greet.txt（改）、greet.test.mjs（新增），已 commit（feat: welcome line + greeting tests）。\n", pauseMs: 10 },
  { content: "测试：node --test → pass 2 / fail 0。\n", pauseMs: 10 },
  { content: "未尽事项：无。", pauseMs: 10 },
  { finish: "stop" },
];

/**
 * @param {any[]} messages
 * @param {{ chunkPauseMs: number }} options
 * @returns {{ frames: ReplyFrame[] }}
 */
function planReply(messages, { chunkPauseMs }) {
  const toolResults = messages.filter((message) => message?.role === "tool").length;
  if (toolResults >= PLAN.length) {
    return { frames: REPORT_FRAMES };
  }
  const step = PLAN[toolResults];
  return {
    frames: [
      { content: step.say, pauseMs: chunkPauseMs },
      { toolCall: step.tool, pauseMs: chunkPauseMs },
      { finish: "tool_calls" },
    ],
  };
}

/**
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
 * @returns {string}
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
 * @returns {Promise<MockModelServer05>}
 */
export async function startMockModelServer05({ chunkPauseMs = 10 } = {}) {
  /** @type {MockModelServer05["requests"]} */
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
    const toolResults = messages.filter((message) => message?.role === "tool").length;
    const { frames } = planReply(messages, { chunkPauseMs });
    completionSeq += 1;
    const completionId = `chatcmpl-e2e-05-${completionSeq}`;
    requests.push({
      messageCount: messages.length,
      toolResults,
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
        usage: { prompt_tokens: 60, completion_tokens: 12, total_tokens: 72 },
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
