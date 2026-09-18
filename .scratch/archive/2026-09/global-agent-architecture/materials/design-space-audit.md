# 设计空间审计 — issue #16 全局 Agent 成员

研究证据材料（2026-09-11 首轮核实、2026-09-15 复核）。file:line 为当时证据，实施时以当前代码为准。结论已固化进 `../spec.md`；本文件保留推理过程与候选实现评估，供 reviewer 与后续上下文接续。

## 案卷

- 上游：[issue #16](https://github.com/wowyuarm/dsh-agent-team/issues/16)（作者 jw5555555555，2026-09-11）：多个 Workspace 是同一仓库不同分支 checkout 并行开发，希望 Agent 跨 Workspace 共用、共维一份经验；已 fork 自测，预告提 MR。
- Human 公开回复（同日）：方向不排斥，视改动面与设计再讨论，先看 PR。
- Team 工作线：thread:34600db8 / task:d00c53fb（#73）。Human 2026-09-15 指令：重新梳理、开 scratch、完成后通知验收。

## 已核实硬约束（2026-09-15 复核后仍成立）

1. **Member.workspaceId 是身份级不可变字段**：`addMember` 写入绑定；lifecycle 校验原样携带，改动报 `invalid Member update`；handle 唯一性按 Workspace 强制。
2. **授权面按 Workspace 断言**：`ledger.ts` 44 处 + `index.ts` 4 处 `workspaceId !==` 类检查；明确错误四类（mutate / view / inspect / Member-Channel 同 Workspace）。
3. **Session↔Workspace 结构性一对一**：激活按 `meta.cwd = workspace.path` 建/续 Session 并 `attachSession`；Harness Workspace 契约要求 session 在列且 canonical cwd 相等——一个 Session 结构上只属于一个 Workspace，**此约束不动**（deepseek-harness docs/subsystems/workspace.md）。
4. **Host 运行时单活体**：`handles: Map<memberId, AgentHandle>`、`memberBySessionId: Map<sessionId, memberId>`、model/presence/recovery/rollover/DM 送达均假设一个 memberId 一个 live handle。
5. **私有记忆/技能已按 memberId 键控于 host 级目录**（`dshHomePath('agent-team','members',…)`），与 Workspace 无关 ⇒ **身份一份 ⇒ 经验一份是现有事实，不需要共享根**。
6. **投影不持久化**：sqlite `unit_globals` 为空，每次从账本重建 ⇒ Member 实体形状演进走 replay 兼容，无迁移窗口。

## 形状空间（四选一）

| 形状 | 内容 | 判定 |
| --- | --- | --- |
| **A 共享经验根** | 身份仍按 Workspace，同 profile 共享 memory/skills | 不足：只解决经验共享，身份仍碎；还引入「同一时刻只能一个 live writer」的写权问题 |
| **B-lite 单活参与** | 身份一份 + 显式参与集合，同一时刻一个参与扎根活 Session；切根按目标 cwd 建/换 Session，旧 Session 停泊 | 曾采纳后被简化：Human 明确不做 Session 移根 → 最终形状 = 参与关系 + **Session 永驻默认 Workspace**（spec §2/§4 的"形状 B"） |
| **B-full 并发多根** | 每参与一个 live Session 同时跑 | 领域升级：唤醒路由、并发 Claim、注意力预算、memory 写协调全部要新规则；记为后续门槛（spec §6） |
| **C 模板+实例** | profile 模板 + 每 Workspace 独立 Member 实例 | 经验分叉，直接违背诉求，排除 |

## 候选实现评估（refs/temp/jw5555555555-master）

- `67234ca feat: support global agents across workspaces`：放松账本可见性/成员资格断言、加动态 workspace 解析，但运行时仍 `Map<memberId, handle>`，切换目标时 dispose/rebind —— **是跨 Workspace rebind，不是并行执行**；未定义停泊期间 Claims/Attention/通知语义。
- `247e6ac feat: support viewing and editing member memory with role guidance`：记忆 CRUD Remote/UI，**超出 issue 范围**，且评审所见版本缺 Workspace 授权——不作为设计权威，不吸收。
- 结论：方向与本 spec 的「参与关系」骨架相容的部分是断言点清单；授权放宽形状与缺省语义须按 spec §3/§6/§7 重做。MR 到手按 spec 逐条核对，不合未对齐的 ledger 身份/schema 变更。

## PR/实施评审清单（顺序即优先级）

1. **形状判定**：A / B-lite / B-full？是否回答了「同时活跃与否」「切换或并发时旧 Workspace 成员资格/Claim/Attention 如何处置」「共享范围是否含 Session 历史」。
2. **未对齐 spec 的 ledger 身份/schema 变更 = 阻塞**：Member 实体形状与 operation 种类的变更必须先对齐。
3. **授权不得削弱**：每一处 workspace 断言放宽都要给出参与判定替代与测试，不许变「跳过检查」。
4. **Session/Workspace 不变量**：换 Workspace 必须按目标 cwd 建/换 Session；不得复用 cwd 不匹配的 Session（Harness 会拒）。
5. **并发语义（仅 B-full）**：唤醒路由、并发 Claim、注意力预算的明确规则与失败模式。
6. **测试与 diff 卫生**：可评审拆分、带测试；独立验收与落地按 Team 分工。
7. **归档**：采纳后 durable 决策进 `docs/domain-model.md`（Member↔Workspace）与 `docs/architecture.md`。

## 关键推理记录（为什么这么定）

- **「共享经验」已经免费**：约束 5 意味着只要身份是一份，记忆就是一份；issue 的真实缺口是「一个身份能不能在多个 Workspace 留下协作事实并轮流执行」，不是记忆存储。
- **Session 永驻默认 Workspace**（Human 拍板，最终形状）：cwd 不可变 + 一个 Session 只能 attach 一个 Workspace 是 Harness 结构契约，但没有任何规则要求 Member 的 Session attach 到它协作的 Workspace——参与纯是账本授权事实，Session 只是默认 Workspace 的 cwd 解析根。非默认 Workspace 的文件工作用绝对路径，AGENTS.md 用引导段指针自取。移根/停泊方案（曾考虑的 B-lite）整体放弃，消除整个 Session 生命周期机制面。
- **授权与执行是两轴，而最终只留下了授权轴**：账本协作操作不需要 cwd——「参与集合管能去哪」独立成立，join 即协作、零 Session 机制；通知/Inbox 的 member 全局投影原样通用。
- **协作与执行是两轴**：账本协作操作不需要 cwd——「参与集合管能去哪，扎根管 Session 根在哪」拆开之后，join 即协作、Session 只为扎根存在，通知/Inbox 的 member 全局投影原样通用。
