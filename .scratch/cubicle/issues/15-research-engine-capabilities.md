# 15 — 引擎准入调研：codex / claude / dsh / qoder / gemini

Type: research
Status: resolved
Blocked by: —

## Question

候选引擎各自能否满足 14 票的准入条件（能注入角色技能 / MCP / tools）？逐个查：headless 或可编程调用形态、事件流粒度、会话持久化、system prompt / skills / tools / MCP 注入、取消与恢复、许可证、安装方式。

## 已知

- pi 已在 03 票调研完：SDK + JSONL 事件流 + 会话树持久化 + SDK 层注入，全部满足 → 作为准入基线，不必重查。
- 用户点名候选：pi、codex（OpenAI Codex CLI）、claude（Claude Code）、dsh（DeepSeek Harness，本机）、qoder。
- 建议附加对照：Google Gemini CLI。

## 要产出

每引擎一行准入判定（**进 v1 可选清单 / 剔除 / 证据不足待定**）+ 统一能力对等矩阵，完整版落 [research/engine-capabilities.md](../research/engine-capabilities.md)。来源 URL 必须 2 个/引擎以上；「文档确认」与「推断」分开标。

## 备注

research 票默认 AFK：由子 agent 调研后直接把结论写进本票 `## Answer` 并关票；它是 14 票的直接输入。

## Answer

**结论：六个候选（含基线 pi）全部通过准入——都能注入技能 / MCP / 工具；没有一个剔除。差异在证据等级、事件粒度与许可。**

### 准入判定（一行一个）

| 引擎 | 判定 | 依据 | 注意 |
|---|---|---|---|
| pi（基线） | ✅ 通过 | 03 票：SDK + 严格 JSONL 事件 + SKILL.md / tools / MCP 注册 + 会话树持久化；MIT | 事件粒度最好的一个 |
| Codex | ✅ 进 v1 | Apache-2.0；exec / skills / AGENTS.md / config.toml 主题页确认 | **三项待复核**（exec flags 与输出、MCP 写法、rollout 会话格式——本环境 403 未得正文，实施前用本机 CLI 验证） |
| Claude Code | ✅ 进 v1 | `-p` + stream-json（token 级）+ `--append-system-prompt` + skills + MCP + `--resume`，SIGTERM 语义明确；证据最全 | **专有许可**；商业化只可「调用用户自装」 |
| dsh（本机） | ✅ 进 v1 | 本机取证：`dsh --help`（headless 应用存在）+ app.asar 模块确认（dsh-mcp-client、dsh-skill 生态、dsh-headless、dsh-acp） | **headless 事件流粒度未核**（headless 单任务只回最终文本）；专有未开源 |
| Qoder | ✅ 进 v1 | 官方 CLI + Agent SDK 双形态、stream-json、SKILL.md、四种传输 MCP、resume/fork/checkpoint（旧假设「无 headless 资料」推翻） | **专有闭源** |
| Gemini CLI | ✅ 进 v1 | `-p` headless + stream-json（新版）+ GEMINI.md + skills + MCP + checkpoint | stream-json 细节随版本核对；Apache-2.0 |

### 必须带进 14 票的三个问题

1. **v1 引擎清单**：事件粒度最稠的是 pi 与 Claude（token 级、toolcall 边界完整）。dsh 本机已装，但「headless 只有最终文本」的策略下它驱动不了工位动画 —— 若要它进 v1，先验证其事件能力（ACP / 插件通道）。
2. **专有引擎的分发边界**：Claude、Qoder、dsh 都是专有。应用要在协议里写死「只调用用户本机自装的引擎，不捆绑分发」，避免许可风险。
3. **归一化基准**：按最稠的事件粒度（pi / Claude）定协议，粗粒度引擎在其上降级消费（某些动画状态缺失时回退到「忙 / 闲」级别）。

完整对等矩阵与来源见 [research/engine-capabilities.md](../research/engine-capabilities.md)。

### 方法注记

web_search 无 key → 全程 web_fetch 直抓官方文档 / npm registry / jsdelivr 镜像；dsh 以本机二进制取证（`--help` + app.asar 解包 package.json）；开发者站点 developers.openai.com 对本环境 403，Codex 正文经 gcore.jsdelivr 镜像取得。每个引擎 ≥ 2 个来源。
