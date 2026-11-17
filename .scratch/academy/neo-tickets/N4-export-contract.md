# N4: neo materialize 导出合同修补(交接记录,reference material)

**Type:** handoff / 记录 · **Status:** handed-off · **对应 neo 票:** academy `04-export-contract`

> 定位:Cubicle 侧只向 neo 项目**开票**;实现由 **neo 项目的合法并行会话**执行。本文件与
> [`N4-export-contract-handoff.patch`](N4-export-contract-handoff.patch)(`format-patch 00eedd6..e66282a`,2 个提交)
> 都是 **Cubicle 侧留存的参考材料**,不是我方合并动作。neo 侧 main 上已有 `25964c5`/`e66282a`
> 两个提交(含票面收尾文档),**原样保留,由 neo 项目自行对账/改写**,本侧不再触碰 neo。

**目标(review 2026-11-17 裁定,推荐选项已采纳):** 让外部宿主(Cubicle)能在「不携带密钥、
不依赖导出进程 env、不重复模型配置」的前提下消费 `neo materialize`。

## 合同项

- **T1** `--json` 清单增 `mcp.envRefs = { "<server>": { "<KEY>": "<VAR>" } }`(引用形状,不落值;
  两次调用逐字节一致;无 MCP 时 `{}`)。采「清单带引用」方案,`mcp.json` 渲染层不动。
- **T2** env 存在性校验只属于 `run`(convergeRoot 新 `strictEnv`,缺省 true=run 语义零变化;
  materialize 恒 false;模型引用照常渲染 `$VAR` 插值;非 Claude http header 能力闸与 strict 无关恒抛)。
- **T3** `--no-auth` **opt-in** 排除 auth 凭据副本,清单 `authExcluded: false/true`(入 hash);
  缺省保持票 01 同形(auth 副本照旧,diff-equal 判据未改)。**Cubicle 契约:恒传 `--no-auth`。**
- **T4** `--agent-models` → 透传 `skipModels`;清单 `model: { file: null, owner: "host", reason }`
  (owner "neo"/"host";reason 三枚举:agent-models / no-neo-model-declaration / agent-has-no-model-file)。
- **T5** `--help` 写入 `--out` 独占契约(MUST be a dir owned by this command / dedicated subdir /
  never an existing agent config root);`--no-auth`/`--agent-models` 进帮助。
- T6(review 观察项)只记录不实现;合同形状:`mcp` 维持对象(与 N1 草稿数组形状的偏差维持原 review 结论)。

## 两个提交的内容摘要(patch 内全文)

- `25964c5` — feat(materialize):全部实现+squash。源分支 `academy/04-export-contract@2476fe0` +
  后续清理(`.gitignore` 补 `tmp/`;roots.ts 注释)。改动 11 文件:+`collectMcpEnvRefs`/
  `resolveMcpEnv strict`/`resolveModelEnv strict`/`convergeRoot strictEnv·skipAuth`/
  `materializeRoot skipModels·noAuth` + CLI flag 与帮助 + 测试(core materialize T1–T4、mcp envRefs/strict、
  CLI T2/T3/T4/help)+ `docs/schema/neo-home.md` §9.1。
- `e66282a` — docs(academy):neo 票 04 勾验收 + `## Answer`、review 处置记录、spec 执行记录一行。纯文档。

## 验证证据(交接时点)

- `pnpm verify` 全绿两次:`academy/04-export-contract@2476fe0` 与 `main@e66282a`(2026-11-17 18:35,
  40 文件 / **650 测试** / 版本 lockstep 0.2.8;基线 641,+9)。
- 手打 E2E(临时 NEO_HOME 在 neo 仓库 gitignored `tmp/`,已清理):manifest 两次逐字节一致;缺省 auth
  照旧、`models.json` 落 `$FAKE_KEY` 不落值;`--no-auth --agent-models` 面全空 + `owner:"host"`;
  `run` 缺 env 照旧 exit 1 原报错。

## neo 项目可保留/可改写

- 实现语义(T1–T5 各项的缺省与 flag 行为)是票面合同,**建议保留**;代码落点/命名/测试组织可自由改写。
- 兼容性红线不变:不带新 flag = 票 01/02/03 行为逐字节不变;`run` 校验面不变。
- 已知遗留(交 neo 项目决断):悬空对象 `ca263ed`(曾混入 `tmp/` 复现残骸,含一处临时 auth 副本)
  无分支引用,可 `git gc --prune=now`;neo 真实 `~/.neo` 曾被一次 `NEO_HOME` 为空的 `run` 读取
  (模型前置闸即 exit 1,判断未写,请核验)。

## Cubicle 侧影响

- Cubicle 02 票消费面:`materialize --no-auth --agent-models --json` → 技能链接 + `mcp.envRefs`
  自行注入 + 模型全由我方 14 票模型库供给;MCP 路不再需要保持空。
