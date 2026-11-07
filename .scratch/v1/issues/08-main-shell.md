# 08: 主界面外壳

**What to build:** 左轨（公司切换 / 工单台 / 花名册 / 引擎中心）+ 右缘任务把手抽屉 + 工单台浮层 + 底部输入框。**主画布永远是 100% 办公室，工单不占主空间**；切公司只换视图，进行中的工作不受影响。

**Blocked by:** 03, 06

**Status:** done

- [x] 左轨四个入口可用，公司切换器显示各公司活跃数
- [x] 右把手显示活跃工单数，拉开是「进行中 / 待验收 / 档案」三段
- [x] 工单台以浮层出现，不改变画布尺寸
- [x] 切换公司时后台任务继续跑，切回后状态正确
- [x] 1280 宽窗口下布局不破，画布仍占主体

## Answer

**完成（2026-11-07）。** 一条命令复现验收：

```powershell
npm run build:renderer
npm run e2e:08
```

单阶段「shell」全绿（`tmp/e2e-08/{shell,model-requests}.json`；模型端仍是确定性 mock——复用 `e2e-mock-model-server`，请求路径真 pi SDK + HTTP/SSE；员工的命令与 commit 由 powershell 工具真执行）。窗口 1280×800（内容区 1266×763）。

- **左轨四入口**：`LeftRail` 一条竖轨——公司切换（票 02 的悬浮 Switcher 收进轨内，面板向右弹）/ 工单台（沿用 05/06 的 `task-rail`→TaskBench，回归不破）/ 花名册 / 引擎中心。e2e 逐个点开：花名册列出「花名 · 角色 · 在岗 · 工位」；引擎中心显示 `pi` + 配置目录 `<dataDir>/engines/pi`，并留出 `engine-card-slot` 插槽（**引擎卡徽章/探针是票 11 地盘，本票不实现**）。
- **各公司活跃数（host 聚合，走类型化信封）**：store 新增 `companyTaskCounts()`（跨该公司所有项目组，只数 进行中/待验收；open/done/failed 不计），**随 `office.get` 快照走**（`taskCounts[companyId]={running,review}`）；公司面板每行渲染「进行中 X · 待验收 Y」+ `data-running/data-review` 属性，e2e 在慢活跑着时断言 `1/0`。单测钉：跨组聚合、公司间不串、0/0 也列出。
- **右把手三段**：右缘把手徽标 = 活跃数（`activeCountFor` = running+review，纯函数在 `scene/handleGroups.js`，node:test 钉口径）；拉开是「进行中 / 待验收 / 档案」（档案 = done+failed；**待办不进把手**——它属于工单台；未知状态不假装归类）。数据走 `task.list` 新增的**公司范围查询**（`{companyId}` → `listTasksForCompany`，非法 id 报 `unknown_company`）。e2e：三段成员正确 → 慢活跑完后**实时搬家**（进行中→待验收）→ 通过后徽标归 0、档案 ×2。
- **浮层不改变画布**：主画布 `office-floor` 永远 `inset:0`；把手/工单台/花名册/引擎中心全是 absolute 覆盖。e2e 在 工单台开、工单台+把手同开、B 空公司视图、收尾四个时刻测 `floorW==innerW && floorH==innerH && roomW` 恒定（759px）——1280 布局不破、画布占主体（room 759/1266）。快照语义单测：`office.get` 纯读（两次调用逐字段相等、不发事件）。
- **切公司只换视图（host 不受影响）**：e2e 现场演示——公司 A 慢活跑着（run.history 事件流增长）→ 新建并切到公司 B（画布切成空办公室，仍满窗）→ 在 B 视图 3s 内 A 的 run 事件继续进 host（`events=4→6`、`lastRun=running`）、`taskCounts[A].running=1` 跨公司可见 → 切回 A：四个工位还在、occupant 同名、工位被**新到达的真实事件**重新点亮「干活」（不是重放）、工单仍「进行中」→ 照常跑完自动进「待验收」。单测侧：`office.setActive` 后 A 的任务状态/计数原样，切回 `desks.length=4`。

单测 178/178（新增 13，全部 node:test）：store seam（`companyTaskCounts` 聚合口径 + 快照携带 + `listTasksForCompany` 跨组/隔离）、service seam（taskCounts 进信封、`task.list {companyId}` 含 `unknown_company`、`engine.overview` 引擎名+configDir、`office.get` 纯读、切公司不动别家公司状态）、`handle-groups` seam（三段落位 / 待办与未知状态不入 / 活跃口径 / 空输入不炸）。回归：`npm run e2e:06` 在全新外壳下全绿（TaskBench 语义未坏）。

### 架构落点

- **聚合留在 AgentHost**：计数与跨组列表都在 store（单写者），service 只做校验 + 信封；renderer 只展示 + 触发（`taskCounts` 走快照，把手列表走 `task.list` 查询）。
- **分组是视图读法不是数据**：`renderer/src/scene/handleGroups.js`（与 07 票 scene 纯函数层同规）决定三段归属；host 不知道「把手」这个概念。
- **引擎清单的真来源 = 角色 manifest**：`engine.overview` 从角色 manifest 去重引擎（预设 pi；将来招 codex 员工其引擎自然进列表），配置目录走新 seam `engineConfigDir(dataDir, engine)`（`enginePaths` 同源于它）。
- 把手/花名册/引擎中心三个浮层与工单台共用一套浮层语言（rail-drawer / handle-drawer），左轨 z28 < 浮层 z30：抽屉盖住左轨是既有的 06 行为，收起即回。

### 已知边界（留给对应票）

- **花名册 = 当前公司当前项目组的在岗名单**（票面「入口可用即可」）；跨组花名册、员工详情、辞退属后续票。
- **引擎中心只有名字+路径**：徽章、探针、codex 卡属票 11（插槽 `engine-card-slot` 与 `engine.overview` 就是给它的地基）。
- 把手是**只读**列表；点行跳工单台详情属体验票。
- 切回公司时工位动画从当前态重新折叠（07 票既有「run 中重载视图」边界）：不重放历史事件，靠后续真实事件点亮——e2e 演示的正是这条诚实路径。
- 待办工单不出现在把手三段（设计决定：待办在工单台；把手只盯「活跃 + 档案」）。
