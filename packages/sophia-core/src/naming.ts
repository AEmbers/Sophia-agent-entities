/**
 * FR-5A 三层标识命名门禁（SPEC §3 全文）。
 *
 * 三层各解决一个不同的问题，**不可合并**：
 * | 层 | 字段 | 唯一性 | 字符集 |
 * |---|---|---|---|
 * | 职位 | `position` | 否（同职位可多实例） | 纯中文，且必须是 §3.2 的 20 个规范职位之一 |
 * | 成员名 | `name` | 团队内唯一 | `职位名` 或 `职位名-<序号≥2>` |
 * | 成员 ID | `memberId` | 全局唯一 | `sophia-<slug>-<uuid8>` |
 *
 * ## 本文件的两条硬约束（都来自 captain 裁定，不是实现选择）
 *
 * 1. **`POSITIONS` 是闭集，名册外一律硬拒绝**（裁定 Q-D）。依据：FR-8.1 要求职位名与素材图上
 *    烧入的标签**逐字一致**，而素材只有这 20 张图（实测标签已烧入像素，不透明占比 94.4%）。
 *    放开名册会立刻产出「无头像可用」的成员，直接反例 FR-5A.4。⇒ `POSITION_UNKNOWN` 是硬拒绝，
 *    且错误信息必须列出全部合法职位名（便于调用方自查）。
 * 2. **slug 以 `POSITION_SLUGS` 规范表为准，不引入 `pinyin-pro` 等运行时依赖**（SPEC §10 附带裁定）。
 *    依据：`灵台郎` 文档示例钉的是 `lingtai-lang`，而通用拼音库逐字给出 `ling-tai-lang`
 *    （机构名「灵台」必须整体转写）；同一库在「星文审校」上把「审校」的「校」读成 `xiao`
 *    （应为校订义的 `jiao`，见裁定 Q-A）。**表把歧义消掉，测试才有唯一答案** ——
 *    引入库只会为「表与库不一致」制造新的不确定来源。
 *
 * ⚠ 与 `DEVELOPMENT.md:102` 的冲突已裁决：那里遗留的正则 `^Sophia[\u4e00-\u9fa5][\u4e00-\u9fa5_0-9]*$`
 * **已作废**（它强制 `Sophia` 前缀、且允许下划线与数字，与 FR-5A.5 / FR-8.1 / FR-8.5 三点冲突）。
 * 有效门禁是本文件的纯中文闭集校验；`Sophia` 前缀**只**出现在 `memberId`。
 *
 * 本文件只依赖 `node:crypto`（生成 uuid8），**不依赖任何 `@deepseek-ai/*`**（SPEC §1.1）。
 */

import { randomBytes } from 'node:crypto'

import type {
  MemberId,
  MemberIdentity,
  MemberLifecycle,
  MemberName,
  Position,
} from './types/index.ts'

/**
 * 规范职位名册（20 位，**逐字**取自 `assets/members/out-512/` 的 PNG 文件名）。
 *
 * 分组顺序与素材目录的梯队一致（第一梯队 → 第四梯队，每组 5 个）。
 * 与素材目录的**双向**一致性由 `tests/naming.spec.ts` 用 `node:fs` 实读目录断言
 * （既无遗漏、也无多余；AC-5A-1）。
 */
export const POSITIONS = [
  // 第一梯队 · 管理与总控组
  '钦天监监正',
  '灵台主事',
  '时宪主事',
  '典籍掌事',
  '星禁掌察',
  // 第二梯队 · 产品分析与设计组
  '观象访事',
  '星图主事',
  '象绘主事',
  '星绘主事',
  '传报主事',
  // 第三梯队 · 架构与研发组
  '灵台郎',
  '历算主事',
  '星仪主事',
  '数象主事',
  '推步主事',
  // 第四梯队 · 测试运维与文档组
  '星验主事',
  '星机校验',
  '天象值守',
  '星文审校',
  '录典主事',
] as const

/** 规范职位名的字面量联合（名册是**闭集**，裁定 Q-D）。 */
export type KnownPosition = (typeof POSITIONS)[number]

const POSITION_SET: ReadonlySet<string> = new Set<string>(POSITIONS)

/**
 * 判断一个字符串是否是规范名册内的职位名。
 *
 * 运行期 `typeof` 检查不是多余的：从 JS 调用方或 JSON 反序列化来的值可能是
 * `undefined` / 数字（品牌类型在运行期不存在），`Set.has` 对它们返回 `false` 是正确的，
 * 而显式检查让这个意图写在代码里而不是隐式依赖 `Set` 的语义。
 */
export function isKnownPosition(value: string): value is KnownPosition {
  return typeof value === 'string' && POSITION_SET.has(value)
}

/**
 * 可作为 slug **前缀整体**的天文机构名（SPEC §3.3）。
 *
 * 它不是「第二条推导规则」—— 权威永远是 `POSITION_SLUGS` 表。这里只记录
 * 「构表时哪些词是整体转写的」，供测试交叉核对表的**内部一致性**：
 * 凡以机构名开头的职位，其 slug 必须以该机构的整词转写开头
 * （`灵台郎` → `lingtai-lang`，而不是 `ling-tai-lang`）。
 */
export const INSTITUTIONS = ['钦天监', '灵台', '推步', '历算'] as const

/**
 * 规范 slug 表：20 个规范职位的**唯一权威映射**（SPEC §3.3，逐字照录）。
 *
 * 实现必须以此表为准（表驱动），不得靠通用拼音库实时推导 —— 理由见文件头。
 */
export const POSITION_SLUGS: Readonly<Record<KnownPosition, string>> = {
  // 机构「钦天监」整体转写
  钦天监监正: 'qintianjian-jian-zheng',
  // 机构「灵台」整体转写
  灵台主事: 'lingtai-zhu-shi',
  时宪主事: 'shi-xian-zhu-shi',
  典籍掌事: 'dian-ji-zhang-shi',
  星禁掌察: 'xing-jin-zhang-cha',
  观象访事: 'guan-xiang-fang-shi',
  星图主事: 'xing-tu-zhu-shi',
  象绘主事: 'xiang-hui-zhu-shi',
  星绘主事: 'xing-hui-zhu-shi',
  传报主事: 'chuan-bao-zhu-shi',
  // ⚠️ 文档示例（REQUIREMENTS.md:204）逐字钉死；机构「灵台」整体转写，**不得**写成 ling-tai-lang
  灵台郎: 'lingtai-lang',
  // 机构「历算」整体转写
  历算主事: 'lisuan-zhu-shi',
  星仪主事: 'xing-yi-zhu-shi',
  数象主事: 'shu-xiang-zhu-shi',
  // 机构「推步」整体转写
  推步主事: 'tuibu-zhu-shi',
  星验主事: 'xing-yan-zhu-shi',
  星机校验: 'xing-ji-jiao-yan',
  天象值守: 'tian-xiang-zhi-shou',
  // ⚠️ 裁定 Q-A：「审校」取校订义 jiào（非 xiào）。通用拼音库此处返回 shen-xiao，与词义不符
  // （同库对「星机校验」返回 jiao-yan，说明库两读都会用、只是此处选错）。语义优先，见 SPEC §3.3 / §10 Q-A。
  星文审校: 'xing-wen-shen-jiao',
  录典主事: 'lu-dian-zhu-shi',
}

/** 允许出现在职位名里的汉字区间：CJK 统一汉字基本区。 */
const CHINESE_ONLY = /^[\u4e00-\u9fa5]+$/
/** slug 形状：小写字母 + 连字符（AC-5A-3）。 */
const SLUG_SHAPE = /^[a-z]+(?:-[a-z]+)*$/
/** uuid8 形状：8 位**小写**十六进制。 */
const UUID8_SHAPE = /^[0-9a-f]{8}$/
/** memberId 形状：`sophia-<slug>-<uuid8>`。锚定两端，`-extra` 之类的尾巴一律不匹配。 */
const MEMBER_ID_SHAPE = /^sophia-([a-z]+(?:-[a-z]+)*)-([0-9a-f]{8})$/
/**
 * 成员名形状：`职位名` 或 `职位名-<数字>`。
 *
 * 用整体匹配而非「先 split('-') 再拼」：后者对 `灵台郎-2-3` 会得出奇怪的分段结论，
 * 而整体匹配只有「纯中文基名 + 可选 -数字」两种形态，形状判定没有第三种解释。
 */
const NAME_SHAPE = /^([\u4e00-\u9fa5]+)(?:-([0-9]+))?$/

/** 职位名规则原文（`NamingViolation.rule`）。 */
const RULE_POSITION_CHINESE =
  '职位名须为纯中文：只允许汉字，不得含英文字母、数字、空格或符号'
const RULE_POSITION_KNOWN =
  '职位名必须是规范名册内的 20 个职位之一（名册外的职位名一律硬拒绝）'
const RULE_NAME_SHAPE =
  '成员名形状须为「职位名」或「职位名-序号」，序号从 2 起且不得有前导零；不得出现英文字母'
const RULE_NAME_UNIQUE = '成员名在团队内唯一：职位名与序号的组合不得与在用成员重复'
const RULE_MEMBER_ID = '成员 ID 形状须为 sophia-<职位slug>-<8位小写十六进制>'

/** 命名违例的错误码（SPEC §3.6，恰为 5 个 —— 增删都会让 `tests/naming.spec.ts` 的穷尽断言变红）。 */
export type NamingErrorCode =
  /** 含非中文（如英文、数字、空格）。 */
  | 'POSITION_NOT_CHINESE'
  /** 纯中文但不在 `POSITIONS` 名册内。 */
  | 'POSITION_UNKNOWN'
  /** 团队内重名。 */
  | 'NAME_NOT_UNIQUE'
  /** 不符 `职位名` 或 `职位名-<序号≥2>`。 */
  | 'NAME_SHAPE_INVALID'
  /** 不符 `sophia-<slug>-<uuid8>`。 */
  | 'MEMBER_ID_SHAPE_INVALID'

/**
 * 命名违例（FR-8.4：违规必须**同时**带规则说明与正确示例）。
 *
 * `message` 是面向用户的中文说明，且**内嵌** `rule` 与 `example` ——
 * 「错误信息须说明规则与正例」这条要求不是靠调用方自觉，而是由类型本身携带。
 */
export interface NamingViolation {
  readonly code: NamingErrorCode
  /** 面向用户的说明（中文）。 */
  readonly message: string
  /** 被违反的规则原文。 */
  readonly rule: string
  /** 正确示例。 */
  readonly example: string
}

/** 门禁结果。用返回值而非异常：校验是**正常流程**（用户输入），不是异常流程。 */
export type NamingResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly violation: NamingViolation }

/**
 * 生成/构造类函数的失败形态。
 *
 * 为什么这里抛错而不是返回 `NamingResult`：`toMemberId` / `allocateMemberName` 的签名由
 * SPEC §3.4/§3.5 钉死为**直接返回构造物**（`positionSlug` 的契约原文即「未知名册的职位抛
 * `NamingViolation`」）。调用方若要「拒绝而不抛」，应先用 `validatePosition` 拿到 `NamingResult`。
 *
 * 它结构化地满足 `NamingViolation` 接口（`code` / `message` / `rule` / `example`），
 * 因此 `catch (e) { if (e instanceof NamingViolationError) show(e.rule, e.example) }` 可直接用。
 */
export class NamingViolationError extends Error implements NamingViolation {
  readonly code: NamingErrorCode
  readonly rule: string
  readonly example: string

  constructor(violation: NamingViolation) {
    super(violation.message)
    this.name = 'NamingViolationError'
    this.code = violation.code
    this.rule = violation.rule
    this.example = violation.example
  }
}

function ok<T>(value: T): NamingResult<T> {
  return { ok: true, value }
}

/**
 * 构造违例。`message` 固定为「说明 + 规则 + 正例」三段，
 * 使 AC-5A-14（每条违例的 `rule`/`example` 非空且 `message` 含规则关键词）成为**结构保证**。
 */
function violate(
  code: NamingErrorCode,
  detail: string,
  rule: string,
  example: string,
): { readonly ok: false; readonly violation: NamingViolation } {
  return {
    ok: false,
    violation: { code, message: `${detail}。规则：${rule}。正例：${example}`, rule, example },
  }
}

/** 名册提示串（裁定 Q-D：错误信息须列出合法职位名，供调用方自查）。 */
function rosterHint(): string {
  return `合法职位名共 ${POSITIONS.length} 个：${POSITIONS.join('、')}`
}

/**
 * 把一个**任意**运行期值安全地渲染进错误信息。
 *
 * 不能直接用 `${value}` / `String(value)`：`Object.create(null)`（无原型对象）与
 * 自定义 `Symbol.toPrimitive` 抛错的对象会让**字符串拼接本身**抛 `TypeError` ——
 * 校验函数的原则是「绝不抛错，只返回违例」，若渲染输入值就可能抛，那条原则就破了。
 * 本函数是实测产物：`tests/naming.spec.ts` 传入 `Object.create(null)` 时，
 * 初版实现真的抛了 `TypeError: Cannot convert object to primitive value`。
 */
function describeValue(value: unknown): string {
  if (typeof value === 'string') {
    return `「${value}」`
  }
  if (value === null) {
    return 'null'
  }
  const kind = typeof value
  if (kind === 'object' || kind === 'function') {
    // 不调用 toString：无原型对象、自定义 toPrimitive 的对象、以及 **toString 自己会抛的函数**
    // 都会让字符串拼接抛错。
    // `function` 与 `object` 同类处理是 OCR 评审 [29] 的产物：原先只挡了 `object`，
    // 而 `typeof (() => {}) === 'function'` 会落到下面的 `String()` 分支。
    // 这一支的**独立价值在消息质量**：函数默认的 `toString` 会返回整个源码文本，
    // 直接拼进错误信息又长又没用。**不抛错这条不变量另有承担者** —— 见下面的 `try`。
    return `一个 ${kind}（非字符串）`
  }
  // 兜底 `try`：与上面那一支共同保证「绝不抛错」。
  // 覆盖前置分支未枚举的类型（symbol / bigint 等）。
  // ⚠ 变异测试实测（记录在此以免后人误判）：**单独**删掉上面那一支、或**单独**删掉本 `try`，
  // 测试**都仍全绿**（两者是等价变异体：对 `function` 输入，谁在都能挡住）；
  // 只有**同时**删掉，`OCR [29]` 用例才变红。
  // ⇒ 承重的是「这一对机制所实现的不变量」，而不是其中任何一个单独的分支。
  // 不要在只删一处看到全绿后，就把另一处当死代码删掉。
  try {
    return `「${String(value)}」（${kind}）`
  } catch {
    return `一个 ${kind}（非字符串）`
  }
}

/**
 * 校验职位名（SPEC §3.6）：**纯中文** + **属名册**（裁定 Q-D 硬拒绝）。
 *
 * 不要求 `Sophia` 前缀（FR-5A.5 / FR-8.1）；`Sophia` 前缀只允许出现在 `memberId`。
 */
export function validatePosition(value: string): NamingResult<Position> {
  if (typeof value !== 'string' || !CHINESE_ONLY.test(value)) {
    return violate(
      'POSITION_NOT_CHINESE',
      `职位名 ${describeValue(value)} 含非中文字符（职位名不得含英文字母、数字、空格或符号）`,
      RULE_POSITION_CHINESE,
      '灵台郎',
    )
  }
  if (!isKnownPosition(value)) {
    return violate(
      'POSITION_UNKNOWN',
      `职位名「${value}」虽为纯中文，但不在规范名册内；${rosterHint()}`,
      RULE_POSITION_KNOWN,
      '灵台郎',
    )
  }
  return ok(value)
}

/** 职位名门禁的抛错形态：供生成类函数在入口一次性拒绝非法职位。 */
function requireKnownPosition(position: string): KnownPosition {
  const result = validatePosition(position)
  if (!result.ok) {
    throw new NamingViolationError(result.violation)
  }
  if (!isKnownPosition(result.value)) {
    // 不可达（validatePosition 已保证），但让类型收窄成立而不必 `as`。
    throw new NamingViolationError(
      violate('POSITION_UNKNOWN', `职位名「${position}」不在规范名册内`, RULE_POSITION_KNOWN, '灵台郎')
        .violation,
    )
  }
  return result.value
}

/**
 * 职位 → slug（SPEC §3.3）。**以 `POSITION_SLUGS` 表为准**，不实时推导拼音。
 * 未知名册的职位抛 `NamingViolationError`。
 */
export function positionSlug(position: string): string {
  return POSITION_SLUGS[requireKnownPosition(position)]
}

/** `memberId` 的解析结果。 */
export interface MemberIdParts {
  readonly slug: string
  readonly uuid8: string
}

/**
 * 用给定 `uuid8` 构造 `memberId`（SPEC §3.4）。
 *
 * 两个入口都硬拒绝：职位不在名册 → `POSITION_*`；`uuid8` 不是 8 位小写十六进制 →
 * `MEMBER_ID_SHAPE_INVALID`。**不做静默修正**（不补零、不转小写）—— 静默修正会让
 * 「调用方以为在用某 ID、账本里却是另一个」这种最难查的问题变成可能。
 */
export function toMemberId(position: string, uuid8: string): MemberId {
  const slug = positionSlug(position)
  // slug 形状在此**运行期**校验，而不是只靠测试。
  // 真实价值：`POSITION_SLUGS` 是人工维护的表，若有人给新职位写进 `LingTai-Lang` 这样的大写 slug，
  // 不做此检查就会产出一个 `parseMemberId` **永远解析不回来**的 memberId ——
  // 成员能建、能落账本，但读回时形状门禁拒收，属于最难查的那类静默损坏。
  // 这里把它变成 fail-fast 的显式错误。
  if (!SLUG_SHAPE.test(slug)) {
    throw new NamingViolationError(
      violate(
        'MEMBER_ID_SHAPE_INVALID',
        `职位「${position}」的 slug「${slug}」形状非法（只允许小写字母与连字符）—— 多为 POSITION_SLUGS 表的笔误`,
        RULE_MEMBER_ID,
        'sophia-lingtai-lang-a1b2c3d4',
      ).violation,
    )
  }
  if (typeof uuid8 !== 'string' || !UUID8_SHAPE.test(uuid8)) {
    throw new NamingViolationError(
      violate(
        'MEMBER_ID_SHAPE_INVALID',
        `uuid8 ${describeValue(uuid8)} 不是 8 位小写十六进制`,
        RULE_MEMBER_ID,
        'sophia-lingtai-lang-a1b2c3d4',
      ).violation,
    )
  }
  return `sophia-${slug}-${uuid8}` as MemberId
}

/**
 * 解析 `memberId`（SPEC §3.4）；不匹配规范格式时返回 `null`（**不抛错**）。
 *
 * 只校验**形状**，不校验 slug 是否属 `POSITION_SLUGS`：解析是结构操作，
 * 名册成员资格由构造入口（`toMemberId` / `positionSlug`）在写入侧把关。
 * 让 `parse` 也做名册校验，会让「读回一条历史/外来的 ID」变成不可能是合法形状的操作，
 * 而 SPEC 在此处只定义了形状（AC-5A-5 的 5 类畸形输入也全是形状问题）。
 */
export function parseMemberId(memberId: string): MemberIdParts | null {
  if (typeof memberId !== 'string') {
    return null
  }
  const matched = MEMBER_ID_SHAPE.exec(memberId)
  if (matched === null) {
    return null
  }
  const slug = matched[1]
  const uuid8 = matched[2]
  if (slug === undefined || uuid8 === undefined) {
    // 不可达（正则的两个捕获组都是必配），仅为满足 `noUncheckedIndexedAccess`。
    return null
  }
  return { slug, uuid8 }
}

/** 生成一个符合形状的 `uuid8`（8 位小写十六进制）。调用方负责全局唯一性校验（SPEC §3.4）。 */
export function newUuid8(): string {
  return randomBytes(4).toString('hex')
}

/** 成员名的占用项（SPEC §3.5）。 */
export interface NameOccupancy {
  readonly name: MemberName
  readonly lifecycle: MemberLifecycle
}

/**
 * 参与名字占用的生命周期：`'active'` 与 `'suspended'`。
 * **不**参与占用：`'archived'` 与 `'destroyed'` —— 名字释放、可被复用（SPEC §3.5）。
 *
 * 写成**穷尽 switch**（无 `default`）而非 `!== 'archived' && !== 'destroyed'` 黑名单：
 * 若将来给 `MemberLifecycle` 新增取值，黑名单会**静默**把它算作「不占用」，
 * 而本函数在 `strictNullChecks` 下会以 TS2366（缺少返回语句）**编译失败**，
 * 逼后来者显式决定新取值的归属。这是本文件里唯一「靠编译器守门」的地方，
 * 反恒真做法见 `tests/naming.spec.ts` 的批注（往联合里加第 5 个取值 ⇒ tsc 必红）。
 */
function occupiesName(lifecycle: MemberLifecycle): boolean {
  switch (lifecycle) {
    case 'active':
    case 'suspended':
      return true
    case 'archived':
    case 'destroyed':
      return false
  }
}

/** 收集仍占用的成员名集合。 */
function occupiedNameSet(occupied: readonly NameOccupancy[]): ReadonlySet<string> {
  const taken = new Set<string>()
  for (const entry of occupied) {
    if (occupiesName(entry.lifecycle)) {
      taken.add(entry.name)
    }
  }
  return taken
}

/**
 * 为一个职位分配团队内唯一的成员名（SPEC §3.5）。
 *
 * 规则：无冲突 → 职位名本身；已有同名 → `职位名-<最小可用序号 ≥ 2>`
 * （**取最小可用，不取 max+1** —— `-2` 空着就得补 `-2`）。
 * 职位名不在名册内时抛 `NamingViolationError`（裁定 Q-D：门禁在**每个**入口都硬拒绝）。
 */
export function allocateMemberName(
  position: string,
  occupied: readonly NameOccupancy[],
): MemberName {
  const base = requireKnownPosition(position)
  const taken = occupiedNameSet(occupied)
  if (!taken.has(base)) {
    return base
  }
  for (let sequence = 2; ; sequence += 1) {
    const candidate = `${base}-${sequence}`
    if (!taken.has(candidate)) {
      return candidate
    }
  }
}

/**
 * 校验成员名（SPEC §3.6）：形状合法（`职位名` 或 `职位名-<序号≥2>`）**且**在给定占用下唯一。
 *
 * 形状里「职位名」一项按裁定 Q-D 取**闭集**语义：基名不是规范名册内职位名的（如 `天官正`、
 * `Sophia灵台郎`）一律 `NAME_SHAPE_INVALID` —— 否则会造出「成员名合法但无头像可用」的成员，
 * 正是 FR-5A.4 要防的反例。`-1` / `-0` / `-02` 同样拒（序号从 2 起、无前导零，
 * 与 `allocateMemberName` 的产出形态**一致**：门禁只接受生成器会产出的那种形状）。
 */
export function validateMemberName(
  value: string,
  occupied: readonly NameOccupancy[],
): NamingResult<MemberName> {
  // 两个入口守卫各自有**可观测的后果**（不同的 message 与不同的失败原因），
  // 因此它们不是「行为等价的重复分支」—— 见 `tests/naming.spec.ts` 中针对这两条 message
  // 的断言（去掉任一条，对应断言即变红；变异测试 M35/M36 实测捕获）。
  if (typeof value !== 'string') {
    return violate(
      'NAME_SHAPE_INVALID',
      `成员名必须是字符串（收到 ${typeof value}）`,
      RULE_NAME_SHAPE,
      '灵台郎',
    )
  }
  if (value.length === 0) {
    return violate('NAME_SHAPE_INVALID', '成员名不得为空', RULE_NAME_SHAPE, '灵台郎')
  }
  const matched = NAME_SHAPE.exec(value)
  if (matched === null) {
    return violate(
      'NAME_SHAPE_INVALID',
      `成员名「${value}」形状不合法（成员名不得含英文字母或符号）`,
      RULE_NAME_SHAPE,
      '灵台郎',
    )
  }
  const base = matched[1]
  const sequenceText = matched[2]
  if (base === undefined) {
    return violate(
      'NAME_SHAPE_INVALID',
      `成员名「${value}」缺少职位名部分`,
      RULE_NAME_SHAPE,
      '灵台郎',
    )
  }
  if (!isKnownPosition(base)) {
    return violate(
      'NAME_SHAPE_INVALID',
      `成员名的职位名部分「${base}」不在规范名册内；${rosterHint()}`,
      RULE_NAME_SHAPE,
      '灵台郎',
    )
  }
  if (sequenceText !== undefined) {
    if (sequenceText.startsWith('0')) {
      return violate(
        'NAME_SHAPE_INVALID',
        `成员名「${value}」的序号有前导零（须写作 ${base}-${String(Number(sequenceText))}）`,
        RULE_NAME_SHAPE,
        `${base}-2`,
      )
    }
    const sequence = Number(sequenceText)
    // 只需要 `isSafeInteger` 这一条 —— 往返比对（`String(sequence) !== sequenceText`）是**死代码**，
    // 且实测证据表明 OCR 评审 [2] 的机制描述有误，故不采纳那条建议（记录在此以免后人重加）：
    // - 评审称 `灵台郎-9007199254740993` 的 `Number()` 得到 `9007199254740992` 且「仍通过 isSafeInteger」。
    //   **前半句对、后半句错**：实测 `Number.isSafeInteger(9007199254740992) === false`
    //   （2^53 恰好超界，`isSafeInteger` 要求 |n| ≤ 2^53-1）。
    // - 更一般地，`NAME_SHAPE` 已保证后缀是**无前导零**的十进制数字串，此时
    //   「`isSafeInteger` 为真」⇒ 该值可精确表示 ⇒ `String(n)` 必等于原串。
    //   故不存在「安全整数却往返不一致」的输入（穷举 [2, 200000) 无反例；2^53-1 通过、2^53 被拒）。
    // ⇒ 保留 isSafeInteger 即可，多加一条比对只会制造一个**永远无法变红**的断言面
    //   （反恒真实测：删掉该比对，两套命令仍全绿 —— 这正是「死代码」的判据）。
    if (!Number.isSafeInteger(sequence) || sequence < 2) {
      return violate(
        'NAME_SHAPE_INVALID',
        `成员名「${value}」的序号为 ${sequenceText}（序号从 2 起；第 1 个实例直接用职位名「${base}」）`,
        RULE_NAME_SHAPE,
        `${base}-2`,
      )
    }
  }
  const taken = occupiedNameSet(occupied)
  if (taken.has(value)) {
    return violate(
      'NAME_NOT_UNIQUE',
      `成员名「${value}」已在本团占用（活跃或已挂起）`,
      RULE_NAME_UNIQUE,
      allocateMemberName(base, occupied),
    )
  }
  return ok(value)
}

/**
 * 校验 `memberId` 形状（SPEC §3.6）。全局唯一性由账本保证，**不在此判定**。
 */
export function validateMemberId(value: string): NamingResult<MemberId> {
  if (typeof value !== 'string' || parseMemberId(value) === null) {
    return violate(
      'MEMBER_ID_SHAPE_INVALID',
      `成员 ID ${describeValue(value)} 形状不合法；成员 ID 只允许小写，且由 sophia- 前缀、职位 slug、8 位小写十六进制组成`,
      RULE_MEMBER_ID,
      'sophia-lingtai-lang-a1b2c3d4',
    )
  }
  return ok(value as MemberId)
}

/**
 * 界面显示名（FR-5A.4）：**优先职位名**，仅在重名需要区分时露出序号。
 *
 * 这不是 `identity.name` 的别名 —— 它对**名字与职位脱钩**的数据有独立行为：
 * 若 `name` 既不是 `position` 本身、也不是 `position-<数字>`，则一律显示 `position`。
 * 依据 FR-5A.4「显示名与图上标签始终一致」：素材上的职位标签已烧入像素（不可改写），
 * 显示一个与之无关的名字，就是让界面与像素资产互相矛盾。脱钩数据一旦出现（迁移、手工构造、
 * 账本回放），显示层必须收敛到职位名这一侧。
 *
 * ⚠ **本函数只有一个判定点**，是刻意的（反恒真实测的结果）：初版写成
 * 「`if (name === position) return name` 早返回 + 下面的序号判定」两段，
 * 变异测试（把早返回整段删掉）**仍然全绿** —— 因为 `name === position` 时序号判定
 * 的 `startsWith('${position}-')` 必然为假、后缀为空串、最终同样返回 `position`。
 * 那条早返回是**行为等价**的重复分支，不是优化：留着它会让「有两条路」成为读者的错觉，
 * 并制造一个永远无法变红的断言面。故合并为单点判定。
 */
export function displayNameOf(identity: MemberIdentity): string {
  const { position, name } = identity
  const suffix = name.startsWith(`${position}-`) ? name.slice(position.length + 1) : ''
  return /^[0-9]+$/.test(suffix) ? name : position
}
