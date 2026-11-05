# 14 — Agent 引擎适配协议（多引擎）

Type: grilling
Status: resolved
Blocked by: 03, 15

## Question

应用**不内置、不深度绑定任何 agent 引擎**（pi 只是可选项之一）。统一协议如何抽象「本机 agent 引擎」，让员工各自选择引擎干活？哪些引擎能达到准入条件？

## 用户已定的约束

- 引擎来自本机（pi、codex、claude、dsh、qoder… 都是候选），应用按统一协议调用。
- **准入条件（硬性）**：该引擎能支持注入角色技能、MCP、tools；否则不出现在可选项里。
- 03 票已把 pi 的 SDK / 事件流 / 会话持久化 / 能力注入查清；pi 从「内置内核」降级为「可选引擎之一」。
- 引擎准入调研见 15 票：**全部候选通过准入（含基线 pi 共六家），无剔除**；差异在事件粒度（pi / Claude 最稠）、证据等级（Codex / dsh headless 待复核）与许可（Claude / Qoder / dsh 专有）。

## 要拆清楚

- **适配器的最小接口**：哪些事件必须有（文本流、toolcall 开始/结束、turn 结束、错误）？哪些能力必须有（system prompt 注入、skills、tools、MCP、会话持久化、取消 / 暂停 / 恢复）？**策略钩子（07 票）**：工具级拦截 + bash 黑名单必须在适配层内统一实现，而不是每个引擎各写一套。
- **两种调用形态**：进程内 SDK（如 pi 的 `createAgentSession`）vs 子进程 CLI headless（如 `claude -p` / `codex exec` 的 JSONL）。协议要不要统一到「外部进程 + 归一化 JSONL」一条路，还是双形态并存、由宿主打平？
- **引擎探测与准入**：怎么发现本机装了哪些引擎（PATH 探测 / 用户手填命令）？「能注入 skills/mcp/tools」能否自动验证？验证不了的允不允许手动声明 + 风险提示？
- **能力对等矩阵**：pi 的 SKILL.md、Claude 的 skills、各家 MCP 支持度不同 —— 协议定义「声明式能力清单」，设置页按实际支持度禁用不可用项，而不是让用户配了才发现不支持。
- **输出归一化**：不同引擎事件粒度不同，动画（09 票）和任务侧边栏消费的是同一套归一化事件。
- **v1 引擎清单**：先接哪 1–2 个（建议 pi + 一个 CLI 型），其余进雾。

## 要产出

适配层接口定义（事件、注入、生命周期）、调用形态选择（SDK / 子进程 / 双形态）、准入检测方案、v1 引擎清单、引擎能力对等矩阵。

## Answer

**结论：双宿主（SDK 型 + 子进程 CLI 型）对齐在一条归一化事件总线上，协议不绑传输；v1 只写 pi + codex 两个适配器；启用必跑「自动探针三验」，失败允许手动声明（带风险徽章）；事件基准 = pi/Claude 的 token 级；生命周期：取消必备、暂停/恢复可选但必须显式声明；策略钩子是协议成员而非引擎私货（07 票）。**

### 1. 分层架构

```
[UI · 工单台 · 工位动画]  ← 归一化事件总线（token 级基准）
        ↑ 注入：角色快照（05 票 manifest）· 策略表（07 票）· 预算闸门（04 票）
[Adapter Runtime]
  ├─ SDK 宿主：pi createAgentSession（utilityProcess 内）
  ├─ CLI 宿主：codex exec / claude -p / qoder -p / gemini -p（headless + stream JSON）
  └─ 能力声明 engine.capabilities（驱动 UI 徽章与降级）
```

### 2. 协议最小接口

**事件（必须）**：`turn_start` / `message_update{content_delta, thinking_delta, toolcall_start/end}` / `tool_execution_start/end{摘要}` / `turn_end` / `agent_end{status}` / `error{code, 人话}` / `usage{in,out}`；
**可选**：工具内 stdout 细流、checkpoint_created、fork。
粒度声明 `granularity: token | tool | turn` —— 低于 token 的引擎（如 dsh headless 只回终末文本）动画直接降级到「忙/闲」（09 票已定）。

**能力声明 capabilities**（引擎卡徽章与降级的唯一事实源）：
`{ granularity, inject:{prompt,skills,tools,mcp}, lifecycle:{cancel:"y",pause:"opt"}, restore, usage, policyHook:"native|best-effort" }`

**注入约定**：
- SDK 宿主 → registerTool / SKILL.md 目录（应用私有）/ system prompt 钩子。
- CLI 宿主 → 员工私有工作目录内放各引擎的自有配置（AGENTS.md / .claude/ / .qoder/）+ 命令行 flags（`--append-system-prompt` 等）；会话用 `--resume`。
- 目录约定：`%APPDATA%/ai-office/engines/<engine>/<employee-id>/…`，永不写真机 `~`（03/04 票隔离原则）。

### 3. 策略钩子（07 票落点）

- SDK 宿主：customTools 内直接拦截（edit/write 工具级拦截 + bash 黑名单）——**native**。
- CLI 宿主：在员工目录里的注入模板 + 启动 flags 才能「尽力而为」——**best-effort**；探针必须验证拒绝是否可见，不行就不给这类引擎过 bash 白名单外的操作。

### 4. 生命周期

- `cancel`：**协议必备**（SIGTERM → 等 3s → Windows 上连进程树强杀）。
- `pause/restore`：**可选**，声明后才显示「下班暂停可续跑」；CLI 引擎用 transcript + `--resume`；SDK 引擎用会话树；恢复失败时自动降级为「新会话重述任务」（13 票语义）。

### 5. 准入探针（启用必跑，已拍板）

一次性最小任务跑四个验证，结果写进引擎卡徽章：
1. **注入生效**：system prompt 埋 marker（不写任何文件）；
2. **工具可见**：注入的工具枚举对得上；
3. **拒绝可见**（07 票）：探测一次工作区外的写操作，验证拒绝文本回进结果、事件可见；
4. **事件完整**：token 级 / toolcall 边界回传率。

失败可手动声明启用（badge = ⚠ 风险自理），但从「准入三件套缺失」的角度，若连 tools 都注入不了，直接不进可选项（05 票硬条件）。

**发现的策略**：左轨 ⚙ 引擎中心首扫 PATH + 常见安装位（codex/claude/qoder/gemini/dsh）；未装 → 灰徽章 + 安装引导；手动指定可执行路径 + 自动探针兜底。

### 6. v1 引擎清单（已拍板）

- **pi**：SDK 宿主（默认引擎 · 04 票 · 事件最全）。
- **codex**：CLI 宿主首个真验（本机已装已登录 · 15 票；三项待复核靠探针兜底）。
- qoder / claude / gemini：协议已覆盖（CLI 宿主同构），进 v1.5 候选，装了即可探针。
- dsh：headless 事件粒度未核 → 留雾，验证过再适配。

### 7. 修正/打包注意

- Node ≥ 22.19（pi 依赖）；代码内锁适配器版本。
- asar 内 pi 的 pure-node 依赖（03 票推断）→ 打包时 utilityProcess 直跑。

### 交接

- 13 票（生命周期）按本协议落地 pause/restore 语义
- 11 票（技术架构）按本协议生成宿主进程模型与 IPC 契约
- 09/05 票的动画与灰徽章由 capabilities 驱动
