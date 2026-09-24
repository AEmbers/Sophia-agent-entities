/**
 * 工具集的内部校验小工具（**不对外导出** —— 见 `src/tools/index.ts` 的显式转发清单）。
 *
 * 单独一个文件而不是塞进 `types.ts`：`types.ts` 是**形状**（宿主按它转接 `defineTool`），
 * 本文件是**运行期判据**。两者混在一起时，读 `types.ts` 的人会以为参数 schema 已经被校验过
 * —— 那正是 `guards.ts` 反复强调的「守卫证明什么、不证明什么」那类误读。
 *
 * 全部判据与 `t2` 的成员运行时**逐字同源**（`src/runtime/member-runtime.ts` 的
 * `isNonNegativeSafeInteger` / `isPendingItem`）：
 * 用 `Number.isSafeInteger` 而不是 `isFinite` —— 后者放行小数与超安全整数，
 * 而 `JSON.stringify` 会把 `NaN`/`Infinity` 写成 `null`，
 * 于是两个**不同**的值会算出**同一个**去重签名并互相冒充（t2 有专门用例守着这条）。
 *
 * @module @sophia/core/tools/internal
 */

/** 非空字符串（`''` 与纯空白串都不算）。 */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

/**
 * 收窄一个字符串字段：**校验通过后裁剪首尾空白**，形状不对则给出可读原因。
 *
 * ## 为什么必须裁剪（OCR 复核 MEDIUM [17]，真实缺陷）
 *
 * `isNonEmptyString` 只 reject 纯空白串，**并不裁剪**。于是一个看起来无害的
 * `' deepseek '` 会带着空格一路写进账本 / 参与比较，而后果不是「难看」：
 *
 * 1. `switch-model` 的 `memberId` 带空格 ⇒ `target !== deps.caller.memberId`
 *    成立 ⇒ 返回 **`not-self`**（一个**看起来像越权**的结论），
 *    而真实问题只是「多了一个空格」。调用方会去查权限，永远查不到。
 * 2. `provider` / `model` 带空格 ⇒ 与当前模型**不相等** ⇒ 同模型短路失效，
 *    写出一条 `from === to` 的假转换到不可改写的账本上。
 *
 * ⇒ 判据顺序是「**先校验、再裁剪**」，与 t2 的 `normalizeToolPolicy` 逐字同源
 * （那里也有同一处实测注释：只 trim 不校验会让 `'   '` 被裁成空串通过）。
 */
export function narrowTrimmedString(
  raw: Record<string, unknown>,
  field: string,
): { readonly ok: true; readonly value: string | undefined } | { readonly ok: false; readonly reason: string } {
  const value = raw[field]
  if (value === undefined) return { ok: true, value: undefined }
  // ⚠ 空串走 `missingFieldReason`，**不**走 `badFieldReason`（OCR 复核 LOW [16]）。
  //
  // 初版对 `''` 给的是 `badFieldReason(field, '非空白字符串或省略', '')` ——
  // 文案里「**或省略**」对 `''` 是**假话**：`undefined` 已在上一行被放行，
  // 走到这里就说明调用方**明确给了一个空值**，不是「省略」。
  // 「给了空串」与「没给」对调用方是两条不同的修法（前者要删字段，后者要补字段），
  // 故两者必须给出不同的文案。
  if (value === '') return { ok: false, reason: missingFieldReason(field) }
  if (!isNonEmptyString(value)) {
    return { ok: false, reason: badFieldReason(field, '非空字符串（不得为纯空白）', value) }
  }
  return { ok: true, value: value.trim() }
}

/** 非负安全整数（序号 / 计数类字段的唯一合法形状）。 */
export function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

/** 统一把一个 `catch` 到的值变成可读文本（与 t2 / t1 的同名函数逐字同形）。 */
/**
 * 把一个**捕获到的异常**渲染成一行可读文本（**绝不抛错**）。
 *
 * ## ⚠ 这里**不得**用裸 `String(error)`（OCR 复核 MEDIUM [7]，真实缺陷）
 *
 * 初版是 `error instanceof Error ? error.message : String(error)`，实测：
 * - `Object.create(null)` ⇒ `String()` **抛** `TypeError: Cannot convert object to primitive value`；
 * - 带抛错 `Symbol.toPrimitive` 的对象 ⇒ **抛** 它自己的异常。
 *
 * 而本函数**只被 `catch` 块调用** —— 于是「把失败转成可读原因」这条路径**自己会抛**，
 * 把本已捕获的异常换成另一个更难懂的异常冲出去，恰好破掉
 * 「工具只返回错误、绝不抛」这条契约。同一个坑在 HIGH [1]（`unreachableOutcome`）已踩过一次。
 *
 * ⇒ 走 `renderValueForMessage`（那个**专门**为「绝不抛错」写的渲染器）。
 * 特殊照顾 `Error.message`：它通常是最有诊断价值的一段，优先用它；
 * 取其 `.message` 本身也可能抛（自定义 getter），故也套 try。
 */
export function describeError(error: unknown): string {
  // [19] `instanceof` 本身也可能抛：带抛错 `getPrototypeOf` trap 的 Proxy 会让它抛
  // `TypeError`。而本函数**只被 catch 块调用** ⇒ 那一抛会从 `guarded` 的 catch 里冲出去，
  // 破掉「绝不抛」。⇒ 整个判定都收进 try。
  // 用 `Error | null` 承接而不是布尔：布尔**不参与类型收窄**（实测 TS18046：
  // `error` 仍是 `unknown`），而我们需要在下面安全地读 `.message`/`.name`。
  let asError: Error | null = null
  try {
    if (error instanceof Error) asError = error
  } catch {
    return renderValueForMessage(error)
  }
  if (asError !== null) {
    try {
      const message = asError.message
      // [17] `message` 是**空串**时不能直接返回：那会产出半截文案（`读账本投影时抛错：`）。
      // `new Error('')`（只设 code 不写 message）在注入实现里很常见。
      // 空串 ⇒ 退回类型名，保证任何输入都产出一句人能读懂的话。
      if (typeof message === 'string' && message !== '') return message
      if (typeof message !== 'string') return renderValueForMessage(message)
    } catch {
      // `.message` 的 getter 抛错（刻意构造的异常对象）—— 退回类型名，绝不外抛。
      //
      // ⚠ **`error.name` 本身也可能抛**（OCR 复核 MEDIUM [1]，真实缺陷：我第一版
      // 把 `error.name` 读在 try **外面**，而 `.name` 的 getter 同样可以被定义成抛错。
      // 它所在的这个 catch 块**没有外层 try** ⇒ 那一下会把「读 message 失败」再换成
      // 一个更新的异常冲出去，恰好破掉本函数存在的理由（它只被 catch 块调用）。
      // 实测：`Object.defineProperty(err,'name',{get(){throw ...}})` 后读 `.name` 会抛。
      try {
        const name = asError.name
        return `一个 ${typeof name === 'string' && name !== '' ? name : 'Error'}（读 message 时抛错）`
      } catch {
        return '一个 Error（读 message/name 时均抛错）'
      }
    }
    // `message` 是空串：如实说明它是空的，而不是产出一句半截文案。
    let name = 'Error'
    try {
      const raw = asError.name
      if (typeof raw === 'string' && raw !== '') name = raw
    } catch {
      // 读 name 抛错 ⇒ 用默认名，不破坏「绝不抛」。
    }
    return `${name}（message 为空）`
  }
  return renderValueForMessage(error)
}

/**
 * 把「模型传来的对象」当成**未校验的字典**读。
 *
 * 存在的理由（不是洁癖）：工具的入参在类型层是 `XxxInput`，但运行期是**模型生成的 JSON**，
 * 而 `execute` 也可能被 JS 调用方直接调用。t2 实测过同一类缺陷：
 * `notify(null)` 抛 `TypeError` 从事件派发路径冲出去（只有 `null`/`undefined` 会抛，
 * 传数字不抛 —— 所以随手试一个值会得到「没问题」的假象）。
 * 工具面同理：**先把它收成一个对象，再逐字段判**，任何形状都只落进 `invalid-input`，
 * 绝不抛。
 *
 * 非对象（含 `null` / 数组 / 原始值）一律收成空字典：于是后续的「必填字段缺失」
 * 会给出**同一条**可读原因，而不是五种各不相同的 TypeError 文案。
 */
export function asUncheckedRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {}
  }
  return value as Record<string, unknown>
}

/**
 * 把一次**宿主注入端口**的读取收口成结果值（OCR 复核 HIGH [14][7]）。
 *
 * ## 为什么必须有一个共享实现
 *
 * 本包的工具契约是「**只返回错误、绝不抛**」，而注入端口的实现
 *（投影 / 账本 / 运行时）都读得到外部状态，随时可能抛。
 * 就地 `try/catch` 在各工具里各写几遍的后果已经实测过两次：
 * 先是在 `task-claim.ts` 漏包了三个投影端口（HIGH [14]），
 * 又在 `message.ts` 漏包了 `resolveMemberRef`/`threadOf`/`channelTeamOf`（HIGH [14] 二例）。
 * 收口成一个函数后，每个端口在调用点都**必须**经过它 ——
 * 「哪个端口漏包了 try」不再是看一眼才知道的事。
 *
 * ## 用法：返回 `Result` 而不是就地 return
 *
 * 调用方**必须**显式处理 `!ok`（类型上强制），这样「新加一个端口读取却忘了包」
 * 会表现为**类型不对**（拿到的是 `Result` 不是值），而不是运行期穿透。
 */
export function guarded<T>(
  read: () => T,
): { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: string } {
  try {
    return { ok: true, value: read() }
  } catch (error) {
    return { ok: false, reason: describeError(error) }
  }
}

/**
 * 缺失字段的统一文案（把「没给」与「给了但形状不对」区分开）。
 *
 * ⚠ 判据必须与 `isNonEmptyString` 的**实际**行为一致：
 * 它 reject 的不只是 `''`，还有纯空白串（`' '`）。只写「非空」会让
 * 「传了一个空格却被拒」看起来像误判。故这里把「非空白」说出来。
 *
 * （`narrowTrimmedString` 对 `''` 会走本函数、对纯空白串走 `badFieldReason` ——
 *  两种输入的修法不同，文案也就必须不同。见那个函数的 LOW [16] 注释。）
 */
export function missingFieldReason(field: string): string {
  // ⚠ 文案必须与 `isNonEmptyString` 的**实际**判据一致（OCR 复核 LOW [4]）：
  // 它 reject 的不只是 `''`，还有纯空白串（`' '`）。只写「非空」会让
  // 「传了一个空格却被拒」看起来像误判。这里把两条都说出来。
  return `缺少必填参数 ${field}（必须是**非空白**的非空字符串；纯空白不算）。`
}

/**
 * 结果联合的**渲染兜底**（唯一实现）。
 *
 * ## 为什么需要它，而不是直接用 `src/types/guards.ts` 的 `assertNever`
 *
 * OCR 复核 LOW [10] 指出本文件此前在四个工具里各写了一份同名函数（`spawn-team.ts`
 * 用的是 `assertNever`），建议合并。**合并是对的，但合并到 `assertNever` 是错的**——
 * 两者回答不同的问题：
 *
 * | 函数 | 在哪用 | 该不该抛 |
 * |---|---|---|
 * | `assertNever` | **判定/执行**路径（`switch` 穷尽后落到不该到的地方）| **抛**：那说明逻辑分支漏了，响亮失败好过静默跑偏 |
 * | `unreachableOutcome` | **`render`** 路径（把结果渲染成给模型看的一行文本）| **不抛**：渲染一行文本不该把整次工具调用打崩 |
 *
 * ## ⚠ 这里**不得**用裸 `String(value)`（OCR 复核 HIGH [1]，真实缺陷）
 *
 * 初版是 `` `（未知结果分支：${String(value as unknown)}）` ``，而 `String()` 对
 * **无原型对象**（`Object.create(null)`）与**自定义 `Symbol.toPrimitive` 抛错**的对象
 * 会抛 `TypeError` —— 实测两种都抛（`Cannot convert object to primitive value` /
 * 自定义的 `Error`）。于是这个「render 的兜底」恰好会破掉它自己要守的
 * 「render 绝不抛错」不变量，而且是在**最不该出问题**的那条路径上。
 *
 * ⇒ 改用 `renderValueForMessage`（本文件里那个**专门**为「绝不抛错」写的渲染器，
 * 它对无原型对象与抛错对象都有兜底）。同一个不变量只该有一个实现。
 */
export function unreachableOutcome(value: never): string {
  return `（未知结果分支：${renderValueForMessage(value as unknown)}）`
}

/** 形状不对的统一文案。 */
export function badFieldReason(field: string, expected: string, actual: unknown): string {
  return `参数 ${field} 必须是${expected}，收到 ${renderValueForMessage(actual)}。`
}

/**
 * 把一个任意值渲染进错误信息（**绝不抛错**）。
 *
 * 与 `src/naming.ts` 的 `describeValue` 同源：`Object.create(null)` 与自定义
 * `Symbol.toPrimitive` 抛错的对象会让字符串拼接本身抛 `TypeError` ——
 * 而「工具只返回错误、绝不抛」这条契约会被它破坏。
 *
 * ## 为什么有两条出口，而不是「全都走 JSON.stringify」（OCR 复核 MEDIUM [17] / LOW [18]）
 *
 * `JSON.stringify` 有**两种**失败方式，而初版的注释只提了第一种：
 * 1. **抛错**：循环引用、抛错的 `toJSON`/getter，以及 **`BigInt`**
 *    （`JSON.stringify(1n)` 抛 `Do not know how to serialize a BigInt`）；
 * 2. **返回 `undefined`**：函数、`Symbol`、`toJSON` 自己返回 `undefined`。
 *    初版把它和「抛错」混进同一个兜底分支，且注释只说「循环引用会抛」——
 *    会诱使后来者把 `typeof json === 'string'` 那道判断当死代码删掉。
 *
 * ⇒ 结构是：**先**处理确定安全的原始值（`String()` 对 number/boolean/bigint
 * 永不抛 —— 实测 `String(1n) === '1'`，故 bigint 走这条而**不**进 `JSON.stringify`），
 * **再**试 `JSON.stringify` 并同时接受上述两种失败，最后退回类型名。
 * 测试同时覆盖「抛错」与「返回 undefined」两类。
 */
export function renderValueForMessage(value: unknown): string {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value)
  }
  // [1] 类型名在 **try 外**取好：catch 里再用 `typeof value` 是多算一次，
  // 而两次求值之间理论上没有差异、却让「两个失败分支的文案」有了分叉的可能。
  // （OCR 复核 LOW [1]。）`typeof` 本身永不抛，故放在外面是安全的。
  const typeName = typeof value
  try {
    const json = JSON.stringify(value)
    if (typeof json === 'string') return json
    // 走到这里说明 `JSON.stringify` 返回了 `undefined`（函数 / Symbol / toJSON 自己返回 undefined）。
    // 这是一条**正常**路径，不是异常；故文案与下面「抛错」那条**刻意不同**，
    // 以便测试与排查能区分「没法序列化」与「没有 JSON 表示」。
    return `一个 ${typeName}（无 JSON 表示）`
  } catch {
    // 循环引用 / toJSON 抛错 / BigInt —— 退回类型名，绝不让「渲染错误信息」自己抛。
    return `一个 ${typeName}（无法序列化）`
  }
}
