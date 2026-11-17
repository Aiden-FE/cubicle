# 施工范围（硬约束）

> 这是 Cubicle 侧**所有会话**的写入边界。与任何票面、任何口头指令冲突时，**以本文件为准**。
> 生效：2026-11-17 · 由 lead 写死 —— 起因是一次跨仓库越界，导致 Neo 侧整个 effort 被回滚。

## 1. 你能写的

- `C:\Users\Aiden\dev\aiden\cubicle` 内的一切（含 `tmp/`）。
- 系统临时目录，仅限构建需要（`TMPDIR / TEMP / TMP` 指到仓库内 `tmp/esbuild-tmp`）。

**除此之外一律只读。**

## 2. 硬红线（写进去就退回整批）

| 路径 | 权限 | 说明 |
|---|---|---|
| `C:\Users\Aiden\dev\aiden\neo` | **只读** | 连同它的 `.git`：不许建分支、不许提交、不许 `git apply`、不许把它的源码/patch 复制进本仓。要参考实现就 `git show <sha> -- <path>` 或直接读文件。 |
| `~/.neo` | **只读** | 唯一写者是 `neo` CLI；应用与脚本都不许直接写。 |
| 其他任何仓库 | 只读 | 同上。 |

## 3. 发现 Neo 有缺陷/缺能力时

1. 在 `.scratch/academy/neo-tickets/` 新建一张**交接票**，只写：现象 / 最小复现 / 期望 / 对 Cubicle 的影响。
2. **不许附代码、不许附 patch、不许附补丁分支、不许附"参考实现"**。
3. 在自己的票里停住，等 lead 转交 Neo 处理；不要自己去 Neo 仓实现或提交。

## 4. 每次收工必须贴

```
git status --short
git log --oneline -5
```

加上本次验收命令的输出（`npm run check` / `npm run e2e:NN`）。lead 验收会**同时对两个仓库核对来源**；一旦发现 Cubicle 侧写进 Neo，整批退回。

## 5. 本 effort 的文档读写权限

| 路径 | 权限 |
|---|---|
| `.scratch/academy/map.md`、`.scratch/academy/issues/`、`neo-tickets/N1`–`N3` | **只读**（决策与票据，lead 维护） |
| `.scratch/academy/impl/` | 可写（你的票、验收记录、Answer） |
| `neo-tickets/N4` 及任何 handoff patch | **禁止新增**；已有的已作废（见 N4） |

## 6. 为什么这么凶

18:06–18:41，Cubicle 会话树里的一个实施 agent 直接进 Neo 仓建分支、实现了 Neo 的功能、并把一份带 `tmp/` 导出物的提交留在对象库里；Neo 侧随后把这些改动合并，最终整批回滚。代价是两边各损失一小时以上、Neo 的 01–04 全部作废重来。**跨仓库"顺手帮忙"在这里等价于事故。**
