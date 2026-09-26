# dsh-sophia-entities · 开发文档

> 版本：v1（需求基线）
> 日期：2026-09-25
> 基座：`dsh-sophia-entities` v0.1.15（commit `b70a80fb`）
> 能力来源：`@nanmicoder/dsh-agent-teams` v0.1.21（commit `f60d40d7`）
> 状态：**设计方案，待主人确认后进入实施**

---

## 0. 阅读顺序

本文件是唯一的需求与设计基线。实施时按第 7 节的阶段推进，每阶段结束回到第 8 节验收。
第 2 节的环境事实是**已核实**的，不是推测；第 9 节列出的开放问题必须在对应阶段开始前闭环。

---

## 1. 需求规格

### 1.1 主人原话拆解

| # | 原话 | 提炼 |
|---|---|---|
| 1 | "agent-teams 这个插件里的所有能力" | teams 的 14 个工具 + 调度器 + 质量门禁 + mailbox + 卡片 + 活动树 + 计划编辑器，全部要 |
| 2 | "尽量通过较少的源码修改，更多的直接通过代码复用" | 优先并存与包装，禁止重写已有逻辑 |
| 3 | "当前窗口在调用子代理的时候，通过 agent-teams 的卡片和活动树来建立 teams" | 宿主会话（普通模式）里由卡片驱动建队，活动树做可视化 |
| 4 | "这两个插件分别代表的是两种不同的 Teams" | 持久化团队（基座）= 类型一；DAG 团队（teams）= 类型二 |
| 5 | "在我选择批准卡片上的团队时候，我可以在卡片上进行模式选择" | **卡片上要有模式选择器**，批准前可切换团队类型 |
| 6 | "持久化的团队成员，仍然可以创建新的团队来为他做事" | **递归建队**：成员也能发起建队 |
| 7 | "同样它也是创建两种团队，然后用卡片让我选择并批准哪一种" | 成员发起的场景，主人仍是最终决定者（对持久团） |
| 8 | "如果是创建 DAG 团队，那么他就不需要我批准，只需要让他这个团队里的队长审核就可以" | 成员 + DAG → **队长审核即可，跳过主人** |
| 9 | "如果是持久团，那么队长审核之后，如果用不到持久团队，那么队长直接让他转为 DAG 团队，让他直接创建" | 成员 + 持久 → 队长**降级裁决**权 |
| 10 | "如果确实需要持久团，那么将会通过邮箱告知我，然后让我进行卡片批准" | 成员 + 持久 + 队长判定必要 → **邮箱通知 → 主人卡片批准** |

### 1.2 可验收需求条目

| ID | 需求 | 验收标准 |
|---|---|---|
| **R1** | 双模式团队 | 同一套入口能创建出「持久化团队」与「DAG 团队」，两者的成员/任务/消息在活动树上都能看到 |
| **R2** | 卡片模式选择 | 批准卡片上存在模式选择控件，切换后立即持久化；刷新页面后选择不丢失；批准时按当前选择物化 |
| **R3** | 卡片驱动建队 | 在宿主会话（普通模式）里，模型调用建队工具后卡片出现在对话流中，含成员/任务摘要 + 模式选择 + 批准/退回 |
| **R4** | 活动树可用 | 活动树能显示：队长节点、成员树、任务依赖 DAG、进度概览；支持停止团队、跳转成员会话 |
| **R5** | teams 能力无损迁移 | teams 的 14 个工具全部可用，质量门禁与自动修复/复审循环生效，mailbox 投递正常 |
| **R6** | 递归建队 | 成员（持久团或 DAG 团的成员）能发起建队请求，请求进入正确的审批路径 |
| **R7** | 分级审批 | 四条路径全部走通：① Human+任意 → 主人批准；② Member+DAG → 队长审核；③ Member+持久+队长判降级 → 直接建 DAG；④ Member+持久+队长判必要 → 通知主人 → 卡片批准 |
| **R8** | 邮箱通知 | 路径④中，主人通过邮箱收到含团队摘要与批准入口的通知；邮件通道不可用时降级到 Thread 通知 + 卡片徽标，不静默丢失 |

### 1.3 明确不做的事

- 不重写基座的账本（ledger）、操作闭集（operations）、上下文连续性（context-*）、压力策略、恢复策略。
- 不重写 teams 的质量门禁、调度器、mailbox、状态持久化。
- 不改基座的 preset 隔离机制（`isolate: agentPresets`）——这是保护主人 `sophia` preset 不被污染的关键。
- 不改两个上游仓库（`../dsh-agent-team`、`../dsh-agent-teams`），它们保持只读参照。

---

## 2. 环境与前提（已核实）

### 2.1 本机 DSH 环境

| 项 | 值 | 核实方式 |
|---|---|---|
| dsh CLI | `0.1.5-rc.1` | `dsh --version` |
| DSH home | `~/.dsh` | 目录实存 |
| web profile | `~/.dsh/profiles/web` | 目录实存 |
| 宿主默认 agent preset | `sophia`（自定义） | `~/.dsh/settings.yaml` → `agent-presets.default` |
| 审批策略 | `agent.approvalPolicy: auto-approve`；`permission.defaultPreset: danger-full-access` | `settings.yaml` |
| **基座已在运行** | `~/.dsh/agent-team/{human,members}` + `~/.dsh/storages/agent_team.sqlite` | 文件系统实存 |
| node / pnpm | `v22.22.2` / `11.22.0` | 命令行 |
| **harness 源码 checkout** | ✅ **已就位**：`../deepseek-harness` @ `dsh-v0.1.7-rc.2`（浅克隆，13,850 文件，`tsconfig.base.json` 含 501 条 paths） | `git clone --depth 1 --branch dsh-v0.1.7-rc.2` |

### 2.2 两个上游的形态对比

| 维度 | dsh-agent-team（基座） | dsh-agent-teams（能力源） |
|---|---|---|
| 版本 | 0.1.15 | 0.1.21 |
| 结构 | 单根包 + `packages/*` 三目录 seam，通过根 `exports` 子路径暴露 | 单包（`src/` + `src/client/`） |
| 团队语义 | **持久协作**：Channel / Thread / Claim / 账本 | **任务编排**：Task + dependencies（DAG）/ 质量门禁 |
| 真相来源 | append-only 操作账本（SQLite，domain `agent_team`） | `<workspace>/.agent-teams/<teamId>/team.json` + `inbox/*.jsonl` |
| 队长语义 | **队长 = 创建团队的会话本身**（隐式，不是成员行） | 队长 = `captainSessionId`，成员是 continuable subagent |
| 成员创建 | Human-only（`agentTeamHumanActor()` 围栏） | 队长可加成员（`agent_teams_add_member`） |
| 工具 | 8 个 `team_*` + 3 个 `context_*` | 14 个 `agent_teams_*` |
| 前后端通道 | **typert 生成的类型化 RPC**（`ctx.remote.agentTeam.*` ↔ `@Remote()`） | **裸 fetch + 4 条自建 HTTP 路由** |
| 审批机制 | 仅 confirmation token（mention 未关注成员） | `approval=required\|automatic` 两相计划 + `agent_teams_approve` |
| 卡片 | ❌ 无 | ✅ `conversation.chat.node` keyed 节点 |
| 活动树 | ❌ 无（只有扁平时间线 + 状态点） | ✅ `ActivityPanel`（1337 行）+ `activity-model`（含 DAG 布局） |
| 侧栏 | **shadow 接管**（`priority -100`），内部硬编码两段，**无子 slot** | 只注册右侧 tab + 浮层 |
| 构建链 | **依赖 harness checkout**（`clientBundle`）→ 本机不可用 | **自包含 tsdown**（内联 ModuleLoader 协议 + CSS 注入 + 纯度门禁）→ 本机可用 |
| 宿主版本要求 | `>=0.1.7-rc.1 <0.1.8` | `0.1.7-rc.2`(推荐) / **`0.1.5-rc.1`(legacy，本机版本)** |

### 2.3 硬约束清单

| # | 约束 | 来源 | 对设计的影响 |
|---|---|---|---|
| **C1** | 基座构建链需要 harness 源码 checkout，本机没有 | `scripts/harness-dir.mjs` fail-fast | **构建链必须替换**（见 D2） |
| **C2** | 基座声明宿主 `>=0.1.7-rc.1`，本机 `0.1.5-rc.1` | `package.json` peerDeps | 需实测；teams 明确支持本机版本，可作兼容参照 |
| **C3** | 基座 Team 模式 shadow `main` 与 `sidebar.workspaces` | `client/index.ts:152-209` | 卡片在 **Team 模式内不渲染**；但需求的 R3 场景是**宿主普通会话**，不受影响 |
| **C4** | 基座侧栏/主区**无 `children` 子 slot 声明** | 全仓 grep 无 slot `children` | 活动树要进侧栏**必须小改** `TeamWorkspaceBrowser.tsx`；或走 `shell.overlay` |
| **C5** | 两套状态后端不兼容（SQLite 账本 vs json/jsonl） | 两侧 `state.ts` | 需要双后端适配层，不追求统一存储 |
| **C6** | 工具命名空间**不冲突**（`team_*` vs `agent_teams_*`） | 两侧 `tool-names` | ✅ 这是"少改源码"的最大抓手：两套工具可并存 |
| **C7** | client bundle 纯度门禁：跨插件 `@deepseek-ai/*` value import 构建报错 | teams `tsdown.config.ts:77-88` | 跨插件协作只能走 cordis service + type-only import |
| **C8** | id 三处必须一致：`package.json.name` = patch `name` = ModuleLoader id | 两侧构建实现 | 改名时必须同步三处 |

---

## 3. 核心架构决策

### D1 · 复用优先：并存而非重写

**决策**：两套代码**大范围并存**，只在中间插入一层薄的编排层，不重写任何一方的业务逻辑。

**依据**：C6（工具名不冲突）+ C5（状态目录不冲突：`~/.dsh/storages/agent_team.sqlite` vs `<workspace>/.agent-teams/`）+ 事件类型不冲突（`agent-teams/*` vs 账本操作）。

**代价与收益**：仓库体积变大约 1.6 倍，换来的是 **0 行重写**。这是满足需求 2（"较少的源码修改"）的唯一可行路径——因为两套系统的内核假设完全不同（一个以"Human 参与的持久协作"为中心，一个以"任务 DAG 自动编排"为中心），强行统一数据模型会变成重写两遍。

### D2 · 构建链：获取 harness 官方源码检出（P0 实测修正）

> **修正记录（2026-09-25 · P0 实施中）**
> 本节原决策为"废弃基座的 `clientBundle`（harness 依赖），改用 teams 的自包含 tsdown 链"。
> P0 实测后该路径被推翻——它只能解决问题的一小部分，代价却最大。现修正如下。

**决策**：把 DeepSeek Harness 的**官方开源检出**放到 `../deepseek-harness`，基座对 harness 的三层依赖**原样保留，一行不改**。

**依据**：

1. **harness 是 MIT 开源项目**：`https://github.com/deepseek-ai/deepseek-harness`，tag 齐全（`dsh-v0.1.5-rc.1` … `dsh-v0.1.7-rc.2`），`--depth 1` 浅克隆**仅需 8 秒**。
2. **基座对 harness 的依赖是深度耦合的，共三层**，原方案只能替代其中一层：

   | 层 | 依赖点 | 原方案（换 teams 链）能否解决 |
   |---|---|---|
   | ① 类型解析 | 三个 tsconfig 共 **506 条 paths**，涉及 **316 个 `@deepseek-ai/*` 包**，全部指向 `../deepseek-harness/packages/*/src` 与 `lib/types` | ❌ 不能。需逐个从 npm 装 316 个包 |
   | ② typert RPC 生成 | `scripts/generate-typert.mjs` 用 harness 的 `WorkspaceAnalyzer` + `FaceModelEmitter` 生成 `typert.host.js` / `typert.remote-client.js` | ❌ 不能。除非重写 RPC 层 |
   | ③ client 打包 | `scripts/build-client.mjs` 动态 import harness 的 `packages/client/tsdown.client.ts` | ✅ 能。teams 有自己的等价实现 |
   | ④ 包链接 | `scripts/link-harness-packages.mjs` 把 harness 包 link 进 node_modules | ❌ 不能 |

   即：原方案是用最大的改动量去解决四分之一的问题。
3. **为什么不从 npm 装那 316 个包**：`~/.dsh/profiles/node_modules/@deepseek-ai/` 里虽有 247 个运行时包，但它们**已剥离类型声明**（`lib/types/` 下是 `.js` 而非 `.d.ts`，实测 `find -name "*.d.ts"` 返回 0），无法用于 typecheck。而 npm 上 `latest` tag 停在 `0.1.0-rc.6`（`dsh-session` / `dsh-tools` 等更只有 `0.0.1-rc.1` 占位版），只有 `next` tag 指向 `0.1.7-rc.2`——逐个装 316 个包既不可靠也无必要。

**实施要点**：

- 检出位置：工作区同级 `../deepseek-harness`（正是 `harness-dir.mjs` 的默认路径契约，`DSH_HARNESS_DIR` 环境变量不必设）
- 版本：**`dsh-v0.1.7-rc.2`**（基座 peerDeps 要求 `>=0.1.7-rc.1 <0.1.8`，也是 teams `compatibility.json` 的 `recommendedHost`）
- 需在 harness 内执行 `pnpm install` 与构建，产出 `packages/*/lib/types/*.d.ts`
- 完成后基座的 `sync-paths.mjs` / `generate-typert.mjs` / `link-harness-packages.mjs` / `build-client.mjs` 全部可原样运行

**收益**：基座构建链 **0 行修改**——比原方案（改 tsconfig 生成器 + 重写构建脚本 + 手写 typert 替代）干净得多，且完全符合需求 2（"尽量少的源码修改"）。

**代价**：引入一个外部检出依赖（`../deepseek-harness`），它必须在位才能构建。这是**构建期依赖**，不影响运行与分发。

### D3 · 双模式团队：统一门面 + 双后端

**决策**：引入内部服务 `sophiaTeam`，对上暴露**模式无关**的团队模型，向下分派到两个后端。

```
                    ┌─────────────────────────┐
   UI / 工具 ──────▶ │  sophiaTeam (Facade)    │
                    │  mode: persistent | dag │
                    └───────┬─────────┬───────┘
                            │         │
              persistent ───┘         └─── dag
                    │                       │
        ┌───────────▼──────────┐  ┌─────────▼──────────┐
        │ 基座 AgentTeam 服务   │  │ dag-team 后端       │
        │ SQLite 账本           │  │ team.json + jsonl  │
        │ Channel/Thread/Claim  │  │ Task DAG + 门禁     │
        └──────────────────────┘  └────────────────────┘
```

**为什么不是统一存储**：基座的账本是 append-only 操作日志 + 投影，这是它的正确性根基（invariant 校验、replay、乐观并发）；teams 是文件快照 + 团队锁。把任何一个改造成另一个的形态，都等于重写。

**Facade 暴露的最小面**：
```ts
interface SophiaTeamFacade {
  propose(input: ProposeInput): Promise<ProposalRef>
  setMode(ref: ProposalRef, mode: TeamMode): Promise<void>
  approve(ref: ProposalRef, verdict: OwnerVerdict): Promise<MaterializeResult>
  review(ref: ProposalRef, verdict: CaptainVerdict): Promise<ReviewResult>
  list(filter): Promise<TeamSummary[]>          // 两种模式合并视图
  activity(ref): Promise<ActivitySnapshot>       // 归一化成活动树可消费的形状
}
```

### D4 · UI 落点

| 需求 | 落点 | 是否改基座 | 理由 |
|---|---|---|---|
| 审批卡 + 模式选择（R2/R3） | `conversation.chat.node`（keyed，新 kind） | ❌ | teams 已有完整卡片机制可照搬；R3 场景是宿主普通会话，C3 不影响 |
| 活动树（R4） | ① `shell.overlay` 浮层（主）<br>② 基座侧栏新增第三段（增强） | ① ❌ ② ✅ 小改 | ① 零改动且两种模式都可见；② 让 Team 模式下也能看到，复用 `TeamSidebarSection` |
| 计划编辑器（teams 的 StagingPlanEditor） | 挂在浮层内（teams 原位置） | ❌ | 原样复用，仅换路由前缀与 locale 命名空间 |
| 待审批徽标（R8 降级通道） | `sidebar.footer.action`（list，可并存） | ❌ | 基座自己用的 additive slot，可再注册一个 id |

**关键判断**：不把卡片塞进基座的 Team 会话区（那需要改 `TeamConversation.tsx` 并新增 fact 类型 → 要动 Node 侧投影 → 大改）。卡片只服务"宿主会话里发起建队"这一场景（正是 R3 要的），活动树服务"看团队运行状态"。

### D5 · 审批：三级路由状态机

**决策**：所有建队请求先进入统一的 `ApprovalRequest` 队列，再按 `(发起者, 模式)` 路由。详见 §4.5。

### D6 · 通知：通道抽象，邮箱优先，永不静默

**决策**：定义 `ApprovalNotifier` 接口，多实现按优先级降级，且**降级通道与主通道并行触发**（邮箱不一定可用，不能赌）。

### D7 · 目录结构

```
dsh-sophia-entities/
├── package.json                  # name: @sophia/dsh-sophia-entities（待定，见 §10）
├── cordis.patch.yml              # 重写：统一 id + 新增 dag-team / orchestration 行
├── tsdown.config.ts              # ★ 新增：仓库级客户端构建（替代 harness clientBundle）
├── pnpm-workspace.yaml
├── packages/
│   ├── agent-team/               # 基座 Host（账本/成员/Human）—— 保持不动
│   ├── tool-agent-team/          # 基座工具 —— 小改（新增统一入口工具）
│   ├── client-agent-team/        # 基座 UI —— 小改（新增卡片/侧栏段/slot）
│   ├── dag-team/                 # ★ 新增：teams 全部 Node 侧
│   │   └── src/                  #   14 工具 / scheduler / quality-gates / mailbox / state
│   ├── dag-team-client/          # ★ 新增：teams 的 client 侧
│   │   └── src/                  #   卡片定义 / ActivityPanel / StagingPlanEditor
│   └── orchestration/            # ★ 新增：编排层
│       └── src/                  #   Facade / ApprovalRouter / Notifier / 审批卡数据契约
└── docs/
```

**为什么 dag-team 单独成包而不是并进 agent-team**：基座三包之间有 `scripts/check-package-boundaries.mjs` 强制边界（禁止非 type-only 的跨包相对 import）。把 teams 的代码混进 `agent-team` 会破坏这个边界检查，也会让"哪些是我们的改动"变得不可辨别。独立成包还能保留 `git diff` 的清晰度。

---

## 4. 详细设计

### 4.1 数据模型

#### 4.1.1 新增领域对象（放在 `packages/orchestration/src/types.ts`）

```ts
export type TeamMode = 'persistent' | 'dag'

export type ApprovalState =
  | 'draft'            // 已提议，尚未选择模式
  | 'pending_captain'  // 待队长审核（成员发起）
  | 'pending_owner'    // 待主人批准（Human 发起，或队长判定需要持久团）
  | 'approved'         // 已批准，待物化
  | 'downgraded'       // 队长裁决降级为 DAG
  | 'rejected'         // 已拒绝
  | 'materialized'     // 已物化为团队
  | 'expired'          // 超时未裁决

export interface Requester {
  readonly kind: 'human' | 'member'
  readonly memberId?: string      // kind==='member' 时
  readonly handle?: string
  readonly teamId?: string        // 发起者所属团队（成员发起时）
}

export interface ApprovalRequest {
  readonly id: string
  readonly requester: Requester
  readonly goal: string
  readonly plan: {
    readonly members: readonly PlannedMember[]
    readonly tasks: readonly PlannedTask[]      // 含 dependencies → DAG
  }
  mode: TeamMode | undefined                    // 卡片上选择后写入
  state: ApprovalState
  readonly captainVerdict?: CaptainVerdict
  readonly ownerVerdict?: OwnerVerdict
  readonly createdAt: string
  updatedAt: string
  readonly expiresAt?: string
}

export interface CaptainVerdict {
  readonly decision: 'approve_dag' | 'approve_persistent' | 'downgrade_to_dag' | 'reject'
  readonly reason: string
  readonly decidedAt: string
  readonly decidedBy: string        // 队长 sessionId
}

export interface OwnerVerdict {
  readonly decision: 'approve' | 'reject'
  readonly mode: TeamMode           // 批准时生效的模式（可能覆写队长建议）
  readonly decidedAt: string
}
```

#### 4.1.2 存储位置

`<workspace>/.sophia-entities/approvals/<requestId>.json`，与两个后端的状态目录**平级但独立**——审批队列的真相必须独立于任一后端，否则"降级"操作会变成跨后端事务。

读写沿用 teams `state.ts` 的 `atomicWriteText` + `withTeamLock` 模式（该模块可直接复用，零依赖）。

#### 4.1.3 双后端的映射

| Facade 概念 | persistent 后端 | dag 后端 |
|---|---|---|
| 团队 id | 账本 channelRef / team ref | `team.json` 的 `id` |
| 成员 | `AgentTeamAgentMember`（`member:<uuid>`） | `TeamMember`（name 索引） |
| 任务 | `AgentTeamTask`（status: todo/in_progress/in_review/done/closed，**无依赖**） | `TeamTask`（status: pending/...，**有 dependencies**） |
| 消息 | Thread fact（含 revision、乐观并发） | `TeamMessage` in `inbox/*.jsonl` |
| 就绪语义 | Claim 制（成员声明方向） | 依赖满足后派发（scheduler） |

**注意**：持久模式的任务**没有依赖图**（基座的 task 模型不含 dependencies）。因此"任务 DAG"是 DAG 模式的独有视图；活动树在两种模式下渲染不同区块（见 §4.7）。

### 4.2 统一门面 `packages/orchestration/src/facade.ts`

```ts
export interface SophiaTeamFacade {
  propose(ctx: Context, input: ProposeInput): Promise<ApprovalRequest>
  setMode(ctx: Context, id: string, mode: TeamMode): Promise<ApprovalRequest>
  review(ctx: Context, id: string, verdict: CaptainVerdict): Promise<ApprovalRequest>
  approve(ctx: Context, id: string, verdict: OwnerVerdict): Promise<MaterializeResult>
  materialize(ctx: Context, req: ApprovalRequest, mode: TeamMode): Promise<MaterializeResult>
  list(ctx: Context, filter?: TeamFilter): Promise<readonly TeamSummary[]>
  activity(ctx: Context, ref: TeamRef): Promise<ActivitySnapshot>
}
```

`materialize` 是唯一分派点：

```ts
async function materialize(ctx, req, mode) {
  if (mode === 'dag') {
    // 调 teams 侧的 createTeamDir + 写 team.json + scheduler.kickTeam
    return dagBackend.create(ctx, req.plan, req.goal)
  }
  // 持久模式：走基座 Human-only 的 Remote 路径
  return persistentBackend.create(ctx, req.plan, req.goal)
}
```

**实现约束**：持久模式物化必须**以 Human actor 身份**提交（基座 `agentTeamHumanActor()` 围栏）。因此物化不是"绕过审批"，而是"主人批准后代为提交"——语义上等价于主人在 UI 上点了创建按钮。这一点必须在代码注释里写清楚，否则会被后续维护者误认为权限绕过。

### 4.3 工具层

#### 4.3.1 并存分区

| 分区 | 工具 | 归属 | 改动 |
|---|---|---|---|
| 持久协作 | `team_inbox` `team_thread` `team_message` `team_claim` `team_view` | 基座 | **零改动** |
| 上下文 | `context_rollover` `context_checkpoint` `context_timeline` | 基座 | **零改动** |
| DAG 编排 | 14 个 `agent_teams_*` | dag-team | 仅改 backend 注入与路由前缀 |
| **新建队入口** | `sophia_team_propose` `sophia_team_review` `sophia_team_approve` | orchestration | 新增 3 个 |

#### 4.3.2 新增工具签名

```ts
// 所有角色可调（含成员）：发起建队提议
sophia_team_propose({
  goal: string,                       // 必填
  mode?: 'persistent' | 'dag',        // 可选；不填则等卡片上选
  plan?: { members[], tasks[] },      // 可选；不填则由模型按 goal 草拟
  reason?: string                     // 成员发起时说明为什么需要新团队
})

// 仅队长可调：审核成员发起的提议
sophia_team_review({
  request_id: string,
  decision: 'approve_dag' | 'approve_persistent' | 'downgrade_to_dag' | 'reject',
  reason: string
})

// 仅 Human（主人）可调：最终批准
sophia_team_approve({
  request_id: string,
  decision: 'approve' | 'reject',
  mode: 'persistent' | 'dag'          // 批准时可覆写
})
```

**队长身份判定**：复用基座的 `findTeamByCaptain(stateRoot, captainSessionId)`（`state.ts:342`）——"一个队长至多一团队"的语义正好用于判定审核权限。

#### 4.3.3 成员工具面扩展

成员当前受 `restrict({ allow })` 限制。需要把 `sophia_team_propose` 加入**成员的必备工具集**：

- 基座：`packages/agent-team/src/member-runtime.ts` 的 `AGENT_TEAM_TOOL_NAMES` 数组追加（该数组是"成员必须并上"的白名单，`member-runtime.ts:152-158`）
- teams 侧：`members.ts` 的 `memberToolFilter` 同理追加

**注意**：`sophia_team_review` / `sophia_team_approve` **绝不能**进成员工具面——否则成员可以自审自批。

### 4.4 卡片与模式选择

#### 4.4.1 卡片定义

新增 `packages/dag-team-client/src/sophia-approval-card-definition.ts`：

```ts
export interface SophiaApprovalCardData {
  readonly requestId: string
  readonly goal: string
  readonly requester: Requester
  readonly mode: TeamMode | undefined
  readonly state: ApprovalState
  readonly members: readonly { name: string; role: string }[]
  readonly taskCount: number
  readonly dependencyCount: number
}

declare module '@deepseek-ai/dsh-client-ui-chat/client' {
  interface ChatNodeDataMap { 'sophia-approval': SophiaApprovalCardData }
}
```

`match` 规则（照搬 teams 的事件折叠式）：
- `tool/call` 且 `name === 'sophia_team_propose'` → `{ role: 'start' }`
- `tool/result` 且 `source.kind === 'tool'` → `{ role: 'update' }`

**与 teams 现有卡片的区别**：teams 的卡片有 `accepted` 门禁（只在成功后才渲染），而审批卡必须**在成功之后、物化之前**渲染。因此 `buildViewNode` 的条件改为：拿到 result **且** result 里的 `state` 属于 `pending_owner | pending_captain | draft`。物化完成后转为展示态卡片（可复用 teams 的 `AgentTeamsSummary`）。

#### 4.4.2 模式选择交互

复用宿主 `@deepseek-ai/dsh-client-ui-primitives` 的 `Menu`（teams 的 `StagedModelPicker` 已证明该包在白名单内可 value import）：

```
┌──────────────────────────────────────────────┐
│  🐋 新建团队提议                              │
│  目标：重构支付模块的错误处理                  │
│  发起：@sophia-dev（成员）                    │
│                                               │
│  团队类型  [ 持久化团队 ▾ ]   ← Menu 单选      │
│            · 持久化团队（Channel/Thread/账本） │
│            · DAG 团队（任务依赖 + 质量门禁）   │
│                                               │
│  成员 3 · 任务 7 · 依赖 5                     │
│                                               │
│  [ 批准 ]  [ 退回 ]  [ 在活动树中查看 ]        │
└──────────────────────────────────────────────┘
```

**持久化策略**：选择即 `POST /plugins/<id>/approve/plan {action:'set_mode', requestId, mode}`，写入 Node 侧审批记录。理由：teams 的既有原则是"durable 真相在 host，客户端只是叶子组件"，遵循它可避免 localStorage 与 Node 状态不一致。

#### 4.4.3 成员发起场景的卡片

成员发起的提议会出现在**成员自己的会话**（`sophia_team_propose` 的 tool/call 落在成员会话的事件流里）。因此：

- 成员会话里：卡片显示为**只读状态卡**（"已提交队长审核，等待中…"），无批准按钮
- 队长会话里：卡片显示**审核按钮**（approve_dag / approve_persistent / downgrade_to_dag / reject）
- 主人侧：路径④的提议需要主人批准 → 卡片在**主人的会话**里出现，含模式选择 + 批准

主人侧卡片的注入方式：由 Node 侧在 `pending_owner` 状态时，向主人会话 append 一个携带 `requestId` 的事件；卡片定义 match 该事件类型。**这是唯一需要新增 SessionEvent 类型的地方**，需在 `SessionEventMap` 做 declaration merge（照搬 teams `event-types.ts:105-177` 的做法）。

### 4.5 审批状态机

```
                    sophia_team_propose
                            │
              ┌─────────────┴─────────────┐
        requester=human            requester=member
              │                           │
              ▼                           ▼
      ┌───────────────┐          ┌──────────────────┐
      │ pending_owner │          │ pending_captain  │
      │ (卡片可改模式) │          └────────┬─────────┘
      └───────┬───────┘             队长 review
              │                           │
              │        ┌──────────────────┼──────────────────┐
              │        │                  │                  │
              │   approve_dag     downgrade_to_dag   approve_persistent
              │        │                  │                  │
              │        ▼                  ▼                  ▼
              │   materialize('dag')  materialize('dag')  ┌───────────────┐
              │        │                  │              │ pending_owner │
              │        │                  │              │ + 邮箱通知     │
              │        │                  │              └───────┬───────┘
              │        │                  │                      │
              └────────┴──────────────────┴──────────────────────┘
                                      │
                          主人卡片 approve(mode)
                                      │
                                      ▼
                            materialize(mode)
                                      │
                                      ▼
                                 materialized
```

**超时策略**（必须实现，否则队列会僵死）：

| 状态 | 超时 | 动作 |
|---|---|---|
| `pending_captain` | 可配置，默认 10 分钟 | 升级为 `pending_owner`（队长没空裁决时不能让请求烂掉） |
| `pending_owner` | 可配置，默认 24 小时 | 标记 `expired`，归档并通知发起者 |
| `draft` | 30 分钟 | 标记 `expired`（模式都没选，说明是误触发） |

复用 teams `scheduler.ts` 的事件驱动模型还是加独立定时器？**决策：独立轻量定时器**（`ctx.effect` + `setInterval`）。理由：teams 的 scheduler 是"成员 idle 边沿驱动"，与审批超时语义无关，混进去会污染它的就绪判定。

### 4.6 通知通道

```ts
// packages/orchestration/src/notifier.ts
export interface ApprovalNotifier {
  readonly id: string
  isAvailable(ctx: Context): boolean
  notify(ctx: Context, req: ApprovalRequest): Promise<NotifyResult>
}
```

| 优先级 | 实现 | 依赖 | 可用性 |
|---|---|---|---|
| 1（主） | `AgentMailNotifier` | 宿主 `tools` registry 中的 agent-mail 工具 | **待验证**（见 §9 O1） |
| 2（兜底，并行触发） | `ThreadNotifier` | 基座账本：给 Human 发 Thread + `@human` | ✅ 基座原生机制，一定可用 |
| 3（兜底，并行触发） | `BadgeNotifier` | `sidebar.footer.action` 的待办计数徽标 | ✅ 纯客户端 |

**邮件内容模板**（R8 验收对象）：

```
主题：[dsh-sophia-entities] 待批准：持久化团队请求 #<short-id>

@sophia-dev 发起了一个持久化团队请求，队长判定需要你确认。

目标：<goal>
成员：3（<names>）
任务：7（含 5 条依赖）
队长意见：<captainVerdict.reason>
发起者理由：<requester.reason>

批准 / 退回：<深链或说明如何在卡片上操作>
有效期至：<expiresAt>
```

**降级纪律**：三条通道**同时触发**，各自独立失败。任何一条成功即视为通知送达；全部失败则写入 est 日志并在卡片上显示红色告警，**绝不静默**。

### 4.7 活动树

复用 teams 的 `ActivityPanel` / `WorkspaceActivity` / `activity-model.ts` / `activity-monitor.ts`，改造点：

| 改造项 | 原值 | 新值 |
|---|---|---|
| 数据源 URL | `/plugins/dsh-agent-teams/state` | `/plugins/<新包名>/state` |
| Halt URL | `/plugins/dsh-agent-teams/halt` | `/plugins/<新包名>/halt` |
| 资源 URL | `/plugins/dsh-agent-teams/assets/` | `/plugins/<新包名>/assets/` |
| locale 命名空间 | `agentTeams` | `sophiaEntities` |
| `Artwork` 图片 | teams 的鲸鱼资源 | 保留或替换（见 §10 D5） |

**双模式渲染**：`ActivityTeam` 契约需要扩展一个 `mode: 'persistent' | 'dag'` 字段，`TeamSection` 按 mode 分支：

- `dag`：渲染 `delegationTree`（成员树）+ `DependencyMap`（任务 DAG）+ `ProgressOverview`
- `persistent`：渲染成员树 + Thread/Claim 摘要（**无依赖图**，因为持久模式的任务模型没有 dependencies）

Fastest 落地方式是先在 `dag` 模式跑通（数据契约完全对齐），`persistent` 模式的活动视图作为第二阶段增量。

### 4.8 递归建队与防护

**递归深度**：teams 有 `memberMaxDepth`（默认 0）；基座有 `installMemberDelegationGuard`（限制后代创建深度）。统一为 Facade 的一个配置项 `maxTeamDepth`，默认 2（主人团队 → 子团队 → 孙团队，再深就拒绝并告知）。

**防护点**：
1. 成员不能再审自己的提议（`requester.memberId !== verdict.decidedBy`）
2. 降级裁决必须带 reason，且写入审批记录（可审计）
3. 持久模式的物化必须以 Human actor 提交（见 §4.2 约束）
4. 同一 goal 的重复提议按 hash 去重（避免成员刷请求）

### 4.9 HTTP 路由

在 dag-team 的 4 条路由基础上新增审批路由：

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/plugins/<id>/approvals` | 审批队列快照（卡片与徽标轮询） |
| POST | `/plugins/<id>/approvals/plan` | 统一审批动作入口：`set_mode` / `approve` / `reject` / `review` |
| GET/POST | `/plugins/<id>/state` `/halt` `/plan` | 沿用 teams（活动树与计划编辑器） |
| GET | `/plugins/<id>/assets/*` | 沿用 teams（白名单校验必须保留） |

**鉴权**：全部走 `authenticatedWebRoutes`（teams `web-routes.ts:71` 已实现，直接复用）。

### 4.10 客户端构建与 id 一致性

三处 id 必须同步（C8）：

| 位置 | 当前值 | 目标值 |
|---|---|---|
| `package.json.name` | `dsh-sophia-entities` | 见 §10 D1 |
| `cordis.patch.yml` 的 insert `name` | `dsh-sophia-entities` | 同上 |
| `__ModuleLoader__.load({ id })` | 由 harness preset 从 manifest 读 | 同上（tsdown 配置从 `package.json` 读取，天然一致） |

新增的 dag-team client 需注册**第二个** ModuleLoader id —— 但宿主按包名查找 bundle，所以**只能有一个 client bundle**。因此 dag-team 的 client 必须与基座 client **打进同一个 bundle**（同一个 `lib/client.js`）。这是 D7 里 `dag-team-client` 独立成包后必须注意的构建约束：包独立，产物合并。

---

## 5. 源码改动清单

### 5.1 新增文件

| 路径 | 内容 | 行数估计 |
|---|---|---|
| `tsdown.config.ts` | 仓库级客户端构建（从 teams 的配置提升） | ~150 |
| `packages/orchestration/src/types.ts` | 审批领域模型 | ~120 |
| `packages/orchestration/src/store.ts` | 审批持久化（复用 teams 的原子写 + 锁） | ~200 |
| `packages/orchestration/src/facade.ts` | 统一门面 + materialize 分派 | ~250 |
| `packages/orchestration/src/router.ts` | 审批状态机 + 超时 | ~300 |
| `packages/orchestration/src/notifier.ts` | 通知通道三实现 | ~200 |
| `packages/orchestration/src/tools.ts` | 3 个新工具注册 | ~250 |
| `packages/orchestration/src/routes.ts` | 审批 HTTP 路由 | ~150 |
| `packages/dag-team/**` | teams 的 Node 侧整体迁入 | ~5,800 |
| `packages/dag-team-client/**` | teams 的 client 侧整体迁入 | ~5,000 |
| `packages/dag-team-client/src/sophia-approval-card.tsx` | 审批卡组件 | ~250 |
| `packages/dag-team-client/src/sophia-approval-card-definition.ts` | 卡片事件折叠定义 | ~120 |
| `packages/client-agent-team/src/client/SophiaActivitySection.tsx` | 侧栏活动树第三段（可选） | ~150 |

### 5.2 修改文件

| 路径 | 改动点 | 量级 |
|---|---|---|
| `package.json` | `name`；`exports` 增 `./dag`、`./orchestration`；`dsh.client.inject` 扩容；`files` 增新包；`dependencies` 增 orchestration 需要项 | 小 |
| `cordis.patch.yml` | insert id/name 统一为包名；新增 dag-team、orchestration 两行；preset 的 `team-tools` 行追加新工具；**保留 `isolate: agentPresets`** | 中 |
| `packages/agent-team/src/member-runtime.ts` | `AGENT_TEAM_TOOL_NAMES` 追加 `sophia_team_propose`（**不加 review/approve**） | 小 |
| `packages/agent-team/src/index.ts` | 新增 Remote：审批队列读写（供客户端） | 中 |
| `packages/tool-agent-team/src/index.ts` | 无需改（新工具走 orchestration 包注册） | — |
| `packages/client-agent-team/src/client/index.ts` | 新增 slot 注册（审批卡、活动树段、徽标）；`inject` 扩容（需加 `uiConversation`、`layout`、`modelDirectories`、可选 `sidebarRight`） | 中 |
| `packages/client-agent-team/src/client/TeamWorkspaceBrowser.tsx` | 新增第三段（活动树），复用 `TeamSidebarSection` | 小 |
| `packages/client-agent-team/src/client/sidebar-sections.ts` | `TeamSidebarSectionKind` 增 `'activity'` | 小 |
| `scripts/build-client.mjs` | 改为调用仓库级 `tsdown.config.ts`（废弃 harness 依赖） | 中 |
| `packages/client-agent-team/tsdown.config.ts` | 删除或改为 re-export 仓库级配置 | 小 |
| `.gitignore` | 摘掉 `lib/`（**已实施**：选定 git 源分发，见 §10 D6；产物入库并由 `npm run check:bundle` 钉住新鲜度） | 小 |
| `README.md` / `LICENSE` / `CHANGELOG.md` | 重写为项目自身说明；保留上游 LICENSE 与出处声明 | 小 |

### 5.3 明确不动的文件

**基座侧**：
`packages/agent-team/src/{ledger,spec,types/**,pressure-policy,recovery,mentions,attachments,human-*,context-*,invariant,member-context,member-time-context,member-skills,time-format,stored-session-reader,session-event-cursor}.ts`

**teams 侧**：
`quality-gates.ts`、`scheduler.ts`、`state.ts`、`snapshot.ts`、`mailbox.ts`、`profiles.ts`、`harness-compat.ts`、`client/activity-model.ts`、`client/panel-geometry.ts`、`client/activity-monitor.ts`（仅改三个 URL 常量）

---

## 6. 复用矩阵

| 能力 | 来源 | 复用方式 | 改动量 |
|---|---|---|---|
| 质量门禁（6 种 kind + 自动修复循环） | teams `quality-gates.ts` | **直接复用**（零依赖纯函数） | 0 |
| DAG 布局与活动树投影 | teams `activity-model.ts` | **直接复用** | 0 |
| 面板几何（停靠/浮动/拖拽/缩放） | teams `panel-geometry.ts` | **直接复用** | 0 |
| profile 模板与拓扑排序 | teams `profiles.ts` | **直接复用** | 0 |
| 状态原子写 + 团队锁 | teams `state.ts` | **直接复用** | 0 |
| 14 个 DAG 工具 | teams `tools.ts` | 包装（改 backend 注入） | 小 |
| 事件驱动调度器 | teams `scheduler.ts` | 包装（改状态根） | 小 |
| mailbox 投递 | teams `mailbox.ts` | 包装（改状态根） | 小 |
| 审批卡 / 活动树 / 计划编辑器 | teams client | 包装（改路由前缀 + locale + 数据源） | 中 |
| 卡片机制 | teams `agent-teams-card-definition.ts` | 照搬模式，新写一个定义 | 中 |
| 账本 / 操作闭集 / 上下文连续性 | 基座 | **完全不动** | 0 |
| 持久团队的成员运行时 / Human 建模 | 基座 | **完全不动** | 0 |
| 基座 8+3 工具 | 基座 | **完全不动** | 0 |
| typert RPC 通道 | 基座 | 扩一个 Remote 方法 | 小 |
| 双模式门面 / 审批状态机 / 通知 | — | **新增** | 大 |
| 客户端构建链 | teams `tsdown.config.ts` | 提升为仓库级 | 中 |

**复用率估算**：teams 侧约 85% 代码原样迁入（含 5 个零改动纯函数模块），基座侧约 95% 代码不动。新增代码集中在编排层（约 1,600 行）。

---

## 7. 实施计划

### P0 · 合同层打通（先跑起来）

| # | 任务 | 验收 |
|---|---|---|
| 0.1 | 改名三处 id（`package.json` / patch / 构建配置）；确定最终包名 | `node scripts/verify-id-consistency.mjs` 通过 |
| 0.2 | **克隆 harness 官方开源检出到 `../deepseek-harness`**（原计划"落地仓库级 tsdown.config.ts"已废弃，见 D2 修正） | `harness-dir.mjs` 解析成功，`sync-paths.mjs` 生成 506 条映射无报错 |
| 0.3 | harness 内 `pnpm install` + 构建出 `lib/types` | `deepseek-harness/packages/*/lib/types/*.d.ts` 存在 |
| 0.4 | 冒烟：加一条 `sophia-hello` 命令 + `GET /plugins/<id>/health` + 一个可见 UI 标记 | 浏览器可见，无 `plugin tree failed to load` / `slot entry crashed` |
| 0.5 | 装进 `~/.dsh/profiles/web` 并重启 web | 宿主启动日志干净 |

**门禁**：0.4/0.5 未通过，不得进入 P1。

---

### ✅ P0 完成记录（2026-09-25）

**实测结果**

| 项 | 结果 |
|---|---|
| 构建 | `lib/client.js` 640.31 kB（gzip 117.46 kB）；typert RPC 层生成成功 |
| 三处 id 一致性（C8） | `package.json.name` = `ModuleLoader id` = patch insert `name` = **`dsh-sophia-entities`** ✅ |
| 安装 | 独立 profile `~/.dsh/profiles/sophia-entities`（**link 方式**，全程未触碰主人的 `web` / `desktop` profile） |
| 启动 | `dsh --profile sophia-entities` → **加载成功**，UI 服务在 `127.0.0.1:3080`，无 `plugin tree failed to load` |

**构建链：基座源码 0 行修改**。只需把官方开源检出放到同级的 `../deepseek-harness`（`harness-dir.mjs` 的默认契约路径），基座原有的 `sync-paths` / `generate-typert` / `link-harness-packages` / `build-client` 全部原样可用。

**新增发现 · 宿主兼容性（O2 的具体形态，已在 P0 解决）**

基座构建用的是 harness **`0.1.7-rc.2`**（其 `peerDependencies` 要求的版本），而本机宿主实际是 **`0.1.5-rc.2`**。harness 0.1.7 改了 typert 的 codec 协议：

| 版本 | codec 形态 |
|---|---|
| 0.1.5 | `{ mode, typeSymbol, schema: <zod 对象> }` |
| 0.1.7 | `{ mode, typeSymbol, create: <懒求值函数> }` |

宿主的 `dsh-typert-loader` 以鸭子类型校验（注意：**不是 `instanceof`**，所以"双 zod 实例"不是问题）：

```js
if (typeof codec.schema !== "object" || codec.schema === null
    || !("_zod" in codec.schema)
    || typeof codec.schema.parse !== "function") throw ...
```

因此 0.1.7 形态的 manifest 会失败：`typert-loader: <pkg> invocation "<ns>/<method>" parameter codec is not backed by a zod v4 schema`。

**解法**：`scripts/patch-typert-compat.mjs`（已挂进 `build` 脚本）——把产物降级回 0.1.5 形态：
1. `create:` → `schema:`（3 个产物共 198 处）
2. `schema: <thunk>` → `schema: <thunk>()`（强制求值成 zod 对象，共 198 处）

两个替换均幂等，重建后自动生效。**宿主升级到 ≥ 0.1.7-rc.1 后即可删除该脚本**（脚本头部有说明）。

**⚠️ 同一问题的第二张脸（排查值得记）**

第一版脚本只修好了 **host 侧**，插件的 Node 半加载正常、启动无报错，但**浏览器界面**仍然弹 "Failed to load plugins"，报的是：

```
typert: dsh-sophia-entities#agentTeam/addMember **result** strict codec has no parse() method
```

注意措辞变了：从 **parameter** 变成 **result**，从 "not backed by a zod v4 schema" 变成 "no parse() method" —— 说明这是**另一处** codec，而且来自**客户端 bundle**。

根因：第一版正则要求 `schema: <name>` **后面必须跟逗号**，因为 host 侧与 remote-client 的 manifest 是**美化过**的（`schema: x,\n`）。但 `client.js` 是 **minify 产物**（63 万字符 / 14964 行），`schema` 恰好是每个 codec 对象的**最后一个字段**，后面**直接跟 `}`**：

```js
{ mode: "strict", typeSymbol: "...", schema: foo$schema }   // ← 没有逗号
```

于是 66 处客户端 codec **一处都没被改到**，`schema` 仍是未被调用的 thunk → 没有 `parse()` 方法。

**修正**：把正则末尾的 `,` 换成**前瞻断言** `(?=\s*[,}])`，同时兼容美化与压缩两种布局。修正后实测：

```
patched typert.host.js            (rename 66, materialise 66)
patched typert.remote-client.js   (rename 66, materialise 66)
patched client.js                 (rename 66, materialise 66)   ← 由 0 变 66
typert-compat: 198 renames, 198 materialisations
```

**教训**：构建产物补丁必须同时覆盖**美化**与**压缩**两种布局；只验证 Node 半的加载日志会漏掉浏览器半的问题——**界面上报的错和日志里报的错可能是同一个根因的两张脸**。

**用法教训（已踩过，务必记住）**

- `dsh web` 是 **`--profile web` 的别名**；启动自定义 profile 必须用 **`dsh --profile <name>`**（写成 `dsh web --profile X` 会被解析成启动 web profile，把 `--profile X` 当参数丢给 web app）
- `dsh plugin --profile <name> --help` 会**真的创建**那个 profile
- 新建 profile 只带 `@deepseek-ai/dsh-base`；要跑 Web UI 需手动把 **`@deepseek-ai/dsh-web-app`** 加进 `dsh.profile.bundles`（否则 `webServer` 服务不存在，插件会 pending）
- `@deepseek-ai` 宿主包从 **`~/.dsh/profiles/node_modules`** 提升解析（各 profile 自己的 `node_modules` 里没有）
- `dsh --dump-config --profile <name>` 是查看组合树的只读正路

**与主人环境的隔离性说明**：`~/.dsh/profiles/web` 本身处于不完整状态（bundles 里只有 3 个第三方插件、缺 `dsh-base`，`--dump-config` 报 `patch: entry "webserver" not found`）——这是**既有状态，非本次操作造成**；43120 端口上运行的是更早启动的实例。本次所有改动仅落在一个新建的隔离 profile 内。

### P1 · DAG 后端迁入（R5）

| # | 任务 | 验收 |
|---|---|---|
| 1.1 | `dsh-agent-teams/src/` 全量迁入 `packages/dag-team/src/` | 编译通过 |
| 1.2 | 14 个工具改名注册（`agent_teams_*` 保持原名，避免与 `team_*` 冲突） | 工具清单与上游逐一比对一致 |
| 1.3 | `client/` 全量迁入 `packages/dag-team-client/src/`，改 URL 前缀 + locale | 卡片与活动树在宿主可见 |
| 1.4 | 活动树浮层跑通（`shell.overlay`） | 创建 DAG 团队后活动树显示成员树 + 任务 DAG |
| 1.5 | 质量门禁与自动修复循环验证 | 构造一个 review 失败的任务，确认生成 repair + review 下轮 |

### ✅ P1 完成记录（2026-09-25）

**结论：DAG 后端已迁入并跑通，宿主加载零报错、浏览器零崩溃。**

| # | 任务 | 状态 | 实证 |
|---|---|---|---|
| 1.1 | teams Node 侧迁入 | ✅ | `packages/dag-team/src/` 17 个文件，`tsc` **0 错误**，产出 17 `.js` + 17 `.d.ts` |
| 1.2 | 工具注册 | ✅ | 保持 `agent_teams_*` 原名（与 `team_*` 不冲突），宿主启动日志干净 |
| 1.3 | client 侧迁入 | ✅ | `packages/client-agent-team/src/client/dag/` 18 个文件；bundle 640 KB → **856 KB** |
| 1.4 | 活动树/卡片 | ✅（待建队实测） | 浏览器实测 `[data-agent-teams-card]` = 1；`data-agent-teams-activity` 需真实团队才渲染 |
| 1.5 | 质量门禁 | ⏳ | 未构造失败 review，留待端到端验收 |

**为什么 P1 比预想顺利（三条关键事实，实测确认）**

1. **teams 官方就支持 0.1.5-rc.2**——其 `compatibility.json` 把 `0.1.5-rc.2` 列为 legacy 支持版本，`peerDependencies` 亦然。所以**不需要新增任何宿主兼容补丁**。
2. **teams 完全不用 typert codec**（全仓库零 `codec`/`typert` 引用），走 `defineTool` 注册 → 躲开了 P0 那个 codec 协议坑。
3. **teams 的图标本来就用数字尺寸**（`IconBranchOutline16` / `IconChevronDownOutline14`）→ 躲开了 P0 那个图标命名坑。

**与原计划的三处偏差（均为实测后修正，理由已写进代码注释）**

| 原计划 | 实际做法 | 理由 |
|---|---|---|
| 新增 `packages/dag-team-client/` 独立包 | client 侧作为 `client-agent-team/src/client/dag/` 子目录，并在统一入口组合 | DSH 插件包**只有一个** client 入口（`lib/client.js`，ModuleLoader id 必须等于包名），两套 client 无法出两个 bundle。组合点放在基座 client 的 `apply` 里，两半的 `inject` 取并集。 |
| — | `packages/dag-team/tsconfig*.json` 与 `packages/client-agent-team/tsconfig*.json` 局部关闭 `exactOptionalPropertyTypes` | 该开关来自 harness 派生的 facade，上游 teams 未启用；开启后移植代码报 TS2375/TS2379 若干。关闭**只影响类型检查**，不改产物与 `.d.ts`，且让上游源码保持逐字不变（便于与下个上游版本 diff）。 |
| — | `dag/index.tsx` 内 2 处 `ctx.sessions` 桥接（`as unknown as ...`） | 我们的 facade 把裸包名指向 harness **源码**、`/client` 子路径指向**编译产物**，同一服务出现两份声明且不相互兼容。基座 client 早已用同样方式（`ctx.sessions as unknown as ISessions`）跨这道缝，本次沿用同一模式，**纯类型层、行为不变**。 |

**实证清单（本轮）**

```
构建          pnpm run build → 0 错误；四包 lib 齐全；client.js 856 KB
组合树        dsh --dump-config --profile sophia-entities → 第 875 行 sophia-entities-dag-team
宿主启动      dsh --profile sophia-entities → 无 "failed to load"，无 error
浏览器        agent-browser：crashed = 0；[data-team-action] 可见；[data-agent-teams-card] = 1
HTTP 路由     GET /plugins/dsh-agent-teams/state → 401（存在且受鉴权保护）
              对照 GET /plugins/dsh-agent-teams/nope → 404
```

**尚未覆盖**：创建真实 DAG 团队后的活动树渲染、质量门禁 repair 循环、跨模式互操作（P2~P4 范围）。

### P2 · 编排层（R1/R6/R7）

| # | 任务 | 验收 |
|---|---|---|
| 2.1 | 审批领域模型 + 持久化 | 单测：写入/读取/原子性 |
| 2.2 | 状态机 + 超时 | 单测：四条路径 + 三种超时 |
| 2.3 | 3 个新工具 + 队长/Human 权限判定 | 成员调用 review 被拒 |
| 2.4 | Facade + materialize 双后端分派 | Human 发起 → 两种模式各建一个团队成功 |
| 2.5 | 递归建队 + 深度限制 + 去重 | 成员发起 → 正确进入 pending_captain |

### P3 · 卡片与模式选择（R2/R3）

| # | 任务 | 验收 |
|---|---|---|
| 3.1 | 审批卡定义 + 组件 | 宿主会话里调用 propose，卡片出现 |
| 3.2 | 模式选择器（`Menu`）+ `set_mode` 路由 | 切换后刷新页面，选择保留 |
| 3.3 | 批准 → 按所选模式物化 | 两种模式各验证一次 |
| 3.4 | 成员会话的只读卡 / 队长会话的审核卡 | 三种角色看到三种形态 |

### P4 · 通知与活动树双模式（R4/R8）

| # | 任务 | 验收 |
|---|---|---|
| 4.1 | 三条通知通道 + 并行降级 | 断网/无邮件通道时 Thread 通知仍到达 |
| 4.2 | 待审批徽标 | 有 pending_owner 时徽标计数 > 0 |
| 4.3 | 活动树支持 `persistent` 模式渲染 | 两种模式的团队都能在活动树看到 |
| 4.4 | 基座侧栏第三段（可选） | Team 模式下也能看到活动树 |

### P5 · 工程收尾

| # | 任务 |
|---|---|
| 5.1 | 上游 skill 库（teams 的 11 个插件开发 skill）并入或引用 |
| 5.2 | 边界检查脚本适配新包（`check-package-boundaries.mjs` 的包清单） |
| 5.3 | 文档：README / CHANGELOG / 本开发文档的完成态回填 |
| 5.4 | 分发方式落地（见 §10 D6） |

---

> **P2–P5 全量完成记录（2026-09 起实施，git 主线上逐项落地）**。实证以仓库 `git log` 与全量验证为准（`npm run typecheck`、`npm run build`、`npm run test`、`node scripts/check-package-boundaries.mjs` 全绿）。

**✅ P2 · 编排层完成记录**

| # | 任务 | 状态 | 实证 |
|---|---|---|---|
| 2.1 | 审批领域模型 + 持久化 | ✅ | `packages/orchestration/src/{types,store}.ts`；`types.ts` 内置 `proposalKey(goal,plan)` 去重；`store.ts` `withLock`+原子写，单测覆盖写入/读取/幂等 |
| 2.2 | 状态机 + 超时 | ✅ | 8 态 `ApprovalState`（draft/pending_captain/pending_owner/approved/downgraded/rejected/materialized/expired），四条路径 + 三种超时，单测齐全 |
| 2.3 | 3 个新工具 + 队长/Human 权限判定 | ✅ | `sophia_team_propose/review/approve` 经 `tools.ts` 注册；调用者权限判定在 `facade.ts` + dag-team 的 `resolveCaller`（member/captain/human 三态） |
| 2.4 | Facade + materialize 双后端分派 | ✅ | `dag-team/sophia-dag-backend.ts`（DAG 物化）+ `agent-team/sophia-persistent-backend.ts`（PersistentHostAPI 经宿主账本物化） |
| 2.5 | 递归建队 + 深度限制 + 去重 | ✅ | `orchestrationHost.maxTeamDepth` + `depthOfCaller` 上溯 parentSession；`proposalKey` 去重 |

**✅ P3 · 卡片与模式选择完成记录**

| # | 任务 | 状态 | 实证 |
|---|---|---|---|
| 3.1 | 审批卡定义 + 组件 | ✅ | `client-agent-team/src/client/dag/sophia-approval-card-definition.ts` + `SophiaApprovalCard.tsx`，`conversation.chat.node` keyed `sophia-approval` |
| 3.2 | 模式选择器 + `set_mode` 路由 | ✅ | `TeamModeMenu`（dsh-client-ui-primitives `Menu`），`set_mode` 经 POST `/approvals/plan` |
| 3.3 | 批准 → 按所选模式物化 | ✅ | `approve` 决策携带 `mode`，host 按 `persistent`/`dag` 分派物化 |
| 3.4 | 成员只读卡 / 队长审核卡 | ✅ | `MemberWaitingCard`（只读）/ `CaptainReviewCard`（四个 verdict 按钮） |

**✅ P4 · 通知与活动树双模式完成记录**

| # | 任务 | 状态 | 实证 |
|---|---|---|---|
| 4.1 | 三条通知通道 + 并行降级 | ✅ | `orchestration/notifier.ts`：`AgentMailNotifier`/`ThreadNotifier`/`BadgeNotifier` + 并行 `dispatchApprovalNotifications`，单测 11 例 |
| 4.2 | 待审批徽标 | ✅ | `SophiaApprovalBadge.tsx` + `startApprovalBadgePolling`，`sidebar.footer.action` order 150，轮询 `/plugins/dsh-sophia-entities/approvals` |
| 4.3 | 活动树支持 `persistent` 模式渲染 | ✅ | `snapshot.ts` 增 `persistentTeamSnapshot` + 宿主 `/state` 混入 persistentTeams；`ActivityPanel` `TeamSection` 按 `mode` 分支渲染摘要卡 |
| 4.4 | 基座侧栏第三段（可选） | ⏳ 未做 | 可选增强项，`shell.overlay` 活动树已两模式均可达，暂缓 |

**✅ P5 · 工程收尾完成记录**

| # | 任务 | 状态 | 实证 |
|---|---|---|---|
| 5.1 | 上游 skill 库并入或引用 | ⏳ 引用 | 上游 `dsh-agent-teams` checkout 已清理（技能源不可再本地 copy）；仓库自身已带纪律化 `packages/agent-team/core-skills/`（`check:core-skills` 门禁），11 个上游插件开发 skill 记录于 `docs/recon.md:137` 作参考，不并入仓库避免与自带 core-skills 重复 |
| 5.2 | 边界检查脚本适配新包 | ✅ | `check-package-boundaries.mjs` 已含 5 包 125 source files，`npm run test` 中的边界门全绿 |
| 5.3 | 文档回填 | ✅ | README/README.zh/CHANGELOG/CONTRIBUTING/LICENSE + 全文档品牌统一为 `dsh-sophia-entities`；本开发文档 P2–P5 完成态本表 |
| 5.4 | 分发方式落地 | ✅ | `git remote origin=https://github.com/AEmbers/dsh-sophia-entities.git`；**分发方式定为 git 源（构建产物入库）**：`.gitignore` 摘掉 `lib/`，`packages/*/lib` 380 个文件入库（5.0 MB），产物新鲜度由 `npm run check:bundle` + CI 双 lane 钉住；`dsh plugin add <Git 地址>`／本地目录／npm 三种来源均可安装，§10 D6 三态已覆盖 |

---

## 8. 验证方案

### 8.1 每阶段通用

```bash
cd dsh-sophia-entities
pnpm install
pnpm run typecheck      # tsc 三包 + 新包
pnpm run build          # 仓库级 tsdown
pnpm run check:boundaries
pnpm test               # vitest
python3 <skill>/scripts/verify_plugin.py .   # 轻量合同校验
```

### 8.2 安装冒烟

```bash
dsh plugin --profile web add <本仓库路径>
dsh web
```

浏览器自查清单：
- [ ] 启动日志无 `plugin tree failed to load`
- [ ] 控制台无 `slot entry crashed`、无 React 重复实例告警
- [ ] `sophia-hello` 命令可执行
- [ ] `GET /plugins/<id>/health` 返回 200

### 8.3 四条审批路径的端到端验收脚本

| 路径 | 操作 | 期望 |
|---|---|---|
| ① | 主人在宿主会话让模型调用 `sophia_team_propose` → 卡片选「DAG」→ 批准 | DAG 团队建立，活动树可见任务 DAG |
| ② | 某团队成员调用 propose，mode=dag | 直接进入 pending_captain；队长 review 后立即建立，**主人未被打扰** |
| ③ | 某成员 propose mode=persistent，队长 review 选 `downgrade_to_dag` | 直接建立为 DAG 团队，审批记录含降级理由 |
| ④ | 某成员 propose mode=persistent，队长 review 选 `approve_persistent` | 主人收到邮件 + Thread 通知；卡片出现待批准态；批准后按所选模式建立 |

### 8.4 回归保护

改基座 client 后，必须回归验证：**Team 模式下的原有 UI 未受影响**（侧栏两段、Thread 时间线、成员管理、Human 设置页）。做法：改动前截图存档，改动后逐一比对。

---

## 9. 风险与开放问题

### 9.1 开放问题（必须在使用前闭环）

| # | 问题 | 影响 | 闭环方式 |
|---|---|---|---|
| **O1** | 插件能否调用 agent-mail 工具发邮件？ | 决定 R8 的主通道是否成立 | 在 P0 阶段写一个最小探针：在插件里 `ctx.tools` 查找 mail 相关工具并打印结果 |
| **O2** | `~/.dsh` 的宿主（0.1.5-rc.1）能否加载基座（声明 >=0.1.7-rc.1）？ | 决定要不要升级宿主 | P0 直接装一次看结果；teams 的 `harness-compat.ts` 已覆盖 0.1.2/0.1.5/0.1.7 三代契约，基座可能也需要类似兼容层 |
| **O3** | 两个 client 如何打进同一个 bundle？ | 决定构建方案 | P0 用一个双入口的 tsdown 配置试构建 |
| **O4** | 宿主是否提供 `uiConversation` / `layout` / `modelDirectories` / `sidebarRight` 服务？ | 决定卡片与活动树能否挂上 | P0 打印 `ctx.get(...)` 探测结果 |

### 9.2 风险

| # | 风险 | 等级 | 缓解 |
|---|---|---|---|
| RK1 | 基座 `AgentTeam.addMember` 硬绑 Human actor，成员发起的持久团队物化可能被围栏拒绝 | **高** | 已设计为"主人批准后代为提交"，语义正当；但需在 O2 阶段实测 Remote 调用路径是否允许这种代理提交 |
| RK2 | 两套成员系统（基座 `ctx.agents.create` vs teams `subagents.startContinuable`）并存可能出现会话管理冲突 | 中 | 两种模式的成员各自独立管理，不做交叉；Facade 层只做只读聚合 |
| RK3 | 两个 client 的 locale 命名空间、CSS class、模块级 store 若重名会互相污染 | 中 | 全部加 `sophia*` 前缀；ModuleLoader id 只能一个，注意内部命名 |
| RK4 | 活动树的持久模式视图需要新的数据源 | 中 | 分阶段：P1 只做 DAG 模式，P4 补持久模式 |
| RK5 | 上游持续迭代，合并上游更新时可能冲突 | 中 | 已在 `docs/recon.md` 记录两个基线 commit；建议在 `docs/upstream.md` 维护"已修改文件清单" |
| RK6 | 成员自审自批 | **高（安全）** | `sophia_team_review` / `sophia_team_approve` 不进成员工具面（§4.3.3），并在 Node 侧二次校验 requester ≠ decider |

---

## 10. 待主人拍板的决策项

| # | 决策 | 选项 | 索菲亚的建议 |
|---|---|---|---|
| **D1** | 最终包名 | `@sophia/dsh-sophia-entities` / `dsh-sophia-entities` / 其它 | 若只在本机用，裸名 `dsh-sophia-entities` 即可；若要发布，用 scope |
| **D2** | 构建链 | 换 teams 链（**唯一可行**，C1 已证）/ 想办法弄到 harness 源码 | 换 teams 链，无悬念 |
| **D3** | 目录结构 | 基座三包 + 新增 3 包（D7 方案）/ 全部并进基座三包 | D7 方案——保留边界检查与 diff 清晰度 |
| **D4** | 活动树主落点 | `shell.overlay` 浮层（零改基座）/ 基座侧栏第三段（小改）/ 两者都做 | 两阶段：先浮层（P1），后侧栏段（P4） |
| **D5** | 美术资源 | 沿用 teams 的鲸鱼图 / 换成主人自己的 / 纯图标 | 沿用，先跑通功能；主人有需求再换 |
| **D6** | 分发方式 | git 源（构建产物入库）/ 本地目录 / npm | **已改为 git 源（构建产物入库）**：主人要求「GitHub 地址安装」必须可用，而官方安装器对 Git 依赖只做克隆＋按 `files` 白名单打包、不跑任何构建，故产物只能入库；`.gitignore` 已摘掉 `lib/`，本地目录与 npm 两种来源同时保留 |
| **D7** | 宿主版本 | 维持 0.1.5-rc.1 / 升级到 0.1.7-rc.x | 先维持（不动主人现有环境），待 O2 实测结果再定 |
| **D8** | 队长审核是"真 agent 裁决"还是"规则自动 + 队长可覆写" | 前者更符合原话，后者更省 token | 真 agent 裁决 + 超时升级兜底（原话要求"队长审核"） |

---

## 附：本次设计的调研依据

| 结论 | 证据来源 |
|---|---|
| 基座 Team 模式 shadow `main`/侧栏 | `packages/client-agent-team/src/client/index.ts:152-209` |
| 基座侧栏无子 slot | 全仓 grep 无 slot `children` 声明 |
| 基座队长 = 创建团队的会话 | `packages/agent-team/src/state.ts:342` `findTeamByCaptain` |
| 基座成员创建 Human-only | `packages/agent-team/src/index.ts:890-918` + `ledger.ts:3690` |
| 基座任务无依赖字段 | `packages/agent-team/src/types/entities.ts:284-290` |
| teams 完整支持 DAG | `types.ts:127-128` + `state.ts:135-138` + `scheduler.ts:199-205` |
| teams 两相计划 + approve | `tools.ts:1011-1041` / `587-624` |
| teams 卡片事件折叠机制 | `src/client/agent-teams-card-definition.ts:69-118` |
| teams 活动树结构 | `src/client/ActivityPanel.tsx:487-765` + `activity-model.ts:264-334` |
| teams 构建链自包含 | `tsdown.config.ts`（无 harness import） |
| 基座构建链依赖 harness | `scripts/harness-dir.mjs` + `packages/client-agent-team/tsdown.config.ts:9` |
| 工具命名空间不冲突 | `tool-names.ts`（teams）vs `member-runtime.ts:43-52`（基座） |
| 本机环境事实 | 命令行核实（dsh 0.1.5-rc.1 / `~/.dsh` / harness 缺失） |

---

*本文档为设计基线，实施过程中的偏离必须回写到本文档并说明原因。*
