# N1 · `neo materialize`：只落盘、不启动

> **已提交至 Neo 仓库**：`neo/.scratch/academy/issues/01-materialize.md`（2026-11-17）。本文件留作跨仓库索引，改动请直接改 Neo 侧那份。

Type: grilling
Status: open
Blocked by: -

## 背景

Cubicle 的 pi 是**进程内 SDK**（`createAgentSession` + `DefaultResourceLoader`），不是 CLI。`neo run` 走 launch 子进程 + 环境变量重定向，对 Cubicle 不成立。

但 Cubicle 需要 Neo 的**装配结果**：`default ∪ role` 的技能集合、每个技能的 hash、渲染好的 MCP 配置。这些规则如果让 Cubicle 自己再实现一遍，两边早晚不一致（「同名谁胜」的差异只在特定角色组合下显形）。

## 需求

新增命令：

```
neo materialize --role <role> --agent <agent> --out <dir> [--json]
```

- **只落盘，不启动任何进程**（与 `run` 的区别就这一条）。
- 产物形状 = 现有启动根（`~/.neo/roots/<role>/<agent>/`）里与资源有关的那部分：`skills/`（链接或 junction，按现有 `link-node` 策略）、`AGENTS.md`、MCP 配置、models 文件、`root.json`。
- `--json` 打印清单：`{ ok, role, agent, outDir, skills: [{ name, hash, source }], mcp: [...], hash }`。
- **幂等**：同样的输入跑两次，除 `root.json` 的时间戳外产物一致。
- **只读** `~/.neo/roles` 与 lock：不改角色、不写 `state/locks`。
- 失败语义：角色不存在 / agent 不支持 / out 目录非空且非本工具产物 → 退出码 1 + JSON 错误码。

## 验收

1. 造一个含两个技能的 fixture 角色，`materialize` 两次，`skills/` 结构与 hash 清单两次一致。
2. 在 Cubicle 里把 `--out` 指向 `engines/pi/employee-<id>/agent`，pi SDK 能读到 `<out>/skills/<name>/SKILL.md`（这是 Cubicle 侧 e2e:15 的判据之一）。
3. 对不存在的角色，退出码 1 且不产生半个目录。

## 边界

- 不做 launch（那是 `run`）。
- 不做实例维（`roots/<role>/<agent>/<instance>`）—— 那是 L2，另开票。
- 不补齐 codex 的 `models.json` + `hooks` 契约、dsh 的 `profiles/<name>` 形状 —— 那是 L2 的事。
