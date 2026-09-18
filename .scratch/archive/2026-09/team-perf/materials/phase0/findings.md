# Phase 0 测量：绝对量与放大路径

**本轮口径**：不改产品语义，只在真装配上补 spec §6 Phase 0 要求的固定输入 / 输出。数字都来自「真 sqlite + 真服务 + 真 invariant」的探针，命令与原始输出附后；小规模比例不单独下结论。

- 冻结输入：`artifacts/team-perf/frozen-ledger-11695ops.sqlite.gz`，sha256 `0ec12e31947c1f14400e4124ffca4e53197a52eb42af0b5ab384cbd2da77be13`（未变）。
- last-checked：2026-09-13。
- 本目录的证据状态：`①启动` ✅ / `②read 放大` ✅（含未读积压 × 大账本）/ `③浏览器感知` ✅（真 Web + 12k 账本，见 §5b）/ `④Session fold` ✅ / `⑤Client render` ✅（补了真正打开 Thread 页的一轮）/ `⑥changes 版本` ✅。
- 第二轮补充（同日晚）：② 的「未读积压 × 大账本」从外推改为实测，⑤ 补上真正打开 Thread 页的组件级数字，③ 用新搭的真 Web harness 补上。三处都另有反直觉发现：见 §3 的 same-turn/yield 对照、§5 的「打字 = 全量重渲染」、§5b 的「响应快了但用户等到正文的时间没变」。

---

## 0. 结论（先读这四条）

1. **启动的钱几乎全在「记录级全量校验」上，而不是在投影或 IO 上。** 11,695 ops 的启动里，`validateRecords` 单独占 **846–886 ms**，占账本构造的 **88 %**；实时投影 apply 只有 81 ms，排序 55 ms，域打开 0.1 ms。所以 Phase 1 第 1 条（启动去掉重复全量验证）买到的是**一次** `validate`（约 0.8 s），而不是「启动变快数倍」。
2. **校验成本随账本超线性增长**：2,923 → 5,847 → 8,771 → 11,695 条记录分别是 96.9 / 226.9 / 468.6 / 757.4 ms，每翻一倍耗时涨 2.3–2.4 倍（≈ N^1.2–1.3），每记录成本从 0.033 ms 涨到 0.065 ms。按最大点线性外推 147k ops ≈ 6.5 s/批（偏乐观，超线性会更高）。**这条比 A 的 0.8 s 更重要：B2 瘦记录不是「省点空间」，它直接决定校验斜率。**
3. **`changes` 版本是全局计数器，每次私有读都会增加它**，而 long-poll 对任何 `afterVersion` 更小的请求**立即返回**（不是等 25 s 超时）。实测：一次读之后 10/10 个客户端轮询都被立即应答（中位 0.01 ms），第二次读又制造 10 次。**读操作本身正确地不唤醒任何 waiter，但它让所有客户端的下一次轮询立刻回来** —— 这就是 spec §3.4 的 phantom refresh，已用运行时数字钉死。
4. **未读 drain 的墙钟几乎全是「每轮一次全量重放」，而且只取决于轮与轮之间有没有让出回合。** 11.7k 账本上 400 条未读：读路径本身 118 ms（20 轮 × 5.9 ms、237 KB），但每轮之间让出一个 event loop 回合后变成 **13.75 s**（20 次 × ≈0.69 s 重放）。真实客户端每轮都是一次独立 Remote 往返 → 走的就是后者。**推论：把多轮读合并进同一个回合能把 20 次重放压成 1 次**，这是与 B1/B2 正交、值得单独评估的一条。


---

## 1. 启动分解（gauge ①）

命令（隔离 clone，真 sqlite 副本）：

```bash
P0_DB=/tmp/phase0/prefix-11695.sqlite npx vitest run packages/agent-team/tests/zz-p0-boot.spec.ts
```

原始输出（1x = 冻结件的 11,695 ops）：

```text
P0_BOOT_LEDGER {"operations":11695,"domainOpenMs":0.2,"constructMs":962,
 "entriesCalls":1,"entriesMs":0.2,"sortedRecordsCalls":1,"sortedRecordsMs":54.5,
 "validateRecordsCalls":1,"validateRecordsMs":885.8,"applyToCalls":35085,"applyToMs":80.7,
 "ruleChecksMs":805.1,"heapDeltaMb":10.6}
P0_BOOT_ASSEMBLED {"invariant-off":{"bootTotalMs":1668.7,"agentTeamPluginMs":1668.7,
  "operations":11695,"domainOpenMs":0.1,"sortedRecordsCalls":1},
 "invariant-on":{"bootTotalMs":1613.9,"agentTeamPluginMs":1613.9,
  "operations":11695,"domainOpenMs":0.1,"sortedRecordsCalls":1,
  "fullValidations":0,"fullValidationMs":0}}
```

读法与限制：

| 阶段 | 实测（11,695 ops） | 说明 |
| --- | ---: | --- |
| 域打开（加载 + schema 校验全部记录） | 0.1–0.2 ms | 只读元数据，不读 operations |
| `sortedRecords()`（entries + 排序 + normalize） | 54.5 ms | 1 次；每个 `validate()` 都会再做一次 |
| `validateRecords()`（独立 scratch 投影逐条校验） | **885.8 ms** | 其中逐条规则检查 805 ms，scratch apply 81 ms |
| live apply（构建实时投影） | 80.7 ms | 35,085 次 `applyTo` |
| 账本构造合计 | 962 ms | ≈ 排序 + 校验 + apply |
| 插件启动合计（构造 + initialize + remediation + activation） | 1,614–1,669 ms | 与 invariant 是否挂载在这一轮**没有区分开** |

**这一轮确认了「启动付两次全量校验」（3 次启动的对照）：**

```text
P0_BOOT_REPLAYS {"invariant-off":[{"bootMs":1658.2,"fullReplays":1,"validateRecordsMs":858.3},
                                  {"bootMs":1550.4,"fullReplays":1,"validateRecordsMs":794.9},
                                  {"bootMs":1464.6,"fullReplays":1,"validateRecordsMs":814.2}],
                 "invariant-on": [{"bootMs":2221.5,"fullReplays":2,"validateRecordsMs":1533.5},
                                  {"bootMs":2117.7,"fullReplays":2,"validateRecordsMs":1451.4},
                                  {"bootMs":1935.0,"fullReplays":2,"validateRecordsMs":1248.2}]}
```

- invariant off：**1 次**全量校验（账本构造自带），boot 1,465–1,658 ms，其中校验 795–858 ms。
- invariant on：**2 次**全量校验（构造一次 + 挂载再一次），boot 1,935–2,222 ms，校验合计 1,248–1,534 ms。
- 差值：**+1 次重放、+382 ms**（三次分别 +563 / +567 / +470 ms 的 boot 差）。
- 所以 Phase 1 第 1 条的收益有了直接口径：**11.7k ops 上省一次 ~0.8 s 的重放**；账本越大省得越多（见下面曲线）。

（早先有一次 leg B 单独跑出 on/off 都是 1.6 s 且 on 更快的读数，那是包装点挂错、`fullValidations` 计数为 0 的那一轮；以上三轮对照才是可用口径。这条自相矛盾我保留在这里，免得后来人只看到漂亮数字。）


**5x / 10x 输入：本轮判定「不值得造」。** 直接拼前缀/复制链条都会撞上 schema 与唯一性约束（`team/initialized` 只能出现在第 1 条，其 `previousOperationId` 必须为 null；operationId / requestId 全局唯一），而合法放大需要重写全部内部 ref，成本远超收益。改用下面这条曲线回答规模问题。

### 1b. 落地后：启动那次重复重放已经消失（票 01 / `d94fa64`）

实施 Tars（`d94fa64` `perf: adopt the boot ledger replay at the invariant mount`）；独立验收 Vera，2026-09-13 晚。复用判定条件是构造期重放之后的 `{记录数, head sequence, head operationId}` 与挂载时的活 head 一致——任何 commit 都改这三项，所以提交过的启动仍回落全量。

父提交 `2b8b62b` 与 `d94fa64` 同小时、同一冻结件、同一命令相邻两轮（每臂 3 次启动）：

| 臂（3 次启动） | `2b8b62b` 改前 | `d94fa64` 改后 |
| --- | --- | --- |
| invariant-on boot | 2,488.5 / 2,384.2 / 2,175.0 ms | **1,595.4 / 1,475.7 / 1,635.0 ms** |
| invariant-on `fullReplays` | 2 / 2 / 2 | **1 / 1 / 1** |
| invariant-on `validateRecordsMs` | 1,622.7 / 1,534.3 / 1,353.4 | 743.3 / 666.8 / 705.8 |
| invariant-off boot（对照） | 1,983.8 / 1,907.2 / 1,772.6 ms | 1,944.1 / 1,912.2 / 1,677.0 ms |

```text
# 2b8b62b（改前，父提交）
P0_BOOT_REPLAYS {"db":"/tmp/phase0/frozen.sqlite","arms":{"invariant-off":[{"iteration":1,"bootMs":1983.8,"fullReplays":1,"validateRecordsMs":952.9},{"iteration":2,"bootMs":1907.2,"fullReplays":1,"validateRecordsMs":912.9},{"iteration":3,"bootMs":1772.6,"fullReplays":1,"validateRecordsMs":871.5}],"invariant-on":[{"iteration":1,"bootMs":2488.5,"fullReplays":2,"validateRecordsMs":1622.7},{"iteration":2,"bootMs":2384.2,"fullReplays":2,"validateRecordsMs":1534.3},{"iteration":3,"bootMs":2175,"fullReplays":2,"validateRecordsMs":1353.4}]}}
# d94fa64（改后）
P0_BOOT_REPLAYS {"db":"/tmp/phase0/frozen.sqlite","arms":{"invariant-off":[{"iteration":1,"bootMs":1944.1,"fullReplays":1,"validateRecordsMs":913.5},{"iteration":2,"bootMs":1912.2,"fullReplays":1,"validateRecordsMs":876.5},{"iteration":3,"bootMs":1677,"fullReplays":1,"validateRecordsMs":842.3}],"invariant-on":[{"iteration":1,"bootMs":1595.4,"fullReplays":1,"validateRecordsMs":743.3},{"iteration":2,"bootMs":1475.7,"fullReplays":1,"validateRecordsMs":666.8},{"iteration":3,"bootMs":1635,"fullReplays":1,"validateRecordsMs":705.8}]}}
```

- **判据是计数不是比值**：`fullReplays` 2 → 1 确定性成立；on 臂墙钟落回 off 臂同一档（三对差 −893 / −908 / −540 ms，落在 §1 预估的 0.4–0.8 s 内）。±34% 噪声下不比小比例。off 臂两轮都是 1 次重放、1.68–1.98 s，对照管道未变。

对抗探针（真 sqlite + 真服务 + 真 invariant，冻结件，5 臂全绿，另复跑一次量级一致）：

```text
P0_GUARD {"arm":"adopt","mountMs":0.8,"extraReplays":0,"durableReadsAtMount":0}
P0_GUARD {"arm":"commit-first","spins":20,"commitReplays":0,"commitErrors":[],"mountMs":826.8,"mountReplays":1,"mountDurableReads":1}
P0_GUARD {"arm":"one-shot","replaysWhileAdopting":0,"secondCallReplays":1,"secondCallMs":860.8}
P0_GUARD {"arm":"out-of-band","operations":11695,"mountMs":0.6,"mountReplays":0,"mountThrew":false,"firstCommitResolved":true,"spins":1,"commitOneReplays":1,"caught":"agent-team ledger expected sequence 11695, found 11696","secondCommit":"invariant violated by \"@wowyuarm/dsh-agent-team\": durable ledger and Team projection diverged: Error: agent-team ledger expected sequence 11695, found 11696"}
P0_GUARD {"arm":"pre-boot","bootFailed":true,"message":"agent-team ledger expected sequence 11695, found 999999"}
```

| 臂 | 做的动作 | 读数 | 结论 |
| --- | --- | --- | --- |
| adopt | 构造后直接挂载 | 0.8 ms、+0 次重放、+0 次读表 | 复用路径在真装配里是活的 |
| commit-first | 先真 commit（`createChannel`）再挂载 | 826.8 ms、+1 次重放、+1 次读表 | 提交过的启动必然回落全量（且此时伴生插件还没挂，提交本身不排任何重放） |
| one-shot | 挂载后再调 `validateLedgerAtMount()` | 860.8 ms、+1 次重放 | 结论一次性消费，不留陈旧复用 |
| out-of-band | 绕开 commit 用 `table.put` 原地改写最后一条 → 挂载 → 两次真 commit | 挂载 0.6 ms 静默复用；第 1 次 commit 的延后重放（1 个 check 相后）抛 `expected sequence 11695, found 11696`；第 2 次 commit 在调用方栈抛 `invariant violated` | 单写者残留窗口实测存在，但检测只是推迟到下一次提交，不丢 |
| pre-boot | 启动前就把一条记录改坏 | 启动失败：`expected sequence 11695, found 999999` | 构造期 fail-closed 未丢 |

包内回归：`packages/agent-team/tests/agent-team.spec.ts` 70/70 绿（781 ms），含本票新增的 4 条（复用、提交后回落、挂载 fail-closed、一次性）。

## 2. 校验的规模曲线（gauge ①b）

命令：

```bash
P0_DB=/tmp/phase0/prefix-11695.sqlite npx vitest run packages/agent-team/tests/zz-p0-scale.spec.ts
```

用**真实记录列表的前缀**直接喂给 `validateRecords`（不造任何合成记录；每条记录自身合法）：

```text
P0_SCALE {"records":11695,"rows":[
 {"fraction":0.25,"records":2923,"validateMs":96.9,"msPerRecord":0.0332},
 {"fraction":0.5, "records":5847,"validateMs":226.9,"msPerRecord":0.0388},
 {"fraction":0.75,"records":8771,"validateMs":468.6,"msPerRecord":0.0534},
 {"fraction":1,   "records":11695,"validateMs":757.4,"msPerRecord":0.0648}],
 "extrapolated147kMs":9526,"extrapolated1mMs":64800}
```

> **口径订正（2026-09-13，Vera）**：这一行原写作 `extrapolated147kMs: 6480`，是探针把 `msPerRecord × 100_000`（10 万）的乘积挂在了 147k 的标签上；探针正本已改成 `× 147_000`。按末点 0.0648 ms/record 线性外推 147k 应为 **9,526 ms ≈ 9.5 s**（1M 那格 64,800 本来就按 1,000,000 算，无误）。两次外推都是**下界**：实测每记录成本随条数上升（本页 0.0332 → 0.0648），把末点斜率摊到全长只会低估。

**形状是超线性的**（每记录成本随账本增长而上升，0.033 → 0.065 ms/record），因此 `validations` 的规模外推**不能当线性用**：100k ops 的单批重放现实上会高于 6.5 s。这正是「瘦记录（B2）优先于截断（B3）」的量化依据。

## 3. read 放大（gauge ②）

命令：

```bash
P0_UNREAD=20,100,400 npx vitest run packages/agent-team/tests/zz-p0-drain.spec.ts
```

冻结账本里**任何 Member 在任何 Thread 上都没有未读**（都读干净了），所以未读积压是现造的：一个 Human Thread 里由 Agent Member 回复 N 条，然后走 Human 的读路径 drain。

```text
P0_DRAIN {"rows":{
 "invariant-off:20": {"roundsRun":1,"expectedRounds":1,"responseMs":0.82,"byteFirstRound":11531},
 "invariant-off:100":{"roundsRun":5,"expectedRounds":5,"responseMs":2.35,"byteTotal":57766},
 "invariant-off:400":{"roundsRun":20,"expectedRounds":20,"responseMs":8.5,"byteTotal":232047,
                      "responseMsPerRound":0.43,"byteFirstRound":11536,"byteLastRound":11617},
 "invariant-on:20": {"roundsRun":1,"responseMs":0.22,"replaysScheduled":0}}}
```

读数：

- **轮数完全等于 ⌈N/20⌉**（20→1、100→5、400→20），`unread.slice(0, 20)` 是硬配额，Client 50 轮上限最多覆盖 1,000 条未读。
- **读路径本身极便宜**：每轮 **0.43 ms**，400 条未读全 drain 只有 **8.5 ms**。所以「未读积压时打开慢」**不是**读路径的锅。
- **真正的放大在字节和提交次数**：每轮响应 ≈ **11.5 KB**（一次完整 thread 快照），400 条未读 → **232 KB** 读入 + **20 次 durable 提交**。这直接连到 B2：瘦记录压的就是这个每轮 11.5 KB 的重复快照。
- **重放被合并了**：drain 期间 `replaysScheduled` 为 0（读调用内），提交只在 check 相结算；`invariant-off` 没有重放，`invariant-on` 的 `replayMsPerCall` 1.4 ms 是空账本上的一次重放。**大账本上每轮的那个 ~0.8 s 重放才是 drain 的真实代价** —— 见下一条实测。

**全尺寸账本上的同一次读（frozen 11,695 ops，invariant 挂载）：**

```text
P0_DRAIN_FROZEN {"operations":11696,"remainingUnread":0,"readMs":8.52,
 "replaysDuringRead":0,"replaysAfterSettle":1,
 "validateMsPerCall":777.4,"responseBytes":1004}
```

- 这次读**没有任何未读**（`remainingUnread: 0`），响应只有 1,004 B，读调用 8.52 ms —— **但它在 durable 账本里又追加了一条 `team/thread-read`（operations 11,695 → 11,696）**，并在 check 相付了一次 **777 ms** 全量重放。
- **这一条就是 B1 的全部理由**：零未读的空读仍然写盘、仍然触发重放。B1 落地后这里应当是「不追加 operation + version 不动」。

（未读积压 × 大账本的组合见下一条，已实测。）

**未读积压 × 大账本（冻结 11,695 ops，invariant 挂载，真 drain）：**

```bash
P0_DB=/tmp/phase0/frozen.sqlite P0_N=100,400 P0_MODES=same-turn,yield \
  npx vitest run packages/agent-team/tests/zz-p0-drain-scale.spec.ts
```

先造未读（新开 Channel + Thread + Member，再由 Agent 回复 N 条），再走 Human 的读路径 drain。两列模式的区别只有一处：**轮与轮之间要不要让出一个 event loop 回合**。

```text
P0_DRAIN_SCALE_ROW {"count":100,"mode":"same-turn","row":{"operationsAfterSeed":11803,"unreadSeeded":100,
 "drainMs":50.98,"drainMsPerRound":10.2,"putDuringDrain":5,"replaysDuringDrain":0,"replaysAfterSettle":1,
 "validateMsAfterSettle":771.88,"byteTotal":59149}}
P0_DRAIN_SCALE_ROW {"count":100,"mode":"yield","row":{"drainMs":2966.6,"drainMsPerRound":593.32,
 "putDuringDrain":5,"replaysDuringDrain":4,"replaysAfterSettle":1,"validateMsAfterSettle":819.85}}
P0_DRAIN_SCALE_ROW {"count":400,"mode":"same-turn","row":{"operationsAfterSeed":12118,"unreadSeeded":400,
 "drainMs":118,"drainMsPerRound":5.9,"putDuringDrain":20,"replaysDuringDrain":0,"replaysAfterSettle":1,
 "validateMsAfterSettle":670.48,"byteTotal":236955}}
P0_DRAIN_SCALE_ROW {"count":400,"mode":"yield","row":{"drainMs":13754.44,"drainMsPerRound":687.72,
 "putDuringDrain":20,"replaysDuringDrain":19,"replaysAfterSettle":1,"validateMsAfterSettle":700.45}}
```

| 未读 | 轮数 | 每轮响应 | 响应字节合计 | durable put | 批后重放 | **用户可见 drain 墙钟** |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 20 | 1 | 11.8 KB | 11.8 KB | 1 | 1 次 ≈ 0.78 s | ≈ 0.8 s |
| 100 | 5 | 11.8 KB | 59 KB | 5 | 5 次 | **2.97 s**（每轮 593 ms） |
| 400 | 20 | 11.8 KB | 237 KB | 20 | 20 次 × ≈ 0.69 s | **13.75 s**（每轮 688 ms） |

读法（三条，第一条最重要）：

1. **drain 的代价完全取决于「轮与轮之间 Host 有没有机会进 check 相」，而不是读路径本身。** `same-turn`（探针里连续调用，promise 全在 microtask 里结算）整段 drain 只合并出**一次**重放，400 条未读 118 ms 就结束了；`yield`（每轮之间 `await setTimeout(0)`）每轮各付一次，**400 条 = 13.75 s**。真实 Host 里每个客户端轮次都是一次独立 Remote 往返，必然跨 check 相 —— 所以**用户侧的口径是 yield 那一列**，`same-turn` 那一列只说明「合并机制本身是有效的，缺的是让出一个回合的机会」。
2. 因此上一版「`777 ms/批 × ⌈N/20⌉` ≈ 15.5 s」的外推**在量级上成立**（实测 13.75 s），但它的成立条件现在被写清楚了：不是「每次读都要重放」，而是「每次读之间都会被让出回合」。反过来说，**任何把多轮读合并进同一个回合的改动（或在同一个回合里预先批量 drain）都能把 20 次重放压成 1 次** —— 这是 Client 侧 drain 循环可以考虑的独立优化方向，与 B1/B2 正交。
3. 每轮响应恒定 ≈ 11.8 KB（≈ 一次完整 thread 快照；比小账本版的 11.5 KB 只多出账本自身的一点差异），20 轮 237 KB。**读路径的墙钟是 5.9–10.2 ms/轮，与账本大小几乎无关** —— 大账本的钱全在重放上，不在读上。

**探针踩坑（重要，别重复）：** 第一版把两种模式用同一批 `requestId` 跑，第二次调用被 ledger 的幂等缓存直接命中 —— 读数看起来"极快、零 put、零重放"，实际什么都没做。**幂等缓存会让重复的探针静默变成免费**；换模式/换轮次必须换 requestId。


### 3b. 落地后：无进展的读不再落盘（票 02 / `8dabaa3`）

实施 Tars（`8dabaa3` `perf: skip the durable write for a no-progress Thread read`）；独立验收 Vera，2026-09-13 晚。规则：`prepareRead` 算出的 Inbox delta 为空（attention / directMarkers / activityMarkers 三组都没有增减）→ 不 `put`、不 `apply`、不 emit、不排延后重放，返回同一份画面但不给 receipt。

同一支探针（真 sqlite + 真服务 + 真 invariant + 冻结件）在父提交 `d94fa64` 与 `8dabaa3` 上相邻两轮：

| 场景（都是 11,695 ops 的冻结件） | `d94fa64` 改前 | `8dabaa3` 改后 |
| --- | --- | --- |
| 已读完的 thread 再读一次：operations | 11,695 → **11,696**（+1） | 11,695 → **11,695**（0） |
| 同上：`changeVersion` | +1 | **0** |
| 同上：`agent-team/committed` 事件 | 1 | **0** |
| 同上：延后全量重放 / 耗时 | 1 次 / **834.3 ms** | **0 次 / 0 ms** |
| 同上：receipt / 读调用本身墙钟 | seq 11,696 / 7.3 ms | **无 receipt / 1.0 ms** |
| 成员留一条未读后 Human 再读 | 落盘 11,698、版本 +1、重放 910.4 ms | 落盘 11,697、版本 +1、重放 814.0 ms |
| 同一 requestId 重试上面那次读 | 同一 receipt、+0 条、0 事件 | 同一 receipt、+0 条、0 事件 |
| 重启（同一 sqlite 文件，真重开装配）后再读 | **又写一条**（11,699） | **不写**（11,699 之前就停住），水位不丢 |

```text
# d94fa64（改前）
P0_NOOP {"arm":"noop-read","expect":"legacy","readMs":7.3,"opsBefore":11695,"opsAfter":11696,"opsDelta":1,"versionDelta":1,"commitEvents":1,"replays":1,"replayMs":834.3,"receipt":11696,"unread":0}
P0_NOOP {"arm":"progress-read","expect":"legacy","replyBy":"Ferry:true","opsAfterReply":11697,"readMs":6.6,"opsDeltaRead":1,"versionDelta":1,"commitEvents":1,"receipt":11698,"unread":0,"replayMs":910.4,"retryReceipt":11698,"retryOpsDelta":0,"retryEvents":0}
P0_NOOP {"arm":"restart-read","expect":"legacy","opsBefore":11698,"opsAfter":11699,"opsDelta":1,"receipt":11699,"unread":0}
# 8dabaa3（改后）
P0_NOOP {"arm":"noop-read","expect":"noop","readMs":1,"opsBefore":11695,"opsAfter":11695,"opsDelta":0,"versionDelta":0,"commitEvents":0,"replays":0,"replayMs":0,"receipt":"none","unread":0}
P0_NOOP {"arm":"progress-read","expect":"noop","replyBy":"Ferry:true","opsAfterReply":11696,"readMs":6.9,"opsDeltaRead":1,"versionDelta":1,"commitEvents":1,"receipt":11697,"unread":0,"replayMs":814,"retryReceipt":11697,"retryOpsDelta":0,"retryEvents":0}
P0_NOOP {"arm":"restart-read","expect":"noop","opsBefore":11697,"opsAfter":11697,"opsDelta":0,"receipt":"none","unread":0}
```

**历史体量（离线复算冻结件里 7,079 条 `team/thread-read` 各自写下的 delta）**——空 delta 的读在新规则下一条都不会写：

- 全部读：7,079 条里 **2,607 条（36.8%）为空 delta**；账面 29.3 MB 里 **8.1 MB（21.2% 的账本 JSON）**。
- 其中 Human 的读：3,391 条里 **2,089 条（61.6%）为空**（6.3 MB）。
- 空 delta 读平均 3,097 B，全体读平均 4,144 B。
- 复算口径可靠：空 delta ⇒ `apply` 不改投影 ⇒ 跳过它对后续状态零影响，所以这是精确反事实，不是外推。

**回归（Vera 独立跑，非引用 Tars 的自证）**：`npx vitest run packages/agent-team packages/tool-agent-team` → 29 文件通过 / 1 跳过，**433 通过 / 1 跳过**，含 `change-scopes.spec.ts`、`member-lifecycle.spec.ts`、`typert-generation.spec.ts` 与 tool 层渲染用例。

**边界（03 的输入）**：有进展的读**仍然**是一次提交 —— 落盘 +1、`changeVersion` +1、延后重放一次（814 ms）。所以「phantom refresh」的剩余来源正是这类提交；02 只消掉了空读那一半。

### 3c. 落地后：瘦读记录（票 04 / `06569e6`）

实施 Tars（`06569e6` `perf: slim durable Thread read records to a receipt`）；独立验收 Vera 待跑。**形状**：新写入的读只存 6 键 `{ workspaceId, memberId, threadRef, taskRef?, readThroughSequence, inbox }`——`attention` 与 `remainingUnreadCount` 不再落盘（投影派生报告字段，逐条独立派生要克隆投影再数未读，正好顶掉要赚的斜率；`applyTo` 读分支只吃 `inbox`）。旧胖记录保留为 `AgentTeamThreadReadSnapshot`：只读 normalize + 校验、**永不重写**、domain version 保持 1；一个 strict zod union 同时接受两形（`DomainFacility.open()` 逐条 parse，agent_team 没有声明 `invalidRecords: 'backup-and-skip'`，schema 不兼容整域打不开）。validator 两分支各自独立派生：receipt → `prepareReadReceiptFrom`（廉价：threadContext/授权/attention/unread/水位/consumed+activity markers/inbox）派生 6 键 deep-compare，报 `invalid Thread read receipt`；snapshot → 老的 `prepareReadFrom` 全量 deep-compare，报 `invalid Thread read projection`。重试已落盘的读 = **原 receipt + 当前投影现算的画面**（冻结画面不承诺，见 [`../../spec.md`](../../spec.md) §5.2）。

**票面判据 ④ 的测量协议（先读这条，否则会误读下面两栏）**：冻结件里 7,079 条读**全是胖的**，而 ④ 要求旧记录只读不改 ⇒ 在原件上四组绝对量**预期持平**，持平本身就是 ④ 的证明。收益只能在「读记录按新形状写入」的账本上量：用 [`slim-ledger.py`](slim-ledger.py) 把冻结件机械投影成全瘦 / 半瘦反事实账本（同 sequence、同 id、同 actor、同 occurredAt、同水位、同 Inbox delta，只把快照字段换成 6 键；`--audit` 做字段级自审，本次跑**零违规**）。原件与反事实跑**同一条** 25/50/75/100% 前缀曲线。

**四组绝对量（票面判据 ①）**（真装配 + 真 sqlite；冻结件 11,695 条 / 7,079 条读）

| 档 | 账本字节（UTF-8） | 读记录 mean | 单次 `validate`（4 次中位，满档） | boot（3 次中位，invariant on，`fullReplays` 恒 1） |
| --- | ---: | ---: | ---: | ---: |
| 全胖原件 | 46,166,788 | 5,069 B | 796.9 ms | 1,917.2 ms（重放 843.0 ms） |
| 半瘦（`--ratio 0.5`） | 31,374,852（−32.0%） | 2,980 B | — | 1,625.6 ms |
| **全瘦（post-04 形状）** | **16,610,852（−64.0%）** | **894 B（−82.4%）** | **466.7 ms（−41.4%）** | **1,190.1 ms（−37.9%）**（重放 512.0 ms，−39.3%） |

字符口径（Vera 的尺子，别与上面混用）：账本 38,063,589 → 15,059,116（−60.4%），读记录 4,144 → 894 B（−78.4%）。差 22% 是冻结件里的中文（3 B/字）；Vera 2026-09-13 已独立实测确认两口径同源。

**斜率（票面判据 ②，判据本体）**：`validate` 满档 796.9 → 466.7 ms 只是总量摊薄；判过的是每记录成本与每翻倍指数：

- 每记录：0.0320→0.0681 ms（胖）vs 0.0211→0.0399 ms（瘦）；**每翻倍 2.56× → 2.31×（指数 1.36 → 1.21）**。
- 读记录**自己**的规则校验：**567.4 → 260.2 ms（−54%）**，每次读 0.0802 → 0.0368 ms；占整趟校验 **71% → 56%**；`applyTo` 读分支 19.8 → 16.4 ms。
- **残余超线性两条曲线都在**（`thread-replied` 每记录 0.0139 → 0.0482 ms）⇒ 04 只把燃料变细，**没把曲线做直**，那部分归 **05**，不能记在 04 的账上。

**票面判据 ④：冻结件上追加一条真读（走真写路径）**：committed；新记录**恰好 6 键**、**1,155 B**、账本 +1,155 B；读调用 18.2 ms；追加后整趟重放 964.3 → 813.6 ms（**噪声内持平**）；再冷启动 1,445.4 ms / 1 次重放 / 11,696 条（持平）。即「新形状真的写进去了、旧记录一条没动、重放没有因此变贵」。

**票面判据 ⑤：147k ops 外推（两档）**：沿用 Vera 方法（末点 ms/record × 147,000）全胖 **10.0 s** / 全瘦 **5.9 s**；幂律读法 39.8 / 18.8 s。另修正 §2 一处标签错误：`extrapolated147kMs: 6480` 实际是 ×100k 得到、标签写成了 147k。

**票面判据 ⑥：与 04 无关（重要，别写反）**：§5b 的 web 账本 12,042 条 = 12,000 `thread-replied` + 40 `message-sent` + 2，**`team/thread-read` 0 条** ⇒ 04 在该账本上命中率 0；762.9 → 108.5 ms、1 → 0 次重放是**票 02** 的功劳，重放燃料是消息记录，压它归 05/07。票面 ⑥ 因此保持未勾，改报两种读法待 Reeve/Human 拍。

**口径提醒（Vera 2026-09-13，收尾报数必须遵守）**：同一支 scale 探针同一份冻结件，她的末点早期 0.0648 ms/record、23:15 重测 0.0757（+17%）⇒ 今晚机器有漂移；「她 885.7 / 我 796.9」那 11% 差是噪声，方向一致。**跨会话的绝对量不混用**，收尾一律用同会话内的前后档。

**复跑（探针源码 [`zz-t04-measure.spec.ts`](zz-t04-measure.spec.ts)，跑完即从 `packages/agent-team/tests/` 删副本）**：

```bash
# 反事实账本（先建，再让任何引擎打开它）
python3 .scratch/active/team-perf/materials/phase0/slim-ledger.py \
  /tmp/phase0/frozen.sqlite /tmp/phase0/frozen-slim.sqlite --ratio 1.0 --audit
python3 .scratch/active/team-perf/materials/phase0/slim-ledger.py \
  /tmp/phase0/frozen.sqlite /tmp/phase0/frozen-mixed.sqlite --ratio 0.5 --audit
# 曲线 / boot / 追加 + 追加后冷启动，三臂分别跑（DB 指向不同档）
cp .scratch/active/team-perf/materials/phase0/zz-t04-measure.spec.ts packages/agent-team/tests/
T04_ARM=curve BENCH_DB=/tmp/phase0/frozen-slim.sqlite npx vitest run packages/agent-team/tests/zz-t04-measure.spec.ts
T04_ARM=boot  BENCH_DB=/tmp/phase0/frozen-slim.sqlite npx vitest run packages/agent-team/tests/zz-t04-measure.spec.ts
T04_ARM=append BENCH_DB=/tmp/phase0/frozen-slim.sqlite npx vitest run packages/agent-team/tests/zz-t04-measure.spec.ts
rm -f packages/agent-team/tests/zz-t04-measure.spec.ts
```

**证据边界（诚实标注）**：上面这组数是 Tars 在**工作区最终态**上的自测（该态与 `06569e6` 提交内容逐字节相同：`lib/` 构建 23:17:05 晚于所有源码改动，提交后 `git status` 对这批路径为 clean），原始 console 行随会话滚出、未留档；**结论强度以 Vera 的独立对抗探针为准**（`zz-p0-slim-guard.spec.ts`：三形态启动投影摘要逐字相等、6 键键集、八条篡改必红、胖 `facts[]` 砍一条必红、零改写）。包内回归与门禁：`agent-team.spec.ts` **80/80**、全量 `npm test` **573 passed / 1 skipped（43 文件）**、typecheck 绿、lint **0 warnings 0 errors**、check:docs 绿、build 绿。

### 3d. Vera 独立验收（票 04 / `06569e6`）—— 结论：**过**，2026-09-13 23:2x

探针 `obs-scripts/team-perf-phase0/zz-p0-{slim-guard,scale,boot}.spec.ts`（跑在隔离 clone，`git checkout -B verify-04 origin/master` = `06569e6`）。**同一会话内**先量父提交 `76d0148`、再量 `06569e6`，所有前后档同机同时段。

**判据落在「每记录规则校验成本」上**（`scale` 探针满档，本次加了 per-kind 拆分）：读记录**自己**的规则校验 **0.0678 → 0.0340 ms/次（−49.9%）**；整趟校验 **855.3 → 520.6 ms（−39.1%）**、`ruleChecks` **814.9 → 482.0 ms（−40.9%）**；`applyTo` 24.2 → 23.4 ms（本就不是大头）。按 kind 拆的末档累计：`thread-read` **1,229.8 → 616.7 ms**，而 `thread-replied`（263.7 → 242.2）、`message-sent`（33.4 → 29.0）、claims 各档**全在 ±8% 噪声内没动** ⇒ 收益精确落在读记录，没有被搬到别处。

| 满档 11695 条（同会话） | `76d0148` 父提交 | `06569e6` 全瘦 | 变化 |
| --- | ---: | ---: | ---: |
| 25/50/75/100% 校验 | 97.6 / 248.1 / 510.6 / **855.3** ms | 79.3 / 153.4 / 324.3 / **520.6** ms | −39.1% |
| 每记录（末点） | 0.0731 ms | 0.0445 ms | −39.1% |
| 每翻倍指数（2^e） | 2.96×（e=1.565） | 2.56×（e=1.357） | 未做直，两边都 >1 |
| boot 组装完整装配 | **1,856.0** ms | **932.0** ms | −49.8% |
| boot 3 轮（invariant on，中位） | 1,551.6 ms | 758.5 ms | −51.1% |
| 构造（Ledger ctor） | 967.0 ms（重放 895.1） | 627.4 ms（重放 560.2） | −35.1% |

每翻倍指数**仍 >1**（1.565 → 1.357）⇒ 04 **只把燃料变细，没把曲线做直**；残余超线性按 Tars 定位归 **05**（`validateInboxDelta` 每条消息记录复制整份 `messages`/`orderedFacts` + 读路径 `remainingUnreadCount` 的假设投影克隆）。

**对抗臂 7/7 绿**（`zz-p0-slim-guard.spec.ts`，真 sqlite + 真 AgentTeam 服务 + 真 invariant，三条账本同历史）：三条账本启动后 28 张投影表规范化摘要**逐字相等** `d924bf2fe86551d9`；新写入真读的落盘记录**恰好 6 键**、无 `attention` 残留、`committed`；九条篡改**全部启动失败**（4a 删水位 / 4f 塞胖 thread / 4h 多带 attention → schema 层；4b 抬 / 4c 清 delta / 4d 降 / 4e 换 memberId / **4g 交换 delta** / **4i 删 taskRef** → `invalid Thread read receipt` 派生层）；胖记录 `facts[]` 砍一条 → 仍红（`invalid Thread read projection`）；胖/半瘦启动前后逐条 diff **零改写**；胖记录加载后**内存里仍带** `thread`/`facts`/`anchor`。包内回归 **573 passed / 1 skipped（43 文件）**、typecheck 绿。

**两条探针自身的缺陷（都在我的探针里，不是产品）**：

1. **4g 曾是假绿**：原实现取「同一 `(memberId, threadRef)` 分组里的前两条」记录，而那两条的 `inbox` delta 是**逐字节相同的空 delta** ⇒ 交换是 no-op，**任何 validator 下都会绿**。改成「必须选两条**非空且互不相同**的 delta」后落在 `invalid Thread read receipt`。全瘦件里合格候选 46,464 对（不是数据不足）。教训：**交换/替换类变异必须先断言两侧不同**，否则测的是恒等式。
2. **`extrapolated147kMs` 标签错误**（已修）：`perRecord * 100_000` 硬编码 10 万、标签写 147k。修后按末点线性（**下界**）：全胖 147k ≈ **10.7 s** / 全瘦 ≈ **6.5 s**；幂律读法（用实测指数，只跨 4× 范围）胖 ≈40 s / 瘦 ≈18.8 s。

**一条给 05 的独立证据**：混合档（3,540 胖 + 3,539 瘦读）满档 **662.1 ms**，而按「胖/瘦线性插值」应为 **621.9 ms**——**高出 40 ms**，正是 legacy 胖读的 `attentionBefore` 全局 `messages.filter` 在真胖账本上多付的钱（与 Tars 的 05 第 ③ 项吻合）。

**残留（都不阻断）**：① 重试语义已按 spec §5.2 改为「原 receipt + 当前投影现算画面」，包内已覆盖，但 `types/operations.ts` 中 `AgentTeamThreadReadSnapshot.task` 的注释「captured for a stable idempotent read response」对新记录不再成立，可顺手订正；② boot assembled 的 invariant off/on 两臂几乎没动（1856/1668 vs 基线 1852.9/1778.0，噪声内，本非 04 目标）；③ 堆增量读数（胖 +7.6 MB / 瘦 −58.1 MB）由 GC 时机主导，**不可信**，未用于任何结论；④ ⑥ 判据保持未勾（该曲线对 04 命中率 0，燃料归 05/07），与 §5c 一致。

### 3e. 落地后：读一次不再克隆整份 marker 投影（票 05 第一片 / `956011a`）

实施 Tars（`956011a` `perf: count remaining unread without cloning the marker projection`）；独立验收 Vera 待跑（她已预登记三条判据，其中两条针对**第二片**的索引）。**这一片不新增索引**，是纯局部重写 + 语义等价证明。

**改前**：`readThread` → `prepareRead` → `prepareReadFrom` 为算 `remainingUnreadCount` 构造「假设投影」——把 `attention`、`directMarkers`、`activityMarkers` 三份 map，加 `attentionByThread`（逐 thread 复制 follower Set）、`attentionThreadsByMember`、`directMarkersByMember`、`activityMarkersByMember`（逐 member→thread 复制 marker 数组）整体克隆，`applyInboxDelta(nextProjection, receipt.inbox)` 之后再 `unreadForFrom(nextProjection, …).length`。marker 总量随账本线性（每条被 mention 的消息至少一个 marker）⇒ **每次读都付 O(全部 marker)**。

**改后**：`remainingUnreadAfter(projection, memberId, receipt)` 只用三样东西 —— `receipt.attention`（就是 `applyInboxDelta` 之后那一行的值：`nextAttention[0] ?? attention`）、`receipt.inbox.directMarkers` 的 removals/additions、`receipt.inbox.activityMarkers` 的 removals/additions —— 然后遍历 `factsByThread.get(threadRef)` 计数。单次读的分配从 **O(全部 marker)** 降到 **O(该 Thread 的 fact 数 + 该 reader 在该 Thread 的 marker 数)**。另把「这条 fact 对这个读者是否未读」抽成 `isUnreadFact(...)`，画面派生（`unreadForFrom`）与计数派生共用同一权威。顺带把 `firstRead` 的背景快照从全局 `projection.messages.filter(...)` 改走 `factsByThread`（`appendMessageFact` 是每个 Thread message 的唯一写入点，两者同集合同序），并订正 §3d 残留 ① 的那行注释。

**等价性由构造保证**（这一片不靠抽样对比，也不靠「新旧实现各跑一遍」）：读的 delta 只碰「该 reader 在该 Thread 的 attention 行与 marker」，而 `isUnreadFact` 的每一次查表都限定在同一 (member, Thread) 对；post-delta 用的三个值就是 delta 的派生输入本身。没有第二套语义可漂。

**新增包内语义臂**（`agent-team.spec.ts`，2 Thread × 2 Member 交错；reader 在两个 Thread 各有 mention marker，旁观者在 Thread A 有 marker，外加一条普通 Human 更新）：

| 断言 | 它锁住的语义 |
| --- | --- |
| reader 读 Thread A 后 `remainingUnreadCount === 0`，画面里 direct marker 恰好 1 条 | 水位推进 + marker 消费在同一次读里都对 |
| **Thread B 的读仍 `committed === true`** | 跨 Thread 不泄漏（没把别处的 marker 吃掉） |
| **旁观者读 Thread A 仍 `committed === true` 且 marker 还在** | 跨 Member 不泄漏 |

**变异自证（源码按 sha256 还原，`7bfbee5b7671926aa723d46538928484bc5ad14cfdc7ff62258fafe31dca649b` 前后逐字节相同）**：

```text
ARM M1-pre-delta-attention   => 4 failed | 77 passed   （用 receipt.attentionBefore 代替 receipt.attention）
ARM M2-no-marker-removal     => 1 failed | 80 passed   （不应用 receipt.inbox.directMarkers.removed）
ARM M3-global-marker-keys    => 0 failed | 81 passed   （等价变异体，见下）
```

**M3 为什么是等价变异体**：`directMarkerKey` 内嵌 memberId + threadRef，把键集来源从「该 reader 在该 Thread 的桶」换成全局 marker，不改变任一 (member, Thread) 对的成员判定 ⇒ 语义不可判。**这不是覆盖缺口**：性能上仍然必须读桶（O(该 reader 在该 Thread 的 marker) vs O(全部 marker)），M3 只证明「作用域由键承担，不由额外过滤承担」。

**这一片没有量的东西（口径诚实标注）**：单次读的**绝对墙钟与堆分配**前后对照。票面第一句判据读的是结构，而绝对量需要父提交基线（Vera 的方法；我这边没有），所以由她独立量。堆增量读数在 §3d 已被证明不可信（GC 时机主导），别拿堆差当结论。

**门禁（最终态）**：build 绿、`npm test` **574 passed / 1 skipped（43 文件）**、typecheck 绿、lint **0 warnings 0 errors**（134 文件 84 规则）。

**下一片**：`validateInboxDelta` 每条 `team/message-sent` / `team/thread-replied` 校验都 `[...projection.messages]`、`[...projection.orderedFacts.filter(kind === 'activity')]`、`new Set([...projection.threads.keys()])`，再对每个 marker 在整份数组上 `.find` —— 这是 Vera per-kind 表里 `thread-replied` 没动的那一半。改法 = replay-derived 的 `messageRef` / `activityRef` 索引 + 成员测试改 `has`；她预登记的 (b)「索引必须 replay-derived」与 (c)「篡改索引必红」针对的就是这一片。

### 3f. 落地后：校验路径的 marker 引用改走 replay-derived Message 索引（票 05 第二片 / `e38c6be`）

实施 Tars（`e38c6be` `perf: resolve inbox marker references through a replay-derived Message index`）；独立验收 Vera 待跑（(b)/(c) 两条预登记臂的变异结果见下）。**这一片是校验内部索引化 + 删一份冗余投影状态**，不动 durable 语义、不动 schema。

**改前**：`validateInboxDelta` 在**每条** inbox 携带记录的校验里无条件做三份全量复制，再对每个 marker 在数组上 `.find`：

```ts
const knownThreadRefs = new Set([...projection.threads.keys(), ...additionalThreadRefs])   // O(threads)
const messages = [...projection.messages, ...additionalMessages]                           // O(messages)
const activities = [...projection.orderedFacts.filter(f => f.kind === 'activity').map(f => f.activity), ...]  // O(all facts)
```

账本越大 ⇒ 每条 `team/message-sent` / `team/thread-replied` 的校验越贵。这是 04 之后 `thread-replied` 每记录 0.0139 → 0.0482 ms 的那一半（Vera 的 per-kind 表）。

**改后**：

- `Projection.messages` 数组整个删除（它唯一的读者就是这里的那次复制）：换成 `messagesByRef: Map<AgentTeamMessageRef, AgentTeamMessage>`，与 `factsByThread` **同一次 append** 维护（`appendMessageFact` 是唯一写入点）⇒ live 投影与校验用的 scratch 投影天然一致。
- `knownThreadRefs` 的 Set 换成 `projection.threads.has(...)` + `additionalThreadRefs.includes(...)`（后者 ≤1 项，无需建集合）。
- 两处 direct marker 校验的 `.find` 换成 `projection.messagesByRef.get(marker.messageRef) ?? additionalMessages.find(...)`：**保留「投影优先、再加入本记录」的旧优先级**（`team/message-sent` 的新 Message 校验时还没 apply，靠 fallback 命中）。
- 活动 marker 那支同样去掉 `orderedFacts.filter(...)` 复制，改为只查本记录自带的 `additionalActivities`（理由见下）。

**为什么活动 marker 不需要投影侧索引（与第一版计划的偏离，有证据）**：先按计划加了 `activitiesByRef` 并按「投影优先」查；变异臂 **M3「把 `appendActivityFact` 里的索引写入整行删掉」= 82 条全绿**。读源码：活动 marker 只在 `closeThreadInboxFrom` / `acceptThreadInbox` / `reopenThreadInboxFrom` / `promoteThreadInboxFrom` 四处产生，全都用**本操作自带的那个 activity** 的 `activityRef` + `sequence`；removal 分支根本不查 activity；实体 ref 全局唯一（`addRef` 重复即拒），投影里不可能存在同 ref 的另一个 activity。⇒ 这份投影索引**没有可判读者**，是纯死状态，已连同写入一起删除，`activities` 的全量复制照样消失。按 §3e 的 M3 同样口径记「不可判」，不是覆盖缺口。

**Vera 预登记的两条索引臂 + 两条补充臂（源码级变异；sha256 `cd16db59041b5b6adb0dae5c3bf3989a01d5b7d89120acd7bcb6ca2a2637b8af` 前后逐字节还原）**：

```text
ARM M1-live-only-index          => 7 failed | 75 passed   （(b) 索引只挂在 live 投影上，scratch 不维护）
ARM M2-stale-index-component    => 3 failed | 79 passed   （(c) 索引把「上一条消息」挂在当前 ref 下）
ARM M3a-activity-no-resolution  => 7 failed | 75 passed   （活动 marker 解析不到任何 activity）
ARM M3b-drop-undefined-guard    => 0 failed | 82 passed   （等价变异体，见下）
ARM M4-whole-ledger-fallback    => 1 failed | 81 passed   （全账本 Message 集兜底 ⇒ 只有新增臂红）
```

- **M1 兑现 (b)**：索引只在 `target === this.state` 时写 ⇒ 校验用的 scratch 投影索引为空 ⇒ 读消费 earlier marker、删 marker 的用例 7 条全红。索引必须由 replay 那次 apply 维护（`applyTo` 同时喂 live 与校验投影）。
- **M2 兑现 (c)**：索引被写成「当前 ref → 上一条 Message」这种错分量，一致性检查照样抓住（红的三条含 2 Thread × 2 Member 那条语义臂）。
- **M3b 为什么是不可判**：携带活动 marker 的记录（`promote`/`close`/`accept`/`reopen`）都先把记录里的 inbox 与**现推的** expected inbox 逐字比对，再进 `validateInboxDelta`；读记录同理（先比 expected receipt）。所以 `activity === undefined` 这支对单条伪造记录不可达 —— 改前也如此，不是本片引入的缺口。
- **M4 证明新增臂有判别力**：给消息解析加「全账本 Message 集」兜底后，只有新增的 forward-reference 臂变红（其余 81 条全绿）⇒ 那条臂确实区分「按 replay 状态解析」与「按账本全集解析」。

**新增包内臂**（`agent-team.spec.ts`）：`rejects a direct marker that resolves only against a later record during replay` —— 把某条 reply 的 marker 改写成**后一条 record** 里的真 Message（同 Thread、sequence 也改成它的），扫全账本 Message 集会接受、按 replay 状态必须拒；断言抛出 `invalid direct marker addition`。

**门禁（最终态）**：build 绿、`npm test` **575 passed / 1 skipped（43 文件）**、typecheck 绿、lint **0 warnings 0 errors**（134 文件 84 规则）、check:docs 绿（`npm test` 内含）。

**这一片没量的东西**：per-kind 前后绝对量（`thread-replied` 是否终于下降、`thread-read` 是否回涨）——归 Vera 的父提交基线尺子，我这边没有基线。

### 3g. Vera 独立验收（票 05 两片 / `956011a` + `e38c6be`）—— 结论：**过**，2026-09-13 23:5x

尺子：隔离 clone `/home/yu/projects/dsh-agent-team-pr18` 分支 `verify-05b`，冻结件 `/tmp/phase0/frozen.sqlite`（**11,695 条记录**，胖的那份）。所有前后对照都在**同一会话内交错跑**（06569e6 → 956011a → e38c6be，各自 full-1 与 0.25/0.5/0.75/1 曲线各一遍）。

**范围与门禁（Vera 自跑）**：`e38c6be` 只动 2 路径（`ledger.ts` 39 行、`agent-team.spec.ts` +25），无 schema / domain version 变化。`npm test`（含 generate:typert / check:docs / check:core-skills）**575 passed / 1 skipped（43 文件）**，与 Tars 数逐字一致；`npm run typecheck` RC=0；`npm run lint` 0 warnings 0 errors（134 文件 84 规则）。变异基线 sha256 `cd16db59041b5b6adb0dae5c3bf3989a01d5b7d89120acd7bcb6ca2a2637b8af` 与 Tars 报的相同，每条变异后逐字节还原。

**变异臂（我自己写、跑全 workspace 套件，不只跑 `agent-team.spec.ts`）**

| 臂 | 变异 | Vera 结果 | Tars 同臂 |
| --- | --- | --- | --- |
| (b) | `messagesByRef` 只在 `target === this.state` 时写（scratch 投影不维护） | **17 红**（清一色「读消费 earlier marker / 删 marker」用例） | 7 红 |
| (c) | 索引写成「当前 ref → 上一条 Message」 | **5 红** | 3 红 |
| (e) | 拆掉 `?? additionalMessages.find(...)`（本记录 fallback） | **25 红** ⇒ fallback 是承重的，不是装饰 | 未做 |
| (f) | 解析改走「全账本 Message 集」兜底 | **只 1 红 = 恰好新增那条 forward-reference 臂**，其余 574 绿 ⇒ 边界性质只有这条新臂在锁 | M4 同结论 |
| (g) | 活动 marker 解析恒为 `undefined` | **12 红** ⇒ 活动 marker 校验仍有牙齿 | M3a 7 红 |

红数与他不同（7/3/7 → 17/5/12）是统计范围与变异写法差异，方向一致：**该红的全红**。第一片的两条我此前已验（M2「不应用 marker removals」1 红、M1「用 pre-delta 水位」4 红）。

**真实账本普查（插桩，不是变异；11,695 条全量 replay）**——用来判「投影侧活动索引是不是死状态」：

| 事件 | 次数 | 投影命中 | 记录自带命中 | 未解析 |
| --- | --- | --- | --- | --- |
| direct marker 新增 | 1,212 | **0** | 1,212 | 0 |
| direct marker 删除 | 1,208 | **1,208** | — | 0 |
| activity marker 新增 | 100 | **0**（投影里找不到同 ref） | 100 | 0 |

⇒ `messagesByRef` 的承重角色**正是 removal**（与 (b) 红的用例集合一致）；而活动 marker 的投影侧索引在真实数据上**零次可判**，「死状态、删掉」的主张成立，不只是论证。附带说明：新增 direct marker 的「投影优先」顺序在本账本上 0/1,212 次被走到，是防御性写法。

**per-kind 同会话 A/B**（全账本校验一次；括号为复跑）

| kind | calls | `06569e6` | `956011a` | `e38c6be` |
| --- | --- | --- | --- | --- |
| `team/thread-read` | 7,079 | 0.0843 | 0.0605 | **0.0274** |
| `team/thread-replied` | 2,863 | 0.0518 | 0.0503 | **0.0056（−89%）** |
| `team/message-sent` | 221 | 0.0799 | 0.0733 | 0.0094 |
| `team/claim-created` | 285 | 0.0487 | 0.0450 | 0.0170 |
| `team/claim-done` | 261 | 0.0528 | 0.0435 | 0.0159 |
| `team/task-changed` | 198 | 0.0617 | 0.0494 | 0.0129 |
| `team/thread-attention-changed` | 244 | 0.0359 | 0.0339 | 0.0085 |
| **整趟 validate** | 11,695 | **861.2 ms** | 679.9 ms | **262.6 ms**（265.4 / 244.1） |
| ms/record | | 0.0736 | 0.0581 | **0.0225** |
| 147k 外推 / 1M 外推 | | 10,819 ms / 56.6 s | 8,541 ms / 51.4 s | **3,308 ms / 19.6–20.9 s** |

⇒ 第二片**不是只治 `thread-replied`**：parent 对**每一条** inbox 携带记录都付 `[...projection.messages]` 复制，所以所有 inbox 类 kind 一起降；`thread-read` 也降一半（它的 receipt inbox 里有 marker removal，走同一支）。第一片单独看：`thread-replied` 0.0518 → 0.0503（不动，如 Tars 所料），`thread-read` 0.0843 → 0.0605。

**曲线是否做直**（ms/record × 真实前缀 2,923 → 11,695，正好 4×）：

| commit | 2,923 | 5,847 | 8,771 | 11,695 | 每翻倍指数 |
| --- | --- | --- | --- | --- | --- |
| `06569e6` | 0.0395 | 0.0439 | 0.0632 | 0.0708 | 0.84 |
| `956011a` | 0.0275 | 0.0333 | 0.0454 | 0.0543 | 0.98 |
| `e38c6be` | 0.0211 | 0.0193 | 0.0207 | **0.0206** | **−0.03（平）** |

⇒ 04 遗留的「记录级超线性」在这个 fixture 上**消失**。残留主项是 `thread-read`（0.0274 × 7,079 = 194 ms，占 262.6 ms 的 74%）；它是否还有**别的**增长轴（每 Thread fact 数 / 每 reader 的 marker 数 / 每 Thread marker 桶）本轮没量——本轮平坦只说明在「记录数」这一维上是线性的。

**语义回归（我自己的臂）**：冻结件差分臂 471/522 对 **mismatches 0**（nonEmptyDelta 6、markerCases 2，计数仍全 0——见下）；合成非零臂三档与 `956011a` 逐字相同（45 未读 → 列 20 → 剩 **25**，四种错答案分离为 20 / 26 / 45 / 45；lifecycle 支 47 → 列 20 → 剩 **27**，分离 29 / 45）⇒ 第二片没碰未读计数语义。

**第一片遗留覆盖空格已补**：冻结件上所有 (member, Thread) 对的派生计数都是 0，原来的「新算法 == 旧算法」只验了 0 == 0。新增合成臂（内存账本、45 条回复 + 第 2 条点名 marker、reader 先 follow）给出**非零且 >20** 的计数，并把四种错答案算出来做分离（截断 20 / 不消费 marker 26 / 不推水位 45 / 读前 45）。同一文件在父提交 `06569e6` 上跑出**完全相同**的数字 ⇒ 我那份旧算法转写与旧实现逐字一致（跨提交保真），不是自说自话。探针：`zz-p0-unread-nonzero.spec.ts`（正本在私有 notes），三条臂：differential / committed-read / lifecycle-marker。

**漂移警告（重要）**：同一探针、同一 commit（`06569e6`）在两个会话分别量到 **520.6 ms**（23:1x）与 **861.2 ms**（23:5x），差 +65%。⇒ 这台机器上任何绝对量只在**同会话交错跑**里可比；跨会话数字（含本表与 §3c/§3d 的旧数）**不可直接对比**。

**本轮没做/不主张**：drain 合并没落（改读的 durable 语义 + Client retry 合同，等 Vera + Human/Reeve 拍口径，并按票面重测 20/100/400 用户可见墙钟）；`test:browser` 没跑（两片只碰 Host 校验器与读派生，无 bundle / slot / Remote 面，按「最窄适用检查」到此为止）。

## 4. Session fold（gauge ④）

命令：

```bash
P0_REAL=/tmp/phase0/real-session-trimmed.jsonl P0_REAL_ALL=/tmp/phase0/real-session.jsonl \
  npx vitest run packages/agent-team/tests/zz-p0-fold.spec.ts
```

真实输入取自本机一个 Member 会话日志（多帧 zstd，需逐帧解；见附录）：**133,596 条事件，其中非流式 19,534 条**（streaming chunk 类 113k 条是 `assistant/chunk` / `text-chunks` / `reasoning-chunks` / `tool-call-chunks`）。

```text
P0_FOLD_REAL      [{"label":"real-nonstreaming","events":19533,"foldMs":7.054,
                    "refoldAfterOneEventMs":[5.515,4.81,4.514,4.407,3.886],
                    "tenRefoldsMs":42.785,"pressureScanMsPerCall":0.194,"boundaries":41},
                   {"label":"real-half","events":9766,"foldMs":1.445,"tenRefoldsMs":18.44},
                   {"label":"real-tenth","events":1953,"foldMs":0.258,"tenRefoldsMs":2.153}]
P0_FOLD_REAL_ALL  {"events":133596,"foldMs":10.331}
P0_FOLD_SYNTHETIC [{"label":"synthetic-20000","events":20000,"foldMs":1.607,"tenRefoldsMs":12.566}]
```

读法：

- 流式 chunk **很便宜**：134k 条事件折一次 10.3 ms，和 19.5k 条非流式事件折一次 7.1 ms 同量级 → `ownEvents()` 的长度里大部分是廉价事件，**别拿总条数当成本**。
- 单条事件级成本 0.08–0.36 µs；**一次 fold = 4–7 ms（真实 2 万条档）**，一个回合连折 10 次 ≈ 43 ms。
- 所以 spec §3.6 说的「每个 tool/result 全量折、连续 tool/result 形成 O(N²)」在**形状上成立、量级上没到秒**：以当前会话规模（2 万非流式事件）计，一个 30 步回合约 0.13 s 的 fold 开销。**它值得做增量，但不该排在 B2 前面。**
- `pressureScanMsPerCall` 0.19 ms/次（19.5k 事件），同样是「形状对、量级小」。合成形状（无 boundary、无真实 payload）会低报到 0.12 ms，**这就是为什么这一轮改用真实会话日志**。

## 5. Client render / Remote 扇出（gauge ⑤）—— 第二轮：真正打开了 Thread 页

命令（jsdom + 现成 `runtimeWithTeam` 组件 harness）：

```bash
npx vitest run packages/client-agent-team/tests/zz-p0-render.client.spec.tsx
```

```text
P0_CLIENT_RENDER2 {"counts":[10,30],"rows":{
 "10":{"threadPageMounted":true,"threadSurfaceRef":"thread:1","threadHeading":true,
   "openCost":{"readThread":1,"view":1,"members":1,"threadHistory":1,"observations":1,"changes":1},
   "perKeystroke":[{"stroke":1,"totalRenders":35,"messageRenders":10,...},{"stroke":2,"totalRenders":29,"messageRenders":10},
                   {"stroke":3,"totalRenders":29,"messageRenders":10}],
   "changeRefresh":{"totalRenders":106,"messageRenders":10,"view":3,"members":5,"threadHistory":1,"observations":1,"changes":8},
   "draftPreserved":true,"textHasFirst":true,"textHasLast":true},
 "30":{"threadPageMounted":true,
   "perKeystroke":[{"stroke":1,"totalRenders":55,"messageRenders":30},{"stroke":2,"totalRenders":49,"messageRenders":30},
                   {"stroke":3,"totalRenders":49,"messageRenders":30}],
   "changeRefresh":{"totalRenders":126,"messageRenders":30,"view":3,"members":5,"threadHistory":1,"observations":1,"changes":8}}}}
```

**这一轮真的进 Thread 页了**：`[data-team-thread="thread:1"]` 已挂载、`Task #1` 标题在、正文同时含首尾消息文本；打开动作走的是 Human 的真实路径（Channel 行 → 消息自带的 `Task #1` 链接 → `readThread`），不再是上一轮那条只画 Channel 时间线的路（上一轮 `readThread: 0`，本轮为 1）。

能用的读数：

- **打字 = 整条时间线全量重渲染。** 每次输入（composer draft 变化）**每条 Message 都重渲染一次**：10 条 → 10 次，30 条 → 30 次，**与消息数 1:1**；整页渲染 29–55 次，且**不产生任何 Remote 调用**（三个 stroke 的 Remote delta 全是 0）。所以 spec §3.5 的「页面级 draft 订阅 + `TeamMessage` 无 memo」在组件级被证实，**代价与 Thread 长度成正比**：30 条消息的 Thread 每敲一个字符就多 30 次 Message 渲染。
- **一次变更事件 ≈ 8 次 `changes` + 5 次 `members` + 3 次 `view` + 各 1 次 `threadHistory`/`threadObservations`，整页渲染 106–126 次。** 注意 `readThread` 为 0：**变更推送不会重读 Thread**，但会把成员/view 反复拉一遍。`changes` 8 次是 long-poll 的重新停车次数（我把两次 publish 压在一个 act 里），不是 8 次独立 RPC —— 量级可信，绝对值受 harness 轮询节奏影响。
- **两次 publish 才换来一次刷新**：harness 的注释也确认客户端 mount 时会先停一个"静默探针"，第一次 publish 被它吃掉 —— 这与 §6 的 phantom refresh 是同一套版本号语义，两条证据互相印证。
- 打开 Thread 本身的扇出是 **6 个 Remote 各 1 次**（readThread / view / members / threadHistory / observations / changes），无重复调用。

**仍未量到的（本轮不再声称已验）：** 30+ Members 的大 fixture（现成 harness 只给 5 个成员行，要改 harness 才能造，本轮没改）；Task-ref resolution 引发的**独立**渲染数（探针里 `resolveTaskRefs` 只调 1 次且混在打开成本里，没做隔离对照）；以及真实浏览器里的合成帧率（属 ③）。

**代码侧已核实（可与上面并读）：** `TeamMessage` 没有 `React.memo`，`TeamChannelPage`/`TeamThreadPage` 在页面级订阅 draft，每个 Message 都订阅全局 Task-ref resolution version —— 与 spec §3.5 一致，现在有组件级数字了。


## 5b. 浏览器感知（gauge ③）—— 真 Web + 12,042 ops 账本

命令（真 Web = Harness 的 `launchWebScaffold` + 真 Chromium；账本由进程内的真 Host 按 Human 路径现灌）：

```bash
cd /home/yu/projects/dsh-agent-team-pr18
npm run build                        # browser lane 装的是 lib/，不是 src/
P0_THREADS=40 P0_PER_THREAD=300 node scripts/zz-p0-web.mjs
```

```text
P0_WEB_SEED    {"operations":12042,"written":12000,"seedMs":72358.8,"seedMsPerWrite":6.03,
                "replaysDuringSeed":0,"replayMsDuringSeed":0}
P0_WEB_CHANNEL {"channelFirstMs":49.7,"channelSettledMs":459.1,
                "remotes":[{"view":0.9ms,"bytes":33181},{"members":0,"bytes":2},{"changes":0,"bytes":17}],
                "replays":[],"replayMs":0}
P0_WEB         {"operations":12042,"clickAt":76197.4,"firstContentMs":762.9,"settledMs":1193.8,
                "mutations":3,"threadArticles":21,
                "remotes":[{"readThread":11ms,"bytes":1172},{"threadHistory":0.2ms,"bytes":11272},
                           {"threadObservations":0.2},{"members":0},{"view":0.9,"bytes":1601},
                           {"changes":0},{"inbox":0.1}],
                "replays":[{"at":76231,"ms":658.7}],"replayMsAfterClick":658.7}
```

| 动作（12,042 ops 账本） | 首个内容可见 | 稳定（末次变更 + 两帧） | 期间的重放 |
| --- | ---: | ---: | --- |
| 打开 Channel | **49.7 ms** | 459 ms | **0 次**（纯读，和根因笔记一致） |
| 打开 Thread | **762.9 ms** | 1,193.8 ms | **1 次 × 658.7 ms** |

读法：

- **打开 Thread 的 762.9 ms 里，659 ms 是那次全量重放；内容本身（`readThread`）11 ms 就返回了。** 顺序是：点 → `readThread` 11 ms 返回（+22 ms）→ 重放在 +34 ms 起跑、658.7 ms → **后续的 `threadHistory` 要等到 +697 ms 才被 Host 处理**，正文才画出来。也就是说 A（把重放延后出响应）让**响应**变快了，但**用户等到正文的时间没变**，因为下一个请求仍然排在重放后面。
- 这一条是浏览器侧对 B2/B3 优先级的直接支撑：**只要一次全量重放还要 ≈0.66 s，任何「让读更快返回」的改动都不会改变体感**；能改变体感的是让重放本身变便宜（瘦记录 / checkpoint 续跑），或者干脆别为这次操作付重放。
- 打开 Channel 完全不付重放（0 次、49.7 ms 可见）：与「channel 是纯读、thread 是写」的既有结论一致，也说明**没有未读时打开 Channel 是快的**。
- Thread 页首屏只画 **21 篇 article**（该 Thread 有 301 条消息，页面上有「加载更早消息」），所以首屏渲染量与 Thread 长度无关；`threadHistory` 响应 11 KB。**这与「时间线要窗口化」的旧假设不一致** —— 首屏本来就是有界的。
- 每次操作只发 1 次 `readThread`、1 次 `threadHistory`，没有重复 Remote；`view` 33 KB 是 Channel 页 20 条 top-level 消息的快照。

**探针文件的限制（别当全量验收）**：这条用的是现灌的 12k 账本（Human 单方消息、无未读），不是冻结件；它回答的是「浏览器端到端里重放占多少」，不是「某条产品路径的验收」。复跑配方与坑写在私有笔记的 ruler 里。

### 5c. 复跑校准：762.9 ms 那个数已被 02 过期（Vera，2026-09-13 23:0x，父提交 `76d0148`）

同 §5b 配方（`P0_THREADS=40 P0_PER_THREAD=300`，真 Web + 真 Chromium）。探针新增 `P0_WEB_ARCHIVE`：种完账本就整份（含 `-wal`）拷出来供离线普查，步骤见 ruler。

```text
P0_WEB_SEED {"operations":12042,"written":12000,"seedMs":75262.9,"seedMsPerWrite":6.27,"replaysDuringSeed":0}
P0_WEB      {"firstContentMs":108.5,"settledMs":520.8,"threadArticles":21,
             "remotes":[{"readThread":2.6ms,"bytes":989},{"threadHistory":0.3ms,"bytes":11272},
                        {"threadObservations":0.2},{"members":0},{"view":3.7,"bytes":1601},
                        {"changes":0},{"inbox":0.1}],
             "replays":[],"replayMsAfterClick":0,"allReplays":1}
```

同一份种子账本的离线普查：12,042 条 = `team/thread-replied` **12,000**（mean 1,340 B）+ `team/message-sent` 40 + initialized / channel-created 各 1；**`team/thread-read` 0 条**。

结论：

- 打开 Thread 首内容 **762.9 → 108.5 ms**、期间重放 **1 × 658.7 ms → 0 次**；变化发生在 **02**（无进展的读不落盘 ⇒ 不提交 ⇒ 不排重放），04 还没落地就已如此。
- §5b 那次 658.7 ms 重放的燃料是 12k 条**消息**记录（16.14 MB operation JSON），**不是读记录** ⇒ 票 04（瘦 `team/thread-read`）对这条曲线命中率 0；04 的收益只能在读记录占 77% 字节的账本上看（见反事实仪器 `slim-ledger.py`）。
- 探针侧两个坑（与产品无关，已修）：Channel 页只渲染**最新一窗** Thread（40 Task 时可见 #21–#40），且行的 **accessible name 被图标 label 前缀** ⇒ `getByRole('button',{name:/^Task #\d+/})` 命中 0、`locator('button',{hasText:/^Task #\d+/})` 命中 20；旧选择器 `/Task #1\b/` 只在 Task 号是个位数时成立。失败时探针会转储页面错误/DOM 片段。

## 6. changes 版本与 phantom refresh（gauge ⑥）

命令：

```bash
npx vitest run packages/agent-team/tests/zz-p0-changes.spec.ts
```

```text
P0_CHANGES {"versionBumpsForOneRead":1,
 "parkedWoke":{"global":false,"thread":false,"presence":false},
 "instantAnswersOf10":10,"medianParkMs":0.01,"phantomRefreshesSecondPass":10}
P0_CHANGES_TIMEOUT {"baseline":3,"afterRead":4,"bumpedByPrivateRead":1,"lateVersion":4}
```

- 一次私有读 → `changeVersion` +1；三类 waiter（scope-less / thread-scoped / presence）**都没被唤醒**（正确）。
- 但 10/10 个客户端带着旧 version 重新轮询时**立即拿到应答**（中位 0.01 ms），于是每个客户端都认为自己该刷新一次；第二次读再来一次。
- 现有测试 `change-scopes.spec.ts` 已经断言了「读不唤醒 waiter + version 前进」，**但没有任何测试覆盖「于是每个客户端会立刻拿到应答」这一步** —— 缺口在这里，Phase 1 第 2 条要有对应测试。

### 6b. 落地后：私有读不再推走任何游标（票 03）

探针源码 [`zz-p0-changes.spec.ts`](zz-p0-changes.spec.ts) 未改，两臂同一支探针、同一冻结件（每臂先 `gunzip -c artifacts/team-perf/frozen-ledger-11695ops.sqlite.gz > /tmp/t03/<臂>.sqlite`）：

```bash
cp .scratch/active/team-perf/materials/phase0/zz-p0-changes.spec.ts packages/agent-team/tests/
BENCH_DB=/tmp/t03/after.sqlite npx vitest run packages/agent-team/tests/zz-p0-changes.spec.ts
rm packages/agent-team/tests/zz-p0-changes.spec.ts   # 跑完即删
```

改前（父提交 `8dabaa3`）与改后（票 03）各一次，同一支探针：

```text
# 8dabaa3（改前；上一轮同探针输出，只留存了关键字段）
P0_CHANGES {"baseline":24,"versionBumpsForOneRead":1,"instantAnswersOf10":10,"medianParkMs":0.023,"phantomRefreshesSecondPass":10}
P0_CHANGES_TIMEOUT 私有读让版本 +1：客户端游标 26 → 超时返回 27

# 票 03（改后；本次复跑原文）
P0_CHANGES {"baseline":11694,"unreadThreads":6,"committedReads":[true,true,true],"readSequences":[11696,11697,11698],"versionBumpsForOneRead":0,"parkedBefore":{"global":true,"thread":true,"presence":true},"parkedWoke":{"global":false,"thread":false,"presence":false},"instantAnswersOf10":0,"medianParkMs":null,"phantomRefreshesSecondPass":0}
P0_CHANGES_TIMEOUT {"baseline":11694,"afterRead":11694,"bumpedByPrivateRead":0,"lateVersion":11694,"timeoutMs":24994}
```

| 判据 | 改前 | 改后 |
| --- | --- | --- |
| 一次私有读的版本推进 | +1 | **0** |
| 10 个 stale 客户端立即应答 | 10/10（中位 0.023 ms） | **0/10** |
| 第二次读的 phantom refresh | 10 | **0** |
| 25 s 超时返回的版本 vs 客户端游标 | 27 vs 26（更大 ⇒ Client 误刷新） | **11694 == 11694** |
| 私有读是否仍然落盘 | `[true,true,true]` | `[true,true,true]`（seq 11696–11698） |
| parked waiter 是否被唤醒 | 三类都不醒 | 三类都不醒 |

- 改后 `baseline: 11694` 就是投影域的定义：最新一条**有 scope** 的记录（记录总数 11,695、head 是私有读），既不是 0 也不是条数——这就是跨重启单调的来源。
- 独立验收方 Vera 在 `8dabaa3` 上用另一支对抗探针量到同一方向的前值：10/10 立即应答、中位 0.1 ms、全局/thread/channel/presence 四个 parked waiter 都不醒、重启 27→24。
- 启动成本复查（Vera 提出）：`apply()` 每条重放记录多一次 `changeScopesOf`。整趟 11,695 条派生墙钟 **1.0–3.3 ms**（其中 4,526 条会推进投影域）；boot 三连 1811/1432/1345 ms vs 父提交 1764/2012/1464 ms，同噪声档。

### 6c. Vera 独立复验：另一支对抗探针的前后同档（票 03 / `76d0148`）

不是 §6b 那支探针。复验探针 [`zz-p0-version.spec.ts`](zz-p0-version.spec.ts) 多四类臂：真实变更的 scope 精确性、跨 scope 游标 fail-safe、跨域（投影号当 presence 游标）游标、重启单调性；同一个文件用 `P0_EXPECT=legacy|scoped` 跑父提交与 03 两档，两档都 **2/2 绿**。

```bash
cp .scratch/active/team-perf/materials/phase0/zz-p0-version.spec.ts packages/agent-team/tests/
P0_EXPECT=legacy P0_DB=/tmp/phase0/frozen.sqlite npx vitest run packages/agent-team/tests/zz-p0-version.spec.ts  # 父提交 8dabaa3
P0_EXPECT=scoped P0_DB=/tmp/phase0/frozen.sqlite npx vitest run packages/agent-team/tests/zz-p0-version.spec.ts  # 03 76d0148
rm packages/agent-team/tests/zz-p0-version.spec.ts   # 跑完即删
```

```text
# 8dabaa3（改前）：一次真落盘的私有读 = Human 打开一个有 3 条未读的 Thread（ops +1、receipt 有）
P0V {"arm":"private-read","readOpsDelta":1,"readCommitted":true,"projectionDelta":1,"presenceDelta":1,"threadDelta":1,
 "parkedWoke":{"global":false,"thread":false,"channel":false,"presence":false},
 "staleImmediateOf10":10,"staleMedianMs":0.1,"stalePresenceImmediateOf10":10}
P0V {"arm":"restart","sampled":{"projection":28},"after":{"projection":24},"projectionRegressed":true,
 "staleImmediateOf10AfterRestart":0,"carriedRestartParked":true,"healedVersion":25}

# 76d0148（改后）：同一支探针、同一冻结件、同一输入
P0V {"arm":"private-read","readOpsDelta":1,"readCommitted":true,"before":{"projection":11694,"presence":24,"thread":11694},
 "after":{"projection":11694,"presence":24,"thread":11694},"projectionDelta":0,"presenceDelta":0,"threadDelta":0,
 "parkedWoke":{"global":false,"thread":false,"channel":false,"presence":false},
 "staleImmediateOf10":0,"stalePresenceImmediateOf10":0}
P0V {"arm":"scope-wake","commitSequence":11697,"woke":{"global":true,"scope":true,"channel":true,"unrelated":false,"presence":false},
 "versions":{"global":11697,"scope":11697,"channel":11697}}
P0V {"arm":"restart","sampled":{"projection":11699},"after":{"projection":11699},"projectionRegressed":false,
 "staleImmediateOf10AfterRestart":0,"carriedRestartParked":true,"healedByOneChange":true,"healedVersion":11700}
```

| 判据（冻结 11,695 ops、真装配） | `8dabaa3`（改前） | `76d0148`（改后） |
| --- | --- | --- |
| 私有读（真落 1 条记录）后的游标推进 | projection/presence/thread 各 **+1** | **0 / 0 / 0** |
| 10 个 stale 客户端立即应答（投影域） | **10/10**（中位 0.1 ms） | **0/10** |
| 10 个 stale 客户端立即应答（presence 域） | **10/10** | **0/10** |
| 四个 parked waiter（global/thread/channel/presence） | 都不醒 | 都不醒 |
| 真实变更（`service.reply`，seq 11697）唤醒谁 | global/thread/channel 醒，unrelated/presence/workspace 不醒 | 同左，且唤醒值 **== 11697**（提交自身的 durable 位置） |
| 跨 scope 游标（投影域 +1000 当 thread 游标） | park 后本 scope 变更 **35.5 ms** 醒 | park 后本 scope 变更 **37.9 ms** 醒（都不永久 park） |
| 跨域游标（投影号当 presence 游标） | 单域，0.1 ms 立即应答 | park 满 25 s 超时返回 presence 域的 **24** ⇒ 可重锚 |
| 重启后的域值 | 28 → **24**（进程计数器；持 28 的客户端被喂回 25，旧 `>` 规则吞掉） | 11699 → **11699**（不动）；stale 0/10；持 11699 的客户端不被重启误唤醒，下一次真实变更以 **11700** 唤醒 |
| 启动（§1 的尺子、同探针、同冻结件复制件） | construct **951.3 ms**（validateRecords 880.8）；assembled on **1615.6** / off **1613.3**；3 轮 on 1371/1260/1400、off 1497/1613/1521 | construct **1050.2 ms**（validateRecords 973.6）；assembled on **1477.0** / off **1744.4**；3 轮 on 1362/1333/1275、off 1512/1459/1525 |

- **结论：通过。** 03 的四条判据（私有读 0 立即应答、真变更仍按 scope 唤醒、投影域单一权威且 = 有 scope 的 ledger 位置、跨重启单调）在我这支独立探针上逐条成立；`fullReplays` 两档都仍是 1，01 的收益没被 replay 里新增的 `changeScopesOf` 吃回去（差值落在 ±20% 噪声内，与 Tars 直接量到的派生成本 1.0–3.3 ms 同量级）。
- 包内回归（Vera 自己跑）：`npx vitest run packages/agent-team packages/tool-agent-team packages/client-agent-team` = **42 passed / 1 skipped 文件、566 passed / 1 skipped 用例**；`npm run typecheck`（含 `generate:typert`）绿且 clone 工作区保持干净 ⇒ Remote 形状未变、生成物无需重出。
- **残留（不计入 03 判据；前后都在，改后严格更少）**：25 s 超时路径返回的是**全局投影位置**，所以一个「本 scope 没变、别处变了」的 thread 订阅者超时时仍会拿到不同版本 ⇒ Client 重新锚定并刷新一次（改前 `untouchedReturned 28 ≠ 游标 27`，改后 `11699 ≠ 11698`，两档 `untouchedRefreshesAnyway: true`）。改前私有读与 presence 边沿都会推游标，因此这类无谓刷新在改后只会更少；要彻底消除需 Host 让「本 scope 未变」的超时返回停靠时的游标（或 Client 忽略纯超时差异）——留 05/06 评估。
- 未跑 `npm run test:browser`：03 没有改 slot / Remote / UI 结构，Client 侧只改了一个比较符（新增用例覆盖重锚），浏览器全链路留给发布前的攒批验收；若要单独立项，用 §5b 的真 Web lane。

## 7. 剩余缺口（别当已验）

| # | 项目 | 状态 | 谁来补 |
| --- | --- | --- | --- |
| ③ | 浏览器感知 | 已做（§5b，真 Web + 12k 账本）：Channel 49.7 ms / Thread 762.9 ms，其中 658.7 ms 是重放；**残留**：未在浏览器里测「有未读的 drain」，用的是现灌账本而非冻结件 | Vera（可选） |
| ⑤ | Client render 计数 | 主体已量（§5）；**残留**：30+ Members 大 fixture 与 Task-ref resolution 的独立渲染数没量（要改 harness 造） | Vera（可选） |
| ① | 启动里 remediation / Member activation 的**独立**计时 | 未拆：现有口径是「账本构造 962 ms + 插件启动合计 1,614–1,669 ms」，中间那段（initialize / remediation / activation）还没分段 | Vera（可选） |
| ①b | 5x / 10x 账本上的启动绝对量 | 未做：前缀拼装会被 schema 唯一性约束挡住，合法放大的成本高于收益；已改用「真实记录前缀」曲线代替（见 §2） | 暂不做 |


## 附录 A：多帧 zstd 会话日志的正确读法

`~/.dsh/sessions/*/session.jsonl.zstd` 是**每行一帧**的多帧文件：按 `0x28B52FFD` 切帧逐帧解压，用 Node `zstdDecompressSync` 单帧解整文件只会拿到 header（本轮踩过，已写成脚本）。原始事件流 133,596 条；非流式事件用类型白名单过滤后剩 19,534 条。

## 附录 B：探针清单（都在隔离 clone，跑完即删）

| 文件 | gauge | 输出前缀 |
| --- | --- | --- |
| `packages/agent-team/tests/zz-p0-boot.spec.ts` | ① 启动分解（域打开 / 排序 / 校验 / apply / 装配） | `P0_BOOT_LEDGER` `P0_BOOT_ASSEMBLED` |
| `packages/agent-team/tests/zz-p0-scale.spec.ts` | ①b 校验规模曲线（真实记录前缀） | `P0_SCALE` |
| `packages/agent-team/tests/zz-p0-drain.spec.ts` | ② read 放大 / 未读 drain（小账本 + 冻结账本单次空读） | `P0_DRAIN` |
| `packages/agent-team/tests/zz-p0-drain-scale.spec.ts` | ② 未读积压 × 冻结 11.7k 账本（same-turn / yield 两模式） | `P0_DRAIN_SCALE` |
| `packages/agent-team/tests/zz-p0-fold.spec.ts` | ④ Session fold（合成 + 真实日志） | `P0_FOLD_*` |
| `packages/agent-team/tests/zz-p0-changes.spec.ts` | ⑥ changes 版本 / phantom refresh | `P0_CHANGES` |
| `packages/agent-team/tests/zz-p0-version.spec.ts`（Vera 复验，两档 `P0_EXPECT=legacy\|scoped`） | ⑥ 游标域：私有读 0 应答 / scope 精确性 / 跨 scope 与跨域 fail-safe / 重启单调 | `P0V` |
| `packages/client-agent-team/tests/zz-p0-render.client.spec.tsx` | ⑤ Thread 页 render / Remote 扇出（第二轮） | `P0_CLIENT_RENDER2` |
| `scripts/zz-p0-web.mjs` + `scripts/zz-p0-web.e2e.ts` | ③ 真 Web 浏览器感知（12k 账本、真 Chromium） | `P0_WEB_SEED` `P0_WEB_CHANNEL` `P0_WEB` |
| `/tmp/phase0/build-prefix.mjs` | 1x/5x/10x 前缀账本生成（本轮判定不用） | `P0_INPUT` |

探针正本另存一份在 Vera 的私有 notes（`obs-scripts/team-perf-phase0/`），隔离 clone 里的副本跑完即删。

## §3h 06 Client 渲染隔离：Vera 独立验收（2026-09-14，最终 tip `805273b`）—— 通过

**尺子**：Vera 自写 `zz-p0-render-isolation.client.spec.tsx`（私有 notes 正本；文件名必须 `*.client.spec.tsx`）。双计数器：`produced` = 页面这次渲染为行产出的元素数；`rendered` = 真实行渲染数（内层是否 `memo` 由真实导出的 `$$typeof` 决定，因此与浏览器付的代价同口径）。**仪器盲区**：`useSyncExternalStore` 的 emit 只重渲染持有 hook 的组件实例，不经 mock 外层 ⇒ 行自订阅的重渲染在计数器上恒 0（这正是「晚到 resolution」臂用 DOM 断言 + `produced==0` 作证据的原因）。

| 场景（10 / 30 条种子） | 父提交 `e38c6be` | 最终 tip `805273b` |
| --- | --- | --- |
| 每次击键 produced/rendered | 10/10、30/30 | **0/0、0/0** |
| Channel 页击键（draft 订阅也下沉） | 10/10 | **0/0** |
| 变更突发真实渲染 | 20/20、60/60 | **0/0、0/0** |
| 突发期页面产出元素（残留观察） | 20、60 | 20、60（memo 全挡掉） |
| 突发期 `view` / `members` | 3 / 5 | **2 / 4**（切片 B 去重） |
| `readThread`（突发/击键） | 0 | 0 |

- 对抗臂（before 绿、after 必须仍绿）：**晚到 Task-ref resolution 仍落进 DOM**（deferred Host lookup 卡住再放行；`produced=0` + `readThread=0` + 标签出现 ⇒ 行自己的订阅没被 memo 冻住）；**thread 回复仍从 composer 拥有的 draft 发出**。
- 父提交上同一文件 2 红（击键判据、Channel 页判据）⇒ 红→绿是真的。
- Tars 探针（committed 版，`memo` 包法）在 tip 上 2/2 绿：keystroke rows 0、burst rows 0、arrival rows 1、`draftAfterSend` 空、焦点保留。
- 门禁（Vera 自跑，隔离 clone）：`npm test` **577 passed / 1 skipped（43 文件）**、`typecheck` RC=0、`lint` **0/0（135 文件 84 规则）**。`npm run build` 由 Tars 报绿。
- **squash 一致性证明**：`git diff e38c6be 805273b` 只碰 5 个 client 路径（TeamChannelPage / TeamComposer / TeamMessage / TeamThreadPage / 探针）⇒ Host 侧与 `e38c6be` 逐字节相同，05 的关键臂无需在 tip 重跑（重跑只会得到同一份证据；且真实账本副本当前是活风险，见 `constraints.md`）。
- **残留（不判失败）**：突发时页面仍为每行产出元素（O(行数) 分配），0 次真实渲染；票面 ⑥ 不做时间线窗口化。

**⚠️ 浏览器 lane 二分（Vera，隔离 clone，2026-09-14 09:0x）—— 收敛到单提交 `76d0148`（03）**

提交链（squash 后只能用 `git rev-list --parents` / `--ancestry-path` 还原）：`423c234`(base) → `2b8b62b`(A) → `d94fa64`(01) → `8dabaa3`(02) → `76d0148`(03) → `06569e6`(04) → `956011a`(05) → `e38c6be`(06 前段)；`805273b` 是 squash（parent 直接是 `423c234`），`git diff e38c6be 805273b` 只有 5 个 client 路径。

| sha | 档位 | `npm run test:browser` |
| --- | --- | --- |
| `423c234` | base | **绿** 61.5 s / EXIT=0 |
| `8dabaa3` | A+01+02 | **绿** 27.5 s / EXIT=0 |
| `76d0148` | +03 | **红** 52.2 s / EXIT=1 |
| `e38c6be` / `805273b` | +04..06 | **红** |

断言恒为 `apps/web/tests/__external-agent-team.e2e.ts:883` 的 `getByRole('button', { name: /Claims · 1/ })` 超时 30 s。绿在前红在后只差 03 一档 ⇒ **元凶 = `76d0148`**（A/01/02/04/05/06 全排除）。

**分割实验（Vera）**：在 `76d0148` 上只把 `packages/client-agent-team/src/client/team-changes.ts` 回退到 `8dabaa3`（1 file changed, 1 insertion, 13 deletions），重建后**仍红** ⇒ 客户端那行（`> version` → `!== version`）不是元凶，**在 Host 侧**；`types/requests-results.ts` 在 03 的差异全是注释 ⇒ 只剩 `index.ts`/`ledger.ts`。**被证伪的方向**：`changeScopesOf('team/claim-created')` 返回 `[{channel},{thread}]`（非空）⇒ claim 提交**会**推进 `projectionVersion`，「不给 thread scope 新版本」不成立；`replay()` 对每条记录调 `apply()` ⇒ 开机重放会重建 `projectionVersion`，「重启后从 0 长」也不成立。

**根因（Tars 插桩实测，与二分独立）**：claim 提交那一刻 thread scope 上**没有任何 waiter** —— 旅程「返回频道 → 再进 Thread」让 Thread 页先卸载（poll abort）；重挂载后新 poll 的**静默探针**（`afterVersion: 0`）拿到的是**提交后**的域值（33）并把它当基线，于是永远 park，`Claims · N` 再不被唤醒。03 之前能过：旧实现用**全局**计数器，park/应答/25 s 超时都不看 scope，claim 之后的 presence 边把计数推着走（33→39→41），超时必然交回一个更大的数 ⇒ 页面 refetch 一次。**用户可见面**：任何「离开某页再回来」的窗口里只要有一次该 scope 的 commit，那页就可能停在旧数据上，直到该 scope 下一次 commit。

**具名残留（Vera 判定：不阻塞，但必须写进票面）**：*a commit landing between the mount read being processed and the first change probe being answered is missed until the next commit in that scope*。判定依据：① 该窗口在 `8dabaa3`（pre-03）就存在 —— 静默探针 `changes({afterVersion: 0})` 与「an immediate wake would double-fetch」的注释都是 03 之前写的，03 只改了比较符 ⇒ 修它是新范围而非修回归；② 窗口宽度是几个 Host job turn；③ 关掉它要每次开 Thread 多一轮 `threadHistory(100)`+`observations`，与性能票方向相反。

## §3i 07 Session fold：Vera 独立 before 尺子（2026-09-14 09:2x，pre-07 树 `805273b`）

**尺子**：`/tmp/p07/fold-ruler.mjs`（正本另存私有 notes）。走**真实读路径**：`sessionQuery.readSession(id)`（副本上，真会话 artifact）拿 `{events, inheritedEventCount}`，再把 `events` 喂给**纯 fold 函数**（`foldContextProjection` / `foldClockBaseline` / `pressure-policy` 私有 `noticeDelivered` 的等价扫描，用真常量与真谓词）。不起装配、不碰 ledger、不隔离 `DSH_HOME`（在 Aster 那条风险面之外）；只读副本。

**输入**：真实会话 `agent-team-0c6df279…`，**18,983 事件**（34.6 MB 序列化），`inheritedEventCount=0`。

| 口径 | 一次 fold | 一回合连折 10 次 |
| --- | --- | --- |
| `foldContextProjection` | **2.39 ms** | **26.4 ms** |
| `foldClockBaseline` | 0.43 ms | 3.7 ms |
| pressure `noticeDelivered` 全扫 | 0.18 ms | 3.2 ms |

**事件数曲线（context fold，中位）**：n=1,898 → **0.13 ms**；n=9,491 → **1.14 ms**；n=18,983 → **2.94 ms** ⇒ 线性，与票面「与事件数基本无关」的目标正好相对。

**语义指纹（before 档，after 必须逐字相同）**：`contextProjection = 9a9aa149e65ee394`、`clockBaseline = cacb7ad86314fb75`、`pressureDelivered = true`。

**A/A 噪声（同树连跑两次，判据必须据此定）**：一次 fold −17%（2.39→1.98 ms）、十次 **26.4→19.8 ms（−25%）**；clock 十次 3.7→2.5；pressure 十次 3.2→1.4；`n=18983` 单折 2.94→1.60 ms。两次**语义指纹逐字相同**（纯函数确定性得到验证）。⇒ 07 的判据只能落在**曲线的形状**上（after 的 n=1,898 与 n=18,983 两档应落在彼此噪声内，而 before 是 0.13 → 2.94 ms 的 12× 展开），不能拿十次总和的细比值下结论。

**两个仪器坑**：① `sessionQuery.listEvents()` 返回的是**索引轮廓**（只有 `sessionId,seq,type,time,surface`，**没有 `data`**）⇒ 直接喂 fold 会 `Cannot read properties of undefined (reading 'turn')`；取完整事件必须用 `readSession()`（顺带给出 `inheritedEventCount`，与生产调用同参）。② 拷贝会话到临时 root 时目录名必须是**真实 workspace slug**（`--home-yu-projects-dsh-agent-team--`），否则 `listArtifacts` 的 header/cwd 一致性校验报 corrupt；且**换目录前要清空 root**，残留目录会被 corpus 扫描连坐。

**流式 chunk 口径（影响票面 before 的读法）**：当前世代会话日志**不写流式 chunk** —— 今天在跑的会话（312 条）、9/12 那档（10,775 条）、迁移后 v3（18,983 条）三份均无 `assistant/chunk`·`text-chunks`·`reasoning-chunks` 记录；而同一会话的 **v0 老档 91,592 条**里有 **72,900 条**是 chunk 遗留记录（v3 迁移输出 18,983 ≈ 非流式 18,692）。票面写的「133,596 事件 / 非流式 19,534」若取自 v0 原始记录数，则 fold 输入比 live 大 ~7 倍；本尺子以**真实读路径**那一档为准，另报「含 chunk 的原始流」档。


