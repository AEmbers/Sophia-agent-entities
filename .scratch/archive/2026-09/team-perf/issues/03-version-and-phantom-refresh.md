# 03 — durable version 与 phantom refresh 语义

**What to build:** 区分「公共投影真的变了」与「某个 Member 的私有读进度变了」两种版本；一次私有读不得让所有 parked 客户端立刻拿到应答并各自刷新一次。
**Blocked by:** 02（同一处语义，先有 no-op 合同再改版本口径）
**Status:** complete — 实施 `76d0148`（Tars）；独立验收 Vera 2026-09-13，证据见 `materials/phase0/findings.md` §6b/§6c 与下方「验收」段。

- [x] 补上实测缺口：N 个 parked 客户端 → 一次私有读 → **0 个**立即应答（冻结账本：10/10 立即应答 → **0/10**；真实装配 `member-lifecycle.spec.ts` 用例「10 parked + 一次真落盘的 `readThreadForAgent`」同样 0 应答）
- [x] 真正的成员/线程变更仍能唤醒对应 scope 的 waiter；presence 版本与 projection 版本互不误伤（`reply` 落地时 parked 的全局/thread 客户端拿到 `receipt.sequence`；presence 边沿唤醒持有投影游标的 presence waiter，而投影游标不动）
- [x] 投影版本仍由 ledger 单一权威派生：= 最新一条「有 scope」记录的 `sequence`（`projectionSequence()`，随重放重建、跨重启单调）。presence 域的 0 起进程内 epoch 是**刻意**的第二套计数，只服务无 durable 事实的 runtime 边沿，文档明说其只在单次服务生命期内有效，跨域/跨重启游标由 Client 的「有差异即重新锚定」兜底。
- [x] 用 §6 探针在冻结账本上复跑，给出前后绝对量（见 `materials/phase0/findings.md` §6b）

## 验收（Vera，2026-09-13 晚，冻结账本 11,695 ops，独立探针 `zz-p0-version.spec.ts`）

- 同一支探针在父提交 `8dabaa3` 与 `76d0148` 各跑一档（`P0_EXPECT=legacy|scoped`），两档 2/2 绿；原始输出与逐项对照表见 findings §6c。
- 判据逐条成立：**一次真落盘的私有读**（Human 打开有 3 条未读的 Thread，ops +1、有 receipt）→ 投影/presence/thread 游标推进 **+1 → 0**、10 个 stale 客户端立即应答 **10/10（中位 0.1 ms）→ 0/10**、presence 域同样 10/10 → 0/10、四个 parked waiter 前后都不醒。
- 真变更不被误伤：`service.reply` 落地（seq 11697）唤醒 global/thread/channel，unrelated thread、presence、workspace 不醒，且唤醒值 **== 11697**（提交自身的 durable 位置）。
- fail-safe 两条（我上一轮提出）：跨 scope 游标（投影域 +1000 当 thread 游标）在本 scope 变更后 37.9 ms 被唤醒、不永久 park；跨域游标（投影号当 presence 游标）满 25 s 超时拿回 presence 域的 24，Client 的「有差异即重新锚定」据此可重锚。
- 重启单调性：域值 11699 → 11699（不动），持有该游标的客户端不被重启误唤醒，下一次真实变更以 11700 唤醒。
- 启动没被 replay 里新增的 `changeScopesOf` 吃回去：construct 951.3 → 1050.2 ms、assembled on 1615.6 → 1477.0 ms、3 轮 on 均值 1344 → 1323 ms、`fullReplays` 两档都 1（差值在 ±20% 噪声内）。
- 回归：`npx vitest run packages/agent-team packages/tool-agent-team packages/client-agent-team` = 42 passed / 1 skipped 文件、**566 passed / 1 skipped** 用例；`npm run typecheck`（含 `generate:typert`）绿且 clone 干净 ⇒ Remote 形状未变、生成物无需重出。
- 残留（不计入本票判据，前后都在且改后更少）：25 s 超时路径返回全局投影位置，所以「本 scope 没变、别处变了」的 thread 订阅者仍会拿到不同版本 ⇒ 一次无谓刷新（改前 28≠27、改后 11699≠11698）；归 05/06 评估。`npm run test:browser` 未跑（无 slot/Remote/UI 结构变更，Client 只改一个比较符且有用例覆盖），留给发布前攒批验收。
