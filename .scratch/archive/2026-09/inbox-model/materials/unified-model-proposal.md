# 统一 inbox 模型：方案草案与待拍板决策点

写给 Human 讨论用。事实依据见 [`current-model.md`](current-model.md)。本文件里的「推荐」都带默认路径——不回就按推荐走。

## 零、Human 已给的方向（2026-09-15 14:42，message:12904）

- **入口**：「动态」= 替换掉现在「提到我」的那个入口；**默认收 human follow 的 Thread 的全部活动消息**，不只是 mention。配置项（全收 / 仅 mention）是后续阶段的事。
- **三轮**：① 收敛 inbox 模型（本工作项，作为 Iris 侧设计与 Client UI 的输入）→ ② Iris 侧采用：新的 Thread 入口显示 **human follow 的、全部活动**的未读数（不是被配置的 mention 口径）→ ③ 改造「提到我」：初版只做「所有 follow」，去掉「仅 mention 才收到」的准入。
- **follow 定义（Human 提议，待 Momo 回应）**：human **发起**或**回复**过才算 follow；其他 agent 发起、human 只打开没回复的，不算。
- **命名待定**：`动态` / `活动` / 其他。**Momo 建议「收件箱」（Inbox）**，备选「动态」，「活动」不建议——理由：它是「需要我」的队列而非全量 feed，且与 agent 侧 `team_inbox` 同词（回帖 message:7ea037e8）。

节五的决策点下面标注了哪些已被这条覆盖。

## 一、目标模型（一句话）

**一个成员（human 或 agent）对一条 Thread 的收件行为，由一个「订阅」对象决定：`状态`（在不在） + `级别`（全收 / 只收 mention）。** 判定内核不变，增加的那一维恰好是今天缺的。

```
订阅 = not-following            → 被 @ 时一次性提醒（今天的 direct marker，mention 不要求 follow）
     | following + level=all    → 该 Thread 每条 fact 都算我的未读（= 今天的 Attention）
     | following + level=mentions → 仍是参与者（@ 一次投递、被邀请语义、认领后的约束都保留），
                                    但只有 mention / activity 标记计入未读
```

关键点：**「参与身份」与「通知级别」拆开**。今天 `follow` 同时是这两件事（见 current-model 第三节），所以「follow 但只提醒 mention」无处表达。

## 二、Human = member + 管理员：已经在账本里

- `member:human` 就是账本里的一个 member（`team/initialized` 写入 `humanMemberId`），Attention / watermark / inbox 全部按 member 走；
- 管理动作是 human-only Remote：建频道、改频道、归档频道、加成员、改成员、归档成员、提升 Thread 为 Task、邀请 agent 进已有 Thread（`confirmationToken`）等。

需要留意的一点：这些授权今天写成 `actor.kind === 'human'` 的硬编码（host + tool 两包共 77 处引用、ledger 内 16 处 `assertHumanActor`）。**「以后给 agent 管理员身份」这条延伸，成本就落在这里**——要先把「管理员」从 actor 种类改成一个成员能力位。本次不必做，但建议在 `docs/architecture.md` 里把「admin 是能力，不是身份种类」写成方向，免得以后当成重构惊喜。

## 三、要改什么（按层）

### Host（`packages/agent-team`）

1. `AgentTeamThreadAttention` 增加级别位（默认全收）。判定内核 `isUnreadFact` 的 ordinary 分支加一个条件：级别为「只收 mention」时不计普通未读；mention / activity 标记不受影响。
2. 回放兼容是硬约束：账本操作严格校验（`validateInboxDelta` + 逐操作投影比对），新字段必须**缺省即旧语义**，并且只在偏离默认时写入（expand–contract），否则历史 op 回放会失败。
3. 订阅写入口：Remote 与 agent 工具各加一个设置级别的参数；级别人为「全收 / 只收 mention」两值，先不做三值（不做「静音」——静音可以由 unfollow 表达）。
4. Inbox 投影增强（同时服务 #40）：
   - Human 侧不再只吃 `directOnly` 切片：同一 `inbox()` 返回三源，行上分别带 `unreadCount` / `directCount` / 最近活跃时刻；
   - **「最新活跃时刻」不用新造字段**：`AgentTeamViewItem.lastActivityAt` 已存在（Channel view 的顶层消息上，取自该 Thread 最后一条 fact），Iris 已复核对 Client 0 引用；`AgentTeamInboxItem.newestOccurredAt` 是「最新**未读** fact」，别混用。真正缺的两件事是：**不依赖未读的入选规则**（今天 `unread.length === 0` 直接不进 inbox）与**参与判据**（该 Thread 是否至少有 human + 一个 agent 发言，只有账本能权威回答）；
   - 排序键由 Host 给（任务状态优先级 → 最新活跃倒序），Client 只渲染，不自建平行投影（架构护栏：Team facts 权威只在 Host projection）。
5. Typert 类型随 Remote 声明重新生成（不手改 `lib/typert.*`）。

### Client（`packages/client-agent-team`）

6. 「提到我」升级为**统一 Inbox，两片**：
   - **需要我**：未读行（mention 带数字徽标，activity / follow 未读同行不同音量）；
   - **最近活跃**：无未读也可出现，上限 10，全局（跨 Workspace 合并），按 Host 给的顺序。
7. Thread 内新增订阅控件（follow / unfollow + 级别切换），复用现有菜单原语；`changeAttention` 今天已有 Remote，Client 只差调用与状态回填。
8. 徽标语义先定死再实现（见决策点 4）。Iris 那边 thread bubble 的未读徽标等这个结论，她已按 Human 指示暂停。

### 契约与文档

9. agent 侧工具描述与 preset 契约句（`shipping.spec.ts` 锁句子）、`docs/architecture.md` / `frontend-design.md` / `team-collaboration.md` 中英双份、CHANGELOG。

## 四、非目标

- 不改 `../deepseek-harness`；不引入跨 Workspace 账本（Human 的「全局」仍由 Client 逐 Workspace fan-out 合并）。
- 不改 mention 的一次投递语义：级别只影响普通未读，不影响「被 @ 是否直接送达」。
- 不隐藏 Thread 内的消息（2026-09-13 已定：Thread 内不过滤、600 字 clamp 保留）。
- 不做 per-message 通知偏好、不做「静音 N 小时」这类时效设置。

## 五、待 Human 拍板（每条带默认路径）

1. **「动态」指哪里？** ✅ 已答（12904）：替换「提到我」的入口。命名待定，Momo 建议见节零与回帖。
2. **级别的粒度** ⏳ 后置：本轮不做配置，默认全收；级别字段是否随第 3 步先建（避免二次改 Host 契约）待定。
3. **Human 参与是否自动 follow** ✅ 方向已给：发起或回复即 follow；仅打开不算。**待定的是 agent 侧是否同样自动 follow**——Momo 建议不跟随（会造成持续唤醒噪声），模型同一套、默认值按成员类型分开。
4. **徽标数字语义** ⏳ 随第 3 步定：准入从「仅 mention」变成「全部未读」后，徽标应数「需要我」总量，mention 数在行内单列。
5. **「最近活跃」数据源** ⏳ 后置：#40 的「≤10 条最近活跃」是浏览列表，与收件箱（未读队列）是两件事；时间字段已有（`AgentTeamViewItem.lastActivityAt`），缺的是非未读入选与参与判据，建议第 3 步之后单独排。
6. **任务状态排序** ⏳ 随 5 一起定。
7. **实施编排** ⏳ 模型冻结后：Momo 出 spec，再谈实现归属。

## 六、第 3 步的顺带清理

准入从 `directOnly` 切片改为全量未读后，Human 侧「仅 mention」切片就没有调用方了。按仓库护栏（不留无人读的兼容层），第 3 步应当**删掉该请求标志与相关分支**，而不是留着当兼容；同时它会 **supersede 2026-09-13 的决定**「Human Inbox = direct-only」，需在 `docs/` 里写明 supersession，避免两份口径并存。

