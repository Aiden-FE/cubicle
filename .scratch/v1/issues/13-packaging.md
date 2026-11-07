# 13: 打包

**What to build:** 产出 Windows 安装包，干净机器可启动；单实例锁生效；应用数据目录正确创建。

**Blocked by:** 08, 09, 12

**Status:** done

- [x] 安装包在干净目录能启动并显示办公室
- [x] 单实例锁生效（重复启动不出现第二个窗口）
- [x] 应用数据目录按预期创建（数据库 / artifacts / engines）
- [x] 退出与卸载后不留孤儿进程
- [x] 关于页显示版本号

## Answer

**完成（2026-11-08）。** 一条命令复现验收：

```powershell
npm run build:renderer
npm run package          # electron-builder --win --dir
npm run e2e:13           # 需本机 codex-cli（ledger 阶段验打包形态的进程账本）
```

### 打包方案：1（electron-builder）成功，dir 形态 + 复制式安装

`electron-builder 26.18.0`（devDep，新增）+ `electron-builder.yml`：`asar: true`、files 白名单（src/ · dist/renderer/ · scripts 里的验收装置 · package.json）、生产依赖（pi SDK / react / react-dom）自动进包、`executableName: cubicle` → `cubicle.exe`、版本 metadata 直接取 package.json（本轮把 version 从 0.0.0 提到 **0.1.0**）。产物 `dist/package/win-unpacked/`（**455.3 MB**）。

**网络实况**：票面指定的 Clash 代理 `127.0.0.1:7890` 当时没在监听（ECONNREFUSED，已如实记录）；改走 npm 既有 registry **npmmirror 直连**装依赖成功，electron-builder 下载 electron 45.2.1 二进制直连也成功过一次，之后 GitHub 出现 ETIMEDOUT——补上 `ELECTRON_MIRROR` / `ELECTRON_BUILDER_BINARIES_MIRROR`（npmmirror 镜像）后稳定。**没有 nsis/portable**：本机的安全策略拒绝 electron.exe 写工作区外（%LOCALAPPDATA% / %TEMP% 都是死路），装了也起不来；dir 形态 = 把 win-unpacked 整目录复制进干净目录即「安装」，卸载 = 删目录，语义与验收一致（这也是票面方案 2 的释放形态，只是打包器换成了 electron-builder）。

### 「干净机器」= 本机近似的「干净目录」（验收口径如实）

安装 = 复制 win-unpacked → `tmp/pkg-clean/app`（install.json 记大小）；启动设 `CUBICLE_DATA_DIR=tmp/pkg-clean/data`。真实干净机器的差异只剩「数据目录默认 %APPDATA%\cubicle 可写」这一条（02 票 defaults 阶段已证解析正确）。

### 五条验收逐条证据（`tmp/e2e-13/*.json`）

1. **干净目录能启动并显示办公室**：boot 阶段经**随包的 `Start-Cubicle.ps1`** 起 `cubicle.exe`，办公室 4 工位 **718ms** 出现、AgentHost 在线（验收 1）。launcher 现场证明打包形态的 `--no-sandbox` 降级：首跑 `0x80000003`（沙箱起不来）→ 恰好一次重试 → `finalExitCode 0`（launcher-boot.json `sandboxCrash:true`）。
2. **单实例锁**：`app.requestSingleInstanceLock()` 以 userData 为键（路径解析之后、任何文件写入之前）；副本 **75-88ms 退出码 0**，主实例只收到 second-instance 交接（把既有窗口还原+聚焦），**窗口数恒为 1**（second-instance.json 一手证据 + 主实例 `BrowserWindow.getAllWindows().length=1`）。决策 seam `src/main/single-instance.mjs` 先写 node:test（6 例：角色判定 / 最小化先还原 / 销毁中的窗口诚实 no-op）。
3. **数据目录按预期创建**：新增契约 `src/shared/data-layout.mjs`（cubicle.db + artifacts/engines/renders 的唯一主人，openStore 按它建、e2e 按它查，产品与验收不可能漂移）；boot 现场 missing=**[]**。
4. **退出与卸载不留孤儿**：每阶段退出后用 PowerShell CIM 按 **名字 + 路径**（cubicle.exe/electron.exe ∧ 安装路径；codex.exe ∧ 命令行含本次目录）断言 0。**账本清扫在打包形态生效**：ledger 阶段真 codex.exe 在飞（按 host pid 采样 peak=1）时走生产退出路径（supervisor.stop → host.shutdown → CLI 宿主 taskkill /T /F）→ 退出后 codex 残留 **0**；卸载（删安装目录）后 packaged 进程 **0**、codex **0**；数据目录保留（升级/重装不丢办公室）。
5. **关于页版本号**：左轨「关于」入口 → 浮层显示 `app.getVersion()`（= exe metadata）；boot 三方对表全一致：磁盘 package.json（编排器包外独立读）= IPC 对表（app.getVersion ∧ asar package.json，mismatch:false）= 关于页 DOM `0.1.0`。版本读取是纯 seam `src/main/app-version.mjs`（坏 JSON 诚实 null、漂移 mismatch=true 且警示徽章上卡）。

### 打包形态的环境坑（增量）

- **随包启动器 `Start-Cubicle.ps1` 必须 ASCII**：Windows PowerShell 5.1 把无 BOM UTF-8 按 GBK 解码，中文注释能炸出语法错误（e2e 现场实录）；判据是 `scripts/sandbox-degrade.mjs` 的逐字镜像（PS 不能 import ESM；两处判据漂移会被 e2e 抓）。它同时防御性删除 `ELECTRON_RUN_AS_NODE`（双击启动也可能是脏环境）。
- PS 里 `[uint32]$负数` 直接抛（先 `-band 0xFFFFFFFF`）；`-File` 模式下 `--cubicle-e2e` 会被当参数名（编排器用 `-Command` + `@()` 数组）；PS 5.1 `Set-Content -Encoding UTF8` 带 BOM 会炸 JSON.parse（证据文件用 ASCII）。
- electron-builder 打包**不要跑 `asar extract-file <archive> package.json`**——它会把解出物写进仓库根目录，覆盖 package.json（本会话踩过一次，已从 lockfile 恢复）。
- 本机 GitHub 不稳时用 `ELECTRON_MIRROR` / `ELECTRON_BUILDER_BINARIES_MIRROR`（npmmirror）。

### 架构落点

- **单实例锁、版本对表、数据清单都是纯 seam + 主进程薄接线**：`main/single-instance.mjs` / `main/app-version.mjs` / `shared/data-layout.mjs` 共 23 例 node:test；锁与三方版本一致、账本清扫、卸载断言只有打包 e2e 能验 → `e2e-13.mjs`（编排器，包外）+ `e2e-13-runner.mjs`（进包，在 asar 内驱动真实窗口/表单/service，复用 e2e-harness 与 11 票的 mock 基建）。
- **关于页走 main 自己的 IPC**（`ipcMain.handle("cubicle:app-info")` + preload `appInfo()`）：窗口与偏好是 main 的业务，不污染 AgentHost 信封总线；桥仍只传纯对象。
- **dev 路径不受扰**：e2e:04 回归绿（锁以 userData 为键，各票数据目录不同 + 阶段串行）。

### 已知边界（留给后续）

- 安装包未签名（无证书，electron-builder 如实跳过 signing）；NSIS/portable 目标未做（本机策略装不进工作区外；换真干净机器只需把 target 改成 nsis 并配图标）。
- 单实例锁以 userData 为键：同机换 `CUBICLE_DATA_DIR` 启动会绕过锁（多数据并行的合理形态，票 10 崩溃恢复同语境）。
- 「关于」入口无国际化、无更新检查（票面只要求版本号）。
- ledger 阶段用「带风险启用」跳过探针（探针归票 11）：打包 e2e 验的是准入状态 + 进程账本，不是准入质量。
