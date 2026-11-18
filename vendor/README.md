# vendor/ — 内置的 Neo CLI（vendored Neo CLI）

Cubicle 只读 `~/.neo` 文件、通过 **Neo CLI** 做装配计算（决策：`.scratch/academy/map.md`
「Neo CLI 是 `~/.neo` 的唯一写者；Cubicle vendor 该 CLI」）。公共 npm 上的
`@compass-aiden/neo@0.2.8` **不含** `materialize` 命令，所以从 neo 仓库的固定 commit
可复现地构建一份单文件 bundle 放在这里。

## 当前内容

| 文件 | 说明 |
|---|---|
| `neo/bin/neo.js` | esbuild 单文件 bundle（ESM，node22 target，运行时依赖 `yaml` / `@clack` 全部内联；零 node_modules）；sha256 `1bce8294bd014b6c2801d91e030c05ce1f02b25aa8ca5783deddf1fc7b7c1e00` |

## 钉住的来源

- 仓库：`C:\Users\Aiden\dev\aiden\neo`（github.com/Aiden-FE/neo）
- 规则：**vendor 只准钉 neo 的已发布 release tag**（与 npm 同步发布；桥接钉 main 仅限发版前窗口，必须记作废条件）。
- **pin：`v0.2.9`**（Neo 已发布，npm `@compass-aiden/neo@0.2.9`；academy 01–04 + 票 05 链接安全 + rename-aside/readdir 可见性重构）。相对 `894e5bf` 的行为变化：
  `materialize` 换出/清理不再跟进 electron 不可见 junction（N5），Cubicle 装配前「自清旧 out」缓解已随该链移除；
  链接删除终态设计：改名隔离为主（免 spawn、平台保证、目标零接触）+ readdir 可见性判据（幽灵重解析点 lstat 谎报不存在）+ 经典门兜底（绝不 /s、-Recurse）。
  三轮 GH-runner 实录证明没有任何单一删除门在所有 Windows 镜像上可靠（cmd 拒断链 / .NET 穿过活 junction / Remove-Item 弹提示与 NullRef——失败均安全不删）。
- 历史 pin（全部作废）：`0ce6156`/`30bf083`/`b0767f9`（门枚举时代的 main 桥接）；`894e5bf38150fbf664c6703003add208b93bd084`（lead 恢复并逐项复验的 academy 01–04。
  相对旧 pin 的导出合同变化：`materialize` 新增 `--no-auth`（不导出凭据副本；清单 `authExcluded:true`）
  与 `--agent-models`（不渲染 neo 模型配置；清单 `model:{file:null,owner:"host",reason}`）；
  清单 `mcp.envRefs` = server→配置键→变量名（**只有引用、不含值**，宿主在引擎启动时自行注入）；
  **导出不再要求被引用的 env 变量存在**（旧 T2 硬失败已修）。已知能力闸：stdio env 引用可导出，
  http headers 的 `env:VAR` 引用对 pi/codex/dsh 在导出面直接报错（neo 判定这些 agent 不会展引
  用；claude-code 例外走 `${VAR}`）——Cubicle 渲染自家引擎配置时自行解析这些引用。
- 版本：0.2.9
- 历史 pin：`4ee1dcd68d4692d5f299fa7dc0a048c985d1776b`（票 01 materialize `fa37a6c` + 票 02 library/domain
  `447ee80` + 票 03 role set 的 squash；无 `--no-auth`/`--agent-models`，引用 env 缺失时导出硬失败 —— a04 re-pin 后作废）；
  `4aebbde`（只含 materialize，不认 domain 层 —— N2 落地前使用，已作废）

## 怎么重新构建（可复现步骤）

绝不从 neo 的**live worktree** 复制 —— 它可能被并发编辑；只从 git 对象取固定 commit。

```bash
# 1) 取固定 commit（git archive 只读，不 checkout）
mkdir -p tmp/neo-vendor-build
git -C /c/Users/Aiden/dev/aiden/neo archive b0767f9 | tar -x -C tmp/neo-vendor-build

# 2) 装 bundle 所需运行时依赖（版本钉死自 neo 的 pnpm-lock；archived 根 package.json
#    带 pnpm workspace: 协议 npm 吃不下，所以装到干净目录再拷 node_modules）
mkdir -p tmp/neo-deps && cd tmp/neo-deps && npm init -y
npm install yaml@2.9.1 @clack/prompts@1.9.0
cp -r node_modules ../neo-vendor-build/node_modules

# 3) esbuild 单文件 bundle（workspace 的 core 用 --alias 直接指向 TS 源）
cd ../neo-vendor-build
node ../../node_modules/esbuild/bin/esbuild packages/cli/src/index.ts \
  --bundle --platform=node --format=esm --target=node22 \
  --alias:@compass-aiden/neo-core=./packages/core/src/index.ts \
  --banner:js="import{createRequire as __createRequire}from'node:module';const require=__createRequire(import.meta.url);" \
  --outfile=neo-bundle.mjs

cp neo-bundle.mjs ../../vendor/neo/bin/neo.js
```

（`--banner` 的 `createRequire` 是必需的：bundle 里 yaml 的 CJS 代码会 `require("process")`。）

## 消费方约定（Cubicle 侧）

- 测试里直接 `node vendor/neo/bin/neo.js …`；应用里（AgentHost）用 `process.execPath` +
  **仅在该子进程 env** 里设 `ELECTRON_RUN_AS_NODE=1`（绝不泄漏进 Electron 启动）。
- `NEO_HOME` 环境变量控制 neo 的家目录；测试一律用 `tmp/` 下的 fixture，绝不读写真实 `~/.neo`。
- Cubicle **恒传 `--no-auth --agent-models --json`**：导出面没有凭据副本（`authExcluded:true`）、
  没有 neo 模型配置（模型唯一来源仍是 Cubicle 模型库）。`--out` 产物仍只准落在机器本地的
  data 目录（`CUBICLE_DATA_DIR`），永不入 git。
- MCP 密钥合同（b0767f9）：neo 导出只给 `envRefs` 引用；密钥值由 **Cubicle 在引擎启动时**
  从 AgentHost 环境解析注入（pi 的 `mcp.json` / codex 的 `config.toml` 落的是解析后的值，
  dsh 走 ACP `session/new` 内存注入）。装配期不要求密钥变量存在；启动期缺失 = 可读失败。
- **锁 dirty 顺序（宿主合同）**：角色写入（`neo role set`）会把角色锁标 dirty；清脏只发生在
  `neo update` / `neo use --global`，`materialize` 永不清脏。装配流形的正确顺序是
  （可选角色写入 →）`update`/`use` → `materialize`。Cubicle 的 02 票不写角色，只消费这个顺序；
  a03（下发面板）/a04（e2e:15）若触发角色写，必须按此顺序排。
