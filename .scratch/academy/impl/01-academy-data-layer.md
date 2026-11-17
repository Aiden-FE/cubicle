# 01: 学院数据层

**What to build:** Cubicle 的 `role` 表从「角色事实源」降级为 **Neo 角色的投影缓存**：启动/刷新时读 `~/.neo/roles/<role>/` 与 `state/locks/<role>.yaml`，落成 `role` 行（key / name / tagline / domains / skills+hash / mcp 摘要 / 来源标记 / 同步时间）。`employee.role_snapshot` 从整份 manifest 换成 `{ roleKey, domains, locks{skill: sha}, engine, model, provider?, reasoningEffort?, cost }` —— **只钉版本，不复制内容**。旧库的旧结构快照必须仍能读（迁移 + 兼容测试）。

**Blocked by:** —

**Status:** in-progress

- [ ] `~/.neo` 不存在或为空 → 应用照常启动，学院入口显示空态，不阻塞、不报错
- [ ] 在 `~/.neo/roles/<role>/` 里增删技能后，下次刷新（重启或重读）投影反映新集合
- [ ] `employee.role_snapshot` 落新结构；**不含技能正文**，只有 `name → sha`
- [ ] 旧结构快照仍可读（迁移测试，照 `store.test.mjs` 既有旧 manifest 升级的套路）
- [ ] 招聘流程改读投影后行为不变（`npm run e2e:03` 仍绿）
- [ ] 临时路径标注：`TODO(materialize)` —— hash 暂从 `state/locks` 读，缺 lock 时按目录内容算 sha
- [ ] `npm run check` 全绿

## Answer

（完工时填：改了什么 / 怎么验证 / 判断项）
