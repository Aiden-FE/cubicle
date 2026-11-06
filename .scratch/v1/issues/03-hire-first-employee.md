# 03: 招聘第一个员工

**What to build:** 点空工位打开招聘三步（选预设角色 → 看能力清单 → 确认录用），录用后工位被占用、角色出现在工位上；角色定义按招聘时刻的快照保存，之后改角色不影响已招的人。

**Blocked by:** 02

**Status:** done

- [x] 三步可前进/后退，能力清单展示人格、技能、工具、引擎与成本
- [x] 录用后工位从「空」变「占用」，办公室里出现该员工
- [x] 重启后员工仍在，且角色快照与录用时一致
- [x] 同一角色可再招一人，坐不同工位
- [x] 招聘过程不写任何用户家目录下的引擎配置

## Answer

**完成（2026-11-06）。** 一条命令复现验收：

```powershell
npm run build:renderer
npm run e2e:03
```

两阶段全绿（`tmp/e2e-03/{hire,verify}.json`，全部真实点击，不走桥后门）：

- **hire**：点空工位弹出中屏招聘向导（10 号票：招聘 = 中屏弹窗，主画布仍是办公室）→ 角色库列出 **3 个预设**（05 号票：程序员 / 测试 / 产品经理）→ 第 2 步能力清单含 **人格 / 技能 / 工具 / MCP / 引擎 / 成本**（`严谨务实` persona、`git 工作流` skill、`bash` tool、`pi · default`、`50 万 token` 软闸逐串命中）→ **前进+后退**（2→1→2）验证 → 填名确认 → 工位 `data-empty` 翻 false、工位名变「员工 · 角色」、SVG 角色入座 → **同一「程序员」角色再招一人坐第二个工位** → 快照断言：两名员工 roleId 相同、冻结清单逐字节一致 → **家目录引擎配置目录指纹前后不变**（`.pi`/`.codex`/`.claude`/`.qoder`/`.agents` 文件数与最新 mtime 完全相等）→ Ctrl+R 语义重载占用照常、宿主 pid 不变。
- **verify**：全新进程同一数据目录，两名员工仍在工位，角色快照与（未改动的）预设逐字节一致，画面显示占用员工与角色名。

单测 58/58（`npm test`）：store seam（角色种子、录用落库与重启、**快照不传染**——录用后 UPDATE role 行，先招的人不变、后招的人拿到新定义、occupied/unknown 拒绝）、service seam（`role.list` / `employee.hire` 校验、错误码 `invalid_payload|desk_occupied|unknown_desk|unknown_role`、`domain.changed` 事件）。

### 数据与语义

- 新表 `role`（key 唯一，manifest JSON = 05 号票能力清单形态）+ `employee`（company_id + **role_snapshot JSON** + hired_at）；`desk.employee_id` 02 票已留列，本票启用。
- **角色种子按 key 幂等插入**（`seedRoles` 每次 open 都跑）：02 票时代的旧库升级自动获得预设，不重复。
- **快照语义（02 号决策票）**：录用那一刻把 role 行冻结成 `role_snapshot` 存进员工；`employee.hire` 单事务（INSERT employee + `UPDATE desk … WHERE employee_id IS NULL` 抢位），并发招同一工位只会一个成功；名字留空默认角色名；员工 company 从工位所属项目组反推。
- 能力清单展示层直接读 role 行（第 2 步）；员工视图永远读快照——之后 04/05 号票的引擎与成本字段都在 manifest 槽位里。

### 环境坑（增量）

- agent 沙箱里 **esbuild / node --test 默认 spawn 管道被拒（EPERM）**：测试走 `npm test`（`--experimental-test-isolation=none` 进程内跑）；`vite build` 需非受限会话或提权。
- e2e-03 复用 main 的 e2e 钩子：新增 `CUBICLE_E2E_RUNNER` / `CUBICLE_E2E_OUT_DIR` 环境变量选 runner，main 仍不含业务与验收逻辑。

### 已知边界（留给对应票）

- 归档（离职）、改名、解雇不在本票范围；角色编辑器在雾区（本票用 store 直改 role 行验证快照不传染）。
- 2D 角色是占位 SVG（各角色配色 + 程序员眼镜 / PM 领巾 / 测试耳麦），spritesheet 与动画 = 07 票换 SceneRenderer 实现。
- 招聘向导未做「复制角色再改」（05 号票允许项）；角色库当前只读。
