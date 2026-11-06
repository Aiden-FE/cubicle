# 04: 说一句话，引擎开跑

**What to build:** 对员工说一句话，它开始干活；你能在界面上看到它的事件（文本增量、工具调用、结束）。每个员工有独立会话目录，不碰本机引擎配置。

**Blocked by:** 01, 02

**Status:** done

- [x] 输入一句话后 2 秒内出现首个事件
- [x] 事件面板按时间显示文本增量与工具调用，可折叠
- [x] 会话数据落在应用私有目录，本机 `~/.pi` 无新增文件
- [x] 中止按钮能停止运行，结束后无残留子进程
- [x] 同一员工连续两次对话复用同一会话（可续）

## Answer

**完成（2026-11-06）。** 一条命令复现验收：

```powershell
npm run build:renderer
npm run e2e:04
```

两阶段全绿（`tmp/e2e-04/{talk,resume,model-requests}.json`；模型端是本地确定性 mock —— M0 实证过的 trick，请求路径仍是真 pi SDK + HTTP/SSE）：

- **talk**：招一名程序员 → 点在岗员工开**右缘对话浮层**（主画布仍是办公室）→ 输入一句话，**首个事件 101–112ms**（`session_start` = 会话实体开始的协议事件，同步落线）且**首个引擎事件（文本/工具，非 session_start）≤2s（实测 205ms）**——2 秒判据不靠合成事件凑数 → 面板按时间显示文本增量（连续 delta 合并成段落）、`read` 工具调用（**默认收起，点「详情」展开参数/结果，再点收起**；「可折叠」按此口径实现）、回合结束带 tokens、`agent_end` 收尾 → **第二轮同一会话实体**（面板两次「会话 #1 开始」）、私有目录里**一条会话 JSONL 持续生长**（27,034→27,872 字节）→ 慢响应中途点**中止**：面板回空闲、落库 `aborted` → 家目录指纹：**根条目不增、`~/.pi` 不存在且不变**（本机 `.codex` 由后台 codex 代理持续改日志，非本应用行为，记为观察项）→ 编排器**全程每 300ms 采样 AgentHost 子进程：14 个样本 max=0**（pi 是 SDK 宿主，进程内跑，天然无引擎子进程——这条对 11 票的 CLI 宿主才有牙齿，届时同样全程采样）→ Ctrl+R 语义重载后重开浮层，最后一轮事件由宿主重放。
- **resume**：全新进程同一数据目录 → 恢复指针（`employee_session.session_file`）在库 → 再对话，**同一条会话文件继续生长**（28,671→29,523）、2 秒内首事件、模型端可见上下文跨重启延续（talk 最大 8 条消息 → resume 首个 9 条）。

单测 82/82（`npm test`）：store seam（`employee_session` 每员工唯一 + 恢复指针重启后在库；`run` 建/收尾/最新一条；**开库时 running→interrupted**；`employeeById`）、run-manager seam（stub 引擎：事件按序透传 + `session_start` 首事件 + resume 指针落库；**同员工复用打开过的引擎会话**；busy 拒绝；abort→aborted；引擎不可启动→`error`+`failed`；**引擎无声 settle→`agent_end unknown`→落库 failed**；**history 尾部上限从最旧裁剪**；无适配器→`engine_unavailable`；history；校验）、service seam（`run.start/abort/history` 信封与错误码）、pi 归一化（主干重写：token 级 delta、工具边界、`agent_settled` 为唯一终局、usage 映射、忽略清单 + `unknown` 兜底）。

### 评审轮（code-review 两轴）落实

- 原型直拷（AGENTS「移植时重写」硬伤）：`pi/normalize.mjs` 重写为**查表折叠器**（FOLDERS map，非 spike 的 switch 复制），`e2e-04-mock-server.mjs` 重写为**帧计划**结构（planReply/ReplyFrame，非 spike mock 的 callback 流水）。
- 修 defect：history 尾部裁剪 `splice(1,1)` off-by-one（会永久保留最旧事件）→ `splice(0,1)`，补 500-delta 上限单测钉死；`agent_end:unknown` 的面板文案与 DB `failed` 语义对齐（「引擎没有报告结果」）。
- 词汇冲突预防：GLOSSARY.md 新增 **执行 Run** 与 **员工会话 EmployeeSession** 词条，与 05 号票挂在任务上的 **会话 Session** 显式区分。
- 收紧判据：2 秒门加「首个引擎事件」断言（见上）；`EVENT_TYPES` 死导出删除；service `run.*` 的 runManager 闸门收敛为一个 `requireRunManager()`；adapter 的 roleSnapshot 访问链收成一次 `manifest` 取值。

### 架构落点（对齐 14 号决策票）

- **双宿主协议的 SDK 侧落地**：`src/host/engine/` —— `events.mjs` 归一化事件词汇（spike 契约移植重写）；`pi/normalize.mjs` + `pi/adapter.mjs`（pi 1.5.0，utilityProcess 内 `createAgentSession`）；`run-manager.mjs` 引擎无关，适配器接口 = `open({employee, session, onEvent}) → {prompt, abort, sessionFile}`（**11 票的 codex CLI 宿主按同一 seam 插入**）。
- **每员工独立目录**（决策 14 目录约定）：`<dataDir>/engines/pi/employee-<id>/{agent,sessions,workspace}`；BYOK 配置在 `<dataDir>/engines/pi/models.json`（provider key `cubicle`；`model: "default"` → 该 provider 首个模型；`"provider/id"` 精确选）。**引擎中心 UI 未做**（属 08/10 票范围），现在手写该文件或 e2e 生成即可跑。
- **会话语义**：本票的「会话」= 员工对话会话（`employee_session`，每员工一条，带恢复指针）；05 号票的任务级 `Session`（挂任务、可多条）在其上扩展。`run` 表记执行历史；宿主重启把 running 落 `interrupted`，10 号票做恢复。
- **能力注入（现状最小版）**：角色快照的 persona → system prompt 追加；tools 清单 → 会话工具白名单（程序员 read/write/edit/bash/grep）。skills/MCP 注入与策略钩子（07 票）留给对应票。
- **事件通道**：`run.event` 主题 → 16ms 合帧 → 浮层时间线；浮层另订阅 `run.history`（宿主内存尾部 ≤400 条）做重载重放。

### 环境坑（增量）

- **electron.exe 不能 spawn 外部进程**（本机安全策略）：进程检查必须在编排器（普通 Node）做；`tasklist.exe` 连过滤器命中都退 1 无输出 → 用 PowerShell `Get-CimInstance Win32_Process -Filter "ParentProcessId=…"`（结果用数组包裹取 `.Count`）。
- 冷启动 Electron 首个 phase 画工位可能 >5s（本机 AV/安全策略），boot 脚手架等待放宽到 15s；与 2 秒判据无关（那个从点「发送」起算）。

### 已知边界（留给对应票）

- 引擎中心 GUI（填 key / 徽章）= 08/10 票；本票配置走文件。
- 多员工并行运行已支持（run-manager 按员工隔离），跨公司并行语义在 09/13 票。
- 预算软闸（角色 50 万 token）未接线：`turn_end` 已带 usage，12 号票做闸门与展示。
- 事件历史只存宿主内存尾部（≤400 条/员工）；持久化事件流随 05 号票的工单/产出落库。
- 打开过的引擎会话常驻宿主（跨对话复用；随 utilityProcess 退出而灭），**没有引擎级清理** —— pi 是 SDK 宿主无子进程所以无害；11 票 CLI 宿主必须在这里补进程回收。
- 归档员工的会话目录保留（术语表「离职」语义），05/06 票处理归档操作本身。
