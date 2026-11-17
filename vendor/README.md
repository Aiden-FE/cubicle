# vendor/ — 内置的 Neo CLI（vendored Neo CLI）

Cubicle 只读 `~/.neo` 文件、通过 **Neo CLI** 做装配计算（决策：`.scratch/academy/map.md`
「Neo CLI 是 `~/.neo` 的唯一写者；Cubicle vendor 该 CLI」）。公共 npm 上的
`@compass-aiden/neo@0.2.8` **不含** `materialize` 命令，所以从 neo 仓库的固定 commit
可复现地构建一份单文件 bundle 放在这里。

## 当前内容

| 文件 | 说明 |
|---|---|
| `neo/bin/neo.js` | esbuild 单文件 bundle（ESM，node22 target，运行时依赖 `yaml` / `@clack` 全部内联；零 node_modules）；sha256 `d2409ef584bf0cef6d233766e1e7563e37323fe427bbbea843b368ffde668869` |

## 钉住的来源

- 仓库：`C:\Users\Aiden\dev\aiden\neo`（github.com/Aiden-FE/neo）
- **pin：`4aebbde7a0fc5c2043ee9ddc3a3b2147062acb82`**（main 上包含 `materialize` 的最新提交；`fa37a6c` 是 materialize 的 squash 提交，`4aebbde` 只在其后追加文档）
- 版本：0.2.8

## 怎么重新构建（可复现步骤）

绝不从 neo 的**live worktree** 复制 —— 它可能被并发编辑；只从 git 对象取固定 commit。

```bash
# 1) 取固定 commit（git archive 只读，不 checkout）
mkdir -p tmp/neo-vendor-build
git -C /c/Users/Aiden/dev/aiden/neo archive 4aebbde | tar -x -C tmp/neo-vendor-build

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
- `materialize --out` 的产物含 **auth 凭据副本**（convergeRoot 原生行为）——产物只准落在
  机器本地的 data 目录（`CUBICLE_DATA_DIR`），永不入 git。
