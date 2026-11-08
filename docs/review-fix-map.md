# Cubicle V1 审查修复映射（代码 + UI）

> 审查对象：V1 13 张研发票的全量代码与界面。
> 本文件逐项映射「审查发现 → 修复 → 回归证据」。结论先行，随后按 P0/P1/P2/P3 分组；最后单列**有意保留的产品决策**（不是未修复缺陷）。

## 总体结论

- **代码 P0 / P1 全部关闭**（共享工作区、codex 策略同源、任务转移原子性、崩溃恢复、取消收尾、账本身份、IPC 边界等）。
- **UI P0 / P1 全部关闭**（z-index、900×600 左轨、详情决策可见性、对话用户消息、git 上手闭环、引擎中心、状态浮层、对比度）。
- **P2 / P3 除「产品决策」清单外全部关闭**；清单中的每项都标了替代方案与理由。
- 没有已知的功能性遗留；全量单元测试、typecheck、13 张产品票的 e2e 均通过（02–13，01 为 M0 spike 不属于产品票）。

## 验证基线

| 检查 | 结果 |
|---|---|
| `npm run typecheck` | 通过（tsc strict + renderer checkJs） |
| `npm test` | **386 / 386 通过** |
| `npm run e2e:02` | PASS |
| `npm run e2e:03` | PASS |
| `npm run e2e:04` | PASS |
| `npm run e2e:05` | PASS |
| `npm run e2e:06` | PASS |
| `npm run e2e:07` | PASS |
| `npm run e2e:08` | PASS |
| `npm run e2e:09` | PASS |
| `npm run e2e:10` | PASS |
| `npm run e2e:11` | PASS（真 codex 子进程 + 真拒绝 + 中止无残留） |
| `npm run e2e:12` | PASS |
| `npm run e2e:13` | PASS（打包/卸载/第二实例/账本清扫） |

界面证据（`tmp/ui-shot/shots/`）：

- `13-narrow-office.png`：900×574 左轨单列、无换行、无裁切。
- `14-narrow-bench.png`：工单台浮层在工位之上，点击不再被 desk 拦截。
- `11-detail-tall.png`：详情顶部即决策；证据在按钮之前；按钮 sticky 可见。
- `12-chat-tall.png`：用户消息气泡 + 助手文本/工具/元信息分层。
- `15-engine-panel.png`：引擎中心真实卡片（徽章/探针/四验/带风险启用）。
- `16-two-drawers.png`：左侧抽屉互斥（只剩工单台，无 60px 切片）。
- `17-status-fixed.png`：状态浮层与名牌/气泡开关不再重叠。

---

## 代码审查修复

### P0（2 项）

| # | 问题 | 修复 | 回归证据 |
|---|---|---|---|
| C-P0-1 | 工作区按引擎分（`engines/<engine>/employee-<id>/workspace`），同一员工两张工单可能钉进不同 repo，引擎切换后任务产物/起点 HEAD 对不上 | 新增 `employeeWorkspaceDir(dataDir,id)=<dataDir>/workspaces/employee-<id>`；`enginePaths().workspaceDir` 统一指向它；任务运行强制使用 `task.workspaceDir`；开库一次性把当前引擎工作区迁到共享目录并重指 session/task，旧回退目录保留 | `test/store.test.mjs`（迁移/任务重指）、`e2e:05`（同一 HEAD 起点、产物）、`e2e:11`（pi→codex 同员工同工作区） |
| C-P0-2 | codex hook 是自写的 `hooks/policy.mjs`，重复实现策略、fail-open、没有工作区上下文；宿主与 hook 判决可能分叉 | hook 改为薄客户端：POST 宿主 `/decide`，拿不到 bridge/解析失败/超时一律 **deny**；bridge 带 token（timing-safe）、1MB body cap、无 decider 也 fail-closed；`decideToolAccess` 接收 `workspaceDir`，越界路径/编码命令在宿主统一判 | `test/codex-policy-hook.test.mjs`、`test/policy.test.mjs`、`e2e:11`（同一 decideToolAccess 拒绝可见、危险删除未执行） |

### P1（10 项；下表含 12 条，其中 2 条为同一安全面的补充切面）

| # | 问题 | 修复 | 回归证据 |
|---|---|---|---|
| C-P1-1 | `finishRun` 的 run 落库、resume 指针、task_session 全在一个 try 里；一个失败会跳过后面的收尾 | 三段独立 try，各自 stderr 记录；run 先落，pointer 与 task_session 不再互相拖垮 | `test/run-manager.test.mjs`（双收尾/失败不吞） |
| C-P1-2 | 任务状态、task_session、run 三步分开写，崩溃可留下半套 | `store.beginTaskRun` 单事务：合法转移 + 追加/复用 task_session + create run；非法转移 `invalid_transition` 整体回滚 | `test/store.test.mjs`（事务/非法转移/双 settle） |
| C-P1-3 | 迁移重建表时 FK 仍开、表索引随 drop 丢失、坏数据可能被静默写入 | 迁移统一 `PRAGMA foreign_keys=OFF` → rebuild → `foreign_key_check` → ON；索引在迁移后统一重建；开库 `assertRequiredColumns` 钉住列契约 | `test/store.test.mjs`（pre-05/pre-09/pre-11 夹具、FK check、列断言） |
| C-P1-4 | 取消不等待引擎 `close`；迟到事件会落进下一轮/旧 UI | `abort()` 等 child close（3s）；run drain（默认 4s）；epoch + adapter identity；`onEvent` 丢弃 retired epoch/已收尾 run；`settleCancel` 等 completion | `test/run-manager.test.mjs`（drain/旧事件）、`test/codex-adapter.test.mjs`（abort 等 close） |
| C-P1-5 | supervisor 固定退避、`stop()` 不等待、无 onExit 通知，退出时可能留下 host | 指数退避 1→2→4→8→16→30s，收到消息重置；`onExit` 回调；`stop()` 返回 Promise（600ms grace 后 kill）；`will-quit` 等待 stop | `test/supervisor.test.mjs`、`e2e:13`（stop 后 host 退出） |
| C-P1-6 | 崩溃账本只按 PID，PID 复用会误杀；强杀失败被忽略；children 扫描超时 | 账本记录 name/startedAt/commandLineHint；`identityMatches` 复核；sweep 跳过早于 `startedAt-60s` 的进程；kill 非 0/超时报错；probe/child 扫描 3s 超时；host exe 名从 `process.execPath` 推导 | `test/child-ledger.test.mjs`、`test/crash-residue.test.mjs`、`e2e:10`（孤儿清扫/账本清空） |
| C-P1-7 | 任务状态机可跳步（open→done 等） | `beginTaskRun` 内统一合法转移；UI 只发动作，host 判决；非法转移回 `invalid_transition` | `test/service.test.mjs`（open→done/reject 被拒、running→running 走 resume） |
| C-P1-8 | codex 子进程继承 `CUBICLE_CODEX_KEY` 等宿主密钥 | `config.toml` 写 `shell_environment_policy`：`inherit="all"` + `exclude=["CUBICLE_CODEX_KEY"]`；密钥只经 engine config/BYOK 文件 | `test/codex-adapter.test.mjs`（配置断言）、`e2e:11`（真实 codex 跑通） |
| C-P1-9 | hook trust 只在 open 时写一次，配置/hook 更新后可能不生效 | `prompt()` 每轮重写 engine config + 确保 hook 安装；codex 启动带 `--dangerously-bypass-hook-trust`；hook 不再输出宿主 policy 副本 | `test/codex-adapter.test.mjs`（hook 不存在/每次重写） |
| C-P1-10 | git 读取同步阻塞 host；artifact hook 同步拖住事件循环 | `git/reader.mjs` 改 `execFile` 异步（8s timeout、8MB maxBuffer、error code）；artifact hook async；run-manager `pendingSideEffects`/`whenQuiet` 等它；`entry` 在产出落盘后发 `task.artifacts` domain 事件 | `test/git-reader.test.mjs`、`test/task-artifacts.test.mjs`、`e2e:05/06/12` |
| C-P1-11 | 渲染进程可调任意 host 方法；导航/window.open 未拦；IPC sender 未验 | `RENDERER_METHODS` 白名单（main 拒绝 `host.*`/未知方法）；`senderFrame` 校验；导航/window-open/webview 拦截；`cubicle:app-info`/`open-workspace` 也校验 sender；app-info 不向子帧暴露 | `test/ipc-methods.test.mjs`、`test/ipc-channels.test.mjs`、`e2e:13` |
| C-P1-12 | 工具路径越界、危险 shell（rm -rf / git clean -xdf / 编码 PowerShell）可绕过 | `decideToolAccess({toolName,args,workspaceDir})`：路径 resolve 后必须在工作区；shell 规则补 `rm --recursive`、`ri -recurse -Force`、`git clean -xdf`、`-enc/-EncodedCommand`；系统路径黑名单 | `test/policy.test.mjs`、`e2e:11`（拒绝可见 + 文件存活）、`e2e:07`（marker/红灯） |

### P2（审查 12 项 + 2 条补充；同源项见 P1）

| # | 问题 | 修复 | 回归证据 |
|---|---|---|---|
| C-P2-1 | `requireCompany`/`task.list` 为验证公司拉整个 office snapshot（两次全量 token 聚合） | `store.companyExists` + `store.activeGroupId()`；`office.setActive` 也用 `companyExists`；duty tick 用 `companyIds()` | `test/service.test.mjs`、`test/store.test.mjs` |
| C-P2-2 | duty tick 用 `officeSnapshot()` 每 1s 全量聚合 | 只取公司 id/相位/活跃员工；任务 token 只在续跑时按 task 查 | `test/duty-runtime.test.mjs` |
| C-P2-3 | 引擎永不收尾时员工永久 busy，`whenQuiet`/等完成挂死 | run watchdog（默认 30min）推 `run_timeout` 并强制 settleCancel；`unref` 不阻止退出 | `test/run-manager.test.mjs`（watchdog） |
| C-P2-4 | 探针超时后 run 仍占着探针员工，后续探针全 `employee_busy` | 超时调用 `abortRun`；`startRun` 抛错时先退订；定时器句柄安全 | `test/probe.test.mjs`（超时 abort） |
| C-P2-5 | 失败原因在重试后仍显示旧 run；语义不清 | 固定为「最近一轮会话」的 fail_reason；重试成功归 null；文档注明 | `test/service.test.mjs`、`test/store.test.mjs`、`e2e:12` |
| C-P2-6 | 角色快照裸 `JSON.parse`，坏数据会掀翻 office.get | `parseJsonOr` + `UNKNOWN_ROLE_SNAPSHOT`（含默认预算），脏快照降级 | `test/store.test.mjs` |
| C-P2-7 | 角色库 seed 一次性，升级后新字段/新角色不生效 | `ROLE_SEED_REV` 版本化 upsert；已聘员工快照保持冻结 | `test/store.test.mjs`（role seed upgrade） |
| C-P2-8 | codex prompt 以 `-` 开头会被当 CLI flag | 以 `-` 开头时前置一个空格，保持位置参数 | `test/codex-adapter.test.mjs` |
| C-P2-9 | taskPrompt 给 Windows 员工写「用 bash 工具」 | 改为「shell 工具（Windows 上是 PowerShell）」 | `test/playbook.test.mjs` / 文案 |
| C-P2-10 | git 审计无上限，长会话内存增长 | 审计每引擎 cap 200，超出丢最旧 | `test/git-reader.test.mjs` |
| C-P2-11 | codex 非零退出、全 0 usage、无 agent_end 的语义混乱 | 非零退出发 `engine_exec_failed` 并以失败 end；全 0 usage 视为「已计量 0」并落库；`normalizer.end(cleanExit)` 区分静默收尾 | `test/codex-adapter.test.mjs`、`test/codex.test.mjs` |
| C-P2-12 | 探针/子进程扫描可能永久挂起；`probe_at` 被自愈覆盖 | 探针/child 扫描 3s 超时；`markInterruptedProbes` 只改状态不覆盖 `probe_at` | `test/child-ledger.test.mjs`、`test/store.test.mjs` |
| C-P2-13 | codex stdout / child-ledger 按 chunk `String()` 解码，中文跨 64KB 边界变 U+FFFD | 三处 `setEncoding("utf8")`；整行消费 | `test/codex-adapter.test.mjs`、`test/child-ledger.test.mjs` |
| C-P2-14 | 四件套无迭代作用域：旧产出平铺，默认展开最旧 diff | `task.detail.latestArtifacts` + UI 最新一轮置前、历史产出折叠；e2e 断言 latest=4/history=4 | `test/service.test.mjs`、`e2e:06`、`e2e:12` |
| C-P2-15 | 死 pid 的子进程只按 ParentProcessId 盲杀，pid 复用风险 | child CIM 采样 `CreationDate`；早于账本 `startedAt-60s` 的子进程拒绝杀 | `test/child-ledger.test.mjs`、`e2e:10` |
| C-P2-16 | BYOK 改动不生效：adapter handle 永久缓存 | `adapter.configFingerprint()` 指纹变化退役旧 handle，下一轮重新 open | `test/run-manager.test.mjs`、`test/codex-adapter.test.mjs` |
| C-P2-17 | 索引/异步 git/退避/渲染层批处理（审查表 #7/#8/#11/#12） | 统一索引、async execFile、指数退避、DeskCard memo + chat 50ms/400 上限 | `test/git-reader.test.mjs`、`test/supervisor.test.mjs`、`test/run-manager.test.mjs` |

### P3（全部关闭）

| # | 问题 | 修复 |
|---|---|---|
| C-P3-1 | service 方法表走原型链 | `Object.hasOwn(methods, method)`；`toString` 测试 |
| C-P3-2 | main/preload channel 名各写各的 | `test/ipc-channels.test.mjs` 双向钉住 |
| C-P3-3 | 无 CSP | `renderer/index.html` meta：`default-src 'none'; script-src 'self'; ...` |
| C-P3-4 | 每个 desk 的 SVG gradient id 重复 | `uid=desk-<id>` 前缀 |
| C-P3-5 | 抽屉无 focus/Esc/aria | `useDialog`：入焦、Tab 循环、Esc、归还焦点；全部抽屉 `role=dialog aria-modal` |
| C-P3-6 | 发送失败丢草稿 | `ChatOverlay` 失败时移除乐观气泡并回填草稿 |
| C-P3-7 | 状态点无 aria、浮层点外不关 | `aria-label/aria-expanded` + outside mousedown + Esc |
| C-P3-8 | 组件错误白屏 | `AppErrorBoundary` + 重载入口 |
| C-P3-9 | 失败原因/产出含密钥 | `src/shared/redact.mjs`；artifact 文本、failure 单行都过 redaction |
| C-P3-10 | schema 列漂移无守护 | `assertRequiredColumns` |
| C-P3-11 | `requestClose` 失败无 catch | 退出协调器 catch 并记录 |
| C-P3-12 | 删除 codex hook 的宿主 policy 副本 | 删除 `src/host/engine/codex/policy.mjs`（无引用） |

---

## UI / 交互修复

### P0（1 项）

| # | 问题 | 修复 | 证据 |
|---|---|---|---|
| U-P0-1 | `.desk` 的 `z-index:140/380` 在根层叠上下文压过抽屉/弹层（30/40），工位画在浮层之上并抢点击 | `.office-floor { isolation:isolate }` 把 desk 的 painter z-index 关进办公室内部 | `14-narrow-bench.png`、`05-hire` 修复后 e2e-03/08 |

### P1（7 项）

| # | 问题 | 修复 | 证据 |
|---|---|---|---|
| U-P1-1 | 900×600 下左轨 flex 子项被压 → 竖排文字折成两列、裁切 | 左轨固定 120px + `overflow-y:auto`；rail 子项 `flex:0 0 auto` + `nowrap`；低高度媒体查询缩小 padding/字号 | `13-narrow-office.png` |
| U-P1-2 | 公司/项目组切换器两行文字换行/溢出 | `switcher-value` 省略号 + `title` + `aria-label`；13px 字号；切换器宽度 100px | `17-status-fixed.png` |
| U-P1-3 | 详情操作在折叠线下（918 视口 actionsTop=648/771），产出在决策之后 | 详情态隐藏派单表单；顺序改为目标→验收→起点/成本→证据→决策；`task-decision-bar` sticky 底部；详情标题/分节标签 | `11-detail-tall.png`（artifactsTop 417、actionsTop 673 且 sticky） |
| U-P1-4 | 对话只有助手输出，没有用户消息 | 发送时乐观用户气泡；`run.history.lastRun.prompt` 回放；失败回滚并回填草稿 | `12-chat-tall.png`、e2e-04 |
| U-P1-5 | 新工作区不是 git 时只报错，用户没有下一步 | 错误注记 + 「打开工作区」+「让员工初始化仓库」两个动作；main 从 employeeId 推导路径，不接受渲染进程路径 | `e2e:05`（not_a_git_workspace 提示） |
| U-P1-6 | 没有 ErrorBoundary：坏 payload / 旧角色缺 `cost` 整页白屏 | `AppErrorBoundary` + 重载出口；HireModal 对 `cost`/skills/tools/mcp 全部可选链 | `renderer/src/ErrorBoundary.jsx`、`test/e2e:03` |
| U-P1-7 | 引擎中心是「票 11 地盘」占位；引擎卡埋在聊天里 | 引擎中心变为真实卡片（徽章/版本/准入/四验/错误/配置目录/跑探针/打开目录/带风险启用）；聊天里保留**员工级**引擎卡用于切引擎（产品决策，见末节） | `15-engine-panel.png`、e2e-08、e2e-11 |

### P2（12 项 + 2 条补充交互）

| # | 问题 | 修复 |
|---|---|---|
| U-P2-1 | 状态弹层与「名牌/气泡」开关重叠 | 浮层 `position:absolute; top:100%+8; z-index:25`；view toggles 移到右下；点外/Esc 关闭 |
| U-P2-2 | 对比度不足：warn 2.61、白字 on warn 2.93、ok 3.73 | `--warn:#8a5a12`、`--ok:#2f6d4a`、`--review:#5b3fa0`、`--muted:#6f675c`；白字按钮 ≥4.5:1 |
| U-P2-3 | 成功提示也用红色 `.task-note` | `task-note-ok` + WorkClock/TaskBench note tone |
| U-P2-4 | 上下班面板 0 padding；1s 轮询覆盖用户输入 | `.workclock-body` 12/16/16；表单每公司只 hydrate 一次，轮询只刷新相位；宽限倒计时 |
| U-P2-5 | 忙碌时工位牌只显示「干活中…」；token 不可读；空位写「空闲」 | 姓名常驻；`52.3k` 紧凑 token（≥10k）；空位「空位 · 点击招聘」 |
| U-P2-6 | 抽屉互相叠成 60px 切片 | 左侧抽屉互斥；右侧工单把手允许与工单台并存（票 08 验收明确要求两者同时开）；聊天/招聘关闭其余 |
| U-P2-7 | 取消/放弃一键执行、无 busy、可双击 | 派单/验收/续跑/取消 busy 禁用；取消/放弃**两段式**（第一次 arm 并提示，第二次执行） |
| U-P2-8 | 抽屉焦点留在被遮挡的 rail；无 Esc；状态点无 aria | `useDialog`（入焦/Tab 循环/Esc/归还焦点）；状态点 `aria-label/aria-expanded` |
| U-P2-9 | 无 `prefers-reduced-motion` | 动画/过渡降到 0.01ms |
| U-P2-10 | 聊天自动滚到底；无时间戳/轮次分隔；每 delta 全量重绘 | 距底 80px 内才自动滚；meta 行 HH:MM + turn_end 分隔；事件 50ms 合并 + 400 条上限 |
| U-P2-11 | 字号 10/11 混用，详情无 section，产出非等宽 | 元信息统一 ≥12px；详情分节标签；artifact `<pre>` 等宽；plate token 紧凑 |
| U-P2-12 | 加载失败被渲染成空列表（工单台/把手/上下班） | 四类面板都有 loadError + 重试；WorkClock 明确「读取失败」 |
| U-P2-13（补充） | 引擎 BYOK 无引导 | 配置目录 + models.json 字段说明 + 「打开配置目录」+ 探针 |
| U-P2-14（补充） | 任务/工单文案混用，错误码直接上屏 | 统一「工单」；`errorText` 映射 employee_busy/off_duty/invalid_transition/git_* 等 |

### P3（全部关闭）

- 桌面端 emoji（✋/🔧）换成文本「禁」/「工具」；✓/✗/✕ 保留为字形。
- 设计 token：补 `--danger/--review/--muted` 与 8/12/16/999 圆角；语义色收口，插画一次性色保留。
- 首屏空办公室增加 caption「点空工位招聘第一位员工」；空位牌也写「空位 · 点击招聘」。
- 小高度左轨 `letter-spacing` 0.2em；`prefers-reduced-motion` 下动画/过渡降到 0.01ms。
- 状态弹层点外/Esc 关闭；聊天失败恢复草稿；长标题/长路径 `overflow-wrap:anywhere`。
- 详情/把手/聊天/引擎中心/关于/招聘全部有 `role=dialog`、`aria-modal`、Esc、焦点环。
- 任务列表增加标题与数量；工单把手的行改为可点击 `<button>`，并可从行直接打开工单台。
- 引擎中心/花名册/工单台/把手都补齐空态、错误态与加载态。
- 移动端 900px 下抽屉不挤压画布；浮层仍是 overlay。

---

## 有意保留的产品决策（附替代方案）

这些不是「忘了修」，而是改动会与现有验收/硬约束冲突，或只是审美取舍：

1. **保留 Windows 原生标题栏**（UI-P3）。替代方案是 `titleBarStyle:"hidden"` + `titleBarOverlay` + 自绘拖拽区；但状态点/右上浮层需要整体下移，且 e2e 的窗口/点击坐标会变。当前保留原生栏，避免把「窗口 chrome」变成新的交互风险。
2. **「通过」仍是一键**，只有「取消/放弃」两段式。通过是验收主路径，再点一次会显著拖慢每张工单；若要求所有终态都确认，替代方案是统一的自绘确认条。
3. **对话浮层保留 EngineCard**（UI-P1-7 的剩余部分）。引擎中心的占位已消除，真实探针/准入/配置已在中心；对话里的卡片只承担**员工级**「切换引擎/该员工探针」，因为切引擎必须带 `employeeId`。替代方案是把切换改成「引擎中心 → 选员工」两步流；当前保留，避免把最常用的切引擎动作变深。
4. **`renders/` 目录保留但 v1 未使用**。票 13 的目录契约包含它；删除会改安装/数据布局验收。替代方案是等真正有渲染产物时再用。
5. **插画色/圆角仍有一批字面量**；语义色（warn/ok/bad/review/muted/danger）与 8/12/16/999 圆角已收敛为 token。插画调色板与纸张纹理是一次性视觉资产，继续 token 化的收益很低。
6. **codex 仍以 `danger-full-access` 运行，hook 文件仍可能被员工改写**。本机 `-s workspace-write` 被 Windows 策略拒绝（CreateProcess blocked by policy），OS 沙箱不可用（票 11 已记录的硬环境边界）。已做的补偿：判定搬回宿主 `/decide`、hook 超时/错包一律 deny、每轮 prompt 重写 config+hook、路径工具做 resolve 后包含判定、BYOK key 从子进程环境排除、产出落库前脱敏。残留风险是「员工在同一用户权限下改写 hook/config」；真正的修法是 OS ACL/独立用户/可用沙箱，超出本机约束。替代方案：接受当前边界并把 UI 文案保持为「宿主策略」；若要强隔离，换一台能起 codex sandbox 的机器或换引擎运行方式。
7. **codex 的真实拒绝仍依赖 hook 进程**：这是 6 的直接结果；策略表本身在宿主，hook 只是传输层。

## 结论

本轮把审查中的 **P0 全部关闭**；**代码 P1 的功能/安全边界项全部关闭**（P1-7 的 hook 文件可改写属于票 11 已记录的 `danger-full-access` 硬环境边界，见决策 6），**UI P1-6/7 的占位与白屏关闭**（对话保留员工级引擎卡，见决策 3）。P2/P3 除上述产品决策外全部关闭；修复覆盖数据/生命周期、引擎与策略、崩溃恢复、性能、IPC 安全、以及界面层叠/可读性/上手闭环。最终状态以 386 个单元测试 + 02–13 全部 e2e 为准。
