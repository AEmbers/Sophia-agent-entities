# 后续可能有帮助的

未实施。human 另开 session 调研。默认已锁 B1；B2/B3 未立项。

## B1 — 空读不算提交（已锁定，未做）

inbox delta 空且水位没动 → 不算提交，当场从活投影返回。Remote 形状不变。

效果：已读完的打开、空转 refresh 不再涨账本。行数增速从「每次看」变成「真读到新东西」。

压不掉：A 之后那笔 ~0.8 s 全量重放（那是已有记录的 CPU，B1 只降新行数）。

代价：这类 no-op 不再有 durable idempotency。Client 给 drain 本来就会换新 requestId；history 也是现算的。

验收草案：已读完打开不新增 `team/thread-read`；真有未读仍写并推进水位；`readThread` 返回形状不变；invariant 变异仍能红；不改 Inbox/mention、不拆 view Remote。

交付：等 human 指定 hoplite 或只发 issue。不要重开 #21。

## B2 — 瘦记录（未立项，压残余重放的正道）

仍提交，记录只留 inbox delta + `readThroughSequence`。展示从活投影现算，和 `threadHistory` 一样。老的胖记录靠 normalize 继续重放，不回写。

这才把平均 4 KB 打下去，并缩短 A 之后那次全量重放的 CPU。

不要把 invariant 改成比活投影或增量——独立性正是这张网的价值（见 `constraints.md`）。

## B3 — 快照 + 截断（重，不建议这轮）

给「当前水位」一个不依赖历史 thread-read 的落地点（投影里其实已有），再截断旧读记录。必须证明截断后独立重放仍能红。设计量归 Reeve。

不能在没替代落地点时删历史 `thread-read`——水位就是从它们推的。

## 调研时值得带着的问题

- 启动重放跑两遍（构造 `replay()` 含 `validateRecords`，invariant 挂载再全量一次）。A 之后运行时已延后；启动是否仍必须付两次？
- `thread-read` 把整批 facts 存进 operation，是为了 requestId 重放当时画面。B1 放弃空读的冻画面之后，有未读的那次还要不要冻？
- 23 天 77% 体积来自「看」。产品要不要「打开 thread 就算已读」继续写账本，还是水位进更小的权威？
- 旧 UI loading 工作项没有规模 fixture。本目录的冻结账本（见 `vera-replay-ruler.md`）应成为以后性能 PR 的尺子，不要再靠合成 S1。
