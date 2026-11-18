# a04 worklog — e2e:15 正反断言（+ vendor re-pin 894e5bf + MCP envRefs 合同）

分支 `ticket/a04-e2e-15`（从 main tip `8d1d9c3`，含 a03）。票面：`.scratch/academy/impl/04-e2e-15.md`。

## 进展

- 19:38 读 SCOPE/AGENTS/README/02/03 Answers/vendor README/票 04；认领票（in-progress）。
- 19:41 **STEP 1 vendor re-pin 完成**：`git archive 894e5bf | tar -x` → tmp/neo-vendor-build；
  依赖版本与旧 pin 相同（yaml@2.9.1、@clack/prompts@1.9.0，catalog/lock 核对过）；esbuild 单文件 bundle
  （TMP 三连指 `tmp/esbuild-tmp`）→ `vendor/neo/bin/neo.js`，sha256 `fadfa65c…195fc0`。
  `materialize --help` 实测确认 `--no-auth`（authExcluded）/`--agent-models`（model.owner=host）。
- 冒烟（fixture NEO_HOME，GITHUB_TOKEN 不设）：
  - manifest：`mcp.envRefs={github:{GITHUB_TOKEN:"GITHUB_TOKEN"}}`、`model{file:null,owner:host,reason:agent-models…}`、
    `authExcluded:true`、导出根无 auth.json/models.json（skills/ + root.json + mcp.json）。
  - **导出面对 stdio env 引用不再要求变量存在**（旧 T2 已修）。
  - 新发现：http headers 的 `env:VAR` 引用对 pi/codex/dsh 在 **导出面直接报错**（neo 判定这些 agent 不会展引用）。
    Cubicle 渲染自家引擎配置时自行解析，不受阻；已在 vendor/README 落档，若 lead 认为该闸应放开再开 neo 交接票。
- 旧单测（assembly 15 + academy-mcp 9 + academy-panel 6）在新 bundle 上 **30/30 绿**（re-pin 无回归）。

## 判断预告（STEP 2/3）

- 装配恒 `--no-auth --agent-models --json`；测试断言员工根内无 auth.json、neo 模型件不渲染、清单 model/authExcluded 形状。
- MCP 引用改从 manifest `mcp.envRefs` 读（装配写**引用形态**的 academy-mcp.json，密钥不落盘）；
  **密钥值在引擎启动时由 Cubicle 注入**：pi adapter open 时渲 `<agentDir>/mcp.json`（解析后）、codex open 渲 config.toml、
  dsh session/new 内存注入；env 缺失 = 启动期可读失败（装配期不要求）。字面密钥拒绝闸保留（mcp.yaml 读侧）。
- 默认门：链绿则翻 ON（`CUBICLE_ACADEMY_MCP=0` 留紧急关闭）。

## STEP 2（装配/MCP 新合同）完成，seam 测试 42/42 + 全量 check 481 绿

- `neo-cli.mjs`：`runMaterialize` 恒传 `--no-auth --agent-models --json`；manifest typedef 带 envRefs/authExcluded/model.owner。
  新 `test/neo-cli.test.mjs`：stub CLI 录 argv，钉死三个旗标 + host 字段。
- `assembly.mjs`：MCP 默认 **ON**（`CUBICLE_ACADEMY_MCP=0` 才关）；读 mcp.yaml（字面密钥闸保留）后与 manifest
  `mcp.envRefs` **交叉核对**（`academy_mcp_refs_mismatch`）；canonical `academy-mcp.json` 写 **v2 引用形态**
  （密钥值不落盘）；pi 的 `mcp.json` 不再由装配写（改引擎 open 渲）。
- 启动注入（三引擎）：pi adapter open 时解析 env:VAR→渲 mcp.json→挂扩展，缺密钥 `academy_mcp_env_missing` 拒开；
  codex open 解析→config.toml；dsh session/new 解析→ACP。共用 `neo-mcp.mjs` 新增 `readAcademyMcpDocSync`
  （缺→null、坏 JSON→academy_mcp_invalid、v2 引用透传）。
- 测试改写：assembly（refs-on-disk / --no-auth+--agent-models 下员工根无 auth/models/settings / 字面密钥拒 / =0 opt-out）、
  pi-adapter（open 注入 + 陈旧 mcp.json 清除 + 缺密钥 fail-fast）、codex-adapter（refs→toml + 缺密钥拒）、
  dsh-adapter（refs→ACP 值）、academy-mcp（reader 4 例）。旧 T2 记录测试已换成新合同断言。
- 冒烟（tmp/e2e15-smoke）：fixture 链 create→装(library 落盘)→role set --domains→update 收敛→materialize
  全绿；skills source=domain:demo；pi MCP 扩展对秒退 stdio 服务器容错（ready.catch），e2e 可带真实 MCP 条目。
- `npm run check`：typecheck×2 + **481 测试全绿**。

## STEP 4 e2e:15 —— PASS（并挖出一个 Neo 缺陷 N5 + 一个本机 junction 大坑）

- 新增 `scripts/e2e-15.mjs`（fixture 装/下发 + mock 原始请求正反断言 + ~/.neo 指纹）
  + `scripts/e2e-15-runner.mjs`（招聘×2 → 派活×3(含第二张工单) → 文件层/MCP 断言）
  + package.json `e2e:15`；共享 mock server 增 `raw`（请求体全文留档）。
- **本机坑（实录）**：electron 内创建的 junction 带 `\??\Global\` 重解析数据，node 的
  lstat/readlink 把它报成普通目录、readlink EINVAL、`fs.rmdir` 会**跟进目标删数据**。
  → 装配器 `resolveFirstHop`（readlink→realpath 双门）+ `unlinkOnly` 对不可见链接改走
  `cmd /c rmdir`（只删链接）；重派同一员工不再炸 `academy_slot_not_link`（e2e 派活×2 钉死）。
- **Neo 缺陷 N5**（vendored 894e5bf，electron-as-node）：同一 `--out` 第二次 materialize，
  neo 换出旧 out 的删除路径按普通目录递归钻进 staged junction，**清空学院内容**
  （实测 `library/demo/academy-marker/SKILL.md` 第二次后消失；e2e 首轮抓到「上下文(正)」红）。
  交接票 `.scratch/academy/neo-tickets/N5-materialize-junction-eats-content.md`（只含现象/复现/期望/影响）。
- **Cubicle 侧缓解**（neo 根治前不可撤）：`src/host/academy/link-safe-remove.mjs`——
  装配每次 materialize 前先按链接安全门自清旧 out（node 可见链接 unlink/rmdir；
  不可见 junction 走 cmd rmdir），neo 永远不会再经它的危险删除面。单测 `test/link-safe-remove.test.mjs`。
- e2e:15 输出全绿（招聘/派活×3/文件层正反+卫/MCP 正反/上下文正反+卫/~/.neo 隔离指纹），报告在
  `tmp/e2e-15/{flow,summary}.json`。


