# 02: 能开机的空办公室

**What to build:** 应用能启动，显示一间办公室与 4 个空工位，数据来自本地数据库；关掉重开数据还在。三层进程各司其职（窗口 / 业务宿主 / 视图），视图重载不影响运行中的宿主。

**Blocked by:** 01

**Status:** done

- [x] 启动后 5 秒内出现办公室画面与 4 个空工位，且工位来自数据库而非硬编码
- [x] 业务宿主的在线状态在界面上可见
- [x] 建一家公司、一个项目组，重启应用后仍在
- [x] 手动重载视图，业务宿主状态与数据不受影响
- [x] 数据库与文件落在应用数据目录，不写用户家目录

## Answer

**完成（2026-11-05，commits 407b814 + 审查修复）。** 一条命令复现验收：

```powershell
npm install
npm run build:renderer
npm run e2e:02
```

三阶段全绿（`tmp/e2e-02/{defaults,create,verify}.json`）：

- **defaults**：不带 override 启动 main，证明生产数据目录解析 = `C:\Users\Aiden\AppData\Roaming\cubicle`（随后立即退出，不落盘——本机策略拒绝 Electron 在 AppData 新建，见环境坑）。
- **create**（单进程全程）：host 上线 → 办公室 4 工位 **270ms**（预算 5s）→ 徽章在线 → 数据目录/子目录就位 → **通过左轨真实表单**建公司与项目组 → **画布切到新项目组的 4 个工位（数据库变更直达视图）** → Ctrl+R 语义重载后工位照常、徽章 ≤2s 回在线、宿主 **pid 不变**。
- **verify**：全新进程同一数据目录，公司与项目组仍在。

手动体验：`npm start` → 办公室 + 4 空工位；右上徽章「AgentHost 在线 · pid · 已运行 Xs · 数据目录」；Ctrl+R 视图重载宿主无感。

### 结构（11 号架构决策的 M1 骨架）

```
src/main/        main：窗口、supervisor（starting→online→offline→重启）、
                 coalescer（≤16ms 合帧：状态类 topic 帧内只留最新，
                 领域事件逐条保留）、信封转发；不含业务、不含测试装置
src/host/        AgentHost（utilityProcess）：entry.cjs + node:sqlite(WAL)
                 单写者 store + service 命令/查询总线 + 2s heartbeat
src/preload/     桥：invoke()（超时 8s → host_timeout）+ subscribe(topic)
                 （主题订阅在边界完成，视图不筛批次）
src/shared/      信封 v1（invoke/reply/event + TOPICS 常量）+ appError
renderer/        React 18 + Vite 纯视图：办公室画布 / 状态徽章 / 左轨浮层；
                 scene/domScene.js = SceneRenderer 适配层（07 票换实现不换接口）
scripts/         start / e2e-02（orchestrator）/ e2e-02-runner（验收装置，
                 刻意放在 main 层之外）
```

数据模型最小集：company / project_group / desk（坐标入库）；种子 = 默认公司 + 默认项目组 + 4 空工位（票要求**启动即有** 4 工位，种子是达成方式；种子跑一次，重开不重播）；**建项目组自动配 4 工位**。视图固定显示首家公司的**最新**项目组（无切换器前的合理默认，08 票做切换），所以新建后画布立即跟随数据库。

### 关键决策与实证

- **SQLite = 内嵌 Node 24 的 `node:sqlite`**：主进程与 utilityProcess 均实证可用；零原生依赖，better-sqlite3 的 ABI 风险从 13 票清单消失。
- **数据目录**：默认 `%APPDATA%\cubicle`（内含 cubicle.db + artifacts/engines/renders）；`CUBICLE_DATA_DIR` 连同 Chromium userData 一起重定向（e2e 留在工作区，hermetic 可重跑）。
- **心跳/重启/backoff**：「在线状态可见」与「重载不打扰宿主」的实现支撑；宿主崩溃 1s 后自动重启，UI 状态跟随。

### 环境坑（本机实证）

见 AGENTS.md「M1 骨架环境坑」：`app.setName()` 顶层调用原生崩溃（用 setPath）；agent 会话里 Electron 写 AppData 被策略拒绝；GUI 进程 console 不进管道（e2e 进度走 `process.stdout.write`，机器证据走 JSON 文件）。

### 已知边界（留给对应票）

- 「大对象走指针」未实现（M1 无大对象），信封 payload 已留槽位。
- SceneRenderer 当前是 DOM 适配层；3D 分层 + 2D 角色在 07 票。
- 公司/项目组切换器在 08 票；occupant/employee_id 列在 03 票启用。
- 本机默认 `npm start` 会因 AppData 写策略在 openStore 处失败——属机器策略，非应用缺陷；正常桌面会话可用，e2e/演示用 `CUBICLE_DATA_DIR` 重定向。
