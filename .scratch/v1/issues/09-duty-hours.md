# 09: 上下班

**What to build:** 公司有上下班时间表，到点自动「上班」激活有未完成任务的员工；手动按钮可立即 override；「下班」后 90 秒宽限、落盘暂停，再上班能续跑；退出程序时三选（直接退 / 等完成 / 取消）。

**Blocked by:** 06

**Status:** done

- [x] 应用运行时，时间表到点自动上班（可配上下班时刻）
- [x] 手动 override 立即生效，且不改动时间表
- [x] 下班后任务进入暂停态，重启后仍可续跑
- [x] 退出时出现三选对话，直接退会先执行下班落盘
- [x] 暂停期间不再产生新的工具调用

## Answer

**完成（2026-11-07）。** 一条命令复现验收：

```powershell
npm run build:renderer
npm run e2e:09
```

两阶段共用一个数据目录（02 票的 create/verify 手法，这里就是「重启」故事本身），`tmp/e2e-09/{duty,resume,exit-dialog,db-proof}.json`（模型端仍是共享 mock：慢活**永不自收尾**，下班才是它的终点；请求路径真 pi SDK + HTTP/SSE，powershell 工具真执行）：

- **时间表到点自动上班（验收 1）**：左轨新入口「上下班」面板：每公司一份配置行（`workStart`/`workEnd` **可配到秒** HH:MM[:SS] + `graceSeconds`，落库可改，没配过读默认 09:00–18:00/90s，`configured=false` 诚实标注）。e2e 把「下班」配成 15 秒后、宽限 5 秒，真实等待演示：到点自动进「宽限中」→ 宽限到期自动落「下班中」→ 次日到点相位 off→on 由单测钉（`duty/schedule` 注入时钟）；上班激活 = 对该公司有未完成任务的员工各续跑一次。
- **手动 override 立即生效且不动时间表（验收 2）**：`duty_override` 是**独立记录**（另一张表），配置行一个字节不写；e2e 现场：下班后点「立即上班」→ 挂起的慢活当场续跑（新 run 在跑 + 工具事件 +2），再读 `schedule.get` 班表原样（00:00 → 20:04:45 / 5s），override 记录 `{mode:"on"}` 独立在场。override 越过下一个排班界点自动失效（单测钉「手动下班不吃掉明天的上班」）。
- **下班 → 暂停态 → 重启可续跑（验收 3）**：宽限（默认 90s，**从下班界点起算**，单测钉）到期 → 引擎 abort、run/task_session 落 `paused`、**任务仍停在「进行中」挂「已下班·暂停」徽标**（五状态没有新增第六态，e2e 断言 `data-status=running` + `data-paused=true`）。退出后 orchestrator 亲眼看库：`run#2=paused`、`task_session#2=paused`、`task#1=running`。第二次启动：徽标与两轮 paused 会话还在（开库自愈**不动** paused——只有没暂停过的 running 会话才落回 interrupted/待办，旧自愈语义对崩溃路径原样保持）；「立即上班」续跑成功，工具事件恢复（引擎会话跨重启延续）。
- **退出三选 + 直接退先落盘（验收 4）**：主进程拦截窗口关闭 → `dialog.showMessageBox` 三钮「直接退 / 等完成 / 取消」（e2e 里对话框是真的，只是手指由脚本模拟：按钮列表落 `exit-dialog.json`）。顺序由 `main/exit-coordinator.mjs` 单测钉死：直接退 = `host.pauseAll` 回答（= 每个 abort 收尾 promise 已把 paused 写进库）之后才允许窗口销毁；e2e 里「窗口销毁」本身就发生在 pauseAll 落库之后，且退出后库里 `run#2=paused`。取消 = 窗口照开（现场：第二次关闭选取消，1.5s 后窗口仍在）。等完成 = `host.awaitQuiet`（run 池安静才退；单测钉）。为此信封总线新增异步门面 `handleEnvelope`（同步门面撞上异步方法诚实报 `async_required`）。
- **暂停后 0 新工具调用（验收 5）**：两道闸 —— ① 引擎 abort（`pause` 与 06 的 abort 同握手、落 `paused`），事件流当场合上；e2e 采样 mock：宽限内 `tool_execution_start` +2、暂停后 3 秒采样 **+0**、续跑后 +2。② 下班中的公司拒绝开新的引擎运行（`task.dispatch`/`run.start`/`task.reject` 报 `off_duty`，界面给「先立即上班」的人话指引）——「暂停期间」按最严格读法：下班中也不该产生新工具调用。多公司并行不牵连：单测钉「A 到点下班只掐 A 的 run」。

单测 228/228（新增 43，全部 node:test）：**`duty/schedule` 纯状态机 seam**（parseClock/validateSchedule 秒级、[start,end) 界、90s 默认、宽限从界点起算、发现过晚不补假宽限、override 立即 off/界点失效、首观测不伪造上班）；**store seam**（三新表 + run/task_session CHECK 加 `paused` + 旧库 CHECK 表重建迁移 + 自愈豁免带 paused 会话的任务 + 列表携带 `latestSessionStatus`）；**duty/runtime seam**（注入时钟 + 假 runManager：到点上班只激活 paused/interrupted 会话的任务、从没派过单的待办不擅自开工、宽限内不掐、宽限可配秒级、多公司隔离、pauseAll、`phaseForEmployee` 闸门查询）；**run-manager seam**（`pause` 落 paused + hook 收到 `paused`、`activeRuns`、resume 通道追加会话不动五状态、误用被拒不留悬挂行）；**artifacts hook seam**（paused 不落四件套不跑 git 不搬任务状态）；**service seam**（schedule.get/set 校验、duty.override、`off_duty` 闸（宽限相位可派单）、`host.pauseAll`/`host.awaitQuiet` 异步信封、被拒的 set 不动已存配置）；**exit-coordinator seam**（三选、直接退 pauseAll→allowQuit 顺序钉死、取消无事发生、对话框不叠加、host 已死诚实放行）。

回归：`npm test` 228/228；`npm run e2e:06 / e2e:08` 全绿（runner 同步一行「全天班表」——`off_duty` 闸改变了产品行为，晚间跑 e2e 的旧票必须先配班表，先例是 06 改 05 判据）；e2e:04/05/07 同步该补丁。

### 架构落点

- **三条独立状态，各一张表**：`company_schedule`（配置行）/ `duty_override`（手动当前态）/ `duty_status`（相位：on/grace/off，落盘 → 重启后视图不说谎）。override 与配置行的隔离是**表级**的，不靠约定。
- **纯判定与副作用分层**：`duty/schedule.mjs`（注入时钟、零副作用、时间可测）→ `duty/runtime.mjs`（把 clock_in / pause_runs / begin_grace 落成真实动作 + 每秒 tick 循环）→ host entry 接线。宽限的「时间」住在界点里（`graceUntil = 下班界点 + graceSeconds`），不在轮询里 —— 1s tick 只是发现机制。
- **`paused` 住在 run/task_session 层**（票面约束）：run 行合上（ended_at 落）、task_session 记 paused、任务五状态不动；「暂停徽标」= `running + 最近一轮 paused`（列表相关子查询带出，渲染层只读）。续跑 = 追加 task_session（与 06 打回同构，复用 baseHead/employee_session，引擎会话跨暂停复用）。
- **退出顺序是结构保证不是礼貌约定**：main 只有 `handleEnvelope` 回答出口（pauseAll 的回答在每个 abort promise 落库之后才发出）→ coordinator 拿到回答才 allowQuit；「等完成」走同一异步门（awaitQuiet）。

### 已知边界（留给对应票）

- **崩溃恢复语义继续留给 10 票**：崩溃遗留（非下班）仍走 04/06 既有自愈（会话 interrupted、无 paused 历史的任务回待办）；「进行中 + interrupted（续跑后崩溃）」的任务由上班续跑接住（本次钉死），但崩溃现场的四件套/成本叙事仍在 10 票。
- **下班中派单/聊天开工被 `off_duty` 拒**（设计决定，见验收 5 的严格读法）；「等完成」退出无超时上限（长活会挂住退出流程，属体验票）；「失败」的暂停任务点「取消」暂时无效（no_active_run 诚实报错）。
- 时间表按**本地时间**、v1 不跨夜（下班必须晚于上班，非法保存被 `invalid_payload` 拒且不脏旧配置）。
- 相位视图（WorkClockPanel）开着时 1s 轮询快照：相位是时间推出来的，没有事件可订阅 —— 这是视图里唯一诚实的轮询。
