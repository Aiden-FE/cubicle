# AGENTS.md · Cubicle

任何在本仓库工作的 agent（或人）先读这一页。

## 这是什么

**Cubicle** —— 一间看得见的办公室：AI 数字员工在工位上干活，你招聘、派活、验收。
Windows 优先的桌面应用（Electron + React + PixiJS），不绑定任何 agent 引擎（统一适配层调用本机 pi / codex / claude / dsh / qoder…）。

**当前状态：蓝图已完成，尚未开工。** 下一步是 M0 探路（见下）。

## 先读顺序

1. `README.md` —— 门面与下一步
2. `.scratch/cubicle/map.md` —— 决策地图（15 条决策索引 + 雾区 + 范围边界）
3. `GLOSSARY.md` —— 领域术语（公司/项目组/工位/员工/角色/任务/会话/产出）
4. 与任务相关的那张票的 `## Answer`（在 `.scratch/cubicle/issues/`）

## 票据约定（local-markdown wayfinder）

- 地图：`.scratch/cubicle/map.md`
- 票：`.scratch/cubicle/issues/NN-<slug>.md`，票头三行 `Type:` / `Status:` / `Blocked by:`
- **认领**：把 `Status: open` 改成 `Status: claimed`（先改再动手）
- **解决**：票尾追加 `## Answer`，`Status: resolved`，再到 map 的 `Decisions so far` 追加一行 gist + 链接
- **frontier** = 编号最小的、`Status: open` 的、且 `Blocked by` 全部 resolved 的票
- 一个会话只解一张非 research 票；research 票可并行

启动命令：`/wayfinder .scratch/cubicle/map.md`（不带票号 = 自动取 frontier 第一张）

## 开工：M0 探路（最高优先，先证伪）

开工前必须验证三件事，任何一件不成立架构就要改：

1. **Electron 内嵌 Node ≥ 22.19**（pi 的硬要求）——`process.versions.node`
2. **pi SDK 在 utilityProcess 里能吐 token 事件**（`createAgentSession` + `subscribe`）
3. **`codex exec` headless 输出可解析**（JSONL/JSON；本机已装已登录）

产出：一个 spike 脚本 + 结论记录（建议 `docs/spike-m0.md`），然后才进 M1。

## 硬约束（改这些等于改蓝图，先开票）

- **主画布永远是办公室**；工单创建/列表只在浮层（左轨工单台、右缘把手抽屉）
- **员工自主 commit**，应用对 git 只读；回滚靠派任务
- **引擎不绑定**：适配协议 + 能力声明；准入 = 能注入 skills/MCP/tools
- **多公司并行**：切公司不阻塞，程序退出才中断
- **定时上下班**：90s 宽限 + 落盘 + 可恢复；override 必备
- v1 自用：**不做账号 / 跨设备同步 / 计费**
- 多员工协作 = 16 号票已关闭，**超出本次范围**（要做请开新的 wayfinder effort）

## 代码约定（M1 起生效）

- 三层：`main`（窗口/更新/偏好）· `AgentHost`（utilityProcess：SQLite 单写者 + 引擎运行时）· `renderer`（纯视图）
- 存储：SQLite(WAL) + 文件系统（artifacts / engines / renders）
- IPC：类型化事件信封 + 16ms 合帧 + 主题订阅 + 大对象走指针
- 渲染：`SceneRenderer` 接口隔离渲染技术（当前 = 预渲染 3D 分层背景 + 2D 角色）
- 原型是 throwaway：`.scratch/cubicle/prototypes/` 里的代码**不要直接进主干**，移植时重写
