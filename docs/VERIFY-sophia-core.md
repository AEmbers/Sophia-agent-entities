# sophia-core 独立验证报告（`t7` 首验 + `t8` 后终验）

> 验证者：`星验主事`（非任何实现文件的作者）
> 日期：2026-09-23
> 契约：`docs/SPEC-sophia-core.md`（65,827 B / sha256 `FE2C5A120D94106C2247AE2D5463250B46AB9B607202D9ED1B461EB1924CCA95`）

> ## 📌 本报告含两次验证，责任基线不同 —— 请按节引用
>
> | 范围 | 权威基线 | 状态 |
> |---|---|---|
> | §0–§10（`t7` 首验） | §1 的 13 个文件指纹（**t7 当时**） | 对其自身指纹**仍然有效**；但**不再代表当前树** |
> | **§11（`t8` 后终验）** | **§11.1 的 21 个文件指纹（当前树）** | **当前树的权威结论** |
>
> `t8` 为修 OCR 意见改了 6 个实现/配置文件 + 5 个测试文件（`t8` 已如实声明作废本报告基线）。
> 需要引用「当前实现状态」时请用 **§11**。
> 结论：**通过**。全树 `tsc` exit 0、`vitest` exit 0（5 files / **244 tests passed**）。
> 本报告只对下方「定稿指纹」表的字节负责。任何文件在报告出具后被改写，结论即失效。

---

## 0. 验证方法与独立性声明

本轮的**核心方法**是：**不依赖实现者自己写的测试**。除全量套件外，我另建三条独立 oracle 通路：

| 通路 | 做法 | 为什么必要 |
|---|---|---|
| **直连源码** | `node --input-type=module` 直接 `import` `src/*.ts`（Node v24 类型剥离） | 绕开 `tests/*.spec.ts`，用自己的断言复核行为。作者写的测试与作者写的实现共享同一套假设 |
| **独立 SQLite 连接** | 另开 `new DatabaseSync(path)` 直接发 SQL | 证明约束在**存储层**生效，而非「这个类碰巧没暴露 update」 |
| **文件读取** | 直读 `assets/members/out-512/**` 的 PNG 文件名集合 | AC-5A-1 要求与素材**双向**一致，必须读真实磁盘 |

**三条 oracle 通路的合计**：naming 28 项 + ledger 25 项 + delegation 29 项 + reattach 9 项 = **91 项独立断言**，
其中 90 项通过、1 项为我方期望值过严（见 §4.3，已判定为**非缺陷**）。

> 全部命令均**未管道化**取退出码（SPEC §7.1 的实测陷阱）。批量变异作业**先跑对照样本**，
> 对照样本变绿后才开始批量 —— 这条纪律在本轮真实救了一次场（见 §6 陷阱 1）。

---

## 1. 定稿指纹（本报告的唯一责任基线）

`npx tsc --version` = **0**（内容锚定：`Version 5.9.3`）

| 文件 | 字节 | sha256 |
|---|---|---|
| `src/delegation.ts` | 71003 | `A5E8951BBC1F3B19EEBA36AEFE7589CA0A86B2FD7E0E578B8967A40F263100C9` |
| `src/approval.ts` | 5761 | `DF82CF3348B6B026F86CC081215609AA5FD4FD8084544739DD6D0689E02ECF3B` |
| `src/types/operations.ts` | 14468 | `D0A474BEA5E0B00FB0BFA9ECD60C2C5D8CDC53AB8AA5510FF4B58CBC808E8D91` |
| `tests/delegation.spec.ts` | 86802 | `B7E77ADB5CA75BF254C9322BD6558CE0EEDC6E2124A6DD09C0744E58C706459D` |
| `tests/types.spec.ts` | 22574 | `ADD6665726E647414A092BEA245F454075065B35CF0E2C8B8E3D589B4CE99997` |
| `src/ledger.ts` | 36446 | `5304D584ABBB123902945D3DC85C46490D1099EDC7D438E1FD434A6A3D29732A` |
| `src/naming.ts` | 24739 | `905157F0DC0A8EAE8E92ACDD8F5E2BF43ABDA39BEB1FB5AE1F553A3A3C7C1CD8` |
| `src/types/guards.ts` | 5973 | `19A2269F6AAFBE71E5CCC87EC57B9BFDBDA1E3D7D8338D23983DFBFF1B9A79D5` |
| `src/types/ids.ts` | 2738 | `15749647513B6EB3E9FFC45EF1BAFF680AD3B7FC281D4E4F911ECD074F8961D3` |
| `src/types/team.ts` | 5457 | `581E6846F8C2E7150225643D34CCBEE3C3E3C268C8D53D91D22D738030E21605` |
| `src/types/roles.ts` | 2672 | `F1CBB0877C3DF8AD4E754042BC062BE6A664EF5E736280E23189E4414538F653` |
| `tests/ledger.spec.ts` | 48969 | `70EA87A5970FF9587FF8C650C96094AE06146257690E29EFD5B90C2A1344B727` |
| `tests/naming.spec.ts` | 38231 | `5F7FF7E8ACE500696A1BDF4C2493F763C2369F1345D3917CE736DAB261F3BAD9` |

（其余文件见 `%TEMP%\t7-final-fingerprints.txt` 全量清单。）

**⚠ 关于并发污染**：本批 `t4`/`t5`/`t6` 曾**并行**执行。我实测到一次真实的在途红 ——
14:59 冻结快照时 `vitest` **exit 1**（`2 failed | 241 passed`），两条失败用例全在
`tests/delegation.spec.ts`（14:58 刚落的新用例），`src/delegation.ts` 在 15:00:15 仍在写。
按文件归组确认**与 t4/t5/types 无关**（那三部分在 14:48 基线上 233 用例全绿）。
历算主事 15:00:57 停笔后我复跑 → 全绿。**上面的定稿指纹即该次全绿快照的指纹。**

---

## 2. 验收命令逐字结果（定稿基线）

| # | 命令 | 退出码 | 输出 |
|---|---|---|---|
| 守卫 | `npx tsc --version` | **0** | `Version 5.9.3`（内容锚定通过） |
| 1 | `npx tsc --noEmit -p packages/sophia-core/tsconfig.json` | **0** | 无输出（干净） |
| 2 | `npx vitest run --root packages/sophia-core` | **0** | `Test Files 5 passed (5)` / `Tests 244 passed (244)` / `Duration 1.07s` |

分文件（定稿基线）：

```
✓ tests/scaffold.spec.ts   (2 tests)
✓ tests/types.spec.ts      (19 tests)
✓ tests/naming.spec.ts     (81 tests)
✓ tests/delegation.spec.ts (78 tests)
✓ tests/ledger.spec.ts     (64 tests)
```

> 通过数演进：t3 交付 20 → t4 交付 148 → t5 交付 199 → t6 交付 233 → **Q-E 后定稿 244**。
> `tests/types.spec.ts` 的用例数在 Q-E 前后**均为 19**，与 captain 的核实一致（t6 只定向补了 2 处
> fixture 的 `spec` 字段，未改断言逻辑）。

---

## 3. 反恒真抽检：7 组变异体，**全部变红、全部还原**

「一个从未红过的断言，与没有断言等价。」SPEC §7.3 第 3 步要求 ≥2 条；实际做了 **7 组**。

### 3.1 控制样本（先证明仪器可信）

| 控制 | 命令 | 结果 |
|---|---|---|
| 干净树 ledger | `vitest run ... tests/ledger.spec.ts` | exit **0** |
| 干净树 naming | `vitest run ... tests/naming.spec.ts` | exit **0** |
| 干净树 types | `vitest run ... tests/types.spec.ts` | exit **0** |
| 干净树 delegation | `vitest run ... tests/delegation.spec.ts` | exit **0** |

### 3.2 变异矩阵

| 变异 | 改动 | 目标 AC | 实测结果 | 还原 |
|---|---|---|---|---|
| **M1** | 删掉 `LEDGER_SCHEMA_SQL` 里两条 `CREATE TRIGGER`（`TRIGGER count` 2→**0**） | AC-10-6 | `vitest` exit **1**，`Tests 3 failed \| 61 passed` | sha 复原 `5304D584…` ✅ |
| **M2** | 「取最小可用」改成「max+1」（SPEC §7.2 指定手法） | AC-5A-9 | exit **1**，两条 AC-5A-9 用例 `2 failed \| 79 passed` | sha 复原 `905157F0…` ✅ |
| **M3** | `TeamId` 去掉 `Brand`（改回裸 `string`） | AC-ID-1 | `tsc` exit **2**，`TS2578: Unused '@ts-expect-error' directive` | sha 复原 `1574964751…` ✅ |
| **M4** | 给 `Host` 加 `readonly teamId` | AC-ROLE-1 | `tsc` exit **2**，`TS2741`（fixture 缺 teamId）+ `TS2578` | sha 复原 `F1CBB087…` ✅ |
| **M5** | `MemberLifecycle` 加回 `'inactive'` | AC-TEAM-1 / **Q-C** | `tsc` exit **2**，`TS2578` + `naming.ts(406,52): TS2366`（见 3.3） | sha 复原 `581E6846…` ✅ |
| **M6** | 把 `isLedgerActor` 的 **human / host / member 三个分支各自**改成恒真 `return true` | 分支级覆盖 | 三个变异体**分别** exit **1**：`2 failed \| 17 passed` / `1 failed \| 18 passed` / `1 failed \| 18 passed` | sha 复原 `19A2269F…` ✅ |
| **M7** | 删掉 `runApprovalPath` 的「已有 awaiting 则只补推送」恢复分支 | 本条为 t6 自报缺陷的回归 | exit **1**，`1 failed \| 77 passed`（失败用例正是「收件箱推送失败后重试」） | sha 复原 `A5E8951B…` ✅ |

**M6 是本轮最有价值的一项**：它专治 t3 踩过的**「分支级不可测」隐蔽恒真变体**
（当时把守卫的 host 分支改成 `return true`，两套命令仍**全绿**）。
实测三个分支**各自**都能让测试变红 ⇒ 该坑已**真的**补上，不再是口头声称。

### 3.3 一处**编译器守门的独立印证**（M5 的副产品）

M5（把 `'inactive'` 加回联合）除 `TS2578` 外，还额外触发：

```
packages/sophia-core/src/naming.ts(406,52): error TS2366: Function lacks ending return statement
                                            and return type does not include 'undefined'.
```

这**独立证实**了 `naming.ts` 中 `occupiesName()` 的注释所声称的机制 ——
它用**穷尽 switch（无 `default`）**而非黑名单，因此给 `MemberLifecycle` 新增取值时
会**编译失败**、逼后来者显式决定新取值是否占用名字。该声称此前只是注释，现在是实测事实。

### 3.4 还原纪律

7 组变异体**全部**在改动后立即用原文复原，并**逐一核对 sha256 与冻结值一致**（表中「还原」列），
每组还原后**复跑对照样本回到 exit 0**。未留下任何未还原的改动。

---

## 4. SPEC 45 条 AC 逐条比对

### 4.1 独立 oracle 复核结果汇总

| 批次 | 范围 | 独立断言数 | 通过 | 失败（均经复核为非缺陷） |
|---|---|---|---|---|
| 批次 1 | AC-5A-1..15（naming） | 28 + AC-5A-1 双向 | 29 | 0 |
| 批次 2 | AC-10-1..10（ledger） | 25 | 24 | 1（§4.3） |
| 批次 3 | AC-5-1..12（delegation） | 29 | 29 | 0 |
| 批次 4 | AC-5-13..15（reattach） | 9 | 9 | 0 |

### 4.2 逐条落实（节选关键项，全部为**实测**取值而非推断）

**§2 / §3.1 类型层**（AC-ID-1、AC-ROLE-1/2、AC-TEAM-1、AC-STAGE-1）
- 10 个品牌化 ID 的互斥由 14 个 `@ts-expect-error` 标注守着，M3/M4/M5 证明**真的会红**。
- `Host` 无 `teamId`（M4 反向证明）；`Team` 无 `hostSessionId` 锚点。
- `MemberLifecycle` 恰 4 值且**无 `inactive`**（M5 反向证明）。
- AC-STAGE-1（`DEFAULT_RUN_MODE === 'persistent-team'`）**已断言**，位于
  `tests/types.spec.ts:184-186`。

**§3 FR-5A 三层标识**（AC-5A-1..15）
- **AC-5A-1 双向一致（我独立实读磁盘）**：`assets/members/out-512/` 下 4 个梯队目录共
  **20** 个 PNG，与 `POSITIONS`（20）比对 —— 「名册有而盘上无」**0 条**、「盘上有而名册无」**0 条**。
- AC-5A-2：`positionSlug('灵台郎') === 'lingtai-lang'` 实测 ✅（机构名「灵台」整体转写）。
- AC-5A-3：20 条 slug 全部匹配 `^[a-z]+(-[a-z]+)*$`，且 `POSITION_SLUGS` 键集 === `POSITIONS` 集。
- AC-5A-4/5：`toMemberId('灵台郎','a1b2c3d4')` → `sophia-lingtai-lang-a1b2c3d4`，往返一致；
  **5 类畸形输入全部返回 `null` 且不抛错**（逐条实测，含大写 `A1B2C3D4` 与 7 位 `a1b2c3d`）。
- AC-5A-6..9：空/active/destroyed/archived/suspended **五种占用情形各自独立实测**；
  `destroyed` 与 `archived` 释放名字、`suspended` 仍占用；**跳号补最小可用**（`-2` 空着就补 `-2`）。
- AC-5A-10..15：5 个错误码逐个实测；**AC-5A-14** 对 6 条违例逐条断言 `rule`/`example` 非空。

**§6 FR-10 账本**（AC-10-1..10）
- AC-10-1/5：3 团分投后按 A 只取回 A 的那条；`hasMore===false`、`nextCursor===null`；
  不存在的 scope 返回 `[]`（不是 `undefined`、不抛错）。
- AC-10-2：`team/member-added` 同时返回 `member` + `team` 两个 scope。
- AC-10-3：`limit=2` 分页 5 条 → 第 1 页 `hasMore===true`/`nextCursor===2`；第 2 页首条 `sequence===3`；
  末页 `hasMore===false`/`nextCursor===null`。
- AC-10-4：`team/initialized` 与 `team/thread-started` 的 `changeScopesOf` 均返回 `[]`（实测）；
  不带 `scopes` **能**读到、带任意 scope **读不到**。
- AC-10-7/9：正常账本 `{ok:true, sequence:2, brokenAt:null}`；首条 `previousEventId===null`、`sequence===1`。
- **AC-10-8（跨批）**：300 条账本（跨 `INTEGRITY_BATCH_SIZE=256` 的批边界）→ `ok:true, sequence:300`；
  第 300 条之后插空洞 → `ok:false, sequence:299, brokenAt:301`。
  **跨批用例存在且真的变红**（t4 自报的 M12 存活变异体已被该用例收编）。
- AC-10-10：`index.ts` 导出中**无**任何以 `View`/`Projection`/`State` 结尾的符号。

### 4.3 唯一一次「失败」：**我的期望值过严，非缺陷**

我最初断言「序号空洞后 `brokenAt` 应指向**期望的连续序号**」。
账本在 `[1, 2, 空洞@9]` 下实测返回 `{ok:false, sequence:2, brokenAt:9}` —— 我方期望是 `3`。

**复核结论：实现是对的，我的期望写得太窄。** 依据：
1. SPEC §6.4 原文只说 `brokenAt` **「指向该处」**，未规定是「期望序号」还是「违规行的实际序号」。
2. 实现的约定是**违规行的实际 sequence**，且在跨批场景下自洽：
   `1..299 + 301` → `brokenAt=301`（不是 300）。
3. 作者测试已把该约定**逐字钉死**（`tests/ledger.spec.ts:519` 断言 `brokenAt===5`、
   `:593` 断言 `brokenAt===301`）。

⇒ 记为**契约措辞可更精确**（建议 SPEC 补一句「`brokenAt` = 首条违规行的实际 `sequence`」），
**不计为实现缺陷**，也不据此判红。

### 4.4 AC-5-4 闭集与 `SpawnDecisionOutcome` 的边界

SPEC §4.2 的 `SpawnOutcome` 恰 5 个 `kind`。t6 另立
`SpawnDecisionOutcome = SpawnOutcome | rejectedByHuman | ticketNotFound`。
**我判定这是正确的**：§4.2 无「第二级被人类否决」，硬塞进 `forbidden` 会把
「人类行使否决权」**谎报**成「你没权限」，使返回值与账本事实互相矛盾。
5 元闭集**未被污染**，AC-5-4 仍成立。已实测：`rejectedByHuman` 与 `forbidden` 是不同 `kind`。

---

## 5. append-only 是否真落在**存储层**（本人独立复核）

**手法**：另开 `new DatabaseSync(path)` 直连账本**文件**，绕开 `Ledger` 对象直接发 SQL。
（调 `Ledger` 的方法只能证明「这个类碰巧没暴露 update」，是恒真断言。）

实测输出（原样）：

```
committed, head = {"sequence":2,"eventId":"evt-..."}
rows before/after = 2 2
UPDATE blocked  = append-only: UPDATE forbidden
DELETE blocked  = append-only: DELETE forbidden
triggers in sqlite_master = [{"name":"ledger_events_no_delete"},{"name":"ledger_events_no_update"}]
read() after tamper attempt: count = 2 kinds = team/initialized,team/initialized
verifyIntegrity = {"ok":true,"sequence":2,"brokenAt":null}
```

**判定：达标。** 四条独立证据同时成立：
1. `sqlite_master` 里**确实存在**两条触发器（不是应用层自觉）；
2. 外部连接 `UPDATE` 被 **ABORT**；
3. 外部连接 `DELETE` 被 **ABORT**；
4. 行数 `2 → 2` **未变**，且事后 `read()` 读到全部原事件、`verifyIntegrity().ok===true`。

反向对照由 **M1** 提供：删掉两条 `CREATE TRIGGER` 后 3 条用例变红 ⇒ 这几个断言**不是恒真**。

---

## 6. §10 四项裁定 + §11 Q-E / Q-F 落实核对

| 裁定 | 内容 | 独立实测证据 | 判定 |
|---|---|---|---|
| **Q-A** | `星文审校` slug = `shen-jiao`（按词义，非 `shen-xiao`） | `positionSlug('星文审校')` = `xing-wen-shen-jiao`；`POSITION_SLUGS` 旁有裁决注释 | ✅ 落实 |
| **Q-B** | `Ledger.commit` **同步**（非 `Promise`） | `typeof r === 'object'`、`r instanceof Promise === false`、无 `.then`；返回 `{eventId, sequence, occurredAt}`；源码签名为 `commit(input): LedgerReceipt` | ✅ 落实 |
| **Q-C** | 生命周期取 `active`/`suspended`/`archived`（**无 `inactive`**） | `MemberLifecycle = 'active' \| 'suspended' \| 'archived' \| 'destroyed'`；M5 加回 `inactive` → `tsc` exit 2 | ✅ 落实 |
| **Q-D** | 名册外职位名**硬拒绝** `POSITION_UNKNOWN` 且报错**列出合法名** | `validatePosition('天官正')` → `code==='POSITION_UNKNOWN'`，`message` 含「合法职位名共 20 个：钦天监监正、…、录典主事」 | ✅ 落实 |
| **Q-E** | `spawn/principal-rejected` 载荷补 `targetKind` + `spec`，`readSpawnTicket` 返回**真票据** | 见下方逐条 | ✅ 落实 |
| **Q-F** | `spawn-ticket` scope 保留现状（诚实留白），并纠正「无法还原」措辞 | 见 §7 | ✅ 采纳 |

### 6.1 Q-E 六项要求逐条实测

| §11 要求 | 实测结果 |
|---|---|
| §6.1 表格补 `targetKind`、`spec` | 类型为 `Pick<SpawnAwaitingHumanData,'requestId'\|'requesterMemberId'\|'principalMemberId'\|'targetKind'\|'spec'> & {reason}` |
| `requestSpawn` 否决路径落账带上 | 账本事件 `spawn/principal-rejected` 的 `data` 键 = `requestId,requesterMemberId,principalMemberId,targetKind,spec,reason` ✅ |
| `readSpawnTicket` 返回**真票据**（替换 `null`） | 非 null ✅；`status==='rejected-principal'` ✅；`spec.name` 原样往返（`'子团'`，**非空桩**）✅；`targetKind==='persistent'` ✅ |
| 原「返回 null」的测试改为断言真票据形状 | `tests/delegation.spec.ts` 有「第一级否决的票据**可投影**为真票据（captain 裁定 Q-E）」用例，定稿基线**通过** |
| 新增：`createTeam===0` **且** `inbox.push===0` | 实测否决后 `created.length===0`、`pushes.length===0` ✅ |
| 反恒真：去掉 `spec` 则新断言必须变红 | 测试文件内**自带**该变异用例（「Q-E 反恒真：把 `spec` 从第一级否决载荷里去掉…」）；我另用 **M7** 独立验证了同区域的恢复逻辑确实能被变异逼红 |

### 6.2 §11 附带补全两项

| 项 | 判定 |
|---|---|
| 另立 `SpawnDecisionOutcome`（保住 §4.2 五元闭集） | ✅ 正确，理由见 §4.4 |
| `PrincipalReviewer` 补 `readonly memberId: MemberId` | ✅ 正确。§5.1 只给 `reviewSpawn` 却要 AC-5-8/5-9 的 `principalMemberId` 非空，**两者不可能同时成立**；此为消除契约内部矛盾的**必要补全**。实测批准事件 `principalMemberId='p-1'` 非空 |

---

## 7. 两处「设计留白」判责（任务清单第 6 项）

### 7.1 `spawn-ticket` scope 不产出 —— 判定：**合理的诚实留白**（已由 Q-F 裁定采纳）

**实测事实**：
```
changeScopesOf(spawn/awaiting-human-approval) = [{"kind":"human-inbox"},{"kind":"member","memberId":"m1"}]
该事件载荷字段 = requestId,requesterMemberId,principalMemberId,targetKind,spec   ← 无 ticketId
ChangeScope 词汇表 = team, member, plan, spawn-ticket, dag-team, human-inbox     ← 有 spawn-ticket
spawnTicketIdOf("R1") = "ticket:R1"
```

**判定理由**：
1. 投出一个订阅方**永远匹配不到**的 scope，比不投**更坏** —— 订阅者会收到「有事」却查不到「什么事」，
   属静默失配。t4 选择如实不投，方向正确。
2. 我进一步核实了一处**措辞不准确**：t4 注释称「**无法还原** ticketId」。
   实测 `spawnTicketIdOf(requestId)` 是**确定性派生**（`ticket:${requestId}`，`delegation.ts:315-316`）。
   ⇒ 准确表述应为「**ledger 层不得依赖 delegation 层，故 ledger 无法自行派生 ticketId**」，
   这是**分层约束**，不是「信息不可恢复」。
   **二者的指引完全不同**：前者说「要么扩 §6.1 载荷、要么放宽分层」；
   后者会误导未来实现者以为要加索引或缓存。
   ⚠ 但需注明事实边界：`ledger.ts` **不 import** `delegation`（我核实了其 import 列表），
   所以这条更正**只在分层前提下成立**；若合并两层则该 scope 本可产出。
3. 该更正已被 captain 采纳并写入 SPEC §11 Q-F，并注明出处为 t7。

### 7.2 `channel/thread` 类 scope 无词汇 —— 判定：**合理的诚实留白**

**实测事实**：
```
changeScopesOf(team/thread-started)   = []
changeScopesOf(team/channel-created)  = [{"kind":"team","teamId":"T1"}]
ChangeScope 词汇表含 threadId / channelId 吗？→ 均无
```

`team/thread-started` 的影响实体是**频道/线程**，而 §6.3 的 scope 词汇里**没有**这两种 kind。
t4 选择返回 `[]`（语义 3「不参与任何 scope 投影」），而非硬塞一个语义不符的 scope。

**判定：合理**。理由与 §7.1 同构 —— 词汇表缺项时，正确做法是**扩契约词汇**，
而不是让实现私自发明一个近似值。且 `team/thread-started` 在 §6.3 语义 3 下有**明确定义的归属**
（不参与过滤、在不过滤读取中可见），并非「无处安放」。
`team/channel-created` 则已正确投 `team` scope（频道属于团，语义成立）。

---

## 8. 已知残余风险清单（**非**未完成项，均属已文档化的知情取舍）

> 依 t7 纪律：判「可不做」必须同时给出依据；以下各项均有依据，且**实现者已在代码中明示**。

| # | 风险 | 触发条件 | 现状 | 依据 / 彻底消除路径 |
|---|---|---|---|---|
| **R1** | 跨进程并发批准时可能各建一个团 | 宿主**没有**把 `requestId` 写进 `team/created` | 代码侧已无守卫可加：`createTeam` 是**注入**的、落 `team/created` 的是**宿主**。约定已写进 `DelegationDeps.createTeam` 文档并**明确标注残余风险** | t6 未写一段假装解决的代码（正确，同 Q-E「宁缺勿假」纪律）。**彻底消除需扩展账本契约**：为 `team/created` 建按 `requestId` 的**唯一索引**。captain 已裁定该处置正确 |
| **R2** | `spawn-ticket` scope 在词汇表中不可达 | 任何 `spawn/*` 事件的订阅方按票号订阅 | 契约词汇保留、实现不产出；已由 **Q-F** 裁定保留现状 | 正解是扩 §6.1 载荷带上 `ticketId`（与 Q-E 同一处补法）。当前判定不值得，因 `ticketId` 是 `requestId` 的**确定性派生值**，落账等于存一份可推导的冗余 |
| **R3** | `channel`/`thread` 无对应 scope kind | 需要按频道/线程增量订阅 | 返回 `[]`，不参与 scope 过滤 | 需先**扩 §6.3 的 `ChangeScope` 词汇表**。在此之前硬塞近似值是错的 |
| **R4** | 内存中的幂等表不淘汰 | 超高频自动派生 | 三张表随 `Ledger` 对象存活、无 LRU | 量级依据：控制面操作（每小时几条~几十条），30 天约 7 万条、个位数 MB，**远小于账本本身的写入压力**。加 LRU 会引入「淘汰后重复建团」的新正确性问题，收益可忽略。判「可不做」 |
| **R5** | `pending-principal` 票据状态不可达 | 需要「已受理、待预审」的票据 | 有意的：本包票据是**账本事实**的投影，第一级未出结论时**无任何事实**（`reviewSpawn` 的 promise 还在飞） | 若记录「已提交」，须先发明一个 §6.1 不存在的事件 kind。契约词汇保留，将来补事件即可用 |

---

## 9. 陷阱口径（供 `t8` 与后续实现者）

1. **退出码不要管道化**。`npx vitest … | Select-String` 后 `$LASTEXITCODE` 会假报 **0**
   （管道末段的退出码）。本批实测过：vitest 报 `1 failed` 而管道后读成 `0`。
2. **`npx tsc --version` 要锚定输出内容，不能只看退出码**。在错误 cwd 下它会打印 npm 伪包
   `tsc@2.0.3` 的提示（`This is not the tsc command you are looking for`）却仍 **exit 0** ——
   「防伪 tsc 的守卫」自身被绕过。**必须断言输出逐字等于 `Version 5.9.3`**。
   （captain 复现于 `C:\Windows\Temp`；我本轮采用**内容锚定**并通过。）
3. **批量断言作业先跑对照样本。** t3 实测：`cmd /c "… 1>out 2>&1" | Out-Null` 会把
   **11 个变异体全报成 `tsc=0`**，看似「全捕获」、实为仪器坏了。本轮的
   `cmd /c "… 1>""file"" 2>&1"` 写法先经 4 个控制样本验证后才批量。
4. **分支级不可测是恒真断言的隐蔽变体。** t3 把守卫的 host 分支改成恒真 `return true`
   而两套命令**仍全绿**。检查每个多分支守卫是否**每条分支都有阴性用例** —— 本轮用 M6 三分支各自验证。
5. **`verify_report` 的 `kind=gate` 必须显式带 `cwd`**。不带时会在错误目录执行：
   同一条 vitest 在仓库根 exit 0、在无关目录 exit 1（为真的 claim 被判 fail）。
6. **不要用 `kind=compiled` 验 TS 文件**：它套 legacy MSBuild 语义，会把为真的 claim
   判 fail 并**误记失败样本库**。用 `kind=gate`（带 cwd）或 `kind=file`（**绝对路径**）。
7. **并发批次里「整包 `tsc`/`vitest` exit 0」绑的是全树状态。** 判自己的文件请先
   **按文件归组**；必要时用**隔离探针**（临时 tsconfig 只 include 目标 + 依赖，用完即删）。
   本轮实测到一次真实在途红（delegation.spec 2 条新用例），按文件归组后 30 秒内确认为 t6 在途。
8. **`.md` 拿不到 OCR 评审（结构性）**：ocr 按扩展名过滤，`0 file(s) reviewed` 会输出
   `No comments generated. Looks good to me.` —— **这是假绿，不是通过**。
   本报告为 `.md`，**结构性无法获得第三方代码评审**；文档类结论只有人眼可审。已如实声明。
9. **在文件仍被改写时下断言 = 验的是另一个版本。** 本报告全部结论**只对 §1 的指纹负责**；
   若任一文件在报告出具后被改写，须以新指纹重跑受影响部分。

---

## 10. 结论

| 判据 | 结果 |
|---|---|
| `tsc --noEmit` | **exit 0**（内容锚定守卫 `Version 5.9.3` 通过） |
| `vitest run` | **exit 0** / 5 files / **244 tests passed** / 0 failed |
| SPEC 45 条 AC | **44 条实测通过**；1 条（AC-10-8 的 `brokenAt` 精确语义）**为实现正确、我方期望过严**，建议补契约措辞 |
| §10 四项裁定（Q-A..Q-D） | **全部落实**，逐条有独立实测证据 |
| §11 两项裁定（Q-E/Q-F） | Q-E **六项要求全部落实**；Q-F **已采纳**并纠正措辞 |
| 反恒真抽检 | **7 组变异体全部变红**（SPEC 要求 ≥2），全部还原且 sha256 核对一致 |
| append-only 存储层 | **达标** —— 独立连接 + 4 条独立证据 + M1 反向对照 |
| 两处设计留白 | **均为合理的诚实留白**，非缺口；均已由 Q-F 裁定 |
| 残余风险 | 5 项，**均已文档化**，其中 R1 需扩账本契约才能彻底消除 |

**最终裁决：本包满足交付标准（TypeScript 编译通过 + vitest 测试全绿），可进入 `t8`。**

> **诚实边界**：本报告为 `.md`，按 OCR 的扩展名过滤规则会得到 `0 file(s) reviewed` 的**假绿**，
> 因此**结构性拿不到第三方代码评审**。本轮我未新建或修改任何**代码**文件
> （仅新增本报告与 SPEC 的 Q-F 章节由 captain 写入），故未触发 OCR 硬性要求。
> 此外，报告中所有「实测」取值均可在 §1 指纹对应的快照上用 §2 的命令逐字复现。

---

# §11 终验（`t8` 之后 · 当前树权威结论）

> 触发：`t8` 为修 OCR 意见改了 6 个实现/配置文件 + 5 个测试文件，已声明作废 §1 的基线。
> 本次终验**不重做** §0–§10 的全部内容，只针对 **`t8` 改动的正确性**做独立复核（captain 指定的 4 项）。
> **本轮未修改任何实现/测试文件**：实测前后全树 21 个文件指纹**逐一相同**（§11.1）。

## §11.1 本次责任基线（当前树，21 个文件）

**本节的结论只对下列指纹负责。** 21 个文件全部列出，便于事后逐字核对。

| 文件 | 字节 | sha256（前 16） |
|---|---|---|
| `package.json` | 697 | `A87CA5D10AAFDF84` |
| `src/approval.ts` | 5761 | `DF82CF3348B6B026` |
| `src/delegation.ts` | 73554 | `F091E2642F0C6FC1` |
| `src/index.ts` | 1731 | `2491238C9DBD1B8D` |
| `src/ledger.ts` | 40150 | `02996800E1FAC8D6` |
| `src/naming.ts` | 25965 | `0C186FD0EED4ADBE` |
| `src/types/guards.ts` | 8002 | `40F4890FE217A619` |
| `src/types/ids.ts` | 2738 | `15749647513B6EB3` |
| `src/types/index.ts` | 918 | `D2B16F8F467AFE01` |
| `src/types/member.ts` | 2650 | `7140CA2B023C4E62` |
| `src/types/operations.ts` | 14468 | `D0A474BEA5E0B00F` |
| `src/types/roles.ts` | 2672 | `F1CBB0877C3DF8AD` |
| `src/types/staging.ts` | 2689 | `76EA15A50EC6C725` |
| `src/types/team.ts` | 5457 | `581E6846F8C2E715` |
| `tests/delegation.spec.ts` | 90698 | `EB20974104683549` |
| `tests/ledger.spec.ts` | 56685 | `11F741E672151A2F` |
| `tests/naming.spec.ts` | 40037 | `93016B81C823B034` |
| `tests/scaffold.spec.ts` | 1197 | `CE6D328E7899C85C` |
| `tests/types.spec.ts` | 25222 | `6F320DA1AB3B7A72` |
| `tsconfig.json` | 605 | `63A9A143434BCBA9` |
| `vitest.config.ts` | 1649 | `D406480E3CCC182E` |

**相对 §1（t7 基线）变更的 6 个文件**：`delegation.ts`、`ledger.ts`、`naming.ts`、`types/guards.ts`、`package.json`、`vitest.config.ts`。
**未变**：其余 15 个（含 `tsconfig.json`、`src/types/*` 的 6 个、`src/index.ts`、`src/approval.ts`）。

**写入方已停笔的证明**：连续 3 次轮询（间隔 3s）指纹不变；包内最新 mtime 为 15:47，
本次终验在 15:53 之后执行且**实测前后 21 个文件指纹逐一相同**。

## §11.2 三条 acceptance 命令复跑（逐字退出码，未管道化）

| # | 命令（`cwd = C:/Users/Administrator/Sophia-agent-entities`） | 退出码 | 输出 |
|---|---|---|---|
| 守卫 | `npx tsc --version` | **0** | `Version 5.9.3`（**内容锚定**通过，非 npm 伪包） |
| 1 | `npx tsc --noEmit -p packages/sophia-core/tsconfig.json` | **0** | 零字节输出（干净） |
| 2 | `npx vitest run --root packages/sophia-core` | **0** | `Test Files 5 passed (5)` / **`Tests 255 passed (255)`** / `Duration 1.74s` |

分文件（当前树）：

```
✓ tests/scaffold.spec.ts   (3 tests)
✓ tests/types.spec.ts      (21 tests)
✓ tests/naming.spec.ts     (82 tests)
✓ tests/delegation.spec.ts (80 tests)
✓ tests/ledger.spec.ts     (69 tests)
```

> 计数演进：t7 终验 244 → **t8 后 255（+11）**，与 captain 独立核实一致。
> `scaffold` +1（engines）、`types` +2（数组载荷/requestId）、`naming` +1（toString 抛错）、
> `delegation` +2（phantom success / removedMemberId）、`ledger` +5（busy_timeout、负序号、数组反恒真、occurredAt、连接泄漏）。

## §11.3 核 `t8` 修的三条真缺陷（captain 指定重点）

### D1 phantom success —— ✅ 已修复，**用自己的场景独立复现**

**修前缺陷（`t7` 未覆盖，由 `t8` 的 OCR 发现）**：`findTeamCreatedFor` 直接读 `event.data.teamId`，
而守卫只保证 `data` 是「非 null 对象」、**不保证与 kind 匹配** ⇒ 一条 `{kind:'team/created', data:{}}`
会让 `teamId` 取到 `undefined` 并被当成真实 ID 返回。

**我的独立端到端场景**（不使用 `t8` 的测试）：

| 步骤 | 实测结果 |
|---|---|
| ① `requestSpawn` → | `awaitingHumanApproval` |
| ② 批准但 `createTeam` 抛错 | 抛错；账本落 `spawn/awaiting-human-approval` + `spawn/human-approved`（**已批准但团不存在**） |
| ③ 注入畸形 `team/created`（`data:{}`，同 requestId） | commit 接受（守卫放行非 null 对象 —— 这正是缺陷入口） |
| ④ 重试 `decideSpawnTicket(approve)` | 返回 `{"kind":"created","teamId":"TEAM-REAL"}` |
| ⑤ **是否凭空成功？** | **否** —— `teamId` 是真实值，且 `createTeam` **确实被调用** |

**对照组（补做，防「一律拒绝」的假修）**：
- 注入**格式正确**的 `team/created`（`teamId:'TEAM-FROM-HOST'`）→ 恢复路径**采信账本行**，
  返回 `teamId:'TEAM-FROM-HOST'`，且 `createTeam` **未被调用**（幂等，不重复建团）；
- **跨进程风格**（换全新 deps / 无内存缓存，同一账本）→ 同样采信账本行、`createTeam` 未被调用；
- **纯空白 `teamId:'   '`** → 同样不采信，恢复路径正常补建。

⇒ 判定：**修复正确**。既堵住 phantom success，又没有把合法的账本行一起拒掉（那是更容易犯的「修过头」）。

> ⚠️ 我第一次写的对照组是**错的**：我在没有先建立「已批准但未建团」状态的前提下就直接批准，
> 结果走的是**首次创建**路径（不查账本），当然会调 `createTeam`。这暴露了我的场景设计错误，
> 不是代码缺陷 —— 已按正确场景重做，两次结果一并记录。

### D2 `requestId` 守卫 —— ✅ 已修复，**静默失配路径确已关闭**

| 检查 | 实测 |
|---|---|
| `isLedgerEvent({requestId: 42})` | **false** |
| `isLedgerEvent({requestId: ''})` | **false** |
| `isLedgerEvent({requestId: null})` | **false** |
| `isLedgerEvent(无 requestId)` | **true**（缺席合法） |
| `isLedgerEvent({requestId: 'R-1'})` | **true** |
| `commit({requestId: 42})` | **抛错**，且**零行落下**（失败原子） |
| 端到端：投毒一条 `requestId:42` 的 `spawn/awaiting-human-approval` | **在 commit 处即被拒**（不再能落账后被 `collectSpawnEvents` 静默忽略）；票据投影仍自洽（`pending-human`） |

⇒ 判定：**修复正确**。「值在但类型不对 ⇒ `42 !== 'R1'` 恒真 ⇒ 事件被静默忽略」这条路径**已关闭**。

### D6 游标起点 —— ✅ 已修复，**并已跨出旧游标边界验证整类**

`let cursor = -1` → `Number.MIN_SAFE_INTEGER`（`ledger.ts:849`）。
我**不只用 `-5` 一个值**验证，而是覆盖了「旧游标会漏掉」的整个类别：

| 插入的脏行 `sequence` | `verifyIntegrity()`（修后） | 旧游标 `-1` 是否会漏 |
|---|---|---|
| `0` | `ok:false` ✅ | **不会**（`0 > -1` 成立 ⇒ 会被取到；`t4` 当初把游标设成 `-1` 正是为了抓它） |
| `-1` | `ok:false` ✅ | **会漏**（`-1 > -1` 为假） |
| `-5` | `ok:false` ✅ | **会漏**（`t8` 的 OCR 发现的正是这个） |
| `-1000` | `ok:false` ✅ | **会漏** |
| `MIN_SAFE_INTEGER+1` | `ok:false` ✅ | **会漏** |

⇒ 判定：**修复正确，且关闭的是整类缺陷**（不存在比 `Number.MIN_SAFE_INTEGER` 更小的安全整数序号）。

## §11.4 对 `t8` 新增 11 条测试的反恒真抽检（要求 ≥2，实做 6）

**控制样本**：干净树各 spec 文件 exit 0（仪器可信后才作业）；所有变异**从备份恢复**并逐一核对 sha256；
每次恢复后复跑确认回到 exit 0。

| 抽检 | 变异（回退该修复） | 守护的测试 | 结果 |
|---|---|---|---|
| SPOT-1 | 删 `removedMemberId` 空标识守卫 | `[11]`（delegation.spec） | **RED** `1 failed \| 79 passed` |
| SPOT-2 | 删 schema 初始化 catch 里的 `db.close()` | `[40]`（ledger.spec） | **RED** `1 failed \| 68 passed` |
| SPOT-3 | 写入侧 `isSafeInteger` → `isFinite` | `[41]`（ledger.spec） | **RED** `1 failed \| 68 passed` |
| SPOT-4 | 删 `Array.isArray(data)` 拒绝 | `[18]`（types.spec） | **RED** `1 failed \| 20 passed` |
| SPOT-5 | 删 phantom-success 载荷收窄 | `[12]`（delegation.spec） | **RED** `1 failed \| 79 passed` |
| SPOT-6 | `describeValue` 的 function/try 机制 | `[29]`（naming.spec） | 见下方专门复核 |

**5/6 直接捕获**。SPOT-6 需要专门复核 —— 它牵涉 `t8` 自己声称的「等价变异体」。

### §11.4.1 独立复核 `t8` 声称的「等价变异体」—— 结论：**声称成立**，但我的前两次测量方式都是错的

`t8` 在 `naming.ts` 里声明：`describeValue` 的 `function` 分支与兜底 `try`
**单独删任一处测试都全绿**，只有**同时删**才变红。

**我的独立复核（三次修正后得到确定结论）**：

| 变异（忠实「中性化」，即**替换**而非**删除**） | 结果 |
|---|---|
| (a) 只去掉 `|| kind === 'function'`（`try` 保留） | exit **0**，82 passed ⇒ 仍绿 |
| (b) 只把 `try/catch` 换成裸 `String()`（function 守卫保留） | exit **0**，82 passed ⇒ 仍绿 |
| (c) 两处都改（**忠实回到 `t8` 修前的代码**） | exit **1**，`1 failed \| 81 passed` ⇒ **RED**，失败的正是 `OCR [29]` 用例 |

⇒ **`t8` 的声称成立**：两处单独都不承重、合起来才承重。承重的是这对机制所实现的**不变量**。

> ⚠️ **我前两次测量都是错的，如实记录（这是本轮最值得记的一条方法论教训）**：
> 1. 第一次我把 `try/catch` **整块删掉** —— 那会连 `return` 一起删掉，
>    函数在 `function` 输入下**直接掉出末尾返回 `undefined`**，于是校验函数**没抛错**、测试**照样全绿**。
>    这不是「等价」，是我的变异**没有忠实还原修前的代码**。
> 2. 第二次我用 `""` 当占位路径传给变异脚本，`readFileSync('')` 抛 ENOENT，
>    脚本**根本没执行**，却因为 `$LASTEXITCODE` 没检查而把三行结果都读成了「全绿」。
> ⇒ 教训：**变异必须"中性化"（替换成等价语义）而不是"删除"，且必须验证变异真的生效**
> （检查字节数变化 / 确认被替换片段已不存在），否则测的是「文件坏了」而不是「缺陷回来了」。

### §11.4.2 一处**我自己的期望值错误**（非缺陷，如实记录）

在核 D6 后的附加检查里，我用独立连接插了一行 `sequence=3`（正确序号）却把
`previousEventId` 写成 `NULL`，`verifyIntegrity()` 返回 `ok:false, brokenAt:3`，我一度记为 FAIL。

**复核结论：实现是对的，我的期望错了。** `previousEventId` 必须等于前一条的 `eventId`（AC-10-9 链式完整性），
`NULL` 只对首条合法 ⇒ 那条行**确实是坏行**，自检报错**正确**。
补做对照：同一行填入**正确的** `previousEventId` → `ok:true, sequence:3`；
正确的链 + 序号空洞 `2→5` → `ok:false, brokenAt:5`。

⇒ 判定：**非缺陷**，是我的构造错误。（与 §4.3 同类：先怀疑自己的期望，再怀疑实现。）

## §11.5 append-only 触发器与新游标逻辑是否冲突 —— ✅ 无冲突

| 检查 | 实测 |
|---|---|
| `sqlite_master` 里两条触发器 | **都在**（`ledger_events_no_update` / `ledger_events_no_delete`） |
| 独立连接 `UPDATE` | **ABORT**：`append-only: UPDATE forbidden` |
| 独立连接 `DELETE` | **ABORT**：`append-only: DELETE forbidden` |
| 行数 | **2 → 2 不变** |
| 干净账本自检（新游标下） | `{ok:true, sequence:2, brokenAt:null}` —— 新起点**没有**破坏 happy path |
| `read()` 顺序与内容 | 两条事件完整，`sequence` 仍为 `1,2` |
| `INSERT` 仍允许 | 是（append-only 拦的是**改/删**，不是**增**；语义未被误伤） |
| 跨批空洞（300 条账本，`1..299 + 301`） | `{ok:false, sequence:299, brokenAt:301}` —— **`t4` 的跨批修复未被新游标回归掉** |

⇒ 判定：**新游标与 append-only 互不冲突**；且它顺带把「小于旧游标的非法行整类漏检」关掉了。
这与 §5 的 M1 反向对照（删触发器 ⇒ 3 条用例变红）互为印证：触发器仍是**存储层**强制，不是应用层自觉。

## §11.6 终验结论

| 判据 | 结果 |
|---|---|
| 三条 acceptance 命令（当前树） | 守卫 exit 0（内容锚定 `Version 5.9.3`）/ `tsc` exit 0 / `vitest` exit 0（**255 passed**） |
| **D1** phantom success | ✅ **已修复**，独立场景复现「不再凭空成功」，且**对照组**证明没修过头（合法账本行仍被采信、不重复建团，含跨进程风格） |
| **D2** `requestId` 守卫 | ✅ **已修复**，写读两侧都拒非空字符串以外的值，静默失配路径关闭 |
| **D6** 游标起点 | ✅ **已修复**，跨 5 个 `sequence` 值（含旧游标会漏的整类）均被检出 |
| 反恒真抽检（新增 11 条） | **6 条抽检全部捕获**（5 条直接 + SPOT-6 经专门复核确认 `t8` 的等价变异体声称成立） |
| append-only vs 新游标 | ✅ **无冲突**；触发器仍在存储层生效；跨批检测未回归 |
| 我对 `t8` 的异议 | **无实质异议**。三条修复经独立复现均正确，`t8` 的等价变异体声明经复核**成立** |

**最终裁决：当前树的实现满足交付标准（TypeScript 编译通过 + vitest 测试全绿），`t8` 的改动正确。**

> **⚠️ 三条诚实边界**：
> 1. 本次终验**未修改任何实现/测试文件**；实测前后 21 个文件指纹**逐一相同**（§11.1）。
> 2. 我在本轮**犯了 2 次测量错误**（§11.4.1 的「删除代替中性化」与空路径占位、§11.4.2 的链式构造错误），
>    均已定位并更正 —— 结论以更正后的为准，过程一并留存以便审计。
> 3. 本报告为 `.md`，OCR 按扩展名过滤会给 `0 file(s) reviewed` 的**假绿** ⇒
>    **本报告自身拿不到第三方代码评审**，其结论只有人眼可审。
