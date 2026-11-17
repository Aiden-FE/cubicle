# 02: 资源装配（技能真的抵达引擎）

**What to build:** 把角色投影里的技能 / MCP 真的挂进**每个员工自己的**引擎根，并保证角色间互不可见。三个引擎各走各的既有路径，**不复制内容，只建链接**（Windows junction / POSIX symlink）：

- **pi**：`<agentDir>/skills/<name>` + `noSkills: true` + `additionalSkillPaths: [本员工的技能目录]`（否则 SDK 还会读 `~/.agents/skills`，串味）
- **codex**：`$CODEX_HOME/skills/<name>`（现成的每员工 home，只需写入）
- **dsh**：先拆掉共享的 `engines/dsh/home` —— 每员工一个 `DSH_HOME`，或改用 `customSkillDirs` 只喂该员工的路径（二选一，写清理由）
- **MCP**：从角色投影读 Neo 的 `mcp.yaml`，渲染成各引擎原生配置（pi / codex / dsh 各自的形态），密钥只接受 `env:VAR`

**Blocked by:** 01

**Status:** done

- [x] pi：员工 A 的 run 里只能看到 A 的技能（断言 `~/.agents/skills` 里的技能**不出现**）
- [x] codex：`$CODEX_HOME/skills/<name>` 就位，且不写 `CODEX_HOME` 之外的任何用户目录
- [x] dsh：不再共享 `DSH_HOME`；两员工并行跑时彼此看不到对方技能
- [x] 链接是 junction/symlink 而非副本（断言 inode/link 类型，删角色技能后员工侧断开而非留副本）
- [x] MCP：`env:VAR` 之外的值被拒绝；未配置 MCP 时行为与今天一致（三引擎仍传空）
- [x] 临时路径仍标 `TODO(materialize)`：装配集合改由 `neo materialize --json` 计算（Neo 01/02 已落地）；01 票的投影直读仅保留给缓存/UI，注释里限定并标记
- [x] `npm run check` 全绿

## Answer

**改了什么**

- **vendor/（新增）**：vendored Neo CLI 单文件 bundle（`vendor/neo/bin/neo.js`，esbuild，yaml/@clack 全内联、零 node_modules）。**pin：`4ee1dcd`**（neo main：materialize fa37a6c + N2 library/domain 447ee80 + N3 role set 4ee1dcd，即 `default ∪ domain ∪ role` 三层装配）。可复现构建步骤、sha256、消费方约定（测试 `node bin/neo.js`；应用 `process.execPath` + **仅子进程 env** 设 `ELECTRON_RUN_AS_NODE=1`；NEO_HOME fixture；**materialize --out 含凭据副本 → 只落机器本地 data 目录，永不入 git**；**锁 dirty 宿主合同：角色写 → `update`/`use` 清脏 → `materialize`（materialize 永不清脏）——a03/a04 若触发角色写必须按这个顺序排**）都写在 `vendor/README.md`。绝不从 neo 的 live worktree 复制，只 `git archive <pin> | tar -x`。
- `src/host/academy/neo-cli.mjs`（新）：通往 vendored CLI 的唯一门。`runMaterialize` 跑 `materialize --role R --agent A --out D --json`，失败带退出码 + neo 自己的可读错误（`academy_cli_*` 错误码）。
- `src/host/academy/neo-mcp.mjs`（新）：读角色**全量** `mcp.yaml`（default ∪ role，role 胜；a01 缓存里只有摘要，密钥不进 SQLite）。**密钥只接受 `env:VAR`**：stdio env / http headers 里的任何字面 token/key 一律拒绝（`academy_mcp_invalid`，点名 角色/服务器/字段）；`resolveMcpEnv` 装配期从 AgentHost env 解析，缺变量 `academy_mcp_env_missing`。渲染三形态：pi `mcp.json`、codex `[mcp_servers.*]` toml 片段、dsh ACP `mcpServers`（按 agentclientprotocol zod 形状：stdio `{name,command,args,env:[{name,value}]}`，http `{type:"http",...,headers:[...]}`——已从安装的 DSH bin.js 核实）。
- `src/host/academy/assembly.mjs`（新）：装配器。**装配集合不自己算**——问 `neo materialize --json`（唯一规则源），员工侧只做镜像：`skills/<name>` junction(win)/symlink(POSIX) 直指胜者内容目录（解 staging 链接第一跳，不留 junction 套 junction）；角色删技能 → 员工槽位先断开、下次装配即解链，绝不落副本；desired 集合外只解链接、真实目录不动（`academy_slot_not_link` 拒绝而非吞数据）。MCP 写 `academy-mcp.json`（引擎无关规范件）+ pi 的 `<agentDir>/mcp.json`；无 MCP → 删掉旧件（引擎照常传空）。指纹 = `roleKey|engine|manifest.hash|mcp形态 sha`（**密钥值不进指纹**）。
- **装配时机（我的选择）**：**每次派工、引擎 open 之前**（run-manager `runFlow` 里新增 `assemble` 门，entry.cjs 注入装配器）。理由：确定性——每轮 run 都反映学院当下状态，招聘/换角色无需额外钩子；可测——失败（角色没了/env 缺/字面密钥）直接让 run 以可读错误码收尾、引擎根本不启动；已开的活会话靠指纹变化退休（run-manager 把指纹并进 `sessionFingerprints`，装配没变不白重启引擎）。预设/探针角色 → assemble 返回 null，字节级旧行为。
- **pi**：`noSkills: true` + `additionalSkillPaths=[<agentDir>/skills]`（否则 SDK 连 `~/.agents/skills` 一起读，串味）；装配出 `mcp.json` 时才挂内置 MCP 扩展（`pi.createMcpExtension()`）。
- **codex**：skills 就在 `$CODEX_HOME/skills`（CODEX_HOME=员工 agent 目录，零新路径）；`writeEngineConfig` 把 `academy-mcp.json` 渲进员工自己的 `config.toml`（`[mcp_servers.*]`），策略 hook 块原样共存。
- **dsh（拆共享 home，选「每员工 DSH_HOME」）**：`engines/dsh/home` 已死 —— 每员工一个 ACP 子进程，`DSH_HOME = engines/dsh/employee-<id>/agent`（技能链接就在 `DSH_HOME/skills`，三引擎同一布局），`DSH_AGENTS_HOME` 指向员工私有空目录屏蔽机器级 `~/.agents/skills`；`session/new`/`session/resume` 的 `mcpServers` 来自 `academy-mcp.json`（未装配 → `[]` 与今天一致）。`ensureDshProfile(dataDir, library, employeeId)` 逐员工落 cordis patch；服务层 boot/模型库变更不再写共享 profile（库指纹变化会在该员工下次 open 时重启其服务器并重生成）。
- `entry.cjs`：装配器接进 run-manager；`ELECTRON_RUN_AS_NODE=1` 只进 neo 子进程 env（不泄漏进 Electron 启动）。

**怎么验证**

- `npm run check`：typecheck×2 + **461 测试全绿**。
- 票面验收逐条：
  1. pi 只见 A 的技能：`test/pi-skills-live.test.mjs` 用**真 pi SDK** `DefaultResourceLoader`（与适配器同款参数）跑装配后的目录——加载集恰为 `{alpha-skill}`、每个 baseDir 都在员工根内；本机真实 `~/.agents/skills` 有技能，**负对照**（不设 noSkills）确实加载了全局技能，证明断言有牙齿。`test/pi-adapter.test.mjs` 钉住适配器传给 SDK 的选项与 MCP 扩展的门控。
  2. codex：`test/assembly.test.mjs`（engine=codex：skills 在 `$CODEX_HOME/skills`、junction 直指角色内容、`~/.neo` 内零副作用）+ `test/codex-adapter.test.mjs`（config.toml `[mcp_servers.*]` 与 hook 共存；无装配 → 无该段）。
  3. dsh：`test/dsh-adapter.test.mjs` 用脚本化假 ACP 服务器——两员工 → **两个独立进程、两个不同 DSH_HOME**（各自 employee-<id>/agent）+ 各自 DSH_AGENTS_HOME；共享 home 从未被创建；`session/new` 的 mcpServers 空/映射两态。`npm run e2e:14`（真 DSH desktop 二进制）在新 per-employee home 下 run/工单全绿。
  4. junction/symlink：lstat `isSymbolicLink`+readlink 直指角色/领域内容目录；角色删技能 → 槽位先成断链（仍是链接、无副本）、再装配后消失，`skills/` 目录空。
  5. MCP：`test/academy-mcp.test.mjs` 9 例（字面 token 在 env/headers 均被拒且可读、default∪role 合并、env 缺失可读报错、三引擎渲染形状）+ 装配器 3 例（pi 渲染件 / 拒绝阻 run / 无 MCP 不留件）。
  6. 装配集合现在 100% 由 vendored `neo materialize --json` 给出（domain 层技能也照镜：`source: domain:<域>`）；`neo-roles.mjs` 的直读只剩缓存/UI 用途且注释限定 + 保留 `TODO(materialize)` 标记。
- e2e 门：`npm run build:renderer`（TMP 指到 tmp/esbuild-tmp）✓；`npm run e2e:04` **PASS**；`npm run e2e:11` 分支上完整 **PASS** 过（run4），但该机此套有**既有抖动**：「探针点击丢失→status=unprobed 连锁」与「hook marker blockedLines=0」两种失败在未含 a02 的 main（033e9e8）上**逐字复现**（各抓过一次），非本票回归；证据在 `tmp/e2e11*.log`（gitignored）。
- **既有问题（非 a02，报 lead）**：`e2e:14` 的「员工 manifest=/改推理档」两检在 main 上同样红（a01 快照 v2 后 e2e-14 runner 还读旧字段）；`e2e:11` 的探针点击偶发丢弹建议后续加「未触发就补点」。

**判断点**

- **dsh 二选一选了「每员工 DSH_HOME」**：cordis 模型 patch 本来就长在 home 的 profiles 下，`customSkillDirs` 只是 profile 级配置喂目录列表——home 仍然共享，`DSH_HOME/skills`、profiles、会话都会互相可见，隔离修不干净；每员工 home 才是文件系统级的硬隔离（顺带每员工 sessions/renders 也隔离）。代价 = 一员工一 ACP 进程（可接受：本来就是每员工每引擎一套根）。
- **密钥在装配期解析落盘（员工私有件）而不是启动期注入**：pi 内置 MCP 扩展不展 `${VAR}`、codex `mcp_servers.env` 只吃字面值，neo 的「启动 env 注入」在这两引擎没有对接面；落盘位置全部在 per-employee agentDir（机器本地、dataDir 内，与 BYOK models.json 同一姿态），源头仍强制 `env:VAR`（字面 token 根本进不来）。
- 每次派工装配（而非招聘时一次性）：学院改技能/角色 → 下一轮自动生效；已开会话由指纹退休，不白重启引擎。
- `--out` 指成员 agent 目录下的 `neo-materialized/`（neo 拥有、幂等换出换入），员工槽位解第一跳直连真实内容，避免 junction 链；凭据副本因此只在 dataDir。
- 装配失败（角色已删、mcp 字面密钥、env 缺）让这次派工直接失败并给可读 code，而不是无声地少技能跑。
