# 01 · 学院的范围与归属

Type: grilling
Status: resolved
Blocked by: -

## 问题

「统一的员工学院」要盖多大的房子？它和已经存在的两层东西怎么分：

- `GLOSSARY.md` 的**角色**：招聘用的能力模板，招聘即钉进员工；
- **Neo**（`@compass-aiden/neo`）：已经落了 `~/.neo/roles/<role>/{skills,AGENTS.md,mcp.yaml}`、启动根、hash 锁，**且 0.2.0 起删掉了自己的 UI**；
- Cubicle 自己的 `role` 表（`store.mjs:209-216`）与三角色种子。

三条路：学院只读 Neo 的目录（退化成查看器）／学院自成一套（第二所学院）／**分工**（Neo 落地，Cubicle 做应用层）。

## Answer

采纳**分工**：

- **学院 = 本机级共享资源库**（技能 + MCP），跨公司；公司隔离只含人员 / 会话 / 密钥 / 产出。
- **角色归 Neo**：`~/.neo/roles/<role>/` 是角色的事实源；Cubicle 的 `role` 表降级为**投影缓存**，预设三角色种子迁进 Neo。
- **Neo CLI 是 `~/.neo` 的唯一写者**：Cubicle vendor 它（随应用分发），读文件 + 调命令，不直接写目录。
- **集成深度 = L1**：Neo 出资源，Cubicle 建每员工引擎根。L2（Neo 的启动根直接当引擎 home）是目标、不进本次；L3（`neo run` 接管引擎）不做。
- **模型库不属学院**：14 票的引擎无关模型库留在 Cubicle，Neo 的 `model` 命令不启用。

## 为什么

- Neo 刚把自己的 UI 删掉，Cubicle 刚缺「资源真的抵达引擎」这块 —— 接缝是现成的，不是硬拼的。
- 两份角色（Cubicle DB + Neo 目录）必然漂移：终端敲 `neo` 看到的和应用里看到的不一样，「统一学院」当场失效。因此只能有一份。
- 角色 = 领域声明 + 资源装配 + 人格，三件事在 Neo 都已经有落点（`roles/<role>/AGENTS.md`、`skills/`、`mcp.yaml`）；再在 Cubicle 存一份等于给每件事造两个家。

## 代价（接受）

- 一次迁移：`role` 表变缓存；`role_snapshot` 从整份 manifest 换成 `{roleKey, domain, locks{skill:hash}, engine, model}`。
- 应用启动要能拉起 vendored 的 `neo` CLI（`ELECTRON_RUN_AS_NODE`），并处理「Neo 版本比预期老」的降级。
- 学院在**没有 `~/.neo`** 的机器上（首次装机）需要先初始化 —— 这一步由 `neo init` 承担，Cubicle 只负责调它。

## 被否掉的

- 学院自成一套：第二所学院，两边的技能各装各的，永远对不齐。
- 学院只读 Neo：做不了「下发」「版本钉住」「来源标记」，退化成文件浏览器。
- L3：与 AgentHost 的进程内 pi SDK + 归一化事件总线正面冲突（Neo 只 launch CLI，拿不到 token 级事件）。
