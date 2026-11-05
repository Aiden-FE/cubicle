# 桌面 2D 办公室与 AI Agent 界面选型

> 调研输入，非决策票。用于 09（可视化）与 11（技术架构）。结论：**Electron + PixiJS 8 + spritesheet + 自研网格 A\*/状态机 + Tiled 等距地图**。

## 1. 桌面壳：Electron vs Tauri 2（Windows）

| 维度 | Electron | Tauri 2 |
|---|---|---|
| 安装包 | 约 80–150MB | 空壳 <600KB，带资源常见 3–10MB |
| 内存 | 空窗约 150–250MB（main+renderer+GPU+utility） | 仍走 WebView2 多进程，约 80–150MB |
| WebView 一致性 | 钉死 Chromium，行为可预测 | evergreen WebView2，锁不住小版本 |
| 原生能力 | 托盘/多窗口/自动更新成熟；文件监听 chokidar | 官方 tray/updater；文件监听要 notify crate |
| 迭代速度 | 全栈 TS，排错资料多 | 后端改动过 Rust 编译 + serde 边界 |

**结论**：选 Electron。若 Tauri 挂 Node sidecar 跑 agent，体积优势基本被吃掉。

## 2. 2D 渲染与动画

- **PixiJS 8**：纯渲染库，WebGL/WebGPU、批处理、`sortableChildren` —— 做底座。
- **Phaser**：整套游戏框架，省事但接管主循环，与 React UI 集成要多包一层。
- **Rive**：矢量 + 内置状态机 + 数据绑定，单角色最强，几十个角色不经济。
- **Spine**：骨骼工业标准，有 `spine-pixi` 运行时，适合少量高表现力角色。
- **Live2D**：立绘式 2.5D，等距全身走动不合适，SDK 发布许可有规模门槛。
- **纯 CSS/SVG**：几十角色 + 深度排序 + 60fps 不现实，只做 UI 层。

**推荐组合**：PixiJS + spritesheet + 自研 FSM/A\*/调度；需要「会呼吸」的主角再叠 spine-pixi 或 Rive。
**性能量级**：批处理下动画 sprite 数千仍 60fps；本场景 30–60 角色无压力。瓶颈是 filters、逐帧改 Text、遮罩、每角色独立纹理。

## 3. 实现要点

- **坐标/拾取**：等距投影 map→screen，反解 screen→map；点击对菱形做命中测试。
- **深度排序**：按 `(x+y)` 或 `y` 排序，地板/家具/角色分层，容器开 `sortableChildren`。
- **寻路**：网格 A\*（EasyStar.js 或自写堆），家具占格 + 角色动态占位，路径拉直。
- **状态机**：idle/work/walk/coffee 四态 + 打断优先级（被叫走 > 咖啡 > 工作）。
- **调度**：全局预约表（工位锁 + 交互点锁），A 找 B 先申请 B 旁站位，失败排队改期。
- **相机**：容器缩放 0.5–2、以鼠标为中心缩放、边界 clamp、视口外 culling。

## 4. 资产与成本

- Kenney：CC0 免费，适合原型。
- CraftPix：单包 $5.5 起，带 4 方向走/待机动画的角色包多 $10–30。
- itch.io（LimeZu 等）：等距办公室/现代室内包常见 $8–20。
- 定制：Spine Essential $69 / Pro $379；外包全骨骼角色约 ¥3k–1.5w/个，Live2D 约 ¥2k–1w/个。角色多就退回 spritesheet。

## 5. Electron 进程模型风险

- main 只管窗口/托盘/更新；agent 长任务放 `utilityProcess`（可挂 MessagePort 直连 renderer）或 `worker_threads`；renderer 只渲染。
- 崩溃：监听 `render-process-gone` / `child-process-gone`，主进程守护 + 场景状态持久化；Windows 上杀进程树，别留孤儿。
- 泄漏高发：`ipcRenderer.on` 未移除、Pixi texture/容器未 destroy、定时器与闭包、日志无上限。
- 流式 token 直塞 DOM 会撑爆节点 → 虚拟列表 + 节流；托盘常驻的隐藏窗口默认被节流。

## 来源

[Electron 进程模型](https://www.electronjs.org/docs/latest/tutorial/process-model) ·
[Tauri WebView 版本](https://v2.tauri.app/reference/webview-versions/) ·
[Tauri 简介](https://v2.tauri.app/start/) ·
[PixiJS 性能指南](https://pixijs.com/8.x/guides/concepts/performance-tips) ·
[spine-pixi](https://esotericsoftware.com/spine-pixi) ·
[Spine 价格](https://esotericsoftware.com/spine-purchase) ·
[Live2D SDK 许可](https://www.live2d.com/en/sdk/license/) ·
[等距投影数学](https://clintbellanger.net/articles/isometric_math/) ·
[Red Blob A\*](https://www.redblobgames.com/pathfinding/a-star/introduction.html) ·
[EasyStar.js](https://github.com/prettymuchbryce/easystarjs) ·
[CraftPix](https://craftpix.net/) · [Kenney](https://kenney.nl/assets)

> 说明：调研会话无 `web_search` key，改用 `web_fetch` 直取官方文档（经 Bing 定位）。体积/内存/角色数为量级估算。
