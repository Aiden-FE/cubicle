# N3 · 角色写入：改正文、改领域、改装配

> **已提交至 Neo 仓库**：`neo/.scratch/academy/issues/03-role-write.md`（2026-11-17）。本文件留作跨仓库索引。

Type: grilling
Status: open
Blocked by: N2

## 背景

`neo create <name>` 只写两样东西：空的 `roles/<name>/skills/` 和一行注释的 `AGENTS.md` stub（`core/src/roles.ts:29-42`）。**没有任何命令能改**：AGENTS.md 正文、领域声明、MCP 配置。

Cubicle 是「`~/.neo` 的唯一写者」的调用方（不直接写目录），没有写口，学院就只能是只读浏览器。

## 需求

```
neo role set <role> [--agents-md <file>|-] [--domains a,b] [--mcp <file>|-] [--dry-run] [--json]
```

- `--agents-md -` 从 stdin 读正文；写入 `roles/<role>/AGENTS.md`。
- `--domains` 覆写 `role.yaml` 的 `domains`（传空串 = 清空）。
- `--mcp` 覆写 `roles/<role>/mcp.yaml`，写前校验「敏感值只许 `env:VAR`」。
- `--dry-run` 打印 diff，不落盘。
- 改动装配后把 lock 标脏（`state/locks/<role>.yaml` 顶部一个 `dirty: true`），`status` 的 findings 里可见；`update` / 重新 `materialize` 清脏。
- `--json` 输出 `{ ok, role, changed: [...], dirty }`。

## 验收

1. 改 AGENTS.md 正文 → `materialize` 产物里是新正文。
2. 改 domains → 装配集合变化，lock 标脏，`status` 报 finding。
3. `--mcp` 里写明文 token → 拒绝，退出码 1，不落盘。
4. `--dry-run` 后文件 mtime 不变。

## 边界

- 不做交互式编辑器、不做 UI。
- 不做角色删除 / 重命名（另开票）。
- 不改 `create` 的既有行为。
