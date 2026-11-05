# 01: M0 探路闸门

**What to build:** 一个可重复运行的 spike，回答三个致命假设：Electron 运行时内嵌的 Node 版本是否 ≥ 22.19；pi SDK 能否在 utilityProcess 中启动会话并流式吐事件；本机 codex CLI 的 headless 输出能否被稳定解析成统一事件。结论写成一份记录：版本、判定、以及失败时的备选路径。

**Blocked by:** None（可立即开始）

**Status:** done

- [x] 打印并记录 Electron 内嵌 Node 版本，明确判定是否满足 pi 的 ≥22.19 要求
- [x] 在 utilityProcess 中启动 pi 会话，收到至少一条文本增量与一次工具调用事件
- [x] 把 codex headless 输出解析成统一事件（至少：文本片段、工具调用、结束状态）
- [x] 记录结论与三条备选路径（换 Electron 版本 / pi 降级为 CLI 宿主 / 暂缓 codex）
- [x] spike 可用一条命令重跑，结论写入 `docs/spike-m0.md`

## 完成记录

2026-11-05 三关全过：Electron 45.2.1 内嵌 Node 24.22.1；pi 1.5.0 SDK 在 utilityProcess 吐出 6 条 text delta + 一次 `read` 工具调用；codex-cli 0.163.0 的 JSONL 归一化为文本 / shell 工具 / turn end（工具 exit 0；脱敏抓取见 `test/fixtures/codex-exec-live.jsonl`）。

- 重跑：`npm run spike`（可用 `--only=node|pi|codex`；无 codex 凭据时 `--skip-codex`）
- 结论与备选路径：[docs/spike-m0.md](../../../docs/spike-m0.md)
