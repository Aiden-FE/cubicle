# 17: 工位屏幕状态 + 三种随机摸鱼

**What to build:** 工位屏幕要像真的电脑：无人或公司下班时全黑；有人但没在跑任务时显示 Windows 桌面；摸鱼时随机进入「喝咖啡 / 玩手机 / 玩扫雷」三种状态并带动画；工作时按角色和工具显示编码、办公、终端或测试界面。

**Blocked by:** 16 号票（视口/缩放/平移）done

**Status:** done

- [x] 无人工位与下班中的公司：3D 屏幕和 2D 降级屏幕都是纯黑
- [x] 有人但空闲：Windows 桌面（含手机/扫雷/喝咖啡的坐着状态）
- [x] 9 秒空闲后随机进入 phone / minesweeper / coffee 之一
- [x] 喝咖啡：从工位走向咖啡机 2.5s、停留 5s、走回 2.5s、坐着喝 10s
- [x] 喝咖啡状态有行走/腿部摆动/端杯/啜饮动画，咖啡杯可见
- [x] 玩手机有手机道具、坐姿和轻微摆动；扫雷有双手点击动画
- [x] 工作时程序员/测试显示编码界面、PM 显示办公界面；exec 显示终端；test 显示测试控制台和红绿结果
- [x] 下班状态来自真实 duty phase，不在前端编造；切公司/上下班后屏幕跟着变
- [x] 员工状态不依赖文字：移除状态气泡、移除名牌里的「干活中…」；状态靠动作、屏幕、常亮状态灯表达
- [x] 单元测试覆盖随机选择、咖啡阶段、屏幕分类；扩展现有 e2e:07
- [x] `npm run typecheck`、`npm test`、e2e 02–14 全过；截图

## Answer

**屏幕层**（`renderer/src/scene/deskScreen.js`）：一个 `screenForDesk({ occupant, offDuty, activity })` 纯函数，3D CanvasTexture、2D SVG 降级和 e2e `data-screen` 共用同一份判决：

| 状态 | 屏幕 |
|---|---|
| 无人工位 / 公司 duty phase = off | 纯黑（不是待机图案） |
| 有人、没在跑任务（idle/phone/minesweeper/coffee） | Windows 桌面（壁纸 + 图标 + 任务栏） |
| programmer / tester 干活 | 代码编辑器（彩色语法行 + 光标） |
| PM 干活 | 办公文档/表格 |
| exec | 终端 |
| test | 测试控制台；pass 整屏绿、fail 整屏红 |

下班相位由 `App.jsx` 每 1s 从真实 `schedule.get` 读取，没有根据本地时间伪造；切换公司/上下班后 3D 与 2D 同步重绘。

**摸鱼状态**（`idleMotion.js`）：空闲 9s 后用 `Math.random` 选 phone / minesweeper / coffee。phone 和 minesweeper 各 12s；咖啡是 2.5s 去程 → 5s 咖啡机 → 2.5s 回程 → 10s 端杯坐在工位，然后重新进入 idle。任何真实工作事件立即把员工拉回工位。3D 增加了腿（坐着隐藏）、手机、纸杯和逐帧行走/摆动；咖啡机站位从柜台内移到柜台右侧 `(-3.42, 4.92)`，避免角色被吧台挡住。2D 降级也有手机/咖啡杯/扫雷手部动画。

**状态不写文字**（2026-11-11 追加）：删除了 `desk-bubble` 和 `bubbleTextFor`，名牌只显示姓名/角色/token（不再显示「干活中…」），设置里移除气泡开关。员工状态改由动作、屏幕内容和常亮状态灯表达；e2e:07 断言 DOM 中无状态气泡、名牌无状态文字。

**验证**：

- `npm run typecheck` 通过；`npm test` 402/402。
- `npm run e2e:07` 130.0s PASS：空工位黑屏、真实 read/write/exec/test 的 code/terminal/test-pass/test-fail、9s→咖啡（coffeeAt=9077ms）、咖啡机停留（4s 时仍在 machine，observed hold ~4.9s）、坐着喝、手机、扫雷、名牌关闭、下班全黑、上班恢复；状态无文字断言 `{"bubbles":0,"plate":"E2E 动画员 · 程序员98","forbidden":[]}`。
- `e2e:08` PASS（含 900×600 resize 直接重投影修复）；02–06、09、10、12、14 PASS；`e2e:11` 批量时 codex refusal flake 一次，standalone 重跑 PASS；`e2e:13` packaged app PASS。
- 截图：`tmp/ui-shot/shots/17-idle-00-initial.png`（代码屏 + Windows 桌面 + 空位黑屏）、`17-idle-01-coffee-walk.png`、`17-idle-02-coffee-machine.png`、`17-idle-03-coffee-seated.png`、`17-idle-04-phone.png`、`17-idle-05-minesweeper.png`、`17-idle-06-off-duty.png`（8 屏全黑）。

**残留**：截图捕获在本机 GPU 会话下偶发 `Current display surface not available`，e2e 以 DOM 断言为准，手工截图已补；无功能残留。
