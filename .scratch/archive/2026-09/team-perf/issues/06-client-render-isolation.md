# 06 — Client 局部渲染隔离

**What to build:** draft 订阅下沉到 composer、稳定 callback、`TeamMessage` memo、纯计算 memo、workspace-scope read cache —— 让一次输入只渲染真正变化的组件，而不是整条时间线。
**Blocked by:** None — can start immediately（与 Host 侧并行，互不阻塞）
**Status:** complete — Tars 2026-09-13 23:5x 起，2026-09-14 00:2x 收口；**Vera 在最终 tip `805273b` 上独立验收通过（2026-09-14 09:0x）**：她的自写探针 7/7 绿（同一文件在父提交 `e38c6be` 上 2 红），Tars 探针 2/2 绿，`npm test` 577 passed / 1 skipped、typecheck RC=0、lint 0/0；`git diff e38c6be 805273b` 证明 Host 侧逐字节未动 ⇒ 05 的关键臂无需在 tip 重跑。

- [x] Thread 页每次输入的 Message 渲染数从「= 消息数」降到有界（前测：10 条→10 次、30 条→30 次，与消息数 1:1）——**后测 0 / 0**（同一探针同一会话，见下）。draft 订阅从 `TeamThreadPage`/`TeamChannelPage` 下沉进 `TeamComposer`（props 由 `{recipients, draft, onDraftChange, onRecipientsChange}` 换成 `{drafts, draftKey, onEdit?}`，写入归 composer）；两个页面删除页面级 `useSyncExternalStore`，改在 send 时 `drafts.getSnapshot(draftKey)` 命令式读；页面 `onEdit` 用 `useCallback` + bail-out setter（`setX(current => current === undefined ? current : undefined)`）清确认/requestId/statusMessage 而不重渲染。
- [x] 一次变更事件的 Remote 扇出下降或给出不下降的理由（前测：8 次 `changes` + 5 次 `members` + 3 次 `view` + 各 1 次 threadHistory/observations）——**该页自己的 roster 读从 2 轮降到 1 轮**（同探针同口径，见下表「切片 B」）。机制：一次 Host 变更会唤醒该页匹配的每个 scope（`workspace` + `presence` 两个 poll 各自送达**同一个变更 version**），两边的诉求都是同一份 members+view，因此按 version 去重：已被某轮覆盖的 version 不再取数；轮次进行中到来的**更新** version 不丢，改为跑一轮补齐。`members`/`view` 的**全运行时**计数下降幅度有限，因为同一 runtime 里的侧栏面板（`TeamAgentsPanel`/`TeamChannelsPanel`）也订阅同样的 scope 并各拉一次，那部分不属于本页也不在本票范围；故本票的判据落在**可归因到本页的** `pageRounds`（带 `threadRef` 的 `loadChannels` 次数）。
- [x] 变更推送**不重读 Thread** 这条现状保持不变（现测 `readThread` 为 0）——**前后都是 0**（`readThread` 在输入档与变更档的 delta 全 0）。
- [x] draft 不丢、焦点不跳、键盘操作不变（现有 composer/无障碍用例保持绿）——`packages/client-agent-team/tests` **15 文件 134 用例全绿**（含 drafts/mention/键盘/无障碍既有用例）；探针另测 draft 在变更突发后仍在、焦点仍在 textarea、commit 后 draft 被消费为空。
- [x] 用同一组件探针给出前后绝对量；`TeamMessage` 仍订阅 Task-ref resolution 的那条路径要一并说明——新探针 `packages/client-agent-team/tests/render-isolation.client.spec.tsx`（永久回归臂），前后量见下。**Task-ref 路径说明**：`TeamMessage` 内部的 `useResolvedTaskRefVersion()`（`useSyncExternalStore` 订阅 task-ref store）是**组件内**的 hook，`memo` 只跳过「props 未变的父渲染」，不会卸载或跳过组件自身的订阅；一旦 Host 的 `resolveTaskRefs` 回填，store 版本变化会照样触发该行重渲染并把解析结果落进 DOM。真正的风险不在订阅被跳过，而在**调用方每次渲染新建 prop**（`openRef`/`lookupTaskRefs`/`mentionNames`）导致 memo 永不命中——这也是下面那条「隐藏依赖」的由来。
- [ ] 范围说明：真浏览器里 Thread 首屏本来就只画 ≈21 篇 article（有「加载更早消息」），所以**本票不做时间线窗口化**，只做 memo / 订阅下沉 / 稳定 callback ——这一格是**范围声明，不是待办**，保持未勾以免与未完成项混淆（同 04 的 ⑥ 处理方式）。

## 前后绝对量（同一探针、同一会话）

探针口径 = **React 实际渲染的行数**（`vi.mock` 包装真 `TeamMessage` 且包装器自己也 `memo()`，与页面交给真组件的 memo 边界一致）。改变口径的坑：只用 `vi.mock` 包一层不加 `memo`，计数会变成「页面请求渲染的行数」，`memo` 生效后仍虚报 count。

| 口径 | before | after |
| --- | --- | --- |
| 一次输入 → 行渲染（10 / 30 条） | 10 / 30 | **0 / 0** |
| 一次变更事件 → 行渲染（10 / 30 条） | 20 / 60（两次 publish 口径） | **0 / 0** |
| 一次 committed 到达 → 行渲染（10 / 30 条） | 未测 | **1 / 1**（新消息自己那一行） |
| 一次变更事件 → `readThread` | 0 | **0** |
| 一次变更事件 → 本页 `pageRounds`（切片 A 状态 = 切片 B 的 before） | **2** | **1** |
| 一次变更事件 → 全运行时 `view` / `members` | 3 / 5 | 2 / 4（差额是侧栏面板，不在本页） |
| 一次变更事件 → `changes` | 4–8（long-poll 重新停车次数，非独立 RPC） | 4（同口径 after 档；本票未动变更流） |

**切片 B 的判别力**（同一探针，把 `TeamThreadPage.tsx` 逐字节还原到切片 A 再跑）：before `pageRounds 2 / view 3 / members 5` 且断言 `pageRounds <= 1` **红**；after `1 / 2 / 4` **绿**。即该臂确实区分「按 version 去重」与「每个 scope 各拉一次」。

**一个隐藏依赖（只包 `memo` 不够）**：变更事件会重取 members ⇒ `members` 换新数组 ⇒ `mentionHandlesMap`（`useMemo([members])`）换新 identity。若 mention 名缓存以 handles Map 的 **identity** 为 key，则每行的 `mentionNames` 都会是新数组 ⇒ `memo` 全部失效（实测变更档仍是 20/60）。用 `PROP_DIFF` 插桩确认「突发中唯一变化的 prop 就是 `mentionNames`」，改成**按解析出的名字内容比较**后突发档 props 零变化。所以 `stableMentionNames`（`TeamThreadPage.tsx` 模块级 `WeakMap`，按 fact 自带的 mentions 数组缓存、内容相同则复用同一数组）是 `memo` 的承重件，不是可选优化。

**行渲染为 0 不等于「页面不渲染」**：变更档页面仍因 members/view 落地而重渲染，只是每一行的 props 未变、被 `memo` 跳过——这正是本票要的隔离。

## 门禁（最终态）

`npm run build` 绿、`npm test` **577 passed / 1 skipped（43 文件 + 1 skip）**（比 05 后的 575 多出的 2 条即本探针）、`npm run typecheck` 绿、`npm run lint` **0 warnings 0 errors**（135 文件 84 规则）、`npm run test:browser` 见下节。`.scratch/active/team-perf/` 全程未提交（未跟踪），交付 commit 只含 `packages/` 路径。

**`npm run test:browser`：红，但与本票无关（父提交同样红，同一行同一断言）。** 本票改可见 UI，按仓库规则该跑这条 lane，所以跑了：`apps/web/tests/__external-agent-team.e2e.ts` 在 `page.getByRole('button', { name: /Claims · 1/ })`（`e2e.ts:883`）超时 30 s —— Host 侧 Agent claim 成功后页面 Claims 计数没变 1。判别：把 4 个 src 逐字节还原到父提交 `e38c6be` 重跑同一条 lane → **同样失败、同一行、同一断言**；恢复我的版本再跑 → 同样红 ⇒ 先于本票存在（01–05 都没跑过这条 lane）。未做 423c234 → e38c6be 的二分（共享工作树里切全仓 commit + 装依赖风险大）；怀疑方向是 Claim 提交后页面拿不到能更新 Claims 的唤醒（Claims 走 read 投影 / `refreshPassiveFacts` 的 `thread` scope，而 01–05 动过 scope 版本分域与读路径），不是 06 的行渲染面。**这条不阻塞 06 的结构判据，但阻塞「可见 UI 改动的浏览器验收」这条仓库规则**，已请 Vera 在隔离 clone 二分。

> **Vera 二分结果（2026-09-14 09:0x，隔离 clone）——上面那条「先于本票存在」的措辞需要收紧**：`423c234`（本序列之前）**绿**（`Test Files 1 passed`、EXIT=0）；`e38c6be` 与 `805273b` **红**（同断言）。⇒ 06 被排除是对的，但**红不是先于本序列，而是 `2b8b62b` + 01–05 带进来的**。**push 前必须先定位**（把红 lane 推给 origin/master 是承重问题）。下一步二分点 `76d0148`（含 A+01+02+03）：红 ⇒ 落在 A..03，绿 ⇒ 落在 04..05b。证据：[`findings.md`](../materials/phase0/findings.md) §3h 末节。

**探针族安全**：本票探针只跑 Client harness（合成 fetch），不碰真实账本、不隔离 `DSH_HOME`；`test:browser` 用 journey 自建 workspace + 临时 home，也不涉及真实 ledger 副本 ⇒ 与 Aster 通报的「真实账本副本 + 隔离 home 会搬走真实 Member 私有目录」风险无关。

**squash 操作坑（自查记录）**：还原父状态做对照实验用 `git checkout <parent> -- <paths>` 会**连索引一起写**；恢复时只 `git add` 部分文件 ⇒ 提交里混进父内容。本次在收口校验（5 个 client 路径逐字节比对）时发现并 amend。教训：对照实验的恢复必须 `cp` 回工作树后再 `git add` 全部受影响路径，并在 commit 前逐路径 sha256 校验。
