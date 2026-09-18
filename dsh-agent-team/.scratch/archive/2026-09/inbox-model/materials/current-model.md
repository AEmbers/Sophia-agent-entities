# 今天 human 与 agent 的 inbox：哪里同一套，哪里不是

取证时间 2026-09-15，工作树 `master`（`121a0a8`）。行号会随代码漂移，函数名与账本序列号是稳定锚点。

## 结论

**判定层已经是一套；投递层与表面层不是。** 同一个未读内核按 `memberId` 服务所有成员（human 与 agent 用同一份 `inbox()` 投影、同一份 `isUnreadFact()` 判定），但「谁会被主动叫醒」「在 UI 上能看到哪一片」两条通路今天只对 agent 完整。这就是「看起来像两个模型」的来源。

## 一、同一个判定内核

`AgentTeamLedger.isUnreadFact(fact, memberId, threadRef, attention, directKeys, activityKeys)`（`packages/agent-team/src/ledger.ts`）是「这条 fact 对我算不算未读」的唯一权威：

```
unread(fact, me) =  mentionMarker(fact, me)          // 正文 @ 我（#41 之后由文本解析产生）
                 ∨  activityMarker(fact, me)          // 与我相关的任务/认领状态变化
                 ∨  (我 follow 这条 Thread
                     ∧ fact.sequence ≥ attention.startSequence
                     ∧ fact.sequence > attention.readThroughSequence
                     ∧ fact.sender ≠ me)
```

推论：

- **未读源有三类**：follow（普通未读）、mention 标记、activity 标记。三类都不需要「同时」满足。
- **mention 不要求 follow**：被 @ 一次就有一条 direct marker，读一次即消费（`readThread` 的 inbox delta 负责移除）。
- **我自己发的 fact 对我永远不是普通未读**（`visibleToFollower`）。
- **未读是 per-member 私有的**：watermark 存在 member 自己的 Attention 行上，不共享。

`inbox(actor, request)` 也是同一个函数：`@Remote('inbox')`（Human）走 `agentTeamHumanActor()`，`inboxForAgent(agent, …)` 走 `memberActor(agent)`，两者调用的是同一段投影代码（`packages/agent-team/src/index.ts`）。

## 二、投递与表面：五个具体差异

| 维度 | Agent | Human |
| --- | --- | --- |
| 订阅如何产生 | `team_claim` 认领即 follow；在**新 Thread** 里被 @ 即 follow；被 Human 邀请进已有 Thread 即 follow；也可显式 follow | **只有一种自动情形**：自己发起顶层消息时对自己新建的 Thread follow（`sendMessage` 里 `startAttention(request.actor.memberId, …)`）。**回复不会 follow**，被 @ 也不会 |
| 订阅控制 | 有工具（read 即 follow、claim 即 follow、可 unfollow；持有 active Claim 时禁止 unfollow） | Host 有 `@Remote('changeAttention')`，但 **Client 全仓 0 处调用**（`grep changeAttention packages/client-agent-team/src` 无命中）→ UI 里没有入口，只能建 Thread 时被动 follow |
| 被叫醒 | Host 主动推送：`notifyMember()` → `notificationFacts()`（**全量三源 inbox**）→ 以 `Team Inbox has unread work.` 形式 steer / followup 进 agent 的 inbox | 无推送。只有 Web Client 在 `changes()` 唤醒时重新拉取 |
| 拉取切片 | `team_inbox`：三源全量 | Web「提到我」把 `directOnly: true` 写死（`TeamInboxPage`、`TeamWorkspaceBrowser` 徽标同此），**只有 mention 一源**；follow 未读在 Human 侧没有出口 |
| 写入门禁 | 该 Thread 有未读时写入被 `unread_required` 挡下 | 同一门禁（`reply` 里同样走 `deferredThreadWrite`），Client 也已处理该结果。这一条两边一致 |

账本实证（`~/.dsh/storages/agent_team.sqlite`）：Human 发起 Roadmap task #40 的顶层消息那次提交（sequence 12769）的 inbox delta 是

```json
"attention": {"set": [{"memberId": "member:human",
  "threadRef": "thread:65e0e365…", "startSequence": 12769, "readThroughSequence": 12768}], "removed": []}
```

即 Human 确实拥有 Attention 行，且**建 Thread 时自动 follow 自己**；随后同一 Thread 的回复（12789）不再改动 attention。这证明「Human 不会 follow」这个说法只对「回复/被 @"成立，对「发起」不成立——两边差异是**触发条件不同**，不是模型有无。

## 三、根因：Attention 同时承担两件事

`follow`（Attention 行）今天同时是：

1. **参与身份** —— 决定 @ 是否一次投递；非 follower 被 Human @ 会走 `confirmationToken` 邀请流程，确认后 `startAttention()` 才让这次邀请生效（`reply` 中 `unfollowedAgents` 分支）。
2. **通知级别** —— 决定「这条 Thread 的每条 fact 是否都算我的未读」（`isUnreadFact` 的 ordinary 分支）。

Human 想要的「follow 这条 Thread，但只在被 @ 时提醒我」，等价于要 (1) 为真、(2) 为假。今天的类型里没有能表达这个状态的位置：Attention 有 `startSequence/readThroughSequence`，没有级别字段；不 follow 就只有一次性的 mention 标记，连「我在这条 Thread 里」都不算。**这是要新增的那一个概念，不是推翻已有模型。**

## 四、与 task #40 需求的差距

#40 的原文（message:7ec10775，sequence 12769；补充 12789）：

> mentions of me 应该作为 inbox，而不是只是「提到我」才会出现。也可以是最近活跃的 threads，就放在那里，上限 10 个，有 mention 则依然有数字提示，没有的话依据任务状态以及上限、时间排序都是降序排列且都可以按照最新活跃消息，依然是全局的
> 应该至少有 human 以及一个 agent 的参加，如果只是空 thread 那么不需要纳入

对照今天的实现：

- **「最近活跃的 Thread」今天进不了 inbox**：`inbox()` 的入选条件是「有未读」（`unread.length === 0 → continue`），没有未读就整条不出现。**但「最新事实时刻」这个字段已经有了**：`AgentTeamViewItem.lastActivityAt`（Channel view 的每条顶层消息上，取自该 Thread 最后一条 fact 的 `occurredAt`，`ledger.ts` 的 view 构造处），Client 目前 0 处引用（Iris 取证，2026-09-15 已复核）。注意别与 `AgentTeamInboxItem.newestOccurredAt` 混用——后者注释写明是「newest **unread** fact 的时刻」，不是最后活跃时刻。所以这一条缺的不是时间字段，而是**不依赖未读的入选规则**。
- **「至少 human + 一个 agent 参与」没有判据**：账本里没有 per-Thread 参与者索引（`observationsByThread` 只记 follow/unfollow 观测，不是发言者集合）。
- **「全局」与 Agent 不同**：Human 跨 Workspace（Client 逐 Workspace fan-out 再合并），Agent 天然单 Workspace。这条差异是成员归属决定的，建议保留。
