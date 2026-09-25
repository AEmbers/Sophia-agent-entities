# 已做

调研入口。数字来自 Vera 在 thread:0de17583 的冻结账本测量；合入后以 git 与测试为准。

## 第一刀 — 读路径投影索引（issue #21 / PR #22）

- **问题**：Channel / Thread / Inbox 打开随 ops 线性变慢。
- **修法**：presence wake 与 ledger 投影索引解耦；inbox/view/observations 用反向索引，不拆 `view` Remote，不改 Inbox/mention 语义。
- **合入**：squash `5b734ef`，issue #21 关闭。硬约束：性能优先、体验与 Remote 形状不变。
- **S3（4336 ops / 480 threads，51 迭代，对 master 基线）**

| 指标 | 修前 | 修后 |
| --- | --- | --- |
| `inbox(directOnly,1)` | 4.79 ms | 1.02 ms（−79%） |
| `inbox(directOnly,100)` | 3.63 ms | 0.95 ms（−74%） |
| `view(limit:1)` | 0.254 ms | 0.123 ms（−52%） |
| `threadObservations` | 0.121 ms | 0.001 ms（−99%） |

- **验收教训**：截图字节比对对本仓库无效（同 tree 连跑两次只有 0–3/60 相同）。可见 UI 证据是旅程 exit 0。小规模档比值不可用（S1 已在噪声底）；主判据 = 大档绝对量，噪声约 ±34%。
- **体感残余**：Channel 切换快了；进 thread 仍慢。探针直接驱动 ledger、没挂 invariant，漏了提交路径。

## 第二刀 — 提交热路径上的全量 invariant（A）

- **问题**：打开 thread = 写 `team/thread-read`；每次 `agent-team/committed` 同步 `validateRecords`（空投影独立重放到尾）。Channel 是纯读所以快。
- **修法**：只改 invariant 伴生插件。同一张网、同一次全量记录级重放，改为延后一个 check 相 + 突发合并；启动挂载仍同步全量；测试 `validate()` 仍直调。不改 ledger 提交语义。
- **合入**：本地 master `2b8b62b`（未推 GitHub）。共享树曾被 squash 重写，Vera 用 `rebase --onto origin/master` 只重放自己那条。
- **真装配（冻结账本 11,695 ops）**

| | 修前 | 修后 |
| --- | --- | --- |
| `readThread`（挂校验） | 866 / 813 / 826 ms | 8 / 6 / 5 ms |
| `readThread`（不挂） | ~7 ms | ~7 ms |
| `emit` 调用内 | 587–622 ms | ~0.1 ms |
| 直调 `validate()` | — | 仍 842 / 826 / 759 ms |

- **语义变化**：首次检测晚一帧；失败抛在**下一次**提交的调用方栈；latched 后继续重放，干净即解除。
- **残余**：~0.8 s 没消失，花在响应之后、每批一次，随账本线性。压它靠 B2，不靠把校验改弱。
- **要体感**：重启 `dsh web --profile web-dev`（会掐 member 会话）。

## 第三刀 — 启动复用构造期校验（票 01）

- **问题**：启动付两次全量记录级校验——账本构造一次，invariant 挂载再一次（同一份记录、同一次独立 scratch 重放）。
- **修法**：构造期重放后记下 `{记录数, head sequence, head operationId}`；挂载时先消费这个结论再比对活 head，一致就复用，不一致回落整次 `validate()`。校验本身没有变弱，只是不重复跑同一份输入。
- **合入**：`d94fa64`（本地 master，未推）。票 02 正在同一分支上实施。
- **真装配（冻结账本 11,695 ops，父提交 `2b8b62b` 同小时对照）**

| 臂（3 次启动） | 改前 | 改后 |
| --- | --- | --- |
| invariant-on boot | 2,488 / 2,384 / 2,175 ms | **1,595 / 1,476 / 1,635 ms** |
| invariant-on `fullReplays` | 2 / 2 / 2 | **1 / 1 / 1** |
| invariant-off boot（对照） | 1,984 / 1,907 / 1,773 ms | 1,944 / 1,912 / 1,677 ms |

- **验收（Vera）**：五臂对抗探针全绿——复用是活的（挂载 0.8 ms）、提交过的启动必回落全量、结论一次性、启动期 fail-closed 未丢（启动前改坏记录 ⇒ 启动失败）、绕开 commit 的原地改写只把检测推迟到下一次提交（实测：延后重放抛 → 再下一次提交在调用方栈抛 `invariant violated`）。包内 `agent-team.spec.ts` 70/70 绿。原始输出与口径见 [`phase0/findings.md`](phase0/findings.md) §1b。
- **残余**：启动省的是一次 ~0.8 s 重放；剩下那一次仍随账本线性（B2 瘦记录才是压它的正道）。

## 第四刀 — 无进展的读不落盘（票 02）

- **问题**：一次「已经读完」的打开仍然 `table.put` 一整条 ~4 KB 的 `team/thread-read`、推进全局版本，并让延后校验再付一次 ≈0.8 s 全量重放。
- **修法**：`prepareRead` 算出的 Inbox delta（attention / directMarkers / activityMarkers）三组都为空时，读直接返回当前画面：不 put、不 apply、不 emit、不给 receipt。有进展照旧落一次；两条分支共用 `readPicture()`，空读画面与提交那次同源。receipt 合同：`committed:true` 分支类型上必带 receipt，重试已落盘的读仍返回原 receipt。
- **合入**：`8dabaa3`（本地 master，未推）。
- **真装配（冻结账本 11,695 ops，父提交 `d94fa64` 同小时对照）**

| 已读完的 thread 再读一次 | 改前 | 改后 |
| --- | --- | --- |
| operations | 11,695 → 11,696 | 11,695 → **11,695** |
| `changeVersion` / `committed` 事件 | +1 / 1 | **0 / 0** |
| 延后全量重放 | 1 次（834.3 ms） | **0 次（0 ms）** |
| receipt / 读调用墙钟 | seq 11,696 / 7.3 ms | **无 receipt / 1.0 ms** |

- **历史体量（离线复算冻结件）**：7,079 条读里 **2,607 条（36.8%）是空 delta**，对应 8.1 MB = 账本 JSON 的 21.2%；Human 的 3,391 条读里 61.6% 是空 delta。空 delta ⇒ apply 不改投影，所以这是精确反事实。
- **验收（Vera）**：空读 0 条 / 0 版本 / 0 事件 / 0 重放；有未读仍落盘（11,697 + 814 ms 重放，版本 +1）；同 requestId 重试同 receipt、不写第二条；真重启同一 sqlite 文件后水位不丢、再读仍不落盘。独立跑 `packages/agent-team` + `packages/tool-agent-team`：29 文件 / 433 用例通过、1 跳过。原始输出见 [`phase0/findings.md`](phase0/findings.md) §3b。
- **残余**：有进展的读**仍是**一次提交 —— 仍 +1 版本、仍付一次 ≈0.8 s 重放（归 03 / 04），02 只消掉了空读那一半。

## 第五刀 — projection / presence 版本分域（票 03）

- **问题**：`emitChanged` 无条件 `changeVersion += 1`。一次**有进度的私有读**（Human 打开自己的未读 Thread）或一次 presence 边沿都会推走所有 waiter 的版本；带旧游标的客户端重轮询时**立即**拿到应答，于是整页刷新一次——projection 其实没变。重启后计数器归零，还会把**更小**的版本喂给旧游标。
- **修法**：两个游标域。投影域值 = 最新一条「有 scope」记录的 `sequence`（`AgentTeamLedger.projectionSequence()`，随重放重建 ⇒ 跨重启单调）；presence 域值 = 进程内 0 起 epoch，只服务没有 durable 事实的 runtime 边沿。`emitChanged(scopes?)` 对空 scope 列表直接返回；被唤醒的 waiter 各拿**自己域**的版本。Client 由「增长才更新」改为「**有差异就重新锚定**」，兜住跨域/跨重启的陈旧游标。合同见 [`../spec.md`](../spec.md) §5.4。
- **合入**：`76d0148` `perf: give each change scope its own cursor domain`（本地 master，未推；12 个路径，`.scratch/` 不入库）。收尾 gate 在最终态跑：build 绿、`npm test` **566 passed / 1 skipped（43 文件，42 passed + 1 skipped）**、typecheck 绿、lint **0 warnings**、check:docs 绿（7 文档 / 7 双语对 / 4 README 对 / 106 链接）。
- **真装配（冻结账本 11,695 条，§6 探针同源复跑；父提交 `8dabaa3`）**

| 一次**有进度**的私有读（确实落 1 条记录） | 改前 | 改后 |
| --- | --- | --- |
| 版本推进 | +1 | **0** |
| 10 个 stale 客户端立即拿到应答 | 10/10 | **0/10** |
| 第二次读的 phantom refresh | 10 | **0** |
| 25 s 超时返回的版本 vs 客户端游标 | 27 vs 26（**更大**，Client 误刷新） | **11694 == 11694**（不动） |
| 三类 waiter（全局 / thread / presence） | 都不醒（正确） | 都不醒（正确） |
| 私有读是否仍然落盘 | `[true,true,true]`（seq 11696–11698） | `[true,true,true]`（seq 11696–11698） |

- **重启单调性**：改后 boot 的域值 = 11694 = 最新一条有 scope 的记录（既不是 0 也不是记录条数 11,695），因此旧游标不会被喂回更小的版本；包内新增三段 boot 用例锁定「重启后的游标等于最新共享投影记录」且「重启不会应答已 park 的客户端」。
- **启动成本（回应 Vera 的复查点）**：`apply()` 现在每条重放记录多一次 `changeScopesOf`。直接量：对 11,695 条真实记录整趟派生的墙钟 **1.0–3.3 ms**（5 次，其中 4,526 条会推进投影域）；同探针 boot 三连 1811/1432/1345 ms，父提交 `8dabaa3` 1764/2012/1464 ms —— 落在同一噪声档，没有把 01 的启动收益吃回去。
- **验收（Vera）**：待复验（她已用父提交 `8dabaa3` 建好独立对抗探针：10/10 立即应答、中位 0.1 ms、四个 scope 的 parked waiter 都不醒、重启 27→24）。
- **残余**：有进度的读**仍然是一整条 ~4 KB 记录**、仍付一次延后全量重放（归 04 瘦记录）；presence epoch 跨重启归零，靠 Client 重新锚定兜底。

## 第六刀 — 瘦 `team/thread-read` 记录（票 04 / B2）

- **问题**：每次有进展的读都往账本里压一整段 thread 快照（`task`/`thread`/`claims`/`anchor`/`anchorMentions`/`facts`/`attention`/`remainingUnreadCount`，mean ≈5 KB）。7,079 条读占账本 **77% 体积**，而且记录级校验要为每条读重放一遍这块快照——这是校验超线性的燃料。
- **修法**：新写入的读只存 **6 键 receipt** `{ workspaceId, memberId, threadRef, taskRef?, readThroughSequence, inbox }`。`attention` 与 `remainingUnreadCount` 都是投影派生报告字段，不再落盘（逐条独立派生要克隆投影再数未读，正好顶掉收益；`applyTo` 的读分支只吃 `inbox`，已核实无 durable 消费者）。重试已落盘的读返回**原 receipt + 当前投影现算的画面**（冻结画面不承诺，见 [`../spec.md`](../spec.md) §5.2）。旧胖记录保留为 `AgentTeamThreadReadSnapshot`：只读 normalize + 校验，**永不重写**，domain version 保持 1；一个 strict zod union 同时接受两形（`DomainFacility.open()` 逐条 parse，agent_team 没有 `invalidRecords: 'backup-and-skip'`）。
- **合入**：`06569e6` `perf: slim durable Thread read records to a receipt`（本地 master，未推；13 个路径，`.scratch/` 不入库）。
- **真装配 + 真 sqlite，反事实账本 = Vera 的 `materials/phase0/slim-ledger.py`（`--audit` 零违规），11,695 条 / 7,079 条读**

| 指标 | 全胖原件 | 全瘦（post-04 形状） |
| --- | ---: | ---: |
| 账本字节（UTF-8） | 46,166,788 | **16,610,852（−64.0%）** |
| 读记录 mean | 5,069 B | **894 B（−82.4%）** |
| 单次 `validate`（4 次中位） | 796.9 ms | **466.7 ms（−41.4%）** |
| 同上：每翻倍 | 2.56×（指数 1.36） | **2.31×（指数 1.21）** |
| 同上：读记录自己的规则校验 | 567.4 ms（占 71%） | **260.2 ms（占 56%，−54%）** |
| boot（invariant on，3 次中位，`fullReplays` 恒 1） | 1,917.2 ms | **1,190.1 ms（−37.9%）**，重放 843.0 → **512.0 ms** |
| 147k ops 外推（末点 ×147,000） | 10.0 s | **5.9 s** |

- **④ 的证明（冻结件上追加一条真读，走真写路径）**：committed、**恰好 6 键**、**1,155 B**、账本 +1,155 B；追加后整趟重放 964.3 → 813.6 ms（噪声内持平），再冷启动 1,445.4 ms / 1 次重放 / 11,696 条 ⇒ **持平是过关，不是收益**。
- **⑥ 与 04 无关，别混**：web 账本 12,042 条里 `team/thread-read` **0 条**；762.9 → 108.5 ms、1 → 0 次重放记 **票 02**。票面 ⑥ 保持未勾。
- **残余（归 05）**：**两条曲线的超线性都还在** —— `thread-replied` 每记录 0.0139 → 0.0482 ms。04 只把燃料变细，没把曲线做直。
- 收尾 gate 在最终态跑：build 绿、`npm test` **573 passed / 1 skipped（43 文件）**、typecheck 绿、lint **0 warnings 0 errors**、check:docs 绿（7 文档 / 7 双语对 / 4 README 对 / 106 链接）。原始输出见 [`phase0/findings.md`](phase0/findings.md) §3c。

## 第七刀 — 读一次不再克隆整份 marker 投影（票 05 第一片）

- **问题**：`prepareReadFrom` 为算 `remainingUnreadCount`，先把 `attention`、`directMarkers`、`activityMarkers` 三份 map 加 `attentionByThread` / `attentionThreadsByMember` / `directMarkersByMember` / `activityMarkersByMember` 四个派生索引**整份克隆**成「假设投影」，`applyInboxDelta` 之后再数还剩多少未读。marker 总量随账本线性（每条被 mention 的消息至少一个）⇒ **每次读都付 O(全部 marker) 的分配**。这就是票面第一句「一次读不再复制整个全局 marker projection」。
- **修法**：删掉克隆，新增 `remainingUnreadAfter(projection, memberId, receipt)` —— post-delta 状态直接用 receipt **自己派生出来的输入**：它要写的那一行 `attention`、以及 `receipt.inbox` 的 marker removals/additions；只遍历该 Thread 的 fact 列表与该 reader 在该 Thread 的 marker 桶。另抽 `isUnreadFact(...)` 作为「这条 fact 对这个读者是否未读」的唯一权威，画面派生与计数派生共用，杜绝两处判定漂移。`firstRead` 的背景快照也从全局 `messages.filter` 改走 `factsByThread`。顺手订正 Vera 报的 `AgentTeamThreadReadSnapshot.task` 过期注释。
- **合入**：`956011a` `perf: count remaining unread without cloning the marker projection`（本地 master，未推；3 个路径，`.scratch/` 不入库）。
- **等价性（这一片的核心判据）**：**由构造保证**，不是靠抽样对比——读的 delta 只碰「该 reader 在该 Thread 的 attention 行与 marker」，而 `isUnreadFact` 的每次查表都限定在同一 (member, Thread) 对；`receipt.attention` 正是 `applyInboxDelta` 之后那一行的值，`receipt.inbox` 的 removals 正是它要删的键。
- **新增语义臂**（两个 Thread × 两个 Member 交错）：reader 读 Thread A 后 `remainingUnreadCount === 0`；**Thread B 的读仍是 committed**（没吃掉别处的 marker）；**旁观者读 Thread A 仍是 committed 且 marker 还在**（没吃掉别人的 marker）。
- **变异自证（sha256 前后逐字节还原）**：① 用 pre-delta 水位 `attentionBefore` 代替 post-delta → **4 条红**；② 不应用 marker removals → **1 条红**；③ marker 键集改取全局 → **81 条全绿 = 等价变异体**（`directMarkerKey` 内嵌 member+thread，键集扩大不改变判定）；性能上仍必须读桶。
- **门禁**：build 绿、`npm test` **574 passed / 1 skipped（43 文件）**、typecheck 绿、lint **0 warnings 0 errors**。
- **没做/未量**：**绝对量（单次读墙钟与分配的前后对照）留给 Vera**——她的方法是父提交基线，我这边没有；本片只声称「O(全部 marker) → O(该 Thread fact 数)」的结构变化 + 语义等价。**第二片（`validateInboxDelta` 的整份数组复制与 `.find`，即 per-kind 表里 `thread-replied` 没动的那一半）待做**，Vera 预登记的 (b)/(c) 两条索引臂针对那一篇。

## 第八刀 — 校验路径的 marker 引用改走 replay-derived Message 索引（票 05 第二片）

- **问题**：`validateInboxDelta` 在**每条** inbox 携带记录的校验里都无条件 `[...projection.messages]`、`[...projection.orderedFacts.filter(kind === 'activity')]`、`new Set([...projection.threads.keys()])`，再对每个 marker 在整份数组上 `.find` ⇒ 单条消息记录的校验成本 = 整个账本。这是 04 之后 `thread-replied` 每记录 0.0139 → 0.0482 ms 的那一半（Vera 的 per-kind 表）。
- **修法**：`Projection.messages` 数组**删除**（它唯一的读者就是这里的那次复制），换成 `messagesByRef: Map<ref, Message>` 引用索引，与 `factsByThread` 在 `appendMessageFact` 的**同一次 append** 里维护 ⇒ live 投影与校验用的 scratch 投影天然一致；`knownThreadRefs` 改成员判定（`threads.has` + `additionalThreadRefs.includes`）；两处 direct marker 校验改索引命中，保留旧的「投影优先、再加入本记录」优先级。
- **活动 marker 不建索引（偏离第一版计划，有证据）**：先按计划加了 `activitiesByRef` 并按「投影优先」查；变异臂 M3「删掉索引写入」**82 条全绿**。四处产生活动 marker 的 builder（`closeThreadInboxFrom` / `acceptThreadInbox` / `reopenThreadInboxFrom` / `promoteThreadInboxFrom`）都用**本操作自带 activity** 的 ref+sequence，removal 分支不查 activity，实体 ref 全局唯一（`addRef` 拒重）⇒ 投影侧那份索引没有可判读者，是死状态，已连同写入删除；`orderedFacts.filter(activity)` 的全量复制照样消失。
- **合入**：`e38c6be` `perf: resolve inbox marker references through a replay-derived Message index`（本地 master，未推；2 个路径，`.scratch/` 不入库）。
- **变异自证（sha256 `cd16db59…` 前后逐字节还原）**：(b) 索引只挂 live 投影 → **7 红**（读消费 earlier marker 的用例全炸）；(c) 索引挂错分量（当前 ref → 上一条 Message）→ **3 红**；活动解析失效 → **7 红**；删 `activity === undefined` 守卫 → **82 全绿 = 不可判**（该分支在所有携带活动 marker 的记录上都排在「记录 inbox 与现推 expected 逐字比对」之后，单条伪造不可达；改前亦然，非本片缺口）；给消息解析加「全账本 Message 集」兜底 → **只有新增臂红**（判别力证明）。
- **新增包内臂**：marker 指向**后一条 record** 里的真 Message（同 Thread、sequence 对齐）必须被拒 —— 扫全账本 Message 集会接受、按 replay 状态必须拒。
- **门禁**：build 绿、`npm test` **575 passed / 1 skipped（43 文件）**、typecheck 绿、lint **0 warnings 0 errors**（134 文件 84 规则）、check:docs 绿。
- **没做/未量**：per-kind 前后绝对量（`thread-replied` 是否终于下降、`thread-read` 是否回涨）归 Vera 的父提交基线尺子；票 05 的第二半（一批 drain 读合并进同一回合）**仍不动**——它改读的 durable 语义与 Client retry 合同（02/04 刚定完），需要 Vera + Human/Reeve 先拍口径，并按票面重测 20 / 100 / 400 条未读的用户可见墙钟。

## 第九刀 — Thread 页的行渲染与 draft 订阅解耦（票 06 切片 A）

- **问题**：`TeamThreadPage` / `TeamChannelPage` 在**页面级** `useSyncExternalStore(drafts.subscribe, () => drafts.getSnapshot(draftKey))`，于是每次敲键盘整页重渲染；`TeamMessage` 没有 `memo`，而 `renderFact` 每次渲染都新建 props（`mentionNamesOf(...)` 新数组、`openRef` 新函数、`hostTaskRefLookup(...)` 新函数）⇒ 一次输入 = 每条消息各渲染一次（10 条 → 10 次、30 条 → 30 次，与消息数 1:1，整页 29–55 次）。
- **修法**：draft 订阅下沉进 `TeamComposer`（props `{recipients, draft, onDraftChange, onRecipientsChange}` → `{drafts, draftKey, onEdit?}`，写入归 composer，页面只在 send 时 `drafts.getSnapshot(draftKey)` 读一次）；两个页面删除页面级订阅，`onEdit` 用 `useCallback` + bail-out setter（`setX(current => current === undefined ? current : undefined)`）清 confirmation/requestId/statusMessage；`TeamMessage` 改 `export const TeamMessage = memo(function TeamMessage(...))`，并把这行拿到的三个每次新建的 prop 稳定化：`openRef` → `useCallback`、`lookupTaskRefs` → `useMemo`、`mentionNames` → 模块级 `WeakMap` 按 content 比较的 `stableMentionNames`。
- **隐藏依赖（重要）**：只包 `memo` 不够。变更事件会重取 members ⇒ `members` 换新数组 ⇒ `mentionHandlesMap`（`useMemo([members])`）换 identity ⇒ 若 mention 名缓存以 handles Map 的 identity 为 key，则每行的 `mentionNames` 都是新数组、`memo` 全部失效（实测变更档仍 20/60）。`PROP_DIFF` 插桩确认「突发中唯一变化的 prop 就是 `mentionNames`」；改成按解析出的名字**内容**比较后，突发档 props 零变化。即：`memo` 的收益取决于调用方 prop 的稳定性，缓存 key 必须落在内容而不是容器 identity 上。
- **合入**：原 `7cccf90` `perf: keep Thread timeline rows out of composer and roster re-renders`（5 个路径：4 个 src + 新探针 `.spec.tsx`）。**收口时与 01–05 一起 squash 成单 commit `805273b`** `perf: cut ledger replay, read, and Thread render costs`（本地 master，未推；`.scratch/` 不入库，旧分片 sha 只在 reflog）。
- **前后绝对量（同一探针同一会话，行渲染 = React 实际渲染的行数）**：一次输入 10/30 → **0/0**；一次变更 20/60 → **0/0**；一次 committed 到达 → **1/1**（只有新消息自己那一行）；变更档 `readThread` 前后都是 0；draft/焦点/首尾消息都保持，commit 后 draft 被消费为空。
- **探针口径的坑（写进探针注释了）**：`vi.mock` 包真实现的包装器**必须自己也 memo()**，否则计数的是「页面请求渲染的行数」——`memo` 生效后仍会虚报 count。另：找不到 task footer 时要取 `findAllByRole('button', { name: '打开 Task #1' })[0]`（每条 top-level 消息各有一个同 label 的 footer）。
- **门禁**：build 绿、`npm test` **577 passed / 1 skipped（43 文件）**、typecheck 绿、lint **0 warnings 0 errors**（135 文件 84 规则）。

## 第十刀 — 一次变更事件的 roster 扇出去重（票 06 切片 B）

- **问题**：`refreshSupplemental()`（members + view）被 `workspace` 与 `presence` 两个 scope 订阅各调一次，一次 Host 变更事件 → 本页 roster 读 2 轮（全运行时 `members 5 / view 3`，差额来自侧栏面板，不在本页）。
- **修法**：按 **change version** 去重（`TeamChangeUpdate` 自带 `version`）：两个 scope 的 poll 对同一次变更送达**同一个 version**，已被某轮覆盖的 version 直接不再取数；轮次进行中到来的**更新** version 记入 pending，本轮结束后跑一轮补齐（不丢失效），并用 `supplementalRef` 只保留一轮在飞（避免旧轮覆盖新轮）。挂载时重置三个 ref，避免上一挂载的轮次答新挂载。
- **判别力（同一探针，把 `TeamThreadPage.tsx` 逐字节还原到切片 A 再跑）**：before `pageRounds 2`（断言 `pageRounds <= 1` **红**）→ after **1**（绿）。`pageRounds` = 带 `threadRef` 的 `loadChannels` 次数，即**可归因到本页**的轮数；全运行时计数受侧栏面板污染，不能当作本页判据。
- **合入**：原 `8c7cf6a`，已并入上面那个单 commit `805273b`。
- **同族的已知残留（不在本票范围，供后续决策）**：`TeamChannelPage` 的 `workspace`/`presence` 两个订阅各调一次 `refreshMembers()`（仅 members），同一 version 去重同样适用但未改——避免把两个界面的验收混在一个 commit 里。
- **门禁**：build 绿、`npm test` **577 passed / 1 skipped（43 文件）**、typecheck 绿、lint **0 warnings 0 errors**（135 文件 84 规则）；`npm run test:browser` 见 [`../issues/06-client-render-isolation.md`](../issues/06-client-render-isolation.md)。

## 账本体量（Vera 只读副本，约 23 天）

- 11,663–11,695 条 / ~37.9 MB。
- `team/thread-read` ≈ 7,063 条，77% 体积，平均 ~4 KB，~304 条/天。
- 真正的团队活动 ≈ 23% ≈ 0.37 MB/天。
- 启动重放（修 A 后，挂校验）仍 ~2.5 s。线性外推：10 万条量级秒级启动。

## 代码事实（B 拆解时核对，2026-09-13）

- `readThread` 无早退：一律 `table.put` 一整条 `team/thread-read`。
- `apply` 只吃 inbox delta + observations；水位原地踏步时 observation 跳过。
- `facts` / `claims` / `anchor` 不进投影，只服务同 `requestId` 重放和 `isDeepStrictEqual` 校验。
- Client 打开 thread 并行 `readThread` + history + observations；未读用新 requestId 连抽；thread 开着时 change-wake 再 ack。已读完再点开仍写 ~4 KB。
