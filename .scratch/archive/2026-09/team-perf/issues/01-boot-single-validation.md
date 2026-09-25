# 01 — 启动只做一次全量记录级校验

**What to build:** 一次启动只付一次「记录级全量校验」：账本构造期已经得到的校验结论被 invariant 挂载复用，不再重复重放；启动失败仍然是 fail-closed（构造期发现分歧就失败，而不是延后到第一次提交）。
**Blocked by:** None — can start immediately
**Status:** complete — 实施 `d94fa64`（Tars）；独立验收 Vera 2026-09-13，证据见 `materials/phase0/findings.md` §1b。

- [x] 冻结 11,695 ops 账本上，`fullReplays` 从 2 → 1，启动时间按 §1 的三轮对照下降 ≈0.4–0.8 s（同机、同输入、多次采样比绝对量，不看小比例）— 2/2/2 → 1/1/1；boot 2,488/2,384/2,175 → 1,595/1,476/1,635 ms（−893/−908/−540 ms）
- [x] 不允许把校验降级：不得改成「只校验最后一条」、不得改成「对 live projection 自查」、不得减少独立 scratch 重放 — 复用的就是构造期那次独立 scratch 重放；head 三元组一变即回落全量 `validate()`（对抗探针 commit-first / one-shot 各 1 次全量）
- [x] fail-closed 回归：账本里注入一条非法记录时启动必须失败 — 启动前改坏一条 → 启动失败 `expected sequence 11695, found 999999`
- [x] 运行时语义不变：invariant 仍对每次提交做延后合并重放（A 已落地），本票只去掉启动那次重复 — 提交驱动的延后重放与 latch 一字未改（对抗探针 out-of-band：延后重放仍读表、仍抛、下一次提交仍在调用方栈抛）
- [x] 测量口径写回 `materials/phase0/findings.md`（前面的原始输出可对照）— §1b
