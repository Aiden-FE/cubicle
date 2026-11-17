# a03 学院浮层 · worklog

- 2026-11-17 branch `ticket/a03-academy-panel` off main@889746c（含 lead 外部验收 README 同步）；票 Status → in-progress。
- lead 范围调整（neo 外部验收 ec020d9）：装配引擎侧 MCP 默认关（`CUBICLE_ACADEMY_MCP=1` 开，测试带旗标）；面板下发只做 domains/persona；materialize 导出的 models/settings 忽略；e2e 用临时 NEO_HOME。
- vendored CLI 冒烟（tmp/a03-probe，fixture home 用**原生 Windows 路径**；MSYS 风格 `/c/...` 会被 node 变成 `C:\c\...` 野目录——坑）：`add <abs-path> --domain demo -s '*'`（source 必须绝对路径，npx skills 上游要求）→ `create` → `role set --domains` →（`dirty:true`）→ `update` 清脏（锁 yaml 的 dirty 字段消失）→ `status --json`（未 init 的家目录 ok:false+errors；fixture 需种 config.yaml）。`role set --json` = {ok,role,dryRun,changed:[…],dirty,files}。
- T2 现形：门关上也挡不住 materialize 自己对 `env:VAR` 的存在性检查（角色 mcp.yaml 引用缺失 env → materialize exit 1）。记录进 Answer，门只管 Cubicle 侧读/渲/落盘。

## 提交
- WIP1: assembly MCP 门默认 OFF + 测试旗标化 + gate-off 新用例（assembly 11/11 绿）。
- WIP2: store academy_mark 表（本机/远端/手写 + 一次远端确认，跨重启）+ src/host/academy/panel.mjs（probe/snapshot/install/dispatch，锁 dirty 顺序 role set→update→投影刷新）+ service `academy.*` + ipc 白名单 + entry 接线；panel 门 10 例、store 2 例、service 信封 1 例全绿。
- WIP3: 渲染层「学院」左轨第五入口 + 浮层面板（列表/装/下发/一次确认/只读降级）+ CSS；typecheck×2 + 475 测试全绿；build:renderer OK（TMP 三连 export 到 tmp/esbuild-tmp）。

## 边界裁定（human ruling，2026-11-17 a03 会话中）
- Cubicle 侧对 neo 仓库**零权限**：不读、不进、不对 `C:\Users\Aiden\dev\aiden\neo` 跑任何命令（含只读）。neo CLI 合同一律以 cubicle 内为准：`vendor/neo/bin/neo.js`（pin 4ee1dcd 仍有效）+ vendor/README.md + .scratch/academy 票 Answers + `node vendor/neo/bin/neo.js <cmd> --help`。
- 本会话早前从 neo git 抽取的 tmp/a03-ref/*.ts 临时副本已删除（在 cubicle tmp/ 内、gitignored，仅为免混淆）。
- T1–T4 未来随 vendor re-pin 到货；`CUBICLE_ACADEMY_MCP` 保持默认 OFF + TODO(T1-T4)。
- lead 会往本分支提交两个文档文件（neo-tickets 补丁 + map 注记）：不审计、不还原，`git add` 显式路径绕开。

