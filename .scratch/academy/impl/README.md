# 学院 · 施工切片（Cubicle 侧）

> 决策见 [`../map.md`](../map.md) 与 [`../issues/`](../issues/)；这里只回答「下一步做什么」。
> 票头三行 `**What to build:**` / `**Blocked by:**` / `**Status:**`；状态词 `ready-for-agent | in-progress | done`。
> **取票**：编号最小 + `Blocked by` 全部 done；动手前 `Status` 改 `in-progress`；完工勾验收项 + `## Answer`。

| # | 票 | Blocked by |
|---|---|---|
| 01 | [学院数据层](01-academy-data-layer.md) | — |
| 02 | [资源装配](02-resource-assembly.md) | 01 |
| 03 | [学院浮层](03-academy-panel.md) | 01 |
| 04 | [`e2e:15` 正反断言](04-e2e-15.md) | 01, 02, 03 |

## 跨仓库依赖

Neo 侧三张票在 `neo/.scratch/academy/issues/`（01 materialize → 02 library+domain → 03 role set），**均已交付**（`ready-for-human`；lead 验收记录见 `neo/.scratch/academy/reviews/2026-11-17-lead-review.md`）。

**用 `materialize`，不要自己算装配**：技能路径已可用 —— `neo materialize --role R --agent pi --out DIR --json` 产出 `skills/`（链接）+ 每技能 hash。四条使用约束（对应审查 T1–T4）：

- `--out` 必须是**专用子目录**（靠 `root.json` marker 认领；指向已有 agent 根会被拒，exit 1）。
- 当前会把 `auth.json` 复制进 `--out`；`--no-auth` 落地前，导出目录按**含机器凭据**对待 —— e2e 用临时 `NEO_HOME`，别指真实家目录。
- MCP 的 `env:VAR` **不进导出产物**，且引用变量不在导出进程的 env 里会直接 exit 1。MCP 装配等 T1/T2 落地，01/02 票只接技能。
- `models.json` / `settings.json` 会按 Neo 的 `config.yaml` 渲染；Cubicle 的模型库是唯一模型来源，导出的模型文件**忽略**（T4 落地后改 `--agent-models`）。
- `--json` 的 `mcp` 是对象 `{ file, servers }`，不是数组。

## 别再想的事

- 不做公司级能力覆盖（02 票已废）。
- 不做离线安装（联网 `npx skills`）。
- 不写 `~/.neo`（唯一写者是 Neo CLI）。
