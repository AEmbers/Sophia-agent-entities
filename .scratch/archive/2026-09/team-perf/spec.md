# Team 性能整体优化决策快照

## Status

**状态：** 调研收敛，未实施。

**last-checked：** 2026-09-13。

本文件记录 dsh-agent-team 从启动、账本写入、Host 读路径、Client 渲染到 Agent 运行时的整体性能判断。它是实施前的决策快照，不替代 `packages/` 源码、测试和 Harness 合同；发生冲突时以代码和测试为准。

## 1. 结论

当前性能问题不是一个 Thread 页面或一个 Remote 方法的问题，而是三类成本叠加：

```text
账本增长       每次阅读都追加胖的 team/thread-read 记录
全量重复计算   启动、提交校验、通知和 Session 事件反复扫描已有数据
客户端重复工作 多次 Remote、整页 React 重渲染、无界时间线和重复 roster 读取
```

推荐的长期方向是：

1. 保留 `AgentTeamLedger` 作为唯一 Team durable authority。
2. 先用低风险优化降低当前热路径：启动去掉重复全量验证、修正变化版本语义、补齐 Host 反向索引、把 Agent Session fold 改成增量、把 Client 的局部状态和时间线渲染隔离开。
3. 实施 B1：已读且没有水位变化时不追加 `team/thread-read`，但先解决 no-op read 的 receipt 和幂等语义，不能伪造一个不存在的 durable operation。
4. 实施 B2：把 `team/thread-read` 从“读取时的完整画面快照”改成“读取确认和 Inbox delta 记录”。Thread、Task、Claim、anchor 和 facts 从已验证的内存 projection 现算。
5. B3 的 snapshot + truncate 只在 B2 后仍无法满足规模目标时考虑，并且必须先建立“截断后独立 replay 仍能发现篡改”的验证网。
6. 不采用现在就拆成异步第二个 durable read model 的方案。它会引入第二个 authority、恢复时序和一致性问题，当前收益不值得这项复杂度。

这意味着：Remote 形状、Inbox/mention 语义、Workspace -> Channel -> Thread 导航和现有 ledger 权威边界暂时不改。可以增加聚合读取 Remote，但必须先用测量证明多次往返是主要成本。

## 2. 已有证据

### 2.1 冻结账本

Vera 的冻结件为 11,695 条 operation，value 合计 38,063,589 B，221 个 Thread，主 Channel 有 1,625 条 Message。

当前冻结件的 SQLite 查询结果：

| 项目 | 数值 |
| --- | ---: |
| 总 operation 数 | 11,695 |
| `team/thread-read` 数 | 7,079 |
| `team/thread-read` value 字节 | 29,338,293 B |
| `team/thread-read` 平均大小 | 4,144 B |
| `team/thread-read` 占总 value | 77.0% |
| 最大 Thread 的 read 记录数 | 464 |

早期材料中的 7,063 条是较早时间点的近似值；本快照以冻结件的精确查询为准，比例结论不变。

### 2.2 已合入的两刀

本节是本快照写就时的状态（只留这两刀）；此后 01–04 的落地与数字见 [`materials/done.md`](materials/done.md)，§2 不逐票追加。

第一刀 `5b734ef` 为 view、Inbox、Attention 增加 replay-derived indexes。大账本上的结果包括：

- `inbox(directOnly,1)`：4.79 ms -> 1.02 ms。
- `view(limit:1)`：0.254 ms -> 0.123 ms。
- `threadObservations`：0.121 ms -> 0.001 ms。
- Channel 切换明显改善，但进入 Thread 仍然慢。

第二刀 `2b8b62b` 把 invariant 的全量记录级 replay 从 commit 调用内延后到 `setImmediate`，并合并同一 check phase 的突发提交：

| 指标 | 修复前 | 修复后 |
| --- | ---: | ---: |
| 真装配 `readThread`，invariant on | 约 813-866 ms | 5-8 ms |
| 真装配 `readThread`，invariant off | 约 6-8 ms | 约 7-12 ms |
| `emit` 调用内 | 587-622 ms | 约 0.1 ms |
| 单次全量 `validate()` | 不适用 | 约 0.76-0.84 s |
| 启动，含同步全量 replay | 约 2.4 s | 约 2.4 s |

结论不是“校验变快了”，而是“校验不再阻塞本次 Remote 返回”。全量 replay 仍在同一个 Host event loop 上运行；账本继续增长时，它仍会阻塞后续 read、write、通知和 Session 事件。

### 2.3 当前验证状态

本轮只读审计使用了冻结件查询、源码检查和现有测试。目标测试已通过：

```text
npm test -- --run packages/agent-team/tests/projection-indexes.spec.ts packages/client-agent-team/tests/team-message.client.spec.tsx
PASS: 2 passed
```

尚未有以下正式证据：浏览器级打开时延、超过 20 条未读时的 drain 时延、启动各 replay pass 的独立计时、长 Session 的 event fold 曲线。因此下文把这些项目列为 Phase 0 验证，不把静态推断写成运行时数字。

## 3. 当前成本地图

### 3.1 启动

`AgentTeamLedger` 构造时立即执行 `replay()`。当前代码结构包含：

1. `sortedRecords()` 对整个 storage table 做 entries 复制、排序、legacy normalize，并在 scratch projection 上 apply。
2. `validateRecords()` 再用独立 scratch projection 顺序校验并 apply。
3. `replay()` 把 records 再 apply 到 live projection。
4. invariant 插件挂载时又调用一次 `validate()`，再次完整读取、normalize、独立 replay。
5. 通过验证后还要做 Session remediation、一次 persisted-session listing，以及每个 enabled Member 的 activation。

因此启动同时付出完整账本的多次遍历和一次重复的全量验证。11.7k operations 目前约 2.4 s；100k operations 时不能继续接受线性增长而不设边界。

**第一项启动优化：**复用同一次启动 replay 已经得到的验证结论，避免 invariant mount 再做一份完全相同的全量验证。这个优化必须保留启动 fail-closed 行为，不能简单删除 invariant 或把校验改成 live projection 对比。

### 3.2 Durable commit 热路径

所有 ledger commit 进入一个 `operationTail`。这是单 Host writer 的正确性约束，但它把以下工作串在同一条尾部：

- SQLite `table.put`。
- `apply` 更新 live projection。
- `emitCommitted` 的 changes、Inbox 通知和 progress-nudge 处理。
- deferred invariant 的下一轮全量 replay。

`readThread` 也会 commit。一旦页面有未读积压，Client 的 `drainUnread` 每轮生成一个新的 requestId，串行执行一次 read、一次 put 和一次后续全量 replay。现有单次 read benchmark 没覆盖这条放大路径。

`emitCommitted` 还会按受影响 Member 计算通知。通知计算会进入 `notificationFacts -> inbox -> unreadFor`，对候选 Thread 的 facts 再做扫描。这个工作应当限制为真正受影响的 Member，并在同一事件循环批次内合并。

### 3.3 Host 读路径

已做好的索引解决了第一轮 Channel/Inbox 慢，但仍有这些增长项：

- `view()` 的 `limit` 只限制返回的 `items`。Channels、memberships、Tasks、Threads、Task numbers 和 visible Claims 仍可能是整个 Workspace 的集合。
- `view(threadRef)` 的 items 扫描可以提前结束，但 catalog 组装仍按 Workspace 规模增长。
- `threadHistory()` 对一个 Thread 的 facts 做 filter 后再取窗口，没有按 sequence 使用二分或游标。
- `prepareReadFrom()` 为了试算 read 后的 Inbox 状态，会复制 attention、direct markers、activity markers 以及其反向 bucket；当前复制范围与本次 read 涉及的 Member/Thread 无关。
- `unreadForFrom()` 从 Thread facts 头部扫描；同一次 read 既要计算 unread，又要在 hypothetical projection 上计算剩余 unread。
- `claimsForTaskFrom()`、`hasActiveClaimFrom()`、`claimsForVisibleTasks()` 和多个 Task 状态派生方法仍会扫全量 Claims。
- Channel/member archival、close/reopen、promotion 等 Inbox delta 辅助函数仍有全量 attention/marker 扫描。
- 非完整 ref 的 abbreviation lookup 会遍历对应 ref map。它不是当前主要成本，但大规模时应使用由 prefix 到候选的索引。

### 3.4 Changes 版本语义

`emitChanged([])` 和 presence-only change 当前都会递增同一个 `changeVersion`，但不会唤醒普通 projection waiter。普通 waiter 之后到 25 秒超时，会收到一个更大的 version；Client 可能把它误认为有需要刷新的 projection change。

这会造成：

```text
无共享 projection 变化
  -> version 仍然增加
  -> long-poll 超时返回更大的 version
  -> Client 触发 history / members / follower refresh
```

这是代码级可复现的风险，需用一个无写入的长轮询测试锁定。长期应拆成按 scope 的版本，或至少区分：

- durable projection version：workspace/channel/thread/global projection waiter 使用；
- presence version：presence waiter 使用；
- read-only / audit-only commit：不增加普通 projection version。

**已定（2026-09-13，票 03 落地；合同见 §5.4）：**投影域取「最新一条有 scope 记录的 `sequence`」（durable、跨重启单调），presence 域取进程内边沿 epoch；空 scope 提交两域都不动。冻结账本实测一次私有读的版本推进 1 → **0**、立即应答 10/10 → **0/10**。

### 3.5 Client 网络和渲染

Thread 首次 mount 的实际路径是：

```text
选择 Thread
  ├─ 并行 readThread + threadHistory + threadObservations       3 次 Remote
  ├─ 并行 members + view(threadRef, limit:1)                    2 次 Remote
  ├─ 建立 thread/workspace/presence 三个共享 long-poll
  └─ 有未读时，串行 drainUnread，每轮再做一次 readThread
```

因此首屏至少有 5 个业务 Remote 和 3 个 long-poll probe。`refreshSupplemental()` 没有挡住首个 timeline paint，但它会和首屏其它工作争抢 Host event loop。

主要 Client 热点：

- `TeamChannelPage` 和 `TeamThreadPage` 在页面级订阅 draft。每次打字会让页面和已渲染 Message 全部重新 render。
- `TeamMessage` 没有 `React.memo`；每次父页面 render 都重新执行 `planMessageBody`。
- 每个 Message 都订阅全局 Task-ref resolution version。一次 ref resolution 落地会唤醒所有 Message。
- Markdown 结果落地后，layout effect 会对 DOM 做 TreeWalker、querySelectorAll 和节点替换；在页面重复 render 时成本会再次出现。
- Thread facts 和 Channel view 没有稳定的窗口化上限。Thread passive refresh 取 `limit:100` 后 merge 到已有 facts，长期打开的页面会持续扩大 render 集合。
- 时间线每次 content key 改变都会读取 `scrollHeight` 并可能写 `scrollTop`，大量消息变化时容易触发同步 layout。
- Members 读取没有在 Team root 共享缓存。一个 workspace change 或 presence change 可能同时触发 sidebar、Channel、Thread 多处 `members()`。
- Inbox 页面和 sidebar badge 分别订阅 scope-less changes；读操作还会通过 `reads.bump()` 触发 badge refresh，可能形成重复的 Workspace Inbox 请求。
- attachment data URL 是进程内无上限 Map。长时间浏览大量图片会持续占用浏览器内存。

客户端的改造目标不是把 Host projection 搬到浏览器，而是把同一份 Host projection 读取结果在一个 Client cache 内复用，并把局部输入、局部 Message 和可见时间线窗口隔离开。

### 3.6 Agent runtime 和 Session

Agent 运行时的增长项与 Human Thread 首屏分开，但会竞争同一个 Host event loop：

- `context-management` 在成功 `tool/result`、`turn/end` 和 activation 路径调用 `foldContextProjection(ownEvents())`，长 Session 会把一次事件处理变成 O(Session events)；连续 tool/result 会形成 O(N²) 的重复折叠。
- `pressure-policy.noticeDelivered()` 在每个 pre-step 遍历整个 `ownEvents()`，只为判断一条 pressure notice 是否出现过。
- `progress-nudge.onCommitted()` 会 reconcile 所有正在跟踪的 Member；`progressNudgeTargets()` 又会进入 Claims 和 Attention 派生扫描。
- `memberForAgent()` 在部分 Host 路径上遍历所有 handles。已有 `sessionId -> memberId` 反向映射，但还没有覆盖 exact Agent -> Member 的所有 lookup。
- lifecycle 统一串行化是正确性要求，但 `suspend/resume/rollover` 的长等待会让后续 Member lifecycle 请求 head-of-line blocking。

推荐的优化是 process-local incremental state，不增加第二份 durable Team authority：

```text
(sessionId, lastEventSeq, foldedState)
  + new Session events
  -> apply one event
  -> new foldedState
```

如果 Harness public Session projection 能提供同样的 factory scope 和 inherited-event 语义，优先复用它；否则在 Team coordinator 内保留这个私有增量 seam，并为 seed、parentSession、inheritedEventCount 和 restart 重建写等价测试。

## 4. 架构方案比较

### 4.1 方案 A：永久 ledger + 更强的内存 projection

**内容：**保留现有 operations 表和 full replay，继续增加反向索引、缓存、Client 局部渲染优化。

**收益：**迁移风险最低；不改变 durable record；适合立即降低 view、Inbox、Claims、Agent event 和 UI 的局部成本。

**限制：**账本仍然永久增长。每次 invariant full replay 和启动读取仍是 O(operations)，无法从根上解决 100k/1M 规模。

**定位：**必须做，但只能作为 Phase 1 的落地层，不是最终规模方案。

### 4.2 方案 B：ledger + slim read records + 可选 checkpoint

**内容：**

```text
Team ledger：唯一 durable authority
  ├─ collaboration facts：Message / Task / Claim / Attention / Activity
  └─ read receipt：Member + Thread + readThroughSequence + Inbox delta

Host memory：由 ledger replay 构造
  ├─ public projection
  ├─ per-thread fact index
  ├─ per-task Claim index
  └─ per-member Inbox/Attention indexes
```

`team/thread-read` 不再保存 Thread、Task、Claims、anchor 和 facts 的完整快照。读取结果由当前已验证 projection 派生；记录级 invariant 仍从前序 scratch projection 独立推导 read receipt 和 Inbox delta，再比较 durable record。

**收益：**

- 直接压低 77% 的账本主要体积。
- 降低每次 startup 和 deferred invariant replay 的 JSON 读取、normalize、深比较和 object allocation。
- 让 read 的 durable 语义从“冻结一次画面”回到“确认一个 reader watermark”。
- 与 ledger 单一权威和现有 view Remote 兼容。

**代价和风险：**

- 需要明确 repeated requestId 的返回语义。当前代码对同 requestId 返回保存的完整快照；瘦记录无法无成本复现所有当时的 unread/facts 画面。
- 需要明确 no-op read 的 receipt 语义。没有 durable operation 时不能返回一个看起来像已提交 operation 的假 receipt。
- 旧胖记录需要继续 normalize 和独立验证，但不需要回写；新旧记录的 validator 分支必须有红能力。
- 记录内容变瘦后，若 invariant 只拿当前 live projection 比较，就会违反现有独立校验约束；校验必须使用自己的前序 scratch projection。

**定位：**推荐的长期主线。B2 是当前最值得做的结构调整，B3 不应与 B2 同时推进。

### 4.3 方案 C：事件写入 + 独立异步 durable read model

**内容：**operation log 负责写入，另一个持久化 read model 负责 UI、Inbox 和查询；读取不再等待 ledger projection。

**收益：**理论上最容易把 UI 读扩展到大数据量，并可把索引放进更合适的 SQLite 表。

**代价和风险：**

- 引入第二个 durable authority，违反当前 Team authority 约束的默认方向。
- 写入成功、read model 更新失败、进程崩溃和重新构建之间会出现可见的 stale projection。
- Inbox/mention/Attention 的一致性和 restart recovery 要重新定义。
- 当前单 Host、单 ledger 的规模还没有证明必须付这项复杂度。

**定位：**本轮不采用。只有当 B2、反向索引、checkpoint 和 Client 窗口化仍达不到明确规模目标，且能定义完整 replay/rebuild 合同时才重新评估。

## 5. 必须先定下的接口语义

### 5.1 B1 no-op read

已锁定的业务判断是：Inbox delta 为空且 read watermark 没有变化时，不追加 `team/thread-read`。

**已定合同（2026-09-13 实施依据，承载票 02）：**

- **判据**：一次读算出来的 Inbox delta 为空 ⟺ `attention.set` 为空（水位没推进，或本来没有 Attention）**且** `directMarkers.removed` 为空 **且** `activityMarkers.removed` 为空。三个分量都出自 `prepareReadFrom` 的同一次计算，结构性成立。不得替换成「unreadFacts 为空」——那会漏掉 marker 与水位。空 delta 的读对 projection 是恒等变换（`recordAttentionObservations` 对空 delta 直接返回，`applyInboxDelta` 无写入）。
- **落盘与否的表达**：`AgentTeamLedgerResult.committed` 表达这次读有没有写 durable operation，读路径返回 `AgentTeamThreadReadOutcome`（`committed: true` 的那一支类型上必须带 receipt）；`AgentTeamThreadReadResult.receipt` 改为可选。**不给没有 durable operation 的读伪造 receipt**，也不新增 durable idempotency 表。
- **画面派生**：两条分支共用同一套派生（thread/claims/anchor/anchorMentions/facts/readThroughSequence/remainingUnreadCount/attention/consumedDirectMarkers），空读不得吞掉 `attention`；`contextAdvice` 只在确认了未读 accept 的那次读上出现，而那种读必然有 delta，因此空读不可能带 advice。
- **幂等**：已落盘的 requestId 重试返回**原 receipt**（`operationId`/`sequence` 取自那条 durable 记录，`committed: false`）**+ 由当前 projection 现算的画面**；重试一次「本就没落盘」的读同样按当前 projection 现算、不给 receipt。读**不**承诺冻画面（§5.2），所以瘦记录里不存任何画面字段。
- **Client**：`drainUnread` 继续靠 `remainingUnreadCount` 下降停止，不依赖 receipt/sequence；空读不产生 changes 事件、不触发批后重放。
- **模型可见文案**：`team_thread read` 在未确认任何未读时渲染 `Read — no unread updates …`，不再声称 committed。

### 5.2 B2 repeated requestId（已定合同，承载票 04）

两种语义已区分并落地：

- **mutation request**：同 requestId 必须返回同一 durable operation 结果；
- **read request**：同 requestId 只保证不会重复推进 watermark；**receipt 是 durable 事实（原样返回），画面按当前 projection 现算**，不保证冻结旧画面。

这条是 04 能瘦下来的前提：画面不进 durable 记录，就不必为「重试要给回同一份画面」保留可重建画面的数据。已在类型说明、`team_thread read` 的渲染文案与 ledger 测试中写明。

### 5.3 invariant 的边界

以下约束不变：

- invariant 仍是记录级独立 replay，不拿 live projection 当 expected value；
- 删除一条已存 read receipt 的 delta 或水位字段，验证必须能红；
- 启动仍 fail-closed；
- full replay 可以延后或从已证明的 checkpoint 继续，但不能变成“只校验最后一条”。

### 5.4 changes 游标域（已定合同，承载票 03）

`changes({afterVersion, scope})` 的 `afterVersion` 是**游标，不是全局时间戳**；它只在签发它的那个 scope 的「域」里有意义。两个域：

- **投影域**（scope 为 undefined / workspace / channel / thread）：域值 = `AgentTeamLedger.projectionSequence()`，即**最新一条 `changeScopesOf` 非空（或 undefined）的记录的 `sequence`**。它是 durable 账本位置：随启动重放重建，因此跨重启单调；只在「有人可能需要重新取数」的提交上移动。
- **presence 域**（`scope.kind === 'presence'`）：域值 = 进程内边沿 epoch，从 0 起、每次 presence 边沿 +1。runtime 状态（running/idle/error）背后没有 durable 事实，所以这里**刻意**不引入 durable 权威；代价是 epoch 在重启后归零，只在单次服务生命期内可比。

规则：

1. **空 scope 提交不动任何域**：`changeScopesOf` 返回 `[]` 的提交（`team/thread-read`、`team/dm-sent`、`team/channel-member-added` 等私有读/审计记录）既不推进投影域，也不唤醒任何 waiter——`emitChanged` 对空 scope 列表直接返回。
2. **每个被唤醒的 waiter 拿自己域的版本**，绝不可能拿到另一个域的数值（`changeVersionOf(waiterScope)`）；一次 presence 边沿不会让投影订阅者看到版本变化。
3. **跨域 fail-safe 由 Client 负责**：Host 端仍是「游标 ≥ 域值就 park、25 s 超时返回当前域值」；Client 的 `TeamChangeStream` 在**任何差异**（`!==`，不只是增长）上重新锚定并通知订阅者。因此一个来自另一个域或上一次服务生命期的游标会被纠正，而不是被增长比较静默吞掉。Host 不会对「游标已等于域值」的请求立即应答，所以重新锚定不会自旋。
4. 不新增第二套**投影**计数器：投影域值直接等于账本位置，没有平行权威；presence epoch 只服务规则 2 的边沿唤醒。

### 5.5 B2 瘦读记录形状（已定合同，承载票 04）

`team/thread-read` 的 `data` 是一个 strict union，两种形态都合法：

- **receipt（新写入）**：恰好 6 键 `{ workspaceId, memberId, threadRef, taskRef?, readThroughSequence, inbox }`。`attention` 与 `remainingUnreadCount` **不落盘**——两者都是投影派生报告字段，逐条独立派生 `remainingUnreadCount` 要克隆投影再数未读，正好顶掉 §7 第 ② 条要的斜率；`applyTo` 的读分支只吃 `inbox`（已核实无 durable 消费者）。
- **snapshot（legacy，只读）**：旧胖快照（`task`/`thread`/`claims`/`anchor`/`anchorMentions`/`facts`/`attention`/`remainingUnreadCount`）继续被接受、normalize 与校验，但**永不重写、不清洗**。

约束：

1. **domain version 保持 1**；不新增兼容 storage 路径、不做隐式回写。`DomainFacility.open()` 逐条 `valueSchema.parse`，agent_team 未声明 `invalidRecords: 'backup-and-skip'` ⇒ schema 必须同时接受两形，否则整个域打不开。
2. **两分支各自独立派生 expected**：receipt → `prepareReadReceiptFrom` 的廉价派生（threadContext / 授权 / attention / unread / 水位 / consumed+activity markers / inbox），报 `invalid Thread read receipt`；snapshot → 全量 `prepareReadFrom` deep-compare，报 `invalid Thread read projection`。**校验仍是记录级独立重放**，不改成「只信 live projection」或抽样。
3. **`taskRef` 从 Task 派生**：receipt 的 expected `taskRef` 必须来自 `expected.task`，不得从存储记录回抄——否则「Task Thread 的瘦记录删掉 `taskRef`」能过验。
4. **零改写可证**：启动前后逐条 diff 存储记录必须为 0。

## 6. 分阶段落地

### Phase 0：先补测量

不改产品语义，建立以下固定输入和输出：

1. **启动分解**：记录 `sortedRecords`、`validateRecords`、live apply、invariant mount、remediation、Member activation 的耗时和调用次数。
2. **read amplification**：在 0、20、100、400 条 unread facts 下测首个 read、全部 drain 的墙钟、RPC 次数、put 次数和 deferred validation 次数；invariant on/off 各跑一份。
3. **浏览器感知**：在真实 Web 中记录首个 Thread 内容可见、supplemental 完成、drain 完成、最后一次 render 的时间；同时记录 Remote 名称、请求时间和 response bytes。
4. **runtime fold**：用 1k、10k、50k Session events 测每个 tool/result 的 context projection fold、pressure notice lookup 和 progress target lookup。
5. **Client render**：大 Channel、大 Thread、30+ Members fixture 下测每次输入的 Message render 数、Task-ref resolution 引发的 render 数、members Remote 次数和重复 change refresh 次数。
6. **changes 版本**：无共享 projection 变化时跑超过一个 long-poll timeout，证明普通 projection waiter 不会收到 phantom `changed`。

Phase 0 的结果必须写回本目录的材料，后续只信大档绝对值；继续遵守现有约 ±34% 的噪声判断。

### Phase 1：低风险热路径优化

按以下顺序：

1. 解决启动重复全量验证，保留启动独立校验和 fail-closed。
2. 修正 durable projection version、presence version 和 no-op commit 的变化语义。
3. 增加 `claimsByTask`、`activeClaimsByMember`、Thread tail/sequence lookup 和必要的 marker bucket indexes。
4. 将 `prepareReadFrom` 改为受影响 Member/Thread 的 copy-on-write，禁止为一次 read 复制整个全局 marker projection。
5. 把 progress-nudge reconcile 改为受影响 Member 的合并批次；把 pressure notice 是否已送达改为增量 Session 状态。
6. 给 `context-management` 和 clock context 加 Session event cursor，替代每次事件的全量 `ownEvents()` fold。
7. Client 侧先做 draft subscription 下沉、稳定 callback、`TeamMessage` memo、纯计算 memo 和 workspace-scope read cache；再处理时间线窗口化。

Phase 1 不改变 Thread read record 的公开语义，便于单独验证收益和回归。

### Phase 2：B1 和 B2

1. 先完成 B1 no-op read 的 receipt、幂等和 Client retry 合同。
2. 新写入使用 slim `team/thread-read`。
3. 旧胖记录只读 normalize；不做隐式回写，不增加兼容 storage 路径。
4. `threadReadResult` 改为从 projection 派生，validator 对新旧记录分别做独立 expected derivation。**已落地**（票 04 `06569e6`，形状见 §5.5）。
5. 用同一冻结账本做旧记录、新记录的 replay/validate 对比，测 ledger 字节、启动时间、单次 validate 和 deferred replay。

### Phase 3：读取面和可见时间线

只有 Phase 0 证明 Remote 往返和 payload 是用户侧主要成本时，才增加一个加法式 `openThread` 聚合读取 Remote，或给 `view` 增加明确的 catalog slice 选项。

Client 时间线按以下顺序处理：

1. 保留完整事实在内存，先限制 React 可见窗口，不丢失 sequence cursor。
2. 先用 `React.memo`、稳定 props 和 `content-visibility` 降低低风险渲染成本。
3. 长 Thread 再引入按 sequence 的 windowed rendering；history prepend 必须保持 scroll anchor 和 cursor 语义。
4. attachment cache 增加上限和淘汰策略。

### Phase 4：B3 条件性评估

只有出现以下情况才启动：

- B2 后账本仍达到明确的启动或校验上限；
- Phase 1 的 indexes、incremental Session fold 和 Client windowing 已经完成；
- 已经有 checkpoint format、版本、损坏恢复和独立校验方案；
- 测试能在删除或篡改 checkpoint、尾部 operation、截断边界时稳定变红。

B3 不允许只因为当前启动有几秒就直接做不可逆截断。

## 7. 验收门槛

每个阶段都必须同时看功能和性能：

- Team ledger、Inbox、mention、Attention、Task/Claim 状态的既有测试全过。
- `MUTATION_CHECK` 保持 `clean -> threw -> clean`。
- `WIRED_DRIFT` 仍能证明 deferred invariant 会记录 divergence、后续提交会失败、恢复后会解除 latch。
- B1 已读完打开不追加 operation；有 unread 时仍能正确推进水位。
- B2 旧胖记录和新瘦记录 replay 到同一 projection；删除 read receipt 的 delta 或水位字段必须能红；新写入的键集**恰好**落在 6 键内（多带 `attention` 必须打不开）；启动前后存储记录**零改写**；legacy 胖记录 `facts[]` 砍一条仍必须红。
- Client 页面不出现超出 viewport 的内容；输入、focus、dialog/menu 和普通 DSH restoration 不回归。
- `npm run typecheck`、`npm test`、`npm run build`、`git diff --check` 按改动范围运行；影响 assembled Web 的阶段运行 `npm run test:browser`。
- 性能结论必须有冻结输入、命令、原始输出和大档绝对值，不能只引用小规模比例或单次手工体感。

## 8. 下一步

本快照之后先做 Phase 0 测量和 B1 接口合同补全，再拆实施 tickets。没有经过 no-op receipt、B2 幂等和独立校验边界确认，不直接改 `team/thread-read` schema。
