# 02 — 跨参与协作面与 Member 自觉

**What to build:** 让多参与 Member 真正能干活且知道自己在哪干活：协作工具加 `workspace` 寻址参数（**参与集合 >1 时必填**——沉默默认到错误 Workspace 的错误类机械消除）；`team_inbox` 跨参与合并且每行带 Workspace/Channel 来源标签；通知 hint 事实源覆盖全部参与；**多 workspace 引导段注入**（列出参与的 Workspace 与路径 + 绝对路径规则 + AGENTS.md 自取指针 + 歧义先问 @human）；join 提交时推一条通知让 Member 当下知晓；team_view/persona 如实呈现参与集合与默认 Workspace。

**Blocked by:** 01（参与关系与授权）。

**Status:** done（worktree commit 0b27b74；对抗用例的模型时序断言由确定性断言替代，理由见 README frontier 3）

背景与边界（自包含）：

- Member 的工作路由是数据驱动的：每个刺激（mention/inbox hint/DM/Claim）自带 Workspace 地址，prompt 只补薄教学 + 必填参数兜底。
- 引导段仅当参与集合 >1 时注入（单参与 Member 的 prompt 零变化）；join 通知让 Member 即时知晓新参与，不等 prompt 重建。
- AGENTS.md 方案 = 引导段给指针、Member 自取——不复制文件内容（唯一事实源、无 staleness）。
- Team 既有注入不变：persona/memory/skills 全局；pinned 摘要/session-title 行保持默认 Workspace 口径。
- 「不泄漏」边界只剩一条：不经请求的上下文注入不发生。
- Presence 是全局真相；非默认 Workspace 中 Member 正常显示（参与于此 = 可达）。

- [x] 协作工具 `workspace` 参数：多参与成员缺省时**参数级拒绝**并列出可选 Workspace（schema 静态可选，校验层兑底）；显式指定寻址对应参与，未参与的显式拒绝
- [x] join/leave 对称通知：参与变动提交时向 Member 推通知（"你已加入/退出 workspace X（路径）"），当下知晓不等 prompt 重建
- [x] `team_inbox` 跨参与合并未读，每行带 Workspace/Channel 来源标签；分页排序语义不变
- [x] 通知 hint 覆盖全部参与，文案带来源；dedup 签名机制不变；非默认参与 mention/DM 送达唯一 live Session（带来源）
- [x] 引导段注入：参与集合 >1 时注入 workspace 列表+路径+绝对路径规则+AGENTS.md 指针+歧义问 @human；=1 时零变化
- [x] team_view/persona/工具描述如实呈现参与集合与默认 Workspace
- [x] 协作事实渲染带 Workspace/Channel 来源标签（team_view/team_inbox/team_thread 一致）
- [x] 对抗用例：B 参与 mention → live Session 收到带来源提示；回 B 的 Thread 正常提交且归因正确；忘传 workspace → 必填拒绝而非沉默默认到 A
