# 06: 验收与打回

**What to build:** 任务跑完停在「待验收」，你点通过则完成、点打回则在同一任务上追加一次迭代会话；界面显示本任务消耗的 token。

**Blocked by:** 05

**Status:** done

- [x] 任务跑完自动进入待验收，未点通过前不算完成
- [x] 通过后状态为完成，侧边栏展示四件套与本任务 token
- [x] 打回后能继续同一任务，历史连续且迭代次数可见
- [x] 取消能终止并标记失败
- [x] 五个状态（待办/进行中/待验收/完成/失败）在界面上可见且不可跳过

## Answer

**完成（2026-11-07）。** 一条命令复现验收：

```powershell
npm run build:renderer
npm run e2e:06
```

单阶段全绿（`tmp/e2e-06/{review,git-proof}.json`；模型端仍是本地确定性 mock——复用共享 `e2e-mock-model-server`，请求路径为真 pi SDK + HTTP/SSE；员工的命令与 commit 由 powershell 工具真执行）：

- **自动待验收**：派单 →「进行中」→ 跑完自动进「待验收」；`observed=running,open,review` 证明**中途从未显示「完成」**——`完成` 只能来自 `task.accept`（clean run 收尾进 review，aborted/failed 进 失败，由 task hook 落状态）。
- **不可跳过（host 强制）**：五状态转移表放在 store（`setTaskStatus` 唯一门），UI 只展示 + 触发合法转移。e2e 现场验证：`待办→完成`、`待办→打回`、`完成→打回` 全部返回 `invalid_transition`；对照工单停在「待办」可见。旧库（05 的 CHECK：open/running/finished）开库时**自动迁移**：已交产出行映射为待验收，CHECK 经表重建放宽到五状态（迁移单测钉死）。
- **通过后完成**：点「通过」→ 行与详情都显示「完成」（终态）。侧边栏（工单台详情）展示四件套与**本任务 token**：token 来自每个 run 收尾时折叠的 `turn_end` usage（04 票埋的线），store 新增 `run.usage` 列 + `taskTokenSummary` 聚合到任务级——e2e 显示 `tokens=196 → 392`（跨迭代累加）。
- **打回续同一任务**：`task.reject`（带打回意见，进 `rejectPrompt`）在同一任务上**追加**一条 task_session（`listTaskSessions` 历史连续、`iteration` 序号可见：「迭代 2 轮 · 第 1 轮 已完成 | 第 2 轮 已完成」）；同一 employee_session、引擎会话跨迭代复用（单测钉 `opens===1`）。**第 2 轮四件套的 diff 仍相对任务起点**：hook 一直读 `task.baseHead`，编排器证明 4 条 diff 命令全部打在同一个起点 SHA 上，起点之后恰好 2 条新提交、作者均为引擎身份（应用 git 审计依旧全只读零写）。
- **取消→失败**：慢活工单点「取消」→ `task.cancel` → run `aborted` → 任务会话 `aborted`、工单落「失败」（e2e 断言三层一致）；「失败」非终态，界面给「重试」出口（失败→进行中 合法）。
- **五个状态都在界面上出现过**：`observed=running,open,review,done,failed`。

单测 165/165（`npm test`）：store seam（五状态转移表合法/非法两侧 + 旧库迁移 finished→review + `run.usage`/`taskTokenSummary`）、task hook seam（completed→待验收、aborted/failed→失败）、run-manager seam（turn_end usage 折叠到 run 行、无 usage 保持 null、打回第二轮同员工会话单引擎会话追加会话行）、service seam（accept/reject/cancel 信封与 `invalid_transition`/`unknown_task`、detail 的 iterations+tokens、待办不可打回/完成是终态）、playbook seam（`rejectPrompt` 契约）。

### 评审轮（code-review 两轴）落实

- Standards：业务全部留在 AgentHost（store 转移表 = 唯一状态门；service 只在开 task_session **之前**校验，打回被拒不留悬挂行；run-manager 把状态门挪到会话行之前）；渲染层只展示 + 触发。桥错误按纯对象透传 `invalid_transition`。`seedGitWorkspace` 从 05/06 runner 提取进 `e2e-harness`（消除第二份拷贝）。
- Spec：`failed→running` 重试出口是 05 票「重试=新任务会话」语义的延续（失败非终态所需），非新增范围；`task.dispatch` 对 review/done 显式拒绝并给中文指引（「请点通过或打回」），堵住绕过验收的暗门。
- 同态放行漏洞（done→done 曾算 no-op）在评审中发现并收紧：转移表**不含自身**，重复「通过」也报 `invalid_transition`。

### 与 05 的衔接

- 05 的 `finished`（已交产出）升级为 `review`（待验收）：`markInterruptedRuns`/旧库迁移/05 e2e runner 同步（05 回归 `npm run e2e:05` 全绿，判据措辞改「停在待验收」）。
- 四件套 hook 的写入次序不变（产出先行，状态收尾进 review/failed）；05 的「diff 相对起点」在多迭代下天然成立（起点记在 task 上，不随迭代变）。
- token 走 04 票 events 的 `turn_end.usage`（当时留到 12 票的闸门只做了「聚合展示」这一半；软闸/预算拦截仍在 12 票）。

### 已知边界（留给对应票）

- **崩溃恢复语义粗**：host 重启把 running 任务落回「待办」（04 票既有行为），10 票做续跑故事；interrupted run 的 usage 不落库（诚实为 null）。
- 「失败→重试」的派单不带打回意见（原合同重发）；更聪明的重试提示属后续票。
- token 展示为任务级累计（输入/输出明细可见）；12 票预算软闸未接线。
- 归档员工的任务处理仍是 05 票遗留（未变）。
