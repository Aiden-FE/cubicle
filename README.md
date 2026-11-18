# Cubicle

> 一间看得见的办公室：AI 数字员工在工位上干活，你招聘、派活、验收。

- **形态**：Windows 优先的桌面应用（Electron + React + Three.js）
- **引擎**：不绑定任何 agent 引擎 —— 统一适配层调用本机已装的 pi / codex / claude / dsh / qoder…
- **状态**：**M0-M7 全部通过（2026-11-12）+ 员工学院 effort 结项（2026-11-18）**——18 张 v1 研发票 + 学院四票全部 done，`e2e:15` 全链路正反断言一条命令全绿；首个发布 **v0.1.0**（GitHub Release，win-x64 / mac-x64 zip）。

## 从这里开始

| 入口 | 内容 |
|---|---|
| [.scratch/cubicle/map.md](.scratch/cubicle/map.md) | 蓝图入口：15 条决策索引 + 雾区 + 范围边界 |
| [.scratch/cubicle/issues/12-milestones-risks.md](.scratch/cubicle/issues/12-milestones-risks.md) | 6 个里程碑（26–36 人日）、9 条风险、「只做三件事」 |
| [.scratch/academy/map.md](.scratch/academy/map.md) | **员工学院 effort**（已结项）：Neo 集成、技能/MCP 下发、角色隔离 |
| [docs/release.md](docs/release.md) | 发布流程（tag lockstep → CI 双平台打包 → GitHub Release） |
| [GLOSSARY.md](GLOSSARY.md) | 领域术语（公司 / 项目组 / 工位 / 员工 / 角色 / 任务 / 会话 / 产出） |
| `.scratch/cubicle/prototypes/` | 可点原型：办公室动画、首启向导、主界面五稿 |
| `.scratch/cubicle/research/` | 调研：pi 嵌入、引擎准入矩阵、技术选型、Marvis 拆解 |

## 仓库结构

```
.scratch/cubicle/        wayfinder 蓝图（map + 16 张票 + 原型 + 调研）
  map.md                 决策地图（先读这个）
  issues/                决策票（每张一个决策 + Answer）
  prototypes/            可点原型（throwaway，勿直接进主干）
  research/              调研资产
.scratch/v1/             v1 研发票（18 张，下一步做什么）
docs/spike-m0.md         M0 探路结论（三关全过）
docs/office-3d.md        3D 办公室/Blender 导出流程
spike/                   M0 探路脚本（npm run spike 可重跑）
test/                    归一化解析器单测
GLOSSARY.md              领域术语
```

## M0 探路：已通过（2026-11-05）

开工前必须证伪的三件事，全部成立：

1. **Electron 内嵌 Node ≥ 22.19** → Electron 45.2.1 内嵌 **Node 24.22.1**（PASS）
2. **pi SDK 在 utilityProcess 里能吐 token 事件** → pi 1.5.0，收到 6 条 text delta + `read` 工具 start/end（PASS）
3. **`codex exec` headless 输出可解析** → codex-cli 0.163.0，JSONL 归一化出文本 / shell 工具 / turn end（PASS）

重跑 `npm run spike`；版本、证据、映射表与三条备选路径见 [docs/spike-m0.md](docs/spike-m0.md)。

## M1 骨架：票 02 已通过（2026-11-05）

应用能开机：办公室画面 + 8 个空工位来自 SQLite（`node:sqlite`，零原生依赖）；
三层进程就位 —— main（窗口/宿主监管/16ms 合帧）· AgentHost（utilityProcess，DB 单写者）· renderer（React 18 纯视图）。
验收一条命令：`npm run build:renderer && npm run e2e:02`；票与实现说明见 [.scratch/v1/issues/02-empty-office.md](.scratch/v1/issues/02-empty-office.md)。

手动启动：**这台开发机**的安全策略只放行 electron.exe 写仓库工作区（Chromium 沙箱也起不来；启动器已自动处理这两点），直接：

```bash
npm start        # 数据默认落 tmp/dev-data；CUBICLE_DATA_DIR 可覆盖
```

右上徽章显示「AgentHost 在线」即宿主就绪。**下一步 = 研发票 12「失败与成本」。**

## M1 招聘：票 03 已通过（2026-11-06）

点空工位 → 中屏三步招聘（选预设角色 → 能力清单：人格/技能/工具/MCP/引擎/成本 → 确认录用）→ 工位被占用、2D 角色入座；角色在录用时刻**快照**进员工，之后改角色不影响已招的人；同一角色可招多人坐不同工位；重启员工与快照都在。预设三角色（程序员/测试/产品经理，默认引擎 pi）按 key 幂等种子，旧库升级自动获得。验收一条命令：`npm run build:renderer && npm run e2e:03`；票与实现说明见 [.scratch/v1/issues/03-hire-first-employee.md](.scratch/v1/issues/03-hire-first-employee.md)。

## M2 引擎开跑：票 04 已通过（2026-11-06）

点在岗员工 → 右缘**对话浮层**（主画布仍是办公室）说一句话 → 引擎开跑，事件按时间进面板（文本增量、工具调用可折叠、回合 tokens、结束状态）→ **中止**按钮停掉运行。pi SDK 在 AgentHost（utilityProcess）内跑，**每员工独立目录**（`engines/pi/employee-<id>/{agent,sessions,workspace}`，BYOK 走 `engines/pi/models.json`），本机 `~/.pi` 零新增；连续两次对话复用同一会话，重启后从恢复指针**续跑**；引擎无关的 run-manager + 适配协议（14 号票双宿主），11 号票 codex 按同一 seam 接入。验收一条命令：`npm run build:renderer && npm run e2e:04`；票与实现说明见 [.scratch/v1/issues/04-engine-run.md](.scratch/v1/issues/04-engine-run.md)。

## M2 工单与产出：票 05 已通过（2026-11-07）

左轨**工单台**浮层：一句话自动套 playbook（加功能/修 bug/写文档/自由），**目标与验收标准可手改**；派单时记录 git 工作区的**起点 HEAD**（工作区不是 git 仓库 → 明确不可用），跑完出**四件套**：diff 摘要（相对起点）、变更文件清单、命令输出（含测试输出）、收尾报告。**提交由员工（引擎）自己产生**；应用对 git 走只读门（`src/host/git/reader.mjs`：子命令白名单 + 审计日志，`task.gitAudit` 可查）。验收一条命令：`npm run build:renderer && npm run e2e:05`；票见 [.scratch/v1/issues/05-task-and-artifacts.md](.scratch/v1/issues/05-task-and-artifacts.md)。

## M2 验收与打回：票 06 已通过（2026-11-07）

任务跑完自动停在**待验收**——「完成」只能来自你点**通过**；**打回**在同一任务上追加一轮迭代会话（历史连续、迭代次数可见、打回意见进引擎提示词，每轮 diff 仍相对任务起点）；**取消**终止运行并标记**失败**。工单台详情显示**四件套 × 每轮**与**本任务 token**（各迭代 run 的 usage 聚合）。五个状态（待办/进行中/待验收/完成/失败）在界面可见，转移合法性由 host 的转移表强制——非法跳转（如 待办→完成）直接报 `invalid_transition`。验收一条命令：`npm run build:renderer && npm run e2e:06`；票见 [.scratch/v1/issues/06-review-and-reject.md](.scratch/v1/issues/06-review-and-reject.md)。

## M2 主界面外壳：票 08 已通过（2026-11-07）

**左轨四入口**（公司切换 / 工单台 / 花名册 / 引擎中心）+ **右缘任务把手**：徽标显示活跃工单数（进行中+待验收），拉开是「进行中 / 待验收 / 档案」三段（档案 = 完成+失败）。公司切换器显示**各公司活跃数**（host 在 office 快照里聚合 `taskCounts`）；引擎中心显示引擎名 + 配置目录（`engines.overview` 查询），**引擎卡与探针留插槽给票 11**。所有入口都是浮层：1280 窗口里画布全程满窗、房间尺寸不变（e2e 实测）。**切公司只换视图**：公司 A 工单跑着 → 切到 B → A 的 run 事件继续进 host、活跃数跨公司可见 → 切回 A，工位、工单、事件全部原位。验收一条命令：`npm run build:renderer && npm run e2e:08`；票见 [.scratch/v1/issues/08-main-shell.md](.scratch/v1/issues/08-main-shell.md)。

## 核心约束（来自蓝图）

- 主画布永远是办公室；工单只在浮层里（抽屉 / 工单台）
- 员工自主 commit，应用对 git 只读
- 多公司并行、定时上下班、下班优雅暂停（90s 宽限 + 落盘）
- v1 自用：不做账号 / 同步 / 计费
