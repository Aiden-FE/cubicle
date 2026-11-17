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
