# M0 探路结论

> 对应研发票 [01-m0-spike](../.scratch/v1/issues/01-m0-spike.md)。日期：2026-11-05。
> **判定：三关全过，M0 闸门放行，可以进 M1（02 票：能开机的空办公室）。**

## 一条命令重跑

```powershell
npm install
npm run spike
```

- 只跑某一关：`npm run spike -- --only=node | --only=pi | --only=codex`
- 没有 codex 凭据时：`npm run spike -- --skip-codex`（这一关会标 SKIP，**不算 M0 通过**）
- codex 不是原生 `.exe`（例如 npm 的 `.cmd` shim）时，用 `SPIKE_CODEX_PATH` 指向真正的可执行文件
- 原始日志：`tmp/spike/`（git 忽略）：`node/`、`pi/`、`codex/` 各自的 stdout/stderr；codex 的 JSONL 原文在 `tmp/spike/codex/codex-<ts>.stdout.jsonl`

退出码 0 = 三关全过。

## 结果总表

| # | 致命假设 | 判定 | 证据 |
|---|---|---|---|
| 1 | Electron 内嵌 Node ≥ 22.19.0 | **PASS** | Electron 45.2.1 · Node **24.22.1** · Chrome 156.0.8078.75 · win32/x64 |
| 2 | pi SDK 能在 utilityProcess 里流式吐事件 | **PASS** | pi 1.5.0；6 条 text delta、1 次 `read` 工具 start/end、恰好 1 次 agent end；2 个模型请求 |
| 3 | `codex exec` headless 输出可归一化 | **PASS** | codex-cli 0.163.0；JSONL 解析出 1 条文本、1 次 shell 工具 start/end、1 次 turn end（含 usage） |

三关合计本机实测 28–55s（含两次 Electron 冷启动 + 一次真实 codex 调用；codex 的模型响应波动较大）。

## 1. Electron 内嵌 Node

```
Electron 45.2.1
Node     24.22.1
Chrome   156.0.8078.75
V8       15.6.75.25-electron.0
```

- pi 的硬要求是 `node >= 22.19.0`，24.22.1 满足。
- 本机脚本用的 Node 是 22.20.0；**两个版本不要混用**——应用运行时以 Electron 内嵌的 24.22.1 为准。
- 环境坑：本机某些 shell 里带 `ELECTRON_RUN_AS_NODE=1`，会让 `electron.exe` 退化成普通 Node，`require("electron")` 只返回一个路径。spike 在 spawn Electron 前主动删掉这个变量（`spike/run.mjs` 的 `electronEnv`）。以后所有启动 Electron 的脚本都要做同样的事。
- 结论：**不需要换 Electron 版本**。锁 `electron@45.2.1`（本机已有缓存）。

## 2. pi SDK in utilityProcess

spike 的进程形态刻意按 11 票的架构来：

```
Electron main（不 import pi）
  └─ utilityProcess.fork(spike/utility/pi-probe.cjs)
        └─ pi createAgentSession()
              ├─ SessionManager.inMemory()
              ├─ agentDir = tmp/spike/pi/agent（不碰 ~/.pi）
              └─ ModelRuntime → models.json → 本地确定性 mock 模型
```

为了可重复且不依赖模型凭据，utility 里跑的不是真实 LLM，而是 `spike/lib/mock-openai-server.mjs`：一个本地 OpenAI-compatible SSE 端点，按脚本回两轮：

1. 先流 3 段文本，再发一个 `read({"path":"hello.txt"})` 工具调用；
2. 读到工具结果后，再流 3 段文本并以 `stop` 结束。

这不是绕开 pi：请求确实走了 pi-ai 的 `openai-completions` 实现、OpenAI SDK、HTTP/SSE、pi 的工具循环与事件订阅，只是模型端是脚本。验证到的能力：

- `createAgentSession()` 在 Electron 的 utilityProcess 里可加载（ESM 动态 import）；
- `session.subscribe()` 收到 **token 级 text delta**；
- 内置 `read` 工具真实执行，收到 `tool_execution_start` / `tool_execution_end`；
- 工具结果回填后模型继续第二轮，`turn_start` / `turn_end` 成对；
- `agent_settled` → 恰好一条 `agent_end`；
- 会话/配置全部隔离在 `tmp/`，没有创建或读取 `~/.pi`。

**未验证**：真实 provider 的鉴权、限流、异常流、真模型的 token 边界；以及打包后 asar 内的加载。前者不改变结论（SDK 路径已通），后者留给 13 票打包时验。

## 3. codex headless 归一化

本机 codex 的默认 provider 是 litellm（`~/.codex/config.toml`），需要 `LITELLM_API_KEY`。spike 的解析顺序：进程环境 → 本机 DSH 凭据库 `~/.dsh/.credentials.yaml` 的 `refs.LITELLM_API_KEY` → 都不注入，让 codex 用用户自己的登录/配置。凭据**只注入 codex 子进程环境，不打印、不落盘**。

注意：读 DSH 凭据库是探路脚本的本机便利（本机 codex 配置恰好用它），**13 票打包前必须删掉这条路径**；正式应用只从员工/引擎配置取凭据，不读别的应用的 ~。

`codex exec --json` 的实测 schema（0.163.0）与归一化映射：

| codex 原始记录 | 归一化事件 |
|---|---|
| `thread.started` | `session_start` |
| `turn.started` | `turn_start` |
| `item.completed{type:"reasoning"}` | `thinking_delta` |
| `item.completed{type:"agent_message"}` | `text_delta`（整条消息，一块） |
| `item.started{type:"command_execution"}` | `tool_execution_start`（`toolName: "shell"`） |
| `item.completed{type:"command_execution"}` | `tool_execution_end`（`{output, exitCode, status}`，非 0/未完成 → `isError`） |
| `turn.completed{usage}` | `turn_end{status:"ok", usage}` |
| `turn.failed` / `error` | `error`（+ 失败的 `turn_end`） |
| 流结束（`end()`） | `agent_end{status}` |

- codex 的 JSON 模式**没有 token 级 delta**，`agent_message` 是整块文本。归一化后仍是一条 `text_delta`，但消费方必须按 14 票的 `granularity: tool/turn` 降级动画，不能假设逐字。
- 解析器会忽略并计数非 JSON 行（stderr 混入 stdout 的情况），未知记录转成 `unknown` 事件而不是崩掉。
- 首次手工探路用相对 `-C tmp\...` 时，codex 的 Windows 沙箱报 `CreateProcessWithLogonW failed: 267`；改用绝对 `-C` 路径后同类命令成功执行（`echo m0-codex`，exit 0）。当前闸门**要求工具执行成功**（`isError: false`），只解析到 start/failed end 不算过；成功抓取的脱敏副本在 [`test/fixtures/codex-exec-live.jsonl`](../test/fixtures/codex-exec-live.jsonl)，有单测锁定。CLI 适配器一律传绝对工作目录。

## 统一的归一化事件

`spike/lib/events.mjs` 定义、`spike/lib/codex.mjs` 与 `spike/lib/pi-events.mjs` 各自产出：

```
session_start? · turn_start · text_delta · thinking_delta
tool_execution_start · tool_execution_end · turn_end · agent_end · error · unknown
```

这是 14 票协议的最小可执行子集；后续适配器复用这套**事件词汇**。`SPIKE_JSON` / `SPIKE_EVENT` 前缀和 `{type:"spike-event"}` 消息只是探针的进程间调试封装，不是协议的一部分。单测在 `test/codex.test.mjs` 与 `test/pi-events.test.mjs`。

## 三条备选路径（本次都未触发）

1. **Electron 内嵌 Node 不够新** → 锁到满足 ≥22.19 的 Electron 版本；若 Electron 升级受阻，AgentHost 改为外部 Node ≥22.19 sidecar，主进程只做窗口与 IPC 转发。代价：多一个进程/安装项，asar 与退出清理更复杂。
2. **pi SDK 在 utilityProcess 不成立**（加载失败、崩溃、事件丢失）→ pi 降级为 CLI 宿主：子进程跑 `pi --mode json`，用与 codex 同一套 JSONL 归一化。代价：失去 `customTools` 原生策略钩子（07 票降为 best-effort），能力徽章降级；会话仍可用 `--resume`。
3. **codex 输出不可稳定解析** → v1 暂缓 codex，只上 pi；CLI 适配器留在探针/特性开关后面，等 codex 版本稳定再开。代价：v1 少一个「外部 CLI 引擎」实证，但不阻塞 M1/M2。

## 对后续票的直接结论

- **02（空办公室）可以开工**：Electron 45.2.1 + Node 24.22.1 作为运行时基线。
- **04/11**：AgentHost 走 `utilityProcess` 的方向已被实证；pi 适配器按本 spike 的 `agentDir` / `ModelRuntime` / 订阅方式实现。
- **11（第二引擎 codex）**：JSONL 映射表直接可用；注意 codex 无 token delta，动画按 tool/turn 粒度降级。
- **13（打包）**：仍需单独验证 asar 内 pi 依赖、真实 provider 凭据、better-sqlite3 ABI；M0 不覆盖这些。
- 新增的环境注意事项：删 `ELECTRON_RUN_AS_NODE`；codex 的 `-C` 用绝对路径。

## 代码地图

| 路径 | 作用 |
|---|---|
| `spike/run.mjs` | 一条命令跑三关；解析子进程输出、写 `tmp/spike/` 日志 |
| `spike/electron-main.cjs` | Electron 入口：Node 版本模式 / utilityProcess 模式 |
| `spike/utility/pi-probe.cjs` | utilityProcess 内启动 pi 会话、订阅事件、上报归一化流 |
| `spike/lib/mock-openai-server.mjs` | 确定性 OpenAI-compatible SSE 模型端 |
| `spike/lib/codex.mjs` | codex JSONL → 归一化事件 |
| `spike/lib/pi-events.mjs` | pi 事件 → 归一化事件 |
| `spike/lib/events.mjs` | 归一化事件契约（JSDoc typedef） |
| `test/` | 解析器、pi 事件映射、Node 版本判定的单测；`fixtures/codex-exec-live.jsonl` 是脱敏实跑抓取 |
