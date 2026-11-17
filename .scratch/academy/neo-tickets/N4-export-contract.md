# N4: materialize 导出合同修补（T1–T5）· 交接记录

> 跨仓库索引票。**归属裁定（人工，2026-11-17）**：Neo 侧任务一律以工单形式提给 Neo 项目处理；Cubicle 侧不再直接实现 Neo 代码。

## 工单

与 Neo 仓库 `.scratch/academy/issues/04-export-contract.md`（Cubicle 侧提单 `00eedd6`）同体：T1 `mcp.envRefs`、T2 env 存在性校验只归 `run`、T3 `--no-auth`、T4 `--agent-models`、T5 help 文案。

## 现状（2026-11-17 撤销后）

- 按人工裁定「Neo 任务归 Neo 项目」，Cubicle 侧全部 neo 代码已回撤：neo main 上现为一串 Revert（`80f9bfc` 票 04、`e24a1f1` 票 03、`d58dc37` 票 02、`21ed91f` 票 01），票面复位 ready-for-agent；`pnpm verify` 复跑绿。
- Cubicle 侧留存的实施参考：`handoff-fa37a6c.patch`（票 01）、`handoff-447ee80.patch`（票 02）、`handoff-4ee1dcd.patch`（票 03）、`N4-export-contract-handoff.patch`（票 04）。Neo 项目可按 T 系列自行重落，语义与代码均可改写。
- **Cubicle 的 vendored CLI（`vendor/neo/bin/neo.js`，pin `4ee1dcd`）不受回撤影响**：pin 提交对象永久存在、bundle 已内置三票功能，装配链路照常；T1–T4 的合同（`envRefs`/`--no-auth`/`--agent-models`）要等 Neo 项目重落稳定后再钉新 pin。

## 移交 Neo 项目的两个安全尾巴

1. 悬空对象 `ca263ed`（无分支引用）的对象库内含一份当时临时 `NEO_HOME` 的 **auth.json 副本**（本机 pi 凭据派生）。建议人工确认后 `git gc --prune=now`（或等默认 gc 策略），并确认 `--out` 类临时目录一律在 `.gitignore`（已随 `25964c5` 的 `.gitignore` 修正覆盖 `tmp/`）。
2. 一次 `NEO_HOME` 为空的 `node dist run pi` 在模型前置闸 exit 1（未达 convergeRoot、未 spawn）；真实 `~/.neo` 判定为只读，未被写入。

## 归责更正（此前记录的修正）

本 effort 期间 Cubicle 侧曾在票面写下「不存在任何第三方写入者」的裁定——**该表述不实**：Neo 项目一侧确有并行会话（处理 T 系列改进、review 记录、`447ee80`/`25964c5` 合并等均出自该侧）；同时 Cubicle 自家若干会话也存在失忆后的自我误归因（agent-3/5/6 自认）。两侧并发的完整时间线以两边 reflog 为准，人工终裁。

## Cubicle 侧后续（等 Neo 项目把 T1–T5 稳定后）

- vendor 重新钉到含票 04 的 neo main commit（`--no-auth` + `--agent-models` + `envRefs` 合同）。
- 翻转 `CUBICLE_ACADEMY_MCP` 默认（T1/T2 已落地时），MCP 装配从「等 T」转「接」。
- `e2e:15`（票 a04）按新 vendor 合同跑技能链；MCP 只加装配层断言，不进正反断言主面。
