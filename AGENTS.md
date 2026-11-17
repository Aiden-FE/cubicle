# AGENTS.md · Cubicle

任何在本仓库工作的 agent（或人）先读这一页。

## 这是什么

**Cubicle** —— 一间看得见的办公室：AI 数字员工在工位上干活，你招聘、派活、验收。
Windows 优先的桌面应用（Electron + React + Three.js），不绑定任何 agent 引擎（统一适配层调用本机 pi / codex / claude / dsh / qoder…）。

**当前状态：M0-M7 全部通过（2026-11-12）—— 18 张研发票全部 done：01 探路、02 空办公室、03 招聘、04 引擎开跑、05 工单与产出、06 验收与打回、07 工位动画、08 主界面外壳、09 上下班、10 崩溃恢复、11 第二引擎 codex、12 失败与成本、13 打包、14 统一设置 + 引擎无关模型库（pi/codex/dsh）、15 3D 办公室场景（Blender/Three.js，8 工位 + 咖啡机/饮水机）、16 视口自适应 + 缩放/平移巡检、17 工位屏幕状态 + 随机摸鱼、18 无文字场景（员工形象 + 桌面名牌 + 走道寻路）。**

## 先读顺序

1. `README.md` —— 门面与下一步
2. `.scratch/v1/README.md` —— **研发票总览**（18 张、依赖表、怎么取票）
3. `.scratch/cubicle/map.md` —— 决策地图（15 条决策索引 + 雾区 + 范围边界）
4. `GLOSSARY.md` —— 领域术语（公司/项目组/工位/员工/角色/学院/领域/技能/MCP/任务/会话/产出）
5. `.scratch/academy/map.md` —— **员工学院 effort**（Neo 集成、技能/MCP 下发、角色隔离）
6. 与任务相关的那张票的 `## Answer`（在 `.scratch/cubicle/issues/` 或 `.scratch/academy/issues/`）

## 票据约定（local-markdown wayfinder）

- 地图：`.scratch/cubicle/map.md`
- 票：`.scratch/cubicle/issues/NN-<slug>.md`，票头三行 `Type:` / `Status:` / `Blocked by:`
- **认领**：把 `Status: open` 改成 `Status: claimed`（先改再动手）
- **解决**：票尾追加 `## Answer`，`Status: resolved`，再到 map 的 `Decisions so far` 追加一行 gist + 链接
- **frontier** = 编号最小的、`Status: open` 的、且 `Blocked by` 全部 resolved 的票
- 一个会话只解一张非 research 票；research 票可并行

启动命令：`/wayfinder .scratch/cubicle/map.md`（不带票号 = 自动取 frontier 第一张）

## 研发票（下一步做什么）

- 位置：`.scratch/v1/issues/NN-<slug>.md`，18 张 tracer-bullet 票，每张可独立演示
- 状态：`Status: ready-for-agent | in-progress | done`
- **取票**：编号最小 + `Blocked by` 全部 done；动手前把 Status 改 `in-progress`
- **完成**：逐条勾选验收项，Status 改 `done`
- 总览与依赖表：`.scratch/v1/README.md`

决策票回答「为什么这样做」，研发票回答「下一步做什么」—— 不要混用。

## M0 探路：已通过（= 研发票 01）

2026-11-05 三关全过：Electron 45.2.1 内嵌 Node 24.22.1；pi 1.5.0 SDK 在 utilityProcess 吐出 text delta + 工具事件；codex-cli 0.163.0 JSONL 可归一化。重跑 `npm run spike`，证据与三条备选路径见 `docs/spike-m0.md`。

两个环境坑：启动 Electron 前删 `ELECTRON_RUN_AS_NODE`；codex `-C` 一律传绝对路径。

## M1 骨架（研发票 02）环境坑

- **`app.setName()` 在模块顶层调用会原生崩溃（0xC0000005）** —— Electron 45.2.1 实证；用 `app.setPath("userData", …)` 替代。
- SQLite 用内嵌 Node 24 的 `node:sqlite`（主进程与 utilityProcess 均实证可用），零原生依赖。
- **本机安全策略只放行 electron.exe 写仓库工作区**：Chromium 进程沙箱起不来（退出码 0x80000003，GUI 子系统下还静默）；工作区外（含 %APPDATA%、%LOCALAPPDATA%、dev 下其它目录）所有 electron.exe 写入被拒（0x5）。因此本机跑应用必须 `CUBICLE_DATA_DIR` 指到仓库内（如 `tmp/dev-data`）；`scripts/start.mjs` 对沙箱崩溃码自动降级 `--no-sandbox` 重试一次并打印说明。
- Electron 是 GUI 子系统进程：console 输出不进父进程管道，探针输出一律 `process.stdout.write` 或落盘。

## M2 引擎（研发票 04）环境坑

- **electron.exe 能 spawn 普通外部进程**（05 票 spike 更正：main 与 utilityProcess 内 `git.exe` / `cmd.exe` / `powershell.exe` / `whoami` 实测 exit 0）。**但 Git Bash（msys2）在 electron.exe 里起不来**：`NtCreateDirectoryObject(\BaseNamedObjects\msys-2.0…) 0xC0000022` —— 所以 **pi 的 bash 工具在本机应用内不可用**；员工跑命令要配 **powershell** 工具（pi 自带，程序员的 tools 已含）。04 票当时把 tasklist 的失败外推成了「不能 spawn」，注意区分。
- **`tasklist.exe` 在本机不可靠**；进程计数用 PowerShell `Get-CimInstance Win32_Process -Filter "ParentProcessId=…"`，结果用数组包裹取 `.Count`。`wmic.exe` 已不存在。
- agent 受限会话里 **esbuild / vite build 的 spawn 管道被拒（EPERM）**：build 与 e2e 需提权或全权限会话。
- **`vite build` 的 esbuild 临时产物在 `%LOCALAPPDATA%\Temp` 会被实时防护锁掉**（`[vite:esbuild-transpile] remove …\esbuild-<hash>: Access is denied.`，2026-11-17 票 a01 起 100% 复现）：构建前把 `TMPDIR/TEMP/TMP` 指到仓库内目录（如 `tmp/esbuild-tmp`）即可。
- 冷启动 Electron 首个 e2e phase 渲染工位可能 >5s（安全策略/AV）；boot 脚手架等待给到 15s。票内 2s 判据从「点发送」起算，不受影响。
- **contextBridge 吞掉 Error 自定义属性**：preload 用 `new Error(); err.code=…` reject，渲染进程拿不到 `.code`（序列化只留标准字段）。桥约定：reject **纯对象** `{ code, message }`（05 票已改，renderer 都按此读）。

## 硬约束（改这些等于改蓝图，先开票）

- **主画布永远是办公室**；工单创建/列表只在浮层（左轨工单台、右缘把手抽屉）
- **员工自主 commit**，应用对 git 只读；回滚靠派任务
- **引擎不绑定**：适配协议 + 能力声明；准入 = 能注入 skills/MCP/tools
- **多公司并行**：切公司不阻塞，程序退出才中断
- **定时上下班**：90s 宽限 + 落盘 + 可恢复；override 必备
- v1 自用：**不做账号 / 跨设备同步 / 计费**
- **跨仓库边界**：`neo/`（同级目录）与 `~/.neo` 对 Cubicle 侧 agent 一律**只读**；需要 Neo 改动只能在 `.scratch/academy/neo-tickets/` 开「只含现象与期望」的交接票，由 lead 转交。详见 `.scratch/academy/impl/SCOPE.md`。
- 多员工协作 = wayfinder 决策 16 号票已关闭，**超出本次范围**（要做请开新的 wayfinder effort）

## 代码约定（M1 起生效）

- 三层：`main`（窗口/更新/偏好）· `AgentHost`（utilityProcess：SQLite 单写者 + 引擎运行时）· `renderer`（纯视图）
- 存储：SQLite(WAL) + 文件系统（artifacts / engines / renders）
- IPC：类型化事件信封 + 16ms 合帧 + 主题订阅 + 大对象走指针
- 渲染：`SceneRenderer` 接口隔离渲染技术（当前 = Blender 导出的 `office.glb` + Three.js 后方斜俯视 3D 场景 + 桌面实体名牌；视口随窗口等比铺满，视口内支持相机缩放/平移巡检；员工状态靠动作与屏幕内容表达，不写状态文字）
- 原型是 throwaway：`.scratch/cubicle/prototypes/` 里的代码**不要直接进主干**，移植时重写
