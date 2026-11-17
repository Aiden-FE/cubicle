# 员工学院 · 决策地图

> 用 `/wayfinder` 维护。目的地是一份能直接开工的蓝图，不是代码。
> **状态：设计与共识完成（2026-11-17）** —— 5 张决策票全部关闭；实现票未开。
> 前情：`.scratch/cubicle/map.md`（v1 蓝图，已关闭）把「能力插件市场」留在雾区，这个 effort 把它兑现。

## Destination

Cubicle 里长出一个**学院**：本机级的公共能力资源库（技能 + MCP），按**领域**打标，招聘时把资源按角色下发进员工的引擎，并且**角色之间互不可见、互不覆盖**。

同时钉死它与 **Neo**（`@compass-aiden/neo`，本机 `C:\Users\Aiden\dev\aiden\neo`，公共 npm 0.2.8）的接缝：Neo 管资源与角色，Cubicle 管应用层，两边靠**文件契约 + CLI** 连接，不导入代码（Neo 没有 SDK）。

一条命令能证明整条链路：装一个技能 → 下发给角色 → 招聘 → 该员工跑起来时引擎真的读到它 → 另一个角色的员工读不到。

## Notes — 已定约束（不再重开）

### 归属

- 学院是**本机级**的，跨公司共享；公司隔离只含人员、会话、密钥、产出（见 `GLOSSARY.md`）。
- 学院的资源 = **技能 + MCP**。模型与引擎配置**不属学院**：14 票的引擎无关模型库留在 Cubicle，Neo 的 `model` 命令不启用。
- **角色归 Neo**（`~/.neo/roles/<role>/{skills,AGENTS.md,mcp.yaml}`）；Cubicle 的 `role` 表降级为**投影缓存**，预设三角色种子迁进 Neo。
- **Neo CLI 是 `~/.neo` 的唯一写者**；Cubicle vendor 该 CLI（随应用分发），只读文件 + 调它做写动作。

### 隔离

- 隔离边界 = **角色**，含两层：**上下文隔离**（引擎只看得见自己角色的资源）+ **依赖隔离**（同名技能不同版本各装各的，不互相覆盖）。
- 招聘时**钉 hash**（Neo 的 `state/locks/<role>.yaml` 那套），不复制内容；学院里已发布的版本**永不改写**，升级 = 发新版本 + 显式给员工升级。
- **公司级能力覆盖废除**：05 票的三层作用域收缩为「角色 + 员工」。

### 集成深度

- 本次做 **L1**：Neo 出资源（技能目录、MCP 配置、hash 清单），Cubicle 把它挂进自己的**每员工引擎根**（`engines/<engine>/employee-<id>/`）；`config.toml` / `hooks` / 密钥 / 策略钩子仍归 Cubicle。
- **L2**（Neo 物化的启动根直接当引擎 home，含实例维）写成目标，不进本次。
- **L3**（`neo run` launch 引擎、Cubicle 只收事件）**不做**：与 AgentHost 的进程内 pi SDK + 归一化事件总线正面冲突。

### 风险与联网

- 技能安装保持**联网**（`npx skills` 那套，源连通性由用户保证），不做离线兜底。
- MCP = 用户自带资产，**用户自负审查**；应用不设白名单、不审查，只标来源 + 首次下发确认一次。
- 自定义 **tool 代码仍不开放**（05 票边界不动）。

### 首切片与验收

- 全链路，但宽度收窄：**1 个技能、1 个角色、1 个引擎（pi）、1 名员工**。
- 验收 = 一条 `npm run e2e:15`，**正反双向断言**：同角色员工的上下文含技能暗号，另一角色员工的上下文不含；用 mock 模型 server 记录上下文来判，不靠模型自觉复述。

## Decisions so far

- [学院的范围与归属](issues/01-academy-scope-ownership.md): 学院 = 本机级共享资源库（技能 + MCP），角色归 Neo，Cubicle 只做应用层；`role` 表降级为投影缓存，招聘钉 hash 不复制内容。
- [隔离与版本](issues/02-isolation-and-versioning.md): 隔离边界 = 角色（上下文 + 依赖两层）；学院版本不可变；废除公司级覆盖；dsh 的共享 `DSH_HOME` 是必须修的隔离缺口。
- [领域、资源库与 Neo 票](issues/03-domain-library-and-neo-tickets.md): 领域是跨角色的装配键，落 Neo 的 `library/`；三张 Neo 票按 materialize → library+domain → 角色写口 的顺序提。
- [MCP 与风险边界](issues/04-mcp-and-risk.md): MCP 由用户自带、自负审查、不设白名单；应用只标来源 + 首次确认；tool 代码仍不开放。
- [首切片与验收](issues/05-first-slice-acceptance.md): 全链路但只 1 技能 / 1 角色 / 1 引擎 / 1 员工；`e2e:15` 正反双向断言。

## 与 Neo 的接缝（协作边界，2026-11-17 人工裁定）

**边界**：Neo 项目的任务一律**提工单**，Cubicle 会话不得在 neo 仓库实施/合并/改历史。2026-11-17 18:45–18:50 的 revert 系列**不是 lead 做的**（是一次越界清理时的整批回撤，把 01–04 的实现一起撤掉了）；lead 已于 19:0x 从 `e66282a` 恢复实现并逐项复验（Neo `894e5bf`），01–04 已在 Neo main 上生效。Cubicle 侧的 [`neo-tickets/`](neo-tickets/) 只保留说明性索引，**不携带任何 Neo 源码或 patch**（handoff patch 已删除，N4 已作废）。写入边界见 [`impl/SCOPE.md`](impl/SCOPE.md)。

| 票 | 内容 | Cubicle 侧现状 |
|---|---|---|
| [N1 materialize](neo-tickets/N1-materialize.md) | `neo materialize --role <r> --agent <a> --out <dir>` | **已交付**（Neo `894e5bf`）；Cubicle 直接消费，不自己算装配 |
| [N2 library + domain](neo-tickets/N2-library-domain.md) | `~/.neo/library/<domain>/…`，角色 `domains:` | **已交付**（Neo `894e5bf`） |
| [N3 角色写口](neo-tickets/N3-role-write.md) | `neo role set` 写入口 | **已交付**（Neo `894e5bf`） |
| [N4 导出合同 T1–T5](neo-tickets/N4-export-contract.md) | `envRefs` / env 校验归 run / `--no-auth` / `--agent-models` / help | **已交付并复验**（Neo `894e5bf`）；Cubicle 恒传 `--no-auth --agent-models` |

**vendor 再钉**：Neo main 已恢复 01–04（`894e5bf`），vendor bundle 应重钉到该提交并复跑装配 e2e；在此之前 `4ee1dcd` 钉仍可用（提交对象永久存在，可复现）。

**消费侧注意**：`materialize` 默认与启动根同形（含 auth 凭据副本）；Cubicle **恒传 `--no-auth`**，导出目录不得出现 `auth.json`。`--out` 必须是本命令独占目录（`root.json` marker 认领），不要指向已有员工引擎根；模型由 Cubicle 自带，**恒传 `--agent-models`**。

**N3 落地后的锁语义（宿主合同）**：`neo role set` 改动装配 → `state/locks/<role>.yaml` 标 `dirty: true`，`status` 走漂移通道（ok=false/exit 1）；**清脏只认 `neo update` 或 `neo use --global`**（`materialize` 保持只读、不清脏）。Cubicle 下发后要把「收敛」当显式步骤（下发 → update/use 清脏 → materialize），不要把 `status` 当健康闸。`--json` 返回 `{ok, role, dryRun, changed{…}, dirty, files[…]}`。

## 怎么开工（Cubicle 侧）

已切票：[`impl/README.md`](impl/README.md) —— **01 数据层 → 02 装配 → 03 浮层 → 04 `e2e:15`**，依赖与验收见各票。Neo 侧三张票在 `neo/.scratch/academy/`（`01 materialize → 02 library+domain → 03 role set`）。

两边**可以并行**：Neo 的 01 不依赖任何东西；Cubicle 的 01/02 在 Neo 01 落地前走「临时直读 `~/.neo/roles`」并标 `TODO(materialize)`。

## Not yet specified

- **L2 集成**：实例维的启动根（`roots/<role>/<agent>/<instance>`）+ codex / dsh 的 root 契约补齐。
- **技能的下架与回滚**：员工钉着旧 hash 时，学院删除该资源会怎样（倾向：软删 + 保留版本）。
- **换机器**：学院的导入 / 导出（本机级 = 换一台机器就没了）。
- **领域规则细节**：一个角色多领域怎么合并、领域是否可继承。

## Out of scope

- **L3 进程层集成**（`neo run` 接管引擎启动与事件）。
- 学院作为**市场**（售卖、分发、评分、订阅）。
- 模型库 / 引擎配置迁移进 Neo。
- 多员工协作（见 `.scratch/cubicle/map.md` 的 Out of scope）。
