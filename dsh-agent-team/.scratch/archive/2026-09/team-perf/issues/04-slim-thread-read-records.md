# 04 — B2：瘦 thread-read 记录（重放成本本体）

**What to build:** 新写入的 `team/thread-read` 变瘦（read receipt + Inbox delta，而不是整段 thread 快照），旧胖记录只读 normalize；validator 对新旧记录分别做独立的 expected derivation。
**Blocked by:** 02、03（合同与版本口径先定）
**Status:** complete — 实施 `06569e6`（Tars）；**独立验收通过**（Vera，2026-09-13 23:2x；另将在 squash 后的最终 tip 上复跑关键臂）；⑥ 见文末注（票面待 Reeve/Human 拍）。

**Vera 独立验收（2026-09-13，`06569e6`，隔离 clone `verify-04`）**：同会话先量父提交 `76d0148`、再量本提交。**每记录规则校验成本**（判据本体）：读记录自己的规则校验 **0.0678 → 0.0340 ms/次（−49.9%）**；整趟校验 855.3 → 520.6 ms（−39.1%）、`ruleChecks` 814.9 → 482.0 ms。按 kind 拆分确认收益**只**落在 `thread-read`（1,229.8 → 616.7 ms），`thread-replied` / `message-sent` / claims 各档全在噪声内。每翻倍指数 **1.565 → 1.357**（2.96 → 2.56×）⇒ 曲线未做直，残余归 05。boot 组装 1,856.0 → **932.0 ms**、3 轮中位 1,551.6 → 758.5 ms。**对抗臂 7/7 绿**：三形态投影摘要逐字相等；新写记录恰好 6 键；**九**条篡改全部启动失败（含预登记的 4i 删 `taskRef` → `invalid Thread read receipt`，即「回抄改派生」确实生效）；胖 `facts[]` 砍一条仍红；零改写；胖记录内存仍带快照。包内回归 **573 passed / 1 skipped（43 文件）**、typecheck 绿。细节与两条探针自缺陷（4g 曾因「交换两个相同空 delta」假绿；`extrapolated147kMs` 标签错）见 [`materials/phase0/findings.md`](../materials/phase0/findings.md) §3d。

- [x] 用**同一份冻结账本**做旧记录 / 新记录两形态对比，四组绝对量都要有：ledger 字节、单次 `validate`、启动 boot、批后重放 — 账本 UTF-8 字节 46,166,788 → 半瘦 31,374,852 → **全瘦 16,610,852（−64.0%）**；`validate` 中位 796.9 → **466.7 ms（−41.4%）**；boot 中位 1,917.2 → **1,190.1 ms（−37.9%）**；冻结件上追加一条真读后批后重放 964.3 → 813.6 ms（**噪声内持平 = ④ 的证明**，不是收益）
- [x] 判据是**斜率**而不是总量：每记录校验成本必须回落（现测 0.033 → 0.065 ms/record，每翻倍 2.3–2.4 倍），只把总量线性摊薄不算过关 — 每翻倍 **2.56× → 2.31×**（指数 1.36 → 1.21）；读记录自己的规则校验 **567.4 → 260.2 ms（−54%）**，占整趟校验 71% → 56%。**残余超线性两条曲线都在**（`thread-replied` 0.0139 → 0.0482 ms/record）⇒ 曲线没做直，归 05 不记 04 头上
- [x] 校验保持记录级独立重放；不得改成「只信 live projection」或抽样 — receipt 分支走 `prepareReadReceiptFrom` 独立派生 6 键再 deep-compare（报 `invalid Thread read receipt`）；snapshot 分支仍走全量 `prepareReadFrom`（报 `invalid Thread read projection`）。四条变异臂（非 strict schema / 信存储水位 / snapshot 浅比较 / 写入多带 anchor）全红后按 sha256 还原
- [x] 旧记录不隐式回写、不新增兼容 storage 路径 — 启动前后逐条 diff 存储记录 = **零改写**；legacy 胖形保留为 `AgentTeamThreadReadSnapshot`（只读 normalize + 校验，永不重写）；domain version 保持 1；新增一个 zod strict union 而非新 storage 路径
- [x] 更新 147k ops 外推口径（现：单批 ≈6.5 s，且是下界）— 沿 Vera 方法（末点 ms/record × 147,000）：全胖 10.0 s / **全瘦 5.9 s**；幂律读法 39.8 / 18.8 s。顺带修正 `findings.md` §2 的标签错误：`extrapolated147kMs: 6480` 实际是 ×100k
- [ ] **用户侧判据（真浏览器）**：12k 账本上打开 Thread 的首个内容可见从 762.9 ms 降下来，其中那次 ≈0.66 s 的重放必须显著变小 —— 现在响应 11 ms 就回来，用户却要等重放结束才看到正文（§5b）

> **⑥ 这条 04 达不到，保持未勾**（不是没做完，是判据本身与 04 无关）。Vera 实测 web 账本 12,042 条 = 12,000 `thread-replied` + 40 `message-sent` + 2，**`team/thread-read` 0 条** ⇒ 04 命中率 0；那 762.9 → 108.5 ms、1 → 0 次重放是**票 02** 的功劳，重放燃料是消息记录、归 05/07。改报两种读法（(a) §5b 原案不动 + 注明燃料；(b) 同配方但账本由 post-04 代码写成、读记录占 77% 字节的新账本）**待 Reeve/Human 拍是否改票面**。文档与回帖一律不写成「04 让浏览器首内容变快」。

## 验收口径（Vera 预登记，2026-09-13 22:5x，落地前冻结）

**定稿形状**：`data = { workspaceId, memberId, threadRef, taskRef?, readThroughSequence, inbox }`。`remainingUnreadCount` 与 `attention` 不落盘——两者都是投影派生报告字段，逐条独立派生 `remainingUnreadCount` 需要克隆投影再数未读，正好顶掉第 ② 条要的斜率（`applyTo` 的读分支只吃 `inbox`，已核实无 durable 消费者）。

**①/④ 的测量协议**：冻结件里 7,079 条读记录全是胖的，而 ④ 要求旧记录只读不改 ⇒ 在冻结件上追加新记录时四组绝对量**预期持平**；持平是 ④ 的证明，不是收益。收益只能在「读记录按新形状写入」的账本上量：用 `materials/phase0/slim-ledger.py` 把冻结件机械投影成全瘦 / 半瘦反事实账本（同 sequence、同事件、同 delta、同水位，只删快照字段；`--audit` 做字段级自审），原件与反事实跑同一条 25/50/75/100% 前缀曲线。

**② 斜率**：必须报**两条**曲线（全胖原件 / 全瘦反事实）与每翻倍指数（现测 0.033 → 0.065 ms/record、每翻倍 2.3–2.4×）；只报「单条记录更小」不算过。离线前值：读记录 mean 4,144 → 894 B、账本 38.06 → 15.06 MB（−60.4%）。

**⑤ 外推**：报两档——全胖 147k ≈6.5 s（现状下界，不变）+ 全瘦 147k（新数）。

**⑥ 口径已重定（需要 Reeve/Human 拍是否改票面）**：§5b 的 web 账本是 `written:12000` 的 Human 单方消息、**0 条 `team/thread-read`**，那次 658.7 ms 重放的燃料是消息记录；762.9 ms 里也含 02 的功劳（无进展读不再落盘重放）。故 04 **达不到**「762.9 ms 显著下降」。改报两种读法：(a) §5b 原案不动，注明燃料是消息记录、归 05/07；(b) 同配方但账本由 post-04 代码写成、读记录占 77% 字节的新账本。结论不写成「04 让浏览器首内容变快」。

**落地结果与原始输出**：[`materials/phase0/findings.md`](../materials/phase0/findings.md) §3c（四组绝对量、两条斜率曲线、代码形状与门禁）与 §3d（Vera 独立验收：同会话前后档、per-kind 拆分、7/7 对抗臂、两条探针自缺陷）。票面判据不改写。

**对抗判据**（`zz-p0-slim-guard.spec.ts`，独立于包内测试）：胖 / 全瘦 / 半瘦三条账本真装配启动后**投影摘要逐字相等**；新写记录的键集必须恰好落在 6 键内；八条篡改必须启动失败（删水位 / 抬水位 / 降水位 / 清空一个已消费 delta 分量 / 改 memberId / 塞胖 `thread` / 交换同 Member 同 Thread 两条记录的 delta / 多带 `attention` 键）；胖记录 `facts[]` 砍一条仍必须红；启动前后逐条 diff 存储记录 = 零改写。
