# a03 学院浮层 · worklog

- 2026-11-17 branch `ticket/a03-academy-panel` off main@889746c（含 lead 外部验收 README 同步）；票 Status → in-progress。
- lead 范围调整（neo 外部验收 ec020d9）：装配引擎侧 MCP 默认关（`CUBICLE_ACADEMY_MCP=1` 开，测试带旗标）；面板下发只做 domains/persona；materialize 导出的 models/settings 忽略；e2e 用临时 NEO_HOME。
- vendored CLI 冒烟（tmp/a03-probe，fixture home 用**原生 Windows 路径**；MSYS 风格 `/c/...` 会被 node 变成 `C:\c\...` 野目录——坑）：`add <abs-path> --domain demo -s '*'`（source 必须绝对路径，npx skills 上游要求）→ `create` → `role set --domains` →（`dirty:true`）→ `update` 清脏（锁 yaml 的 dirty 字段消失）→ `status --json`（未 init 的家目录 ok:false+errors；fixture 需种 config.yaml）。`role set --json` = {ok,role,dryRun,changed:[…],dirty,files}。
- T2 现形：门关上也挡不住 materialize 自己对 `env:VAR` 的存在性检查（角色 mcp.yaml 引用缺失 env → materialize exit 1）。记录进 Answer，门只管 Cubicle 侧读/渲/落盘。

## 提交
- WIP1: assembly MCP 门默认 OFF + 测试旗标化 + gate-off 新用例（assembly 11/11 绿）。
