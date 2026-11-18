# 发布说明 · Mac Intel 验收（2026-11-18）

> 目标：在没有 Windows 专有环境（沙箱降级、`cmd.exe`、junction）的机器上，复核员工学院 effort 的
> 交付物能独立跑通。Cubicle 是 Electron 应用；本页只覆盖**开发态验收**（`npm run check` +
> `e2e:15` + 可选 `npm start`），不含签名/公证的安装包。

## 0. 环境要求

| 项 | 要求 |
|---|---|
| macOS | **Ventura (13) 或更高** —— Electron 45.2.1 官方只提供 Ventura+ 的 Intel / Apple Silicon 构建 |
| 架构 | Intel x64 可用（Electron 45 仍发 x64 构建） |
| Node | ≥ 22.19（`node -v` 自查；Electron 内嵌 Node 与本机 Node 无关，但脚本用本机 Node） |
| 包管理 | npm（仓库用 npm；Neo 仓用 pnpm@11.7.0） |

## 1. Cubicle（必验）

```bash
cd cubicle
npm install
npm run check                # 期望：# tests 485 / # pass 485 / # fail 0
npm run build:renderer
npm run e2e:15               # 期望：PASS · ticket a04 acceptance
```

`e2e:15` 的判据（失败会按阶段点名「装 / 下发 / 招聘 / 上下文 / 文件层 / MCP」）：

- 正向：主员工的模型请求上下文含 `ACADEMY-7`；
- 反向：对照角色员工的上下文不含，且其引擎根无该技能；
- 文件层：技能槽是**链接**不是副本；
- MCP：canonical 只有 `env:VAR` 引用，open 后 pi 的 `mcp.json` 才带解析值；对照员工两者皆无；
- 隔离：真实 `~/.neo` 的 mtime/内容前后不变（fixture 走 `tmp/e2e-15/neo`）。

可选，看界面：

```bash
npm start        # 打开办公室；左轨第五入口 = 学院，空态/建公司流程与 Windows 一致
```

**macOS 上不需要 `CUBICLE_DATA_DIR`**（那是 Windows 安全策略的坑）；默认数据在
`~/Library/Application Support/cubicle`。清库：删掉该目录即可。

## 2. Neo（可选，验证装配层）

```bash
cd neo
corepack enable && corepack prepare pnpm@11.7.0 --activate   # 或已装 pnpm 11.7.0
pnpm install
pnpm verify                  # 期望：41 文件 / 655 测试 / lockstep 0.2.8
```

手工复核导出合同（临时 `NEO_HOME`，**不要碰真实 `~/.neo`**）：

```bash
export NEO_HOME="$PWD/tmp/verify/neo"
mkdir -p "$NEO_HOME/roles/demo/skills/a"
printf 'MARKER\n' > "$NEO_HOME/roles/demo/skills/a/SKILL.md"
printf 'persona\n' > "$NEO_HOME/roles/demo/AGENTS.md"
node packages/cli/bin/neo.js materialize --role demo --agent pi \
  --out "$PWD/tmp/verify/out" --no-auth --agent-models --json
```

期望 `--json` 含：`skills[].hash`、`mcp.envRefs`（无 MCP 时 `{}`）、`model.owner:"host"`、
`authExcluded:true`；`out/` 里没有 `auth.json`、没有 `models.json`。同命令跑第二次不应删掉
`SKILL.md`（N5 回归）。

## 3. 已知平台差异（不是缺陷，验收时请按此项判读）

- `link-safe-remove` / `link-safe` 的 `cmd /c rmdir` 分支**只在 win32** 生效；macOS 走 `unlink`。
  e2e:15 的链接断言在 macOS 上仍应通过（链接形态是 symlink）。
- 预设角色的工具白名单里含 `powershell`（Windows 本机 pi 的跑命令工具）。e2e 用 mock 模型，
  不触发真实工具；若在 Mac 上**真实派工**，该白名单可能需要按平台调整——属既有角色预设的
  Windows 偏向，不在本次 effort 范围。
- `TMPDIR/TEMP/TMP` 指到仓库内是 Windows 的 esbuild/实时防护坑；macOS 不需要。

## 4. 回传什么

```bash
uname -m && sw_vers -productVersion
npm run check 2>&1 | tail -8
npm run e2e:15 2>&1 | tail -20
cat tmp/e2e-15/summary.json   # 若有
```

## 5. 本次发布对应提交

| 仓 | 提交 | 内容 |
|---|---|---|
| Cubicle | `3cb183d`（tag `academy-2026-11-18`） | 学院 a01–a04 + MCP 加固 + vendor 重钉 `b0767f9` |
| Neo | `b0767f9`（tag `academy-2026-11-18`） | academy 01–05（materialize / library+domain / role set / 导出合同 / 链接安全删除） |
