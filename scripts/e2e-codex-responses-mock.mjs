import { createServer } from "node:http";
import { setTimeout as sleepFrames } from "node:timers/promises";

/**
 * Deterministic OpenAI **Responses**-API mock for the codex CLI host (ticket
 * 11). codex 0.163 speaks `wire_api = "responses"`, so the ticket-11 e2e points
 * its private CODEX_HOME at this local endpoint with a dummy key — the engine
 * run is real (real codex process, real JSONL, real PreToolUse policy hook),
 * only the model side is scripted. No network, no login.
 *
 * Plan is keyed off the newest user turn (the sentence the employee was told)
 * plus whether the current turn already carries a function_call_output (the
 * tool ran → answer with text). The probe's random marker is read back from
 * the request: codex folds the employee's AGENTS.md into its input, so
 * `CUBICLE_PROBE_MARKER=<token>` is visible here and echoed verbatim — proving
 * the injected context reached the engine.
 *
 * @typedef {object} CodexPlanItem
 * @property {"message" | "function_call"} type
 * @property {string[]} [chunks]
 * @property {string} [name]
 * @property {string} [callId]
 * @property {string} [arguments]
 *
 * @typedef {(body: any) => { items: CodexPlanItem[] }} CodexPlanner
 *
 * @typedef {object} CodexMockServer
 * @property {string} baseUrl
 * @property {() => Promise<void>} close
 * @property {Array<{ messageCount: number, hasFunctionOutput: boolean, userPreview: string }>} requests
 */

const MODEL_ID = "cubicle-e2e-model";

/** @param {import("node:http").IncomingMessage} req */
async function readBody(req) {
  const parts = [];
  for await (const part of req) parts.push(Buffer.isBuffer(part) ? part : Buffer.from(part));
  return Buffer.concat(parts).toString("utf8");
}

/** Flatten codex input items to one searchable text blob. */
/** @param {any} body @returns {string} */
function inputText(body) {
  const items = Array.isArray(body?.input) ? body.input : [];
  const chunks = [];
  for (const item of items) {
    const content = item?.content;
    if (typeof content === "string") chunks.push(content);
    else if (Array.isArray(content)) for (const part of content) chunks.push(typeof part?.text === "string" ? part.text : "");
    if (typeof item?.text === "string") chunks.push(item.text);
  }
  return chunks.join("\n");
}

/** @param {any} body */
function latestUserText(body) {
  const items = Array.isArray(body?.input) ? body.input : [];
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i];
    if (item?.role === "user") {
      const content = item?.content;
      if (typeof content === "string") return content;
      if (Array.isArray(content)) return content.map((part) => (typeof part?.text === "string" ? part.text : "")).join("");
    }
  }
  return "";
}

/** @param {any} body @returns {boolean} */
function hasFunctionOutput(body) {
  return JSON.stringify(body?.input ?? []).includes("function_call_output");
}

/**
 * Did THIS turn already run a tool? codex resumes the same thread for the next
 * sentence, so the input carries older function_call_outputs — treating those
 * as "this turn is done" would make the model skip the call it was asked for.
 * Walk back from the newest item: the user sentence that opened this turn ends
 * the search.
 *
 * @param {any} body @returns {boolean}
 */
function answeredThisTurn(body) {
  const items = Array.isArray(body?.input) ? body.input : [];
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i];
    if (item?.role === "user") return false;
    if (JSON.stringify(item ?? {}).includes("function_call_output")) return true;
  }
  return false;
}

/**
 * The ticket-11 plan: probe marker echo (+ benign echo), probe denial, the
 * shared read/danger sentences, and a text fallback.
 * @type {CodexPlanner}
 */
function planReply(body) {
  const asked = latestUserText(body);
  const finished = answeredThisTurn(body);
  const markerMatch = inputText(body).match(/CUBICLE_PROBE_MARKER=([0-9a-fA-F]+)/);

  // — probe run 1: run one benign echo, then report the injected marker line.
  //   One output item per response mirrors the shape codex 0.163 was proven
  //   against in the spike (tool call first, answer after the result).
  if (asked.includes("CUBICLE_PROBE_MARKER")) {
    if (finished) {
      const marker = markerMatch ? `CUBICLE_PROBE_MARKER=${markerMatch[1]}` : "CUBICLE_PROBE_MARKER=<missing>";
      return { items: [{ type: "message", chunks: [`我上下文里的标记行是：${marker}。探针命令已执行。`] }] };
    }
    return {
      items: [
        { type: "function_call", name: "exec_command", callId: "call_probe_echo", arguments: JSON.stringify({ cmd: "echo cubicle-probe-ok" }) },
      ],
    };
  }

  // — probe run 2 / chat 危险命令: the destructive call the host policy must block —
  if (asked.includes("deny-target") || asked.includes("Remove-Item")) {
    if (finished) {
      return { items: [{ type: "message", chunks: ["这条命令被策略拦下了，我不会去删。"] }] };
    }
    // The chat sentence names a real file in the workspace, so a hook that
    // failed to deny would visibly destroy it and the e2e would say so.
    const victim = asked.includes("important.txt") ? "important.txt" : "probe-deny-target";
    return {
      items: [
        { type: "function_call", name: "exec_command", callId: "call_deny", arguments: JSON.stringify({ cmd: `powershell -NoProfile -Command "Remove-Item -Recurse -Force ${victim}"` }) },
      ],
    };
  }

  // — abort step: a deliberately slow shell command, so the abort click lands
  //   while a real codex child is in flight (checked by process sampling) —
  if (asked.includes("慢一点")) {
    return {
      items: [
        { type: "function_call", name: "exec_command", callId: "call_slow_read", arguments: JSON.stringify({ cmd: 'powershell -NoProfile -Command "Start-Sleep -Seconds 6; Get-Content hello.txt"' }) },
      ],
    };
  }

  // — shared "读一下" sentence, this time on codex (exec reads the file) —
  if (asked.includes("读一下")) {
    if (finished) {
      return { items: [{ type: "message", chunks: ["用 codex 读完了，里面写着 hello from e2e fixture。"] }] };
    }
    return {
      items: [
        { type: "function_call", name: "exec_command", callId: "call_read", arguments: JSON.stringify({ cmd: "powershell -NoProfile -Command \"Get-Content hello.txt\"" }) },
      ],
    };
  }

  return { items: [{ type: "message", chunks: ["收到（codex）。"] }] };
}

/**
 * @param {{ planner?: CodexPlanner }} [options]
 * @returns {Promise<CodexMockServer>}
 */
export async function startCodexResponsesMock({ planner = planReply } = {}) {
  /** @type {CodexMockServer["requests"]} */
  const requests = [];
  let seq = 0;

  const server = createServer(async (req, res) => {
    const body = JSON.parse(await readBody(req));
    if (req.url?.includes("/models")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ object: "list", data: [] }));
      return;
    }
    if (!req.url?.includes("/responses")) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: `unexpected ${req.method} ${req.url}` } }));
      return;
    }

    const items = Array.isArray(body?.input) ? body.input : [];
    requests.push({
      messageCount: items.length,
      hasFunctionOutput: hasFunctionOutput(body),
      userPreview: latestUserText(body).slice(0, 24),
    });

    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    const responseId = `resp_e2e11_${++seq}`;
    /** @param {string} type @param {Record<string, any>} payload */
    const evt = (type, payload) => {
      res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...payload })}\n\n`);
    };

    evt("response.created", { response: { id: responseId, object: "response", status: "in_progress", model: body?.model ?? MODEL_ID, output: [] } });
    evt("response.in_progress", { response: { id: responseId, object: "response", status: "in_progress" } });

    let outputIndex = 0;
    for (const item of planner(body).items) {
      if (item.type === "message") {
        const id = `msg_${outputIndex}`;
        evt("response.output_item.added", { output_index: outputIndex, item: { id, type: "message", role: "assistant", content: [] } });
        evt("response.content_part.added", { item_id: id, output_index: outputIndex, content_index: 0, part: { type: "output_text", text: "", annotations: [] } });
        for (const chunk of item.chunks ?? []) {
          evt("response.output_text.delta", { item_id: id, output_index: outputIndex, content_index: 0, delta: chunk });
          await sleepFrames(60);
        }
        const full = (item.chunks ?? []).join("");
        evt("response.output_text.done", { item_id: id, output_index: outputIndex, content_index: 0, text: full });
        evt("response.content_part.done", { item_id: id, output_index: outputIndex, content_index: 0, part: { type: "output_text", text: full, annotations: [] } });
        evt("response.output_item.done", { output_index: outputIndex, item: { id, type: "message", role: "assistant", content: [{ type: "output_text", text: full }] } });
        outputIndex += 1;
      } else {
        const id = `fc_${outputIndex}`;
        evt("response.output_item.added", { output_index: outputIndex, item: { id, type: "function_call", name: item.name, arguments: "", call_id: item.callId } });
        evt("response.function_call_arguments.delta", { item_id: id, output_index: outputIndex, delta: item.arguments });
        evt("response.function_call_arguments.done", { item_id: id, output_index: outputIndex, arguments: item.arguments });
        evt("response.output_item.done", { output_index: outputIndex, item: { id, type: "function_call", name: item.name, arguments: item.arguments, call_id: item.callId } });
        outputIndex += 1;
      }
    }

    evt("response.completed", {
      response: {
        id: responseId,
        object: "response",
        status: "completed",
        model: body?.model ?? MODEL_ID,
        usage: { input_tokens: 100, input_tokens_details: { cached_tokens: 0 }, output_tokens: 20, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 120 },
        output: [],
      },
    });
    res.end();
  });

  server.unref();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(undefined));
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("codex mock did not bind");

  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    requests,
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve(undefined));
      }),
  };
}
