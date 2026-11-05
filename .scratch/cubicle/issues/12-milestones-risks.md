# 12 — 里程碑、风险与 v2 扩展位

Type: task
Status: resolved
Blocked by: 01, 02, 04, 05, 06, 07, 08, 09, 10, 11, 13, 14

## Question

把以上决策收敛成 4-6 个可交付里程碑（每个有 demo 判据），列出 top 风险与缓解，标出 v2 的扩展点。

## 要产出

- **里程碑表**：每个里程碑的目标、交付物、demo 判据、预估工作量（人日）。
- **风险表**：风险、概率、影响、缓解、触发信号。
- **v2 扩展位**：多员工、账号、同步分别在哪一层留了接口。
- **一页取舍建议**：「如果只能做三件事」。

## 备注

这张票是「组装」而不是「决策」：前面每张票的 `## Answer` 都是它的输入。前票没解完之前不要动它。

## Answer

**结论：6 个里程碑（M0 探路 → M5 打磨），合计约 26–36 人日；Top 风险 9 条，最高优先是 Electron 内嵌 Node 版本与真 agent 任务成功率；v2 的接口扩展位已在数据模型/协议/渲染层预留。**

### 1. 里程碑表

| # | 里程碑 | 目标 | 交付物 | Demo / 验收判据 | 人日 |
|---|---|---|---|---|---|
| **M0** | 探路（最高风险验证） | 证明「Electron 里跑得动 pi + codex」 | 一个 spike 脚本 + 结论记录 | Electron 内嵌 Node ≥ 22.19；pi SDK 在 utilityProcess 里吐 token 事件；`codex exec` headless 吐 JSONL 并被解析 | 2–3 |
| **M1** | 骨架 | 三层进程 + 存储 + IPC + 无引擎 CRUD | main/AgentHost/renderer 脚手架、SQLite schema、事件信封、公司/项目组/工位/员工 | 建公司→建组→4 空工位→招聘（假 agent）→重启不丢（01 判据 6） | 4–5 |
| **M2** | 真 agent 闭环 | 适配协议 + pi/codex 适配器 + 探针 + 任务执行 | adapter runtime、两个适配器、探针、事件归一化、任务状态机 | 01 剧本 1:20–2:20 真跑通：读/写/测试失败/修复/测试绿/**员工自己 commit** | 5–7 |
| **M3** | 办公室与动画 | 场景 + 状态机 + 事件→动画 | 预渲染分层场景（先可用 2.5D fallback）、SceneRenderer、角色状态机、名牌/气泡、抽屉/把手 | 读/写/执行/测试四类状态正确映射；穿帮 ≤ 3 秒（01 判据 4） | 5–7 |
| **M4** | 流程与外壳 | B 向导 + 左轨 + 工单台 + 验收 + 引擎中心 | 开场向导、左轨、右把手抽屉、工单台浮层、产出四件套、通过/打回、引擎中心 | 01 全剧本 3 分钟可录；验收/打回可用 | 4–6 |
| **M5** | 生命周期 | 上下班 + 优雅暂停 + 退出 + 崩溃恢复 | 时间表 + override、90s 宽限落盘、退出三选、恢复面板 | 下班→暂停→上班→续跑，20 秒可演示 | 3–4 |
| **M6** | 打磨与验收 | 失败入镜 + 成本可见 + 性能 + 打包 | 失败原因人话化、token 面板、合帧/虚拟列表、NSIS 安装包 | 01 的 7 条判据全绿；安装包在干净机器能起 | 3–4 |

合计 **26–36 人日**（单人，含调试；不含美术外包周期）。

**顺序理由**：M0 先做，因为它是唯一「做不了就得改架构」的项；M2 早于 M3，因为「能不能真干活」比「好不好看」重要（01 票的判断）；M4 把外壳留到最后，因为外壳最容易被推翻重做。

### 2. 风险表

| # | 风险 | 概率 | 影响 | 缓解 | 触发信号 |
|---|---|---|---|---|---|
| R1 | Electron 内嵌 Node < 22.19 | 中 | **致命**（pi 装不上） | M0 第一件验证；不满足换 Electron 版本，或 pi 适配器降级为 CLI/RPC 宿主 | `process.versions.node` 检查失败 |
| R2 | pi SDK 在 utilityProcess 里事件/生命周期不稳 | 中 | 高 | 适配器层隔离；M0 spike；CLI 宿主作 fallback | 事件丢失率 > 1% 或会话无法 dispose |
| R3 | better-sqlite3 native ABI 不匹配 | 高 | 中 | electron-rebuild 进 CI；备选 sql.js / JSON（降级） | 启动即崩，`.node` 加载失败 |
| R4 | Windows 子进程树残留 | 中 | 中 | job object + `taskkill /T`；M2 就做 | 任务结束后 `codex.exe` 仍在进程表 |
| R5 | 预渲染 3D 资产做不出来/风格不对 | 中 | 高 | 2.5D 矢量 fallback（原型已验证）；分层规范先定；资产可后补 | 美术周期 > 2 周或分层遮挡对不上 |
| R6 | token 流打爆 renderer | 中 | 中 | 16ms 合帧 + 虚拟列表；M3 压测 | 长时间任务 UI 掉帧/内存涨 |
| R7 | 真 agent 任务成功率不够 | **高** | **致命**（demo 演不下去） | 任务锁死 `demo-task-cli`（01 票）；失败入镜；M2 起每天跑 3 次统计成功率 | 连续 3 次跑不通或耗时 > 10 分钟 |
| R8 | 定时上下班与演示节奏冲突 | 低 | 低 | override 兜底（13 票） | demo 里员工不动 |
| R9 | 范围蔓延（多员工/账号/同步提前做） | 高 | 高 | 01 砍单是硬边界；新想法一律进 v1.1 列表 | 出现「顺便把…也做了」 |

### 3. v2 扩展位（接口已留）

| v2 能力 | 预留位置 |
|---|---|
| 多员工协作 | `task.owner` 已是单值可扩展；`step_plan_json` → 子任务；调度器在 AgentHost；消息路由未写死（03 票：pi 无 A2A，自建） |
| 账号 / 跨设备同步 | 全表带 `company_id`；SQLite 可换 Postgres；事件信封带 `seq`（增量同步的天然锚） |
| Jira 等来源适配器 | `task.origin = { source_id, ext_ref, scheduled }`（08 票） |
| 自定义 tool / 插件 | 引擎适配器的 tool 注册面（05 票明确 v1 不开放） |
| 新引擎接入 | `caps_json` 驱动 UI 徽章；只需写一个适配器（14 票） |
| 3D 场景升级 | `SceneRenderer` 接口（09/11 票） |
| 闲时动作扩展 | 09 票的状态机表 + 优先级 |
| 移动端 | 事件信封 + AgentHost 已与视图解耦 |

### 4. 如果只能做三件事

1. **M0 探路** —— Electron + pi + codex 跑得动，整个项目才存在。
2. **M2 真 agent 闭环** —— 「它真的把活干了」是产品的地基，不是外壳。
3. **M3 事件→动画映射** —— 「看得见」是这个产品区别于 agent 套壳的唯一理由。

其余（向导、左轨、抽屉、上下班、打包）都是这三件成立后的必然外壳。

### 5. 交接

- 开工入口：本图 `map.md` → 按里程碑取票的 Answer → `GLOSSARY.md` 统一术语
- 原型资产：`prototypes/09-office-prototype.html`（动画/状态机）、`prototypes/10-first-run-prototype.html`（B 向导）、`prototypes/10-main-shell-5drafts.html`（主界面杂交的母版）
- 调研资产：`research/pi-embedding.md`、`research/engine-capabilities.md`、`research/desktop-stack.md`、`research/marvis-teardown.md`
