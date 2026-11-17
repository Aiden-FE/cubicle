# 01: 学院数据层

**What to build:** Cubicle 的 `role` 表从「角色事实源」降级为 **Neo 角色的投影缓存**：启动/刷新时读 `~/.neo/roles/<role>/` 与 `state/locks/<role>.yaml`，落成 `role` 行（key / name / tagline / domains / skills+hash / mcp 摘要 / 来源标记 / 同步时间）。`employee.role_snapshot` 从整份 manifest 换成 `{ roleKey, domains, locks{skill: sha}, engine, model, provider?, reasoningEffort?, cost }` —— **只钉版本，不复制内容**。旧库的旧结构快照必须仍能读（迁移 + 兼容测试）。

**Blocked by:** —

**Status:** done

- [x] `~/.neo` 不存在或为空 → 应用照常启动，学院入口显示空态，不阻塞、不报错
- [x] 在 `~/.neo/roles/<role>/` 里增删技能后，下次刷新（重启或重读）投影反映新集合
- [x] `employee.role_snapshot` 落新结构；**不含技能正文**，只有 `name → sha`
- [x] 旧结构快照仍可读（迁移测试，照 `store.test.mjs` 既有旧 manifest 升级的套路）
- [x] 招聘流程改读投影后行为不变（`npm run e2e:03` 仍绿）
- [x] 临时路径标注：`TODO(materialize)` —— hash 暂从 `state/locks` 读，缺 lock 时按目录内容算 sha
- [x] `npm run check` 全绿

## Answer

**改了什么**

- `src/host/academy/neo-roles.mjs`（新）：学院只读口。`resolveNeoHome`（`NEO_HOME` 覆盖 > `~/.neo`，同 Neo schema §2）；`readNeoRoleProjections` 读 `roles/<role>/`（`skills/` 子目录、`role.yaml` 的 domains/名称、`AGENTS.md` persona——create 桩注释读成空、`mcp.yaml` 只投影「名称 + 传输」摘要，密钥不进缓存）与 `state/locks/<role>.yaml` 钉 hash；缺 lock / lock 损坏 → 按目录内容算 sha256（排序相对路径 + 逐文件 hash，Windows 下稳定）。全部路径带 `TODO(materialize)`，Neo 01 落地后由 02 票的后续迭代换成 `neo materialize --json`。**对 `~/.neo` 永远只读。**
- `src/host/store.mjs`：`role` 表加 `domains / skills(名字+hash+来源) / mcp(摘要) / source(preset|neo|probe) / synced_at`（老库 `ALTER TABLE` 补列 + `assertRequiredColumns`）；新增 `syncRoleProjection(projections)`：Neo 行 upsert（接管同名预设）、刷新后反映增删后的技能集合、Neo 消失的 key：预设回落种子行、没人引用的 neo 行删除、被员工引用的保留（冻结快照仍可解释）。`listRoles` 隐藏 probe 行。
- `employee.role_snapshot` → **v2**：`{ roleKey, domains, locks{技能名: sha}, engine, model, provider?, reasoningEffort?, cost }`；开库时一次性把 v1 整份 manifest 快照升级为 v2（engine/model/cost 保留、locks 留空不造 hash、v2 行字节不动），照旧 manifest 升级的套路，读路径另有 `UNKNOWN_ROLE_SNAPSHOT` 兜底。
- 内容归位：persona / tools / mcpServers 归角色行（投影缓存），员工读接口带 `roleName` + `role`；pi/codex/dsh 适配器从 `employee.role` 取人格与工具、从快照取模型钉选；探针 persona（marker）搬到隐藏的 `source='probe'` 角色行；`employee.setEngine/update` 改钉顶层。渲染端：工位 occupant.roleName、快照字段顶层、`roleKey` 感知（deskScreen/employeeLook 兼容旧 `key`）。
- 启动刷新：`src/host/entry.cjs` 开库后 fire-and-forget 学院投影刷新——`~/.neo` 缺失/为空返回空投影、出错只记 stderr，不阻塞启动。

**怎么验证**

- `test/neo-roles.test.mjs`（9 例，临时 NEO_HOME fixture，绝不碰真实 `~/.neo`）：NEO_HOME 覆盖/空态/lock 钉 hash/缺 lock 目录 sha（确定性 + 内容变更即变）/损坏 lock 降级/role.yaml domains/AGENTS.md 桩/mcp 摘要/非法角色名过滤。
- `test/store.test.mjs` 新增 6 例：投影落成 source=neo + domains/skills+hash/mcp 摘要/同步时间；刷新反映技能增删（验收 2）；同名接管与预设回落；Neo 删除行的引用保护；快照 v2 顶层字段（断言 JSON 里没有 `manifest`/persona/正文）；Neo 角色招聘 `locks{name→sha}` 钉版本；旧 v1 快照一次打开即升级且落库。另有旧 manifest 升级、旧库员工、engine-state 手工旧库等既有用例改读 v2 后照常绿。
- `npm run check` 全绿（typecheck×2 + 432 测试）；`npm run e2e:03` 全绿——含「快照与录用时刻逐字节一致」（v2 快照字节稳定）与「招聘未写入用户家目录」。冷启动首跑曾因安全策略/AV 渲染超 15s 抖动（AGENTS.md 已记录的坑），热跑确定性通过。

**判断项**

- 「冻结」语义从「复制整份 manifest」改为「钉版本」：persona/标语等**内容**跟随角色行现值（招聘清单展示仍读角色行）；`role_snapshot` 里不再有 persona/tools —— 票文如此定义，e2e-03 与招聘向导不受影响。
- Neo 投影行的 manifest 只带装配兜底（engine=pi/model=default/cost=预设）+ AGENTS.md persona：Neo 的 role.yaml 不声明引擎/模型/工具，工具留给引擎默认（02 票装配再细化）。
- 旧库升级不伪造 locks：v1 快照没有 hash 可钉就留 `{}`，而不是给旧技能造 hash（哈希口径不同，钉了反而是假版本）。
- 「重读」通道 = `store.syncRoleProjection` + 启动刷新；03 票的「下发后刷新」可直接复用该门，本票未开 IPC 面（避免与 02 票的学院入口 API 分叉）。
- 本机坑记录：`vite build` 的 esbuild 临时产物在 `%LOCALAPPDATA%\Temp` 会被实时防护锁住（`remove … Access is denied`，100% 复现）；把 `TMPDIR/TEMP/TMP` 指到仓库内目录即可构建。
