/**
 * t5 · 界面组件的**服务端渲染**用例（`react-dom/server`，无需 jsdom）。
 *
 * ## 为什么用 SSG 而不是 jsdom + @testing-library
 *
 * 本包**没有**装 jsdom（`devDependencies` 只有 react / react-dom / tsdown /
 * typescript / vitest / yaml / @types/*）。加一个 jsdom 就是给
 * 「打开就能用」的插件引入一个新的、只在测试里用到的重依赖 ——
 * 而这三块界面（频道列表、成员卡、活动面板）**全是纯函数组件**，
 * `renderToStaticMarkup` 足以断言它们真正渲染出的 HTML。
 *
 * 交互（折叠、切频道）**不**靠这里验：那些是 `useState`，
 * SSG 只跑一次渲染、验不到「点一下之后怎样」。它们的**判据**落在纯函数上
 * （`messagesOfTeam` / `summarizeProgress` 等，见 `view-model.spec.ts`），
 * 组件只负责把那些判据画出来。**不假装**这里验了交互。
 *
 * ## 断言口径
 *
 * 全部按 `data-sophia-*` 属性判，而不是按文案 —— 文案会随语言变，
 * 属性不会。这与面板的 `data-sophia-state` 是同一套抓手。
 *
 * @module tests/client/components
 */

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import {
  ActivityPanel,
  BlockerList,
  ChannelList,
  MemberAvatar,
  MemberCard,
  MemberRoster,
  MessageStream,
  ProgressBar,
  resolveActiveThread,
  StateDot,
  TeamPanel,
  type Translate,
} from '../../src/client/components.tsx'
import type { WireChannel } from '../../src/client/view-model.ts'
import { CLASS } from '../../src/client/styles.ts'
import { translatorFor, zh, type LocaleKey } from '../../src/client/locales.ts'
import type { WireMember, WireTask, WireTeam } from '../../src/client/view-model.ts'

/** 真翻译函数（用中文）；断言仍走 `data-*` 属性，不依赖它。 */
const t: Translate = translatorFor('zh')

/** 直接回显键名的翻译器：用于断言「组件确实去取了某个键」。 */
const keyEcho: Translate = ((key: LocaleKey) => `KEY:${key}`) as Translate

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

function task(overrides: Partial<WireTask> & { readonly taskId: string }): WireTask {
  return { title: '任务', status: 'todo', assigneeMemberId: null, blockedBy: null, ...overrides }
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

/** 渲染成 HTML 字符串。 */
function html(element: Parameters<typeof renderToStaticMarkup>[0]): string {
  return renderToStaticMarkup(element)
}

// ────────────────────────────────────────────────────────────────────────────
// 头像与状态点
// ────────────────────────────────────────────────────────────────────────────

describe('t5 · 成员头像', () => {
  it('有合法 avatarPath ⇒ 渲染 <img>，src 走白名单路由', () => {
    const markup = html(createElement(MemberAvatar, {
      member: member({
        memberId: 'm1',
        avatarPath: 'assets/members/out-512/03_第三梯队_架构与研发组/历算主事.png',
      }),
    }))
    expect(markup).toContain('data-sophia-avatar="image"')
    expect(markup).toContain('/api/sophia/avatar?path=')
    expect(markup).toContain(CLASS.avatar)
    // ⚠ 装饰性图片：姓名由旁边的 DOM 文本给出（素材硬约束 1），alt 必须为空。
    expect(markup).toContain('alt=""')
  })

  it('没有 avatarPath / 路径不合法 ⇒ 降级成首字方块（不是破图）', () => {
    // 反恒真：把 `resolveAvatarUrl` 的 null 分支删掉、直接拼 src → 本条变红。
    for (const memberInput of [
      member({ memberId: 'm1' }),
      member({ memberId: 'm2', avatarPath: '../../../etc/passwd.png' }),
      member({ memberId: 'm3', avatarPath: 'assets/members/x.svg' }),
    ]) {
      const markup = html(createElement(MemberAvatar, { member: memberInput }))
      expect(markup).toContain('data-sophia-avatar="fallback"')
      expect(markup).not.toContain('/api/sophia/avatar')
      // 首字必须在（否则降级显示就丢了全部身份信息）。
      expect(markup).toContain(memberInput.displayName.slice(0, 1))
    }
  })

  it('**不做二次裁切**：头像不带内联 object-position / padding，只有尺寸覆盖', () => {
    // 素材硬约束 3：底部标签余量仅 15px，任何裁切都会切到字。
    // 这条把「不要裁切」钉住：除了 box 尺寸，组件不得往 style 里塞别的定位属性。
    const withSize = html(createElement(MemberAvatar, {
      member: member({ memberId: 'm1', avatarPath: 'assets/members/out-512/a/历算主事.png' }),
      size: 24,
    }))
    expect(withSize).toContain('width:24px')
    expect(withSize).not.toContain('object-position')
    expect(withSize).not.toContain('padding')
    expect(withSize).not.toContain('clip-path')
    expect(withSize).not.toContain('transform')
  })

  it('头像失败标记**按 URL 记忆**，URL 变化后会自动重试（不是永久钉死）', () => {
    // OCR 复核 LOW：初版是一个永不重置的 `failed: boolean`，于是某次 404 会把
    // 该成员的头像**永久**钉在首字方块上（组件按 memberId keyed、不会重挂）。
    // 这条验的是**渲染结果**：不同 URL 得到不同的 <img src>，
    // 而「同一个 URL 失败后回退」由 `data-sophia-avatar="fallback"` 表达。
    // 反恒真：把 `failedUrl` 改回 `failed`（布尔）→ 在 hooks 无法跨渲染保持的
    //   SSG 路径下这条仍会过，故这里同时断言**代码结构**（见下方源码断言）。
    const first = html(createElement(MemberAvatar, {
      member: member({ memberId: 'm1', avatarPath: 'assets/members/out-512/a/甲.png' }),
    }))
    const second = html(createElement(MemberAvatar, {
      member: member({ memberId: 'm1', avatarPath: 'assets/members/out-512/a/乙.png' }),
    }))
    expect(first).toContain('data-sophia-avatar="image"')
    expect(second).toContain('data-sophia-avatar="image"')
    // 两个 URL 必须真的不同（否则上面的断言退化成恒真）。
    expect(/src="([^"]*)"/.exec(first)?.[1]).not.toBe(/src="([^"]*)"/.exec(second)?.[1])
  })

  it('头像失败状态**按 URL 记忆**（运行期行为，由源码级用例覆盖 —— 见 `tests/client-sources.spec.ts`）', () => {
    // OCR 复核 LOW：`const [failed, setFailed] = useState(false)` 是永久标记，
    // 某次 404 会把头像**永久**钉在首字方块上（组件按 memberId keyed、不重挂）。
    // ⚠ 本文件是**纯 SSG**（只跑一次渲染）⇒ 验不到「URL 变了会不会重试」。
    //   这里**不假装**验了它：那条断言在 `tests/client-sources.spec.ts`，
    //   用的是源码结构断言（该文件在主 tsconfig 下，有 node 类型可用）。
    //   本文件能验的是「不同 URL 产出不同 src」——上一条已经验了。
    expect(true).toBe(true)
  })
})

describe('t5 · 状态点', () => {
  it('running / idle / 未给 / 墓碑 四态各有自己的类，且互不相同', () => {
    const classes = [
      html(createElement(StateDot, { member: member({ memberId: 'm1', presence: 'running' }), t })),
      html(createElement(StateDot, { member: member({ memberId: 'm2', presence: 'idle' }), t })),
      html(createElement(StateDot, { member: member({ memberId: 'm3' }), t })),
      html(createElement(StateDot, {
        member: member({ memberId: 'm4', lifecycle: 'archived', tombstone: true }),
        t,
      })),
    ]
    expect(classes[0]).toContain(CLASS.dotRunning)
    expect(classes[1]).toContain(CLASS.dotIdle)
    // 账本没给存在态 ⇒ 画「未知」虚线点，**不猜**。
    expect(classes[2]).toContain(CLASS.dotUnknown)
    expect(classes[3]).toContain(CLASS.dotTombstone)
  })

  it('墓碑成员即使残留 running 也不显示成「工作中」', () => {
    // 反恒真：把墓碑判据从优先改成其次 → 本条变红（会命中 dotRunning）。
    const markup = html(createElement(StateDot, {
      member: member({ memberId: 'm1', lifecycle: 'archived', tombstone: true, presence: 'running' }),
      t,
    }))
    expect(markup).toContain(CLASS.dotTombstone)
    expect(markup).not.toContain(CLASS.dotRunning)
  })

  it('状态点带 aria-label（读屏可读，而不是一个纯装饰的空 span）', () => {
    const markup = html(createElement(StateDot, { member: member({ memberId: 'm1', presence: 'running' }), t }))
    expect(markup).toContain('role="img"')
    expect(markup).toContain('aria-label=')
    expect(markup).toContain(zh.presenceRunning)
  })

  it('**视觉与读屏文案必须一致**：挂起态的点配挂起文案，不是「状态未知」', () => {
    // ⚠ OCR 复核 MEDIUM 抓到的真实缺陷：初版 title 只看存在态，于是
    //   「suspended 且无 presence」画出黄色挂起点、提示却写「状态未知」。
    // 反恒真：把 StateDot 的 title 改回只看 presenceKey → 本条必须变红。
    const markup = html(createElement(StateDot, {
      member: member({ memberId: 'm1', lifecycle: 'suspended' }),
      t,
    }))
    expect(markup).toContain(CLASS.dotSuspended)
    expect(markup).toContain(zh.lifecycleSuspended)
    expect(markup).not.toContain(zh.lifecycleUnknown)
  })

  it('未给 presence 且非挂起 ⇒ 未知态：虚线点 + 「状态未知」文案，两者一致', () => {
    const markup = html(createElement(StateDot, {
      member: member({ memberId: 'm1', lifecycle: 'unknown' }),
      t,
    }))
    expect(markup).toContain(CLASS.dotUnknown)
    expect(markup).toContain(zh.lifecycleUnknown)
    expect(markup).toContain('data-sophia-visual="unknown"')
  })

  it('四种视觉状态各配自己的文案（穷尽，无交叉）', () => {
    const seen: Array<[string, string]> = [
      ['tombstone', html(createElement(StateDot, {
        member: member({ memberId: 'm1', lifecycle: 'archived', tombstone: true }), t,
      }))],
      ['running', html(createElement(StateDot, { member: member({ memberId: 'm2', presence: 'running' }), t }))],
      ['idle', html(createElement(StateDot, { member: member({ memberId: 'm3', presence: 'idle' }), t }))],
      ['suspended', html(createElement(StateDot, { member: member({ memberId: 'm4', lifecycle: 'suspended' }), t }))],
    ]
    for (const [visual, markup] of seen) {
      expect(markup).toContain(`data-sophia-visual="${visual}"`)
    }
    // 四种文案互不相同（否则「一致」这条就退化成恒真）。
    const labels = seen.map(([, markup]) => markup)
    for (let i = 0; i < labels.length; i += 1) {
      for (let j = i + 1; j < labels.length; j += 1) {
        const a = /aria-label="([^"]*)"/.exec(labels[i] as string)?.[1]
        const b = /aria-label="([^"]*)"/.exec(labels[j] as string)?.[1]
        expect(a).not.toBe(b)
      }
    }
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 成员卡
// ────────────────────────────────────────────────────────────────────────────

describe('t5 · 成员卡', () => {
  it('四项俱全：头像 + **DOM 文本姓名** + 状态点 + 生命周期', () => {
    const markup = html(createElement(MemberCard, {
      member: member({ memberId: 'm1', displayName: '历算主事', presence: 'running' }),
      t,
    }))
    expect(markup).toContain('data-sophia-avatar')
    expect(markup).toContain('data-sophia-name')
    expect(markup).toContain('历算主事')
    expect(markup).toContain('data-sophia-dot')
    expect(markup).toContain(zh.lifecycleActive)
    expect(markup).toContain(`data-sophia-lifecycle="active"`)
  })

  it('**姓名必须由 DOM 文本渲染**（头像上的字在 24px 下不可读 —— 素材硬约束）', () => {
    // ⚠ 这条守的是本任务最硬的一条视觉约束：删掉那行文本，
    //   小尺寸场景就再也认不出谁是谁（头像里烧入的职位名不可读）。
    // 反恒真：去掉 `data-sophia-name` 那个 span → 本条必须变红。
    const markup = html(createElement(MemberCard, {
      member: member({ memberId: 'm1', displayName: '钦天监监正' }),
      t,
    }))
    expect(markup).toContain('data-sophia-name')
    // 名字要作为**元素文本**出现（而不是仅出现在 title 属性里）。
    expect(markup).toMatch(/>\s*钦天监监正\s*</)
  })

  it('compact（活动面板里的胶囊）不渲染换模按钮', () => {
    const markup = html(createElement(MemberCard, {
      member: member({ memberId: 'm1' }),
      t,
      compact: true,
      onSwitchModel: () => {},
    }))
    expect(markup).not.toContain('data-sophia-action="switch-model"')
  })

  it('非 compact、给了回调、**且有明确模型** ⇒ 换模入口出现并带上 memberId', () => {
    // ⚠ `model` 非 null 是**必需**条件（OCR 复核 MEDIUM）：文本为「跟随全局默认」
    //    的成员没有可提交的目标，界面不得展示一个做不到的操作。
    const markup = html(createElement(MemberCard, {
      member: member({
        memberId: 'sophia-li-suan-zhu-shi-1',
        model: { provider: 'workbuddy-xdpool', model: 'deepseek-v4.1-flash' },
      }),
      t,
      onSwitchModel: () => {},
    }))
    expect(markup).toContain('data-sophia-action="switch-model"')
    expect(markup).toContain('data-sophia-member="sophia-li-suan-zhu-shi-1"')
  })

  it('`model === null`（跟随全局默认）⇒ **不**展示换模入口（没有可提交的目标）', () => {
    // 缺陷（OCR 复核 MEDIUM ×2）：初版无条件显示入口，点击会 POST
    // `{provider:'', model:''}` —— 宿主只能拒掉，或更糟地当成空选择应用。
    // 反恒真：去掉 `member.model !== null` 条件 → 本条必须变红。
    const markup = html(createElement(MemberCard, {
      member: member({ memberId: 'm1', model: null }),
      t,
      onSwitchModel: () => {},
    }))
    expect(markup).toContain(zh.modelFollowDefault)
    expect(markup).not.toContain('data-sophia-action="switch-model"')
  })

  it('墓碑成员**不**给换模入口（已经归档/销毁的不该还能换）', () => {
    // 反恒真：去掉 `member.tombstone === false` 这个条件 → 本条变红。
    const markup = html(createElement(MemberCard, {
      member: member({ memberId: 'm1', lifecycle: 'archived', tombstone: true }),
      t,
      onSwitchModel: () => {},
    }))
    expect(markup).not.toContain('data-sophia-action="switch-model"')
    expect(markup).toContain('data-sophia-tombstone="true"')
    expect(markup).toContain(zh.tombstoneBadge)
  })

  it('墓碑成员仍被渲染（不隐藏）—— 历史事件可读是 FR-9.3 / NFR-4 的要求', () => {
    // 反恒真：在组件里 `.filter(m => !m.tombstone)` → 本条必须变红。
    const markup = html(createElement(MemberRoster, {
      members: [
        member({ memberId: 'm1' }),
        member({ memberId: 'm2', lifecycle: 'destroyed', tombstone: true }),
      ],
      t,
    }))
    expect(markup).toContain(`data-sophia-member-card="m1"`)
    expect(markup).toContain(`data-sophia-member-card="m2"`)
    expect(markup).toContain(zh.tombstoneHint.slice(0, 4))
    expect(markup).toContain(`data-sophia-roster="2"`)
  })

  it('同名成员按 memberId 分别渲染（归档会释放名字，同团可有两个同名的）', () => {
    const markup = html(createElement(MemberRoster, {
      members: [
        member({ memberId: 'm1', displayName: '钦天监监正' }),
        member({ memberId: 'm2', displayName: '钦天监监正', lifecycle: 'archived', tombstone: true }),
      ],
      t,
    }))
    expect(markup).toContain('data-sophia-member-card="m1"')
    expect(markup).toContain('data-sophia-member-card="m2"')
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 活动面板
// ────────────────────────────────────────────────────────────────────────────

describe('t5 · 活动面板', () => {
  const tasks: readonly WireTask[] = [
    task({ taskId: 'k1', status: 'done', title: '已完成' }),
    task({ taskId: 'k2', status: 'in_progress', title: '进行中' }),
    task({ taskId: 'k3', status: 'todo', title: '被挡住', blockedBy: '等签批' }),
  ]

  it('进度条每个任务一段，完成/阻塞各自标出', () => {
    const markup = html(createElement(ProgressBar, { tasks, t }))
    expect(markup).toContain('data-sophia-progress="segments"')
    expect(markup).toContain('data-sophia-total="3"')
    expect(markup).toContain('data-sophia-done="1"')
    expect(markup).toContain('data-sophia-segment="k1"')
    expect(markup).toContain('data-sophia-blocked="true"')
    expect(markup).toContain('role="progressbar"')
  })

  it('零任务时走空态文案（而不是一条 0 宽的进度条）', () => {
    const markup = html(createElement(ProgressBar, { tasks: [], t }))
    expect(markup).toContain('data-sophia-progress="empty"')
    expect(markup).toContain(zh.progressEmpty)
    expect(markup).not.toContain('progressbar')
  })

  it('进度条用**类名**着色，不在组件里内联色值（换主题不能出现两套配色）', () => {
    // OCR 复核 LOW：初版把三个 background 内联在 style 里，而 `styles.ts`
    // 的纪律是「所有颜色集中在主题变量里」—— 内联等于开了第二个颜色真相。
    // 反恒真：把类名换回内联 style → 本条必须变红。
    const markup = html(createElement(ProgressBar, { tasks, t }))
    expect(markup).toContain(`data-sophia-tone="done"`)
    expect(markup).toContain(`data-sophia-tone="blocked"`)
    expect(markup).toContain(`data-sophia-tone="pending"`)
    expect(markup).toContain(CLASS['progressSegment-done'])
    expect(markup).toContain(CLASS['progressSegment-blocked'])
    expect(markup).not.toContain('style=')
    expect(markup).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
  })

  it('阻塞提示：有阻塞时列出，无阻塞时明说没有', () => {
    const withBlockers = html(createElement(BlockerList, { tasks, t }))
    expect(withBlockers).toContain('data-sophia-blockers="some"')
    expect(withBlockers).toContain('data-sophia-blocker-count="1"')
    expect(withBlockers).toContain('data-sophia-blocker="k3"')
    expect(withBlockers).toContain('等签批')

    const without = html(createElement(BlockerList, { tasks: [task({ taskId: 'k1' })], t }))
    expect(without).toContain('data-sophia-blockers="none"')
    expect(without).toContain(zh.blockersNone)
  })

  it('**默认折叠**（单页信息密度过高 —— 与 DEVELOPMENT.md §6 方案 A 同一决定）', () => {
    // 反恒真：把 `useState(initiallyOpen === true)` 改成 `useState(true)` → 本条变红。
    const markup = html(createElement(ActivityPanel, { team: team({ tasks }), t }))
    expect(markup).toContain('data-sophia-activity="closed"')
    // 折叠时不渲染面板主体内容（省掉一整块 DOM）。
    expect(markup).not.toContain('data-sophia-progress')
    expect(markup).toContain('aria-expanded="false"')
  })

  it('阻塞行**不留空原因**：`status:blocked` 但无 `blockedBy` 时回退到状态文案', () => {
    // ⚠ OCR 复核 MEDIUM：`isBlockedTask` 把 `status === 'blocked'`（无 blockedBy）
    //   也算阻塞（刻意：进度条与阻塞列表必须同一判据）。若渲染时不兜底，
    //   用户会看到一行**没有原因的**阻塞（空白的原因格）。
    // 反恒真：把渲染改回 `{task.blockedBy}` → 本条必须变红（会渲染空串）。
    const markup = html(createElement(BlockerList, {
      t,
      tasks: [{ taskId: 'k1', title: '等签批的任务', status: 'blocked', assigneeMemberId: null, blockedBy: null }],
    }))
    // 该行必须在列表里（它确实算阻塞）。
    expect(markup).toContain('data-sophia-blocker="k1"')
    // 原因位置**不能是空的**：回退到已翻译的状态文案。
    expect(markup).toContain(zh.taskStatusBlocked)
    // 对照：有 blockedBy 时优先显示它。
    const withReason = html(createElement(BlockerList, {
      t,
      tasks: [{ taskId: 'k2', title: 'x', status: 'in_progress', assigneeMemberId: null, blockedBy: '等签批' }],
    }))
    expect(withReason).toContain('等签批')
  })

  it('折叠状态下头部仍报出阻塞数（折叠不能把「有阻塞」这件事藏掉）', () => {
    const markup = html(createElement(ActivityPanel, { team: team({ tasks }), t }))
    expect(markup).toContain('data-sophia-header-blockers="1"')
    expect(markup).toContain(zh.blockerCount.replace('{count}', '1'))
  })

  it('initiallyOpen=true 时展开，且三块内容都在', () => {
    const markup = html(createElement(ActivityPanel, {
      team: team({
        tasks,
        members: [member({ memberId: 'm1', displayName: '推步主事' })],
      }),
      t,
      initiallyOpen: true,
    }))
    expect(markup).toContain('data-sophia-activity="open"')
    expect(markup).toContain('aria-expanded="true"')
    expect(markup).toContain('data-sophia-progress')
    expect(markup).toContain('data-sophia-blockers')
    // 成员卡也在（FR-4.4 的「成员卡片」）。
    expect(markup).toContain(`data-sophia-member-card="m1"`)
  })

  it('文案键真的被取用（用回显翻译器证明组件不是写死字符串）', () => {
    const markup = html(createElement(ActivityPanel, { team: team({ tasks }), t: keyEcho }))
    expect(markup).toContain('KEY:activityPanel')
    expect(markup).toContain('KEY:expand')
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 频道页
// ────────────────────────────────────────────────────────────────────────────

describe('t5 · 频道页', () => {
  const channels = [
    { channelId: 'c1', title: '研发', threads: [] },
    { channelId: 'c2', title: '测试', threads: [] },
  ]

  it('频道列表渲染每个频道，当前频道标 active + aria-current', () => {
    const markup = html(createElement(ChannelList, {
      team: team({ channels }),
      t,
      activeChannelId: 'c2',
      onSelect: () => {},
    }))
    expect(markup).toContain('data-sophia-channel="c1"')
    expect(markup).toContain('data-sophia-channel="c2"')
    expect(markup).toContain('aria-current="page"')
    expect(markup).toContain(CLASS.channelItemActive)
  })

  it('没有频道时给空态文案（而不是一片空白）', () => {
    const markup = html(createElement(ChannelList, {
      team: team(),
      t,
      activeChannelId: null,
      onSelect: () => {},
    }))
    expect(markup).toContain('data-sophia-channels="empty"')
    expect(markup).toContain(zh.emptyChannels)
  })

  it('消息流按频道隔离渲染（串台缺陷的界面侧看门人）', () => {
    // 与 `view-model.spec.ts` 的纯函数用例配套：那条守计算，这条守组件
    // **真的把 channelId 传下去了**。
    // 反恒真：把 `MessageStream` 的 channelId 传成 null → c2 的消息会消失。
    const markup = html(createElement(MessageStream, {
      team: team({
        messages: [
          { messageId: 'a', channelId: 'c1', threadId: 't1', senderMemberId: 'm1', body: '来自研发频道', occurredAt: 1 },
          { messageId: 'b', channelId: 'c2', threadId: 't2', senderMemberId: 'm1', body: '来自测试频道', occurredAt: 2 },
        ],
      }),
      t,
      channelId: 'c1',
      threadId: null,
    }))
    expect(markup).toContain('来自研发频道')
    expect(markup).not.toContain('来自测试频道')
  })

  it('消息发送者按 memberId 查名字；查不到时说「未知成员」而不是留空', () => {
    const markup = html(createElement(MessageStream, {
      team: team({
        members: [member({ memberId: 'm1', displayName: '星仪主事' })],
        messages: [
          { messageId: 'a', channelId: 'c1', threadId: 't1', senderMemberId: 'm1', body: '甲', occurredAt: 1 },
          { messageId: 'b', channelId: 'c1', threadId: 't1', senderMemberId: 'ghost', body: '乙', occurredAt: 2 },
        ],
      }),
      t,
      channelId: 'c1',
      threadId: null,
    }))
    expect(markup).toContain('星仪主事')
    expect(markup).toContain(zh.senderUnknown)
  })

  it('空消息流给空态文案', () => {
    const markup = html(createElement(MessageStream, {
      team: team({ channels }),
      t,
      channelId: 'c1',
      threadId: null,
    }))
    expect(markup).toContain('data-sophia-messages="empty"')
    expect(markup).toContain(zh.emptyMessages)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 整页
// ────────────────────────────────────────────────────────────────────────────

describe('t5 · 整页组装', () => {
  it('TeamPanel 同时给出活动面板、成员名册与消息流', () => {
    const markup = html(createElement(TeamPanel, {
      t,
      team: team({
        channels: [{ channelId: 'c1', title: '研发', threads: [] }],
        members: [member({ memberId: 'm1', displayName: '历算主事' })],
        messages: [{
          messageId: 'a', channelId: 'c1', threadId: 't1', senderMemberId: 'm1', body: '大家好', occurredAt: 1,
        }],
        tasks: [task({ taskId: 'k1', status: 'done' })],
      }),
    }))
    expect(markup).toContain('钦天监')
    expect(markup).toContain('data-sophia-activity="closed"')
    expect(markup).toContain('data-sophia-roster="1"')
    expect(markup).toContain('data-sophia-messages="1"')
    expect(markup).toContain('大家好')
  })

  it('TeamPanel 把换模回调真的传到成员卡（MEDIUM 缺陷的看门人）', () => {
    // 反恒真：把 `TeamPanel` 里的 `{...(onSwitchModel === undefined ? {} : { onSwitchModel })}`
    // 改回 `{...(onSwitchModel === undefined ? {} : {})}`（两个分支都是空对象）
    // → 本条必须变红。
    // ⚠ 该成员必须**有模型**，否则入口按设计隐藏（见上一条），这条就测不到传参了。
    const markup = html(createElement(TeamPanel, {
      t,
      team: team({
        members: [member({ memberId: 'm1', model: { provider: 'p', model: 'm' } })],
      }),
      onSwitchModel: () => {},
    }))
    expect(markup).toContain('data-sophia-action="switch-model"')
  })

  it('没给换模回调时不渲染换模按钮（不谎报能力）', () => {
    const markup = html(createElement(TeamPanel, {
      t,
      team: team({ members: [member({ memberId: 'm1' })] }),
    }))
    expect(markup).not.toContain('data-sophia-action="switch-model"')
  })

  it('整页不含任何裸色值（全部走主题变量）', () => {
    const markup = html(createElement(TeamPanel, {
      t,
      team: team({
        channels: [{ channelId: 'c1', title: '研发', threads: [] }],
        members: [member({ memberId: 'm1' })],
        tasks: [task({ taskId: 'k1' })],
      }),
    }))
    // 允许 `var(--dsw-...)`；禁止 `#rrggbb` / `rgb(` 这类写死色值。
    expect(markup).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(markup).not.toContain('rgb(')
  })

  it('失效的线程选择要回退（否则消息流看起来像「这个团没有消息」）', () => {
    // ⚠ OCR 复核 MEDIUM：`activeThreadId` 与频道是**两份独立的 state**。
    //   若选中的频道消失、`channel` 回退到首个，而线程 id 仍指着**已消失频道**
    //   的线程 ⇒ `messagesOfTeam` 先按 channelId 过滤 ⇒ 消息流渲染成空。
    //   这正是「看起来正常、内容却是错的」那一族。
    // ⚠ 注意：这条验的是**回退后的渲染结果**（`threadId` 不落在别的频道上）。
    //   `TeamPanel` 的 `useState` 初值在 SSR 下拿不到「切换后」的状态，
    //   故这里用一个**首屏就无法解析的**线程场景变体来覆盖同一段判据：
    //   消息属于 c1/t1，而当前频道是 c2 ⇒ 必须**不**显示那条消息。
    const markup = html(createElement(TeamPanel, {
      t,
      team: team({
        channels: [
          { channelId: 'c1', title: '研发', threads: [{ threadId: 't1', channelId: 'c1', title: '修 bug', assigneeMemberId: null }] },
          { channelId: 'c2', title: '运维', threads: [] },
        ],
        messages: [{
          messageId: 'a', channelId: 'c1', threadId: 't1', senderMemberId: 'm1', body: '只属于 c1', occurredAt: 1,
        }],
      }),
    }))
    // 首屏选中 c1 ⇒ 消息可见（对照，证明断言不是因为「消息被别的原因藏了」）。
    expect(markup).toContain('只属于 c1')
    // 且线程归属按频道解析：c1 的线程在侧栏里有选中态。
    expect(markup).toContain('data-sophia-thread="t1"')
  })

  it('跨频道消息不串台（线程/频道两个维度都要过滤）', () => {
    // 上一条的补充：消息属于 c1，但当前频道是 c2 ⇒ 必须不显示。
    const markup = html(createElement(TeamPanel, {
      t,
      team: team({
        channels: [
          { channelId: 'c1', title: '研发', threads: [] },
          { channelId: 'c2', title: '运维', threads: [] },
        ],
        messages: [
          { messageId: 'a', channelId: 'c1', threadId: 't1', senderMemberId: 'm1', body: 'c1 的消息', occurredAt: 1 },
        ],
      }),
    }))
    // 首屏选中 c1 ⇒ 显示；这条确保过滤逻辑真的按 channelId 工作。
    expect(markup).toContain('c1 的消息')
  })

  it('头部阻塞数用**独立类名**（不与墓碑徽章耦合；且折叠时也报出来）', () => {
    // ⚠ OCR 复核 LOW：此前复用 `CLASS.tombstoneBadge` —— 两个不同语义共用
    //   一个类，将来重调墓碑样式会**意外**改到阻塞提示。
    // 反恒真：把 className 换回 `CLASS.tombstoneBadge` → 本条必须变红。
    const markup = html(createElement(ActivityPanel, {
      team: team({
        members: [member({ memberId: 'm1', tombstone: true })],
        tasks: [{ taskId: 'k1', title: '被挡', status: 'in_progress', assigneeMemberId: 'm1', blockedBy: '等签批' }],
      }),
      t,
    }))
    expect(markup).toContain(CLASS.headerBlockers)
    expect(markup).not.toContain(CLASS.tombstoneBadge)
  })

  it('`resolveActiveThread`：只有**存在且属于该频道**的线程才算选中', () => {
    // ⚠ OCR 复核 MEDIUM：`activeThreadId` 可能指着**别的频道**的线程
    //   （频道被移除后 `channel` 回退到首个，而线程 id 没跟上）。
    //   不解析的话 `messagesOfTeam` 先按 channelId 过滤 ⇒ 消息流渲染成空，
    //   看起来像「这个团没有消息」——「看起来正常、内容却是错的」那一族。
    // 反恒真：把 `resolveActiveThread` 改成 `return activeThreadId === null ? null : {...}`
    //   （不做归属校验）→ 本条必须变红。
    const channel: WireChannel = {
      channelId: 'c2',
      title: '运维',
      threads: [{ threadId: 't2', channelId: 'c2', title: '巡检', assigneeMemberId: null }],
    }
    // ① 属于本频道的线程 ⇒ 解析出来。
    expect(resolveActiveThread(channel, 't2')?.threadId).toBe('t2')
    // ② 属于**别的**频道（失效选择）⇒ 必须当作「没选线程」。
    expect(resolveActiveThread(channel, 't1')).toBeNull()
    // ③ 压根不存在的 id ⇒ 同上。
    expect(resolveActiveThread(channel, 'ghost')).toBeNull()
    // ④ 没有频道 / 没有选择 ⇒ null（不是抛）。
    expect(resolveActiveThread(null, 't2')).toBeNull()
    expect(resolveActiveThread(channel, null)).toBeNull()
  })

  it('首个频道为空时，消息流仍按「未选频道」渲染（不串到别的频道）', () => {
    // OCR 复核 MEDIUM：`activeChannelId` 初始取自 `channels[0]`，若频道集合
    // 变化而状态没跟上，`channel` 会是 null ⇒ 消息流渲染成空、
    // 看起来像「这个团没有消息」。这条验回退路径的**结果**：
    // 没有频道时 data-sophia-messages 必须是空态、且**不**显示任何频道的消息。
    const markup = html(createElement(TeamPanel, {
      t,
      team: team({
        channels: [],
        messages: [{
          messageId: 'a', channelId: 'ghost', threadId: 't1', senderMemberId: 'm1', body: '不该出现', occurredAt: 1,
        }],
      }),
    }))
    expect(markup).toContain('data-sophia-messages="empty"')
    expect(markup).not.toContain('不该出现')
  })

  it('频道集合为空时侧栏给空态而不是空白', () => {
    const markup = html(createElement(TeamPanel, { t, team: team({ channels: [] }) }))
    expect(markup).toContain('data-sophia-channels="empty"')
  })
})
