# Cubicle

> 一间看得见的办公室：AI 数字员工在工位上干活，你招聘、派活、验收。

- **形态**：Windows 优先的桌面应用（Electron + React + PixiJS）
- **引擎**：不绑定任何 agent 引擎 —— 统一适配层调用本机已装的 pi / codex / claude / dsh / qoder…
- **状态**：**蓝图已完成，尚未开工**。下一步 = M0 探路。

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
GLOSSARY.md              领域术语
```

## 下一步：M0 探路（2–3 人日）

开工前必须先证伪的三件事：

1. **Electron 内嵌 Node ≥ 22.19**（pi 的硬要求；不满足则锁 Electron 版本或降级 pi 适配器）
2. **pi SDK 在 utilityProcess 里能吐 token 事件**（`createAgentSession` + `subscribe`）
3. **`codex exec` headless 输出可解析**（JSONL / JSON，本机已装已登录）

这三件任何一件不成立，架构就要改 —— 所以先花两天验证，再写界面。

## 核心约束（来自蓝图）

- 主画布永远是办公室；工单只在浮层里（抽屉 / 工单台）
- 员工自主 commit，应用对 git 只读
- 多公司并行、定时上下班、下班优雅暂停（90s 宽限 + 落盘）
- v1 自用：不做账号 / 同步 / 计费
