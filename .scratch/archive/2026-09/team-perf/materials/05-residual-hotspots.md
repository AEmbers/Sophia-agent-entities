# 05 的靶子：04 之后残余超线性到底在哪（2026-09-13 23:2x，Tars 读过源码后）

`:packages/agent-team/src/ledger.ts`（4,017 行）是唯一权威；下面是**阅读定位**，不是实测归属——每一条落地前都要用探针证伪/证实（判据见 [`../issues/05-read-indexes-and-cow.md`](../issues/05-read-indexes-and-cow.md)）。

## 状态（2026-09-13 23:4x 更新）

- **① 已落 `e38c6be`**（校验路径 ref 索引）：`[...projection.messages]`、`[...orderedFacts.filter(activity)]`、`new Set([...threads.keys()])` 三份全量复制与每个 marker 的整份数组 `.find` 全部消失；`Projection.messages` 数组本身删除，换 `messagesByRef` 与 `factsByThread` 同一次 append 维护。**偏离原计划一条**：活动 marker 侧**没有**建索引——变异臂 M3（删掉索引写入）82 条全绿，四处 builder 都用本操作自带 activity 的 ref+sequence、removal 不查 activity、实体 ref 全局唯一 ⇒ 投影侧索引没有可判读者，是死状态，已删。判据与变异表见 [`../issues/05-read-indexes-and-cow.md`](../issues/05-read-indexes-and-cow.md)「第二片」。
- **② 已随第一片 `956011a` 修掉**：`firstRead` / legacy 读的 `attentionBefore` 背景画面从全局 `projection.messages.filter(...)` 改走 `factsByThread`。
- **③ 已由 Vera 的 per-kind 复测结案：不需要做**（2026-09-13 23:5x）。第二片落地后，这些低频 kind 的同会话绝对量已经是：`task-changed` 0.0129、`thread-attention-changed` 0.0085、`claim-created` 0.0170、`claim-done` 0.0159、`claim-released` 0.0156、`channel-archived` 0.0966、`channel-member-removed` 0.0327 ms/次（父提交 `956011a` 分别为 0.0494 / 0.0339 / 0.0450 / 0.0435 / 0.0439 / 0.1294 / 0.0379，`06569e6` 更高）——它们跟着第二片一起降了，因为 parent 对**每条** inbox 记录都付整份 Message 复制；剩下的绝对量都在 0.1 ms/次以下、次数在百次量级（整趟合计 < 10 ms），继续优化没有可判收益。数据见 [`phase0/findings.md`](phase0/findings.md) §3g。
- **drain 合并仍未动**：改读的 durable 语义与 Client retry 合同，需 Vera + Human/Reeve 先拍口径。

## 先分清两件事：**查询是索引化的，但每次读仍克隆整份 marker 状态**

- **查询（按 key 取数）确实已经索引化**：`factsByThread`（`threadFactsFrom`）、`directMarkersByMember.get(member).get(thread)`（`directMarkersForFrom`）、`activityMarkersByMember`、`attention` 按 `attentionKey(member, thread)`、`mentionsByMessage` —— 单点取数与该 Thread / 该 Member 的规模有关，与账本总量无关。
- **但一次读仍付 O(marker 总量) 的分配**（⚠️ 本条是 2026-09-13 23:2x 的**修正**：先前一版材料误写「读路径不是靶子」，那是把「查询索引化」当成了「整条读路径」）：

  `readThread` → `prepareRead` → `prepareReadFrom`（约 2876–2914）在算 `remainingUnreadCount` 时，为了「先把这次读的 Inbox delta 应用上去、再数还剩多少未读」，构造了一个**假设投影**：

  ```ts
  const nextProjection: Projection = { ...projection,
    attention: new Map(projection.attention), directMarkers: new Map(projection.directMarkers),
    activityMarkers: new Map(projection.activityMarkers),
    attentionByThread: /* 逐 thread 复制 follower Set */, attentionThreadsByMember: /* 同 */,
    directMarkersByMember: /* 逐 member→thread 复制 marker 数组 */, activityMarkersByMember: /* 同 */ }
  this.applyInboxDelta(nextProjection, receipt.inbox)
  const remainingUnreadCount = this.unreadForFrom(nextProjection, memberId, thread.threadRef).length
  ```

  **这次克隆是每次读都付的**，而 marker 总量随账本增长（每条被 mention 的消息至少一个 marker）⇒ 单次读的分配与耗时随账本线性。这正是票面第一句「一次读不再复制整个全局 marker projection」说的东西，**它今天仍然成立**。

  关键观察：`unreadForFrom` 只读四个东西 —— `attention`（**单个** key）、`factsByThread`（**单个** Thread）、`directMarkersForFrom`（**单个** member×thread）、`activityMarkersForFrom`（**单个** member×thread）。所以根本不需要整份投影：给 `unreadForFrom` 加一个**线程级 overlay**（attention 覆盖值 + 该 member×thread 的 marker 增删），或另写一个 `remainingUnreadAfter(receipt)`，只走该 Thread 的 fact 列表 + 该 Thread 的 marker 桶即可。**这是 05 在读路径上的主刀**。

  （同一个函数里还有一处：`firstRead` 时 `projection.messages.filter(...)` 取「关注前的背景」，也是 O(全部 messages) —— 但只在关注后第一次读触发，频率低；顺手改成走 `factsByThread` 即可。）

## 校验侧的真靶子（同样按预期收益排序）

### ① `validateInboxDelta` 每条消息记录都复制整份 messages / orderedFacts（最大项）

`validateInboxDelta`（约 2325 行起）在**每条** `team/message-sent` / `team/thread-replied` 的校验里无条件做：

```ts
const knownThreadRefs = new Set([...projection.threads.keys(), ...additionalThreadRefs])   // O(threads)
const messages = [...projection.messages, ...additionalMessages]                           // O(messages)
const activities = [...projection.orderedFacts.filter(f => f.kind === 'activity').map(f => f.activity), ...]  // O(all facts)
```

然后对每个 marker 在 `messages` / `activities` 上 `.find(...)`（再一次 O(n)）。账本越大 ⇒ 每条消息记录的校验越贵 ⇒ 这正是实测的 `thread-replied` 每记录 0.0139 → 0.0482 ms（04 之后仍在）。

改法（纯校验内部，不动 durable 语义、不动 schema）：

- 只做**成员测试**的地方直接用 `projection.threads.has(...)`（`additionalThreadRefs` 单独判），不要建 Set；
- 给 `messageRef → AgentTeamMessage`、`activityRef → AgentTeamActivity` 建 replay-derived 索引（与 `factsByThread` 同源、同一次 apply 里维护），marker 校验改按 ref 查；`additionalMessages` / `additionalActivities` 只在这两处是「本记录自带、还没 apply」的补充，按 ref 合并即可；
- `activities` 那份 `orderedFacts.filter(...)` 别每条记录重建。**结论（落地后修正）**：这里原写的「直接用现成的 `activitiesByRef`」是错的——当时并不存在这个索引；而且加了一个之后变异臂证明它**没有可判读者**（活动 marker 只由本操作自带的 activity 产生、removal 不查 activity、实体 ref 全局唯一），最终只保留按 ref 解析本记录自带的 `additionalActivities`，见顶部状态。

### ② legacy 胖读记录的 `attentionBefore` 画面对全局 messages 做 filter

`prepareReadFrom`（约 2876–2915 行内）里：

```ts
? projection.messages.filter(m => m.threadRef === thread.threadRef && m.sequence < receipt.attentionBefore!.startSequence)
```

O(全部 messages) **每条 legacy 读记录**。冻结件里 7,079 条读全是胖的 ⇒ 这条在真账本上很贵（在「全瘦」反事实账本上不存在，所以 04 的曲线没把它算进去——这是 04 与 05 的口径差，报告时要分开写）。改法：走 `factsByThread` 按 sequence 过滤（该 Thread 内很小），或给 `messagesByThread` 建有序索引。

### ③ 少数 kind 的 inbox 派生对整个 marker/attention/claims 映射做 filter

`closeThreadInboxFrom` / `reopen` / `promote` / `removeMemberThreadInbox` / `channelArchivalInbox`（约 2990–3070）里遍地 `[...projection.attention.values()].filter(...)`、`[...projection.directMarkers.values()].filter(...)`；`validateReleaseCleanup`（约 2410）与 `claimsForTaskFrom`（约 3236）、`hasActiveClaimFrom`（约 3314）、claim 分支的 `priorClaims`（约 2283）扫全量 claims。

这些 kind（`thread-closed` / `thread-accepted` / `thread-reopened` / `member-removed` / `channel-archived` / `claim-changed`）在账本里**频率低**，所以它们是次要项：先用 ① 把主曲线压平，再按探针的 per-kind 表决定要不要动 ③。已存在的 `attentionByThread` / `attentionThreadsByMember` 索引（04 的 snapshot 分支里被克隆过，说明它们确实存在）可以直接用。

## 05 票面第二部分：drain 合并（**要产品口径，先对齐再动**）

400 条未读 = 20 轮 × 每轮 20 条；每轮之间事件循环让出一次 ⇒ 每轮各付一次延后全量重放（Phase 0 实测 13.75 s，几乎全是重放）。04 把单次重放从 843 → 512 ms（全瘦账本），所以这条现在大约值「轮数 × 0.5 s」而不是「× 0.8 s」，但仍与轮数线性。

三个候选，**收益/风险差别很大**：

1. **只做索引与去克隆（= 读路径 overlay + ①②③）**：不动 durable 语义、不动 Client。纯收益、随时可落。
2. **一批 drain 读落进同一回合**：Client 侧少让出事件循环，或 Host 侧把同 requestId 批的读合并成一次提交。省的是「轮数 × 一次重放」，但改的是读的 durable 语义与 Client retry 合同（02/04 刚定完）⇒ 需要 Vera + Human/Reeve 先拍口径，并按票面要求重测 20/100/400 三条用户可见墙钟。
3. **让延后重放增量/COW**：真正的解，但把 03 的「延后合并」升级成增量重放，架构面最大；只在 1 之后仍不达标才评估。

**我的建议**：05 先只做 1，三处曲线一起量（**读路径的每次读分配**、legacy 读校验、消息校验），用探针给出 per-kind 前后绝对量；把 2 作为独立决定（需要用户可见口径）在 Thread 里问，不混进 05 的 commit。

## 复跑/验证口径（沿用 04 的仪器）

- 曲线：`materials/phase0/zz-t04-measure.spec.ts` 的 `T04_ARM=curve`（按 kind 拆的 `topKinds` 就是归属证据），冻结件 + `slim-ledger.py` 造出的全瘦件两条都跑。
- **读路径那刀要另加一支臂**：真装配下对一个**有未读**的 Thread 连续读（每次都落盘），量读调用墙钟与堆分配；改前应随 marker 总量增长，改后应只随该 Thread 的 fact 数增长。最省事的对照是「同一份账本、构造一个 marker 极多但目标 Thread 很小的场景」——没有这个对照，读路径的收益会被噪声吃掉。
- ④ 类「零改写/语义不变」：全量 `npm test` + `change-scopes` / `member-lifecycle` / ledger 相关包内回归；新增索引是 replay-derived 派生数据，**必须**在 `applyTo` 的同一次 apply 里维护（live 与 scratch 投影都走同一条路，所以天然成立），而**去克隆那刀是纯局部重写**，判据是「overlay 版与克隆版逐字同结果」的等价臂。
