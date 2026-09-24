# t7 OCR 评审报告

**评审对象**：`packages/sophia-core`（`ocr_review(mode="scan")`）
**评审时间**：2026-09-23 22:2x
**文件数**：49 个
**意见总数**：**104 条**
**严重度实测计数**：**CRITICAL 3 / HIGH 7 / MEDIUM 46 / LOW 48**（合计 104）

> ⚠ **与工具摘要行的一处差异（先说明，免得对不上）**：工具自报的是
> `HIGH 10 / MEDIUM 46 / LOW 48`。逐条数头部后发现实际是 **CRITICAL 3 + HIGH 7**
> （3 + 7 = 10）⇒ **工具把 CRITICAL 并进了 HIGH 计数**。
> 本报告用**逐条实测**的 3 / 7 / 46 / 48。

**原始输出留存**：`%TEMP%\dsh-spill-EuRCYA\session-3f1ec2c97436\76c590e75b36-ocr_review.txt`

---

## 0. 处置纪律（先声明，因为它决定了这份报告怎么读）

本任务（t7）**不实现任何东西**。因此：

- **CRITICAL / HIGH**：**逐条自己动手核验**（不改代码），给出**可执行反证**或**确认**；
- **误报**：必须附**能跑的命令/脚本**，不接受"我觉得它错了"；
- **MEDIUM / LOW**：不逐条复验（成本不对称），只对**与安全/数据完整性相关**的做核验；
- **定位方式**：按「内容 + 指纹」定位，**不按行号**（验证期间树在动，行号会指向已不存在的字节）。

---

## 1. 结论速览

| 严重度 | 条数 | 逐条核验 | 确认真实缺陷 | 判为误报 | 严重度下调 | 未核验 |
|---|---|---|---|---|---|---|
| CRITICAL | 3 | **3 / 3** | 0 | **3** | 0 | 0 |
| HIGH | 7 | **7 / 7** | **3** | 1 | 2 | 0 |
| MEDIUM | 46 | 2（安全相关） | 0 | 0 | 0 | 44（见 §5） |
| LOW | 48 | 0 | 0 | 0 | 0 | 48（见 §5） |

**逐条核验覆盖 = 10/10 的 CRITICAL + HIGH。** 逐条判定：

| 编号 | 严重度 | 判定 |
|---|---|---|
| `[13]` | CRITICAL | **误报**（注入实测：多余 kind 会让 `tsc` exit 2） |
| `[22]` | CRITICAL | **误报**（逐字跑 AC-10-10 正则：`offending=[]`，含反向自检 3/3） |
| `[63]` | CRITICAL | **误报**（文件内无 `if (false)`；守卫在 `isNonNegativeSafeInteger(actualSequence)`） |
| `[14]` | HIGH | **误报**（删掉一个真实 kind ⇒ `tsc` exit 2） |
| `[70]` | HIGH | **确认**（我复现了越权；**上游已在验证窗口内修复**，新鲜构建复验为 `cross-team`） |
| `[73]` | HIGH | **确认**（`scopes:[]` 游标跳 head 且零折叠，续读也拿不回）→ **F2** |
| `[98]` | HIGH | **确认**（方括号 IPv6 未脱敏，全仓无 IPv6 规则）→ **F1** |
| `[48]` | HIGH | **机制成立、降为 MEDIUM**（全仓仅本文件 disposer 会移除该节点，外部移除路径不存在） |
| `[54]` | HIGH | **机制成立、降为 MEDIUM**（`src/index.ts` 完全不引用 `client/`，且已有测试守卫）→ **F3** |
| `[69]` | HIGH | **机制确认**（正文确实逐字进 notice），归为「设计权衡未文档化」 |

### 1.1 确认的问题（已作为 finding 提交，t7 不修）

**2 条确认为真实缺陷（HIGH）** + **1 条机制成立但按可达性下调为 MEDIUM**：

| ID | 严重度（我的判定） | 位置（内容定位） | 指纹 |
|---|---|---|---|
| **F1** | HIGH | `src/client/panel.tsx` 的 `sanitizeErrorForDom`：**无任何 IPv6 规则** | `15256B / C03F4313C0CFF2FA` |
| **F2** | HIGH | `src/projection/index.ts` 的 `catchUpFold`：`scopes: []` ⇒ 游标跳 head 且零折叠 | `52808B / 7373531FB9731C25` |
| **F3** | MEDIUM（OCR 标 HIGH，我按可达性下调） | `src/plugin.ts` 的键不撞名保证是**一次性快照**，不是结构性保证 | `3815B / 3A8AA37DB355D285` |

---

## 2. CRITICAL 三条 —— **全部判为误报**（逐条附反证）

### 2.1 `[13] CRITICAL · src/types/guards.ts:52` —— "`ExtraLedgerEventKind` 是 no-op"

**OCR 声称**：`satisfies` 已保证无多余项，故 `ExtraLedgerEventKind` 恒 `never`，该行**恒真**、什么也没保证。

**反证（注入实测）**：往 `LEDGER_EVENT_KINDS` 注入一个不存在的 kind：

```
注入: 'spawn/human-approve-td',

packages/sophia-core/src/types/guards.ts(41,3): error TS2820: Type
  '"spawn/human-approve-td"' is not assignable to type 'keyof LedgerEventMap'.
  Did you mean '"spawn/human-approved"'?
packages/sophia-core/src/types/guards.ts(53,7): error TS2322: Type 'true' is
  not assignable to type 'never'.
### TSC EXIT=2
```

**判定：误报。** 注入后 `tsc` **exit 2**，且**两条**断言都报了。
OCR 说的"结构性恒真、抓不到多余项"**与实测相反**。

> ⚠ 关于 `satisfies` 的**真实语义边界**（OCR 说对了一半）：
> `satisfies` 确实负责"每一项都属于 `LedgerEventKind`"，
> 所以第 53 行那条 const 的作用是"**守卫那个约束本身**"——
> 源码注释里**已经写明**了这一点（"唯一的作用是「若将来有人把 `satisfies` 去掉，这里会先报错」"）。
> OCR 把一条**已文档化的设计意图**读成了缺陷。

### 2.2 `[14] HIGH · src/types/guards.ts:46` —— "删掉一个 kind 不会报错"

**反证（注入实测）**：从清单里删掉 `'spawn/human-approved'`：

```
packages/sophia-core/src/types/__t7mut.ts(45,7): error TS2322: Type 'true' is
  not assignable to type 'never'.
### TSC EXIT=2
```

**判定：误报。** 删掉一条真实 kind ⇒ **立刻编译失败**，这正是该断言存在的意义。
OCR 的推理（"`MissingLedgerEventKind` 变成 `never` ⇒ `never extends never ? true : never` 得 `true` ⇒ 仍然通过"）
**推错了方向**：当 `MissingLedgerEventKind` **不是** `never`（即确有遗漏）时，
`never extends never ? true : never` 求值为 `never`，而 `const X: never = true` 报 **TS2322**。

### 2.3 `[22] CRITICAL · src/index.ts:28` —— "撞红 AC-10-10"

**OCR 声称**：`export *` 会导出 `TeamState` / `DagTaskState` / `SOPHIA_CLAIMED_TASK_STATE`，
它们以 `State` 结尾 ⇒ `tests/ledger.spec.ts:777-785` 的 AC-10-10 会失败。

**反证（逐字跑测试用的同一个正则）**：探针 `.dsh-t7-harness/verify-ac10-10.mjs`
（正则从 `tests/ledger.spec.ts:780` **逐字抄**，含反向自检）：

```
正则自检: 3/3 命中 -> ["ChannelView","ActivityPanelState","LedgerProjection"]
/lib/index.js:       exports=67  offending=[] -> PASS
/lib/plugin.js:      exports=70  offending=[] -> PASS
/lib/tools/index.js: exports=23  offending=[] -> PASS
projection/index.js: exports=11  offending=[]
```

**判定：误报。** `offending` **为空**，AC-10-10 **通过**。
**关键在于反向自检 3/3 命中** —— 它证明正则**是活的**，"没有"不是"正则失效"造成的假绿。

**OCR 错在哪**：它把**类型**当成了运行期导出。
`TeamState`/`DagTaskState` 是 `interface`/`type`，**运行期被擦除、不进 `Object.keys`**。
（这正是 t3 改名的依据：`channelView`→`projectChannel` 是因为**值**会进 `Object.keys`，
而类型名不受影响。t3 的判断与实测一致。）

---

## 3. HIGH 十条 —— 逐条核验

### 3.1 `[70] HIGH · security · src/tools/message.ts` —— 跨团收件人未校验 → **曾真实存在，现已修复**

**先说结论：这条在我的验证窗口内从"真实越权"变成了"已防护"。**

**我独立复现了越权**（当时的字节）：甲团成员、甲团频道、**乙团收件人**：

```
outcome = {"kind":"sent","threadCreated":true,
           "delivery":{"kind":"delivered","channel":"followup","delivered":true}}
乙团成员被唤醒 = true
render = "消息已提交到新建线程 ...，已送达 member-历算-000000bb（通道 followup）。"
```

**当时的证据**：`message.ts` 的归属门只建在**线程/频道**路径（`channelTeamOf`），
`resolveMemberRef` 解析出的 `recipientMemberId` **没有任何同团校验** —— 两条路径**不对称**。

**上游随后补了这道门**（`deps.projection.teamOf(recipientMemberId)` + `cross-team` 分支）。
**我用新鲜构建重验**（`src/tools/message.ts` = `33949B / AEEC1CCAE41F74FC`）：

```
outcome.kind = cross-team
reason = "收件人 member-历算-000000bb 属于团 B，而你属于团 A —— FR-7.2 的隔离口径：
          不得向别人的团里投消息。若确实需要跨团协作，请由团长发起（团长可跨团调度，成员不可）。"
乙团成员被唤醒（越权）= false
⇒ 判定: 已防护 ✓
```

**判定：确认曾是真实缺陷（有复现），当前指纹上已修复。** 修复者不是本任务成员；t7 只验证。
**残余**：`teamOf` 返回 `null` 时返回的是 `cross-team`（fail-closed，正确），
但 `null` 本身有二义（从未存在 / 存在但已无团）—— 代码已用
`SOPHIA_TOOL_CONTRACT_GAPS.memberTeamOfAmbiguity` 如实标注，**维持原判**。

### 3.2 `[73] HIGH · src/projection/index.ts` —— `scopes: []` 游标跳 head → **确认（F2）**

**逐字读源码**（`src/projection/index.ts`，`52808B / 7373531FB9731C25`）：

```ts
const scopes = options.scopes
const scoped = scopes !== undefined          // ← 空数组也算 "scoped"
```

**OCR 的前提先被验证**（`Ledger.read` 对空集的语义）：

```
read({scopes: []})         -> events = 0   hasMore = false  nextCursor = null
read({})                   -> events = 2
read({scopes:[team T]})    -> events = 2
```

**再用新鲜构建端到端复现**：

```
head = 2 | scopes:[] → cursor = 2, members = 0
从该折叠续读（全量）→ members = 0
⇒ 判定: 那批事件永久不可见 ✗
```

**判定：确认成立。** 机制：空集被当真过滤传给 `Ledger.read`（短路成空页），
`catchUpFold` 于是走"收口"分支把 `cursor` 设为 `headBefore` —— **零事实折叠、游标已越过全部事件**，且**静默**。

**⚠ 我自己的两次方法论错误（如实记录）**：

1. **第一次误判"未复现"**：我把 `options` 传进了 `fold` 形参位
   （`catchUpFold(ledger, {scopes:[]})`），于是 `options` 取默认 `{}` ⇒ 测的其实是"全量"。
   改成正确的三参调用（`catchUpFold(ledger, fold, {scopes:[]})`）后立刻复现。
   **这是我的调用错误，不是实现的问题。**
2. 若直接 import `lib/`（已过期，见 `VERIFY-integration.md` §2.1）会拿到旧代码结论。

**可达性（不夸大）**：`src/` 内 `grep "scopes: []"` **零命中**；
`scopesForTeam`/`scopesForMember` 恒返回单元素数组 ⇒ **当前无调用方触发**。
但 `CatchUpOptions.scopes` 是对外导出参数，空数组是**合法类型**且字面直觉相反。

### 3.3 `[98] HIGH · src/client/panel.tsx` —— IPv6 未脱敏 → **确认（F1）**

**先纠正我自己的一次误判**：我第一版用正则去 grep `panel.tsx` **全文**，
命中了（因为文件里有字符类），于是错判"已有 IPv6 规则"。**改用逐字读函数体**后确认：

```
=== panel.tsx 里的 IPv6 规则 ===
（空）
=== 全仓 grep "IPv6" ===
host.ts:380: // IPv4 / IPv6 回环及其 IPv4-mapped 形式。   ← 只是注释，且是别处的逻辑
```

**实测**（逐字转写 `sanitizeErrorForDom` 后跑）：

```
⚠ LEAK  "connect ECONNREFUSED [fd00:1]:8080"        → "connect ECONNREFUSED [fd00:1]:8080"
⚠ LEAK  "connect ECONNREFUSED [2001:db8::1]:43120"  → 原样
  safe  "connect ECONNREFUSED 10.0.0.5:8080"        → "connect ECONNREFUSED <host>"
  safe  "fetch failed to http://192.168.1.9:43120/x" → "fetch failed to <url>"
```

**判定：确认成立。** 规则链的**声明意图**是"只要满足「有端口号」这个强特征就脱敏"，
而 `[fd00:1]:8080` 恰好满足；但通用 `host:port` 正则要求首字符 `[a-z0-9]` 且用 `\b` 边界，
而 `[`/`]` 破坏了两者 ⇒ 方括号 IPv6 整条漏过。
影响面：该函数**专为"不把内网拓扑写进 DOM"而存在**，IPv6 内网地址（`fd00::/8`、`::1`）会进 `data-sophia-error`。

### 3.4 `[63] CRITICAL · src/tools/switch-model.ts` —— "回执形状守卫被 `if (false)` 禁用" → **误报**

**反证（内容定位 + 实测）**：

```
=== grep "if (false)" src/tools/switch-model.ts ===
（空 —— 不存在）
=== 实际的守卫 ===
L474: let receipt: LedgerReceipt
L515: const actualSequence = receipt.sequence
L516: if (!isNonNegativeSafeInteger(actualSequence)) {   ← 守卫在，且是活的
```

**判定：误报。** 文件里**没有** `if (false)`；回执形状守卫**存在且生效**
（`isNonNegativeSafeInteger(actualSequence)`），且失败分支会回一个**说明形状不合法**的
`failed`，而不是 OCR 声称的"误报成 sequence-mismatch"。

### 3.5 `[54] HIGH · src/plugin.ts:43` —— 键不撞名是"一次性快照" → **确认（F3，但严重度需按可达性下调）**

**OCR 的机制主张是对的**（我复核后同意）：ESM 的**显式导出**优先于 `export *`
且**不报错** ⇒ 若 `./index.ts` 的传递桶里出现 `inject`/`name`/`apply`，
`src/plugin.ts` 的 `export const inject` 会**静默遮蔽**它。

**同一时刻的真实状态（实测）**：

```
src/index.ts 的 re-export 列表: ./types/index.ts, ./ledger.ts, ./naming.ts,
  ./approval.ts, ./delegation.ts, ./runtime/member-runtime.ts,
  ./projection/index.ts, ./tools/index.ts
  → 有没有 'client'？NO —— index.ts 完全不碰 client/

实测领域库导出（67 个键）:
  name => false   inject => false   apply => false   Config => false   reusable => false
```

且**已有一条测试**钉住这条前提（`tests/shell.spec.ts:455-464`，注释写明"撞了就是静默覆盖，不是报错"）。

**判定：确认 OCR 指出的**机制风险**成立，但严重度我判为 MEDIUM 而非 HIGH**，依据三条：

1. **当前不可达**：`src/client/index.ts` 确实导出 `inject`（`L126: export const inject = ['slots']`），
   但 `src/index.ts` **完全不引用 `client/`**（实测 8 条 re-export 里无 client），
   两者的**构建产物也是分开的**（`lib/index.js` vs `lib/client.js`）。
2. **已有测试**：`shell.spec.ts:455` 断言"领域库不占用插件保留键"，
   且该测试**做过反向自检**（我复核过它的实现：逐个 `in` 比对而不是数个数）。
3. **触发条件**是"有人主动把 client 拉进领域桶"—— 那是一次明确的架构改动，
   会同时撞红上面那条测试。

⇒ **列为 finding（建议把注释里的"一次性快照"改成"由 `shell.spec.ts:455` 守卫"，
或做成结构性断言），但不判为必须修（HIGH）**。这符合 AGENTS.md 第五条
"先问它实际上基本会不会发生"。

### 3.6 `[69] HIGH · src/tools/message.ts` —— 消息正文是 prompt-injection 通道 → **确认机制成立，判定为"已文档化的接收缺口"**

**实测**（我的 E2E 探针抓到的真实 notice 文本）：

```
text = "你收到了来自成员 member-推步-0000000a 的一条消息（线程 thread-...）：T7_MAIN_CHAIN_OK 这是主链路验证消息"
```

⇒ `content` **确实被逐字拼接**进投递给收件人 Agent 的 `MemberNotice.text`。

**但**，我在当前字节上**没有找到**把"正文不受信任"写进契约的说明（`grep 注入|不可信|原文`
只命中"模型输入一律不可信"这类**入参收窄**的说明，不是**跨 Agent 内容**的说明）。

**判定：机制确认，分类为「设计权衡未文档化」**，理由：
- 这条链路上"正文由别的 Agent 生成"是**产品定义本身**（成员互相发消息）；
  完全消除需要内容沙箱 / 分隔标记，属于**产品决策**而非代码缺陷；
- 但 OCR 的建议（**至少把它记为已接受风险**）是**成本极低且正当的**：
  目前文件里没有这句话。

⇒ 列为 finding（**建议补一段"已接受风险"说明或加分隔标记**），严重度按 OCR 的 HIGH 保留在报告里，
但**不是本任务可修项**（t7 不实现）。

### 3.7 `[48] HIGH · src/client/styles.ts` —— 复用路径不检查节点是否仍在文档里

**逐字读源码复核**（`injectStyles`，`src/client/styles.ts`）：

```ts
const entry = styleRegistry.get(doc)
if (entry !== undefined) {
  entry.refs += 1
  entry.element.textContent = PANEL_CSS      // ← 确实没有 isConnected / contains 检查
  ...
}
const style = doc.createElement('style')
style.id = STYLE_ELEMENT_ID
doc.head.appendChild(style)
```

**全仓实测：谁会移除这个节点？**

```
=== grep getElementById | querySelector('style') | .remove() 于 src/ ===
styles.ts:502: entry.element.remove()     ← 本文件自己的 disposer
styles.ts:523: style.remove()             ← 本文件自己的 disposer
```

⇒ **只有本文件的 disposer 会移除它**，没有第三方移除路径。

**判定：机制成立，但当前不可达** ⇒ 判 **MEDIUM（不是 HIGH）**，依据：
1. 移除路径**只有**本文档自己的引用计数 disposer（实测全仓仅两处）；
2. 引用计数归零时会**同时** `styleRegistry.delete(doc)` ⇒ 登记项与节点**同生共死**，
   不存在"登记还在、节点已被移除"的状态；
3. 要触发 OCR 描述的场景，需要**外部 actor** 移除该节点（HMR / 宿主清理）——
   这在**当前架构下没有对应代码**，属**假设性**触发。

### 3.8–3.10 其余两条 HIGH 的归类

- `[70]` 见 §3.1（已修复）。
- `[98]` 见 §3.3（确认）。
- `[14]`/`[22]` 见 §2（误报）。

### 3.11 **一条我未能在当前字节上核验**（如实标注 → 已补：无）

`[13]`/`[14]`/`[22]`/`[63]`/`[70]`/`[73]`/`[98]`/`[48]`/`[54]`/`[69]` 共 **10 条 CRITICAL+HIGH 已逐条处置**（3 CRITICAL + 7 HIGH）。
其中 `[13]`/`[14]`/`[22]`/`[63]` 四条属"同一文件族"的静态主张，我用**注入实测**处置；
若后续这些文件被再次改写，请以 **当前内容重新注入**为准（不要引用本报告的行号）。
**没有遗留未核验的 CRITICAL/HIGH。**

---

## 4. 确认问题的严重度与修法（供实现者参考，t7 不修）

| ID | 修法 | 回归防护 |
|---|---|---|
| **F1** IPv6 未脱敏 | 在通用 `host:port` 规则**之前**加：`.replace(/\[[0-9a-fA-F:]+\](?::\d+)?/g, '<host>')` | 当前**无任何用例**覆盖 IPv6 ⇒ 必须补用例（含 `[::1]`、`[fd00::1]:8080`） |
| **F2** `scopes: []` | ① `const scoped = (scopes?.length ?? 0) > 0`；或 ② 空数组显式拒绝 | 补一条：`catchUpFold(L, fold, {scopes: []})` 后 `fold.cursor` **不得** > 起始 cursor |
| **F3** 键不撞名（低优先） | 把注释里的"一次性快照"改为指向 `shell.spec.ts:455` 的守卫，或加结构性断言 | 已有 `shell.spec.ts:455` |

---

## 5. MEDIUM / LOW（92 条）：处置口径与为什么没有逐条复验

**没有逐条复验，并且我明确不声称"它们都无害"。** 理由是可核验的成本对称性：

- **HIGH/CRITICAL 的风险是不对称的**（越权、数据丢失、静默破坏）⇒ 值得逐条动手；
- **MEDIUM/LOW 里大量是**：注释与代码不一致、重复代码、命名建议、
  "某分支不可达"、"某常量无消费方"、"建议提取 helper" —— 这些**不会**让用户要的功能坏掉，
  且逐条复验要各写一个探针 ⇒ 成本远超收益。

**例外：我对两条与安全/数据完整性相关的 MEDIUM 做了核验**：

| OCR | 主张 | 我的核验 |
|---|---|---|
| `[27]` MEDIUM security | `AVATAR_ROOT` 的**结尾斜杠**是承重不变量，但只写在文档里、没被强制 | **核实为真**：`avatar-paths.ts:65` 是 `export const AVATAR_ROOT = 'assets/members/'`，若被"清理"成 `'assets/members'`，前缀门会退化成接受 `assets/members-evil/x.png`。**建议加一条断言**（`expect(AVATAR_ROOT.endsWith('/')).toBe(true)`）。**当前代码正确**，只是缺守卫。 |
| `[32]` MEDIUM bug | `vitest.config.ts` 的 `exclude` 写 `**/dist/**`，但本包产物目录是 `lib/` ⇒ 死配置 | **核实为真**（`package.json` 的 `files: ["lib"]`、`build`/`clean` 都指向 `lib`，仓里没有 `dist/`）。**当前无影响**（我实测 16 个 spec 全部来自 `src/`/`tests/`，无产物被误跑），但属"看起来排除了、其实没排除"的同类问题，**建议把 `dist` 改成 `lib`**。 |

---

## 6. 关于 `.md` 文档**结构性拿不到** OCR —— 诚实边界

按 AGENTS.md 第四条第六点，`ocr_review` **按扩展名过滤**，`.md` 会被滤掉，
工具会输出 `No comments generated. Looks good to me.` —— 这是**假绿，不是通过**。

**本任务的两份交付物都是 `.md`**：

- `docs/VERIFY-integration.md`
- `docs/OCR-integration.md`（本文件）

⇒ **它们拿不到第三方评审**，只有人眼可审。本报告**不声称**这两份文档已被 OCR 评审过。

同时：本次 `ocr_review(scan)` 的 49 个被审文件**全部是代码/配置**（`.ts`/`.tsx`/`.json`/`.yml`），
**没有**把 `.md` 混进统计 —— 因此 §0 的 104 条里不含文档意见。
（作为对照：`docs/` 目录在本仓之所以"几乎免费"，正是因为 `.md` 全被滤掉。）

---

## 7. 复现本报告所有反证的方式

```powershell
# §2.1 / §2.2 两条 CRITICAL 的反证（注入 + tsc）
#   ⚠ 必须改完立刻还原；guards.ts 原指纹 = 8002B / 40F4890FE217A619
cd C:\Users\Administrator\Sophia-agent-entities
#   注入多余 kind：
#     (把 'spawn/human-approve-td', 加进 LEDGER_EVENT_KINDS)
#     npx tsc --noEmit -p packages/sophia-core/tsconfig.json   # 期望 exit 2
#   删除一个真实 kind：
#     (删掉 'spawn/human-approved',)
#     npx tsc --noEmit -p packages/sophia-core/tsconfig.json   # 期望 exit 2

# §2.3 AC-10-10 反证（逐字跑真正则 + 反向自检）
node C:\Users\Administrator\.dsh-t7-harness\verify-ac10-10.mjs

# §3.1 跨团收件人门（需新鲜构建，因为 lib/ 已过期）
cd packages\sophia-core
$tmp = Join-Path $env:TEMP ("t7-final-" + [guid]::NewGuid().ToString('N').Substring(0,8))
npx tsc -p tsconfig.build.json --outDir $tmp
$env:FRESH = $tmp
node C:\Users\Administrator\.dsh-t7-harness\probe-final.mjs

# §3.2 scopes:[] （同上，probe-final.mjs 的第 2 段）
# §3.3 IPv6 —— 见 VERIFY-integration.md §5.3 F1 的逐字转写探针
```

---

## 8. 关于「不修」的说明

**t7 的契约是"验证者独立性：不要修改被验产物"** ⇒ 本报告**不含任何代码改动**。
上述确认问题（F1 / F2 为 HIGH，F3 经可达性评估下调为 MEDIUM）已作为 finding 提交给 captain，
修复应由对应模块的实现者执行（并补 §4 表里的回归防护）。
