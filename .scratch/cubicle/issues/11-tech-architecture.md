# 11 — 技术架构：进程、存储、IPC

Type: grilling
Status: resolved
Blocked by: 06, 13, 14

## Question

Electron 的进程怎么分（main / renderer / utilityProcess / worker）？状态存哪（SQLite / 文件 / pi session）？IPC 契约怎么定？崩溃怎么恢复？

## 要拆清楚

- **agent 跑在哪**：renderer 里（简单但危险）/ `utilityProcess`（官方推荐）/ 独立 sidecar。
- **多公司后台运行**：切换公司不能停任务 → 运行时必须与视图解耦（UI 只是订阅者），谁持有会话、怎么计数与限额（见 13 票）。
- **多引擎进程形态**：SDK 型引擎（进程内会话）与外部 CLI 型引擎（子进程 + JSONL）并存时的统一宿主（见 14 票）。
- **多员工**：一人一进程还是一进程多会话？内存与隔离的取舍。
- **存储**：企业 / 项目组 / 员工 / 任务 / 消息 → SQLite；产出与仓库 → 文件系统；pi 会话 → 它自己的 JSONL 树。
- **IPC**：事件流怎么从 agent 到 UI（MessagePort？），背压怎么处理。
- **恢复**：应用崩溃 / 重启后，正在跑的任务怎么办（续跑 / 标记失败 / 询问）。
- **打包**：SDK 型引擎（若 v1 带 pi 适配器）的依赖与 Node 版本（≥22.19）、asar 解包；外部 CLI 型引擎的探测与版本漂移。

## 要产出

架构图、进程职责表、落库 schema 草案、IPC 契约、崩溃恢复策略、打包注意事项。

## 备注

这张票是「决策 + 需要一点调研」。先读 [pi-embedding.md](../research/pi-embedding.md) 与 [desktop-stack.md](../research/desktop-stack.md) 的第 5 节，再定。

## Answer

**结论：main（窗口/托盘/更新/偏好）+ AgentHost（utilityProcess，业务真相与引擎运行时）+ renderer（纯视图）三层；SQLite(better-sqlite3, WAL) 单库 + 文件系统分目录；IPC 用类型化事件信封、16ms 合帧、主题订阅、大对象走指针；UI = React 18 + Vite + Zustand + PixiJS（画布）；场景层 = 预渲染 3D 分层背景 + 2D 角色（09 修订）。**

### 1. 进程拓扑与职责

```
main (Electron)  ── 窗口/托盘/菜单/自动更新/偏好(electron-store)/退出对话(13 票)
   │ MessagePort 交接
AgentHost (utilityProcess) ── 业务真相：SQLite 单写者 · 适配协议运行时(14 票)
   │                            SDK 宿主(pi) + CLI 宿主池(codex/claude/… 子进程)
   │                            · 会话/任务/产出 · 调度器 · 准入探针
renderer (Chromium) ── React 视图 + PixiJS 画布；只订阅事件、发命令，无业务逻辑
```

- **视图死不影响运行**（13 票「切公司不阻塞」的物理基础）：renderer 崩溃/重载只丢画面，AgentHost 继续跑。
- AgentHost 崩溃 → main 看护重启（指数退避），进行中会话标 `interrupted`，走 13 票恢复面板。
- 公司切换 = renderer 换订阅过滤 + 换画布布局，**不触碰 AgentHost 的任何会话**。

### 2. 存储

**SQLite（better-sqlite3，WAL）由 AgentHost 独占写**（单写者，避免跨进程锁）。草案表：

| 表 | 关键字段 |
|---|---|
| `companies` | id, name, template, duty_on, duty_off, duty_override |
| `project_groups` | id, company_id, name, template, workspace_root |
| `desks` | id, group_id, x, y, occupant_employee_id |
| `roles` | id, name, spec_json, builtin |
| `employees` | id, company_id, name, avatar_json, **role_snapshot_json**, engine_profile_id, state, desk_id, hired_at, archived_at |
| `engine_profiles` | id, engine_id, display_name, **caps_json**, status, last_probe_at |
| `tasks` | id, group_id, owner_employee_id, title, playbook_id, status, paused_reason, origin_json, step_plan_json, tokens_in, tokens_out |
| `sessions` | id, task_id, employee_id, engine_id, engine_session_ref, status, started_at, ended_at |
| `artifacts` | id, task_id, kind, path, summary |
| `events` | id, company_id, employee_id, task_id, kind, payload_json, ts（流水/回放，可裁剪） |

**文件布局**（`%APPDATA%/ai-office/`）：

```
db.sqlite                                    业务真相
artifacts/<task-id>/…                        产出副本（diff 全文 / 日志 / 预览）
engines/<engine>/<employee>/…                引擎私有配置与会话（绝不写真机 ~）
renders/<layout-id>/{back,mid,front}.webp    预渲染场景分层（09 票）
logs/
```

### 3. IPC 契约

**事件信封（AgentHost → renderer，单向推送）**
`{ v, topic, seq, ts, companyId?, employeeId?, taskId?, sessionId?, payload }`
topics：`agent.event`（token 流）· `task.updated` · `employee.state` · `company.duty` · `artifact.ready` · `engine.status` · `probe.result`

**命令（renderer → AgentHost，invoke 应答）**
`task.create / approve / reject / cancel / retry` · `company.create / duty.set` · `group.create` · `hire.employee` · `employee.update` · `engine.probe / enable / disable` · `session.pause / resume` · `workspace.pick`

**查询**：`company.list` · `task.list / detail` · `employee.list` · `engine.list` · `artifact.read(ptr)`

**背压三招**：① token delta **16ms 合帧**再推；② renderer 按当前公司/视图**订阅主题**过滤；③ 大对象（diff 全文、日志）只推**指针**，按需 invoke 读。

### 4. 崩溃与恢复

- 守护：`render-process-gone`（重载 renderer，AgentHost 不受影响）· `child-process-gone`（CLI 宿主死亡 → 会话标 interrupted）· AgentHost 心跳超时重启。
- 持久化：SQLite WAL + 事务；artifacts 原子写（tmp + rename）；会话恢复指针由适配层提供（14 票）。
- Windows 进程树：job object 兜底 + 退出时 `taskkill /T` 防孤儿。
- 恢复面板（13 票）：读 `sessions where status=interrupted` + 引擎 resume 能力 → 续跑 / 重跑 / 放弃。

### 5. 打包与版本（实施前第一件事）

- **核验 Electron 内嵌 Node ≥ 22.19**（pi 硬要求，03 票）；不满足就锁到满足的 Electron 版本。这条是 v1 开工第一项验证。
- electron-builder → NSIS x64；单实例锁；`asarUnpack` 放 pi 依赖与 `.node`（better-sqlite3 需 electron-rebuild）。
- 自动更新 / 签名 / 崩溃上报 → 分发雾。

### 6. 场景层集成（09 票）

- renderer 内 PixiJS `Application` 占全屏 canvas；`SceneRenderer` 接口（drawFloor / drawFurniture / drawCharacter / hitTest）隔离渲染技术。
- 预渲染分层顺序：`back`（地板/墙）→ 角色容器 → `mid`（桌/家具）→ `front-occluder`（前景遮挡）→ 气泡/名牌层。**角色必须夹在 mid 与 front 之间**才有正确遮挡。
- 换布局 = 换 render set（已接受重渲染成本）。

### 7. 风险表（进 12 票）

1. Electron 内嵌 Node 版本不满足 pi → 卡开工（最高优先验证）。
2. better-sqlite3 native 与 Electron ABI → electron-rebuild 进 CI。
3. CLI 宿主进程树在 Windows 残留 → job object + 退出清理要早做。
4. token 流打爆 renderer → 合帧 + 虚拟列表（10 票抽屉）已设计。
5. 预渲染分层资产体积 → WebP + 按布局分包，首屏只加载当前布局。
