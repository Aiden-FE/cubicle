# 03 · 领域、资源库与 Neo 票

Type: grilling
Status: resolved
Blocked by: 01, 02

## 问题

BOSS 说「向员工下发其**领域**相关技能」。但 Neo 现在只有「角色 → 技能」一层，没有跨角色的资源库：同一个「代码审查」技能，程序员 / 测试 / 产品经理都要，就得复制三份。

领域这一层放哪？Neo 里造一个资源库，还是 Cubicle 侧维护索引、下发时拷进各角色目录？

## Answer

**领域 = 跨角色的装配键，落在 Neo。**

- 资源本体进 `~/.neo/library/<domain>/<skill>/`（或等价形态），角色声明自己属于哪些领域；
- 装配 = `default ∪ domain(角色声明的所有领域) ∪ role`，同名以就近的胜（role > domain）；
- Cubicle **不做**索引与拷贝：只读 Neo 的解析结果，别让两边各算一遍。

**给 Neo 提三张票，顺序固定：**

| 票 | 内容 | 位置 |
|---|---|---|
| N1 materialize | `neo materialize --role R --agent A --out DIR`：只落盘不 launch，输出资源清单 + 每技能 hash（`--json`） | [草稿](../neo-tickets/N1-materialize.md) |
| N2 library + domain | `~/.neo/library/` + 角色 `domain:` 声明 + `add --domain` | [草稿](../neo-tickets/N2-library-domain.md) |
| N3 角色写口 | `create` 只写空 `skills/` + `AGENTS.md` stub；缺「改」（正文 / 领域 / 装配） | [草稿](../neo-tickets/N3-role-write.md) |

**为什么是这个顺序**：N1 决定了「装配规则只存在一份」——没有它，Cubicle 只能自己重算 union 与 hash，规则立刻分叉。N2 是领域的载体，没有它领域只能手写在角色文件里。N3 决定学院能不能「编辑」，没有它学院只能只读。

**票面修正**（调研实证）：Neo 已有 `create <name>`，会写空 `skills/` 与一行注释的 `AGENTS.md`；缺的是**写入正文与领域**，N3 的标题不要写成「建角色」。

## 为什么

- 「公共资源」若没有跨角色的载体，就一定退化成「每个角色各存一份副本」，副本各自漂移 —— 这正是 GLOSSARY 否掉的形态。
- 装配规则一旦在 Cubicle 和 Neo 各实现一遍，总有一天两边的「同名谁胜」不一样，而这种 bug 只在特定角色组合下出现，极难查。

## 代价（接受）

- N2 落地前，领域只能手写进角色文件（`AGENTS.md` 或一个 `domain:` 行），学院 UI 按「读得到就显示」处理。
- N1 落地前，Cubicle 需要一份**临时**的 union 计算（直读 `~/.neo/roles` + `library`），并在 N1 之后删掉 —— 票里必须写这条「临时代码要删」，否则它会活到永远。

## 被否掉的

- 领域只在 Cubicle UI 里做分类：装配仍按角色显式列，等于没有领域。
- Cubicle 拷贝资源进角色目录：一拷贝就回到「三份副本各自漂移」。
