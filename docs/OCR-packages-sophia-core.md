# `packages/sophia-core` OCR 意见归档（逐条可勾销）

> 整理者：`数象主事`（`t3`）
> 日期：2026-09-23
> 来源：`ocr_review(mode="review")` 一轮（`packages/sophia-core`，**36 条**：HIGH 4 / MEDIUM 11 / LOW 21）
> 指纹基线时间：**2026-09-23 22:47:25**（下方 §7 为全部被引用文件的 sha256）

## 0. 这份文件是干什么的，以及它的诚实边界

**用途**：`t7`（`星验主事`）要独立验收。没有一份**逐条可勾销**的清单，`t7` 就得**重跑一遍 OCR** 才能知道哪些已修 —— 代价高且会漏。本文件给每条一个**状态**栏，勾销即可。

**⚠️ 结构性诚实边界（必读）**：

1. **`.md` 拿不到第三方 OCR 评审。** ocr 按扩展名过滤，`0 file(s) reviewed` 时会输出 `No comments generated.` —— 那是**假绿，不是通过**（见 `~/.AGENTS.md` 四.6）。**本文件只有人眼可审**，没有任何机器评审背书。
2. **行号是会过期的。** 本批已多次出现「评审引用的行号指向已经不存在的字节」（同族事故见 `~/.AGENTS.md` 四.7）。因此每条**同时给 sha256 与函数名/锚点串**；`t7` 勾销时请**按 sha256 + 内容锚点定位**，不要只信行号。
3. **本文件的行号是 22:47:25 那次采集的当前值**，不是 OCR 原始输出里的行号。**OCR 原始行号有 8 个文件已经失效**（`message.ts` / `rollover.ts` / `switch-model.ts` / `task-claim.ts` / `styles.ts` / `panel.tsx` / `seats.tsx` / `host-tools.ts` 在评审后被改写过）—— 我已逐条重新定位。
4. **状态是我核实的结论，不是 OCR 的结论。** OCR 只给「可能有问题」；每条真/假/已修都是我读**当前源码**后的判断，依据写在该条里。

## 1. 状态图例

| 状态 | 含义 |
|---|---|
| **待修** | 我核实**成立**，且当前源码里**仍然存在** |
| **已修** | 我核实**成立**，但当前源码里**已经修好**（多为本轮派单后 owner 已动手） |
| **误报** | 我核实**不成立**，并给出可核验的反证 |
| **落点在他人** | 该条描述的现象成立，但**根因不在本文件**，修别处才有效 |
| **部分已修** | 同一条里有的子项已修、有的未修 |

---

## 2. 四组同族缺陷（**先看这节**）

> 为什么单列：**同族缺陷的修法应当一致**，而单条修完容易再犯。下列每组是「**同一类缺陷的多个落点**」。
> 这也是本轮最有价值的产出 —— 它**不是** OCR 直接给的，是逐条核对时聚出来的。

### 族 A · `head().sequence` 缺形状校验（3 个落点 / 2 个缺）

**统一修法**：读 `head().sequence` 后、做 `+1` 之前，先 `isNonNegativeSafeInteger(head.sequence)`；不满足则**如实报「Ledger adapter 违反契约」**，**不要**让它退化成 `sequence-mismatch`（那会把「适配器坏了」伪装成「有并发写入者」）。参考实现：`tools/switch-model.ts:439`。

| 落点 | 当前行 | 状态 |
|---|---|---|
| `src/tools/switch-model.ts` | `:439` 有校验、`:516` 也校验 receipt | ✅ 参考实现 |
| `src/tools/task-claim.ts` | `:443` 已加 `!isNonNegativeSafeInteger(head.sequence)` → `failed` | ✅ **已修**（[17]） |
| `src/host-data.ts` | `:537` 已加同一守卫；`:574` 另校验 `receipt.sequence` | ✅ **已修**（[10][11]） |

> **族 A 现已三处齐整**（`switch-model` / `task-claim` / `host-data` 同一处置）。下面这段「代价不对称」的说明**保留** —— 它记录的是当时的分诊理由，也正是 `host-data` 那份修复注释所引用的内容：

**⚠️ 两处缺口的「代价不对称」，不要当成一条修**（已报 captain 并转 `星仪主事`）：

- `task-claim.ts`：后果是**误报** `sequence-mismatch`（`actualSequence !== NaN` 恒真）⇒ 掩盖真因，**可恢复**。
- `host-data.ts`：`predicted` 变 `NaN` 后**被写进不可撤销的账本**（`effectiveAtSequence` 序列化成 `null`）⇒ **污染永久留档，不可恢复**。**优先修这条。**

### 族 B · 调用方 / 收件人身份未 fail-closed（4 个落点 / 1 个缺）

**统一修法**：**身份是前置条件**。取不到非空白身份就不进入任何授权门，直接拒绝（`fail-closed`），并**不得让异常穿透 `execute`**（工具契约是「只返回错误、绝不抛」）。参考实现：`tools/switch-model.ts:328`、`tools/task-claim.ts:248`。

| 落点 | 当前行 | 状态 |
|---|---|---|
| `src/tools/switch-model.ts` | `:328` `isNonEmptyString(callerMemberId)` | ✅ 参考实现 |
| `src/tools/task-claim.ts` | `:248` 显式判 `caller === null/undefined` | ✅ 参考实现 |
| `src/tools/message.ts` | `:409` 收件人**同团门** | ✅ **已修**（[30]） |
| `src/tools/spawn-team.ts` | `:648` `deps.caller.memberId` **无形状校验** | **待修**（[18]，灵台郎） |

`spawn-team.ts` 这条要单独说清：`:648` 前的 `try` 只包了 `callerKindOf` 的**调用**，而 `deps.caller` 为 `null` 时**属性访问本身在 `try` 覆盖之外** ⇒ 抛 `TypeError` 逃出 `execute`。这与 `task-claim.ts:242-248` 那段「初版直接 `.trim()` 有两种坏结果」的教训**逐字同源**，而那条教训**没有被施加到 spawn-team**。

### 族 C · `JSON.stringify` 无保护地出现在「错误消息构造」里（3 处 / 2 处成立）

**统一修法**：错误消息构造路径**必须自身不抛**。序列化前先 `try/catch`，失败回退到 `String(value)` / `typeof value`。因为**能走到这些分支恰恰说明值形状不对**（`BigInt`、循环引用、`Symbol` 都能让 `JSON.stringify` 抛）。

| 落点 | 当前行 | 状态 |
|---|---|---|
| `src/runtime/member-runtime.ts` | `:266` `JSON.stringify(item)` | **待修**（[3]，推步主事） |
| `src/runtime/member-runtime.ts` | `:907` `JSON.stringify(name)` | **待修**（[19]，推步主事） |

- `:266` 在 `validateNoticeShape` 里，而它被 `notify()` **最外层、无 try/catch** 调用，`notify` 的契约是「never throws」⇒ 循环引用输入会让 `TypeError` 逃出去，**正是这个函数存在的意义所在**。
- `:907` 那条更「自证」：该分支**恰好在 `typeof name !== 'string'` 时进入**，所以 `1n`（BigInt）或循环对象会让它自己抛。

### 族 D · `surfaces` 标记与「实际是否登记成功」不对称（3 处）

**统一修法**：标记只在**登记真的成功**时写 `true`。`host.effect` 不可调用时 `registerEffect` 会早退 ⇒ 资源从未申请 ⇒ 标记**不得**声称已就绪（本文件自己的「不谎报」契约）。

| 落点 | 当前行 | 状态 |
|---|---|---|
| `src/client/index.ts` `surfaces.styles` | `:296-305` 已改为 `surfaces.styles = registerEffect(...)` | ✅ **已修**（[6][7]） |
| `src/client/index.ts` `surfaces.locale` | `:263` 已改为 `typeof disposeDict === 'function' ? ... : true` | ✅ **已修**（[8]） |
| `src/host.ts` view 路由静默降级 | `:522-536` 已加 `repoRoot === null` 的 `console.error` 留痕 | ✅ **已修**（[12]） |

`client/index.ts` 的修法是**把 `registerEffect` 的返回类型从 `void` 改成 `boolean`**（`return false` 于早退/登记失败两处），调用方据此决定写不写标记 —— 这比「把赋值挪进 effect 体」更强，因为它同时覆盖了 `host.effect` **抛错**那条路径（此时 `execute` 可能已跑过、资源已申请而 disposer 未被接管）。

---

## 3. 按 owner 分组（每组内按严重度降序）

### 3.1 `星仪主事`（`t1` · `host.ts` / `host-data.ts` / `host-tools.ts` / `wire.ts` / `avatar-paths.ts`）

| # | 位置 | 严重度 | 问题 | 我核实的结论 | 修法要点 | 状态 |
|---|---|---|---|---|---|---|
| [25] | `src/host-data.ts:117`（`resolvePathUnderAssets`） | MEDIUM | 校验 `realPath` 但返回**词法** `absolutePath` ⇒ `readAvatarBytes` 打开的是未校验的路径，符号链接 TOCTOU 窗口 | ✅ 成立（安全）；**已修**：现为 `return { kind: 'ok', absolutePath: realPath }` —— 返回的是**被验证过的规范路径**，窗口关闭 | 已修 | **已修** |
| [10] | `src/host-data.ts:537` | MEDIUM | `predicted = ledger.head().sequence + 1` 无形状校验 ⇒ `NaN` **写入不可撤销的账本** | ✅ 成立，族 A；**已修**：`:537` 起校验 `isNonNegativeSafeInteger(head.sequence)` → `failed`。修法注释**逐字采纳了我提的分诊理由**：「为什么这里比那两处**更重**……`NaN` 会被序列化成 `null` 落进不可撤销的账本……那两处只是把真因误报成 `sequence-mismatch`，这里是**污染账本本身**」 | 已修 | **已修** |
| [11] | `src/host-data.ts:574` | LOW | `receipt.sequence` 比较/返回前无形状校验 | ✅ 成立，与 [10] 同处；**已修**：`:570` 注释「族A 同处，队长一并指出」，`:574` 校验 `actualSequence` 后才与 `predicted` 比较 | 已修 | **已修** |
| [12] | `src/host.ts:522-536` | LOW | `viewRoute` 静默传 `repoRoot: undefined`（答 200、无日志），而 `avatarRoute` 明说 404 + 原因 | ✅ 成立，族 D；**已修**：`repoRoot === null` 时补一条可检索的 `console.error`（注明「不影响视图其余字段，可用 `SOPHIA_REPO_ROOT` 指定」）。**有意不改状态码**（视图本身仍有效）—— 这个取舍是对的 | 已修 | **已修** |
| [9] | `src/host.ts:634-644` | HIGH | `sequence-mismatch` 回 **HTTP 200** + body `ok:false`，客户端只判 HTTP 状态 ⇒ 异常被当**成功**吞掉 | ✅ 成立；**但两侧现在都已修**：host 侧 `:634-644` 回 200 是**有意为之**（事件已写入、不伪装成可重试，否则重试会写第二条）；client 侧 `panel-store.ts:442-465` 现在**读业务层 `ok`**、要求 `ok === true`，还区分出 `applied-with-anomaly` | 无需再改 host；client 已消费该标记 | **已修** |

### 3.2 `灵台郎`（`t4` · `src/tools/*`）

| # | 位置 | 严重度 | 问题 | 我核实的结论 | 修法要点 | 状态 |
|---|---|---|---|---|---|---|
| [17] | `src/tools/task-claim.ts:443` | HIGH | 读 `head().sequence` 无形状校验 | ✅ **成立**，族 A。`:437` 的 `try/catch` 挡不住「返回了 `undefined`」（不抛，但 `+1` 变 `NaN`）；**已修**：`:443` 起 `if (!isNonNegativeSafeInteger(head.sequence))` → `failed`，理由串明确写「拒绝把它当成跨进程并发上报（那是两件不同的事）」 | 已修 | **已修** |
| [30] | `src/tools/message.ts:409` | HIGH | 收件人不校验是否同团 ⇒ 可唤醒**别团**成员 | ✅ 成立；**已修**。`:409` 起有 `cross-team` 门，注释写明「两条路径此前不对称」「实测复现」 | 已修，无需动作 | **已修** |
| [18] | `src/tools/spawn-team.ts:648` | MEDIUM | `deps.caller.memberId` 无校验；`null` 时 `TypeError` **逃出 `execute`** | ✅ **成立**，族 B | 见族 B；参照 `task-claim.ts:248` | **待修** |
| [20] | `src/tools/task-claim.ts:389` | MEDIUM | `unfinished` 只判了 `Array.isArray`，**元素类型未校验** | ✅ 部分成立：`:389` 已加数组守卫（注释自述为 `[3] 形状守卫`），但 `readonly string[]` 的**元素类型仍未校验** ⇒ `[1, {}]` 会进 `blocked` 并被 `join('、')` 播出去 | 与同文件 `taskStateOf` 的严格口径对齐，非字符串元素判 `failed` | **部分已修** |
| [15] | `src/tools/rollover.ts:238-258` | MEDIUM | `duplicate` 已成不可达死文案（`wake !== 'delivered' && wake !== 'duplicate'` 已把它归入成功） | ✅ **成立**。构造点明确写「只有真正没投递的才算失败」。**但注意**：`cause` 是 `Record<MemberWakeOutcome['kind'], string>`，**键必须齐全** ⇒ **不能直接删掉 `duplicate` 那项**（会编译不过） | 改**注释**说明 `duplicate` 由 `handed-over` 分支承载（或把 `cause` 改成 `Partial<...>` + 兜底文案）。两个方案都可，别只删键 | **待修** |
| [16] | `src/tools/rollover.ts:403`、`:411` | LOW | 两个 `failed` 返回**漏 `gaps`**，而同文件另三处 `failed`（`:306`/`:351`/`:394`）都带 | ✅ **成立**（逐处核对：`:146` 是类型声明不是返回点；`:403`/`:411` 确实无 `gaps`） | 补 `gaps: [SOPHIA_TOOL_CONTRACT_GAPS.rolloverCheckpoint]`，与同族对称 | **待修** |
| [13] | `src/tools/message.ts:58` | LOW | `isNonEmptyString` 死 import | ✅ **成立**：该符号全文仅出现在 `:58` 的 import 行；`:163` 那处是**注释里**提到 | 删 import | **待修** |
| [29] | `src/tools/switch-model.ts:71` | LOW | `badFieldReason` 死 import | ✅ **成立**：全文仅 `:71` 一处 | 删 import | **待修** |
| [14] | `src/tools/message.ts:33` | LOW | 文档写 `ref` 的随机段是 `<uuid8>`，实现是全 `randomUUID()` | ✅ 成立（`tools.spec.ts` 有用例钉死 ≥32 字符）⇒ **改注释，不要改代码** | 把头部文档改成与实现一致；改代码会让既有用例变红 | **待修** |

### 3.3 `推步主事`（`t2` · `src/runtime/member-runtime.ts`）

| # | 位置 | 严重度 | 问题 | 我核实的结论 | 修法要点 | 状态 |
|---|---|---|---|---|---|---|
| [19] | `:907`（`normalizeToolPolicy`） | MEDIUM | `JSON.stringify(name)` 在「`name` 非字符串」分支里无保护；`BigInt`/循环引用会让它自己抛，破坏「never throws」契约 | ✅ **成立**，族 C | 见族 C | **待修** |
| [3] | `:266`（`validateNoticeShape`） | LOW | 同上，`JSON.stringify(item)`；`notify()` 最外层无 `try/catch`，契约是 never-throw | ✅ **成立**，族 C。`item` 走到这里**恰好是形状非法**时 | 见族 C | **待修** |
| [4] | `:648` 等（`LOG_PREFIX`） | LOW | `warn()` 未内置 `[sophia]` 前缀，靠每个调用点自己插 | ✅ 成立（`LOG_PREFIX` 在多处被手工插值） | 把前缀挪进 `warn()` 内，使其**不可能被漏** | **待修** |
| [5] | `:660` 等（`asMemberHandle` / `handleOf`） | LOW | `handleOf()` 每次返回**新对象** ⇒ 引用相等 / `Map`·`Set` 成员判定 / React 依赖数组都会出错 | ✅ 成立（`asMemberHandle` 每次构造新字面量）。当前仅测试消费，但**是公开 API** | 按 `memberId` 记忆化，或**明确文档化「身份不稳定」**（二者皆可，别不写） | **待修** |

### 3.4 `历算主事`（`t5` · `src/client/*` + `scripts/*`）

| # | 位置 | 严重度 | 问题 | 我核实的结论 | 修法要点 | 状态 |
|---|---|---|---|---|---|---|
| [6] | `src/client/index.ts:296-305` | MEDIUM | `surfaces.styles = true` 写在 `registerEffect` 回调**之外**，`host.effect` 不可调用时资源从未注入、标记却报 true | ✅ 成立；**已修**（族 D） | 已修 | **已修** |
| [7] | 同上 | MEDIUM | **OCR 与 [6] 重复报告了同一条**（同一行、同一论证） | ✅ 同 [6] | — | **已修**（重复条目） |
| [8] | `src/client/index.ts:263` | LOW | `surfaces.locale` 同族不对称 | ✅ 成立；**已修**（族 D） | 已修 | **已修** |
| [26] | `scripts/verify-t5.mjs:85` | MEDIUM | 硬编码下限 `≥ 574`，非从任何来源推导 ⇒ 用例数**合法减少**时把真结论判成 FAIL | ✅ 成立；**已修**。`:85` 注释「**不写死 `≥574`**（captain 派修 [26]）：用例数一涨就假红的判据是**负债**」，判据改为结构性信号 | 已修 | **已修** |
| [31] | `scripts/sophia-client-smoke.mjs:74-77` | MEDIUM | `factory` 未定义时抛 `TypeError` 崩掉整个脚本，**丢失全部诊断输出** | ✅ 成立：`check()` 非致命（只累加 `failures`），执行会继续走到 `factory(...)`；**已修**。`:75` 起 `if (typeof factory !== 'function')` ⇒ 如实记为失败并输出已有结果 | 已修 | **已修** |
| [24] | `src/client/panel.tsx:132` | LOW | 渲染期 `console.warn` ⇒ 每次 render 都打；持久错误态会**每次重打整个原始串** | ✅ 成立 | 挪到错误被记录处（store 的 `settle`），或去重为「每个不同错误只打一次」 | **待修** |
| [27] | `scripts/verify-t5.mjs:63-69` | LOW | 硬编码 `Version 5.9.3` | ✅ 成立；**已修**。`:63` 注释「断言**形状**而不是写死版本（captain 派修 [27]）」，改为 `/^Version \d+\.\d+\.\d+/` —— 既挡住 npx 的安装提示（内容锚定），又不会在合法升级后假红 | 已修 | **已修** |
| [33] | `scripts/check-t5-structure.mjs`（路径解析处） | LOW | 按 `process.cwd()` 解析路径，只在仓库根跑才对 | ✅ 成立；兄弟脚本 `verify-t1-shell.mjs` / `sophia-client-smoke.mjs` 都从 `import.meta.url` 推导 | 改从 `import.meta.url` 推导仓库根 | **待修** |
| [32] | `scripts/check-t5-structure.mjs:131` | LOW | `indexOf('\n`')` 会匹配**第一个**行首反引号 ⇒ 模板内若出现行首反引号（正是该检查要抓的陷阱）会**误判为正常终止**（假阴性） | ✅ 逻辑成立 | 按「整行恰为一个反引号」定位闭合行，或从开引号处扫描 | **待修** |
| [22] | `src/client/components.tsx:133` | LOW | `data-sophia-visual` 由本地 `DotVisual` 映射派生，而实际渲染又由 `dotVisualOf` 独立再推一次 ⇒ 两套词汇表会漂移且**无编译错误** | ✅ 成立（`data-sophia-presence` 写原始值、`data-sophia-visual` 折叠，两者已不同构） | 让 `data-*` 直接取自 `DotVisual`（单一来源），或加断言钉住二者一致 | **待修** |
| [23] | `src/client/components.tsx:210` | LOW | `position` 可为空串 ⇒ 标题拼出 `" · 跟随全局默认"`（前导分隔符） | ✅ 成立 | 分隔符按 `position` 是否为空条件加 | **待修** |
| [28] | `src/client/react-runtime.ts:64` | LOW | `useRef<T>` 返回 `{ readonly current: T }`，与 React 实际可变的 `current` 不符 ⇒ 该门面**无法用于赋值** | ✅ 成立（React 18 `MutableRefObject` / 19 `RefObject` 都暴露可变 `current`） | 去掉 `readonly` | **待修** |
| [34] | `src/client/styles.ts:115` | LOW | `sp-entry-glyph` 在 `seats.tsx` 被用作 className，但 `PANEL_CSS` 里**无对应规则**（死类） | ✅ 成立：全文 `entry-glyph` 字面只出现 **1** 次（即 `:115` 的 CLASS 映射行），`CLASS.entryGlyph` 插值 **0** 次 ⇒ **确无规则** | 加规则或删类（现靠 `<svg>` 自带 `width/height/stroke` 才对） | **待修** |
| [35] | `src/client/panel.tsx` | LOW | 嵌套三元链（本仓 checklist 禁止；同 PR 别处已抽 `dotVisualOf`/`segmentToneOf` 规避） | ✅ 成立 | 抽 `phaseOf(snapshot)` 纯函数 —— **与 `数象主事` 的 `bySequenceThenId` 同类，captain 已裁定「优先级排后」，全团口径宜统一** | **待修**（低优先） |
| [36] | `src/client/seats.tsx:35` | LOW | `EntrySeatProps.active` 声明后从未被读（只用了 `size`），是死 API | ✅ 成立：`active` 全文仅 `:35` 一处声明 | 要么消费它，要么删掉使契约与实际一致 | **待修** |

### 3.5 `数象主事`（`t3` · 我自己）

| # | 位置 | 严重度 | 问题 | 我的结论 | 处理 | 状态 |
|---|---|---|---|---|---|---|
| [1] | `packages/sophia-core/team.ts`（**根级**） | HIGH | 「未被引用的 `src/types/team.ts` 重复文件，含 roster `model?` 文档；不被任何 tsconfig include、import `./ids.ts` 无法解析」 | ✅ **完全成立，且是我自己造的残留**：我一条 PowerShell 写错 —— `Copy-Item -Path src\types\team.ts -Force` **漏写 `-Destination`** 时**不报错**，而是把文件复制到**当前目录** ⇒ `packages/sophia-core/` 下凭空多出 7883B 的副本（未跟踪）。我已**实测复现**该行为 | **已删除**（`Test-Path=False`；全树 `__probe*.ts` 0 个） | **已修** |
| [2] | `src/types/team.ts:124` | MEDIUM | 文档自述「`narrowRoster` 白名单重建会静默丢 `model`，编译全绿」⇒ 初始模型到不了 `MemberAddedData.model` | ✅ 现象成立，**但这是「落点在他人」**：`narrowRoster` 在 `src/tools/spawn-team.ts`（**t4**），不在 `types/`。那段注释是我**故意**写给 `灵台郎` 的情报 | **不修**。改文档来「消掉」这个 MEDIUM 属粉饰；`t4` 修完（`normalizeRosterModel`）后自动失效 | **落点在他人** |

---

## 4. 误报（含可核验反证）

| # | 位置 | OCR 的主张 | 反证 | 状态 |
|---|---|---|---|---|
| [21] | `src/client/styles.ts:206` | 怀疑 `--dsw-alias-interactive-bg-active` **不存在于主题** ⇒ 选中行静默退化成 `rgba(...)` 灰色回退，且 `color` 不跟随填充 | **该 token 存在且在主题默认 CSS 里被定义 2 次**（浅/深色）：<br>`node_modules/@deepseek-ai/dsh-client-ui-theme/lib/client.js:1053`<br>`--dsw-alias-interactive-bg-active:#2631481a`<br>（对照 `--dsw-alias-interactive-bg-hover:#2631480f` 同样有定义）<br>⇒ 选中态**不会**退化到回退值 | **误报** |

**为什么它会误报**：OCR 只看到 `styles.ts` 里 `var(--token, 回退值)` 这种写法，就怀疑 token 不存在；它**没有去主题里核对 token 是否被定义**。这类「只凭使用点推断定义缺失」的误报本批已多次出现 —— 判定此类意见的正确做法是**去定义处核**。

---

## 5. 汇总（供 `t7` 快速勾销）

| 状态 | 条数 | 明细 |
|---|---|---|
| **待修** | 19 | [3][4][5][13][14][15][16][18][19][22][23][24][28][29][32][33][34][35][36] |
| **已修** | 14 | [1]（我删的残留）、[6][7]（同一条重复报告）、[8][9]、[10][11]（族 A 的 `host-data` 双落点）、[12]、[17]、[25]、[26][27]、[30][31] |
| **误报** | 1 | [21] |
| **落点在他人** | 1 | [2]（根因在 `t4` 的 `narrowRoster`） |
| **部分已修** | 1 | [20]（数组守卫已加，元素类型未校验） |
| **合计** | **36** | HIGH 4 / MEDIUM 11 / LOW 21 |

> `[6]` 与 `[7]` 是**同一条被重复报告**，故「待修+已修+误报+落点在他人+部分已修」= 36 而不是 37。

### ⚠️ 这是**移动靶** —— 勾销前必须重新核

我在 22:47 采集基线、起草本文件的过程中，**14 条「已修」里有 7 条是被 owner 在我写作期间修掉的**（`[10][11][12][17]` 四条族 A/D 高优先级 + `[26][27][31]` 三条脚本门禁）。这不是我写错了 —— 是**派单与归档在并行推进**。

⇒ 因此：

1. **本表的「状态」只对 §7 的 sha256 负责。** 文件一旦被改写，请**重新核对**再勾销，不要照着本表照抄。
2. **「待修」里的 19 条极可能继续减少** —— 判据永远是**当前源码**，不是本表。
3. 我给每条都留了**内容锚点串**（如族 A 的 `isNonNegativeSafeInteger(head.sequence)`），勾销时按锚点 grep 一次即可，不必读全文。

**建议的勾销顺序**（按代价不对称挑出，非按严重度标签）：

1. ~~`[10]` `host-data.ts` 污染账本~~ —— ✅ **已修**（owner 的修复注释逐字采纳了我提的分诊理由）。
2. ~~`[17]` `task-claim.ts`~~ —— ✅ **已修**。
3. ~~`[25]` `host-data.ts` TOCTOU~~ —— ✅ **已修**。
4. **`[18]` `spawn-team.ts:648`** —— ⬅️ **现在这是最高优先级**：`deps.caller` 为 `null` 时 `TypeError` 逃出 `execute`，破坏「绝不抛」契约（我已复扫确认**仍存在**）。
5. 族 B/C 剩余项：`[3][19]`（`member-runtime.ts` 的两处 `JSON.stringify`）。
6. LOW（`[13][29][34][36]` 等）—— 死代码/死类，逐个清理。

---

## 6. 我核实的手段与局限（如实声明）

**手段**：

- 逐条把 OCR 的**内容锚点**（函数名 / 关键串）回到**当前**源码里重新定位，而非沿用 OCR 行号 —— 因为**有 8 个文件在评审后被改写过**，原始行号已失效。
- 归属不靠猜：依据 `team.json` 各任务的 `changedPaths` + 文件头自述 + mtime 聚类。
- 误报给**可核验反证**（[21] 直接读主题定义文件）。
- 真缺陷读到**具体行**（[25] 我读了 `:117` 确认它 `return { kind: 'ok', absolutePath }`；[15] 我读了构造点确认 `duplicate` 不可达）。

**局限（不要把我的结论当成比它更强的证据）**：

1. **我审的是「当前树」，不是「OCR 那一刻的树」。** 因此状态栏里「已修」表示「此刻已修」，**不表示** OCR 当时报错了；反之「待修」也可能在我说完之后被 owner 修掉。**以 sha256 为准**。
2. **`[9]`/`[30]`/族 D 的「已修」是我读代码得出的，没有跑端到端**。我没有执行客户端，没有观测真实 200+`ok:false` 的界面表现。
3. **本文件是文档 ⇒ 结构性拿不到第三方 OCR 评审**（见 §0.1）。上面所有「✅ 成立」都是**我自己**的核实，**只有人眼可复核**。
4. 行号会随编辑漂移，**定位请用 §7 的 sha256 + 锚点串**。

---

## 7. 指纹基线（本文件结论只对下列 sha256 负责）

### 7.1 基线 B —— **本节状态栏所依据的版本**（采集于 2026-09-23 22:49:57）

| 文件 | 字节 | sha256 |
|---|---|---|
| `src/host.ts` | 41702 | `FB9D09729E9F49B1CDEC6A6E78E29AEC0FBC1C3C26A704725437B4F973FF92D8` |
| `src/host-data.ts` | 30885 | `799DF9446BD035B10C5985AF5692D80793389D67005733F0CE5497C929156EC9` |
| `src/tools/task-claim.ts` | 29696 | `61B27521F1687664C421D904EB7F6B9769724656FD07C87AF140C696C66C6976` |
| `src/tools/message.ts` | 33949 | `AEEC1CCAE41F74FC7EFFD5BF9E3476FF8EC3A1C11F4BF31AB140A64E9F030F7B` |
| `scripts/verify-t5.mjs` | 5165 | `1EA565D337180531E282E27E4C4538A5572221C0960B335A53193AA6410F9261` |
| `scripts/sophia-client-smoke.mjs` | 11474 | `B0AF9A91B570333B5838AFAC6302AD929958F6ECD626D80A71CF76149E0C47DC` |
| `src/client/index.ts` | 20539 | `4915C57AD2E951D639102E1B5BE0D1CCD0BFB828103DF0BC2E7C754FC74E28B7` |
| `src/client/panel-store.ts` | 25995 | `1B5C2F05309F241C041925C3B753525E7C4D4218D7033151714B0B753886D9D5` |
| `src/runtime/member-runtime.ts` | 99130 | `10A13B3E6E794E7103CB91A3C7C49E3E3B0096301DB5CE0E449765CD2DFB309E` |
| `src/tools/rollover.ts` | 30452 | `73F8F2AA4CE59F2D71E8A00A2D8699A5673BCCB5C49E647D255F13F6591125FA` |
| `src/tools/spawn-team.ts` | 41416 | `BA3D1D55191D39E8D6E9EC47112F68B70766532E9CB43B12282CCCAA6870D84A` |
| `src/tools/switch-model.ts` | 31923 | `724BFB322F43E56E2A161800D61A454AC9698C0C07E753B4D3DDF5AAA85FB674` |
| `src/client/styles.ts` | 20811 | `41DD44B323F80DE34468A51F7FAA47A776A261A1D6C6EAA67E8A64F8AB7C48F0` |
| `src/client/components.tsx` | 27365 | `A4A78D0EB15ECA213B24C1205069C85EE17BBE24F6BF56773E7CBA6C488EA8E6` |
| `src/client/panel.tsx` | 15256 | `C03F4313C0CFF2FAF5461D1DF28A58796786D1FE70EB0307FEB3A5665C2983B7` |
| `src/client/seats.tsx` | 6265 | `BFAFD23AE47CDB87B04A3C9A545FACB50C0DD941554D6206E1F2D02851C387B6` |
| `src/client/react-runtime.ts` | 5220 | `677C556209CA0A750A4BB14A6ABFAA5C22F9D7FA75C2103BA0CC43419CEEE538` |
| `scripts/check-t5-structure.mjs` | 9494 | `2D5341436DE227C0678D7BD62EA07588A4EA54E871D0416C78B2E5584B2D2806` |
| `src/types/team.ts` | 7983 | `52734785046F1A7DDC281CFFC15D241F1D25D272B5AA098176A7862355ACE096` |
| `src/host-tools.ts` | 11045 | `581367C1ED24980F5BD1BBC1EFB193A3CE8DD3570570B53DB6F48F64AEC81CF0` |
| `src/wire.ts` | 8966 | `E56E78A2171CC6C2971F8EE62101A538CF2829693ABF92210EBBFC62FD8A63F4` |
| `src/avatar-paths.ts` | 9413 | `CBBBE7F849AF9BB16786E80AFE1D0318C9CA5D8831E00C58FA502161DF30C61D` |
| `tests/client/components.spec.tsx` | 33437 | `294FE46AA2652D13A050F0C291A2A1E81A8119AECA767269E7BFF5AB77D91EEB` |

### 7.2 基线 A —— 采集 22:47:25（起草时的版本，已过时，仅供追溯）

基线 A 与基线 B 的差异文件（即**在我写作期间被 owner 改掉的**）：

| 文件 | 基线 A（22:47:25） | 基线 B（22:49:57） | 对应的意见 |
|---|---|---|---|
| `src/host.ts` | `19D82F0A3F99…56B2`（40552B） | `FB9D09729E9F…92D8`（41702B） | [12] 已修 |
| `src/host-data.ts` | `DFCF18EBCB54…CF9B`（27270B） | `799DF9446BD0…6EC9`（30885B） | [10][11][25] 已修 |
| `src/tools/message.ts` | `6DD50155312D…B929`（32426B） | `AEEC1CCAE41F…0F7B`（33949B） | [30] 已修 |
| `scripts/verify-t5.mjs` | `D40078A249B3…74A5`（3928B） | `1EA565D33718…9261`（5165B） | [26][27] 已修 |
| `scripts/sophia-client-smoke.mjs` | `8BD48D7C50AB…E07D`（10479B） | `B0AF9A91B570…47DC`（11474B） | [31] 已修 |

（`src/tools/task-claim.ts` 的大小/哈希在两次采集间**未变**，但 `[17]` 已修 —— 说明它的修复发生在 22:47 **之前**，即我起草时读到的**已经是修好的版本**。这正是 §0.2「行号会过期」的同类陷阱：**同一个文件在两次读取之间可以毫无变化，而结论已经不同**。）

> ⚠️ 本目录（`docs/`）里 `*.md` 全被 OCR 按扩展名过滤 ⇒ **不会**被重复评审（这既是「便宜」的原因，也是 §0.1 那条诚实边界的原因）。
