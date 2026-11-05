# 03 — pi 内核嵌入

Type: research
Status: resolved
Blocked by: —

## Question

如何把 pi coding agent 作为**依赖**嵌入 Electron 应用，做到：独立配置目录（不碰用户本机 pi 配置）、按员工注入 system prompt / tools / skills / MCP、事件流可订阅（供 UI 与动画消费）、会话可持久化与恢复；并选定模型供应商与鉴权方式。

## Answer

**结论：可以嵌，SDK 形态最合适；但 pi 没有子 agent、没有 agent 间消息，多员工协作必须在应用层自建调度器。模型与成本单独拆到 04 票。**

### 包与入口

- 仓库已迁到 `earendil-works/pi`；**用 `@earendil-works/*`，不要用已 deprecated 的 `@mariozechner/*`**。当前 1.5.0（2026-11-02），要求 Node ≥ 22.19（本机 22.20 刚好够）。
- 嵌入入口：`createAgentSession()` → `AgentSession`，配 `prompt()` / `subscribe()` / `getLastAssistantText()` / `dispose()`；可注入 `sessionManager`、`resourceLoader`、`tools`、`customTools`、`modelRuntime`。
- 会话可 `SessionManager.inMemory()` 完全不落盘，或落到自定义目录 —— 这正是「不碰用户本机 pi 配置」的抓手。

### 事件契约（同时喂 UI 和动画）

`message_start` / `message_update`（`text_delta`、`thinking_delta`、`toolcall_*`）/ `message_end` / `tool_execution_*` / `turn_*` / `agent_end` / `agent_settled`。

- UI 消费 `text_delta` 与 `tool_execution_*`；
- 动画消费 `tool_execution_start`（工具名 + 参数）→ 映射到工位状态；`turn_end` / `agent_end` → 回到 idle。

### 能力注入

- **tools**：`pi.registerTool({name, description, parameters, execute, promptSnippet})`；exposure 可设 direct / deferred / codemode / hidden。
- **skills**：目录 + `SKILL.md`（agentskills.io 规范），启动只暴露 name+description，命中才读全文。
- **MCP**：原生支持 stdio + streamable HTTP，工具名 `mcp__<server>__<tool>`；SDK 里要手动加 `createMcpExtension()`。
- **system prompt**：`context` / `context_with_system` / `before_agent_start` 钩子可改。

### 关键缺口

- **没有子 agent、没有 plan mode、没有 agent-to-agent 协议**。多员工协作 = 应用层调度器持有多个 `AgentSession`，自己做消息路由与任务交接。
- 扩展是 TS 模块（jiti 直载），意味着角色能力包可以做成扩展文件，但扩展能执行任意代码 —— 安全边界要在 05 / 07 票里定。

### 风险

- MIT，无商业化限制。
- 包作用域刚迁移，版本还年轻：锁定版本 + 包一层自己的 adapter，别让 pi 的类型泄漏到全应用。
- Electron 打包：pi 是纯 Node 库（推断，未见 native 依赖），但仍应在 `utilityProcess` 里跑，避免阻塞主进程。

详见 [research/pi-embedding.md](../research/pi-embedding.md)。

## Comments

- 2026-11-05 修订：用户决定 agent 底层**不内置、不深度绑定 pi**，改为统一引擎适配协议，员工可自选本机引擎（pi / codex / claude / dsh / qoder…），见 14 / 15 票。本票结论降级为「pi 作为引擎之一的接入证据」：SDK 入口、事件契约、会话隔离（独立 session 目录）、四类能力注入 —— 这四点正好是 pi 适配器要实现的清单。模型与成本拆入 04 票。
