# Global Agent Member — 已确认设计（spec）

日期：2026-09-16。依据两轮代码核实、Human「重新梳理」指令、以及 Human 对方向与细节确认的完整对话写入。**行为权威仍是 `packages/` 源码与测试**；本文是决策快照，等 Human 验收后驱动实施。

## 1. 问题重述

Issue #16：同一 Agent 身份在多个 Workspace（同一仓库的不同分支 checkout）间共用，共享并维护同一份经验。Issue 未要求并行执行。

当前模型（已核实，详见 materials）：Member 被实体 `workspaceId` 字段钉在单 Workspace（48 处授权断言 + 工具写死 `workspaceId: current.workspaceId`）；Session 按 Harness 契约一对一（cwd 不可变、只能 attach 一个 Workspace）；**除此之外 Member 的一切本就全局**——memory/skills/persona/model/description 全按 memberId 键控。

## 2. 决策：参与阶梯 + 永久默认 Workspace

Member 是全局身份；"加入一个 Workspace"与"加入一个 Channel"是同一种动作——一条可 join/leave 的账本关系记录。

```text
Member（全局身份）
  │ participates in   ← 新增关系：team/member-workspace-joined / member-workspace-left
  ▼
Workspace participation  纯关系 {memberId ↔ workspaceId}
  │ joins               ← 现有：joinChannel → memberships
  ▼
Channel membership
  │ attends             ← 现有：Thread Attention
  ▼
Thread Attention
```

### 三条不可变/简化公理（Human 拍板）

1. **默认 Workspace = 创建地，永久不变**。Session 永驻默认 Workspace（cwd 固定）——**不做任何形式的 Session 移根/换根**（Human 明确：暂不考虑把 agent 彻底移入另一个 Workspace）。
2. **参与记录是纯关系**——不携带 sessionId、没有停泊 Session、没有移根生命周期。非默认 Workspace 的文件工作一律用**绝对路径**（`danger-full-access` 放行）。
3. **授权 = 参与集合包含**。`member.workspaceId` 语义改为"默认 Workspace"（不可变）；全部断言改看参与集合。

### 一个关键心智

**对 Member 来说 Workspace 是地址不是位置。** 它不需要"知道自己在哪"——每个刺激（mention、inbox hint、DM、Claim）自带 Workspace 路由；它唯一 Session 的 cwd 只是文件相对路径的解析根，与"它在哪工作"无关。

## 3. 参与生命周期

- **创建**：`member-added` 在某 Workspace 中发生 → 首个参与（= 默认 Workspace）。
- **加入**（`member-workspace-joined`，Human 触发）：参与 +1，**即时可协作**（零 Session 动作）。同时推一条通知给 Member（"你已加入 workspace X（路径）"）。
- **撤回**（`member-workspace-left`，Human 触发，仅非默认参与）：按该 Workspace 释放——Claims 释放为公开 `claims_released` Activities、Attention 结束、Channel 成员退出；成员身份、Session、其余参与不动。
- **归档**（`member-archived`，现有操作）：默认 Workspace 上的归档 = 全量归档，释放语义推广到全部参与。
- **Suspend/resume/remove**：member 级语义不变（Session 在默认 Workspace）。
- **守卫**：默认参与不可 leave（撤出默认 = 归档）；参与集合不可清空。
- **边界**：参与的 Workspace 在 DSH 侧被删，分档处理（与 §9 一致，本条旧文作废）——非默认参与由启动扫描自动撤回（system-authored `member-workspace-left`，释放其 Claims/Attention），默认 Workspace 被删则 Member 不可用（现有激活失败路径）。

## 4. Session 与 cwd 的事实边界（为什么不建新 Session）

硬约束（Harness `workspace.md`）：Session cwd 创建后不可变；一个 Session 结构上只能 attach 一个 Workspace。**没有规则要求 Member 的 Session attach 到它协作的 Workspace**——协作全是账本操作。

由此三种合法形状曾摆在桌面（逐字记录 Human 的取舍）：

| 形状 | Human 的决定 |
| --- | --- |
| A 每参与一条 Session（移根=停泊+恢复） | **不做**——"暂不考虑把 agent 彻底移入另一个 workspace" |
| B 单 Session 永驻默认 Workspace，跨参与用绝对路径 | **采纳** |
| C 单 Session 向前搬家（rollover-with-cwd） | 不选——回切丢上下文，比 A 差且同为可选层 |

形状 B 的代价已知且接受：非默认 Workspace 的相对路径会解析到默认 checkout（同 repo 多分支场景靠引导段 + 绝对路径规则管）、非默认 AGENTS.md 不自动加载（§6 自取方案）、"主战场"不可改（真要彻底搬家 = 归档后重建，文档写明）。

## 5. DSH 侧如何解析

**DSH 永远不知道有"全局 Agent"。** Member 的 Session 是默认 Workspace 里一条普通 `team-member` preset session，attach 照常。参与关系纯在 Team 层账本。Harness 零改动。

## 6. 协作、通知与 Member 自觉

- **协作操作**：全部参与放行（断言 = 参与集合包含）；Channel 入组前置 = 参与集合包含 channel 的 workspaceId。
- **工具**：协作工具加 `workspace` 寻址参数——**参与集合 >1 时必填**（schema 层按参与数切换：沉默默认到错误 Workspace 的错误类机械消除），单参与成员仍可省。全量 ref 自解析 workspace，缩写 ref 按所寻 workspace 消歧。
- **Inbox**：跨参与合并，每行带 Workspace 来源标签。
- **通知**：机制原样（mention 带正文、ordinary unread 给路由），事实源跨参与 + 来源标签。
- **DM**：发送授权 = 接收者参与集合包含本 Workspace；送达进唯一 live Session，带来源。
- **Presence**：全局真相（working 就是 working），不发明"在此 Workspace 离线"假状态；成员在每个参与列表自然出现，**不加任何归属标识**（Human 拍板）。
- **引导段注入**（参与集合 >1 才注入，member 级）：列出参与的 Workspace 与路径 + 绝对路径规则 + **AGENTS.md 自取指针**（"在某 Workspace 工作前先读 /path/AGENTS.md"）+ **歧义规则**（"指令没指明 Workspace 且有歧义时先问 @human"）。
- **Team 既有注入不受影响**：persona/memory/skills 本就 member 全局；pinned workspace 摘要、session-title 行保持**默认 Workspace** 口径；Member 查其他 Workspace 状态用 team_view（带 workspace 参数）。
- **AGENTS.md**：DSH 自动加载只认默认 cwd；非默认 Workspace 的 AGENTS.md 走"引导段给指针、Member 自取"——不复制内容（文件是唯一事实源，避免 staleness 与 prompt 膨胀）。

## 7. Human 控制面（最小集）

- **加入**：创建 Agent 对话框新增入口「从其他 Workspace 引入」→ 列出未参与本 Workspace 的既有 Member → 选中即 join，member 出现在本 Workspace 列表。
- **撤回 = 归档语义分档**：非默认 Workspace 的归档动作 = 撤回（确认文案写明"从本 Workspace 移除：释放其 Claims/关注，其他 Workspace 保持"）；默认 Workspace 的归档动作 = 全量归档（文案加"同时撤出其他 N 个 Workspace"）。
- **不加的**：无独立 leave 入口、无编辑器 Workspaces 管理区、无行上归属标识、无全局成员专区。创建流程不变（创建即首参与）。composer/@mention 不动（仍看 channel 成员资格）。

## 8. 明确不做（第一片，全部 Human 确认或推导）

- **Session 移根/换根**（形状 A/C）：Human 明确排除。
- **多根并行（B-full）**：领域扩张，另起门槛。
- **活跃参与标记 / 主战场切换**：不需要——workspace 是地址不是状态。
- **共享 profile/记忆合并**：不需要，已按 memberId。
- **记忆 CRUD Remote/UI**：候选实现夹带，超范围。
- **Harness 修改**：Session↔Workspace 一对一不变量保留。
- **Member 自助 join/撤回**：仅 Human；Member 用 `@human` 表达诉求。

## 9. Edge cases 与裁决

| Edge case | 裁决 |
| --- | --- |
| 非默认参与 Workspace 在 DSH 侧被删 | **自动撤回该参与**（system-authored `member-workspace-left`，释放其 Claims/Attention）——避免悬挂记录且无 UI 死尾；member 照常运行（Human 已确认此分档规则） |
| 默认 Workspace 在 DSH 侧被删 | Member 不可用（现有激活失败路径：unavailable + restart offered）；等价于挂起，Human 介入 |
| join 目标已有同名 live Member | **拒绝**（handle 唯一性按 Workspace，join 会造成 mention 歧义）；跨 Workspace 同名本身合法 |
| suspended member 被 join | 允许——纯账本事实，不激活 |
| 撤回与在途回复竞态 | leave 先提交则回复被拒（参与消失）——正确语义，测试钉住 |
| 撤回后历史 | Member 失去该 Workspace 协作面访问（与从未加入对称）；历史消息归因保留 |
| 中途 leave | 下一次对该 Workspace 的 op 被拒自纠；对称推 leave 通知 |
| 加入零 channel 的 Workspace | 只达 DM——与现状一致 |
| join 幂等 | 对齐 channel membership 的 `already belongs` 语义 |
| 多参与成员省 `workspace` 参数 | 参数级拒绝 + 列出可选 Workspace（schema 静态可选，校验层兜底） |
| member 级 Remote（recover/setState）从非默认 Workspace 发起 | 按参与集合放行 |

## 10. 与候选实现的关系

贡献者候选 commits（`67234ca`、`247e6ac`，评估见 materials）：断言点清单有参考价值；其形状是"dispose/rebind 跨 Workspace"，无参与关系；记忆 CRUD 不吸收。MR 到手按 §3/§6/§7 逐条核对，未对齐 spec 的 ledger 身份/schema 变更即阻塞。
