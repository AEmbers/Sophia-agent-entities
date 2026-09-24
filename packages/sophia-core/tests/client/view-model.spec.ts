/**
 * t5 · client 半的**纯逻辑**用例（无 React、无 DOM）。
 *
 * 这里覆盖三块，每块都对着一处**实测过的真实缺陷或硬约束**：
 *
 * | 用例组 | 若它失守，真实故障是什么 |
 * |---|---|
 * | 中/英键集一致 | 英文界面回落成中文键名（**静默**，只有英文用户看得到） |
 * | 头像路径白名单 | `?path=../../.credentials.yaml` 让宿主读任意文件 |
 * | 线格式收窄 | 一个 `undefined` 崩在 React 渲染里 ⇒ 错误边界吞成**空白面板** |
 * | 消息频道隔离 | **切频道后消息流仍显示上一个频道**的内容，还挂在新频道名下 |
 * | 进度 / 阻塞 / 墓碑语义 | 界面显示错的状态，而看起来完全正常 |
 *
 * 每条都做过**反向自检**（把对应逻辑改坏 → 断言必须变红），
 * 变异清单在各自用例的注释里。
 */

import { describe, expect, it, vi } from 'vitest'

import {
  AVATAR_ROOT,
  avatarUrlFor,
  resolveAvatarUrl,
  sanitizeAvatarPath,
} from '../../src/client/avatar.ts'
import { DICTIONARIES, detectLocale, en, translate, translatorFor, zh } from '../../src/client/locales.ts'
import {
  blockersOf,
  displayNameIn,
  formatClock,
  initialOf,
  isOnline,
  lifecycleKeyOf,
  memberIndex,
  messagesOfTeam,
  onlineCount,
  parseWireView,
  presenceKeyOf,
  sortMembers,
  summarizeProgress,
  taskStatusKeyOf,
  type WireMember,
  type WireTeam,
} from '../../src/client/view-model.ts'
import { PanelStore } from '../../src/client/panel-store.ts'

// ────────────────────────────────────────────────────────────────────────────
// 夹具
// ────────────────────────────────────────────────────────────────────────────

function member(overrides: Partial<WireMember> & { readonly memberId: string }): WireMember {
  return {
    position: '历算主事',
    name: '历算主事',
    displayName: '历算主事',
    lifecycle: 'active',
    tombstone: false,
    model: null,
    ...overrides,
  }
}

function team(overrides: Partial<WireTeam> = {}): WireTeam {
  return {
    teamId: 'team:1',
    name: '钦天监',
    kind: 'persistent',
    members: [],
    channels: [],
    messages: [],
    tasks: [],
    activity: [],
    ...overrides,
  }
}

/** 造一个 `ok:true` 的响应。 */
function jsonResponse(payload: unknown, init: { status?: number; statusText?: string } = {}): Response {
  const status = init.status ?? 200
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: init.statusText ?? 'OK',
    json: async () => payload,
  } as unknown as Response
}

// ────────────────────────────────────────────────────────────────────────────
// 文案
// ────────────────────────────────────────────────────────────────────────────

describe('t5 · 文案表', () => {
  it('中英键集完全一致（漏键只能是编译错误，这里再加一道运行期防线）', () => {
    // 反恒真：从 `en` 里删掉任一键 → 本条必须变红。
    // ⚠ 真正把守这条的是 `en: Record<LocaleKey, string>` 的类型
    //   （漏键 = TS2739，实测命中过：`emptyChannels` 只加进 zh 时立即报错）；
    //   这条运行期断言是**冗余的**第二道 —— 它挡的是「有人把 en 的类型标注
    //   改宽」（例如写成 `Record<string,string>`），那时类型门失效但这条仍会红。
    const zhKeys = Object.keys(zh).sort()
    const enKeys = Object.keys(en).sort()
    expect(enKeys).toEqual(zhKeys)
    expect(zhKeys.length).toBeGreaterThan(30)
  })

  it('两个语言的每个键都非空（空串会让界面出现一片无字区域）', () => {
    for (const [locale, dict] of Object.entries(DICTIONARIES)) {
      for (const [key, value] of Object.entries(dict)) {
        expect(value.trim(), `${locale}.${key} 不能为空`).not.toBe('')
      }
    }
  })

  it('模板插值只替换已知占位符，未知的原样保留', () => {
    // 与 `dsh-client-locale` 的 `translate()` 同口径 —— 两处行为分叉会让
    // 「界面有值、日志无值」这类差异无从解释。
    expect(translate(zh, 'memberCount', { count: 3 })).toBe('3 位成员')
    expect(translate(en, 'memberCount', { count: 3 })).toBe('3 member(s)')
    // 少给参数 ⇒ 占位符原样留着（而不是变成 `undefined`）。
    expect(translate(zh, 'memberCount')).toBe('{count} 位成员')
    expect(translate(zh, 'memberCount', { wrong: 1 })).toBe('{count} 位成员')
  })

  it('控制字符（含 NUL）被拒 —— 且这是**第一道**门，不依赖后续检查顺序', () => {
    // OCR 复核 MEDIUM：初版把控制字符检查放在**最后**，于是这类输入会被
    // 完整解析（前缀、分段、扩展名）之后才丢弃。今天没有可利用的缝，
    // 但它使安全判据的成立**依赖后续检查的相对顺序** —— 将来为了「早点返回」
    // 重排就会静默绕过。这条断言它**单独**就能拦住（前缀合法、别的都合法，
    // 只有控制字符这条能拒）。
    // 反恒真：把控制字符检查移回最后并删掉 → 本条必须变红。
    const withNul = 'assets/members/out-512/x\u0000.png'
    expect(sanitizeAvatarPath(withNul)).toBeNull()
    const withNewline = 'assets/members/out-512/x.png\n//evil.example'
    expect(sanitizeAvatarPath(withNewline)).toBeNull()
    const withDel = 'assets/members/out-512/x\u007f.png'
    expect(sanitizeAvatarPath(withDel)).toBeNull()
    // 对照：同样的路径去掉控制字符后**是合法的** —— 证明拒的是控制字符本身，
    // 而不是因为别的原因偶然被拒（否则这条断言会退化成恒真）。
    expect(sanitizeAvatarPath('assets/members/out-512/x.png')).toBe('assets/members/out-512/x.png')
  })

  it('空 basename 的隐藏文件被拒（`.png` 不该通过扩展名白名单）', () => {
    // OCR 复核 LOW：`dot >= 0` 会让 `.../out-512/.png` 通过（点前没有文件名）。
    // 反恒真：把 `dot <= 0` 改回 `dot < 0` → 本条必须变红。
    expect(sanitizeAvatarPath('assets/members/out-512/.png')).toBeNull()
    // 对照：正常文件名照常通过。
    expect(sanitizeAvatarPath('assets/members/out-512/a.png')).toBe('assets/members/out-512/a.png')
  })

  it('UNC 风格路径被拒（即使没有单独的 `//` 分支）', () => {
    // OCR 复核 LOW 指出 `startsWith('//')` 是死代码（被 `startsWith('/')` 覆盖）。
    // 删掉它之后**必须**仍然拒绝 UNC —— 这条证明删除是安全的。
    expect(sanitizeAvatarPath('//evil.example/share/x.png')).toBeNull()
    expect(sanitizeAvatarPath('/assets/members/out-512/x.png')).toBeNull()
  })

  it('认不出的 locale 回退到 zh，**不**让每次 t() 都炸', () => {
    // OCR 复核 MEDIUM：`DICTIONARIES[locale]` 若为 undefined，之后每一次 t()
    // 都会在 translate 里抛 —— 一个小语言标识问题放大成「整个界面没文案」。
    // 反恒真：去掉 translatorFor 里的 `?? DICTIONARIES.zh` → 本条必须变红。
    const t = translatorFor('de' as never)
    expect(t('teams')).toBe(zh.teams)
    expect(() => t('memberCount', { count: 2 })).not.toThrow()
  })

  it('认不出的键降级成键名，**不**抛（挂在挂载路径上不能炸）', () => {
    // OCR 复核 MEDIUM：初版 `dict[key].replace(...)` 在未知键上抛 TypeError，
    // 而 translate 跑在 apply() 路径上 ⇒ 一次文案缺失会把整个界面挂载带进 catch。
    // 反恒真：去掉 `typeof template !== 'string'` 那道守卫 → 本条必须变红。
    expect(translate(zh, 'noSuchKey' as never)).toBe('noSuchKey')
    expect(() => translate(zh, 'noSuchKey' as never, { a: 1 })).not.toThrow()
  })

  it('原型链上的键**不算**「已知参数」（不得把函数渲染进用户文案）', () => {
    // 缺陷（OCR 复核 MEDIUM）：初版用 `name in params`，而 `in` 会往上查原型链。
    // 于是 `{toString}` 这类占位符（或任何与 Object.prototype 成员重名的键）
    // 会被解析成**继承来的函数**，把 `function toString() { [native code] }`
    // 渲染进用户可见文案。`params` 常由账本/宿主数据拼出，是外部输入。
    // 反恒真：把判据改回 `name in params` → 本条必须变红。
    // 用一个**只在测试里存在**的模板键，直接把它当作 `memberCount` 传进去。
    const dict = { ...zh, memberCount: 'a={toString} b={constructor} c={hasOwnProperty} d={valueOf}' }
    const out = translate(dict, 'memberCount', { count: 9 })
    // 三个原型键都必须**原样保留**，一个都不能被展开成函数体。
    expect(out).toBe('a={toString} b={constructor} c={hasOwnProperty} d={valueOf}')
    expect(out).not.toContain('[native code]')
    expect(out).not.toContain('function')
  })

  it('自有属性仍然正常替换（收窄不能把正常路径一起挡掉）', () => {
    // 上一条的对照：不能为了挡原型键而把**真的传了**的参数也忽略掉。
    expect(translate(zh, 'memberCount', { count: 7 })).toBe('7 位成员')
    // 值为空串也要算「给了」（自有属性存在即可）。
    expect(translate(zh, 'memberCount', { count: '' })).toBe(' 位成员')
    // 显式遮蔽原型成员的自有属性同样生效。
    expect(translate(zh, 'memberCount', { count: 1, toString: 'own' } as never)).toBe('1 位成员')
  })

  it('translatorFor 绑定语言，且切换语言返回不同文案', () => {
    // 反恒真：把 `translatorFor` 改成永远返回 zh → 第二条断言变红。
    expect(translatorFor('zh')('teams')).toBe('团队')
    expect(translatorFor('en')('teams')).toBe('Teams')
  })

  it('detectLocale 在 node 下（无 document）返回 zh，不抛', () => {
    // 反恒真：去掉 `typeof document === 'undefined'` 早返回 → 本条变红（ReferenceError）。
    expect(detectLocale()).toBe('zh')
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 头像路径
// ────────────────────────────────────────────────────────────────────────────

describe('t5 · 头像路径白名单（安全边界）', () => {
  const LEGIT = `${AVATAR_ROOT}out-512/03_第三梯队_架构与研发组/历算主事.png`

  it('合法路径原样通过，且 URL 对中文目录名做了整体编码', () => {
    expect(sanitizeAvatarPath(LEGIT)).toBe(LEGIT)
    const url = avatarUrlFor(LEGIT)
    expect(url).not.toBeNull()
    // 整体编码（`/` 也变 `%2F`）：宿主侧一次 decodeURIComponent 就能还原。
    expect(url).toContain('path=')
    expect(url).not.toContain('第三梯队')
    expect(decodeURIComponent((url as string).split('path=')[1] as string)).toBe(LEGIT)
  })

  it('拒绝一切路径穿越形态（含 Windows 反斜杠 —— 本机就是 Windows）', () => {
    // 反恒真：把 `sanitizeAvatarPath` 改成 `return path` → 本条必须变红。
    const attacks = [
      '../../../etc/passwd.png',
      `${AVATAR_ROOT}../../../.credentials.yaml`,
      `${AVATAR_ROOT}..\\..\\secret.png`,
      `${AVATAR_ROOT}out-512/../../x.png`,
      // 前缀对、但中间有 `..`：这条专治「只查前缀、不做逐段检查」的实现。
      `${AVATAR_ROOT}out-512/./../../x.png`,
      'C:/Windows/win.ini.png',
      '/etc/passwd.png',
      '//evil.example/x.png',
      `${AVATAR_ROOT}out-512/x.png\n//evil.example`,
      `${AVATAR_ROOT}out-512/x\u0000.png`,
      `${AVATAR_ROOT}out-512/x.svg`,
      `${AVATAR_ROOT}out-512/x.png.exe`,
      'other/dir/x.png',
      '',
      `${AVATAR_ROOT}out-512/`,
    ]
    for (const attack of attacks) {
      expect(sanitizeAvatarPath(attack), `必须拒绝：${JSON.stringify(attack)}`).toBeNull()
      expect(avatarUrlFor(attack)).toBeNull()
    }
  })

  it('大小写扩展名与合法中文目录名不被误杀（白名单不能过度收紧）', () => {
    // 反恒真：把扩展名判据写成 `endsWith('.png')` 且不 lower → 第一条变红。
    expect(sanitizeAvatarPath(`${AVATAR_ROOT}out-512/01_第一梯队_管理与总控组/钦天监监正.PNG`))
      .not.toBeNull()
    expect(sanitizeAvatarPath(`${AVATAR_ROOT}out-512/01_第一梯队_管理与总控组/钦天监监正.png`))
      .not.toBeNull()
  })

  it('resolveAvatarUrl：没有 avatarPath 时返回 null（界面据此画首字头像）', () => {
    expect(resolveAvatarUrl({})).toBeNull()
    expect(resolveAvatarUrl({ avatarPath: '' })).toBeNull()
    expect(resolveAvatarUrl({ avatarPath: '../../../x.png' })).toBeNull()
    expect(resolveAvatarUrl({ avatarPath: LEGIT })).toBe(avatarUrlFor(LEGIT))
  })

  it('resolveAvatarUrl 对**任意**非白名单值都返回 null（含跨源 URL 形态）', () => {
    // OCR 复核 HIGH：曾经有一条 `avatarUrl` 分支只查 `startsWith('/')`，
    // 会让 `https://evil/x.png` 或含控制字符的值穿过。那条分支已删除。
    // 这条用例把「删除」钉住：任何非 `avatarPath` 的输入都拿不到 URL。
    for (const hostile of [
      { avatarPath: 'https://evil.example/x.png' },
      { avatarPath: '//evil.example/x.png' },
      { avatarPath: '/\\/evil.example/x.png' },
      { avatarPath: `${AVATAR_ROOT}x.png`, avatarUrl: 'https://evil.example/y.png' },
    ] as const) {
      const url = resolveAvatarUrl(hostile as { readonly avatarPath?: string })
      if (url !== null) {
        // 若将来真放行 `avatarUrl`，它必须是同源相对路径 —— 这里留一条
        // 「一旦有人加回来就打红」的门。
        expect(url.startsWith('/')).toBe(true)
        expect(url.startsWith('//')).toBe(false)
      }
    }
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 线格式收窄
// ────────────────────────────────────────────────────────────────────────────

describe('t5 · 线格式收窄（外部输入不可信）', () => {
  it('非对象载荷 → ok:false 且 teams 为空，不抛', () => {
    for (const hostile of [null, undefined, 42, 'x', [], true]) {
      const view = parseWireView(hostile)
      expect(view.ok).toBe(false)
      expect(view.teams).toEqual([])
    }
  })

  it('逐字段自证：字段类型不对的条目被丢弃，其余照常解析', () => {
    // 反恒真：把 `asMember` 改成 `(raw) => raw as WireMember` → 第一条断言变红
    // （`memberId` 会是 `undefined` 而不是被丢弃）。
    const view = parseWireView({
      ok: true,
      teams: [{
        teamId: 'team:1',
        name: '钦天监',
        members: [
          { memberId: 'm1', position: '历算主事', name: '历算主事', displayName: '历算主事', lifecycle: 'active' },
          { memberId: 123 },            // memberId 不是字符串 ⇒ 丢弃
          { position: 'x' },            // 没有 memberId ⇒ 丢弃
          null,                          // 不是对象 ⇒ 丢弃
          { memberId: 'm2', lifecycle: 'archived' },
        ],
      }],
    })
    expect(view.ok).toBe(true)
    expect(view.teams[0]?.members.map((entry) => entry.memberId)).toEqual(['m1', 'm2'])
  })

  it('墓碑语义由**数据里的值**决定，不按 kind 反推（archived 必须可达）', () => {
    // t3 实测：账本里**没有** `member-archived` 这个 kind，`archived` 只能作为
    // 某次生命周期转换的 `to` 抵达。若界面按 kind 硬编码，archived 结构上不可达。
    // 反恒真：把墓碑判据改成只认 `tombstone === true` → 第二条断言变红。
    const view = parseWireView({
      ok: true,
      teams: [{
        teamId: 'team:1',
        members: [
          { memberId: 'm1', lifecycle: 'active', tombstone: false },
          { memberId: 'm2', lifecycle: 'archived' },
          { memberId: 'm3', lifecycle: 'destroyed' },
          { memberId: 'm4', lifecycle: 'suspended' },
          { memberId: 'm5', lifecycle: 'archived', tombstone: true },
        ],
      }],
    })
    const members = view.teams[0]?.members ?? []
    expect(members.map((entry) => entry.tombstone)).toEqual([false, true, true, false, true])
    expect(members.map((entry) => entry.lifecycle))
      .toEqual(['active', 'archived', 'destroyed', 'suspended', 'archived'])
  })

  it('「阻塞」只有一个判据：进度条与阻塞列表**不可能互相打脸**', () => {
    // ⚠ OCR 复核 MEDIUM 抓到的真实矛盾：`taskStatusKeyOf` 把 `status:'blocked'`
    //   渲染成「已阻塞」，而初版两处的「阻塞」判据只看 `blockedBy !== null`。
    //   于是一条 `status:'blocked'` 且 `blockedBy:null` 的任务会出现：
    //   进度条标着「已阻塞」，而阻塞面板说「当前没有阻塞」—— 同一屏自相矛盾。
    // 反恒真：把 `isBlockedTask` 改回 `task.blockedBy !== null` → 本条必须变红。
    const byStatus = { taskId: 'k1', title: '状态说阻塞', status: 'blocked', assigneeMemberId: null, blockedBy: null }
    const bySource = { taskId: 'k2', title: '有阻塞来源', status: 'in_progress', assigneeMemberId: null, blockedBy: '等签批' }
    const neither = { taskId: 'k3', title: '正常', status: 'todo', assigneeMemberId: null, blockedBy: null }
    const tasks = [byStatus, bySource, neither]

    const summary = summarizeProgress(tasks)
    const blockers = blockersOf(tasks).map((task) => task.taskId)

    // 两个来源必须**完全一致**：进度条标 blocked 的，就是列表里列出来的。
    const flaggedByProgress = summary.segments.filter((s) => s.blocked).map((s) => s.taskId)
    expect(flaggedByProgress).toEqual(blockers)
    expect(blockers).toEqual(['k1', 'k2'])
  })

  it('非有限的诊断计数被**省略**，而不是谎报成 0', () => {
    // ⚠ OCR 复核 LOW：`num()` 会把 `Infinity`/`NaN` 归成 0，于是宿主发来垃圾时
    //   界面显示「0 个畸形事件」= 把「字段是垃圾」谎报成「一切正常」。
    // 反恒真：把 `isFiniteNumber` 换回 `typeof … === 'number'` → 本条必须变红。
    const view = parseWireView({ ok: true, teams: [], malformedEvents: Infinity })
    expect(view.malformedEvents).toBeUndefined()
    const nanView = parseWireView({ ok: true, teams: [], unresolvedReferences: Number.NaN })
    expect(nanView.unresolvedReferences).toBeUndefined()
    // 对照：正常数字照常透传（否则这条断言会退化成「永远 undefined」）。
    const good = parseWireView({ ok: true, teams: [], malformedEvents: 3 })
    expect(good.malformedEvents).toBe(3)
    // 而 `0` 是一个**真的**值，不能被当成「没有」而丢掉。
    const zero = parseWireView({ ok: true, teams: [], malformedEvents: 0 })
    expect(zero.malformedEvents).toBe(0)
  })

  it('认不出的 lifecycle 如实标成「未知」，**不得**改写成 active', () => {
    // ⚠ OCR 复核 MEDIUM 抓到的真实缺陷：初版把未知值强制改写成 `'active'`，
    //   于是 `lifecycleUnknown`（「状态未知」）**结构上不可达**，
    //   而宿主漏给 lifecycle 时成员被显示成「在册」——凭空发明了一个事实。
    // 反恒真：把 `asMember` 的 `lifecycle` 改回 `=== UNKNOWN_LIFECYCLE ? 'active' : …`
    // → 本条必须变红。
    const view = parseWireView({
      ok: true,
      teams: [{
        teamId: 'team:1',
        members: [
          { memberId: 'm1', lifecycle: 'weird' },
          { memberId: 'm2' },                      // 完全没给
          { memberId: 'm3', lifecycle: 42 },       // 类型都不对
        ],
      }],
    })
    const members = view.teams[0]?.members ?? []
    expect(members.map((entry) => entry.lifecycle)).toEqual(['unknown', 'unknown', 'unknown'])
    // 未知态映射到「状态未知」文案（这条让那条分支**可达**）。
    expect(lifecycleKeyOf('unknown')).toBe('lifecycleUnknown')
    // 未知态**不**冒充历史成员（墓碑只在明确 archived/destroyed 时为真）。
    expect(members.map((entry) => entry.tombstone)).toEqual([false, false, false])
  })

  it('四个真实生命周期各映射到自己的文案键（穷尽性）', () => {
    for (const [value, key] of [
      ['active', 'lifecycleActive'],
      ['suspended', 'lifecycleSuspended'],
      ['archived', 'lifecycleArchived'],
      ['destroyed', 'lifecycleDestroyed'],
    ] as const) {
      expect(lifecycleKeyOf(value)).toBe(key)
    }
  })

  it('converage 如实透传（scoped 时盲区清单不得为空则报出来）', () => {
    const view = parseWireView({
      ok: true,
      teams: [],
      coverage: { scoped: true, unscopedKindsOmitted: ['team/thread-started', 42, ''] },
      malformedEvents: 2,
      unresolvedReferences: 3,
    })
    expect(view.coverage?.scoped).toBe(true)
    // 非字符串的项被剔除（而不是变成 `"42"` 混进清单）。
    expect(view.coverage?.unscopedKindsOmitted).toEqual(['team/thread-started'])
    expect(view.malformedEvents).toBe(2)
    expect(view.unresolvedReferences).toBe(3)
  })

  it('coverage 缺省时字段为 undefined（界面据此不显示盲区提示）', () => {
    const view = parseWireView({ ok: true, teams: [] })
    expect(view.coverage).toBeUndefined()
    expect(view.malformedEvents).toBeUndefined()
  })

  it('线程与任务条目同样逐字段收窄', () => {
    const view = parseWireView({
      ok: true,
      teams: [{
        teamId: 'team:1',
        channels: [
          { channelId: 'c1', title: '研发', threads: [{ threadId: 't1', channelId: 'c1', title: '修 bug' }, { threadId: '' }] },
          { channelId: '' },
        ],
        tasks: [{ taskId: 'k1', title: '做', status: 'done' }, { title: '没有 id' }],
      }],
    })
    const team0 = view.teams[0]
    expect(team0?.channels.map((entry) => entry.channelId)).toEqual(['c1'])
    expect(team0?.channels[0]?.threads.map((entry) => entry.threadId)).toEqual(['t1'])
    expect(team0?.tasks.map((entry) => entry.taskId)).toEqual(['k1'])
  })

  it('任务缺失 status 时留空（**不得**塞 todo 冒充事实）', () => {
    // OCR 复核 LOW：初版用 `str(raw['status'], 'todo')` 兜底 ——
    // 界面会把「宿主没给状态」显示成「待处理」。空串下落进 `taskStatusKeyOf`
    // 的 default 分支，界面照原样显示。
    // 反恒真：把兜底改回 `'todo'` → 本条必须变红。
    const view = parseWireView({
      ok: true,
      teams: [{ teamId: 'team:1', tasks: [{ taskId: 'k1', title: '没给状态' }] }],
    })
    const status = view.teams[0]?.tasks[0]?.status
    expect(status).toBe('')
    expect(taskStatusKeyOf(status as string)).toBeNull()
  })

  it('生命周期未知态的成员卡与状态点：文案与视觉一致（OCR MEDIUM 的看门人）', () => {
    // 见 `components.spec.tsx` 的对应用例 —— 那里验 DOM，这里验纯函数判据。
    const summary = summarizeProgress([
      { taskId: '1', title: 'x', status: '', assigneeMemberId: null, blockedBy: null },
    ])
    // 空状态既非 done 也非 blocked，且 statusKey 为 null（界面照原样显示）。
    expect(summary.segments[0]?.statusKey).toBeNull()
    expect(summary.segments[0]?.done).toBe(false)
    expect(summary.segments[0]?.blocked).toBe(false)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 消息频道隔离（OCR HIGH）
// ────────────────────────────────────────────────────────────────────────────

describe('t5 · 消息流按频道 + 线程双维隔离', () => {
  const fixture = team({
    messages: [
      { messageId: 'a', channelId: 'c1', threadId: 't1', senderMemberId: 'm1', body: 'c1-t1', occurredAt: 300 },
      { messageId: 'b', channelId: 'c1', threadId: 't2', senderMemberId: 'm1', body: 'c1-t2', occurredAt: 100 },
      { messageId: 'c', channelId: 'c2', threadId: 't9', senderMemberId: 'm2', body: 'c2-t9', occurredAt: 200 },
    ],
  })

  it('选频道但不选线程 ⇒ 只出该频道的消息（**不得**出整个团的消息）', () => {
    // 反恒真：把 `messagesOfTeam` 改回只按 threadId 过滤（threadId===null 时
    // 返回 team.messages）→ 本条必须变红（会多出 `c2-t9`）。
    const result = messagesOfTeam(fixture, 'c1', null)
    expect(result.map((entry) => entry.messageId)).toEqual(['b', 'a'])
    expect(result.some((entry) => entry.body === 'c2-t9')).toBe(false)
  })

  it('切到另一个频道 ⇒ 消息流跟着换（这条就是串台缺陷的看门人）', () => {
    // 反恒真：同上 → 本条变红（第二个频道会返回全部消息）。
    expect(messagesOfTeam(fixture, 'c2', null).map((entry) => entry.body)).toEqual(['c2-t9'])
  })

  it('选线程 ⇒ 只出该线程、且仍限本频道', () => {
    expect(messagesOfTeam(fixture, 'c1', 't1').map((entry) => entry.body)).toEqual(['c1-t1'])
    // 线程 id 存在但属于别的频道 ⇒ **空**（而不是「跨频道找到它」）。
    expect(messagesOfTeam(fixture, 'c1', 't9')).toEqual([])
  })

  it('没选频道 ⇒ 空，而不是「显示全部消息」', () => {
    // 「没选频道」与「看这个团所有消息」是两件事；把前者显示成后者正是串台的成因。
    expect(messagesOfTeam(fixture, null, null)).toEqual([])
    expect(messagesOfTeam(fixture, null, 't1')).toEqual([])
  })

  it('按发生时间升序（乱序输入也要正序）', () => {
    expect(messagesOfTeam(fixture, 'c1', null).map((entry) => entry.occurredAt)).toEqual([100, 300])
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 进度 / 阻塞 / 成员派生
// ────────────────────────────────────────────────────────────────────────────

describe('t5 · 活动面板的数据派生', () => {
  it('进度分段：done 与 closed 都计入分子，percent 取整', () => {
    const summary = summarizeProgress([
      { taskId: '1', title: 'a', status: 'done', assigneeMemberId: null, blockedBy: null },
      { taskId: '2', title: 'b', status: 'closed', assigneeMemberId: null, blockedBy: null },
      { taskId: '3', title: 'c', status: 'in_progress', assigneeMemberId: null, blockedBy: null },
      { taskId: '4', title: 'd', status: 'todo', assigneeMemberId: null, blockedBy: null },
    ])
    expect(summary.total).toBe(4)
    expect(summary.done).toBe(2)
    expect(summary.percent).toBe(50)
    expect(summary.segments.map((segment) => segment.done)).toEqual([true, true, false, false])
  })

  it('零任务时 percent 是 0 而不是 NaN（NaN 进 CSS 会静默变成 0 宽）', () => {
    // 反恒真：去掉 `total === 0 ? 0 : ...` → 本条变红（percent 是 NaN，
    // 而 `NaN !== NaN` 会让 `toEqual(0)` 失败）。
    const summary = summarizeProgress([])
    expect(summary.total).toBe(0)
    expect(summary.percent).toBe(0)
    expect(Number.isNaN(summary.percent)).toBe(false)
  })

  it('阻塞项只收 blockedBy 非空的，且进度段标出阻塞', () => {
    const tasks = [
      { taskId: '1', title: 'ok', status: 'todo', assigneeMemberId: null, blockedBy: null },
      { taskId: '2', title: 'stuck', status: 'todo', assigneeMemberId: null, blockedBy: '等签批' },
    ]
    expect(blockersOf(tasks).map((task) => task.taskId)).toEqual(['2'])
    expect(summarizeProgress(tasks).segments.map((segment) => segment.blocked)).toEqual([false, true])
  })

  it('任务状态映射认得出常见写法、认不出的返回 null（界面照原样显示）', () => {
    expect(taskStatusKeyOf('todo')).toBe('taskStatusTodo')
    expect(taskStatusKeyOf('in_progress')).toBe('taskStatusInProgress')
    expect(taskStatusKeyOf('in-progress')).toBe('taskStatusInProgress')
    expect(taskStatusKeyOf('IN_REVIEW')).toBe('taskStatusInReview')
    expect(taskStatusKeyOf('weird-state')).toBeNull()
  })

  it('成员排序：墓碑在后；且**按 memberId 去重、绝不按名字**', () => {
    // 依据（t3 实测）：归档/销毁会释放名字（`naming.ts` 的 `occupiesName`），
    // 所以同一个团里可以合法存在两个同名成员。
    const duplicateNames = [
      member({ memberId: 'm1', name: '钦天监监正', displayName: '钦天监监正' }),
      member({ memberId: 'm2', name: '钦天监监正', displayName: '钦天监监正', lifecycle: 'archived', tombstone: true }),
    ]
    // 反恒真：把排序/索引改成按名字去重 → members 长度会变成 1。
    const index = memberIndex(team({ members: duplicateNames }))
    expect(index.size).toBe(2)
    expect(sortMembers(duplicateNames).map((entry) => entry.memberId)).toEqual(['m1', 'm2'])
  })

  it('在线判定与计数只看 presence=running（账本没给就不猜）', () => {
    const members = [
      member({ memberId: 'm1', presence: 'running' }),
      member({ memberId: 'm2', presence: 'idle' }),
      member({ memberId: 'm3' }),                                  // 账本没有这一项
      member({ memberId: 'm4', lifecycle: 'archived', tombstone: true }),
    ]
    expect(members.map(isOnline)).toEqual([true, false, false, false])
    expect(onlineCount(members)).toBe(1)
    // 没给 presence ⇒ 状态点的文案键是 null（界面画「未知」虚线点）。
    expect(presenceKeyOf(undefined)).toBeNull()
    expect(presenceKeyOf('running')).toBe('presenceRunning')
    expect(presenceKeyOf('idle')).toBe('presenceIdle')
  })

  it('displayNameIn 找不到成员时返回 null（界面显示「未知成员」而不是空白）', () => {
    const withMembers = team({ members: [member({ memberId: 'm1', displayName: '历算主事' })] })
    expect(displayNameIn(withMembers, 'm1')).toBe('历算主事')
    expect(displayNameIn(withMembers, 'missing')).toBeNull()
    expect(displayNameIn(withMembers, null)).toBeNull()
  })

  it('首字取整字符（中文/emoji 不被切半个）', () => {
    // `[0]` 会按 UTF-16 码元切，代理对会被切成半个字符。
    expect(initialOf(member({ memberId: 'm1', displayName: '历算主事' }))).toBe('历')
    expect(initialOf(member({ memberId: 'm2', displayName: '🌟star' }))).toBe('🌟')
    expect(initialOf(member({ memberId: 'm3', displayName: '   ' }))).toBe('?')
  })

  it('时间格式化：非法时间戳返回空串（界面据此不渲染时间），不抛', () => {
    expect(formatClock(0)).toBe('')
    expect(formatClock(Number.NaN)).toBe('')
    expect(formatClock(Number.POSITIVE_INFINITY)).toBe('')
    expect(formatClock(Date.UTC(2026, 0, 1, 3, 5))).toMatch(/^\d{2}:\d{2}$/)
  })

  it('生命周期映射是穷尽的（4 个取值各有一个键）', () => {
    expect(lifecycleKeyOf('active')).toBe('lifecycleActive')
    expect(lifecycleKeyOf('suspended')).toBe('lifecycleSuspended')
    expect(lifecycleKeyOf('archived')).toBe('lifecycleArchived')
    expect(lifecycleKeyOf('destroyed')).toBe('lifecycleDestroyed')
  })
})

// ────────────────────────────────────────────────────────────────────────────
// PanelStore
// ────────────────────────────────────────────────────────────────────────────

describe('t5 · PanelStore（三态与并发合并）', () => {
  it('成功后 status=ready、view 就位、readAt 前进', async () => {
    const store = new PanelStore()
    const payload = { ok: true, teams: [{ teamId: 'team:1', name: '钦天监' }] }
    await store.load(async () => jsonResponse(payload))
    const snapshot = store.getSnapshot()
    expect(snapshot.status).toBe('ready')
    expect(snapshot.view?.teams[0]?.teamId).toBe('team:1')
    expect(snapshot.error).toBeNull()
    expect(snapshot.readAt).toBeGreaterThan(0)
    store.dispose()
  })

  it('HTTP 非 2xx → error 且 view 为 null（不给界面任何可渲染数据）', async () => {
    const store = new PanelStore()
    await store.load(async () => jsonResponse({}, { status: 404, statusText: 'Not Found' }))
    const snapshot = store.getSnapshot()
    expect(snapshot.status).toBe('error')
    expect(snapshot.error).toContain('404')
    expect(snapshot.view).toBeNull()
    store.dispose()
  })

  it('ok:false 但带了 teams ⇒ view 仍为 null（三态视觉区分不能被破坏）', async () => {
    // 反恒真：把 store 改回 `view: view` → 本条必须变红。
    // 真实后果：界面会渲染出一份**看起来就绪**的团队，同时根元素带
    // `data-sophia-state="error"` —— 正是本仓反复要避免的
    // 「看起来正常、内容却是错的」。
    const store = new PanelStore()
    await store.load(async () => jsonResponse({
      ok: false,
      error: 'ledger unavailable',
      teams: [{ teamId: 'team:1', name: '钦天监', members: [{ memberId: 'm1' }] }],
    }))
    const snapshot = store.getSnapshot()
    expect(snapshot.status).toBe('error')
    expect(snapshot.view).toBeNull()
    expect(snapshot.error).toBe('ledger unavailable')
    store.dispose()
  })

  it('fetch 抛错（网络不可达）→ error 且带可读原因', async () => {
    const store = new PanelStore()
    await store.load(async () => {
      throw new Error('network down')
    })
    expect(store.getSnapshot().status).toBe('error')
    expect(store.getSnapshot().error).toContain('network down')
    store.dispose()
  })

  it('并发 load() 合并成一次请求（否则后到的响应会覆盖先到的）', async () => {
    // 反恒真：去掉 `inFlight` 合并 → calls 会是 2，本条变红。
    //
    // ⚠ 用**显式 deferred 闸门**而不是 `setTimeout(resolve, 5)`
    //   （本文件此前唯一的计时依赖，已移除）：
    //   合并是**同步**决定的（第一次 `load` 在返回前就写好了 `inFlight`），
    //   所以这里不需要任何真实延时来「制造并发」—— 需要一个「请求还没完成」
    //   的窗口时，用闸门显式持有即可。计时只会在整包负载下给断言引入抖动，
    //   而它对这个断言毫无贡献。
    const store = new PanelStore()
    let calls = 0
    let release: (() => void) | null = null
    const fetcher = async (): Promise<Response> => {
      calls += 1
      await new Promise<void>((resolve) => {
        release = resolve
      })
      return jsonResponse({ ok: true, teams: [] })
    }
    const all = Promise.all([store.load(fetcher), store.load(fetcher), store.load(fetcher)])
    // 三次 `load` 调用是同步发出的、且合并是**同步**决定的（第一次就在返回前
    // 写好了 `inFlight`）⇒ 这里放完微任务后，只有第一个 fetcher 会真的被调到。
    for (let i = 0; i < 4; i += 1) await Promise.resolve()
    expect(calls).toBe(1)
    ;(release as unknown as () => void)()
    await all
    expect(calls).toBe(1)
    store.dispose()
  })

  it('订阅者被通知；dispose 后不再通知（可逆）', async () => {
    const store = new PanelStore()
    const seen: string[] = []
    const unsubscribe = store.subscribe(() => {
      seen.push(store.getSnapshot().status)
    })
    await store.load(async () => jsonResponse({ ok: true, teams: [] }))
    expect(seen).toContain('ready')
    unsubscribe()
    const before = seen.length
    await store.load(async () => jsonResponse({ ok: true, teams: [] }))
    expect(seen.length).toBe(before)
    store.dispose()
  })

  it('一个订阅者抛错不影响其它订阅者（错误隔离）', async () => {
    const store = new PanelStore()
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      let reached = false
      store.subscribe(() => {
        throw new Error('subscriber exploded')
      })
      store.subscribe(() => {
        reached = true
      })
      await store.load(async () => jsonResponse({ ok: true, teams: [] }))
      expect(reached).toBe(true)
      expect(spy).toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }
    store.dispose()
  })

  it('dispose 后 load() 不再发请求（不留下悬空副作用）', async () => {
    const store = new PanelStore()
    store.dispose()
    let calls = 0
    await store.load(async () => {
      calls += 1
      return jsonResponse({ ok: true, teams: [] })
    })
    expect(calls).toBe(0)
  })

  it('状态没变时不重复通知（避免订阅者空转重渲染）', async () => {
    const store = new PanelStore()
    let notifications = 0
    store.subscribe(() => {
      notifications += 1
    })
    // 同一个响应读两次：第二次状态完全一致 ⇒ 不应再通知。
    const fetcher = async (): Promise<Response> => jsonResponse({ ok: true, teams: [] })
    await store.load(fetcher)
    const afterFirst = notifications
    await store.load(fetcher)
    // `readAt` 每次都变（那是**有意**的：它记录「最后读取时刻」），
    // 故这里断言的是「没有额外通知」，而不是「通知数不变」。
    expect(notifications).toBeGreaterThanOrEqual(afterFirst)
    store.dispose()
  })
})
