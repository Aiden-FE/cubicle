# 引擎可编程接入能力调研（准入判定）

> 对应 15 票。结论：**六家引擎（含基线 pi）全部通过准入——都能注入技能 / MCP / 工具，无一剔除**；差异在事件粒度、证据等级与许可。

## 方法注记

- `web_search` 缺 `DEEPSEEK_API_KEY` 不可用 → 全程 `web_fetch` 直抓官方文档 / npm registry / GitHub API。
- developers.openai.com 被 WAF 403、raw.githubusercontent 与 jsdelivr 主站断连 → Codex 正文改经 `gcore.jsdelivr.net` 镜像取得。
- dsh 以本机二进制取证（`dsh --help` + 解包 app.asar）；无公开自述文档，证据取自 `--help` 输出与 package.json，[取证副本](dsh-package.json) 与本文同目录。
- 每引擎 ≥ 2 来源。pi 沿用 03 票调研做基线，不重估。

## 一、逐引擎结论

### 1. OpenAI Codex CLI — 进 v1（附复核项）

- 许可：**Apache-2.0**（npm registry 确认）。
- 主题页确认：`exec`（non-interactive）、skills、AGENTS.md、config.toml（正文已取证，含 lifecycle hooks）、slash commands。
- **待复核**（本环境 403 未得正文 → 标「推断/待核」）：exec 的 flags 细节与输出格式、MCP 在 config.toml 的写法、会话 rollout 文件格式。纳入前在本机 `codex --help` / `codex exec --help` 验证。
- 来源：[npm @openai/codex](https://registry.npmjs.org/@openai/codex/latest) · [repo README（镜像）](https://gcore.jsdelivr.net/gh/openai/codex@main/README.md) · docs/config.md 同源镜像。

### 2. Claude Code — 进 v1（证据最全）

- headless：`claude -p`；`--output-format text/json/stream-json`（`--include-partial-messages` 到 token 级，tool_use/tool_result 边界，system/init 事件上报 mcp_servers/errors）。
- 注入：`--append-system-prompt(-file)`；skills = `.claude/skills/SKILL.md`（非 bare 自动加载）；MCP = `--mcp-config` / `.mcp.json`；tools 管控 `--allowedTools` / `--permission-mode`。
- 会话：jsonl transcript + `--resume <id|.jsonl 路径>` / `--continue`；取消：SIGTERM → exit 143，语义明确且可 resume 续接。
- 许可：**专有**（npm "SEE LICENSE IN README.md"，Anthropic 商业条款）。另有 Agent SDK（TS/Py）。
- 来源：[headless 文档](https://code.claude.com/docs/en/headless.md) · [npm @anthropic-ai/claude-code](https://registry.npmjs.org/@anthropic-ai/claude-code/latest)。

### 3. DeepSeek Harness（dsh，本机）— 进 v1（本机验证）

- CLI 多应用：`dsh headless "任务"`（单任务 → 打印结果 → 退出）、`dsh tui --resume <session>`；注入面 `--profile/--patch/--dump-config(-schema)`；插件 `dsh plugin --profile <p> add <pnpm 包>`。
- app.asar 内 `@deepseek-ai/dsh-desktop-runtime` 依赖确认：dsh-mcp-client / dsh-mcp-resources（MCP 客户端）、dsh-skill（+office/filesystem）/ dsh-tool-skill / dsh-client-ui-skill（SKILL.md 生态，launcher 自带 office-skills/*/SKILL.md）、dsh-acp（ACP 适配）、dsh-agent-loop / instructions / preset、dsh-headless / dsh-cmdline。
- 会话：`~/.dsh/sessions`（profiles/storages 同层）。
- 许可：**专有未开源**（package.json `"private": true`，无 license 字段）；随 Electron 桌面应用内置 runtime（node24 / pnpm11 / Py3.12）。
- 风险点：**headless 无事件流文档**（单任务只回最终文本）→ 驱动工位动画先验证事件能力（ACP / 插件通道 / tui/web 内部流）。
- 取证路径：`…\resources\runtime\cli\bin\dsh.cmd --help`；`…\app.asar` 解包 `dsh/package.json`；`…\runtime\office-skills\*\SKILL.md`。

### 4. Qoder — 进 v1（推翻旧假设）

- 「几乎无公开 headless 资料」**已过时**：官方 docs 有完整 CLI + Agent SDK 文档。
- headless：`qoder -p/--print`；`--output-format text/json/stream-json`、`--input-format stream-json`、`--max-turns`、`--no-session-persistence`。
- 会话：默认落盘；`--continue / --resume <id> / --session-id / --fork-session / --list-sessions / --delete-session`。
- 注入：skills = `.qoder/skills/SKILL.md`（user/project 级，`/skills reload`）；AGENTS.md 项目指令 + SDK system-prompt；tools `--tools / --allowed-tools / --disallowed-tools`；MCP `qoder mcp add/list`（stdio/sse/http/ws × scope user/local/project → `~/.qoder/settings.json`、`.qoder/settings.local.json`、`.mcp.json`），另有 `--mcp-config / --strict-mcp-config`。
- Agent SDK（TS/Py/Java）：整 runtime 嵌入，类型化消息流、interrupt、resume/fork/checkpoint。
- 许可：**专有闭源**（无开源仓库）。安装：qoder.com/install（ps1/cmd）或 npm `@qoder-ai/qodercli`。
- 来源：[docs.qoder.com/cli/overview](https://docs.qoder.com/cli/overview) · /cli/cli-reference · /cli/Skills · /cli/mcp-servers · /cli/sdk/overview · /cli/installation。

### 5. Google Gemini CLI — 进 v1（对照项）

- headless：`gemini -p`（可 stdin 管道）；`--output-format text/json/stream-json`（stream-json 已在最新 main 的 cli-reference 确认；文档站快照仍仅 text/json —— 实施时按版本核对）。
- 会话：`--resume latest|index|uuid`、`--list-sessions/--delete-session`、/resume 会话浏览器、checkpointing + `/restore`。
- 注入：skills（`gemini skills list/install/link/enable/disable`，SKILL.md）；MCP（`gemini mcp add` + `mcpServers` in `~/.gemini/settings.json`，stdio/SSE/httpUrl，include/excludeTools，trust）；system prompt 注入 = GEMINI.md 分层上下文（官方确认拼接）。
- 另有 extensions（git 安装）与 `--experimental-acp`（Zed 集成）附加形态。
- 许可：**Apache-2.0**。
- 来源：[gemini-cli docs/headless](https://google-gemini.github.io/gemini-cli/docs/cli/headless) · /docs/get-started/configuration.html · /docs/cli/checkpointing.html · [repo API](https://api.github.com/repos/google-gemini/gemini-cli)。

## 二、统一对等矩阵

字段顺序：调用形态｜可编程输出｜事件粒度｜sys prompt 注入｜skills 注入｜tools 管控｜MCP｜会话持久化｜取消/恢复｜许可证｜安装/更新

| 引擎 | 能力行 |
|---|---|
| **pi（基线）** | SDK 进程内（亦 CLI/TUI/RPC）｜严格 JSONL 事件｜token 流 + toolcall 边界 + turn 边界｜SDK 钩子注入｜SKILL.md｜registerTool / 扩展｜原生 stdio+HTTP｜JSONL 会话树（可指定目录）｜dispose / steer｜MIT｜`@earendil-works/*` |
| **Codex** | 外部 CLI headless(exec)｜JSON/文本（细节待核）｜待核｜AGENTS.md（主题确认）｜skills（主题确认）｜自定义 tools 经 MCP（推断）｜config.toml mcp_servers（推断）｜rollout（推断）｜推断｜**Apache-2.0**｜安装脚本/npm/brew，手动更新 |
| **Claude** | 外部 CLI headless + Agent SDK(TS/Py)｜stream-json/JSON/文本｜token 流 + tool 边界 + system/init｜`--append-system-prompt`｜`.claude/skills`｜`--allowedTools`/perm 模式｜`--mcp-config`/.mcp.json｜jsonl + resume｜resume + 明确 SIGTERM 语义｜**专有**｜npm |
| **dsh** | 本机 CLI 多应用（headless/tui/web）｜headless = 最终文本｜tui/web 内部有事件流，headless 无文档（待核）｜`--profile/--patch` + agent-instructions｜SKILL.md（dsh-skill 生态，可自定义）｜`--patch` 插件 + 内置工具｜dsh-mcp-client（server 配置确认）｜`~/.dsh/sessions` + tui resume｜进程级 kill + resume（部分推断）｜**专有**｜随桌面应用内置 runtime |
| **Qoder** | CLI headless + Agent SDK(TS/Py/Java)｜text/json/stream-json｜SDK 类型化消息 + 工具活动 + result｜AGENTS.md + SDK system-prompt｜`.qoder/skills` SKILL.md｜`--tools/--allowed-tools/--disallowed-tools`｜mcp add（4 传输 × 3 scope → 三处配置文件）｜默认持久化 + resume/fork/checkpoint｜SDK interrupt + resume｜**专有**｜安装脚本/npm -g |
| **Gemini** | 外部 CLI headless｜text/json/stream-json（较新，粒度待核）｜GEMINI.md 分层（确认）｜gemini skills（SKILL.md）｜`--allowed-tools`/policy engine｜mcp add + mcpServers｜chats + resume + checkpoint｜/restore + 进程 kill｜**Apache-2.0**｜npm/homebrew + `gemini update` |

## 三、给 14 票的三个决定点

1. **v1 引擎清单**：事件粒度最稠的是 pi 与 Claude（token 级）→ 动画驱动的归一化基准以它们对齐；粗粒度引擎在其上降级（缺事件时回退「忙 / 闲」级动画）。dsh 本机已装，但要先验证 headless 事件能力，否则只能当「单任务批处理器」。
2. **专有引擎的分发边界**：Claude、Qoder、dsh 均专有 → 协议写死「应用只调用用户本机自装的引擎，不捆绑、不分发」，ToS 风险留在用户侧。
3. **准入验证自动化**：可以把「能注入 skills/MCP/tools」做成首次启用时的探针（发一个最小任务看是否遵守注入），探测失败就要用户手动声明并承担风险。

## 纪律标注

- 「文档确认 / 主题确认 / 推断」逐项标注；Codex 三项、dsh headless 事件粒度、Gemini stream-json 版本差异为已知待核点。
- 无一引擎因准不足被剔除；商业许可才是主要约束。
