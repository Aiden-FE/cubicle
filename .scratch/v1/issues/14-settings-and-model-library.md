# 14: 统一设置 + 引擎无关模型库

**What to build:** 右上角齿轮打开统一设置（外观 / 模型 / 引擎中心 / 关于）；模型库成为 pi/codex/dsh 三个引擎的唯一配置来源；招聘/编辑员工时选引擎、模型、推理档；三个引擎都能用本地 mock 跑通一张工单并续会话。

**Blocked by:** 无（13 张 v1 票已全部 done）

**Status:** done

- [x] 右上角齿轮打开居中设置模态；右下角名牌/气泡与右上角状态点收进设置
- [x] 左轨保留公司切换 / 工单台 / 花名册 / 上下班，移除引擎中心 / 关于
- [x] `<dataDir>/settings/models.json` 模型库：供应商（显示名/baseUrl/key/协议）+ 模型（id/显示名/1M/128K/text+image/推理档映射）
- [x] 默认供应商/模型 + 第一项兜底 + 引擎兼容回退；删除被引用模型确认后回迁默认
- [x] 测试连接：最小推理请求，显示状态/延迟/错误，不写任务 token
- [x] 招聘第 3 步 / 花名册编辑：引擎 + 模型 + 推理档；不兼容模型灰显；无模型阻止录用
- [x] pi 从模型库生成 `engines/pi/models.json`；`thinkingLevelMap` 与员工推理档生效
- [x] codex 每员工独立 `CODEX_HOME`；只列 Responses 模型；模型/推理档写入 config.toml；会话续跑
- [x] dsh 使用 Cubicle 独立 `engines/dsh/` home；启动已安装 desktop 的 ACP；模型/推理档按 session 下发；不读写 `~/.dsh`；会话续跑
- [x] 旧 `engines/*/models.json` 忽略且不提示；已有员工保留旧引用，编辑/派单时报「模型不存在」
- [x] `npm run typecheck`、`npm test`、e2e 02–13 全过
- [x] 新增 e2e：设置/模型库 CRUD + pi/codex/dsh 各跑通一张工单
- [x] 900×600 设置模态可用；截图归档

## Answer

### 交付内容

- **设置入口**：右上角齿轮打开居中模态（`SettingsModal.jsx`），四个 tab：外观 / 模型 / 引擎中心 / 关于；宿主状态从画布右上角移进设置顶部状态条。左轨只保留公司切换 / 工单台 / 花名册 / 上下班，右下角名牌/气泡开关移进「外观」tab。
- **模型库**：唯一来源 `<dataDir>/settings/models.json`（0600，UI 只显示掩码）。供应商级协议 `openai-responses` / `openai-completions`，模型继承；模型默认 1,000,000 上下文、128,000 输出、`text+image`；推理开关 + 固定档位 `off/minimal/low/medium/high/xhigh/max`，每档可编辑 wire value；默认供应商/模型 + 首项兜底 + 引擎兼容回退。
- **招聘/编辑**：`HireModal` 第 3 步、`EmployeeEditModal` 都选引擎 + 模型 + 推理档；只列该引擎协议兼容的模型；无兼容模型时禁止录用/保存；旧引用不自动改写，派单/编辑时给「模型不存在」。
- **三个适配器**：
  - pi：由库生成 `engines/pi/models.json`，传 `thinkingLevel`；
  - codex：每员工独立 `CODEX_HOME`，按员工写 `models.json` + `config.toml`，只接 Responses，保留每员工 hook 卡口；
  - dsh：独立 `engines/dsh/` home，启动已安装 desktop 的 ACP（`initialize` / `session/new|resume` / `set_config_option` / `prompt|cancel`），按 session 下发模型和推理档，不读写 `~/.dsh`。
- **删除回迁**：删供应商/模型时先确认；被员工引用时自动回迁默认/首个兼容模型，无兼容模型则拒绝删除（`model_in_use`）。
- **旧配置**：不导入、不提示、不迁移；旧 `engines/*/models.json` 不再被应用读取。

### 验证

- `npm run typecheck`：通过。
- `npm test`：**398/398** 通过（新增 `test/model-library.test.mjs` 8 项、`test/model-service.test.mjs` 4 项）。
- e2e 02–14 全部通过：
  - pi：`e2e:08` 真实工单；
  - codex：`e2e:11` 真实工单 + 探针 + 卡口 + 中止；
  - dsh：`e2e:14` 设置表单添加 Responses 供应商/模型 → 测试连接 → 招聘选 dsh/模型/推理 → 编辑员工 → 真实 ACP 对话 + 真实工单 → 重启后续同一 `acp:` 会话；
  - `e2e:14` 同时验证旧 `engines/pi/models.json`（故意写坏）被忽略、模型库初始为空、900×600 设置模态。
- 证据：`tmp/e2e-14/e2e-14-settings.json`、`tmp/e2e-14/e2e-14-resume.json`、`tmp/e2e-14/proof.json`；截图 `tmp/ui-shot/shots/30-settings.png` … `35-settings-narrow.png`。

### 仍留的硬约束/限制

- **dsh 权限请求目前自动允许**：ACP `session/request_permission` 还没有接 `decideToolAccess`，所以 dsh 的 `policy_blocked` 卡口/准入探针「拒绝可见」项尚不成立；e2e-14 用「带风险启用」准入 dsh。pi/codex 的卡口保持不变。
- dsh 只支持本机已安装的 desktop（当前路径探测）；未做跨版本 ACP 兼容矩阵。
- 模型库 key 按要求明文存 `models.json`（0600，非 OS keychain）；UI 只显示掩码。
- codex 推理档受 CLI 支持的 `model_reasoning_effort` 限制；库里的档位映射到 wire 值时由 codex 侧决定可用集合。
