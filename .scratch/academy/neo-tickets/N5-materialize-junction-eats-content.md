# N5: materialize 重复导出会经「node 看不见的 junction」吞掉学院内容（electron-as-node 场景）

**Type:** bug（交接票，只含现象与期望；按 SCOPE §3 不含代码/patch）
**Status:** closed（Neo `b0767f9`；vendor 已重钉、Cubicle 缓解已移除、e2e:15 复跑绿）
**发现:** 2026-11-18 · Cubicle 票 a04（e2e:15），vendored pin `894e5bf`

## 现象

Cubicle 以 `ELECTRON_RUN_AS_NODE=1` 用 electron.exe 跑 vendored CLI（vendor/README 合同）。
同一 `--out` 目录连续两次 `neo materialize`：

- 第一次导出成功；`<out>/skills/<skill>` 是指向学院内容（`library/<域>/<技能>`）的 junction。
  electron 内创建的 junction 带 `\??\Global\` 重解析数据，**本机 node 的 lstat/readlink 把它
  报成普通目录（readlink EINVAL），fs.rmdir 会跟进目标**。
- 第二次 materialize 换出旧 out 时，neo 的删除路径按「普通目录」递归钻进该 junction，
  **把学院内容目录清空**（实测 `library/demo/academy-marker/SKILL.md` 消失，目录剩空壳）。
  角色自有技能目录同理可被吞。

## 最小复现（fixture NEO_HOME，勿用真实 ~/.neo）

1. `NEO_HOME=<tmp>/neo`；`library/demo/academy-marker/SKILL.md` 落盘；`create r1`；
   `role set r1 --domains demo`；`update --role r1`。
2. 用 **electron.exe（ELECTRON_RUN_AS_NODE=1）** 跑 vendored bundle：
   `materialize --role r1 --agent pi --out <tmp>/out --no-auth --agent-models --json` ×2。
3. 检查 `<NEO_HOME>/library/demo/academy-marker/SKILL.md`：第一次后存在，**第二次后消失**。
   （同一序列用普通 node.exe 跑则无此问题——差异在 electron 运行时创建的 junction 形态。）

## 期望

materialize 的换出/清理**永不跟进链接目标**：对链接形态（含自身 stat 不可识别的重解析点）
只用链接级删除；导出重跑不得触碰 `library/` 或角色技能内容。Cubicle 已在自己一侧改为
「每次 materialize 前自行以链接安全方式清空旧 out」，绕开该路径 —— 但 neo 自身的
converge/update 等清理面若同样经 electron-as-node 跑，仍有同类风险。

## 对 Cubicle 的影响

- 「每次派工前 materialize」是 a02 定的装配时机；不绕过时**第二次派工会静默删掉用户学院内容**，
  员工后续 run 丢技能（e2e:15 的上下文正断言当场抓到过一次）。
- Cubicle 侧已落缓解（`src/host/academy/link-safe-remove.mjs` + 装配前先清旧 out），
  e2e:15 全绿；neo 侧根治前该缓解不可撤。

## Neo 侧处置（2026-11-18，lead）

- **已复现**：普通 node 跑同一序列不复现；`ELECTRON_RUN_AS_NODE=1 electron.exe` 双跑必现
  （`library/demo/academy-marker/SKILL.md` 第二次导出后消失）。
- **已修复**（Neo `b0767f9`）：新增 `removeTreeLinkSafe`（`realpath(p) !== resolve(p)` 即链接节点，
  只做链接级删除；win 不可见重解析点走 `cmd /c rmdir`），接入 materialize 换出/暂存清理、
  launch ephemeral 清理、`roots --clean`；Neo 单测 5 例 + `pnpm verify` 655 绿。
- **Cubicle 侧**：缓解（`link-safe-remove.mjs` + 装配前自清 out）**保留**，直到 vendor 重钉到
  ≥ `b0767f9` 并复跑 e2e:15 的「同一员工第二次派工」用例；之后可撤 out 自清，
  员工槽位的 `unlinkOnly` 保护建议保留（与本缺陷无关，是装配器自身的链接安全门）。

## 关闭（2026-11-18，lead）

- vendor 重钉 `894e5bf` → `b0767f9`（bundle sha256 `056e7e84…`；`vendor/README.md` 已更新）。
- 移除 Cubicle 的「装配前自清 out」缓解（`assembly.mjs`）；员工槽位的 `unlinkOnly` 保护保留。
- 验证：electron-as-node 双跑 vendored bundle → 学院内容保留；`npm run check` 485 绿；
  `npm run build:renderer && npm run e2e:15` 绿（该 e2e 含同一员工第二次派工，正好走重复 materialize）。
