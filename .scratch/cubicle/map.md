# Cubicle · 决策地图

> 用 `/wayfinder` 维护。目的地是一份蓝图，不是代码。
> **状态：v1 蓝图已完成（2026-11-05）。** 15 张决策票全部关闭；v2 相关见 Out of scope 与 Not yet specified。

## Destination

一份能直接开工的蓝图：**v1（单员工闭环 + 多公司并行与上下班 + 统一 agent 引擎适配层）** 的 PRD、领域模型、技术架构、里程碑与风险清单，细到工程团队或 agent 可以照图施工；同时写清 **v2（多员工协作、账号、跨设备同步）** 的扩展位，以及暂不做的理由。

## Notes

**已定的约束（不再重开）**

- 形态：Windows 优先的桌面应用；**Electron + React + PixiJS 8**。
- 第一版自用（1-2 人），不做账号 / 同步 / 计费。
- **多公司并行**：公司不只有一个，可切换；切换只是换视图，进行中的工作继续跑，**程序退出才中断**（运行时语义见 13 票）。
- **上下班**：公司级动作 —— 上班让有未完成任务的员工激活开工/续跑，下班让工作中的员工**优雅暂停**（见 13 票）。
- **Agent 引擎**：不内置、不深度绑定任何引擎；通过统一协议调用本机 agent 引擎（pi、codex、claude、dsh、qoder…），员工可各自选择引擎；**准入条件 = 能注入角色技能、MCP、tools，否则不进可选项**（协议见 14 票，引擎调研见 15 票）。
- 美术：参考腾讯 **Marvis** 的卡通办公室。拆解见 [marvis-teardown.md](research/marvis-teardown.md)——实际是 **3D 白模办公室 + 2D 扁平角色 + 斜俯视娃娃屋**；09/11 票定：**场景用预渲染 3D 分层背景（back/mid/front）+ 2D 角色**，2.5D 矢量作 fallback。
- 技术选型调研：[desktop-stack.md](research/desktop-stack.md)；pi 嵌入调研：[pi-embedding.md](research/pi-embedding.md)；引擎准入调研：[engine-capabilities.md](research/engine-capabilities.md)——六引擎全过准入线，无剔除（Claude / Qoder / dsh 专有，分发边界要在 14 票写死）。

**工作方式**

- 每张票只解一个决策；解完在票尾写 `## Answer`，并把 gist 追加到本图 `Decisions so far`。
- 未决票在 `issues/`。frontier = 编号最小的、open 的、且 `Blocked by` 全部 resolved 的票。
- 领域词汇以 `GLOSSARY.md` 为准（由 02 票创建）。
- 领域建模用 `domain-modeling` skill；需要压测时用 `grilling`。

## Decisions so far

- [pi 内核嵌入](issues/03-pi-embedding.md): 用 `@earendil-works/pi` 的 SDK 形态嵌入，独立 session 目录即可与用户本机配置隔离；但 pi **没有子 agent、没有 agent 间消息**，多员工协作必须在应用层自建调度器。**（2026-11-05 修订：用户改为不内置、不绑定，pi 降级为可选引擎之一，见 14 / 15 票。）**
- [v1 范围与演示剧本](issues/01-v1-scope-and-demo.md): 3 分钟单员工闭环 demo（建企业 → 三步招聘 → 派「CSV 导出 + 测试」任务 → 工具级动画 → 验收）；砍多员工/账号/同步/编排，保留喝咖啡、摸鱼、发呆三个闲时动作；失败也入镜。**（2026-11-05 修订：多公司并行与上下班进入 v1，见 13 票。）**
- [领域模型与术语](issues/02-domain-model.md): 公司是绝对容器、员工不跨公司；工位是实体（空位 = 招聘入口）；角色招聘即快照、不传染；任务挂项目组、带 owner 员工；会话 / 产出是一等实体；v1 只有归档没有删除。术语见 `GLOSSARY.md`。
- [引擎准入调研](issues/15-research-engine-capabilities.md): 六家引擎（含基线 pi）**全部通过准入**——都能注入技能 / MCP / 工具，无剔除；差异在事件粒度（pi / Claude 最稠）、证据等级（Codex、dsh headless 待复核）与许可（Claude / Qoder / dsh 专有 → 分发边界「只调用用户自装」要在 14 票写死）。
- [模型与成本策略](issues/04-model-and-cost.md): 先引擎后模型（引擎是主键）；v1 默认引擎 = pi（内置依赖），本机已登录的 Codex 探测即用；成本 v1 只聚合 token（任务 / 员工 / 公司三层），单任务默认 50 万 token 软闸 + 一键继续；key 统一在设置页 · 引擎中心；上下文用引擎自带压缩。
- [任务执行、工作区与产出](issues/06-task-workspace-artifacts.md): 项目组绑一个 git 仓库根，任务开工记起点 HEAD，产出 = 相对起点的四件套（副本存应用侧）；**commit 由员工自主完成，应用对 git 只读**，回滚靠派任务；任务五态（待办/进行中/待验收/完成/失败）+ 正交暂停标志；验收保留，打回 = 同任务追加迭代。
- [编排模型](issues/08-orchestration.md): 混合编排 = playbook 库（加功能 / 修 bug / 写文档）+ 一句话自动套；任务来源是**可插拔适配器**（v1 = 人工工单，v2 可挂 Jira 定时轮询）；规划 = 轻量规划调用 + agent 步骤清单（展示字段，v2 才升级子任务）；执行自主跑完，steer 插话即时生效。多员工协作拆入新票 16。
- [能力注入](issues/05-capability-injection.md): 能力 = persona/skills/MCP/tools/model/engine 六层，三层作用域（角色 → 公司 → 员工）下层覆盖、同名灰牌；自定义开放 prompt / SKILL.md / MCP 配置，**tool 代码不开放**（任意代码执行进插件雾）；v1 预设程序员（含 git 工作流）/ 测试 / 产品经理三角色，默认引擎 pi。
- [权限、审批与沙箱](issues/07-permissions-sandbox.md): v1 无审批系统 —— 硬规则策略表自动执行（读自由 / 写分区内、外 / bash 黑名单 / git 仅 commit 系，push 与破坏性拒 / 网络与装包允许 / MCP 白名单）；违规「拒绝可见」；agent 被拒可在会话内请示、用户 steer 批（自然语言审批）；OS 级沙箱不做，bash 承认为溃点、风险入 12 票表。
- [办公室可视化](issues/09-office-visualization.md): 视觉路线 = **A 娃娃屋构图**（用户拍板）+ **B 预渲染 3D 分层背景 + 2D 角色**（二次拍板；2.5D 矢量为 fallback）；原型已实跑验证，事件→动画映射表 / 状态优先级 / 资产规格见票；「被拦→请示→批准」保留为可选拍点。原型：[09-office-prototype.html](prototypes/09-office-prototype.html)（throwaway）。
- [首次启动与信息架构](issues/10-first-run-ia.md): 开场 = **B 三步向导**（可跳过，空态渐补）；招聘 = **中屏弹窗**；主界面 = **稿 2「后台轨」骨架 × 稿 1「右缘任务把手」** 杂交——工单创建走 composer playbook 卡、列表走把手抽屉/工单台浮层，主画布永远 100% 办公室；公司切换器 = 左轨头像菜单；设计系统：暖纸面 + 三语义色 + 炭黑主按钮 + 克制动效。原型：[first-run](prototypes/10-first-run-prototype.html) · [五稿](prototypes/10-main-shell-5drafts.html)。
- [引擎适配协议](issues/14-engine-adapter-protocol.md): **双宿主（pi SDK 宿主 + CLI 子进程宿主）对齐单一归一化事件总线**，协议只定义事件/能力声明/生命周期/策略钩子，不绑传输；事件基准 = pi/Claude 的 token 级，粗粒度引擎动画降级忙/闲；v1 适配器 = pi + codex；启用必跑**自动探针**（注入/工具/拒绝可见/事件完整四验），失败可手动声明带风险徽章；capabilities JSON 是 UI 徽章与降级的唯一事实源。
- [运行时生命周期](issues/13-runtime-lifecycle.md): **定时上下班为主**——公司级时间表，应用内分钟级触发 + 开机补触发；左轨/顶栏按钮 = 即时 override（v1 必备）；下班 = **90s 宽限 + 全量落盘 + 可恢复**（pause 不支持的引擎降级「跑完再停」）；多公司全后台可见（左轨角标 + 全局 toast），运行时与视图解耦；**程序退出三选**（直接退=统一执行下班落盘 / 等完成 / 取消）；崩溃恢复面板由用户选（续跑/重跑/放弃）。
- [技术架构](issues/11-tech-architecture.md): **main（窗口/更新/偏好）+ AgentHost（utilityProcess：SQLite 单写者 + 引擎运行时）+ renderer（纯视图）**；SQLite(WAL) 单库 + 文件系统分目录（artifacts / engines / renders）；IPC 类型化信封 + 16ms 合帧 + 主题订阅 + 大对象走指针；UI = React 18 + Vite + Zustand + PixiJS；场景 = **预渲染 3D 分层背景（back → 角色 → mid → front-occluder）+ 2D 角色**，SceneRenderer 接口隔离渲染技术；**开工第一件事：核验 Electron 内嵌 Node ≥ 22.19**。
- [里程碑、风险与 v2 扩展位](issues/12-milestones-risks.md): **6 个里程碑 26–36 人日**（M0 探路 → M1 骨架 → M2 真 agent 闭环 → M3 办公室动画 → M4 流程外壳 → M5 生命周期 → M6 打磨）；9 条风险（最高：Electron Node 版本、真 agent 成功率）；v2 扩展位已在数据模型 / 协议 / 渲染层预留；「只做三件事」= M0 + M2 + M3。

## Not yet specified

- **来源适配器扩展**：Jira 来源（定时 JQL 轮询建工单）、Webhook、仓库监控 —— 等 v1 人工工单跑通、08 票的 `task.origin` 接口被验证后再定，见 08 票 Answer。
- **闲时行为**：v1 已定 3 个动作（喝咖啡、摸鱼看手机、发呆）；09 票已给出触发条件（空闲 > 9s 摸鱼、> 45s 咖啡）与打断规则；待定：扫雷 / 健身等 v1.1 扩展、与「忙」的边界细节打磨。
- **人格与记忆**：性格如何影响行为与产出、长期记忆存哪、如何遗忘。等 05 的能力模型定了再看。
- **账号体系**：微信扫码（开放平台资质与审核）、邮箱登录、设备与会话管理。
- **跨设备同步**：同步粒度（配置？任务？产出？）、冲突解决、后端选型与成本。
- **美术资产管线**：spritesheet 规范、AI 生成与外包的取舍、换装。
- **分发与更新**：安装包、代码签名、自动更新、崩溃上报。
- **插件与市场**：角色包 / 技能包 / MCP 的打包格式与分发；**自定义 tool 的代码扩展**也在此（05 票 v1 明确不开放——jiti 任意代码执行兜不住）。
- **角色库扩展**：文案 / 数据分析等预设角色与角色编辑器（05 票 Answer 已定 v1 三个）。
- **可观测性与成本**：任务失败重试、日志、token 成本面板。
- **多项目组 / 多企业**：公司内「多项目组」的切换与数据边界（多公司并行已入 13 票）。

## Out of scope

- 移动端 App。
- 3D 角色（角色走 2D 扁平 spritesheet；办公室场景用预渲染 3D 分层背景，见 09 票）。
- B 端多租户 SaaS 与私有化部署（第一版自用）。
- 实时语音对话。
- **多员工协作（v2）**：[16 票](issues/16-multi-employee-collab.md) 已关闭 —— 本次蓝图只留扩展位，v2 设计需开新的 wayfinder 努力。
