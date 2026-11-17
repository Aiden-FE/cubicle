# 能力资源与角色归 Neo，Cubicle 只做应用层

Cubicle 要做「统一的员工学院」，但它不是资源的主人：角色、领域、技能/MCP、版本锁与装配规则都落在 Neo 的 `~/.neo` 目录（Neo CLI 是唯一写者，随应用 vendor），Cubicle 只读文件、调命令，并负责引擎根、策略钩子、密钥与 UI。选这条是因为 Neo 已经把这套模型与版本锁做完了、且刚删掉自己的 UI；两份角色或两份装配规则必然漂移，而「统一学院」的全部意义就是只有一份。

## Consequences

- Cubicle 的 `role` 表降级为投影缓存；`role_snapshot` 记 `{roleKey, domain, locks{skill:hash}, engine, model}`，不复制技能内容。
- 应用启动需要能拉起 vendored 的 `neo` CLI，并处理「本机 Neo 版本过老」的降级路径。
- 反方向也锁死：Cubicle **不直接写** `~/.neo`，Neo 缺的写口走 Neo 的票，不在应用里绕过去。
