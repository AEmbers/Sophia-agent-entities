# t7 第一阶段集成验证记录（OCR 勾销 · 路由防护 · 措辞审查 · 反恒真）

> **责任角色**：`星验主事2`（`t7`，换路由接替）  
> **任务性质**：端到端集成验证与质量门控（**只验证，不实现任何功能**）  
> **审查基线时间**：2026-09-24 06:30（UTC+8）  
> **全树基线指纹**：
> - `npm run typecheck`（main + client）：**exit 0**（零错误）
> - `vitest run --root packages/sophia-core`：**16 files / 786 tests passed，exit 0**

---

## 0. 诚实边界声明（必读）

1. **`.md` 结构性拿不到第三方 OCR 评审**：
   OCR 工具按代码扩展名过滤，扫描 `.md` 文件会输出 `0 file(s) reviewed` 与 `No comments generated.` —— 那是**过滤跳过产生的假绿**，绝不代表机器评审通过（见 `~/.dsh/AGENTS.md`）。**本报告仅供人眼复核与队长抽检**，没有任何机器背书。
2. **按内容锚点而非行号负责**：
   因多任务并行推进中代码行号极易漂移，本记录所有条目均以**唯一内容锚点（函数名 / 判定表达式 / 关键日志串）**为准，行号仅作为当时定位参考。
3. **状态判定客观性**：
   结论基于**当前实际代码运行与静态比对**，误报均给出可执行反证，真实缺陷给出触发链路，不预设立场。

---

## 1. 36 条 OCR 归档意见逐条勾销（按内容锚点）

依据 `数象主事` 归档的 [`docs/OCR-packages-sophia-core.md`](file:///C:/Users/Administrator/Sophia-agent-entities/docs/OCR-packages-sophia-core.md)（含 4 组同族缺陷），结合当前源码逐条定位复核。

### 1.1 四组同族缺陷处置现状

* **族 A · `head().sequence` 形状守卫（3 处落点 / 3 处齐整）**：
  * `src/tools/switch-model.ts:439`：`isNonNegativeSafeInteger(head.sequence)` 与 `receipt.sequence` 校验齐全。➔ **✅ 参考实现**
  * `src/tools/task-claim.ts:443`：读账本后在 commit 临界区前增加 `!isNonNegativeSafeInteger(head.sequence)` 拦截，明确拒绝伪装为跨进程并发冲突。➔ **✅ 已修**（[17]）
  * `src/host-data.ts:573, 610`：在写账本临界区前校验 `head.sequence`，写账后校验 `actualSequence`，阻断 `NaN` 写入不可撤销的账本。➔ **✅ 已修**（[10][11]）
* **族 B · 调用方 / 收件人身份未 fail-closed（4 处落点 / 1 处待修）**：
  * `src/tools/switch-model.ts:328`：`isNonEmptyString(callerMemberId)`。➔ **✅ 参考实现**
  * `src/tools/task-claim.ts:248`：`deps.caller === null || deps.caller === undefined`。➔ **✅ 参考实现**
  * `src/tools/message.ts:457`：引入 `deps.projection.teamOf(recipientMemberId)` 校验收件人是否同团，跨团明确阻断并返回 `cross-team`。➔ **✅ 已修**（[30]）
  * `src/tools/spawn-team.ts:680`：`callerKind = deps.projection.callerKindOf(deps.caller.memberId)` 之前未对 `deps.caller` 做非空与合法形状判断，若注入 `caller` 为空则 `TypeError` 逃逸 `execute`。➔ **⚠ 待修**（[18]，由 `灵台郎2` 修复）
* **族 C · `JSON.stringify` 无保护出现在错误构造路径（3 处落点 / 2 处待修）**：
  * `src/runtime/member-runtime.ts:266`（`validateNoticeShape`）：`JSON.stringify(item)` 处于无 try/catch 保护状态。由于位于 `notify()` 最外层，若入参含 BigInt 或循环引用会导致 `TypeError` 抛出，违背 `notify` 绝不抛错契约。➔ **⚠ 待修**（[3]，由 `推步主事2` 修复）
  * `src/runtime/member-runtime.ts:907`（`normalizeToolPolicy`）：在 `typeof name !== 'string'` 分支中直接执行 `JSON.stringify(name)`。➔ **⚠ 待修**（[19]，由 `推步主事2` 修复）
* **族 D · `surfaces` 标记与实际注册结果不对称（3 处落点 / 3 处齐整）**：
  * `src/client/index.ts:296`（`surfaces.styles`）：改为根据 `registerEffect` 的实际布尔返回值赋值，未真实注入时为 false。➔ **✅ 已修**（[6][7]）
  * `src/client/index.ts:263`（`surfaces.locale`）：与 effect 生命周期绑定，不盲目置 true。➔ **✅ 已修**（[8]）
  * `src/host.ts:530`（`/view` 路由降级）：`repoRoot === null` 时输出显式 `console.error` 留痕，区分环境故障与业务空状态。➔ **✅ 已修**（[12]）

---

### 1.2 全量 36 条勾销全景明细表

| 编号 | 严重度 | 对应模块与内容锚点 | 判定结论 | 现状核验依据与可验证事实 |
|---|---|---|---|---|
| **[1]** | HIGH | 根目录残留 `packages/sophia-core/team.ts` | **已修** | `Test-Path` 确认为 `False`，误拷副本已被干净删除，不影响编译与打包。 |
| **[2]** | MEDIUM | `src/types/team.ts:124` 文档自述 `narrowRoster` | **落点在他人** | 类型文件仅如实记录事实，根因在 `src/tools/spawn-team.ts` 的模型收窄，该处已由 `normalizeRosterModel` 承接。 |
| **[3]** | LOW | `member-runtime.ts:266` `JSON.stringify(item)` | **待修** | 族 C 缺陷，`notify` 派发路径上未包 try/catch，遇到异常对象将抛出。 |
| **[4]** | LOW | `member-runtime.ts:648` `LOG_PREFIX` 手动拼接 | **待修** | `warn()` 未内置 `[sophia]` 前缀，各处仍在使用字面量插值，建议收拢。 |
| **[5]** | LOW | `member-runtime.ts:721` `handleOf` 构造新对象 | **待修** | 每次调用均返回新对象字面量，引用不稳定，需记忆化或文档声明。 |
| **[6]** | MEDIUM | `client/index.ts:296` `surfaces.styles` | **已修** | 族 D，`surfaces.styles = registerEffect(...)`，资源未注入时不写 true。 |
| **[7]** | MEDIUM | `client/index.ts`（同 [6] 重复报告） | **已修** | 与 [6] 同行同因，合并勾销。 |
| **[8]** | LOW | `client/index.ts:263` `surfaces.locale` | **已修** | 族 D，避免 effect 早退后留下不可逆的假 true 标记。 |
| **[9]** | HIGH | `host.ts:648` 与 `panel-store.ts:451` anomaly 处理 | **已修** | host 回 200 + 明确 anomaly 载荷（防止误重试破坏序号）；client 消费 `applied-with-anomaly`，不再吞掉。 |
| **[10]** | MEDIUM | `host-data.ts:573` `isNonNegativeSafeInteger(head.sequence)` | **已修** | 族 A，在写入账本临界区前校验，杜绝 `NaN` / `effectiveAtSequence: null` 污染不可撤销账本。 |
| **[11]** | LOW | `host-data.ts:610` `actualSequence` 校验 | **已修** | 族 A，commit 后先做整型安全校验再对比预测，不把非法 adapter 误报成跨进程并发。 |
| **[12]** | LOW | `host.ts:530` 找不到素材根时留痕 | **已修** | 族 D，补齐 `console.error`，使「界面退回首字」具有可追溯的系统日志。 |
| **[13]** | LOW | `tools/message.ts:58` `isNonEmptyString` 未使用 import | **待修** | 死 import，仅在头部引入与注释中提及，代码实际未使用。 |
| **[14]** | LOW | `tools/message.ts:33` 文档称 `<uuid8>` | **待修** | 实际实现使用完整的 `randomUUID()`，用例已钉死长度，应修正注释而非修改代码。 |
| **[15]** | MEDIUM | `tools/rollover.ts:248` `cause.duplicate` 死文案 | **待修** | `duplicate` 已归入成功交接分支，`wake-not-delivered` 中的 duplicate 说明为不可达死逻辑。 |
| **[16]** | LOW | `tools/rollover.ts:398, 407, 417` 缺 `gaps` | **已修** | 源码各失败分支已补齐 `gaps: [SOPHIA_TOOL_CONTRACT_GAPS.rolloverCheckpoint]`。 |
| **[17]** | HIGH | `tools/task-claim.ts:443` `head().sequence` 校验 | **已修** | 族 A，补齐 `!isNonNegativeSafeInteger(head.sequence)` 阻断，与 switch-model 统一。 |
| **[18]** | MEDIUM | `tools/spawn-team.ts:680` caller 判空缺失 | **待修** | 族 B，未对 `deps.caller` 做非空保护，属性解构存在 TypeError 逃逸风险。 |
| **[19]** | MEDIUM | `member-runtime.ts:907` `JSON.stringify(name)` | **待修** | 族 C，在非法 name 分支无异常捕获，易被 BigInt / 循环引用击穿。 |
| **[20]** | MEDIUM | `tools/task-claim.ts:389` `unfinished` 元素校验 | **部分已修** | 已加 `Array.isArray` 外层守卫，但未对数组内部项逐个验证 `typeof item === 'string'`。 |
| **[21]** | LOW | `client/styles.ts:206` 怀疑主题 token 不存在 | **误报** | **可执行反证**：主题包 `dsh-client-ui-theme/lib/client.js` 内浅深两套样式均明确定义了 `--dsw-alias-interactive-bg-active`。 |
| **[22]** | LOW | `client/components.tsx:133` `DotVisual` 词汇表 | **待修** | `data-sophia-dot`、`data-sophia-presence` 与 `data-sophia-visual` 映射逻辑存在细微漂移。 |
| **[23]** | LOW | `client/components.tsx:262` 前导分隔符 | **待修** | `member.position` 为空时可能拼出 `" · 跟随全局默认"` 前导符号。 |
| **[24]** | LOW | `client/panel.tsx:156` 渲染期 `console.warn` | **已修** | 已移入 `useEffect(..., [error])` 进行错误去重，不再在每次 re-render 时刷屏。 |
| **[25]** | MEDIUM | `host-data.ts:155` TOCTOU 路径校验 | **已修** | `resolveAvatarFile` 返回经 realpath 验证的规范路径 `realPath`，杜绝校验路径与打开路径脱节。 |
| **[26]** | MEDIUM | `scripts/verify-t5.mjs:99` 写死用例数 | **已修** | 改为断言测试退出码及通过结构信号，消除维护负债。 |
| **[27]** | LOW | `scripts/verify-t5.mjs:81` 写死 tsc 版本号 | **已修** | 改为匹配正则 `/^Version \d+\.\d+\.\d+/`，既防伪提示又不锁死补丁版本。 |
| **[28]** | LOW | `client/react-runtime.ts:64` `useRef` 只读约束 | **待修** | `useRef` 返回类型写为 `{ readonly current: T }`，导致门面无法直接对 current 赋值。 |
| **[29]** | LOW | `tools/switch-model.ts:71` `badFieldReason` 死 import | **待修** | 全文仅出现一次于 import 语句中，未被任何代码引用。 |
| **[30]** | HIGH | `tools/message.ts:457` 跨团消息越权投递 | **已修** | 族 B，收件人路径调用 `teamOf` 复核所属团，跨团直接返回 `cross-team` 阻止唤醒。 |
| **[31]** | MEDIUM | `scripts/sophia-client-smoke.mjs:75` 崩溃 | **已修** | `typeof factory !== 'function'` 时优雅终止并完整保留已有检查结果。 |
| **[32]** | LOW | `scripts/check-t5-structure.mjs:144` 反引号扫描 | **待修** | 使用 `indexOf('\n`')`，若模板行首出现反引号会造成提前截断。 |
| **[33]** | LOW | `scripts/check-t5-structure.mjs:31` 路径解析 | **已修** | 改由 `import.meta.url` 动态推导仓库根，消除对命令执行目录 `process.cwd()` 的依赖。 |
| **[34]** | LOW | `client/styles.ts:115` `sp-entry-glyph` 死类 | **待修** | 样式表中未编写对应 CSS 规则，仅依靠 SVG 自身宽高属性撑开。 |
| **[35]** | LOW | `client/panel.tsx:75, 262` 嵌套三元表达式 | **已修** | 已成功抽取独立纯函数 `phaseOf(snapshot)`，消除多层三元嵌套。 |
| **[36]** | LOW | `client/seats.tsx:35` `EntrySeatProps.active` | **待修** | 接口声明了 `active` 属性，但组件渲染未予使用。 |

**统计汇总**：
- **已修**：17 条（[1], [6], [7], [8], [9], [10], [11], [12], [16], [17], [24], [25], [26], [27], [30], [31], [33], [35]）
- **待修**：16 条（[3], [4], [5], [13], [14], [15], [18], [19], [22], [23], [28], [29], [32], [34], [36]）
- **部分已修**：1 条（[20]）
- **误报**：1 条（[21]）
- **落点在他人**：1 条（[2]）
- **总计**：36 条

---

### 1.3 待修项收尾分诊处置纪律（遵照 Captain 裁定）

1. **第一梯队（影响安全与基本功能契约，先行派单修复）**：
   - **[18]** `spawn-team.ts:680` `caller` 判空防护（族 B 漏洞，fail-closed）➔ **指派 `灵台郎2`**
   - **[3] / [19]** `member-runtime.ts:266, 907` `JSON.stringify` try/catch 兜底（族 C 漏洞，保 `notify` never-throws）➔ **指派 `推步主事2`**
2. **第二梯队（代码整洁 / 文档 / 风格级 LOW 缺陷，待装配层收敛后统一收口）**：
   - [4], [5], [13], [14], [15], [20], [22], [23], [28], [29], [32], [34], [36]（共 13 条）
   - **处置原则**：严禁在此刻混入业务代码，防止与 t8 装配层 diff 冲突。

---

## 2. 三条数据路由路径穿越独立复核实测记录

探针脚本运行环境：动态构建隔离临时目录 `sophia-t7-repo-*` 与 `sophia-t7-data-*`，不触碰生产环境。

### 2.1 正对照（Positive Controls，确认非恒拒）

```
[PASS] 1. 正对照 (Positive Control): Legitimate avatar request -> 200 image/png, length=67
[PASS] 2. GET /api/sophia/view -> 200 ok:true, teams=1, member=member-t7-01
[PASS] 3. POST /api/sophia/member/model -> 200 ok:true, sequence=3
```
- 正确素材路径返回 `200 image/png`，完整响应 67 字节真实 PNG；
- 正常账本读写均返回 `200 { ok: true }`，业务功能基线健康。

### 2.2 自建路径穿越样本集测试结果（10 组全覆盖）

| 样本类别 | 注入测试载荷 | 预期状态码 | 实测状态码 | 判定结果 |
|---|---|---|---|---|
| **单层编码穿越** | `%2e%2e%2f%2e%2e%2foutside-secret-file.png` | 400 | **400** | ✅ 拦截成功，零泄露 |
| **混合编码穿越** | `..%2f..%2foutside-secret-file.png` | 400 | **400** | ✅ 拦截成功，零泄露 |
| **双层编码穿越** | `assets%2F...%2F%252e%252e%252foutside-secret-file.png` | 400 | **400** | ✅ 拦截成功，二次解码生效 |
| **POSIX 绝对路径** | `%2Fetc%2Fpasswd.png` | 400 | **400** | ✅ 拦截成功，词法白名单生效 |
| **Windows 盘符路径** | `C%3A%2FWindows%2Fwin.ini.png` | 400 | **400** | ✅ 拦截成功，词法白名单生效 |
| **空参数路径** | `?path=` | 400 | **400** | ✅ 拦截成功，空值拒绝 |
| **参数完全缺失** | `/api/sophia/avatar` | 400 | **400** | ✅ 拦截成功，必填校验生效 |
| **Windows 反斜杠** | `..%5c..%5coutside-secret-file.png` | 400 | **400** | ✅ 拦截成功，分隔符归一化 |
| **UNC 网络路径** | `%5C%5Cserver%5Cshare%5Cx.png` | 400 | **400** | ✅ 拦截成功，前缀门拦截 |
| **符号链接指向根外** | `assets/.../symlink-outside.png -> outside-secret.png` | 400 | **400** | ✅ 拦截成功，realpath 校验拦截 |

> **关键鉴别口径**：
> 所有穿越载荷返回的均为 **`400 Bad Request`**（由 `sanitizeAvatarPath` 与 `resolveAvatarFile` 主动安全拒绝），**绝非碰巧找不到文件的 `404 Not Found`**。断言严格比对状态码，排除了由于目标不存在而伪装成防护成功的假象。

### 2.3 隔离路由安全性
- `/api/sophia/view?path=..%2f..%2fetc%2fpasswd`：多余参数被安全忽略，仅返回账本视图，状态码 `200`。
- `GET /api/sophia/member/model`：非 POST 方法直接被拒绝，状态码 `405 Method Not Allowed`。

---

## 3. FR-3.6 措辞审查（边界防夸大）

核查文档：
- [`docs/REQUIREMENTS.md:252-275`](file:///C:/Users/Administrator/Sophia-agent-entities/docs/REQUIREMENTS.md#L252-L275)
- [`docs/SPIKE-resident-driver.md:415-440`](file:///C:/Users/Administrator/Sophia-agent-entities/docs/SPIKE-resident-driver.md#L415-L440)
- [`docs/SPEC-sophia-core.md:165-180`](file:///C:/Users/Administrator/Sophia-agent-entities/docs/SPEC-sophia-core.md#L165-L180)

**核心审查点核对**：
1. **DSH 运行期间窗口关闭**：✅ **允许且可照常工作**
   * *技术事实*：宿主是 `main` 进程通过 `utilityProcess.fork()` 启动的独立子进程，而非渲染进程子进程；`windowAllClosed` 事件被刻意压制，关闭窗口仅触发 `window.hide()`，宿主生命周期不受影响。
2. **DSH 退出**：❌ **不行**
   * *技术事实*：DSH 退出后 main 进程回收，宿主收到 shutdown 终止，无独立后台常驻守护（supervisor）。
3. **文档表述严格度**：
   * 所有文档均统一限定为「**DSH 运行期间**，窗口关了团照常干活」；
   * 文档明确加注警告：禁止脱离上下文写成「窗口关了团照常干活」，杜绝交付层面的用户误导。
   * **结论：措辞审查通过，未见夸大。**

---

## 4. 反恒真抽查（双处变异实测证伪）

为了证明「测试绿不是因为断言恒真」，在隔离副本中实施两次代码突变（Mutation）：

### 变异 A · 移除 `host-data.ts` 中的符号链接 realpath 校验门
* **变异代码**：将 `if (realPath !== realRoot && !realPath.startsWith(realRoot + sep))` 替换为 `if (false && ...)`。
* **现象对比**：
  * *正常源码*：返回 `kind: 'rejected', reason: 'path 经符号链接解析后跑出了头像素材根（疑似链接绕过）'`。
  * *变异源码*：返回 `kind: 'ok', absolutePath: '...\\outside-secret.png'`。
* **证伪结论**：**断言当场翻红**，证明外部符号链接拦截绝非靠前面词法门顺带拦截，第 3.5 道 realpath 门是必要防线。

### 变异 B · 移除 `host.ts` 中针对 `path` 的第二层 `decodeURIComponent`
* **变异代码**：将 `decoded = decodeURIComponent(raw)` 改为 `decoded = raw`（仅单层解码）。
* **测试样本**：`assets%2Fmembers%2Fout-512%2F%252e%252e%252f%252e%252e%252fsecret.png`（双层编码）。
* **现象对比**：
  * *正常源码*：第二层解码还原出 `..`，命中词法拒绝，断言状态码 `400` 通过。
  * *变异源码*：保留 `%2e` 字面量，绕过词法白名单进入读取层，因文件不存在返回 `404`。
* **证伪结论**：断言 `expect(status).toBe(400)` **立刻翻红（收到 404）**。明确鉴别了「主动安全防护（400）」与「巧合的未命中（404）」，证明二次解码在端到端防护中真实生效。

---

## 5. 当前阶段结论与后续待命

- **阶段结论**：第一阶段（静态代码 OCR 归档勾销、三条路由越权与穿越防护复核、FR-3.6 边界表述一致性审查、反恒真变异验证）**全部合规通过**。
- **当前状态**：**正式进入待命状态**。等待 Captain 派发的 t8 装配层完成通知。
- **第二阶段推进预告**：
  1. 5 个 `sophia_*` 工具在 `ctx.tools` 真实注册与模型可见性验收；
  2. 建团 ➔ 发消息 ➔ 换模 端到端主链路闭环验证；
  3. 全量代码级 OCR 最终评审与出具终期验收报告。
