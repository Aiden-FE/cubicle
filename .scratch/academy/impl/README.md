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

**范围以 [`SCOPE.md`](SCOPE.md) 为准：`neo/` 只读，`~/.neo` 只读。**

Neo 侧 01–04 已由 lead 恢复并逐项复验（Neo `894e5bf`；`pnpm verify` 40 文件 / 650 测试绿；T1–T5 在临时 `NEO_HOME` 上手打通过）。导出命令：

```
neo materialize --role R --agent pi --out DIR --no-auth --agent-models --json
```

- `--out` 必须是**专用子目录**（`root.json` marker 认领；指向已有 agent 根 → exit 1）。
- **恒传 `--no-auth`**：凭据由 Cubicle 自己管，导出目录不得出现 `auth.json`。
- **恒传 `--agent-models`**：模型来自 Cubicle 的模型库，导出不渲染 `models.json` / `settings.json`。
- `--json` 清单：`skills[{name,hash,source}]`、`mcp{file,servers,envRefs}`（`envRefs` = `server → key → VAR` 的**引用**，不含值，MCP 启动时由宿主注入）、`model{file,providers,default,owner,reason}`、`authExcluded`、`hash`。
- MCP 的 `env:VAR` **不再要求导出进程里存在该变量**（T2 已修），引用从 `envRefs` 读。

## 别再想的事

- 不做公司级能力覆盖（02 票已废）。
- 不做离线安装（联网 `npx skills`）。
- 不写 `~/.neo`（唯一写者是 Neo CLI）。
