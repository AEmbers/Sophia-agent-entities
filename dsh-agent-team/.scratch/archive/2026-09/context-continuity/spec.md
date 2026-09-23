> 迁入自 `packages/context-continuity/DESIGN.md`（2026-09-21，原孵化目录已删除）。这是抽取工作的设计快照：§0/A/B 的工具工厂、timeline、search 已在引擎落地；§C 是 Team 接入的设计、红线与验收；§D 是已拍的收敛结论。

# 设计:tools / timeline / search / Team 接入

**状态:** 设计草案,供独立项目 `dsh-context-continuity` 开发时参考;基于 dsh-agent-team 现有实现泛型化。
**配合阅读:** 同目录 `HANDOFF.md`(总体任务、已完成核心、core-gap 判定)。
**权威:** 行为以 `packages/agent-team/src/` 现有代码为准;本文是把它泛型化的设计判断,不是最终合同。

---

## 定位(先对齐,决定什么是核心交付)

本 plugin 不是"一个引擎库",而是**"agent 自主管理自己的 context、把 session 当 context infra 的解决方案"**。因此**模型能触达的工具面是核心交付,不是可选附加**——agent 唯一能操作这套连续性机制的入口就是那几个 `context_*` 工具。工具面缺失 = 每个消费者(Team/Loom)各自重写一遍适配,通用化意义丢一半。

README 的措辞应从 "engine" 扩为 "solution":引擎核心 + 工具面 + memory-manager 式自管理模式,一起构成方案。

## 0. tools 通用化(`context_rollover` / `context_checkpoint` / `context_timeline`)

### 0.1 现状

三个工具仍在 `packages/tool-agent-team/src/context-tools.ts`,**尚未迁入通用包**。读过实现:它们几乎全通用,Team 专属的只有两处——措辞("Team Member"/"Thread/Claim")和 host 查找(`agent.ctx.get('agentTeam')`)。

### 0.2 设计:工具工厂 + 文案配置

```
  引擎提供 createContinuityTools(adapter, text?) → 三个 defineTool
    通用不变(留在引擎):
      · 参数校验:handoff 非空 / 32KiB 上限 / relatedFiles 结构 / checkpointRef 防伪造
        (这些是安全约束,不能下放给 host)
      · concludeTurn 时机、结果 render 整形
      · 通过 adapter 调 host 的 coordinator/host 方法
    host 定制(text,带默认值):
      · subjectNoun        "Team Member" / "Individual" / "agent"
      · rolloverChecklist  handoff 要写什么(Team:Thread/Claim;Loom:Input/Effect/Delivery)
      · checkpointGuidance 何时该埋锚点
    host 提供 adapter:
      · requestRollover / recordCheckpoint / timeline —— 落到自己的 host 实现
```

**校验里的安全约束(防伪造 checkpointRef、字节上限)必须留在引擎通用**,不能靠 host 自觉。措辞走配置。

### 0.3 tool description 的定制边界

允许 host 覆盖"面向主体的措辞"(subjectNoun / checklist / guidance),但**不允许**改动会影响安全或历史兼容的部分:checkpointRef 防伪造的警告文案语义、"context change never rolls back external effect" 这条纪律必须保留(它是跨消费者的安全不变量)。默认文案取 Team 现有措辞。

---

## A. timeline(`context_timeline`)

### A.1 现有机制(已核实,通用部分直接沿用)

`contextTimelineForAgent`(`index.ts:1983`)的骨架**几乎全通用**:

```
  从当前世代 fold projection state
    ↓ 顺 header.parentSession 往上走归档祖先(有界 MAX_TIMELINE_ANCESTORS)
    ↓ 同一个 fold 处理每个源(current 直接读,祖先经 StoredSessionReader.read)
    ↓ 每源产出 timelineCandidates,跨源去重(seen set),累计到 limit 截断
    ↓ 不可读祖先 → 记 incompleteFrom{sessionId, reason},不静默断链,不影响主体可用性
  返回 { usageTokens, hardLimit, handoffAt, items[], incompleteFrom? }
```

**计价**:每个候选按**源自身**的 replay 测量计价(`sourceUsageTokens`),小的当前世代不会把大祖先的真实 seed 成本算小。祖先测量靠从 stored log 重建 detached `Session.create(...)` 再 `meter.measure`。这条通用。

**restorable 判定**:候选带 `restorable: boolean` + 不可复原时的 `reason`;可复原候选才带 `checkpointRef`。这条通用。

### A.2 Team 专属的唯一一处:锚点归属

`timelineItemFor` 里每个候选带 `affectedThreads`——**Thread 是 Team 专属概念**。通用化时:

- 引擎产出的 `DomainBoundary` 带 `attributions: readonly string[]`(opaque topic id,见 `projection-state.ts`)。
- "恰好归属一个 topic 的、完成 turn 上的边界"才是可选默认锚点——**这条规则通用**,什么算 topic 由 host 定(Team=Thread,Loom=一条 continuity 主线)。
- timeline item 的 `affectedThreads` 泛化成 `affectedTopics`(或让 host 提供渲染标签)。

### A.3 泛型 timeline 的责任划分

```
  引擎拥有:
    · 谱系游走(parentSession 拼多文件为一条线)+ 有界 + 去重
    · 每源计价(replay 测量)+ restorable 判定 + incompleteFrom
    · 候选 → timeline item 的组装(不含领域标签)
  host 注入(通过已有 hook + 少量新增):
    · projectionForSubject(已有)——每源的 fold state,其中 boundaries 是 host 贡献的
    · sourceUsageTokens 的测量能力(tokenMeter 是 ctx 上的,可由引擎直接取;确认后定)
    · topic 显示标签(可选:引擎给 attributions,host 给人类可读名)
```

### A.4 待定(独立项目里拍)

- `tokenMeter` / `routeLimitsForAgent` 是从 `agent.ctx` 取的通用能力,还是要走 host hook?倾向前者(引擎直接用 ctx),因为它们是 harness 通用服务,不是领域概念。核实后定。
- `StoredSessionReader` 已在本包,timeline 的祖先读取直接用它。

## B. search(`context_search` / `context_read`)

### B.1 已收敛的设计(来自 dsh-agent-team scratch,直接采用)

见 `.scratch/active/member-session-architecture/`:read seam、return-anchor 统一策略、owned-history 授权已定稿(ticket 03/04/05 complete),search 是待启动扩展。核心结论:

- **两工具召回阶梯**(不是镜像 harness 五工具,不是 CodeAct 脚本,不是单工具黑盒):
  ```
  context_search({ query, within?, after?, before? })
    → 有界、排名、去重的片段;默认搜该主体全部历史世代;
      within=某命中的 contextRef 则只深搜那个世代;无 cursor/limit/session-id/event-type 参数。
  context_read({ contextRef })
    → 展开一个命中的语义邻域(目标必在,邻域由引擎在固定预算内选),不让模型猜 raw before/after。
  ```
- **底层复用 harness `sessionQuery`**,不造第二索引。shipped 的 `session-query-sqlite` 默认 `openAt:never` + `:memory:`——要真 FTS,bundle 后置 patch 把同一 root provider 配成 `openAt:first-search` + 专用 derived-index 路径。**注意副作用**:这是 bundle-wide 开关,可能同时让 Web 内容搜索可用,实施前写进 spec/验收。
- **授权**:host 从主体身份派生可搜范围(Team 从 ledger 派生 owned Sessions);猜的 session id 或同 cwd 不授予访问。模型永远不能扩大范围。
- **搜索是历史证据,不是指令/权限**;shadowed/log-only 命中如实标注。
- **穿越是 optional enrichment**:命中若恰好在当前活跃谱系上、且共享 return-anchor 策略证明有安全前缀,才附 `checkpointRef` 给 `context_rollover`;废弃分支可搜但不是返回目标。

### B.2 泛型化的接缝

```
  引擎拥有:
    · context_search / context_read 两工具的模型面契约与结果整形
    · 命中去重、继承前缀去重、语义邻域预算
    · return-anchor 统一策略(与 timeline 共享同一 helper)
  host 注入(SearchScopeProvider):
    · 见 B.2.1;sessionQuery 本身是 harness ctx 能力,引擎直接用
```

### B.2.1 SearchScopeProvider——scope 由 host 定义,引擎不认 workspace/team

收敛结论:引擎只认"主体 + 一组被授权的 session";workspace/team 不是引擎的一等概念,而是 host 定义的命名 scope。

```ts
interface SearchScopeProvider<SubjectId> {
  // 默认范围:该主体自己的全部 session 谱系(跨世代)
  ownedSessions(id: SubjectId): SessionId[] | Promise<SessionId[]>
  // 该主体可选的命名范围 —— host 定义它们是什么
  //   Team: 该 member 参与的每个 workspace / 每个团队
  //   Loom: 通常不实现(一个 Individual 就一条线)
  availableScopes?(id: SubjectId): { scopeId: string; label: string }[]
  // 把模型选的 scope 解析成它被授权的 session 集
  sessionsInScope?(id: SubjectId, scopeId: string): SessionId[] | Promise<SessionId[]>
}
```

三个场景各自成立,语义全归 host:

```
  context_search({ query })               → 默认 ownedSessions:当前主体自己的历史
                                             (保住 Team 原来"限当前 member"的行为)
  context_search({ query, scope:"ws-2" }) → sessionsInScope 派生 ws-2 里该 member 可见的 session
  多团队:agent 属于多团队 → availableScopes 返回全部所属团队,模型从中选一个搜
  Loom:  不实现 availableScopes,只有 ownedSessions,天然就是"一个人的一生"
```

安全不变量(沿用 Team owned-history 授权):scope 永远由 host 从主体身份派生。模型给的 scopeId 只能在 host 已授权的范围里选,不能靠构造任意 id 扩大访问。猜的 session id、别的主体的 session 一律拒。引擎强制"只在 host 返回的集合内搜"。

### B.3 return-anchor 单一策略(timeline 与 search 共享)

timeline 候选解析、search 命中 enrichment、`context_rollover(checkpointRef)` 三处**不能各自定义"安全历史返回"**。抽一个只读 anchor 评估(从现有 `checkpointByRef` / `retainedEstimate` / 归属规则来),rollover 执行时再重验可变 guard(claim 数、预算、nonshrinking)。历史返回 = 从精确验证过的、止于完成-turn 锚点的前缀 seed 出一个新世代,**从不回滚 files/git/jobs/领域事实**。

## C. 步骤 6:Team 接入

### C.1 目标

Team 实现 `ContextContinuityHost<AgentTeamMemberId>`,删除自己的 context-management / context-source 副本,改为消费 `@wowyuarm/dsh-context-continuity`。**硬约束:Team 现有测试全绿、行为字节级不变。**

### C.2 Team 侧要提供的 host 实现

对照已定的 hook 接口(`host.ts`),Team 用现有代码填:

| hook | Team 用什么填(现有代码) |
| --- | --- |
| `agentForSubject(memberId)` | `this.handles.get(memberId)?.agent` |
| `subjectForAgent(agent)` | `this.memberForAgent(agent)` → `{ id: memberId, sessionId }` |
| `projectionForSubject(id, sid)` | 现有 fold 读回的 state(其 boundaries 填 Team 的 message/claim/thread 锚点)。**注意:projection unit 是每 host 注册一次(框架每个 key 只认一份),不是每 Session 一份;state 自带 sessionId + inheritedEventCount,apply 跳过继承前缀(seq < inheritedEventCount)** —— 见引擎 commit 310ed88。 |
| `executeTransition(id, plan)` | 现有 `executeMemberTransition` |
| `rolloverIdentity(prevSid, callId)` | 现有 `sha256([sessionId, toolCallId])` → `agent-team-rollover-${hash}` + requestId |
| `isEphemeralNotice(msg)` | 现有 `isTeamNotice`(plugin==Team 且非 context source) |
| `ownedSessionsForSubject(id)` | 从 ledger 派生该 Member 的 owned Sessions(search 用;step 6 要新建 replay 派生的 `sessionIdsByMember` 索引) |

> **④ search port 已拍(引擎 commit 2929e52):** `ContextSearchPort` 按发布版 `@deepseek-ai/dsh-session-query` 的真实四方法(searchSessions / searchEvents / filterEvents / readSession)定义,结构上可赋值 `ctx.sessionQuery`,host 零 glue。不是另造假想 port。Team step 6:把 `ctx.sessionQuery` 加进依赖。

codec 用 Team 的 pluginId + 现有两句文案构造:
- `handoffIntro`: `Context handoff: you are continuing as the same Team Member in a fresh private context.`
- `handoffVerifyNote`: `Your handoff from the previous context follows. Verify external state...`

### C.3 兼容性红线(会咬人的地方)

1. **pluginId 必须保持 `@wowyuarm/dsh-agent-team` 不变**。历史 Session 日志里 handoff/续接消息的 source.plugin 写的是这个;codec 靠它读回。改了就解不了历史。
2. **section 名固定**(HANDOFF / Previous session / …)。同理,历史日志读回依赖它。本包已把它们设为固定常量,不参数化——正确。
3. **rollover session id 命名 `agent-team-rollover-${sha256(...)}` 不变**。已在途的 rollover 崩溃恢复靠它幂等收敛。
4. **projection stateVersion**:若 fold 改造成 `ProjectionDefinition`,序列化字段或语义一变就要 bump,让旧缓存失效。
5. **`new_context` legacy 解码**:rollover 工具曾叫 `new_context`,旧 Session 仍带这名的 call/result 对。projection 必须继续 fold 它(是日志解码器,不是工具别名)。本包 `projection-state` 通用化时要保留这个 legacy 解码路径。

### C.4 验收(在能跑 Team 完整测试的环境做,不是本 sandbox)

- Team 现有 context 相关测试全绿:`context-projection.spec.ts`(49 项基线已知绿)、`context-source-migration.spec.ts`、`pressure-policy.spec.ts`。
- `dsh-developer verify`:一次性 profile 里真实跑 `context_rollover` / `context_checkpoint` / `context_timeline`,比对结果与错误,证明行为不变。
- 历史 Session 迁移:用带旧 `new_context` 事件、旧 section 名的 Session 验证仍能 fold、仍能 rollover。
- 崩溃恢复演练:rollover 结果持久后 kill,重启验证 `recoverPendingTransition` 两分支(turn 未结束 / 已结束)。

### C.5 顺序

先接 rollover/checkpoint(coordinator + codec,接缝最干净),Team 测试绿;再接 projection(fold 改造);最后接 timeline/search。每步独立验收,不一次性全换。

## D. 收敛结论(已拍,team 按此实现)

1. **边界:本 plugin 只做 session continuity。** memory/notes/attention/threads 自管理是平行的另一件事(workspace 文件 + skill),不在本 plugin。
2. **search scope 用 host 定义的命名 scope(`SearchScopeProvider`,见 B.2.1)**,workspace/team 不进引擎一等概念。默认 = ownedSessions(主体自己)。
3. **工具面用工厂 + 文案配置(`createContinuityTools`,见第 0 节)**。安全约束(防伪造 ref、字节上限、"rollover 不回滚外部效果"纪律)留在引擎不可覆盖;host 只能改面向主体的措辞。
4. **PressurePolicy 进本 plugin。** “接近预算就提醒主体准备 handoff” 是通用连续性关切;领域差异只是提醒里的“在手工作标签”(一个 host hook)。

### 仍开放(实现时定,不阻塞接口)

- `tokenMeter` / `routeLimits`:倾向从 `agent.ctx` 直取(harness 通用服务,非领域概念),实现时核实。
- search 的 bundle-wide FTS patch 副作用在 Loom(无 Web 内容搜索面)怎么表达。
