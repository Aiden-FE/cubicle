# N2 · 资源库与领域（library + domain）

> **已提交至 Neo 仓库**：`neo/.scratch/academy/issues/02-library-domain.md`（2026-11-17）。本文件留作跨仓库索引。

Type: grilling
Status: open
Blocked by: N1

## 背景

现状只有「角色 → 技能」一层：`roles/<role>/skills/<name>/`。同一个「代码审查」技能，程序员 / 测试 / 产品经理都要 —— 只能复制三份，各自漂移。

Cubicle 的学院要按**领域**下发，需要一个跨角色的资源载体。

## 需求

1. **资源库**：`~/.neo/library/<domain>/<skill>/SKILL.md`（一个技能可同时出现在多个 domain 下，实现上可为链接）。
2. **角色声明领域**：新增 `roles/<role>/role.yaml`，最小形态 `domains: [frontend, review]`；缺文件 = 无领域。
3. **装配规则**：`default ∪ domain(角色所有领域) ∪ role`，同名以更近的胜（`role > domain > default`）；冲突时 `status` 给出可读的说明。
4. **命令**：`neo add <src> --domain <d>`（装进库）、`neo list domains`、`status --json` 的 `roles[]` 里带 `domains`。
5. **兼容**：`library/` 不存在时行为与今天完全一致；升级不迁移、不改写既有 `roles/<role>/skills`。
6. **锁**：技能进库后，hash 仍按「每个角色装配后的实际集合」记进 `state/locks/<role>.yaml`（与今天同形）。

## 验收

1. 两个角色声明同一 domain，`library` 里装一次技能，两者 `materialize` 后都拿到，且 lock 各自记录同一 hash。
2. 同名技能同时存在于 domain 与 role，role 胜，`status` 能解释原因。
3. 空 `library/` 时，全部现有测试与 `status` 输出不变。

## 边界

- 不做领域继承 / 多级领域。
- 不做「领域」的 UI（UI 在 Cubicle）。
- 不改 `default` 角色的语义。
