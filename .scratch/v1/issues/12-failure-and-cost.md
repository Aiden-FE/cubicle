# 12: 失败与成本

**What to build:** 失败时给可读原因与一键重试；token 用量在任务 / 员工 / 公司三层可见；单任务超过 50 万 token 有软提示，到顶暂停并可一键 +50% 继续。

**Blocked by:** 06

**Status:** done

- [x] 失败显示人话原因（不是堆栈），并给出一键重试
- [x] 重试创建新会话，历史与产出保留
- [x] 任务侧边栏、员工名牌、公司面板三层 token 可见
- [x] 80% 出现黄点提示，100% 暂停并可用 +50% 继续
- [x] 未计量的引擎明确标注「未计量」而非显示 0

## Answer

**完成（2026-11-07）。** 一条命令复现验收：

```powershell
npm run build:renderer
npm run e2e:12
```

一个连续办公室故事（`tmp/e2e-12/{cost,db-proof}.json`；模型端仍是共享 mock，新增**按请求计费**能力：burn 剧本逐轮报 usage、未计量剧本整帧不发 usage；坏模型路径不改代码、当场改写 `engines/pi/models.json` 的 provider 键，适配器每次 open 重读）：

- **失败人话 + 一键重试（验收 1）**：run-manager 把「settled 状态 + 归一化事件尾」折叠成**一句人话**存进 `run.fail_reason`（`engine/failure.mjs` 纯函数：已知错误码给老板读的句子 + 引擎原话一行 + 码，未知码保底 `引擎报错（code）：…`；aborted=「已取消」、interrupted=「应用中途退出」、静默收场=「引擎没有回音就收场了」；200 字封顶、折成单行、无堆栈帧）。工单详情红框显示 `detail.failure.reason`（store 读最近一轮失败会话，视图不重derive）+「重试（新会话再来一轮）」按钮。e2e 现场：坏 models.json 派单 → 当场失败 → 详情显示「开跑失败：引擎里找不到员工用的这个模型…（engine_model_missing）」；库里 fail_reason 单行含码、无 ` at ` 堆栈帧。重试被 09 的 off_duty 闸拒时，`act()` 按桥约定读纯对象 `{code,message}`，「公司正在下班中：先点立即上班」原样上屏（09 既有闸，e2e 全天班表不误伤）。
- **重试 = 新会话，历史与产出保留（验收 2）**：重试走 06 的 `task.dispatch`（failed→running 合法转移），**追加** task_session，旧轮状态原样。e2e：迭代 2 轮 ·「第 1 轮 · 失败 | 第 2 轮 · 已完成」；orchestrator 亲眼看库：`sessions=failed,completed`、四件套 ×2（artifacts=8）累加不覆盖；重试成功后旧失败人话不再显示（failure 读最近一轮 = null）。
- **三层 token 可见（验收 3）**：host 聚合走信封 —— 任务级在 `task.detail.tokens`（+ 事件流上的实时用量），员工级 `employeeTokens`、公司级 `companyTokens` 随 office 快照走（`foldTokenTotals` 连没跑过的员工/公司也建桶，measured=false）。e2e：任务侧边栏 530/590 实时数、甲名牌 `786`、乙名牌「未计量」、左轨公司面板 `tokens 786`。
- **80% 黄点 / 100% 暂停 / +50%（验收 4）**：判定住在 `cost/budget.mjs` 纯函数（<80 ok、80–99 warn、≥100 exhausted，`+50% = 1.5×` 落库保持整数）；预算在**开单时从角色 cost.tokenBudgetPerTask 抄进任务行**（迁移给旧库补列，默认 50 万），+50% 只改这张工单、不动角色模板。run-manager 每次 turn_end 折完 usage 就查闸：warn 发一次 `budget_warning`（黄点活在事件流上，轮没收尾也能上屏），exhausted 发一次 `budget_exhausted` 后走 **09 的 settleCancel(paused) 门**——run/task_session 落 `paused`、任务仍「进行中」挂「预算到顶」徽标（**无第六态**）、引擎 abort 保证到顶后 0 新工具调用。详情「+50% 继续」= `task.extendBudget`：预算落库 1.5× + 走 09 的续跑通道（追加会话，提示词里明说预算已提到）；下班中只涨预算不续跑（resumeNote 人话）、员工还在跑诚实报 employee_busy。e2e：小预算 500 → 410 黄点 → 530 到顶自动暂停（库里 run=paused）→ +50% → 750 落库 → 当场续跑到「待验收」，总账 590 在新预算内。
- **未计量 ≠ 0（验收 5）**：usage 三态在 store 定型 —— 引擎报过就存（**全 0 也是「计量到 0」**），从没报过才是 NULL；pi 归一层把「provider 全 0 的 usage」识别为没报（不然未计量引擎会被记成免费）。`taskTokenSummary.measured`、`employeeTokens/companyTokens.measured` 三态上信封；显示层 `tokenText` 一律「未计量」。e2e：不报 usage 的 mock 跑完工单 → 侧边栏/名牌显示「未计量」；库里所有 run 的 usage 都是 NULL。

单测 267/267（新增 45，全部 node:test）：**cost/budget 纯状态机 seam**（79.8%/80%/100% 边界、无预算不闸、+50% 取整、提额后再见顶）；**engine/failure seam**（各 status 的句子、已知/未知错误码、多 error 取最后、aborted/paused 不带原因）；**run-manager seam**（80% 一次 warning 带 tokens/budget、100% exhausted→paused 落盘复用 09、usageReported 三态、fail_reason 落库）；**pi/normalize seam**（全 0 usage 不算上报）；**store seam**（token_budget/fail_reason 迁移、finishRun 三态不塌缩、latestFailReasonForTask、setTaskTokenBudget、员工/公司聚合含零出场实体）；**service seam**（角色预算抄进任务、detail 带 budget/failure、extendBudget 的 paused 续跑/下班中只涨额度/employee_busy/非法状态拒绝）；**tokenReadout 读层 seam**（未计量文案、warn/exhausted 镜像、无账不判）。

回归：`npm test` 267/267；`npm run typecheck`、`npm run build:renderer` 绿；`npm run e2e:06`、`npm run e2e:09` 全绿。e2e 基建两处补丁（先例：09 给旧票配班表）：共享 mock 的 usage 三态**默认值不变**（04–09 剧本一字不动）；`ensureAllDaySchedule` 改班表后**等相位翻到 on 再返回**——派单闸门读落库相位，不等就是在和 1s duty tick 赛跑（本票 e2e 实录：dispatch 比下一拍早 23ms 被 off_duty 拒）。

### 架构落点

- **判定与副作用分居**：`cost/budget.mjs`（纯阈值）→ run-manager（发事件 + 调 pause 门）→ service（落库 + 续跑合同）→ renderer（`tokenReadout.js` 只是显示镜像，注释钉死「不是第二判定源」）。预算信号住在事件流上（`budget_warning/budget_exhausted` 是 host-origin 事件，与 policy_blocked 同族，适配器不得发明）。
- **失败叙事的单一所有权**：只有 run-manager 认识「事件尾」，折叠发生在 finishRun 之前；store 存成品句子，UI 读现成的——堆栈永远进不了信封。
- **paused 复用不扩状态机**：预算暂停与下班暂停共用 run/task_session 的 `paused` 层；徽标上「预算到顶」vs「已下班·暂停」的区分是**显示层从预算判定推出的**，库里没有第二事实。
- **缺失与 0 严格区分**：usage NULL（未计量）/ usage 全 0（计量到 0）/ usage 有数 三态贯穿 store 聚合、信封、显示；聚合表连零出场实体都建桶。

### 已知边界（留给对应票）

- 崩溃现场的失败叙事（interrupted 句子里「崩溃恢复属票 10」的指路）等 10 票接；`fail_reason` 只在 run 收尾时折叠一次，host 崩溃前未收尾的 run 没有句子（开库自愈标 interrupted 属 10 票）。
- 预算判定只在 turn_end 后查（usage 本来就是按请求报的，请求中途不可知）；单请求烧穿预算的超额部分照常入账、账单不说谎（e2e 钉了 usage 落库）。
- 「+50%」对「失败/待办」工单被 `invalid_transition` 拒（预算到顶的工单必在「进行中」）；多次 +50% 可叠加（1.5× 复利），无上限封顶——封顶策略属成本体验票。
- 公司面板 token 显示的是**该公司全部员工**的累计（含已解雇员工的历史 run 不进快照聚合——desks 只列在职员工，聚合按 run.employee_id 分组，解雇员工的桶不渲染）。
