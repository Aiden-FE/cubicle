# 发布流程（Cubicle）

> 与 Neo 仓库同风格：一次 tag 触发 CI 完成「校验 → 打包 → GitHub Release」。
> 打包决策沿用票 13：**dir 便携目录 + zip 资产**，不做安装器、v1 不签名。

## 版本与 tag

- 唯一版本源：`package.json` 的 `version`（semver）。
- tag 规范：`v<version>`（例如 `v0.1.0`）。**tag 必须与 package.json lockstep**，CI 里
  `release.yml` 的 verify 会硬校验（不一致直接红）。
- 语义：破坏应用数据目录兼容 → minor 起步自行说明；milestone/feature → minor；修 → patch。

## 发一次版

```bash
# 1) 改版本（单独提交）
npm version patch --no-git-tag-version   # 或手工改 package.json
git add package.json && git commit -m "chore(release): 0.1.1"

# 2) 走 PR 合入 main（CI 绿是前置）

# 3) 打 tag 并推送 → 自动发布
git tag v0.1.1
git push origin v0.1.1
```

`workflow_dispatch` 用于重跑发布：它按**当前 main** 构建、把资产挂到输入的 tag 上
（重出旧包请用对应 tag 的 push 触发或分支回退后 dispatch）。

## CI 做什么（`.github/workflows/release.yml`）

1. **verify**：lockstep 校验 + `npm run check`（typecheck×2 + 单元测试）+ `build:renderer`。
2. **build-windows**：`electron-builder --win --dir` → `Cubicle-win-x64.zip`。
3. **build-macos**（x64，Intel；未签名）：`electron-builder --mac --x64 --dir` → `Cubicle-mac-x64.zip`。
4. **release**：GitHub Release，notes = 自上个 tag 的提交列表；资产 = 两个 zip。
   源码 tar.gz/zip GitHub 自动生成（Source code）。

**GUI e2e（`e2e:NN`）不在 CI**：要真实 Electron 会话与本机引擎，验收在本地做——
发版前的本地验收命令见下。

## 发布物的验收

| 平台 | 怎么跑 | 判据 |
|---|---|---|
| Windows | 解压 zip，`cubicle.exe`（或 `Start-Cubicle.ps1`） | 办公室画面 + 左轨五入口；学院浮层可开；数据落 `%APPDATA%\cubicle` |
| macOS Intel | 解压，首次运行去 quarantine（未签名），macOS Ventura+ | 同上；细节见 [release-mac-intel.md](release-mac-intel.md) |

发版前本地（Windows）跑：

```bash
npm run check
npm run build:renderer && npm run e2e:15   # 学院全链路正反断言
npm run package && node -e "const fs=require('fs');const p='dist/package/win-unpacked/resources/app.asar';console.log(fs.existsSync(p)?'asar ok':'MISSING '+p)"
```

打包内 vendored neo CLI 在 `app.asar` 里（`files: vendor/neo/**/*`）；运行时以
`ELECTRON_RUN_AS_NODE` 子进程加载（asar-aware fs）。若改动该路径，改 `entry.cjs` 的
`neoCliEntry` 并同步 `vendor/README.md`。

## 已知边界

- **未签名 / 未公证**：macOS 首次运行要手动放行；Windows SmartScreen 可能警告。v1 自用接受，
  签名/公证属「分发与更新」雾区（wayfinder map）。
- 自动更新、崩溃上报：未做（同上雾区）。
- mac 构建只出 **x64**（验收机是 Intel）；要 arm64 时在 `release.yml` 的 mac 任务加
  `--arm64` 并改资产名。
