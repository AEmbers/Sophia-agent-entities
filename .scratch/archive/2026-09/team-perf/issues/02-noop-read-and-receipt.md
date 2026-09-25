# 02 — 无进展的读不落盘（B1）+ receipt / 幂等合同

**What to build:** 零未读且水位没有推进的 Thread 读，不追加 durable operation、不推进全局 change version、不触发批后重放；同时把「读回执」和重试幂等语义定下来，作为后续所有读路径改动的地基。
**Blocked by:** None — can start immediately（04 依赖本票的合同）
**Status:** complete — 实施 `8dabaa3`（Tars）；独立验收 Vera 2026-09-13，证据见 `materials/phase0/findings.md` §3b 与下方「验收」段。

- [x] 冻结账本上同一个空读：operations 不变（现测 11,695 → 11,696）、changeVersion 不动、批后重放为 0（现测 1 次 ≈777 ms）
- [x] 有未读进展的读照旧落一次盘，崩溃/重启后未读进度不丢
- [x] 同一 requestId 重试不产生第二条记录；重试一个「没有落盘」的读仍返回完整结果（receipt 语义明确）
- [x] Host 测试覆盖「无进展读 → 无记录、无 version、无重放」
- [x] 语义边界写进 `spec.md`（哪些读算无进展）后再动 schema

## 落地记录（Tars）

- `readThread` 在 `isEmptyInboxDelta(prepared.inbox)` 时直接返回 `{committed:false}`：不 put、不 apply、不 emit、不触发批后重放。
- 读路径返回 `AgentTeamThreadReadOutcome`；committed 支类型上必须带 receipt；`AgentTeamThreadReadResult.receipt` 变可选。两条分支共用 `readPicture()` 派生。
- 工具层 `team_thread read` 在未确认未读时渲染 `Read — no unread updates …`。
- 测试：空读不落盘/不发事件/无 receipt 且画面完整；有进展读落盘并在重启后水位不丢；drain 按 remainingUnreadCount 收敛后停止写入（含同 requestId 重试不产生第二条记录）。空读分支拆掉后 3 条用例变红。

## 验收（Vera，2026-09-13 晚，冻结账本 11,695 ops）

同探针在父提交 `d94fa64` 与 `8dabaa3` 相邻两轮，真 sqlite + 真服务 + 真 invariant：

- 已读完的读：operations 11,695→11,696 / `changeVersion` +1 / 1 个 `committed` 事件 / 延后重放 834.3 ms ——变成—— **0 / 0 / 0 / 0 ms，无 receipt，读调用 1.0 ms**。
- 有未读的读（成员留一条未读后 Human 读）：两边都照旧落盘（11,698→11,697）、版本 +1、重放 910.4→814.0 ms；`remainingUnreadCount` 归零。
- 同 requestId 重试：同一 receipt sequence、+0 条记录、0 事件。
- 真重启（同 sqlite 文件重开装配）后再读：改前**又写一条**（11,699），改后**不写**、水位不丢。
- 离线复算：7,079 条读里 2,607 条（36.8%）为空 delta = 8.1 MB = 账本 JSON 的 21.2%（Human 的读 61.6% 为空）。
- 回归：`packages/agent-team` + `packages/tool-agent-team` 29 文件 / 433 用例通过、1 跳过。

原始输出：`materials/phase0/findings.md` §3b。
