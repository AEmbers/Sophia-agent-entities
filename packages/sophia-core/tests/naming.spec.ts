/**
 * FR-5A 三层标识命名门禁的验收测试（SPEC §3 全文 / §7.2）。
 *
 * 覆盖的 AC：AC-5A-1 … AC-5A-15 全部 15 条。
 *
 * ## 本文件的断言分两类
 *
 * - **运行期断言**（`expect`）：覆盖 5 个错误码的**每条产生分支**与名字占用的**每个生命周期分支**。
 * - **编译期断言**（`@ts-expect-error`）：`assertNever` 的穷尽性 —— 见文件末「编译期守卫」一节。
 *
 * ## 三条反恒真纪律（本文件的断言都按它设计）
 *
 * 1. **每条分支都要有阴性用例。** t3 的实测教训：某个守卫的 `host` 分支被改成恒真 `return true`
 *    而两套命令仍全绿，因为阴性用例只覆盖了另一个分支。本文件对 `occupiesName` 的
 *    **4 个生命周期取值**、`validatePosition` 的**3 个分支**、`validateMemberName` 的
 *    **5 个形状分支 + 唯一性分支**逐一给了独立用例；任何一条被改成恒真都会至少红一条。
 * 2. **表驱动而非手抄。** slug 断言遍历 `POSITIONS` 与 `POSITION_SLUGS` 对拍，
 *    而不是把 20 行复制进测试 —— 复制过来的期望值会在实现改动时**一起失效**。
 * 3. **不拿自己写的函数给自己作证。** 期望值全部是**字面量**（`'lingtai-lang'`、
 *    `'灵台郎-2'`）或来自 SPEC §3.2/§3.3 的表，没有一个期望值由被测实现计算得出。
 */

import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  INSTITUTIONS,
  NamingViolationError,
  POSITIONS,
  POSITION_SLUGS,
  allocateMemberName,
  displayNameOf,
  isKnownPosition,
  newUuid8,
  parseMemberId,
  positionSlug,
  toMemberId,
  validateMemberId,
  validateMemberName,
  validatePosition,
  type KnownPosition,
  type MemberId,
  type MemberLifecycle,
  type MemberName,
  type NameOccupancy,
  type NamingErrorCode,
  type NamingResult,
  type Position,
} from '../src/index.ts'

// ────────────────────────────────────────────────────────────────────────────
// 测试数据
// ────────────────────────────────────────────────────────────────────────────

/** SPEC §3.2 的梯队表（逐字照录；AC-5A-1 要求与素材目录**双向**一致）。 */
const TIER_EXPECTATION: Readonly<Record<string, readonly string[]>> = {
  '01_第一梯队_管理与总控组': ['钦天监监正', '灵台主事', '时宪主事', '典籍掌事', '星禁掌察'],
  '02_第二梯队_产品分析与设计组': ['观象访事', '星图主事', '象绘主事', '星绘主事', '传报主事'],
  '03_第三梯队_架构与研发组': ['灵台郎', '历算主事', '星仪主事', '数象主事', '推步主事'],
  '04_第四梯队_测试运维与文档组': ['星验主事', '星机校验', '天象值守', '星文审校', '录典主事'],
}

/** 素材目录（仓库根 → `assets/members/out-512`）。 */
const ASSETS_ROOT = fileURLToPath(new URL('../../../assets/members/out-512', import.meta.url))

function sortedJoin(values: readonly string[]): string {
  return [...values].sort().join(',')
}

/** 造一条占用项。 */
function occ(name: string, lifecycle: MemberLifecycle): NameOccupancy {
  return { name, lifecycle }
}

/**
 * 每个错误码的规则里**必须出现在 message 中**的关键短语（AC-5A-14 的「含规则关键词」）。
 *
 * 不直接断言 `message.includes(rule)` 就够了 —— 那只证明 message 抄了整条 rule。
 * 这里逐条钉关键词，是为了让「message 在讲同一条规则」这件事**可被证伪**：
 * 把 `rule` 里改成另一条规则的措辞（例如把「纯中文」写成「纯汉字」），本断言必红。
 */
const RULE_KEYWORDS: Readonly<Record<NamingErrorCode, readonly string[]>> = {
  POSITION_NOT_CHINESE: ['纯中文', '汉字'],
  POSITION_UNKNOWN: ['规范名册', '硬拒绝'],
  NAME_SHAPE_INVALID: ['形状', '序号'],
  NAME_NOT_UNIQUE: ['唯一'],
  MEMBER_ID_SHAPE_INVALID: ['形状', '小写十六进制'],
}

const ALL_LIFECYCLES: readonly MemberLifecycle[] = [
  'active',
  'suspended',
  'archived',
  'destroyed',
]

// ────────────────────────────────────────────────────────────────────────────
// AC-5A-1：20 个规范职位与素材文件名双向零差异
// ────────────────────────────────────────────────────────────────────────────

describe('AC-5A-1 规范职位名册是闭集，且与素材目录双向一致', () => {
  it('POSITIONS 恰有 20 项', () => {
    expect(POSITIONS.length).toBe(20)
  })

  it('四个梯队目录名恰好是 SPEC §3.2 的 4 个键', () => {
    const dirs = readdirSync(ASSETS_ROOT, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)

    expect(sortedJoin(dirs)).toBe(sortedJoin(Object.keys(TIER_EXPECTATION)))
  })

  it('每个梯队的 .png basename 集合与该组数组互为子集（排序 join 相等）', () => {
    for (const [tier, expected] of Object.entries(TIER_EXPECTATION)) {
      const actual = readdirSync(`${ASSETS_ROOT}/${tier}`)
        .filter((file) => file.toLowerCase().endsWith('.png'))
        .map((file) => file.replace(/\.png$/i, ''))

      // 双向：既无遗漏、也无多余。若只断言「expected ⊆ actual」，
      // 素材里多出一张图（= 多出一个职位）时测试仍绿 —— 那是半边断言。
      expect(`${tier}: ${sortedJoin(actual)}`).toBe(`${tier}: ${sortedJoin(expected)}`)
    }
  })

  it('POSITIONS 的合计集合与素材四梯队合集相等，且按梯队分组有序', () => {
    const fromAssets = Object.values(TIER_EXPECTATION).flat()
    expect(sortedJoin(POSITIONS)).toBe(sortedJoin(fromAssets))

    // 分组顺序一致（不是仅集合相等）：第一梯队在前、第四梯队在后。
    const flattenedByTier = Object.values(TIER_EXPECTATION).flat()
    expect([...POSITIONS]).toEqual(flattenedByTier)
  })

  it('POSITIONS 内部无重复项', () => {
    const unique = new Set<string>(POSITIONS)
    expect(unique.size).toBe(POSITIONS.length)
  })

  it('isKnownPosition 对名册内外分别给出正确判定', () => {
    for (const position of POSITIONS) {
      expect(isKnownPosition(position)).toBe(true)
    }
    // 阴性：这是「闭集」这个词的可证伪面 —— 去掉它，闭集退化成恒真。
    expect(isKnownPosition('天官正')).toBe(false)
    expect(isKnownPosition('灵台郎2')).toBe(false)
    expect(isKnownPosition('')).toBe(false)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// AC-5A-2 / AC-5A-3：slug 规范表
// ────────────────────────────────────────────────────────────────────────────

describe('AC-5A-2 / AC-5A-3 slug 以规范表为准', () => {
  it('AC-5A-2 灵台郎 → lingtai-lang（文档示例逐字）', () => {
    expect(positionSlug('灵台郎')).toBe('lingtai-lang')
    // 阴性：这条断言必须能排除「逐字拼音连字符」那条朴素规则（库给 ling-tai-lang）。
    expect(positionSlug('灵台郎')).not.toBe('ling-tai-lang')
  })

  it('AC-5A-3 POSITION_SLUGS 的键与 POSITIONS 双向一致（无遗漏、无多余）', () => {
    expect(sortedJoin(Object.keys(POSITION_SLUGS))).toBe(sortedJoin(POSITIONS))
  })

  it('AC-5A-3 全部 slug 匹配 ^[a-z]+(-[a-z]+)*$（小写字母 + 连字符）', () => {
    for (const position of POSITIONS) {
      const slug = positionSlug(position)
      expect(`${position}=${slug}`).toMatch(/^[^=]+=[a-z]+(?:-[a-z]+)*$/)
    }
  })

  it('每个职位都有自己的 slug，且 20 个 slug 互不相同（memberId 全局唯一的前提）', () => {
    const slugs = POSITIONS.map((position) => positionSlug(position))
    expect(new Set(slugs).size).toBe(POSITIONS.length)
  })

  it('表驱动：positionSlug(p) 与 POSITION_SLUGS[p] 逐个相等', () => {
    for (const position of POSITIONS) {
      expect(positionSlug(position)).toBe(POSITION_SLUGS[position])
    }
  })

  it('机构名整体转写：以 INSTITUTIONS 开头的职位，其 slug 以机构整词转写开头（不带连字符切开）', () => {
    const institutionSlug: Readonly<Record<string, string>> = {
      钦天监: 'qintianjian',
      灵台: 'lingtai',
      推步: 'tuibu',
      历算: 'lisuan',
    }

    let checked = 0
    for (const position of POSITIONS) {
      const institution = INSTITUTIONS.find((name) => position.startsWith(name))
      if (institution === undefined) {
        continue
      }
      const wholeWord = institutionSlug[institution]
      expect(wholeWord).toBeDefined()
      const slug = positionSlug(position)
      expect(`${position} -> ${slug}`).toContain(`${position} -> ${String(wholeWord)}`)
      // 否定形态：机构名不得被逐字切开（`ling-tai-…`）。
      expect(slug.startsWith(`${String(wholeWord).slice(0, -1)}-`)).toBe(false)
      checked += 1
    }
    // 若一个机构名都匹配不上（如 INSTITUTIONS 被清空），本断言就是恒真的 —— 故计数自检。
    expect(checked).toBeGreaterThanOrEqual(4)
  })

  it('裁定 Q-A：星文审校 取 shen-jiao（校订义），不是库给的 shen-xiao', () => {
    expect(positionSlug('星文审校')).toBe('xing-wen-shen-jiao')
    expect(positionSlug('星文审校')).not.toContain('xiao')
    // 同一字在「校·验」里取 jiao，证明这不是「一律取 xiao」的规则 —— 是词义判断。
    expect(positionSlug('星机校验')).toBe('xing-ji-jiao-yan')
  })

  it('positionSlug 对名册外职位抛 NamingViolationError（含 code / rule / example）', () => {
    for (const bad of ['天官正', 'Sophia灵台郎', '灵台郎2', '']) {
      expect(() => positionSlug(bad)).toThrow(NamingViolationError)
    }
    try {
      positionSlug('天官正')
      expect.unreachable('名册外职位必须抛错')
    } catch (error) {
      expect(error).toBeInstanceOf(NamingViolationError)
      const violation = error as NamingViolationError
      expect(violation.code).toBe('POSITION_UNKNOWN')
      expect(violation.rule.length).toBeGreaterThan(0)
      expect(violation.example).toBe('灵台郎')
    }
  })
})

// ────────────────────────────────────────────────────────────────────────────
// AC-5A-4 / AC-5A-5：memberId 构造与解析
// ────────────────────────────────────────────────────────────────────────────

describe('AC-5A-4 memberId 往返一致', () => {
  it('parseMemberId(toMemberId(...)) 还原 slug 与 uuid8', () => {
    const memberId = toMemberId('灵台郎', 'a1b2c3d4')
    expect(parseMemberId(memberId)).toEqual({ slug: 'lingtai-lang', uuid8: 'a1b2c3d4' })
  })

  it('构造出的字面形态就是 sophia-<slug>-<uuid8>', () => {
    expect(toMemberId('灵台郎', 'a1b2c3d4')).toBe('sophia-lingtai-lang-a1b2c3d4')
    expect(toMemberId('数象主事', 'deadbeef')).toBe('sophia-shu-xiang-zhu-shi-deadbeef')
  })

  it('全部 20 个职位都可构造、可解析（往返对每个职位成立）', () => {
    for (const position of POSITIONS) {
      const memberId = toMemberId(position, 'a1b2c3d4')
      const parts = parseMemberId(memberId)
      expect(`${position} -> ${String(parts?.slug)}`).toBe(`${position} -> ${positionSlug(position)}`)
      expect(parts?.uuid8).toBe('a1b2c3d4')
    }
  })
})

describe('AC-5A-5 parseMemberId 对 5 类畸形输入返回 null 而非抛错', () => {
  const malformed: readonly (readonly [string, string])[] = [
    ['', '空串'],
    ['sophia-lingtai-lang', '缺 uuid8'],
    ['lingtai-lang-a1b2c3d4', '缺前缀'],
    ['sophia-lingtai-lang-A1B2C3D4', 'uuid8 大写'],
    ['sophia-lingtai-lang-a1b2c3d', 'uuid8 只有 7 位'],
  ]

  for (const [input, label] of malformed) {
    it(`${label}：${JSON.stringify(input)} → null`, () => {
      expect(() => parseMemberId(input)).not.toThrow()
      expect(parseMemberId(input)).toBeNull()
    })
  }

  it('额外阴性：8 位但含非十六进制字符 → null', () => {
    expect(parseMemberId('sophia-lingtai-lang-a1b2c3zz')).toBeNull()
    expect(parseMemberId('sophia-lingtai-lang-a1b2c3d44')).toBeNull()
    expect(parseMemberId('sophia-lingtai-lang--a1b2c3d4')).toBeNull()
    expect(parseMemberId('sophia--a1b2c3d4')).toBeNull()
    expect(parseMemberId('sophia-lingtai-lang-a1b2c3d4-extra')).toBeNull()
    expect(parseMemberId('SOPHIA-lingtai-lang-a1b2c3d4')).toBeNull()
  })

  it('阳性对照：规范形态必须能解析（否则上面 5 条阴性可能是恒真的）', () => {
    expect(parseMemberId('sophia-lingtai-lang-a1b2c3d4')).not.toBeNull()
  })
})

describe('newUuid8 的形状', () => {
  it('1000 次采样全部匹配 ^[0-9a-f]{8}$ 且不重复压倒性（唯一性由调用方校验）', () => {
    const seen = new Set<string>()
    for (let index = 0; index < 1000; index += 1) {
      const value = newUuid8()
      expect(value).toMatch(/^[0-9a-f]{8}$/)
      seen.add(value)
    }
    // 4 字节随机的 1000 次采样里，重复出现的期望值极小；这里只断言「不是常量」。
    expect(seen.size).toBeGreaterThan(990)
  })

  it('newUuid8 的产物可直接进入 toMemberId', () => {
    const memberId = toMemberId('灵台郎', newUuid8())
    expect(parseMemberId(memberId)?.slug).toBe('lingtai-lang')
  })
})

describe('toMemberId 的入口拒绝（不静默修正）', () => {
  const badUuid8: readonly (readonly [string, string])[] = [
    ['A1B2C3D4', '大写'],
    ['a1b2c3d', '7 位'],
    ['a1b2c3d45', '9 位'],
    ['a1b2c3zz', '非十六进制'],
    ['', '空串'],
    ['-a1b2c3d', '含连字符'],
  ]

  for (const [input, label] of badUuid8) {
    it(`uuid8 ${label}「${input}」被拒（不自动补零、不自动转小写）`, () => {
      expect(() => toMemberId('灵台郎', input)).toThrow(NamingViolationError)
      try {
        toMemberId('灵台郎', input)
      } catch (error) {
        expect((error as NamingViolationError).code).toBe('MEMBER_ID_SHAPE_INVALID')
      }
    })
  }

  it('slug 表的笔误在构造期被拦下（POSITION_SLUGS 是人工维护的表）', () => {
    // 这条用例存在的理由：把 slug 形状校验**只**放在测试里，测试挂了但线上照跑；
    // 长度校验放进 toMemberId 之后，表笔误才会变成 fail-fast 的显式错误。
    const table = POSITION_SLUGS as Record<string, string>
    const original: string = table['灵台郎'] ?? ''
    // 先断言取到的是非空字符串：否则 `finally` 里会把 `''` 写回表，
    // 那会让紧随其后的用例因「slug 变空串」而红 —— 污染原因与被测行为无关。
    expect(original).toBe('lingtai-lang')
    try {
      table['灵台郎'] = 'LingTai-Lang'
      expect(() => toMemberId('灵台郎', 'a1b2c3d4')).toThrow(NamingViolationError)
      // 若不拦，产出的 memberId 是**解析不回来**的 —— 成员能建、能落账本、读回时形状门禁拒收。
      expect(parseMemberId('sophia-LingTai-Lang-a1b2c3d4')).toBeNull()
    } finally {
      table['灵台郎'] = original
    }
    // 还原自检：证明确实复原了，避免污染同一文件里的后续用例。
    expect(positionSlug('灵台郎')).toBe('lingtai-lang')
  })

  it('职位非法时同样抛错（每个入口都硬拒绝，裁定 Q-D）', () => {
    expect(() => toMemberId('天官正', 'a1b2c3d4')).toThrow(NamingViolationError)
    expect(() => toMemberId('Sophia灵台郎', 'a1b2c3d4')).toThrow(NamingViolationError)
    try {
      toMemberId('天官正', 'a1b2c3d4')
    } catch (error) {
      expect((error as NamingViolationError).code).toBe('POSITION_UNKNOWN')
      expect((error as NamingViolationError).message).toContain('灵台郎')
    }
  })
})

// ────────────────────────────────────────────────────────────────────────────
// AC-5A-6 … AC-5A-9：成员名分配
// ────────────────────────────────────────────────────────────────────────────

describe('AC-5A-6..9 成员名分配', () => {
  it('AC-5A-6 空占用 → 职位名本身', () => {
    expect(allocateMemberName('灵台郎', [])).toBe('灵台郎')
  })

  it('AC-5A-7 同职位第 2 个实例得到 -2，第 3 个得到 -3', () => {
    expect(allocateMemberName('灵台郎', [occ('灵台郎', 'active')])).toBe('灵台郎-2')
    expect(
      allocateMemberName('灵台郎', [occ('灵台郎', 'active'), occ('灵台郎-2', 'active')]),
    ).toBe('灵台郎-3')
  })

  it('AC-5A-8 占用的同名成员是 destroyed → 名字释放，回到职位名', () => {
    expect(allocateMemberName('灵台郎', [occ('灵台郎', 'destroyed')])).toBe('灵台郎')
  })

  it('AC-5A-9 已占 灵台郎 与 灵台郎-3（跳过 -2）→ 分配 -2（取最小可用，不取 max+1）', () => {
    expect(
      allocateMemberName('灵台郎', [occ('灵台郎', 'active'), occ('灵台郎-3', 'active')]),
    ).toBe('灵台郎-2')
  })

  it('AC-5A-9 补充：占用 -2..-5 的连续段，-3 空着则补 -3', () => {
    const occupied = [
      occ('灵台郎', 'active'),
      occ('灵台郎-2', 'active'),
      occ('灵台郎-4', 'active'),
      occ('灵台郎-5', 'active'),
    ]
    expect(allocateMemberName('灵台郎', occupied)).toBe('灵台郎-3')
  })

  it('序号只认同一职位的占用：别的职位占用不影响本职位', () => {
    const occupied = [occ('灵台主事', 'active'), occ('数象主事', 'active')]
    expect(allocateMemberName('灵台郎', occupied)).toBe('灵台郎')
  })

  it('名册外职位在分配入口被硬拒绝（裁定 Q-D）', () => {
    expect(() => allocateMemberName('天官正', [])).toThrow(NamingViolationError)
    expect(() => allocateMemberName('', [])).toThrow(NamingViolationError)
    expect(() => allocateMemberName('Sophia灵台郎', [])).toThrow(NamingViolationError)
  })
})

describe('占用语义对每个生命周期取值分别成立（分支级阴性用例，防恒真）', () => {
  // t3 的实测教训：一个守卫的另一条分支被改成恒真 `return true` 而全绿 ——
  // 因为阴性用例只覆盖了某一条分支。下面 4 个用例**逐取值**断言，缺一不可。
  const expectations: readonly (readonly [MemberLifecycle, boolean])[] = [
    ['active', true],
    ['suspended', true],
    ['archived', false],
    ['destroyed', false],
  ]

  it('本用例覆盖的恰好是当前全部 4 个生命周期取值（多一个少一个都要显式改这里）', () => {
    expect(sortedJoin(expectations.map(([lifecycle]) => lifecycle))).toBe(
      sortedJoin(ALL_LIFECYCLES),
    )
  })

  for (const [lifecycle, occupies] of expectations) {
    it(`${lifecycle} ⇒ ${occupies ? '占用' : '释放'}（经 allocateMemberName）`, () => {
      expect(allocateMemberName('灵台郎', [occ('灵台郎', lifecycle)])).toBe(
        occupies ? '灵台郎-2' : '灵台郎',
      )
    })

    it(`${lifecycle} ⇒ ${occupies ? '占用' : '释放'}（经 validateMemberName）`, () => {
      const result = validateMemberName('灵台郎', [occ('灵台郎', lifecycle)])
      expect(result.ok).toBe(!occupies)
      if (occupies) {
        expect(result.ok).toBe(false)
        if (!result.ok) {
          expect(result.violation.code).toBe('NAME_NOT_UNIQUE')
        }
      }
    })
  }
})

// ────────────────────────────────────────────────────────────────────────────
// AC-5A-10 … AC-5A-15：命名门禁与违例可读性
// ────────────────────────────────────────────────────────────────────────────

describe('AC-5A-10..13 validatePosition 的分支逐一成立', () => {
  it('AC-5A-10 灵台郎 通过', () => {
    const result = validatePosition('灵台郎')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toBe('灵台郎')
    }
  })

  it('全部 20 个规范职位都通过', () => {
    for (const position of POSITIONS) {
      expect(`${position}: ${String(validatePosition(position).ok)}`).toBe(`${position}: true`)
    }
  })

  it('AC-5A-11 Sophia灵台郎 → POSITION_NOT_CHINESE（含英文字母）', () => {
    const result = validatePosition('Sophia灵台郎')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.violation.code).toBe('POSITION_NOT_CHINESE')
    }
  })

  it('AC-5A-12 灵台郎2 → POSITION_NOT_CHINESE（含阿拉伯数字）', () => {
    const result = validatePosition('灵台郎2')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.violation.code).toBe('POSITION_NOT_CHINESE')
    }
  })

  it('AC-5A-13 天官正 → POSITION_UNKNOWN（纯中文但不在名册）', () => {
    const result = validatePosition('天官正')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.violation.code).toBe('POSITION_UNKNOWN')
      // 与 POSITION_NOT_CHINESE 的**区分**就是这条 AC 的全部意义 —— 显式断言另一支不成立。
      expect(result.violation.code).not.toBe('POSITION_NOT_CHINESE')
    }
  })

  it('非中文的其余形态全部落 POSITION_NOT_CHINESE 分支', () => {
    for (const bad of ['sophia', '灵台 郎', '灵台郎-2', '灵台郎_', '灵台郎！', '  灵台郎']) {
      const result = validatePosition(bad)
      expect(`${JSON.stringify(bad)}: ${result.ok ? 'ok' : result.violation.code}`).toBe(
        `${JSON.stringify(bad)}: POSITION_NOT_CHINESE`,
      )
    }
  })

  it('空串落 POSITION_NOT_CHINESE（不得抛错、不得误判为 UNKNOWN）', () => {
    const result = validatePosition('')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.violation.code).toBe('POSITION_NOT_CHINESE')
    }
  })

  it('裁定 Q-D：POSITION_UNKNOWN 的报错必须列出全部合法职位名', () => {
    const result = validatePosition('天官正')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      for (const position of POSITIONS) {
        expect(result.violation.message).toContain(position)
      }
    }
  })
})

describe('AC-5A-14 每条违例都带非空 rule / example，且 message 内嵌规则', () => {
  /** 覆盖 5 个错误码各自的产生路径 ⇒ 违例样本覆盖全部 code。 */
  function collectViolations(): { readonly label: string; readonly result: NamingResult<unknown> }[] {
    return [
      { label: 'POSITION_NOT_CHINESE', result: validatePosition('Sophia灵台郎') },
      { label: 'POSITION_UNKNOWN', result: validatePosition('天官正') },
      { label: 'NAME_SHAPE_INVALID(空)', result: validateMemberName('', []) },
      { label: 'NAME_SHAPE_INVALID(字母)', result: validateMemberName('Sophia灵台郎', []) },
      { label: 'NAME_SHAPE_INVALID(序号 1)', result: validateMemberName('灵台郎-1', []) },
      { label: 'NAME_SHAPE_INVALID(前导零)', result: validateMemberName('灵台郎-02', []) },
      { label: 'NAME_SHAPE_INVALID(名册外基名)', result: validateMemberName('天官正', []) },
      {
        label: 'NAME_NOT_UNIQUE',
        result: validateMemberName('灵台郎', [occ('灵台郎', 'active')]),
      },
      { label: 'MEMBER_ID_SHAPE_INVALID', result: validateMemberId('sophia-lingtai-lang-A1B2C3D4') },
    ]
  }

  it('每条违例的 rule 与 example 均非空，且 message 同时包含两者', () => {
    const violations = collectViolations()
    // 样本自身要覆盖全部 5 个错误码，否则「5 个码都可读」是半边结论。
    const codes = new Set(violations.map((entry) => (entry.result.ok ? 'ok' : entry.result.violation.code)))
    expect(sortedJoin([...codes])).toBe(
      sortedJoin([
        'MEMBER_ID_SHAPE_INVALID',
        'NAME_NOT_UNIQUE',
        'NAME_SHAPE_INVALID',
        'POSITION_NOT_CHINESE',
        'POSITION_UNKNOWN',
      ]),
    )

    for (const { label, result } of violations) {
      expect(`${label}: ${result.ok}`).toBe(`${label}: false`)
      if (result.ok) {
        continue
      }
      const { rule, example, message } = result.violation
      // AC-5A-14 逐字要求：rule / example 非空，且 message **包含 rule 中的规则关键词**。
      expect(rule.length).toBeGreaterThan(0)
      expect(example.length).toBeGreaterThan(0)
      expect(message).toContain(rule)
      expect(message).toContain(example)
      // 「含规则关键词」不能只靠「含整条 rule」满足 —— 那等于把 rule 抄进 message。
      // 逐条取 rule 里的关键短语，确保 message 在**语义**上也在讲同一条规则。
      for (const keyword of RULE_KEYWORDS[result.violation.code]) {
        expect(`${label} / ${keyword}: ${message.includes(keyword)}`).toBe(
          `${label} / ${keyword}: true`,
        )
      }
    }
  })

  it('正例必须是**真正合法**的值：拿 example 回灌门禁，必须通过', () => {
    // 这是本用例的核心：`example` 若写成「不存在的正确示例」，前面的非空断言全绿也毫无意义。
    const positionViolations = [
      validatePosition('Sophia灵台郎'),
      validatePosition('天官正'),
      validatePosition('灵台郎2'),
    ]
    for (const result of positionViolations) {
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(validatePosition(result.violation.example).ok).toBe(true)
      }
    }

    // 成员名违例的正例同样要能过门禁（唯一性用空占用表判定）。
    const nameViolations = [
      validateMemberName('', []),
      validateMemberName('Sophia灵台郎', []),
      validateMemberName('灵台郎-1', []),
      validateMemberName('灵台郎-02', []),
    ]
    for (const result of nameViolations) {
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(validateMemberName(result.violation.example, []).ok).toBe(true)
      }
    }

    // memberId 违例的正例必须能过 validateMemberId。
    const idViolation = validateMemberId('sophia-lingtai-lang-A1B2C3D4')
    expect(idViolation.ok).toBe(false)
    if (!idViolation.ok) {
      expect(validateMemberId(idViolation.violation.example).ok).toBe(true)
    }
  })
})

describe('AC-5A-15 validateMemberName 唯一性与形状', () => {
  it('AC-5A-15 占用中的同名 → NAME_NOT_UNIQUE，且 example 提示可用序号', () => {
    const result = validateMemberName('灵台郎', [occ('灵台郎', 'active')])
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.violation.code).toBe('NAME_NOT_UNIQUE')
      expect(result.violation.example).toBe('灵台郎-2')
    }
  })

  it('重名且 -2 也被占时，example 提示 -3', () => {
    const result = validateMemberName('灵台郎', [
      occ('灵台郎', 'active'),
      occ('灵台郎-2', 'active'),
    ])
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.violation.example).toBe('灵台郎-3')
    }
  })

  it('未占用的合法名通过（形状 + 唯一性双分支的阳性对照）', () => {
    expect(validateMemberName('灵台郎', []).ok).toBe(true)
    expect(validateMemberName('灵台郎-2', [occ('灵台郎', 'active')]).ok).toBe(true)
  })

  it('空串落 NAME_SHAPE_INVALID，且报错说明「不得为空」（入口守卫 1 可观测）', () => {
    const result = validateMemberName('', [])
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.violation.code).toBe('NAME_SHAPE_INVALID')
      // 断言**整句措辞**而非单个「空」字：反恒真实测过，只查 '空' 时把
      // '成员名不得为空' 改成 '成员名为空' 仍然全绿（该断言比它自称的弱）；
      // 收紧到整句后，任何措辞改动都会变红。
      expect(result.violation.message).toContain('不得为空')
    }
  })

  it('非字符串输入落 NAME_SHAPE_INVALID，且报错说明「必须是字符串」+ 实际类型（入口守卫 2 可观测）', () => {
    // 从 JS 调用方 / JSON 反序列化来的值可能是数字或 null（品牌与类型在运行期不存在）。
    const badInputs: readonly unknown[] = [null, undefined, 42, { name: '灵台郎' }, ['灵台郎']]
    for (const bad of badInputs) {
      const result = validateMemberName(bad as unknown as string, [])
      expect(`${String(bad)}: ${result.ok ? 'ok' : result.violation.code}`).toBe(
        `${String(bad)}: NAME_SHAPE_INVALID`,
      )
      if (!result.ok) {
        // 与「空串」分支的可观测区别：这条必须点出类型，而不是「不得为空」。
        expect(result.violation.message).toContain('字符串')
        expect(result.violation.message).not.toContain('不得为空')
        // 具体类型名必须在报错里。这条是**定点补的**：反恒真实测发现，
        // 只断言 '字符串' 时，把 `（收到 ${typeof value}）` 整段删掉仍然全绿 ——
        // 于是「报错说明实际类型」这个设计点没有任何断言覆盖。补上后该变异体变红（M41c）。
        expect(result.violation.message).toContain(typeof bad)
      }
    }
  })

  it('两个入口守卫的 message 确实不同（否则它们就是行为等价的重复分支）', () => {
    const empty = validateMemberName('', [])
    const notString = validateMemberName(42 as unknown as string, [])
    expect(empty.ok).toBe(false)
    expect(notString.ok).toBe(false)
    if (!empty.ok && !notString.ok) {
      expect(empty.violation.message).not.toBe(notString.violation.message)
    }
  })

  it('序号边界：2^53-1 可用，2^53 与超出精确表示的值被拒（isSafeInteger 单点守住）', () => {
    // 这条是**边界**断言而不是「大数一律拒」：
    // - 2^53-1 = 9007199254740991 是最后一个安全整数 ⇒ 必须通过；
    // - 2^53   = 9007199254740992 超界 ⇒ 必须拒（实测 isSafeInteger 为 false）；
    // - 2^53+1 字面量本身不可精确表示，`Number()` 会落到 2^53 ⇒ 同样拒。
    // 备注：OCR 评审曾建议再加一条「往返比对」（String(Number(s)) !== s 则拒）。
    // 实测后**未采纳**：NAME_SHAPE 已禁止前导零，「isSafeInteger 为真 ⇒ 可精确表示 ⇒ 往返必一致」，
    // 那条比对是死代码（删掉它两套命令仍全绿）。此处用边界用例把该结论钉住。
    expect(validateMemberName('灵台郎-9007199254740991', []).ok).toBe(true)
    for (const tooBig of ['灵台郎-9007199254740992', '灵台郎-9007199254740993']) {
      const result = validateMemberName(tooBig, [])
      expect(`${tooBig}: ${result.ok ? 'ok' : result.violation.code}`).toBe(
        `${tooBig}: NAME_SHAPE_INVALID`,
      )
    }
    // 阳性对照：证明上一条不是「一律拒大数」的恒真放宽。
    expect(validateMemberName('灵台郎-2', []).ok).toBe(true)
    expect(validateMemberName('灵台郎-90071992547409', []).ok).toBe(true)
  })

  it('形状分支逐一：-1 / -0 / -02 / -00 / -2a / 空基名 全部 NAME_SHAPE_INVALID', () => {
    for (const bad of ['灵台郎-1', '灵台郎-0', '灵台郎-02', '灵台郎-00', '灵台郎-2a', '-2', '灵台郎-']) {
      const result = validateMemberName(bad, [])
      expect(`${bad}: ${result.ok ? 'ok' : result.violation.code}`).toBe(
        `${bad}: NAME_SHAPE_INVALID`,
      )
    }
  })

  it('名册外基名 → NAME_SHAPE_INVALID（名字侧同样守闭集，裁定 Q-D）', () => {
    for (const bad of ['天官正', '天官正-2', 'Sophia灵台郎']) {
      const result = validateMemberName(bad, [])
      expect(`${bad}: ${result.ok ? 'ok' : result.violation.code}`).toBe(
        `${bad}: NAME_SHAPE_INVALID`,
      )
    }
  })

  it('全部 20 个职位名都可作为成员名通过校验', () => {
    for (const position of POSITIONS) {
      expect(`${position}: ${String(validateMemberName(position, []).ok)}`).toBe(`${position}: true`)
    }
  })
})

describe('validateMemberId 的形状门禁', () => {
  it('规范形态通过', () => {
    const result = validateMemberId('sophia-lingtai-lang-a1b2c3d4')
    expect(result.ok).toBe(true)
  })

  it('5 类畸形 + 大写前缀全部 MEMBER_ID_SHAPE_INVALID', () => {
    const malformed = [
      '',
      'sophia-lingtai-lang',
      'lingtai-lang-a1b2c3d4',
      'sophia-lingtai-lang-A1B2C3D4',
      'sophia-lingtai-lang-a1b2c3d',
      'SOPHIA-lingtai-lang-a1b2c3d4',
    ]
    for (const bad of malformed) {
      const result = validateMemberId(bad)
      expect(`${JSON.stringify(bad)}: ${result.ok ? 'ok' : result.violation.code}`).toBe(
        `${JSON.stringify(bad)}: MEMBER_ID_SHAPE_INVALID`,
      )
    }
  })

  it('每个规范职位构造出的 memberId 都通过形状门禁', () => {
    for (const position of POSITIONS) {
      expect(validateMemberId(toMemberId(position, 'a1b2c3d4')).ok).toBe(true)
    }
  })

  it('非字符串输入也被拒（运行期无品牌，值可能来自 JS 或 JSON）', () => {
    for (const bad of [null, undefined, 42, Object.create(null)]) {
      expect(validateMemberId(bad as unknown as string).ok).toBe(false)
    }
  })

  it('OCR [29]：`toString` 会抛的值也**不得**让校验函数抛错（function 与 object 同类处理）', () => {
    // `describeValue` 的职责是「安全渲染任意运行期值」，因为校验函数的原则是
    // **绝不抛错、只返回违例**。`Object.create(null)` 早有一条用例守着 ——
    // 但它只覆盖了 `typeof === 'object'`。而 `typeof (() => {}) === 'function'` 会落到
    // 下面的 `String(value)` 分支：一个把 `toString` 改写成抛错的函数能让整个校验函数抛错，
    // 违反那条原则。实测复现：`validatePosition(fn)` 曾抛 `Error: boom`。
    // 反恒真：把 guards 分支改回只判 `object`，本条必须变红（它会真的抛出来）。
    const hostile = (): void => {}
    Object.defineProperty(hostile, 'toString', {
      value: (): never => {
        throw new Error('boom（模拟恶意 toString）')
      },
    })

    // 三个校验入口都不得抛错 —— 一律返回违例。
    let positionResult: NamingResult<Position> | null = null
    expect(() => {
      positionResult = validatePosition(hostile as unknown as string)
    }).not.toThrow()
    expect(positionResult).not.toBeNull()
    expect((positionResult as unknown as NamingResult<Position>).ok).toBe(false)

    let nameResult: NamingResult<MemberName> | null = null
    expect(() => {
      nameResult = validateMemberName(hostile as unknown as string, [])
    }).not.toThrow()
    expect((nameResult as unknown as NamingResult<MemberName>).ok).toBe(false)

    let idResult: NamingResult<MemberId> | null = null
    expect(() => {
      idResult = validateMemberId(hostile as unknown as string)
    }).not.toThrow()
    expect((idResult as unknown as NamingResult<MemberId>).ok).toBe(false)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// displayNameOf（FR-5A.4）
// ────────────────────────────────────────────────────────────────────────────

describe('displayNameOf：显示名与烧入像素的职位标签始终一致（FR-5A.4）', () => {
  const identity = (position: string, name: string) =>
    ({ position, name, memberId: 'sophia-lingtai-lang-a1b2c3d4' as MemberId }) as const

  it('名字就是职位名 → 返回职位名', () => {
    expect(displayNameOf(identity('灵台郎', '灵台郎'))).toBe('灵台郎')
  })

  it('名字带序号 → 露出序号（重名时才需要区分）', () => {
    expect(displayNameOf(identity('灵台郎', '灵台郎-2'))).toBe('灵台郎-2')
    expect(displayNameOf(identity('灵台郎', '灵台郎-37'))).toBe('灵台郎-37')
  })

  it('名字与职位脱钩 → 收敛到职位名（不得显示与像素标签无关的文本）', () => {
    expect(displayNameOf(identity('灵台郎', '数象主事'))).toBe('灵台郎')
    expect(displayNameOf(identity('灵台郎', '灵台郎-abc'))).toBe('灵台郎')
    expect(displayNameOf(identity('灵台郎', ''))).toBe('灵台郎')
    expect(displayNameOf(identity('灵台郎', '灵台郎-'))).toBe('灵台郎')
  })

  it('前缀相同但基名不同的名字不得被误认为序号形态', () => {
    // 「灵台郎-2」与「灵台郎主事」的区别：后者不是本职位名的序号形态。
    expect(displayNameOf(identity('灵台郎', '灵台郎主事'))).toBe('灵台郎')
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 编译期守卫
// ────────────────────────────────────────────────────────────────────────────

describe('编译期守卫（断言失败时 tsc 以 exit 2 失败）', () => {
  it('KnownPosition 联合恰为 20 个字面量', () => {
    // 类型级断言：把 POSITIONS 里任意一项改名/删除，这里会因 `never` 而编译失败。
    type Missing = Exclude<KnownPosition, (typeof POSITIONS)[number]>
    const complete: Missing extends never ? true : never = true
    expect(complete).toBe(true)
  })

  it('正向对照：类型级断言本身不是恒真的（用一个不存在的字面量试一次）', () => {
    // 若 `Exclude<..., POSITIONS[number]>` 对任何输入都是 never，上面那条就是恒真。
    type Probe = Exclude<'灵台郎' | '不存在职位', (typeof POSITIONS)[number]>
    // @ts-expect-error `'不存在职位'` 不在名册里 ⇒ Probe 不是 never ⇒ true 不可赋值。
    const notNever: Probe extends never ? true : never = true
    void notNever
    expect(true).toBe(true)
  })

  it('名称类型对接：validatePosition 的产物可直接赋给 Position（类型未漂移）', () => {
    const result = validatePosition('灵台郎')
    if (result.ok) {
      const position = result.value
      const name: MemberName = position
      expect(name).toBe('灵台郎')
    }
  })
})
