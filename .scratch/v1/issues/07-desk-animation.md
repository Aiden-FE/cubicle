# 07: 工位动画

**What to build:** 员工的状态由真实事件驱动：读文件 / 写代码 / 跑测试 / 被拦 / 请示 / 闲时各有动画与屏幕画面；空闲会摸鱼，久了会起身去倒咖啡再回来。

**Blocked by:** 04

**Status:** done

- [x] 四类工具状态正确映射（读 / 写 / 执行 / 测试），屏幕画面随状态切换
- [x] 测试失败屏幕变红、通过变绿
- [x] 被策略拒绝时工位有可见提示，不静默
- [x] 空闲 9 秒摸鱼、45 秒去咖啡并返回工位
- [x] 名牌与气泡可开关；关掉后仍能看出「在忙/在闲」

## Answer

**完成（2026-11-07）。** 一条命令复现验收：

```powershell
npm run build:renderer
npm run e2e:07
```

单阶段「desk」全绿（`tmp/e2e-07/desk.json` 每条断言带采样 trace、`tmp/e2e-07/*.png` 截图、`tmp/e2e-07/model-requests.json`）。模型端仍是确定性 mock，但 mock transport 从 04 票抽出为 `scripts/e2e-mock-model-server.mjs`（04 票的 `startMockModelServer` 变薄壳，`npm run e2e:04` 回归复跑 PASS）；**工具执行全部是真的**：在员工私有 workspace 里真读 hello.txt、真写 weekly-draft.md、真跑 powershell（echo / `node test_ok.mjs` exit 0 / `node test_fail.mjs` exit 1）、真发 `Remove-Item -Recurse -Force` 被宿主策略拦下（session JSONL 的 toolResult 就是「策略拦截（recursive-force-delete）：…」，`important.txt` 完好）。

- **四类 → 屏幕**：`read/write/powershell` 归一化工具事件折叠出屏幕模式（文档页 / 彩色代码行+光标 / 终端提示符 / 测试清单+进度条），trace 里 `read`×8、`write`×4、`exec`×13、`test`×N 连续采样可见；未知工具落到通用「干活」画面，绝不隐身。
- **测试红绿**：`node test_ok.mjs` exit 0 → `tone=pass`（整屏绿+大勾），`test_fail.mjs` exit 1 → pi 的 shell 工具 `isError=true` → `tone=fail`（整屏红+叉）。trace：`test/pass`×7、`test/fail`×8。
- **被拒不静默**：策略闸门 `src/host/engine/policy.mjs`（起步三条可评审规则：递归强删 / 毁盘 / 写系统目录）挂在 pi 内联 extension 的 `tool_call` 钩子（`noExtensions:true` 仍保留，inline factory 不受该开关影响）——拒绝**真的不执行**，且以新增归一化事件 `policy_blocked` 上流：工位红色 ✋ marker（15s TTL，下轮开始即清）+ 红灯 + 对话时间线一行琥珀「被策略拦下：powershell — …」。CLI 宿主（11 票）在自家卡口复用同一个 `decideToolAccess` + 同一个事件。
- **空闲 9s / 45s**：`renderer/src/scene/idleMotion.js` 纯状态机（注入时钟）；e2e **真实计时**实测 slack 9.2–9.8s、coffee 离座 45.2–45.7s（空椅+咖啡杯）、约 12s 后归位，归位后开新一轮空闲周期。工作事件（session_start / 工具开始）把人拉回工位并冻结空闲钟——忙工位永远不摸鱼。
- **名牌 / 气泡开关**：右上角两个 checkbox（localStorage 持久化）；关掉后 DOM 里 `desk-occupant`/`desk-bubble` 彻底消失，但 `data-busy` + 常亮状态灯（working 琥珀脉冲 / idle 绿 / slack / coffee / blocked 红）仍在——`deskReadout.deskSignals` 只读状态、签名里没有偏好参数，「在忙/在闲」的可读性由构造保证。

单测 117/117（新增 35，全部 node:test）：`tool-activity`（四类映射 + 命令含测试才判测试 + 未知工具→通用干活）、`desk-activity`（事件→工位 reducer：屏幕模式保持到下一工具/收尾、测试红绿、拒绝 marker TTL、delta/未知事件绝不编造状态）、`idle-motion`（9s/45s/归位、干活冻结、中途召唤回座、幂等、阈值=票面文字）、`policy`（三规则 + 解析失败不凭空拦）、`desk-readout`（常亮信号与气泡文案分离）。

### 架构落点

- **场景纯函数层** `renderer/src/scene/{toolActivity,deskActivity,idleMotion,deskReadout}.js`：状态全部可单测；`OfficeFloor` 只做 状态→SVG/DOM 映射（屏幕画面、坐姿、marker、灯、气泡），`domScene` 的定位契约与 SceneRenderer 缝不变，将来换 3D 分层背景+2D 角色只替换绘画步骤。
- **事件词汇 +1**：`events.mjs` 增 `policy_blocked`（标注为 host-originated，适配器不得发明）；run-manager / 合帧 / 主题订阅零改动。
- **角色预设 shell 改 `powershell`**（程序员 / 测试的 tools）：本机 pi `bash` 解析到 Git-Bash/msys2，在安全策略下启动即崩（`NtCreateDirectoryObject … 0xC0000022`），工位执行永远失败；应用 Windows-first，pi 自带 `powershell` 工具走同一 shell 工具定义（同一 isError 语义）。预设按 key 去重，**既有 DB 的 role 行不会自动更新**（新库/新装才有；本机旧 dataDir 需要改 role 行或重开库）。

### 环境坑（增量）

- **utilityProcess（electron.exe 镜像）可以 spawn cmd.exe / node.exe**（探针实测）——M2「electron.exe 不能 spawn 外部进程」对 tasklist 那类枚举成立，但不是全部；pi 的 shell 工具在 AgentHost 内能真跑。
- `capturePage` 在本机服务会话里间歇返回**旧一帧**（GPU 合成滞后 ~2s），`--disable-gpu` 则直接不可用：截图只是尽力而为的证据（连续两个匹配采样才截），验收口径是 DOM data 属性 + 会话 JSONL。
- mock 模型秒答时工具画面窗口 <100ms，DOM 采样追不上：07 mock 刻意在工具调用后播 3 帧 ×130ms 收尾文本（既让屏幕/红绿/气泡可观测 400ms+，也更接近真实节奏）。

### 已知边界（留给后续票）

- What-to-build 里的「**请示**」不在本票验收清单：策略现在只拦（deny），无 allow/请示交互（08/12 票地盘）。
- run 进行中**重载视图**：对话抽屉重放历史，工位暂时显示空闲（deskStates 不吃 run.history 重放）；事件持久化随 05 票落库时一并解决。
- 策略起步三规则不含工作区逃逸（`../` 写）——引擎已把工具圈在 workspace cwd；更完整的策略 UI 属后续票。
- 名牌/气泡偏好存 renderer localStorage（v1 无账号 / 同步，符合硬约束）。
