# 03: 学院浮层

**What to build:** 左轨第五个入口「学院」，打开是浮层（**主画布仍是办公室，不许挤压**）：列出来自 `~/.neo` 的资源（名称 / 领域 / 来源 / hash / 被哪些角色引用），能**装**（输入源字符串 → 调 vendored `@compass-aiden/neo` 的 `neo add`）、能**下发**（挑角色 → 写角色装配）、能标**来源**（本机目录 / 远端源 / 手写）并在远端来源首次下发的确认一次。`neo` 不可用时给可读降级，不崩。

**Blocked by:** 01

**Status:** done

- [x] 浮层开合不改变画布尺寸与工位坐标（照 `e2e:08` 的断言方式）
- [x] 列表数据全部来自 `~/.neo`（空目录 = 空态），不硬编码任何资源
- [x] 装：调 vendored CLI（依赖 + `ELECTRON_RUN_AS_NODE` 起 `bin/neo.js`），成功/失败都回显可读原因
- [x] 下发：写进角色装配后，01 的投影缓存同步刷新（列表上的「引用角色」跟着变）
- [x] 来源标记持久化；远端来源首次下发弹一次确认，之后不再打扰；本机 / 手写来源不弹
- [x] `neo` 缺失或版本过老 → 浮层降级为只读并提示，不抛未捕获异常
- [x] IPC：`academy.*` 进 `ipc-methods.mjs` 白名单；reject 走纯对象 `{ code, message }`
- [x] `npm run check` 全绿

## Answer

**改了什么**

- **渲染层**：`LeftRail.jsx` 第五入口「学院」（`rail-academy`，aria-expanded）→ `AcademyPanel.jsx`（新，`.rail-drawer` 同族 520px absolute 浮层）：降级横幅 / 空态（显示 neoHome 路径）/ 资源表（名称·领域·来源·hash 前 8 位·被引用角色 + 下发按钮）/ 装表单（源、领域|角色、名字、技能名单留空=全部）/ ok·fail 回显区 / 下发托盘（角色勾选、远端未确认时挂起「确认远端来源并下发」）。`App.jsx` 把 `academyOpen` 纳入左轨浮层互斥；`styles.css` 学院样式。
- **host 门 `src/host/academy/panel.mjs`（新）**：`probe()`（`--version` ≥ `0.2.8`，起不来/过老 = `{available:false, reason}`，永不抛）；`snapshot()`（列表 = a01 投影缓存的角色层行 + `neo list domains --json` + `library/<domain>` 只读直读（展示 hash 用 a01 同款 `dirContentSha`，注释限定缓存/UI 用途）；「被引用角色」= 声明该领域的角色现值）；`install()`（`neo add <src> --role|--domain <名> -s <…|*>`，180s 超时；成功回显上游、失败 `academy_cli_failed` message=neo 可读原因；成功按源字符串形态分类写标记：路径形态=本机，其余=远端；成败都刷投影）；`dispatch()`（`neo role set <r> --domains ∪ --json` → 按 vendor/README 宿主合同 `neo update --role` 收敛清脏（materialize 永不清脏）→ `store.syncRoleProjection` 刷新；收敛失败点名不吞写入）。
- **来源标记**：`store.mjs` 新表 `academy_mark`（`kind ∈ local|remote|written` + `source` + `remote_ack`，`CREATE TABLE IF NOT EXISTS` 老库自动补）；判定优先级 = 面板标记 → 角色锁 `sourceType`（git/wellknown=远端、local=本机）→ 手写；键 = 容器级 `d:<域>`/`r:<角色>` 或行级 `…/<技能>`。下发遇未确认的远端域 → `academy_remote_unconfirmed`，`confirmed:true` 重试 → `ackAcademyRemote` 落库此后不再问；本机/手写从不问。
- **接线**：`service.mjs` `academy.snapshot/install/dispatch`（异步门；失败 = 纯对象错误信封；成功带 domain.changed）；`entry.cjs` 接门（与装配器同一 vendored 约定）；`ipc-methods.mjs` 白名单三条 + 测试扩展。**M1 坑适配**：`ELECTRON_RUN_AS_NODE` 传导到 npx/npm/mktemp 后它们也是 electron.exe 身份，%TEMP%/%LOCALAPPDATA% 被安全策略拒写（实测 EPERM）→ neo 子进程的 `TMPDIR/TEMP/TMP` 与 `npm_config_cache` 指进 `<dataDir>/neo-tmp|npm-cache`（机器本地，与 materialize --out 同姿态）。
- **lead 范围调整（neo 外部验收 T1–T4）**：`assembly.mjs` 引擎侧 MCP 门默认 **OFF**（`CUBICLE_ACADEMY_MCP=1` 才开，TODO(T1-T4) 注释指向 lead 审查结论）；默认行为 == 「未配置 MCP」（不读 mcp.yaml、不留旧渲染件）；a02 的 MCP 单测改带旗标保留 + 新增默认-off 用例。面板无 MCP 编辑 UI；下发只覆盖领域/人格。
- **桥**：`window.cubicle.invoke` 加可选第三参 `{timeoutMs}`（默认仍 8s，纯 additive；main 中继本就无超时），学院装/下发放宽到 200s。
- **e2e**：`scripts/e2e-academy{,-runner}.mjs` + `npm run e2e:academy`（本票专属小阶段；`e2e:15` 归 a04）。
- **边界**：本票全程未读写 neo 仓（边界裁定 + `SCOPE.md`），fixture `NEO_HOME` 全在 `tmp/`，早期抽取的 neo 源码副本已删。

**怎么验证**（`npm run check` 全绿 = typecheck×2 + 475 测试；`build:renderer`（TMP 三连 export 到 `tmp/esbuild-tmp`）+ `e2e:03` + `e2e:08` + `e2e:academy` 终树全绿）

1. **画布不挤压**：`e2e:academy` 照 e2e:08 断法 —— 开/合浮层（含托盘与行数据）时 office-floor 满窗、room 尺寸不变、8 个工位 `[id,left,top]` 与基线**逐字节一致**；收起后 `aria-expanded=false`。
2. **数据全来自 ~/.neo / 空态**：e2e 的 NEO_HOME 指临时 fixture（只种角色不种资源）→ 空态可见 rows=0；`test/academy-panel.test.mjs` 空家目录 → rows/domains/neoRoles 全空；行字段 名称/领域/来源/hash/被引用角色 断言在案。
3. **装**：e2e 在应用内面板源=本机 fixture 目录 → 回显 `installed hello-academy (hash …) into domain demo` + 行出现（证明应用内 `process.execPath`+`ELECTRON_RUN_AS_NODE` 起 `bin/neo.js`，再由它拉起 npx）；失败回显 `academy_cli_failed`（含上游原因）与 malformed payload 不 spawn 即拒都在单测钉死。
4. **下发→投影刷新**：e2e 勾 `e2e-role-a` 下发 → 行「被引用角色」实时 `—→e2e-role-a` 且 `role.list` 现值 `domains:["demo"]`；单测另钉 neo 侧：role.yaml 写入 + 锁 `dirty` 被 `update` 清掉（宿主合同）。
5. **来源标记/一次确认**：单测 —— 锁 sourceType→远端、无标记→手写、面板装本机路径→本机；远端域首次下发拒 `academy_remote_unconfirmed` → `confirmed:true` 成功且 `remote_ack` 落库 → 第二次下发（另一角色）无需再确认；本机/手写直发；`academy_mark` 跨重开持久（store 2 例）。
6. **降级只读**：单测 —— bundle 缺失（起不来）与假 CLI 报 0.2.2 → `probe.available=false` + 可读 reason；`snapshot.readOnly=true`；install/dispatch 拒 `academy_neo_unavailable`；全程无未捕获异常。
7. **IPC**：白名单测试含 `academy.*` 三条；service 信封测试钉 reject 为纯 `{code,message}`、装/下发发 `domain.changed`、无门宿主诚实报 `academy_unavailable`。

**判断项 / 偏差**

- 「装」除源字符串外还要选目标（领域/角色）与可选技能名单：vendored 上游 `npx skills` 在非 TTY 必须显式目标与技能（否则 usage 错），票面 `neo add <src> [--role|--domain]` 本就含目标；源需**绝对路径**（上游把相对路径解析到自己的暂存根）——表单 placeholder 已提示。
- 「下发」粒度 = **领域**（装配键）：角色层资源本就装在该角色里，行上无下发按钮；远端一次确认按容器 `d:<域>` 落库，与下发动作同粒度。
- **MCP 按 lead 裁定（neo 外部验收 T1–T4 未到）按「门关 = 今天的行为」满足**：引擎侧装配门默认 OFF + 旗标化单测保留；面板无 MCP 编辑入口；`role set` 的 mcp 能力只存在于 CLI 层、面板不用。同时记录 T2 现状：**角色 mcp.yaml 引用缺失 env 时，vendored `materialize` 自身会 exit 1**（装配测试 fixture 因此显式带变量并注释），等 T1–T4 到货随 vendor re-pin 解除。
- materialize 导出的 `models.json/settings.json/auth.json` 全落在员工根下的 `neo-materialized/` 子目录，Cubicle 不读它们（模型库仍是唯一模型来源；引擎根按含凭据对待）。
- 桥超时是唯一动到共享面的改动：纯 additive、默认行为不变，e2e:03/08 终树复跑绿。
- 面板对 `domain.changed` 一律重读（含工单事件）：面板是短时浮层，诚实优先于省几次刷新。
