# 02: 资源装配（技能真的抵达引擎）

**What to build:** 把角色投影里的技能 / MCP 真的挂进**每个员工自己的**引擎根，并保证角色间互不可见。三个引擎各走各的既有路径，**不复制内容，只建链接**（Windows junction / POSIX symlink）：

- **pi**：`<agentDir>/skills/<name>` + `noSkills: true` + `additionalSkillPaths: [本员工的技能目录]`（否则 SDK 还会读 `~/.agents/skills`，串味）
- **codex**：`$CODEX_HOME/skills/<name>`（现成的每员工 home，只需写入）
- **dsh**：先拆掉共享的 `engines/dsh/home` —— 每员工一个 `DSH_HOME`，或改用 `customSkillDirs` 只喂该员工的路径（二选一，写清理由）
- **MCP**：从角色投影读 Neo 的 `mcp.yaml`，渲染成各引擎原生配置（pi / codex / dsh 各自的形态），密钥只接受 `env:VAR`

**Blocked by:** 01

**Status:** in-progress

- [ ] pi：员工 A 的 run 里只能看到 A 的技能（断言 `~/.agents/skills` 里的技能**不出现**）
- [ ] codex：`$CODEX_HOME/skills/<name>` 就位，且不写 `CODEX_HOME` 之外的任何用户目录
- [ ] dsh：不再共享 `DSH_HOME`；两员工并行跑时彼此看不到对方技能
- [ ] 链接是 junction/symlink 而非副本（断言 inode/link 类型，删角色技能后员工侧断开而非留副本）
- [ ] MCP：`env:VAR` 之外的值被拒绝；未配置 MCP 时行为与今天一致（三引擎仍传空）
- [ ] 临时路径仍标 `TODO(materialize)`：装配集合由 01 的投影算，Neo 01 落地后改成调它
- [ ] `npm run check` 全绿

## Answer

（完工时填：改了什么 / 怎么验证 / 判断项）
