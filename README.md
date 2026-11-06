# Cubicle

> 一间看得见的办公室：AI 数字员工在工位上干活，你招聘、派活、验收。

- **形态**：Windows 优先的桌面应用（Electron + React + PixiJS）
- **引擎**：不绑定任何 agent 引擎 —— 统一适配层调用本机已装的 pi / codex / claude / dsh / qoder…
- **状态**：**M1 开工 —— 研发票 02「能开机的空办公室」已通过（2026-11-05）**；下一步 = 研发票 03（招聘第一个员工）。

## 从这里开始

| 入口 | 内容 |
|---|---|
| [.scratch/cubicle/map.md](.scratch/cubicle/map.md) | 蓝图入口：15 条决策索引 + 雾区 + 范围边界 |
| [.scratch/cubicle/issues/12-milestones-risks.md](.scratch/cubicle/issues/12-milestones-risks.md) | 6 个里程碑（26–36 人日）、9 条风险、「只做三件事」 |
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
.scratch/v1/             v1 研发票（13 张，下一步做什么）
docs/spike-m0.md         M0 探路结论（三关全过）
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

应用能开机：办公室画面 + 4 个空工位来自 SQLite（`node:sqlite`，零原生依赖）；
三层进程就位 —— main（窗口/宿主监管/16ms 合帧）· AgentHost（utilityProcess，DB 单写者）· renderer（React 18 纯视图）。
验收一条命令：`npm run build:renderer && npm run e2e:02`；票与实现说明见 [.scratch/v1/issues/02-empty-office.md](.scratch/v1/issues/02-empty-office.md)。

手动启动（本机策略注意）：桌面正常机器直接 `npm start`（数据落 `%APPDATA%\cubicle`）。
**这台开发机**的安全策略只放行应用写仓库工作区（Chromium 沙箱也起不来，启动器会自动降级重试并打印说明），所以要指一个仓库内的数据目录：

```bash
# Git Bash / UCRT64
CUBICLE_DATA_DIR="$PWD/tmp/dev-data" npm start
```

右上徽章显示「AgentHost 在线」即宿主就绪。**下一步 = 研发票 03「招聘第一个员工」。**

## 核心约束（来自蓝图）

- 主画布永远是办公室；工单只在浮层里（抽屉 / 工单台）
- 员工自主 commit，应用对 git 只读
- 多公司并行、定时上下班、下班优雅暂停（90s 宽限 + 落盘）
- v1 自用：不做账号 / 同步 / 计费
