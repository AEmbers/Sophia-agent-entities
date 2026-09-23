# Sophia-agent-entities 开发文档

> 版本：v0.1（草案）
> 日期：2026-09-20
> 对应需求：`docs/REQUIREMENTS.md` v0.1

---

## 1. 技术选型

| 层面 | 选型 | 理由 |
|---|---|---|
| 宿主运行时 | DeepSeek Harness（DSH） | 上游两项目共同宿主，插件机制成熟 |
| 插件规范 | Cordis Plugin（Host + Client 两半） | 能在宿主注册 Service / Remote / Slot |
| 语言 | TypeScript 5.x（strict） | 上游两项目均为 TS，可直接参考 |
| 包管理 | pnpm workspace | 上游 `dsh-agent-team` 即 pnpm monorepo |
| 打包 | tsdown（ESM 输出） | 上游 `client-agent-team` / `dsh-agent-teams` 均用 tsdown |
| 前端 | React + CSS Modules | 与 DSH Web UI 槽位体系一致，避免样式串扰 |
| 持久化 | SQLite（只追加事件账本） | 复用 `dsh-agent-team` 的 `vendor/storage-sqlite` 思路 |
| 测试 | vitest + UI 预览脚本 | 上游已有 vitest 配置与 preview 脚本可参考 |
| 可视化 | 自研 SVG 依赖树画布 | 参考上游依赖树表现，需支持 100 节点级交互 |

## 2. 仓库结构

```
Sophia-agent-entities/
├── dsh-agent-team/          # 上游收录（只读参考，不修改）
├── dsh-agent-teams/         # 上游收录（只读参考，不修改）
├── docs/
│   ├── REQUIREMENTS.md      # 需求书（本文件同目录）
│   └── DEVELOPMENT.md       # 开发文档
└── packages/                # 新框架（本期新建）
    ├── sophia-core/         # 领域模型 + 账本 + 契约
    ├── sophia-engine-team/  # 持久团队运行时
    ├── sophia-engine-dag/   # DAG 调度与门禁
    ├── sophia-tools/        # 暴露给 Agent 的工具集
    └── sophia-client/       # Web 界面（槽位 + 画布 + 面板）
```

## 2A. 角色模型：宿主 / 团长 / 成员（核心设计）

> 这是 `Sophia-agent-entities` 与上游最根本的架构分歧，也是解决「僵尸团」的关键。

**上游问题**（有代码实证）：上游把团队绑定在窗口会话 ID 上 ——
`dsh-agent-teams/src/types.ts:248` 的 `captainSessionId`，配合 `src/state.ts:384` 的归属判定
（`team?.captainSessionId === agentSessionId`）。后果：

| 现象 | 根因 |
|---|---|
| 窗口关了，团还在磁盘上 | `team.json` 是持久文件，不随窗口消失 |
| 但团再也办不了事 | 它的 `captainSessionId` 指向死会话，无人能唤醒 |
| 仍占资源 | 成员 session 记录、邮箱、状态都还在 |

且 `src/state.ts:388` 强制「一个会话只能属于一个团队」，否则报归属歧义 ——
这与「任意窗口都能给团发任务」直接冲突。

**我们的设计**（以「皇帝下旨」为喻）：

```
【人类 · 皇帝】
      │ 下旨
      ▼
【窗口会话 · 传旨小秘 / Host】   ← 随时可换；不绑团；关了也不影响团
      │ 转达旨意
      ▼
【持久团 · 独立实体 teamId】
      ├─ 监正 · Principal（团长 = 架构老大）  ← 团内成员，对技术决策负责
      │     └─ 第一级审批：成员要开持久团时先过他
      ├─ 灵台郎 · Member
      │     └─ 开子团（归他个人所有）
      └─ 推步主事 · Member
```

**三权分立**：

| 角色 | 职责 | 绑定 | 生命周期 |
|---|---|---|---|
| `Host` 宿主（窗口） | 传旨、呈送草案、接收审批 | ❌ 不绑团 | 随窗口起落 |
| `Principal` 团长（监正） | 技术决策、第一级审批、团内存续 | ✅ 绑团 | 与团同生共死 |
| `Member` 成员 | 干活 | ✅ 绑团 | 与团同生共死 |

**配套实现要点**：

1. **拆掉单锚定**：团的存在性锚点是 `teamId`，**不是** `hostSessionId`。
   宿主与团的关联是**多对多、可替换**的引用，不是所有权。
2. **常驻调度体**：需要有一个不依附任何窗口的运行体来驱动团（唤醒成员、推进任务）。
   这是本项目**最大的工程难点**，须在 M4 专门解决 —— 上游的调度器依附于 captain 的 live turn，
   窗口一关就没有驱动源。
3. **代孕创建**：窗口建团壳 → 以团的名义生成首任监正 → 完成解耦（FR-5.0.4）。

## 3. 模块职责

### 3.1 `sophia-core`

| 文件 | 职责 |
|---|---|
| `src/index.ts` | 插件入口，Service 注册，Remote 方法汇总 |
| `src/ledger.ts` | 只追加账本：提交、读取、scope 变更计算 |
| `src/types/entities.ts` | Workspace / Channel / Member / Task / DagTeam 实体 |
| `src/types/operations.ts` | 账本事件类型（channel-created、member-added、dag-owner-transferred …） |
| `src/types/requests-results.ts` | Remote 请求/响应契约 |
| `src/naming.ts` | 命名门禁 `^Sophia[\u4e00-\u9fa5][\u4e00-\u9fa5_0-9]*$` |
| `src/staging.ts` | 双模草案 `StagingDualPlan` 生成 |

### 3.2 `sophia-engine-team`

| 文件 | 职责 |
|---|---|
| `src/member-runtime.ts` | 成员激活 / 句柄缓存 / 工具策略注入 |
| `src/channel.ts` | 频道成员、消息、Task Thread 推进 |
| `src/context-continuity.ts` | rollover / checkpoint / 上下文接力 |
| `src/notify.ts` | 空闲 `followup` / 忙碌 `steer` 双通道唤醒 |
| `src/delegate.ts` | 任务下派为嵌套子 DAG（FR-5） |

> **上游演进提示（2026-09-20 同步）**：上游已把上下文延续抽成**独立引擎包**
> `context-continuity`（`dsh-agent-team/packages/agent-team/src/context-continuity-host.ts`
> 作为 Team 侧的绑定层），原先的 `context-management.ts` **已被删除**。
> 我们的 `sophia-engine-team` 是否直接复用该引擎、还是自持实现，
> 待 M2 立项时评估 —— 复用可省大量工作，但要接受它对「谁是 Team notice」等
> 两个维度的外部注入约定（见该文件头部注释）。

### 3.3 `sophia-engine-dag`

| 文件 | 职责 |
|---|---|
| `src/scheduler.ts` | 拓扑就绪计算、派发、并发上限 |
| `src/owner-guard.ts` | 归属权校验、越权拦截、移交（FR-7） |
| `src/quality-gates.ts` | 需求→实现→验证→评审→集成 门禁链 |
| `src/snapshot.ts` | DAG 状态快照与恢复 |

### 3.4 `sophia-engines` 通用：团队派生策略（核心新逻辑）

> **上游无此概念**，本节是我们的自有设计。上游 `dsh-agent-teams` 只有一个统一整数
> `maxDepth`（`src/members.ts:731` 的 `installMemberDelegationGuard(ctx, stateDir, maxDepth)`），
> 对所有成员一视同仁，且**默认值为 `0` 即完全禁止派生**（`src/index.ts:71`）。
> 我们要的是「按团队类型分权的矩阵」，因此不能用它，须自建。

```ts
/** 团队类型：持久 / 临时 */
type TeamKind = 'persistent' | 'temporary'

/** 发起方类型（由其所处团队的 kind 决定） */
type CallerKind = TeamKind

/** 一个派生申请：成员想开一个什么样的团 */
interface SpawnRequest {
  readonly requesterMemberId: string
  readonly requesterKind: CallerKind
  readonly targetKind: TeamKind
  readonly spec: TeamSpec        // 拟建团的成员名册 + 任务
}

interface DelegationPolicy {
  /** 该发起方允许创建的目标团队类型 */
  readonly canSpawn: readonly TeamKind[]
  /** 目标类型 → 是否需要人类批准（两级审批） */
  readonly requiresApproval: Readonly<Record<TeamKind, boolean>>
}

/** 持久成员：两类都能开；持久团须两级审批，临时团免审 */
const PERSISTENT_POLICY: DelegationPolicy = {
  canSpawn: ['persistent', 'temporary'],
  requiresApproval: { persistent: true, temporary: false },
}

/** 临时成员：只能开临时团，且免审 */
const TEMPORARY_POLICY: DelegationPolicy = {
  canSpawn: ['temporary'],
  requiresApproval: { persistent: true, temporary: false },
}

function policyOf(caller: CallerKind): DelegationPolicy {
  return caller === 'persistent' ? PERSISTENT_POLICY : TEMPORARY_POLICY
}

/**
 * 派生入口：按策略决定「直接创建」还是「进入两级审批」。
 * 注意：深度不设层数上限 —— 控制手段是审批门（FR-5.2.2）。
 */
async function requestSpawn(req: SpawnRequest): Promise<SpawnOutcome> {
  const policy = policyOf(req.requesterKind)

  // 1. 权限：临时成员开持久团 → 直接拒，并说明原因（FR-5.2.1）
  if (!policy.canSpawn.includes(req.targetKind)) {
    throw new Error(
      '临时成员无权创建持久团队。临时成员只能创建临时团队；' +
      '如需长期编制的团队，请把需求汇报给团长，由持久成员发起。',
    )
  }

  // 2. 免审路径：临时团直接建（FR-5.3.5）
  if (!policy.requiresApproval[req.targetKind]) {
    return { kind: 'created', teamId: await createTeam(req) }
  }

  // 3. 审批路径：持久团走两级（FR-5.3）
  return await beginTwoStageApproval(req)
}

/**
 * 持久团创建的两级审批：① 团长预审 → ② 推送人类收件箱 → 人类批准 → 创建。
 * 第二级复用上游已有的 Web 审批机制（awaiting_review + Approve & Run），
 * 但审批请求走「人类收件箱」通道，使任意窗口都能看到待办。
 */
async function beginTwoStageApproval(req: SpawnRequest): Promise<SpawnOutcome> {
  const principal = await principalOf(req.requesterMemberId)   // 该成员所属团的监正

  // ① 第一级：团长预审
  const verdict = await principal.reviewSpawn(req)
  if (!verdict.approved) {
    // 打回并说明理由；成员不得降级为临时团绕开（FR-5.3.4）
    return { kind: 'rejectedByPrincipal', reason: verdict.reason }
  }

  // ② 第二级：推送人类收件箱（任意窗口可见）
  const ticket = await ledger.commit({
    kind: 'spawn/awaiting-human-approval',
    requesterMemberId: req.requesterMemberId,
    principalMemberId: principal.memberId,
    targetKind: req.targetKind,
    spec: req.spec,
    raisedAt: Date.now(),
  })
  await humanInbox.push({
    ticketId: ticket.id,
    title: `成员请求创建持久团：${req.spec.name}`,
    actions: ['approve', 'reject'],
  })

  return { kind: 'awaitingHumanApproval', ticketId: ticket.id }
}

**为什么不用层数限制**：控制手段是**审批门**而非**深度闸**（FR-5.2.2）。
每开一层持久团都要过「团长预审 + 人类批准」，因此可无限嵌套而不会失控。
好处是人的判断取代了硬编码的魔数 —— 该不该多开一层，由你和监正按实际情况决定。

**父成员回收时的子团处置（FR-5.6 实现）**：

```ts
/** 父成员被回收/销毁时，把其名下子团转挂到最近的存活祖先 */
async function reattachOrphanedTeams(removedMemberId: string): Promise<void> {
  for (const team of await teamsOwnedBy(removedMemberId)) {
    const ancestor = await nearestLivingAncestorOf(removedMemberId) ?? await captainOf(team)
    await ledger.commit({ kind: 'team/ownership-reattached',
      teamId: team.id, from: removedMemberId, to: ancestor.id, reason: 'parent-removed' })
    // 不级联销毁：保留子团已完成的工作成果
    // 不冻结：避免产生无人认领的僵尸团
  }
}
```

### 3.5 `sophia-tools`

| 工具名 | 作用 |
|---|---|
| `sophia_team_message` | 成员间消息 |
| `sophia_task_claim` | 认领任务 |
| `sophia_delegate_dag` | 下派子 DAG（含归属声明校验） |
| `sophia_spawn_team` | 派生持久/临时团（**过 FR-5.2/.3 权限矩阵校验**） |
| `sophia_switch_model` | 申请换模 |
| `sophia_context_rollover` | 上下文接力 |

### 3.6 `sophia-client`

| 文件 | 职责 |
|---|---|
| `src/client/index.ts` | 槽位注册入口 |
| `src/client/StagingDualPlanEditor.tsx` | 双模草案 + 模式单选 + Approve & Run |
| `src/client/ActivityPanel.tsx` | 活动面板（进度分段条 / 成员卡 / 阻塞提示） |
| `src/client/DagCanvas.tsx` | 全屏依赖树画布 |
| `src/client/MemberRow.tsx` | 成员行（头像 / 命名 / 模型切换 / 生命周期操作） |
| `src/client/SophiaSidebar.tsx` | 侧边导航（频道 / Agents） |
| `src/client/tokens.ts` | 设计令牌（色板 / 圆角 / 间距） |
| `src/client/locales.ts` | 中英文案 |

## 4. 关键接口契约

```ts
/** 双模草案 */
interface StagingDualPlan {
  planId: string
  workspaceId: string
  goal: string
  teamPlan: {
    channelId: string
    members: Array<{ memberId: string; label: string; role: string }>
    threads: Array<{ title: string; assignee: string }>
  }
  dagPlan: {
    roster: Array<{ label: string; provider: string; model: string }>
    tasks: Array<{ id: string; name: string; deps: string[]; assigneeLabel: string }>
  }
}

/** Remote 面 */
createChannel(req):    Promise<ChannelResult>
addMember(req):        Promise<MemberResult>       // 内部先过命名门禁
generateStagingPlan(): Promise<StagingDualPlan>
approveAndRun(req: { planId, mode: 'persistent-team' | 'dag-scheduler' }): Promise<RunResult>
switchMemberModel(req: { memberId, provider, model, reason }): Promise<void>
transferDagOwnership(req: { dagTeamId, from, to }): Promise<void>
suspendMember(req: { memberId }): Promise<void>
resumeMember(req:  { memberId }): Promise<void>
destroyMember(req: { memberId, force }): Promise<void>
```

## 5. 账本事件类型（首批）

| 事件 kind | 触发 |
|---|---|
| `team/channel-created` | 新建频道 |
| `team/member-added` | 新建成员（命名门禁已过） |
| `team/member-model-switched` | 换模 |
| `team/member-suspended` / `team/member-destroyed` | 生命周期 |
| `team/thread-started` | 任务/消息提交 |
| `plan/approved` | 人类核准（含选中模式） |
| `dag/team-created` | 新建 DAG 团队（含 owner） |
| `dag/ownership-transferred` | 归属移交 |
| `dag/task-state-changed` | DAG 任务状态流转 |

## 6. UI 选型（待人类决策）

### 方案 A：融合式单视图（推荐）

- **形态**：左栏沿用经典导航（工作区 / 频道 / Agents）；主区自上而下为「活动面板（可折叠）」+「Task Thread 消息流」；底部「任务依赖速览」可点开全屏依赖树画布。
- **优势**：与现有 DSH UI 认知一致，持久团队体验零迁移；DAG 与 Team 共用同一套面板，FR-4 的差异只体现在数据而非界面。
- **代价**：单页信息密度偏高，小屏需折叠策略。

### 方案 B：双栏并置

- **形态**：左栏普通频道流，右栏常驻 DAG 画布（可拖拽调宽）。
- **优势**：调度状态始终可见，适合长时间盯盘。
- **代价**：画布长期占位，纯聊天场景浪费横向空间。

### 方案 C：画布优先（Tab 切换）

- **形态**：主区顶部 Tab：`频道` / `拓扑` / `成员`；拓扑页为全屏画布。
- **优势**：画布渲染面积最大，视觉冲击强。
- **代价**：跨页切换打断「边聊边看进度」的连续感。

### 6.1 成员视觉规范：索菲亚 OC 头像体系（三案共用 · 双轨制）

成员头像**不使用通用图标库**，改用索菲亚 OC 形象：每个成员是索菲亚的一个职责切面。

**本体系由两条轨道组成**，2026-09-20 接入外部素材后从单轨升级为双轨：

| 轨道 | 资产 | 适用尺寸 | 状态 |
|---|---|---|---|
| **轨道 1 · 位图立绘** | `assets/members/out-512/`（20 张 512×512 RGBA） | ≥ 40px | ✅ 已接入 |
| **轨道 2 · 分层 SVG 差分** | `packages/sophia-client/assets/oc/` | < 40px（含 24px 极小人） | 计划中 |

**为什么必须双轨**（2026-09-20 决策，含实测依据）：

> ⚠️ **原"轨道 2 自绘分层 SVG"的定位已变更**：原设想是让轨道 2 承担小尺寸。
> 但经主人在 24px 场景实测后决策 —— **小尺寸直接用轨道 1 的 PNG 原样，
> 不转 SVG、不新增自绘差分**。轨道 2 降级为「仅在未来确有需要时才启用」的备选。

**实测依据**（`.scratch-vec` 已清理，证据图保留在 `assets/members/_inspect/`）：

| 方案 @24px | 观感 | 结论 |
|---|---|---|
| **PNG 原样** | ✅ 主色、道具、背景均可分辨 | **采用** |
| PNG + 锐化 | ⚠️ 边缘略硬，面部起噪点 | 不采用 |
| SVG（VTracer 精度6） | ⚠️ 脸部发灰发平，丢细描边 | **比 PNG 更糊** |
| SVG + 锐化 | ⚠️ 锐化救不回（输在源头信息量） | 不采用 |

**关键实测数字**：VTracer 无损档（`colorPrecision:6`）输出 **797 KB**，是原 PNG（571 KB）的 **1.20 倍**；
且输出 `<g>` 分组数为 **0**、`<path>` 数 **1,757** —— 即**没有任何图层结构**，
颜色全部写死在每条路径上（无法换色、无法复用）。

**25 张第一梯队 @24px 目视复核**（`_inspect/tier1_at24.png`）：五张主色与道具区分明确
（蓝底举龟 / 青底星图 / 暖桃底持书 / 米底抱书 / 紫底持物），证实 24px 下**可分辨**。

> 我曾两次给出过强判断（先说"位图转 SVG 做不到"，后说"24px 糊成一团"），均已被上述实测推翻。
> 记录在此，是为了后来者不要重走这两条弯路。

#### 6.1.0 轨道 1 素材已接入（20 张 / 4 梯队）

素材落地于 `assets/members/`，命名体系为**中国古代天文机构职官**
（钦天监 / 灵台 / 推步 / 历算），4 梯队 × 5 人 = 20 位成员。
花名册、职责映射、独立复核结论见 **`assets/members/README.md`**。

三项已实测的素材特性，直接约束 UI 实现：

1. **职位标签烧进画面像素**（白字 + 红印章压在服饰上，实测不透明像素占比 **94.4%**，1904/2016）
   ⇒ 界面**无法动态改写头像上的名字**，显示名必须与图上标签一致。
2. **底部烧入的职位名在 24px 下不可读**（实测：缩小后糊成一条灰带）
   ⇒ **小尺寸场景下必须另用 DOM 文本显示成员名**，不能依赖图上烧入的字。
   这是本素材对实现的一条硬约束，不是可选项。
3. **四角已透明**（四角 A=0，中心 A=255，20/20 通过）
   ⇒ 可直接置于任意底色，深色主题观感见 `assets/members/预览_深色面板.png`。
4. **out-2048（122 MB）未入库**（已 gitignore）⇒ 面板一律用 `out-512/`。

> ✅ **命名体系已定案（2026-09-20）**：素材的天文职官名（`灵台郎`）即**职位名**，
> 采用三层标识模型（职位 / 成员名 / ID），职位名**不要求** `Sophia` 前缀。
> 详见 §6.1.5 与 `docs/REQUIREMENTS.md` FR-5A / FR-8。

#### 6.1.1 三层可组合结构（轨道 2）

```tsx
<SophiaAvatar
  diff="coding"            // 差分层：职责（决定剪影与特征锚点）
  role="persistent"        // 常驻 / 临时 / DAG（决定外框与饱和度）
  state="running"          // 状态层：idle / running / waiting / failed
  model="deepseek-flash"   // DAG 专属：右下模型角标
  lock={false}             // DAG 专属：归属锁
  size={28}                // 决定 LOD 层级
/>
```

| 层 | 内容 | 是否可换 |
|---|---|---|
| 底胚层 | 头部/脸型/颈部剪影，全员共享 | 否（唯一） |
| 差分层 | 发型剪影 + 服饰轮廓 + **特征锚点** | 按职责切换 |
| 状态层 | 表情微调 + 状态光效/角标 | 按运行时状态切换 |

#### 6.1.2 尺寸分级渲染（LOD）——解决小尺寸辨识

上游 `dsh-agent-team` 的实际做法（已核实，非推测）：成员行用 **24px 头像**的三轨网格
（`dsh-agent-team/docs/frontend-design.zh.md:111`，2026-09-20 同步后行号），
头像按 `memberId` 字符串哈希出稳定色相
（`hash*31+charCode mod 360`，同文件 `:69`），即**纯色相区分、不带图形差分**。
⇒ 上游为绕开小尺寸辨识问题，选择了「放弃图形、只用色相」的策略。
本项目要做的是**在保留图形差分的前提下**解决同一问题，因此下面这套 LOD 分级是必需的。

| 尺寸区间 | 渲染内容 | 使用场景 |
|---|---|---|
| < 24px | 特征锚点符号 + 主色底（退化为符号头像） | 极密集列表 |
| 24–40px | 剪影（发形 + 服饰轮廓）+ 锚点 + 状态点 | 侧边成员列表、消息流头像 |
| 40–96px | 完整差分半身 + 状态光效 | 成员卡、活动面板卡片 |
| > 96px | 完整立绘（含表情差分） | 成员详情、hover 放大 |

> 兜底策略继承上游结论：`avatar` 字段可选；未指定时回落 `initial + 色相`，**不随机分配**。

#### 6.1.3 小尺寸职责锚点（< 40px 的辨识依据）

当头像尺寸 < 40px 时，改用「几何锚点 + 主色」表达职责（不依赖立绘细节）。
锚点取天文仪器意象，与职官体系呼应：

| 职位 | 特征锚点 | 主色 |
|---|---|---|
| 钦天监监正（总控） | 罗盘 / 星盘 | 品牌紫 `#5B4CF0` |
| 灵台主事 / 灵台郎（架构） | 六边形星图 | 靛蓝 |
| 时宪主事（编排） | 三环历链 | 青蓝 |
| 推步主事（实现） | 尖角规 `< >` | 松绿 |
| 象绘 / 星绘主事（设计） | 方框 + 三角 | 品红 |
| 星验主事 / 星机校验（质检） | 盾牌 + 勾 | 朱红 |
| 观象访事（调研） | 圆点靶 | 琥珀 |

> ⚠️ 本表**仅在 < 40px 时启用**。≥ 40px 一律用轨道 1 的 PNG 立绘（见 §6.1.0）。

#### 6.1.4 成员类型差异（一眼区分常驻 / 临时 / DAG）

| 类型 | 外框 | 饱和度 | 附加 |
|---|---|---|---|
| 常驻成员 | 实心圆 | 100% | 状态点 |
| 临时执行成员 | 虚线圆环 | 85% | 状态点 |
| DAG 成员 | 八角形框 | 95% | 右下沉模型角标 + 归属锁 |

#### 6.1.5 命名与状态（三层标识模型 · 已定案）

命名采用**三层模型**，规则见 `docs/REQUIREMENTS.md` FR-5A / FR-8：

| 层 | 例子 | 唯一性 | 是否烧进图 |
|---|---|---|---|
| **职位** `position` | `灵台郎`、`推步主事` | ❌ 可多实例 | ✅ 图上印的就是它 |
| **成员名** `name` | `灵台郎`、`灵台郎-2` | ✅ 团队内唯一 | ❌ DOM 文本渲染 |
| **成员 ID** `memberId` | `sophia-lingtai-lang-a1b2c3d4` | ✅ 全局唯一 | ❌ 不可见 |

**关键收益**：显示名优先用**职位名**，仅在团队内重名时露出序号
⇒「图上印的字」与「界面显示的字」**永远一致**，
不会出现「图上灵台郎、旁边写 Sophia灵台郎」的割裂。

> 曾误判为「命名规范冲突」（以为职位名须加 `Sophia` 前缀）。实际是**职位 ≠ 成员名**：
> 职位名本就不该带品牌前缀（如同「架构师」不该叫「某某架构师」）。
> 修正记录见 `assets/members/README.md` §四。

| 维度 | 常驻成员 | 临时执行成员 | DAG 成员 |
|---|---|---|---|
| 显示名 | 职位名（重名加序号） | 同左 | 同左 |
| 头像来源 | 轨道 1 `out-512/` | 同左 | 同左 |
| 状态点 | idle 灰 / running 蓝 / waiting 琥珀 / failed 红 | 同左 | 同左，另加归属锁图标 |

> 人类成员**不得**使用索菲亚素材或差分，须使用独立标识，避免人与 AI 混淆。

#### 6.1.6 资产与工程约束

- **轨道 1 位图**：`assets/members/out-512/`（已入库，10.2 MB / 20 张）。
  `out-2048/`（122 MB）**不入库**，见 `.gitignore`；需要时从原始 zip 解压。
  **不要在客户端做二次裁切**：素材已是 1994×1994 蒙版成品，
  底部标签余量仅 15px，再裁会切到标签。
- **轨道 2 矢量**：源文件 SVG 分层；构建期用 tsdown 侧产物预渲染 24/28/48/96px PNG 雪碧图。
- **色相生成**：基础差分 SVG 只画一套，配色用 CSS 变量 + `filter: hue-rotate()` 派生。
- **资产目录**：轨道 2 放 `packages/sophia-client/assets/oc/{base,diff,state}/`。
- **许可**：轨道 1 素材由主人提供（含去水印后处理），**其使用范围与再分发条款需主人确认**；
  轨道 2 为自有资产；若差分由外部 AI 生成，须确认许可条款后写入 `assets/oc/LICENSE.md`。

### 6.2 配色令牌（三案共用）

| 语义 | 值 |
|---|---|
| 品牌主色 | `#5B4CF0` |
| 已交付 | `#10B981` |
| 等待依赖 | `#F59E0B` |
| 进行中 | `#3B82F6` |
| 门禁未过 | `#EF4444` |
| 深色画布底 | `#0D1117` |

## 7. 里程碑

| 阶段 | 交付物 | 依赖 |
|---|---|---|
| M1 | `sophia-core` 账本 + 命名门禁（三层标识模型）+ 双模草案生成 | 无 |
| M2 | `sophia-engine-team` 成员激活与唤醒链路 | M1 |
| M3 | `sophia-engine-dag` 调度 + 归属守卫 + 门禁 | M1 |
| M4 | **团队实体化解耦**：`teamId` 锚定、代孕创建、**常驻调度体**（最大难点） | M1 M2 |
| M5 | **派生策略**：权限矩阵 + 临时团免审 + 持久团两级审批（团长预审 → 收件箱） | M4 |
| M6 | `sophia-client` StagingDualPlanEditor（含模式单选） | M1 |
| M7 | 活动面板 + 依赖树画布 | M2 M3 M6 |
| M8 | 换模 / 回收 / 销毁 的全链路打通 | M2 M3 M7 |
| M9 | 嵌套子 DAG 下派闭环 + 派生团 UI 呈现 + 孤儿转挂 | M5 M7 M8 |

> ⚠️ **M4 是本项目最大的技术风险**：上游的调度器依附于 captain 的 live turn
> （`dsh-agent-teams/src/scheduler.ts`），窗口会话一关就失去驱动源。
> 要实现「窗口关了团照常运转」，必须自建一个不依附窗口的常驻驱动体。
> 建议 M4 单独开一个 spike 验证可行性，不要与功能开发混在一起。

## 8. 测试策略

- 单元：命名门禁、归属守卫越权拦截、账本 scope 计算。
- 集成：核准 → 派发 → 完成 的双模各一条主链路。
- 契约：Remote 请求/响应 schema 校验。
- UI：草案面板模式切换、成员卡操作、画布 100 节点渲染。
- 回归：未安装插件的普通 Session 不受影响（NFR-3）。

## 9. 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| 运行中热换模与 DSH 请求生命周期冲突 | 换模不生效或报错 | 采用步骤边界生效策略，避免打断进行中的请求 |
| DAG 归属守卫误拦合法调用 | 阻塞正常协作 | 明确「显式声明移交」的唯一合法路径，写进工具描述 |
| 单页融合信息密度过高 | 可读性下降 | 活动面板默认折叠，依赖树按需展开 |
| 只追加账本体积增长 | 磁盘与查询变慢 | 按 scope 增量读取 + 定期归档分片 |
