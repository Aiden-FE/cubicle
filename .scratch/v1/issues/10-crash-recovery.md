# 10: 崩溃恢复

**What to build:** 崩溃或强杀后重启，列出中断的任务，用户选择续跑 / 重跑 / 放弃；不静默自动续跑。

**Blocked by:** 06, 09

**Status:** done

- [x] 强杀应用后重启，能看到「中断的任务」列表
- [x] 续跑能从断点继续（引擎支持恢复时）
- [x] 不支持恢复的引擎给出「重跑」选项
- [x] 放弃后任务进入失败归档，历史保留
- [x] 崩溃与重启后不留孤儿进程

## Answer

**完成（2026-11-08）。** 一条命令复现验收：

```powershell
npm run build:renderer
npm run e2e:10    # 需真 codex（CUBICLE_CODEX_PATH）；两阶段共用数据目录，真 taskkill /F 强杀
```

两阶段（e2e-09 的 create/verify 手法）+ **真·强杀**（`taskkill /F` 不带 `/T`）+ **CIM 采样**（`tmp/e2e-10/{crash-ready,recover,crash-samples,recover-samples,db-proof}.json`；模型端仍是本地 mock，pi/codex/进程全是真的）：

- **强杀后重启见「中断的任务」列表（验收 1）**：phase crash 里 4 张慢活真在飞（3×pi 永不自收尾 + 1×codex 睡眠循环）→ orchestrator 强杀 AgentHost（utilityProcess）再强杀 main → phase recover 重启后 `task.interrupted.list` 立即列出 4 张（自愈已把 run/task_session 落 interrupted、任务回待办——04/06 语义原样），**没有一张被自动续跑**（duty 的上班激活只在排班界点触发，重启本身不动它们）。入口是右缘把手新增的「中断待处置」浮层段（四行、徽标「崩溃中断」；工单台列表行与详情也挂徽标）——主画布不让路（硬约束）。
- **续跑从断点继续（验收 2）**：T1 点「续跑」→ 走 09 的 resume 通道（`resume:true` + 追加 task_session，同一 employee_session 实体）→ 引擎会话跨重启延续：续跑后工具事件当场恢复（pi 从 `.jsonl` 会话文件继续）。**关键补丁**：恢复指针改为 **open 即落库**（run-manager 在引擎会话 open 后与每个事件上幂等 `savePointerOnce`；codex 的 `thread:<uuid>` 在 thread.started 落地时同步保存）——原先只在 finishRun 落指针，首轮崩溃的会话必然丢指针、续跑永远退化。
- **不支持恢复只给重跑（验收 3）**：引擎能力声明进 adapter（`resumes: true`：pi=会话文件、codex=exec resume，均有既往票实证；没有声明 = 没有能力）。canResume = 能力 ∧ 指针在场（pi 指针当场 existsSync；`thread:` 指针信引擎），service 一处判定、列表/详情/UI 三处同源。e2e 把 T3 的指针从库里清掉（「会话文件已丢」剧本）：列表 `canResume=false` + hint、把手里该行**没有续跑按钮**只有重跑/放弃、直调 `task.resume` 也被拒 `engine_not_resumable`（UI 与门同一判决）。重跑 = 新 task_session 原合同重发（`taskPrompt`，不带续跑说明）。
- **放弃进失败归档、历史保留（验收 4）**：T4（codex）点「放弃」→ task=failed；orchestrator 亲眼看库：`task_session` 一行不少（interrupted 原样）、artifacts 不删。归档后不再是中断形状：三选门全部拒绝（06 的失败重试出口走 `task.dispatch`，不在这个门内）。
- **不留孤儿进程（验收 5）**：codex spawn 即写 `<dataDir>/engines/codex/children.json`（pid/exe/startedAt，tmp+rename 原子写；退出/出错 forget），supervisor 每次 fork 把宿主 pid **追加**进 `<dataDir>/agenthost.pid.json`（每一代宿主都留账）。main 在 spawn 首个宿主之前扫两本账：CIM 探针确认「同名 + 出生时间 ±10min」才 `taskkill /T /F`；**条目已死时把死 pid 名下还活着的孩子也枚举杀掉**（死 pid 没法 /T，这正是 pi 工具 shell 孤儿的去处）；pid 被复用（同名不同生/异名）绝不碰。扫完清账。e2e 现场：强杀宿主后 `ParentProcessId=死宿主` 下 3 个 pwsh 孤儿 + codex 的 pid 在账上、其子 git.exe 还活 → 重启后 CIM 复采全部归零、`children.json=[]`、agenthost.log 记录 `swept orphan child pid=31624 (git.exe) of dead ledger pid=21520`（**实杀**，不是捡尸）。单测另有真机 smoke：默认 CIM 探针 + taskkill 杀掉一个活着的 cmd.exe 受害者（含 /T 连孩子清干净）。

单测 294/294（`npm test`，新增 ~30）：**store seam**（转移表唯一新边 open→failed；`listInterruptedTasks` 两形状+引擎/指针/迭代数随行；自愈语义与 09 豁免原样保持）；**run-manager seam**（整环：强杀遗留 running 行→开库自愈→resume 通道 open→running+追加会话；恢复指针在 finishRun 之前就已落库）；**service seam**（interrupted.list 的 canResume 矩阵：能力假/指针 null/指针文件丢→只能重跑；resume 三道闸 engine_not_resumable/off_duty/not_interrupted 不留悬挂行；rerun 两种形状——open 直接开工、09 豁免的进行中形状先 running→failed 再走 06 failed→running；abandon 归档历史原样 + 非中断形状拒绝；task.detail 带中断判决）；**child-ledger seam**（记录/遗忘/损坏读空/原子写；身份守卫判定表：同名同生才杀、异名/错龄/已死不杀；死条目名下孤儿孩子实杀、复用 pid 的孩子不杀；真机 smoke）；**crash-residue seam**（两本账都扫、宿主账追加语义）；**scene seam**（handleGroups 第四段「中断待处置」，进行中形状不重复出现）。

### 架构落点

- **崩溃的形状住在 task_session 层**：run/task_session 落 `interrupted`（04 票既有事实），任务五状态不变（open=自愈回待办 / running=09 豁免形状）。中断列表 = 「最近一轮 interrupted ∧ 任务 open|running」的读法（store 一条查询），不是第六态。
- **续跑 = 09 resume 通道 + 一处门扩展**：run-manager 的 resume 门原只认 running；票 10 接受「open 且最近一轮 interrupted」→ 先做表上合法的 open→running 转移再走同一条追加会话通道。**选择记此**：不给 interrupted 造新任务态、不给转移表加 interrupted→running（无此状态）；复用 open→running + resume 标记。
- **转移表唯一改动**：`open → failed`（放弃）。理由：放弃一张中断工单 = 老板对一张已经失败过一次（崩溃）的工单明确弃单，语义上是 06 取消→失败的显式版；它由 service 的 `task.abandon` 门限定只对中断路径开放（未派过单的新待办拿不到这条边，单测钉死），把手/工单台不直接调转移。五状态集合与其余边一律不动；e2e:06 的「待办不可跳」断言（完成/待验收）不受影响。
- **不静默自动续跑**：开库自愈只翻状态、不起引擎；duty 的 clock_in 激活（09 既有）仍会在**上班界点**接走 paused/interrupted 的任务——那是 09 的排班语义，与「重启即自动续跑」是两回事。
- **进程卫生三层**：① 优雅退出=04/11 的 shutdown/killChildrenSync；② 崩溃现场=两本 pid 账本（codex 账 + 宿主账，追加式）；③ 下次启动=sweepCrashResidue（身份守卫 + 死 pid 的孩子清扫 + 清账），排在 supervisor.start 之前——孤儿宿主还持着 SQLite WAL，先杀再开新宿主。`app.requestSingleInstanceLock()` 是这套推理的前提（活宿主在账上=上一代是孤儿，而不是另一个实例）；锁必须放在 `setPath("userData")` 之后（M1 策略拒写工作区外）。

### 环境坑（增量）

- **本机 Chromium 的 job object 会在 main 被强杀时级联清掉 utilityProcess**（`taskkill /F main` 现场 utility 不存活，e2e 实测）——「应用整体被杀」由 job 兜底；账本兜的是不级联的崩溃（宿主单独被杀/电源丢失/宿主先死应用后死）。e2e 剧本因此是：强杀宿主（现场孤儿真存在）→ 强杀 main → 重启扫账归零。
- 真 codex 自带父进程监护（宿主死后 ~1s 内自杀），但它的 **git.exe 孙子会留下**——账本的「死条目扫孩子」正好收它（e2e 日志实证）。pi 的工具进程名是 **pwsh.exe**（不是 powershell.exe），按名字过滤采样会漏——按 pid 全树采。
- `requestSingleInstanceLock` 在 `setPath("userData")` 之前调用会把锁建到 %APPDATA%（本机策略 0x5 拒写，Electron 直接起不来）。
- 合并基线 51e7e44 把 `withTaskService` 的 `dispose` 合丢了（16 个 task 服务单测炸「dispose is not a function」）——本分支顺手修回（commit 注明）。

### 已知边界（留给对应票）

- **e2e:11 的 engine 阶段在本分支与基线 51e7e44 上以同一组断言失败**（切引擎后的 codex 运行不出事件；335s/301s 两次采得一致）——那是 t11 worktree 正在跑的 e2e:11 回归修复的范围，与本票无关；本票回归判据「不比基线更坏」成立（同败同因，absent/risk 阶段两侧全绿）。
- 中断列表不进把手徽标计数（taskCounts 仍是进行中+待验收）；「中断待处置」段自身有计数与红描边。把手徽标要不要含中断数，留给 UI 打磨票。
- canResume 判定用「中断那一轮」的 employee_session 指针；若用户在崩溃后先切了引擎再点续跑，续跑沿用新引擎的会话（能力按新引擎判）——切换与恢复的组合语义留给引擎中心票细抠。
- pi 工具（pwsh）不是 CLI 宿主、不落账本：它的孤儿靠「死宿主 pid 的孩子清扫」收；若将来有引擎的孩子**跨两代以上**脱链（父孙都死、曾孙活），账本够不着——现网无此形态，留观察。
- 崩溃时刻正在跑的 run 的 usage 仍不落库（interrupted 的 token 叙事属 12 票「失败与成本」）。
