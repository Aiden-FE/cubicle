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

Neo 侧三张票在 `neo/.scratch/academy/issues/`（01 materialize → 02 library+domain → 03 role set）。

**Neo 01 未落地前**：01/02 票走「临时直读 `~/.neo/roles/<role>/`」的路径，代码里必须留 `TODO(materialize)` 标记；Neo 01 落地后由 02 票的后续迭代删掉这段临时代码 —— **票没过之前，这段临时路径不算完成**。

## 别再想的事

- 不做公司级能力覆盖（02 票已废）。
- 不做离线安装（联网 `npx skills`）。
- 不写 `~/.neo`（唯一写者是 Neo CLI）。
