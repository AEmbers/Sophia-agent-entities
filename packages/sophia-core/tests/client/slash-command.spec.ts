/**
 * 斜杠命令 `/sophia-agent-entities` 的行为用例（`src/client/commands.ts`
 * + `src/client/index.ts` 的接线）。
 *
 * ## 判据强度（如实标注，别把这里读成「全绿 ⇒ 真机上能用」）
 *
 * **能验**（真正的行为，不是复述假设）：
 * - 注册到命令面的**形状**（名称、`ui.kind === 'action'`、thunk、`available`）；
 * - `ui.run()` 真的把目标面板 id 交给 `layout.selectPanel`（**含反恒真**：
 *   用两个**不同的** panelId 各跑一次，第二次若仍收到第一次的值即证明硬编码）；
 * - 四条失败路径（服务缺失 / effect 不可用 / register 抛 / layout 缺失 / panel 未注册）
 *   都**不抛**、且如实进 console；
 * - 回收：effect 的 disposer 跑完，注册表里没有残留；
 * - **接线**：`apply(ctx)` 在 ctx 提供 `inject` 时真的把贡献交到命令面，
 *   并把状态写进 `window.__SOPHIA_CLIENT__.slashCommand`。
 *
 * **不能验**（结构性够不到，别以为它们被覆盖了）：
 * - 「宿主 UI 真的把 `/sophia-agent-entities` 认成命令并调用 `ui.run`」——
 *   那发生在 `@deepseek-ai/dsh-client-ui-commands`（宿主插件）内部，
 *   本包拿不到它的实例。判据来源是**读它的源码**（`lib/client.js:712-731`
 *   的 enter 路径、`:662-689` 的菜单路径、`:765-768` 的 action 分派），
 *   行号写在 `src/client/commands.ts` 的文件头 —— 那是**静态可核**，
 *   不是运行期实测，报告里必须分开写。
 * - 「面板真的显示了」—— 需要真实浏览器 + 真实布局插件。
 *
 * @module tests/client/slash-command
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  SOPHIA_SLASH_COMMAND,
  asCommandUi,
  asLayout,
  mountSophiaSlashCommand,
  openSophiaPanel,
  type SophiaCommandContribution,
} from '../../src/client/commands.ts'
import { apply, PANEL_ID } from '../../src/client/index.ts'

// ────────────────────────────────────────────────────────────────────────────
// 假服务（形状反推自真实调用点，见 `src/client/commands.ts` 文件头的出处表）
// ────────────────────────────────────────────────────────────────────────────

/** 假 `commandUi`：记录贡献，重名抛错（照真实实现 `client.js:556` 的行为）。 */
function makeCommandUi(): {
  readonly face: Record<string, unknown>
  readonly contributions: Map<string, SophiaCommandContribution>
} {
  const contributions = new Map<string, SophiaCommandContribution>()
  const face = {
    register(contribution: SophiaCommandContribution): () => void {
      if (contributions.has(contribution.name)) {
        throw new Error(`ui-commands: duplicate contribution for /${contribution.name}`)
      }
      contributions.set(contribution.name, contribution)
      return () => {
        contributions.delete(contribution.name)
      }
    },
  }
  return { face, contributions }
}

/** 假 `layout`：记录被选中的面板 id（`selectPanel(null)` 表示回到对话）。 */
function makeLayout(): { readonly face: Record<string, unknown>; readonly selected: Array<string | null> } {
  const selected: Array<string | null> = []
  const face = {
    selectPanel(panelId: string | null): void {
      selected.push(panelId)
    },
  }
  return { face, selected }
}

/**
 * 假 effect 登记器 —— 与 `index.ts` 的 `registerEffectFor` **同契约**：
 * 立刻执行、记 disposer、返回「登记是否真的成功」。
 */
function makeEffect(): {
  readonly effect: (execute: () => void | (() => void), label: string) => boolean
  readonly effects: Array<() => void>
} {
  const effects: Array<() => void> = []
  return {
    effects,
    effect: (execute) => {
      const returned = execute()
      effects.push(typeof returned === 'function' ? returned : () => {})
      return true
    },
  }
}

/** 收集一次调用的控制台输出（错误路径的断言用）。 */
function captureConsole(): { readonly errors: string[]; readonly warnings: string[]; restore: () => void } {
  const errors: string[] = []
  const warnings: string[] = []
  const error = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    errors.push(args.map(String).join(' '))
  })
  const warn = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    warnings.push(args.map(String).join(' '))
  })
  return { errors, warnings, restore: () => { error.mockRestore(); warn.mockRestore() } }
}

// ────────────────────────────────────────────────────────────────────────────
// 1. 命令名（主人点名的契约）
// ────────────────────────────────────────────────────────────────────────────

describe('t6 · 斜杠命令名', () => {
  it('命令名逐字等于主人点名的那条 —— 与包名同形', () => {
    // ⚠ 这里写**字面量**是有意的：它是**主人的验收标准**（命令名与包名同形），
    //   不是从别处派生的值。写成一个常量比较会变成恒真（比较自己）。
    expect(SOPHIA_SLASH_COMMAND).toBe('sophia-agent-entities')
  })

  it('名字能过宿主两面共用的语法检查（不是「猜它合法」）', () => {
    // 判据来源：`@deepseek-ai/dsh-commands/lib/index.js:71`
    //   `const COMMAND_NAME = /^[a-z][a-z0-9_-]*$/u`
    // （浏览器面解析同一形状的 token，见 `dsh-client-ui-commands/lib/client.js:479-483`）。
    // 这条把「名字合法」从**假设**变成**检查**：将来谁把命令名改成含大写/下划线
    // 开头的值，注册会在宿主的 `normalizeDefinition` 里抛 `TypeError`
    //（同文件 `:143`），而那时用户只看到「命令没了」。
    expect(SOPHIA_SLASH_COMMAND).toMatch(/^[a-z][a-z0-9_-]*$/)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 2. 注册的形状与 run 的行为
// ────────────────────────────────────────────────────────────────────────────

describe('t6 · 注册形状与「到面板」', () => {
  it('注册到命令面：名字、action 类型、thunk 描述、available 恒真', () => {
    const { face, contributions } = makeCommandUi()
    const { effect } = makeEffect()
    const describeText = '打开索菲亚团队面板'

    const mounted = mountSophiaSlashCommand(effect, {
      panelId: 'panel-x',
      get: (name) => (name === 'commandUi' ? face : undefined),
      describe: () => describeText,
    })

    expect(mounted.outcome).toBe('registered')
    const contribution = contributions.get(SOPHIA_SLASH_COMMAND)
    expect(contribution).toBeDefined()
    // 名字必须逐字是命令名（宿主按它去重与匹配）。`register` 收到的就是它。
    expect(contribution?.name).toBe(SOPHIA_SLASH_COMMAND)
    // `ui.kind` 必须是 `'action'`：只有 action 会在**浏览器里**直接跑
    //（`dsh-client-ui-commands/lib/client.js:765-768`），
    // 其余 kind 会去开会话弹窗（`:770-773`）—— 那就到不了面板。
    expect(contribution?.ui.kind).toBe('action')
    expect(typeof contribution?.ui.run).toBe('function')
    // `description` 必须是**函数**（宿主按 `description()` 取用，`:651`）。
    expect(typeof contribution?.description).toBe('function')
    expect(contribution?.description()).toBe(describeText)
    // 面板是全局槽位 ⇒ 任何会话都可用（与 `/model` 的判据不同，见源码注释）。
    expect(contribution?.available({ sessionId: 'whatever' })).toBe(true)
  })

  it('`ui.run()` 把**传入的**面板 id 交给 `layout.selectPanel`（含反恒真对照）', () => {
    // ⚠ 反恒真设计：用**两个不同的** panelId 各注册一次、各跑一次 run。
    //   若实现里硬编码了 'sophia'，第二次（'panel-zeta'）会拿到 'sophia' ⇒ 本条红。
    //   只跑一次的话，「传进去的值」与「实现里的字面量」恰好相同时这条是**恒真**的。
    const first = makeLayout()
    const second = makeLayout()
    const uiA = makeCommandUi()
    const uiB = makeCommandUi()
    const { effect } = makeEffect()

    mountSophiaSlashCommand(effect, {
      panelId: 'panel-alpha',
      get: (name) => (name === 'commandUi' ? uiA.face : name === 'layout' ? first.face : undefined),
      describe: () => 'a',
    })
    mountSophiaSlashCommand(effect, {
      panelId: 'panel-zeta',
      get: (name) => (name === 'commandUi' ? uiB.face : name === 'layout' ? second.face : undefined),
      describe: () => 'b',
    })

    uiA.contributions.get(SOPHIA_SLASH_COMMAND)?.ui.run({ sessionId: 's1' })
    uiB.contributions.get(SOPHIA_SLASH_COMMAND)?.ui.run({ sessionId: 's2' })

    expect(first.selected).toEqual(['panel-alpha'])
    expect(second.selected).toEqual(['panel-zeta'])
  })

  it('`description` 是**每次求值**的 thunk（语言切换后菜单文案才会跟上）', () => {
    // 依据：宿主在候选合成时调 `contribution.description()`（`client.js:651`），
    // 不是注册那一刻取一次 —— 若这里返回的是字符串，语言切换后菜单里仍是旧文案。
    // 判据：同一个 thunk 调两次必须求值两次（返回值递增），证明它不是缓存的值。
    const { face, contributions } = makeCommandUi()
    const { effect } = makeEffect()
    let n = 0
    mountSophiaSlashCommand(effect, {
      panelId: 'p',
      get: (name) => (name === 'commandUi' ? face : undefined),
      describe: () => {
        n += 1
        return `call-${n}`
      },
    })
    const registered = contributions.get(SOPHIA_SLASH_COMMAND)
    expect(registered?.description()).toBe('call-1')
    expect(registered?.description()).toBe('call-2')
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 3. 失败路径：都不抛、都如实进 console
// ────────────────────────────────────────────────────────────────────────────

describe('t6 · 失败路径不抛、如实报告', () => {
  it('`commandUi` 缺失 ⇒ outcome = service-missing', () => {
    const { effect } = makeEffect()
    const mounted = mountSophiaSlashCommand(effect, {
      panelId: 'p',
      get: () => undefined,
      describe: () => 'x',
    })
    expect(mounted.outcome).toBe('service-missing')
    expect(mounted.detail).toContain('commandUi')
  })

  it('effect 登记失败 ⇒ outcome = effect-unavailable（且不误报成注册成功）', () => {
    const { face, contributions } = makeCommandUi()
    const mounted = mountSophiaSlashCommand(() => false, {
      panelId: 'p',
      get: (name) => (name === 'commandUi' ? face : undefined),
      describe: () => 'x',
    })
    expect(mounted.outcome).toBe('effect-unavailable')
    // 关键：effect 早退 ⇒ 回调从未执行 ⇒ 命令面里**没有**这条命令（不谎报）。
    expect(contributions.size).toBe(0)
  })

  it('`commandUi.register` 抛（同名冲突）⇒ outcome = register-threw，且不抛出去', () => {
    // 真实行为：同名时宿主抛 `ui-commands: duplicate contribution for /X`
    //（`dsh-client-ui-commands/lib/client.js:556`）。
    const { face } = makeCommandUi()
    const { effect } = makeEffect()
    const args = {
      panelId: 'p',
      get: (name: string): unknown => (name === 'commandUi' ? face : undefined),
      describe: () => 'x',
    }
    expect(mountSophiaSlashCommand(effect, args).outcome).toBe('registered')
    // 第二次注册同名 —— 真实 `register` 抛，本函数必须**就地收住**并如实回报
    //（不能让它穿到 `apply` 的 catch：那会把「命令没挂」放大成「界面半挂」）。
    const second = mountSophiaSlashCommand(effect, args)
    expect(second.outcome).toBe('register-threw')
    expect(second.detail).toContain('duplicate')
  })

  it('`layout` 缺失 ⇒ run 不抛，进 console.error（不是静默什么都不做）', () => {
    const { face, contributions } = makeCommandUi()
    const { effect } = makeEffect()
    const captured = captureConsole()
    try {
      // 只有 commandUi，**没有** layout —— 正是「布局插件没装/还没到」那条路径。
      mountSophiaSlashCommand(effect, {
        panelId: 'p',
        get: (name) => (name === 'commandUi' ? face : undefined),
        describe: () => 'x',
      })
      expect(() => contributions.get(SOPHIA_SLASH_COMMAND)?.ui.run({ sessionId: 's' })).not.toThrow()
      expect(captured.errors.join('\n')).toContain('layout 服务不可用')
    } finally {
      captured.restore()
    }
  })

  it('面板未注册（`selectPanel` 抛）⇒ run 不抛，进 console.error 并给出补救', () => {
    // 真实行为：`dsh-client-ui-layout/lib/client.js:413` 在
    // `hasMainPanel(panelId)` 为假时抛
    // `layout.selectPanel: main panel "…" is not registered`。
    const captured = captureConsole()
    try {
      const layout = {
        selectPanel: (): void => {
          throw new Error(`layout.selectPanel: main panel "p" is not registered`)
        },
      }
      // 直接测底层函数（命令面的 run 只是它的无参包装）。
      expect(() => openSophiaPanel((name) => (name === 'layout' ? layout : undefined), 'p')).not.toThrow()
      expect(captured.errors.join('\n')).toContain('尚未注册')
      // 补救提示必须在 —— 用户看不到这个 console，但排障的人要靠它知道还有侧边栏入口。
      expect(captured.errors.join('\n')).toContain('侧边栏')
    } finally {
      captured.restore()
    }
  })

  it('形状收窄：`asCommandUi` / `asLayout` 对非形状值返回 undefined（不抛）', () => {
    for (const bad of [undefined, null, 'string', 42, {}]) {
      expect(asCommandUi(bad)).toBeUndefined()
      expect(asLayout(bad)).toBeUndefined()
    }
    expect(asCommandUi({ register: () => {} })).toBeDefined()
    expect(asLayout({ selectPanel: () => {} })).toBeDefined()
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 4. 可逆性
// ────────────────────────────────────────────────────────────────────────────

describe('t6 · 可逆', () => {
  it('effect 的 disposer 跑完 ⇒ 命令从命令面收回（停用插件不留残留）', () => {
    const { face, contributions } = makeCommandUi()
    const { effect, effects } = makeEffect()
    mountSophiaSlashCommand(effect, {
      panelId: 'p',
      get: (name) => (name === 'commandUi' ? face : undefined),
      describe: () => 'x',
    })
    expect(contributions.size).toBe(1)
    for (const dispose of effects) dispose()
    expect(contributions.size).toBe(0)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 5. 接线：`apply()` 真的把它接上（不是「函数写了但没人调」）
// ────────────────────────────────────────────────────────────────────────────

describe('t6 · 挂载层接线（`src/client/index.ts`）', () => {
  /** 假的浏览器全局（最小面：`slots` 与样式注入用到的部分）。 */
  let restoreGlobals: (() => void) | undefined

  beforeEach(() => {
    const globals = globalThis as { window?: unknown; document?: unknown }
    const savedWindow = globals.window
    const savedDocument = globals.document
    const inserted = new Set<string>()
    globals.window = {}
    globals.document = {
      createElement: (): unknown => ({ id: '', textContent: '', remove: (): void => {} }),
      head: { appendChild: (node: { id: string }): void => { inserted.add(node.id) } },
      getElementById: (id: string): unknown => (inserted.has(id) ? { id, textContent: '' } : null),
    }
    restoreGlobals = () => {
      globals.window = savedWindow
      globals.document = savedDocument
    }
  })

  afterEach(() => {
    restoreGlobals?.()
    restoreGlobals = undefined
    const win = globalThis.window as { __SOPHIA_CLIENT__?: unknown } | undefined
    if (win !== undefined) delete win.__SOPHIA_CLIENT__
  })

  /**
   * 造一个假 client ctx，**带 `inject`**（`tests/client/panel.spec.tsx` 的
   * `makeCtx` 没有它 —— 那个夹具是给槽位用的，这里的接线需要服务就绪注入）。
   */
  function makeInjectedCtx(services: Record<string, unknown>): {
    readonly ctx: Record<string, unknown>
    readonly injections: string[][]
  } {
    const injections: string[][] = []
    const makeScope = (): Record<string, unknown> => ({
      get: (name: string): unknown => services[name],
      effect: (execute: () => void | (() => void)): unknown => execute(),
      inject: (deps: readonly string[], callback: (scope: unknown) => void): unknown => {
        injections.push([...deps])
        callback(makeScope())
        return () => {}
      },
    })
    return { ctx: makeScope(), injections }
  }

  function makeSlots(): Record<string, unknown> {
    return {
      register: (): (() => void) => () => {},
      inject: (_key: string, callback: () => unknown): (() => void) => {
        const returned = callback()
        // 与 `index.ts` 的 `registerEffectFor` 同一判据：是不是函数由 `typeof` 判，
        // 不信类型断言（`Function` 不能直接赋给 `() => void`，实测 TS2322）。
        return typeof returned === 'function' ? (returned as () => void) : () => {}
      },
    }
  }

  function marker(): { surfaces: Record<string, boolean>; slashCommand: { name: string; state: string; detail: string } } | undefined {
    const win = globalThis.window as { __SOPHIA_CLIENT__?: unknown } | undefined
    return win?.__SOPHIA_CLIENT__ as never
  }

  it('ctx 提供 `inject` 且 `commandUi` 在场 ⇒ 贡献真的交到命令面，状态报 registered', () => {
    const { face, contributions } = makeCommandUi()
    const layout = makeLayout()
    const { ctx, injections } = makeInjectedCtx({
      slots: makeSlots(),
      commandUi: face,
      layout: layout.face,
    })
    apply(ctx)

    // `inject` 必须**只为命令面要一次** `commandUi`（不是顺手要点别的 ——
    // 多要一个服务就等于多一个「不加载」的由头）。
    expect(injections).toEqual([['commandUi']])
    const contribution = contributions.get(SOPHIA_SLASH_COMMAND)
    expect(contribution).toBeDefined()
    // 端到端一跳：贡献的 run ⇒ 布局切到 `PANEL_ID`（不是别的 id）。
    contribution?.ui.run({ sessionId: 's' })
    expect(layout.selected).toEqual([PANEL_ID])
    expect(marker()?.slashCommand.state).toBe('registered')
    expect(marker()?.slashCommand.name).toBe(SOPHIA_SLASH_COMMAND)
  })

  it('宿主 ctx **没有** `inject` ⇒ 命令未注册，但界面照常 + 状态如实报 unsupported', () => {
    // 与 `panel.spec.tsx` 的手法是同一个形状但**不是**同一条断言：
    // 那条验「槽位照常挂上」，这条验「命令挂不上时**不谎报**、且不连累界面」。
    const { ctx } = makeInjectedCtx({ slots: makeSlots() })
    delete (ctx as { inject?: unknown }).inject
    const captured = captureConsole()
    try {
      apply(ctx)
      expect(marker()?.slashCommand.state).toBe('unsupported')
      // 界面照常：两处槽位都注册了（本改动的降级**不**连累既有能力）。
      expect(marker()?.surfaces['sidebarEntry']).toBe(true)
      expect(marker()?.surfaces['mainPanel']).toBe(true)
      // 不静默：这条降级必须有可见报告（否则排障时只看到「命令没了」）。
      expect(captured.warnings.join('\n')).toContain('ctx.inject 不可用')
    } finally {
      captured.restore()
    }
  })

  it('`inject` 在场但 `commandUi` 没到 ⇒ 状态如实报 service-missing（不是 registered）', () => {
    const { ctx } = makeInjectedCtx({ slots: makeSlots() })
    const captured = captureConsole()
    try {
      apply(ctx)
      expect(marker()?.slashCommand.state).toBe('service-missing')
      expect(captured.warnings.join('\n')).toContain('斜杠命令未挂上')
    } finally {
      captured.restore()
    }
  })
})
