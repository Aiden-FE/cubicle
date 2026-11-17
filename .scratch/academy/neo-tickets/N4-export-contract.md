# N4: materialize 导出合同修补（T1–T5）· 已作废

> **状态：作废（2026-11-17 19:0x）。** T1–T5 已由 lead 在 Neo 侧恢复并逐项复验（Neo `894e5bf`；`pnpm verify` 40 文件 / 650 测试绿，T1–T5 在临时 `NEO_HOME` 上手打通过）。

## 作废原因

这张票与它附带的三份 `handoff-*.patch` / `N4-export-contract-handoff.patch` 是把 **Neo 仓的源码搬进 Cubicle 仓**——越界的另一种形式。已全部删除。

Cubicle 侧的职责从今往后只有：

- 消费 Neo 的 npm 包/CLI（vendor 版本钉住）；
- 需要 Neo 改动时，按 [`impl/SCOPE.md`](../impl/SCOPE.md) 写**只含现象与期望**的交接票，等 lead 转交。

## 对 Cubicle 的实际影响（保留，供施工参考）

导出合同现为（Neo `894e5bf`，`neo materialize --help` 为准）：

- `--json` 清单含 `mcp.envRefs`（引用形状，不含值）与 `authExcluded`、`model.owner / reason`；
- 外部宿主恒传 `--no-auth`（不导出凭据副本）；
- 模型由宿主自带 → 恒传 `--agent-models`；
- `--out` 必须是本命令独占目录（`root.json` marker）。
