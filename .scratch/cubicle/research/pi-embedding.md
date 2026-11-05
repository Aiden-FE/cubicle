# pi coding agent 嵌入调研

> 调研输入，对应 03 票。结论：**可以嵌，SDK 形态最合适；但 pi 没有子 agent 与 agent 间消息，多员工协作必须在应用层自建。**

## 0. 前提纠正

仓库已从 `badlogic/pi-mono` 迁到 **`github.com/earendil-works/pi`**；`@mariozechner/*` 在 npm 上已标记 deprecated（"please use @earendil-works/... instead"）。当前线 **1.5.0（2026-11-02）**，Node ≥ 22.19。Mario 仍是维护者，与 Armin Ronacher（mitsuhiko）、rwachtler 共同维护。

## 1. 架构（monorepo `packages/*`）

- **pi-ai**：统一 LLM API + 模型发现/provider 配置；适配 anthropic-messages、openai-completions/responses、google-generative-ai、bedrock-converse-stream、mistral-conversations 等。
- **pi-agent-core**（packages/agent）：通用 agent，transport 抽象 + 状态 + 附件；`AgentMessage` 联合类型在此层。
- **pi-coding-agent**：CLI/TUI/RPC/SDK 四态，会话管理、内置工具（read/bash/edit/write/ls/grep/find）、扩展运行时。
- **pi-tui**：差分渲染 TUI。**pi-mcp**：MCP 客户端。**pi-codemode**：QuickJS/WASM 沙箱（唯一能力是调用注入的工具）。**pi-durable**：持久化会话/任务运行时。另有 pi-schema、pi-telemetry。

**agent loop 在哪层**：循环本体（一次 model request → 执行工具 → 判断是否再开一轮）在 pi-agent-core；`AgentSession` 在其上叠加会话树、压缩、扩展钩子、重试。（机制文档确认，包归属为推断。）

**provider 抽象**：provider = 凭据（auth.json/环境变量/OAuth）+ baseUrl + `api` 协议串 + 模型清单，pi-ai 统一成同一流式接口。可用 `pi.registerProvider(name,{api:"openai-completions",...})` 或完整 Provider 对象（支持自定义 stream/streamSimple）。

## 2. 嵌入方式（三种，推荐 SDK）

- **SDK**：`createAgentSession()` → `AgentSession`；`session.prompt()`、`session.subscribe(cb)`、`session.getLastAssistantText()`、`session.dispose()`。可注入 sessionManager / settingsManager / resourceLoader / tools / customTools / modelRuntime。最小示例就是 new→subscribe→prompt→dispose 五步。
- **事件流**：`message_start` / `message_update`（`text_delta`、`thinking_delta`、`toolcall_*`）/ `message_end` / `tool_execution_*` / `turn_*` / `agent_end` / `agent_settled`；`pi --mode json` 把同构事件按严格 JSONL 写 stdout；RPC 模式为 stdin/stdout 双向 JSONL（无 session header）。
- **持久化**：`~/.pi/agent/sessions/--<path>--/<ts>_<id>.jsonl`，每行一个 entry，靠 `id/parentId` 组成树（v3），类型含 message / compaction / branch_summary / custom / custom_message / label / context_edit；`SessionManager.inMemory()` 可完全不落盘。

> 以上均出自 `docs/sdk.md`、`docs/json.md`、`docs/session-format.md`。

## 3. 扩展机制

- **tools**：`pi.registerTool({name,label,description,parameters: TypeBox, execute(toolCallId,params,signal,onUpdate,ctx)})`；`promptSnippet`/`promptGuidelines` 往 system prompt 的 `<tools>`/`<rules>` 注入；exposure 分 direct/deferred/codemode/hidden。
- **skills**：目录 + **SKILL.md**（YAML frontmatter：name/description/license/compatibility/metadata/allowed-tools/disable-model-invocation），遵循 agentskills.io 规范；启动只把 name+description 放进 system prompt，命中才读全文（`/skill:name` 可强制）。发现位置含 `~/.agents/skills`、`.agents/skills`。
- **MCP**：原生支持，stdio + streamable HTTP（不支持旧 SSE），`mcp.json` 用户级/项目级，工具名 `mcp__<server>__<tool>`，支持 OAuth；SDK 里需手动加 `createMcpExtension()`。
- **extensions**：TS 模块默认导出工厂 `(pi: ExtensionAPI)`，jiti 直载 TS；`pi.on()` 覆盖 input / context / context_with_system / tool_call / tool_result / turn_end / session_*；另有 registerCommand/Shortcut/Flag/Provider/McpServer/ToolRenderer。
- **system prompt 注入**：context / context_with_system 钩子可改消息与整条 transcript；`before_agent_start` 改 systemPromptOptions；`session.systemPrompt` 只读。

## 4. 多 agent（文档确认：基本没有）

README 明说 "skips features like sub-agents and plan mode"。仅有：
1. 工具调用默认并行（同一 assistant 消息的 sibling tool calls 并发）；
2. 单会话内的 steering / follow-up 队列（prompt 时须指定 steer 或 followUp，可把消息插进正在跑的 run）；
3. `pi.events` 进程内事件总线（扩展间通信，非 agent 间）。

真正的多 agent 要自己写扩展 spawn `pi` 子进程或另一个 SDK 会话 → **无官方 agent-to-agent 协议**（推断）。

## 5. 许可与活跃度

MIT，仅 MIT，无商业化限制条款；唯一商业关联是官方网关 Radius（alpha，可选）。1.5.0 于 2026-11-02 发布，月下载约 1770 万。

## 6. 替代方案

- **Claude Agent SDK**：与 Claude Code 同源，工具/权限/子 agent 成熟；代价是绑定 Anthropic 模型。
- **OpenAI Agents SDK**：handoffs/guardrails/tracing 完整，多 agent 一等公民；OpenAI 生态优先。
- **LangGraph**：图状态机，可控性与持久化最强；coding agent 的工具与上下文要自己搭，抽象重。
- **Mastra**：TS 原生、workflow+RAG 齐；偏应用框架，agent 循环透明度不如 pi。

（替代方案为通用认知，未逐条核实 → 推断。）

## 7. 对本项目的直接含义

1. 用 `@earendil-works/pi-coding-agent`，**锁定版本**，外面包一层自己的 adapter，别让 pi 类型泄漏到全应用。
2. 每员工一个 `AgentSession`，`SessionManager` 指向应用私有目录（如 `%APPDATA%/ai-office/employees/<id>/sessions`），即可完全隔离用户本机 `~/.pi`。
3. 事件流是唯一事实来源：UI 的对话、工位的动画、任务的进度都从同一条流派生，不要各自再猜状态。
4. 「多员工协作」= 应用层调度器持有多个 session，自己做消息路由、任务交接、并发控制。pi 帮不上忙，但也不会挡路。
5. 扩展能执行任意代码 → 角色能力包如果是 TS 扩展，等价于允许用户在你的应用里跑代码，安全边界要在 05/07 票里定。

## 来源

[github.com/earendil-works/pi](https://github.com/earendil-works/pi) ·
[npm: @earendil-works/pi-coding-agent](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) ·
[随包 docs/sdk.md](https://unpkg.com/@earendil-works/pi-coding-agent@1.5.0/docs/sdk.md)（同目录另有 how-pi-works / session-format / json / extensions / skills / mcp / providers.md）
