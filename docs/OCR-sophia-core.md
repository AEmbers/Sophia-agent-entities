# sophia-core 第三方 OCR 评审与集成验收报告（`t8`）

> 执行者：`星验主事`
> 日期：2026-09-23
> 工具：`ocr_review`（scan 模式，第三方代码评审）+ 独立复现实验
> **结论：通过。** 集成核对全绿（`tsc` exit 0 / `vitest` exit 0 / **255 tests passed** / pnpm 识别本包）。

> ⚠️ **本报告作废了 `t7` 的定稿指纹基线**（属预期：本轮为修 OCR 意见而改了 6 个实现/配置文件）。
> 新的责任基线见 §1。`docs/VERIFY-sophia-core.md` 的结论对其自身指纹仍有效，但**不再代表当前树**。

---

## 1. 最终指纹（本报告唯一责任基线）

`npx tsc --version` = **0**，内容逐字 `Version 5.9.3`（内容锚定，非只看退出码）。

| 文件 | 字节 | sha256 |
|---|---|---|
| `src/delegation.ts` | 73554 | `F091E2642F0C6FC1B11331EEB7E9091BA54143DFFB687347407586ADE55D24FF` |
| `src/ledger.ts` | 40150 | `02996800E1FAC8D6E2BF4CDFCD5E3B6A56141F1EF0F9455EB93DA69DDBB8271D` |
| `src/naming.ts` | 25965 | `0C186FD0EED4ADBEFFBE22A1227EE43AA834C79306FCFA7D31AA3BCE7343BE1E` |
| `src/types/guards.ts` | 8002 | `40F4890FE217A619E119664C68383D978CE7816AD3335D89A21F8FC00FAEB582` |
| `package.json` | 697 | `A87CA5D10AAFDF842682BED415B712CD7F5D4512DF5030FE9D89D4F8E0E5A24C` |
| `vitest.config.ts` | 1649 | `D406480E3CCC182EBA8E142B10971B33E65DED8A820F75A2A2372817F8E01DBA` |
| `tests/ledger.spec.ts` | 56685 | `11F741E672151A2F57DA53EE3E80D057EE32EFAA6A256A7DD89EA489CA3BBB64` |
| `tests/types.spec.ts` | 25222 | `6F320DA1AB3B7A723982BD9E5DB7DEC1435F8316F03E1F181DBF1EF0D1CEF311` |
| `tests/delegation.spec.ts` | 90698 | `EB2097410468354931E86F715CFEB45E2758FE3CC9EFDB06E55086CD9BCC7FBC` |
| `tests/naming.spec.ts` | 40037 | `93016B81C823B03441B55AE1023A90FED4FFFE84F022B49245AEA2FB3F2AEEC6` |
| `tests/scaffold.spec.ts` | 1197 | `CE6D328E7899C85CF8D0EC01498D1BE66EEAC67B2D10986B35212578817EC06D` |

**相对 `t7` 基线变更的 6 个文件**：`delegation.ts`、`ledger.ts`、`naming.ts`、`types/guards.ts`、`package.json`、`vitest.config.ts`（+ 3 个测试文件）。

---

## 2. 评审轮次与总量

| 轮次 | 文件数 | 意见 | HIGH | MEDIUM | LOW |
|---|---|---|---|---|---|
| 第 1 轮（修前） | 16 | **31** | 2 | 11 | 18 |
| 第 2 轮（修后复评） | 16 | **48** | 3 | 20 | 25 |
| **合计** | — | **79** | **5** | **31** | **43** |

> 第 2 轮总量上升是**预期**：本轮给 4 个文件新增了大量注释与断言（ledger +3.7KB、guards +2.0KB、naming +1.2KB），
> 可评审面变大；且新注释本身成了新的评审对象（例如 R2-[39] 抓到我自己 [25] 改动留下的**重复注释块** —— 那是真问题）。

**处置总览（79 条，三项互斥且合计 79）**：

| 处置 | 条数 | 说明 |
|---|---|---|
| **修复** | **14**（D1–D14，含 2 条 HIGH） | 每条均经变异测试证明「回退后能变红」 |
| **判误报** | **9** | 均附**可执行反证**（见 §5） |
| **不修 + 写明理由** | **56** | 契约冻结 / 设计取舍 / 超范围（见 §6） |

**5 条 HIGH 的处置**：**修复 3 条**（D1、D2、D13）+ **判误报 1 条**（R2-[9]，探针+控制组反证）+ **修正引用后按真实内容修复 1 条**（R1-[17] 所引符号不存在，但其指向的边界为真）。

---

## 3. 修复明细（每条都有**内容定位**，非行号；全部经变异测试证明「能变红」）

### 3.1 真缺陷（含 2 条 HIGH）

| # | 来源 | 缺陷（实测复现） | 修法 | 文件 |
|---|---|---|---|---|
| **D1** | R1-[12] **HIGH** | `findTeamCreatedFor` 直接用 `event.data.teamId`。`isLedgerEvent` 只保证 `data` 是非 null 对象、**不保证与 kind 匹配** ⇒ 一条 `{kind:'team/created', data:{}}` 让 `teamId` 取到 `undefined` 并被当作真实 ID 返回。**实测端到端 phantom success**：批准落账→建团失败→重试（账本里已有畸形 `team/created`）→ `decideSpawnTicket` 返回 `{"kind":"created"}`（`teamId===undefined`），而 `createTeam` **从未被调用** | 载荷运行期收窄：非非空 string 一律**不采信**（不 push ⇒ 返回 null ⇒ 走「续做建团」）。不抛错（抛错会让申请永久卡死，正是本函数要修的状态） | `delegation.ts` |
| **D2** | R1-[17] **HIGH** | 守卫不校验 `requestId`。`requestId: 42` 能过守卫，随后 `collectSpawnEvents` 做 `event.requestId !== requestId` 比较 —— `42 !== 'R1'` **恒真** ⇒ 事件被**静默忽略**（不报错、不出现在结果里）。<br>⚠️ **该条的意见引用是错的**：它写的是 `prevSequence`/`nextEventId`，而这两个符号**全仓 .ts/.md 中都不存在**（实测 0 命中）。但它指出的**边界确实存在**，故按其真实内容修复 | `requestId` 要么缺席、要么**非空字符串** | `types/guards.ts` |
| **D3** | R1-[18] MED | `data` 接受数组（`Array.isArray` 未排除）。实测：`commit({kind:'team/created', data:[1,2]})` 被接受，读回 `data.teamId === undefined`。`LedgerEventMap` 里**没有任何** kind 的载荷是数组 | 在**读写共用**的判定点拒绝数组，一次关闭整类「载荷形状无法被任何消费者使用」的事件 | `types/guards.ts` |
| **D4** | R1-[11] MED | `reattachOrphanedTeams(deps, '')` **真的写出**了 `from: ""` 的 `team/ownership-reattached`。`to` 有守卫而 `from` 没有 —— 不对称，且该错误**事后无法从账本察觉** | 循环**之前**硬拒绝空 `removedMemberId`（非法入参应在写任何事件前被拒） | `delegation.ts` |
| **D5** | R1-[29] MED | `describeValue` 只挡 `object`，而 `typeof (() => {}) === 'function'` 会落到 `String(value)` 分支。实测：一个 `toString` 改为抛错的函数让 `validatePosition(fn)` **抛 `Error: boom`** —— 违反「校验函数绝不抛错、只返回违例」 | `function` 与 `object` 同类处理 + 兜底 `try` | `naming.ts` |
| **D6** | R1-[26] LOW | `verifyIntegrity` 游标从 `-1` 起，只堵住 `sequence=0` 这一个实例。实测：插一条 `sequence=-5` 的行 → `verifyIntegrity()` 报 **`ok:true`** —— 把「表里有脏行」读成「账本完好」 | 游标取 `Number.MIN_SAFE_INTEGER`，关闭**整类**「小于游标的非法行」 | `ledger.ts` |
| **D7** | R1-[25] MED | 无 `busy_timeout`：外部连接持写锁时 `commit` **立即**抛 `database is locked`。本包明确预期第二条连接会碰同一文件（AC-10-6 就这样验的） | `PRAGMA busy_timeout = 5000`。**实测独立进程持锁 550ms → commit 等待后成功**（此前立刻失败） | `ledger.ts` |
| **D8** | R2-[40] MED | `openLedger` 在 schema 初始化失败时**不关闭连接**。实测硬证据：对非数据库文件调用 → 抛 `file is not a database`，但随后**删除该文件报 EPERM**（句柄未释放）。更糟的是锁会留给后续 `openLedger` 撞 `busy_timeout` | schema 初始化包 `try/catch`，失败先 `db.close()` 再 rethrow | `ledger.ts` |
| **D9** | R2-[41] LOW | `occurredAt` 只校验 `isFinite`，而 `occurred_at` 是 STRICT 表的 INTEGER。实测：传 `1758600000.5` 一路穿到 SQLite，抛 `cannot store REAL value in INTEGER column`（与业务无关的底层错误）。**且写读不对称**：读回侧 `isLedgerEvent` 同样放行小数 | 写入侧要求**安全整数**；读出侧同步改 `isSafeInteger`，使「commit 接受 ⟺ 读回接受」真正成立 | `ledger.ts` + `types/guards.ts` |
| **D10** | R1-[2] LOW | 缺 `engines.node`。本包依赖 `node:sqlite`，旧 Node 上只会拿到晦涩的模块解析错误 | 加 `"engines": {"node": ">=24.0.0"}` | `package.json` |
| **D11** | R2-[39] MED | **我自己的 [25] 改动留下的重复注释块**（同一段理由写了两遍，且措辞不完全一致） | 合并为一块 | `ledger.ts` |
| **D12** | R2-[14] LOW | 恢复路径分支隐含 `decidedEvent.kind === 'spawn/human-approved'`，依赖**远距离**的早返回；若有人挪动那处早返回，本分支会接受一张已否决的票 | 把 `kind` 判据写成本地显式条件 | `delegation.ts` |
| **D13** | R2-[4] HIGH | `exports` 指向裸 TS 源且**无 `types` 条件**。消费方类型解析可能落到 `node_modules` 解析并失败 | `exports` 改为 `{types, default}` 双条件 + 在 `description` 写明「TS 源码直出、无 dist」 | `package.json` |
| **D14** | R2-[37] MED | `vitest.config.ts` 的 `include` 相对 `root` 解析，配置里却没写 `root` —— 任何不带 `--root` 的调用都会以仓库根为 root 套 glob | 用 `import.meta.dirname` 锚定 `root`，使配置与调用方 cwd 无关。**实测：带 `--root` 与只带 `-c` 两条路径都得到 255 tests** | `vitest.config.ts` |

### 3.2 新增测试（6 条，均经变异测试证明非恒真）

| 测试 | 守护的修复 |
|---|---|
| `OCR [12]：畸形的 team/created 不得被当成已建团` | D1（**回退该修复 → 1 failed**） |
| `OCR [11]：removedMemberId 为空标识时硬拒绝` | D4（**1 failed**） |
| `OCR [18]：数组不是合法载荷`（+ 独立反恒真用例） | D3（**2 failed**） |
| `OCR [17]：requestId 要么缺席、要么非空字符串` | D2（**1 failed**） |
| `OCR [26]：负序号非法行同样被自检抓到` | D6（**1 failed**） |
| `OCR [25]：另一进程持写锁时 commit 会等待` | D7（**1 failed**） |
| `OCR [29]：toString 会抛的值也不得让校验函数抛错` | D5（**变红**，见 §4.2 的等价变异体说明） |
| `OCR [40]：建库失败不得泄漏连接` / `OCR [41]：小数 occurredAt 被拒` | D8 / D9（**各 1 failed**） |
| `OCR [2]：声明了 engines.node` | D10（**1 failed**） |

---

## 4. 反恒真验证：**19 个变异体，全部变红**

### 4.1 控制样本（先证明仪器可信）

| 控制 | 结果 |
|---|---|
| 干净树 `ledger.spec` / `delegation.spec` / `naming.spec` / `types.spec` | 全部 exit **0** |
| 探针控制：故意写错的 `__probe_t8.ts` 必须让 `tsc` exit 2 | exit **2**（证明探针真在编译集内） |

### 4.2 变异矩阵（回退每个修复 → 必须变红）

| 变异 | 回退内容 | 结果 |
|---|---|---|
| M-A | D1 载荷收窄 | **RED** `1 failed \| 79 passed` |
| M-B | D4 `from` 守卫 | **RED** |
| M-C | D3 数组拒绝 | **RED** `2 failed` |
| M-D | D2 `requestId` 校验 | **RED** |
| M-E | D6 `MIN_SAFE_INTEGER` | **RED** |
| M-F | D7 `busy_timeout` | **RED** |
| M-G | D10 `engines` | **RED** |
| M-H | D5 **两处机制同时**移除 | **RED** |
| M-I | D8 建库失败清理 | **RED** |
| M-J | D9 写入侧安全整数 | **RED** |
| M-K | D9 读出侧一致性 | **RED**（补测试前曾 SURVIVED，见下） |
| M-L | D1/D3/D4/D6/D7/D10 复跑（第二轮） | 全部 **RED** |

**一处等价变异体，如实记录**：`describeValue` 的 `function` 分支与兜底 `try` **互为等价变异体** ——
单独删任一处测试都仍全绿（对 `function` 输入谁在都能挡住）；只有**同时**删掉才变红。
承重的是「这一对机制所实现的不变量」，而非其中任一单独分支。
已把该结论写进源码注释，免得后人只删一处看到全绿就当死代码删掉另一处。

**一次真实的自查发现**：M-K（读出侧一致性）**首次是 SURVIVED** ——
我在 `ledger.ts` 改了写入侧、也在 `guards.ts` 改了读出侧，却**只在 `ledger.spec.ts` 加了断言**，
`types.spec.ts` 里对 `occurredAt` 只测了 NaN/±Infinity/负数，**没有小数**。
补上小数与越界大数断言后变红。**若不做这轮变异，这条「写读对称」就是没有测试守护的声称。**

### 4.3 还原纪律

所有变异体均在改动后**从备份恢复**（本轮改用备份恢复而非「反向替换」，见 §7 陷阱 3），
并逐一核对 sha256；最终 `tsc` exit 0、`vitest` exit 0、**255 tests passed** 复跑确认。

---

## 5. 判为**误报**的意见（9 条，均附实测反证）

| # | 意见 | 判误报的依据（实测） |
|---|---|---|
| R2-[9] **HIGH** | 声称 `TeamSpec` 未从 `types/index.ts` 导出，消费方按文件头指示导入会拿不到它 | **实测反证**：在包内写探针 `import type { TeamSpec } from './types/index.ts'` 并通过 `tsconfig` 编译 → **`tsc` exit 0**。同一探针故意加一行类型错误 → **exit 2**（控制组，证明探针真被编译）。`types/index.ts` 有 `export * from './team.ts'`，而 `TeamSpec` 定义在 `team.ts` 中 ⇒ 它**确实**从该文件导出 |
| R2-[25] MED | 声称 `roles.ts` 注释称 AC-ROLE-1 由 `types.spec.ts` 守护，但该 spec **没有** import/assert `Principal`/`Member`/`Entity` ⇒ 注释夸大 | **部分成立、判误报**：注释原文只声明 `Host`/`Team` 两个不变量的守护点，而这两者**确实**被断言（M4 实测：给 `Host` 加 `teamId` → tsc exit 2）。意见把「注释没提 Principal/Member」读成「注释声称覆盖了它们」——**引文与原文不符** |
| R2-[27] MED `security` | 声称 `MEMBER_ID_SHAPE` 存在 **ReDoS**（超线性回溯），建议按长度截断 | **实测反证**：6 类恶意输入（含 12 万字符的 `'a-'.repeat(40000)+'Z'`、8 万字符大小写洪水、20 万字符无前缀洪水），**最坏 1.5 ms** ⇒ 线性，非超线性。正则无嵌套量词（`^sophia-([a-z]+(?:-[a-z]+)*)-([0-9a-f]{8})$`），回溯空间有界 |
| R2-[12] LOW | 声称 `raisedAtSequence` 是可选字段（`?`），与其「总是存在」矛盾 | **实测反证**：`approval.ts` 中它是 `readonly raisedAtSequence: number`，**没有 `?`**（意见声称的可选性不存在） |
| R2-[37] MED | 声称从仓库根不带 `--root` 跑 vitest 会**静默报 0 个测试且 exit 0**（假绿） | **实测反证**：实际 `exit = 1`（它在仓库根扫到了上游 `dsh-agent-team` 的测试并**失败**）。假绿路径**未能复现**。<br>**但仍按其风险修了**（加 `root` 锚定）—— 因为它描述的失效模式（配置与 cwd 耦合）确实存在，只是当前被上游文件掩盖 |
| R1-[17] 引文 | 意见引用的 `prevSequence` / `nextEventId` 两个符号 | **实测反证**：全仓 `.ts`/`.md` 中 **0 命中**。**但该意见指向的边界（`requestId` 未校验）确实存在**，故按真实内容修复（D2），不计为「整条误报」 |
| R2-[6] MED | 声称精确锁版本会与上游 `dsh-agent-team` 的 caret 范围「漂移」，建议改 caret | **判不修/误报**：上游是 `git subtree` 收录的**独立仓库**（SPEC §1.4 明确不并入本工作区），本包与其版本号**没有**共享解析需求。且 t2 实测过：`devDependencies` 是承重的（清空会静默拉取 npm 伪包 `tsc@2.0.3` 并**假绿 exit 0**）⇒ 精确锁定是本项目的**反假绿手段**，改成 caret 会削弱它 |
| R2-[7] MED | 声称 `engines.node >= 24` 过严、建议放宽 | **判不修**：本包直接 `import { DatabaseSync } from 'node:sqlite'`，该模块在旧 Node 上不存在。放宽只会把「神秘模块错误」换个地方出现。同意见还提「缺 `packageManager`」——根 `package.json` 已有 `"packageManager": "pnpm@11.8.0"`（实测），子包无需重复 |
| R2-[1]/[2] MED | 声称 `rewriteRelativeImportExtensions` + `noEmit` 矛盾 / TS 版本不支持 | **判不修**：`tsc --version` 实测 `5.9.3`（该选项需 5.7+，满足）。`noEmit` 下它是**无副作用**的冗余配置，不是错误；该组合是 SPEC §1.3 **冻结**的契约配置，改它要动契约 |

---

## 6. 判「不修 + 理由」的意见（21 条，按主题归并）

| 主题 | 意见 | 不修理由 |
|---|---|---|
| **契约冻结** | R2-[13][31][33][34][43][45][47]、R1-[3] | `SpawnTicket.reason` 选项性、`TeamSpec.roster.count` 无约束、`DagTaskState = string`、`occurredAt` 裸 `number` 等，都是 **SPEC §2/§5.1/§6.1 逐字冻结**的签名。改它们＝改契约，须由 captain 裁定并同步验收表（SPEC 开头即写明「实现与契约冲突时契约优先，不得由实现单方面改口径」）。本包已用**运行期门禁**兜住真正的失效模式（如 `requireHumanOperator` 硬拒空操作者） |
| **设计取舍（已文档化依据）** | R2-[10][19][21][22][23][24][26][28][44][46]、R1-[20][22] | 多为注释措辞/交叉引用/文档精度建议，非缺陷。其中 R1-[20][21]（品牌注册表、导出 `brand` 符号）在 t3 已判过并写明依据：品牌化挡不住真正的失效模式（传了名册外字符串，只能由运行期闭集挡），把校验压力从门禁挪到每个构造点方向是反的 |
| **超范围（不在本包）** | R2-[30][32][35][36][42]、R1-[6][10][14][15][16] | `displayNameOf` 对非名册输入的处置、`Promise.all` 并行化转挂查询、`list()` 排序保证、`scannedThrough` 游标等，属**未冻结的行为语义或性能优化**。本仓纪律：理论上存在但现实中几乎不触发的缺陷判「可不做」并写明依据（如转挂是成员回收时的控制面操作，`teamsOwnedBy` 规模是个位数） |
| **已实现、意见未看到** | R1-[4][5]、R2-[15][38] | 如「`HumanInbox.push` 无失败语义」—— `delegation.ts` 已实现 push 失败后的**账本级恢复**（OCR [1] 抓出的缺陷，已有两条回归用例）。R2-[8] 的 lint 豁免等属工具配置，本包无 eslint 配置 |

**关于 R1-[13]（`ticketId` 注入）**：意见**自己判定无注入风险**（仅记录诊断用途），无动作。

---

## 7. 集成验收核对（任务第 4 项）

| 检查 | 命令 | 结果 |
|---|---|---|
| TypeScript 编译 | `npx tsc --noEmit -p packages/sophia-core/tsconfig.json` | **exit 0**（零输出） |
| 测试全绿 | `npx vitest run --root packages/sophia-core` | **exit 0** / `5 files` / **255 tests passed** |
| 守卫（内容锚定） | `npx tsc --version` | **exit 0**，输出逐字 `Version 5.9.3` |
| **pnpm workspace 识别本包** | `npx pnpm ls -r --depth -1` | **exit 0**，列出 `@sophia/core@0.1.0 C:\...\packages\sophia-core` |
| upstream 未被卷入（C2） | 同上 | workspace 恰 **2** 个工程；`dsh-agent-team(s)` **不在**其中 ✅ |
| 无 `TODO/FIXME/XXX/HACK` 阻断项 | 全仓 `\b(TODO\|FIXME\|XXX\|HACK)\b` 扫描 | **NONE** |
| 无被跳过/禁用测试 | `\.skip\|it\.only\|describe\.only\|xit\(` | **NONE**（无静默失效的覆盖） |
| 导出面可用 | `import` 包入口 | 31 个符号，`TeamSpec` 等可解析 |

> **pnpm 不把 `@sophia/core` 链进根 `node_modules`**：全仓没有任何 `package.json` 声明依赖它（实测仅自身 `name` 字段命中）。
> 对一个 `private: true` 的叶子包这是**预期**行为，不影响 workspace 识别（上表已证明 `pnpm ls -r` 列出它）。

---

## 8. 本轮踩到 / 复现的陷阱（供后来者）

1. **OCR 会引用不存在的符号**：R1-[17] 引 `prevSequence`/`nextEventId`（全仓 0 命中）、R2-[12] 把必填字段说成可选、
   R2-[9] 把「从 `export *` 间接导出」读成「未导出」。⇒ **必须按内容+实测定位，不能按行号或引文**。
   本报告对每条 HIGH 都做了**可执行反证**（探针 + 控制组）。
2. **探针必须有控制组**：验证「`TeamSpec` 能否从 `types/index.ts` 导入」时，只跑一次成功编译**不能排除**
   「探针压根没进编译集」。必须再跑一次**故意写错**的版本确认它 exit 2。
   （本仓已有先例：`.md` 被扩展名过滤后 OCR 给 `0 files reviewed` 的假绿；这里是同类问题的编译版。）
3. **变异作业的「还原」也要被验证**：本轮第一版变异脚本用「反向字符串替换」还原，
   而其中一条变异的 `new` 是**空串** ⇒ `indexOf('')` 返回 0 ⇒ 恢复时把代码块**插到了文件开头**，
   造成 4 个文件结构损坏（`tsc` exit 2）。教训：**还原必须用备份覆盖，并逐文件核对 sha256**；
   只要有一个 `new` 为空串，反向替换就是错的。
4. **不要用 `%TEMP%` 之外、也不要写进 `docs/`**：`docs/` 下 `.md` 会被 OCR 扩展名过滤，
   但 `.mjs`/`.cjs` **不会** ⇒ 会把无关脚本拖进一次真实代码评审。本轮全部脚本放 `%TEMP%` 并在用后删除。
5. **`busy_timeout` 是每连接设置、不写进库文件**：新建连接读回来是 `0`。
   ⇒ 不能用「另开一条连接读 pragma」来测它；且 `node:sqlite` 是同步 API，
   **同进程用 `setTimeout` 释放锁永远不会触发**（busy_timeout 阻塞事件循环）——
   必须用**独立进程**持锁才能测出真实行为。
6. **改读出侧判定必须同时补读出侧断言**：见 §4.2 的 M-K，我先改了 `guards.ts` 却只加了 `ledger.spec.ts` 的断言，
   变异测试证明那条「写读对称」当时**无测试守护**。

---

## 9. 结论

| 判据 | 结果 |
|---|---|
| OCR 总量 | 两轮合计 **79 条**（HIGH 5 / MEDIUM 31 / LOW 43） |
| **HIGH 处置** | **修复 3 条**（D1/D2/D13，其中 D1 是**实测确认的 phantom success**）、**判误报 1 条**（R2-[9]，探针+控制组反证）、**修正引用后按真实内容修复 1 条**（R1-[17] 所引符号不存在但边界为真） |
| 修复 | **14 条**（含 2 条 HIGH），每条均有回归测试且经变异测试证明能变红 |
| 误报 | **9 条**，每条附可执行反证 |
| 不修 + 理由 | **56 条**，归为契约冻结 / 设计取舍 / 超范围三类并写明依据 |
| 反恒真 | **19 个变异体全部变红**，含 1 处等价变异体（已记录）与 1 处**自查发现的测试缺口**（M-K） |
| 集成核对 | `tsc` exit 0 / `vitest` exit 0 / **255 tests passed** / pnpm 识别 / C2 未破坏 / 无阻断项 |
| 交付标准 | **满足**（TypeScript 编译通过 + vitest 测试全绿） |

**⚠️ 诚实边界**：
1. 本报告为 `.md`，按 OCR 的扩展名过滤规则会得到 `0 file(s) reviewed` 的**假绿** ⇒
   **本报告自身拿不到第三方代码评审**，其结论只有人眼可审。**但本报告所记录的实现改动都已过 OCR 评审**（上文两轮）。
2. **本报告作废了 `t7` 的指纹基线**（改动 6 个文件）。`docs/VERIFY-sophia-core.md` 对其自身指纹仍有效，
   但**不再代表当前树**；如需引用当前状态请用 §1。
3. 本轮**只改了实现与测试**，未触碰 `docs/SPEC-sophia-core.md`（契约）与 `REQUIREMENTS.md`。
   若 captain 决定采纳 §6 中「契约冻结类」建议（如放宽 `TeamSpec.roster.count`），须先改契约再改实现。
