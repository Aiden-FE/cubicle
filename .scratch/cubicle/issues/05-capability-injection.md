# 05 — 能力注入：角色 → skills / MCP / tools

Type: grilling
Status: resolved
Blocked by: 02, 03

## Question

「招聘时预设一批技能、MCP、tools，也支持自定义」—— 能力的**种类、来源、作用域、冲突与覆盖规则**是什么？用户自定义能力的边界在哪？

## 要拆清楚

- **能力分几层**：prompt 层（人格 / 工作习惯）、skill 层（SKILL.md 式的流程知识）、tool 层（函数）、MCP 层（外部服务）、模型层（不同角色用不同模型）、**引擎层**（员工跑在哪个本机 agent 引擎上；统一协议见 14 票）。
- **作用域**：全局 / 企业 / 项目组 / 角色 / 单个员工，哪几层？下层能否覆盖上层？
- **冲突**：两个 MCP server 提供同名 tool 怎么办？角色自带的 skill 和项目组强制的 skill 冲突怎么办？
- **自定义**：用户能上传 skill 包吗？能填 MCP server 配置吗？能写代码定义 tool 吗（这等于允许执行任意代码）？
- **预设角色清单**：v1 内置哪几个（程序员、产品经理、测试、文案、数据分析…），各自带什么能力。注意 06 票已定 **员工自主 commit** → 每个动工作区的角色都要带「git 工作流」约定（何时 commit、message 规范、不主动 push）。

## 已知约束

- pi 的 tools / skills / MCP / extensions 四种扩展点都已确认可用（见 03 票）。
- 扩展是 TS 模块，能执行任意代码 —— 这是安全边界上必须回答的问题。
- Marvis 的做法是「6 个固定职责 Agent + 零配置」，自定义是后加的。这个顺序值得参考。

## 要产出

能力清单（capability manifest 的字段）、作用域与优先级规则、v1 预设角色表、自定义能力的安全边界。

## Answer

**结论：能力六层合一（persona / skills / MCP / tools / model / engine），三层作用域「角色 → 公司 → 员工」下层覆盖、同名灰牌警示；自定义开放人格 prompt / SKILL.md / MCP 配置，tool 代码不开放（任意代码执行进插件雾）；v1 预设程序员 / 测试 / 产品经理三个角色。**

### 1. 能力清单（capability manifest）

每个作用域层持同一形态的清单，装配时深合并：

| 层 | 内容 |
|---|---|
| persona | 人格 prompt、语气、工作习惯 |
| skills | skill 引用或内联 SKILL.md |
| mcp_servers | `{ transport: stdio/http, config }`；内置模板（GitHub 等）默认关闭 |
| tools | 适配层内置工具的子集与开关（read / write / edit / bash / grep…），风险等级参考 07 票 |
| model | `{ engine_id, model }`（04 票语义：先引擎后模型） |
| engine_requirements | 能力标记（需要 toolcall 事件 / token 流等），供 14 票协议与 09 票动画消费；不满足 → 引擎灰徽章 |

### 2. 作用域与覆盖

- 角色模板（出厂预设，可复制改）→ 公司级（该公司员工共享的 MCP / key / 模型偏好）→ 员工（快照 + 微调）。**v1 不做项目组层**（单员工时与公司重叠）。
- 覆盖方向：**员工 > 公司 > 角色**。
- 快照语义（02 票）：招聘那一刻合并出的最终清单固化进员工；角色后续改动不传染。

### 3. 冲突

- 两个 MCP server 提供同名 tool：能力清单并列展示，被覆盖方灰牌 + 来源标注（「来自角色 / 来自公司」），**不阻塞创建**。
- skill 与人格矛盾：不自动仲裁，靠 playbook 约束与验收兜底。

### 4. 自定义边界（安全）

- **允许**：人格 prompt 自填、上传 / 编辑 SKILL.md（纯 Markdown；落应用私有 skills 目录，不写 `~/.agents`，同 03 票隔离原则）、自填 MCP server 配置（stdio / HTTP JSON 模板）、复制预设角色再改。
- **不开放（v1）**：自定义 tool 代码 —— 那是扩展 = jiti 任意代码执行（03 票），安全兜不住；「工具商店 / 扩展包」进**插件与市场**的雾。

### 5. 预设角色表（v1 内置三个）

| 角色 | 定位 | 能力要点 | 默认引擎/模型 |
|---|---|---|---|
| 程序员 | 01 剧本主角；承接「加功能 / 修 bug」playbook | skills：**git 工作流**（何时 commit、message 规范、不主动 push、回滚靠派任务——06 票）、测试先行约定；tools：read / write / edit / bash（工作区）/ grep；MCP：无默认 | pi（04 票） |
| 测试 | 跑测试与验收辅助 | skills：测试清单化约定；tools：read / bash（跑测试优先）/ grep；bash 写操作收紧 | pi |
| 产品经理 | 承接「写文档」playbook；同时是规划调用的人格载体（08 票） | tools：read / write（无 bash）；skills：文档结构约定 | pi |

角色库扩展（文案 / 数据分析）进雾，不进 v1。

### 交接

- 招聘三步的第二屏 = 能力清单 UI → 10 票
- 引擎能力徽章（engine_requirements 不满足 → 灰）→ 14 票协议 + 10 票 UI
- bash / git 高危动作的具体分级 → 07 票
- 自定义 tool / 扩展市场 → 地图「插件与市场」雾
