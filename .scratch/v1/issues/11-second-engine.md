# 11: 第二引擎 codex + 准入探针

**What to build:** 同一句话可以换 codex 跑；引擎中心显示各引擎徽章（已登录 / 待配 key / 未装）；启用引擎前自动跑准入探针四验（注入生效 / 工具可见 / 拒绝可见 / 事件完整）。

**Blocked by:** 04

**Status:** done

- [x] 员工可切换引擎，同一任务换 codex 能跑通
- [x] 探针输出四项结论，结果写进引擎卡
- [x] 未安装的引擎显示灰徽章与安装引导
- [x] 探针失败可手动启用，但带风险标识
- [x] 两种引擎的事件都能驱动同一套动画

## Answer

**完成（2026-11-07）。** 一条命令复现验收：

```powershell
npm run build:renderer
npm run e2e:11    # 需本机 codex-cli（PATH 或 CUBICLE_CODEX_PATH）
```

三阶段全绿（`tmp/e2e-11/{absent,engine,risk,child-samples}.json`）。**引擎是真的**：真 `codex.exe 0.163.0` 进程、真 JSONL、真 PreToolUse hook、真 powershell 执行；只有**模型侧**是本地 Responses-API mock（`scripts/e2e-codex-responses-mock.mjs`，无网络无登录），pi 侧沿用 04/07 的 chat mock。

- **切引擎 + 同一任务换 codex**：phase engine 里同一员工先 pi 跑「读一下 hello.txt」（completed，`engine=pi`，工位 `read` 姿态），探针通过后点「切到此引擎」→ `roleSnapshot.manifest.engine=codex` → **同一句话再跑** → completed `engine=codex`、`employeeSessionId=3`（每员工×每引擎各一条会话，恢复指针各自独立：pi 的 .jsonl 与 codex 的 `thread:<uuid>`）。后续 codex 轮走 `codex exec resume <thread_id>`，上下文真的续上。
- **探针四验写进引擎卡**：`准入探针·codex`（无工位隐藏员工，工位视图看不到）跑两轮，结论落 `engine_state.probe_json` 并渲染成四枚 chip：`注入生效`（探针 marker 只存在于写进私有 workspace 的 `AGENTS.md`；模型把它原样报告回来才 pass —— 注入通道是真验的，不是猜的）、`工具可见`（1 次 shell 调用成功且事件成对）、`拒绝可见`（strict：任何 `decideToolAccess` 该拦的调用**居然执行了**就判失败；本轮由 codex 自家 PreToolUse hook 拦下并经 loopback bridge 变成 `policy_blocked`）、`事件完整`（session_start/turn/内容/turn_end + 恰好一个 agent_end）。e2e 断言 `status=passed` 且四枚 chip 全 pass；pass 即自动准入（`enabled=1`、风险位清零、切换按钮出现）。
- **未装 = 灰徽章 + 安装引导**：phase absent 把 `CUBICLE_CODEX_PATH` 指向不存在的文件，`codex --version` 探测失败 → `installed=false` → 徽章 `未装`（灰）+ 「怎么装」引导文案；pi 徽章仍是 `已登录`。三态由 `src/host/engine/badge.mjs` 一处推导（未装 / 待配 key / 已登录）。
- **探针失败 → 带风险手动启用**：phase risk 里 codex 已装但**没有 models.json**（BYOK 未填）→ 徽章 `待配 key`；探针必然失败，失败原因（`engine_not_configured：…`）以红字写进引擎卡并给出「带风险启用」入口；点了之后可切换，但卡片挂着 `⚠ 带风险启用（探针未通过）`，库里 `enabled=true / manual_override=1 / probe_status=failed` 三位分开留痕。没通过探针又想启用而不带 `manualOverride` → `probe_required` 直接拒。
- **两种引擎驱动同一套动画**：`renderer/src/scene/{toolActivity,deskActivity,idleMotion,deskReadout}` 与 `policy.mjs`、`policy_blocked` 事件词汇**一行没改**（`git diff` 只增不改）；codex 的 `command_execution` 归一化成 `toolName="shell"` 落进 07 的 EXEC_TOOLS → 工位 `exec` 画面。e2e 用 MutationObserver 记录 `data-activity` 变化序列（比 90ms 轮询严谨）：`["/false","/true","/true","exec/true","exec/true","/false","/false"]`，44 个采样可见。
- **CLI 宿主的进程回收义务（04 票留的）**：`abort()` / host `shutdown()` / `process.on("exit")` 三条路都走 `taskkill /T /F` + `child.kill()`。编排器每 250ms 用 PowerShell `Get-CimInstance Win32_Process -Filter "ParentProcessId=<host pid>"` 数 codex.exe：中止那轮刻意让 shell 睡 6 秒（`Start-Sleep 6; Get-Content hello.txt`）→ 采样 `peak=1`（真在飞）、跑完/中止后的静默窗口 `idle samples=9 max=0`（**无残留**）。supervisor `stop()` 先发 `host.shutdown` 再给 600ms 宽限才 kill。

单测 **162/162**（07 基线 117 → +45）：`codex`（8：JSONL→归一化、**逐行流式**、良性告警折叠、未知记录、失败回合、失败命令=工具 ended-with-error）、`codex-adapter`（8：BYOK 缺失报错、CODEX_HOME 私有 + `-C` 绝对 + bridge env、config.toml 同时带 `command`/`commandWindows`、launch flags 必须在 `resume` **之前**、abort 只一个 agent_end 且不报引擎错、静默非零退出必须带 `engine_exec_failed`+stderr 尾、deny verdict→`policy_blocked`、外来 session / 错 token 不串台、shutdown 杀活口）、`codex-policy-hook`（5：真 spawn，deny 写 codex 线格式、复用宿主 `decideToolAccess`、fail-open、上报 verdict）、`engine-state`（8：出厂状态、探测、pass 即准入、fail+风险启用、切引擎重写冻结快照、会话按 员工×引擎、旧库 UNIQUE 迁移保 id、**死宿主留下的 running 探针复位**）、`probe`（11：四验纯函数 + 服务已写 running 时不得自锁、首跑前抛错也要落 failed、引擎 error 事件把原因写进结论、隐藏探针员工不占工位）、run-manager（13，含准入闸与探针旁路）、service（22，含 `engine.list/enable/probe/setEngine` 与徽章）。

### 架构落点

- **双宿主协议落地（决策 14）**：`open({employee, session, onEvent}) → {prompt, abort, sessionFile}` 这个缝原样接了第二种宿主——pi 是 SDK 宿主，codex 是 **CLI 宿主**（`codex exec --json` 一句话一进程）。`run-manager` 不认识引擎，只认这个缝；`getAdapter` 按 `role.engine` 选。
- **`src/host/engine/codex/{adapter,normalize,bridge,policy-hook}.mjs`**：adapter 渲染 CODEX_HOME `config.toml`（`wire_api="responses"`，`env_key=CUBICLE_CODEX_KEY`，**永不读 `~/.codex`**）、把 persona 写进员工私有 workspace 的 `AGENTS.md`（codex 按 cwd 折叠进指令）、把 `policy-hook.mjs` **和真 `policy.mjs`** 拷进 `engines/codex/hooks/`（一张规则表，两个宿主，不可能漂移）；hook 的 deny 经 127.0.0.1 + 一次性 token 的 bridge 回到宿主，落到该 thread 的事件流 → 同一个 `policy_blocked`。
- **归一化必须逐行流式**：`push(line)` 返回**这一行**的事件，adapter 当场转发。之前攒到进程退出一次性交，工位整轮只在收尾那一帧闪一下——e2e 的 MutationObserver 才把这 bug 抓出来（`activity` 从来没变过）。
- **准入状态一个主人**：`engine_state`（enabled / manual_override / installed / version / probe_status / probe_json）。`engine.probe` 由 **service** 同步写 `running`（与回复同帧），runner 只负责跑与落结论；`openStore` 时把死宿主遗留的 `running` 复位成 failed（探针活在宿主进程里，永远不会有人再交结论）。
- **探针复用会话管线**：`run-manager.subscribe()`（与 UI 同一个 payload 源）+ `start({probe:true})` 旁路准入闸（探针本身就是准入考试），真实对话则被 `engine_not_admitted` 挡住。四验判定 `evaluateProbe` 是纯函数，runner 只开跑与旁听。
- **UI**：`renderer/src/EngineCard.jsx` 挂在对话浮层头部（主画布仍是办公室）；`engine.*` 的 domain.changed 会自动刷新卡片，所以探针跑完徽章/chip 自己变。

### 环境坑（增量）

- **`[[hooks.PreToolUse]]` 的 hook 条目必须同时给 `command` 和 `commandWindows`**：只给平台变体时 codex 直接拒启动 —— `Error loading config.toml: missing field \`command\` in \`hooks\``，**连一行 JSONL 都不吐**（应用侧表现为「跑完但什么都没有」）。TOML 段名是 PascalCase（`PreToolUse`），不是 snake_case。
- **`--json` / `-s` / `-C` 是 `codex exec` 级选项，必须写在 `resume` 子命令之前**：写后面报 `unexpected argument '-s'`（`exec resume` 自己那套选项里没有它们）。
- **本机 codex 的 OS 沙箱不可用**：`-s workspace-write` 被系统策略 CreateProcess 拒（blocked by policy）、`windows.sandbox="elevated"` 在无人值守下 `ShellExecuteExW failed to launch setup helper: 1223`。所以跑 `-s danger-full-access`，**真正的闸门是注入的 PreToolUse hook**（07 的规则表），被拦的调用不执行。
- **codex 只认 `wire_api="responses"`**（0.163 不再支持 `chat`），所以要有一个本地 Responses SSE mock 才能离线跑真 codex；顺带一条：`-C` 传绝对路径（M0 老坑）之外，**e2e 的 workspace 在仓库树里，codex 会把仓库根 `AGENTS.md` 一起折叠进指令**（prompt 变胖），真实员工的 workspace 也应放在不被仓库约定污染的位置。
- **CLI 宿主会把 stdout 攒到退出**（若我们自己也攒）：两层都要逐行——codex 侧真是一行一行吐的，宿主侧必须一行一行转。
- **`executeJavaScript` 不能返回 `element.dataset`**（DOMStringMap 不可结构化克隆 → "An object could not be cloned."）：要 `{...el.dataset}`。
- **本机 node 22.20 下 `node --test test/` 报 ERR_MODULE_NOT_FOUND**：跑全套要写 `node --test --experimental-test-isolation=none test/*.test.mjs`。
- 跨阶段复用 dataDir 时，`rm` 引擎 workspace 目录会 **EBUSY**（刚退出的宿主/子进程还持句柄）：清理要容忍失败（新库才是「干净」的定义），并在 Electron 退出后留一拍。

### 已知边界（留给后续票）

- codex 跑 `-s danger-full-access`：OS 级沙箱在本机开不了，安全性靠注入 hook（CODEX_HOME 是应用私有目录）。13 票做能力声明/策略 UI 时应把它显式建模成「宿主策略」而不是「引擎沙箱」。
- 探针证明的是 **persona(AGENTS.md) + hooks** 两条注入通道；role manifest 里的 **skills / MCP servers** 还没接进 codex 宿主（pi 侧也未做），四验的「注入生效」目前以 marker 回声为凭。
- 引擎中心 UI（12 票）没建，所以 BYOK 走文件缝：`engines/{pi,codex}/models.json`（key 不入库，`*.env`/`secrets/` 已在 .gitignore）。徽章「已登录」对 codex 实为「已配 key」（无 OAuth 登录流）。
- 探针失败原因目前只在卡片上（`probe.error` + chip 的 title），不做「重试/日志导出」；`agenthost` 的启动失败会落 `<dataDir>/agenthost-error.log`，引擎子进程的 stderr 只在静默死亡时截尾上报。
- 切换引擎不打断已在跑的轮（run 跟着它启动时的引擎走完），也不禁在别的引擎跑时切换；「切换即打断」的取舍留给 13 / 引擎中心票。
- 探测只在宿主启动时跑一次（`codex --version`，8s 超时）：装完 codex 要重启应用徽章才会变，PATH 变化同理。
