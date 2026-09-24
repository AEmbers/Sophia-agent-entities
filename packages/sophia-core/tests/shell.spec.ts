/**
 * t1 · 插件外壳的**接线契约**测试。
 *
 * 这些断言钉住的是**已实测的 DSH 契约**（不是「跑一遍不报错就算过」）：
 *
 * | 断言 | 若它失守，真实故障是什么 |
 * |---|---|
 * | `dsh.bundle.patch` 指向的文件存在 | DSH 启动读不到 patch，插件静默不加载 |
 * | `exports["./client"]` 存在且文件真的在 | client-modules 抛 "declares dsh.client but exports no ./client bundle" |
 * | `dsh.client.platform === "web"` | `resolveMeta` 判 `platform !== "web"` → `return null`，UI 永不出现 |
 * | 每个 exports 的 types/default 文件存在 | loader import 失败 → 整棵树报错 |
 * | patch 里有裸包名行与 `/host` 行 | 少裸名行 → 浏览器半永远发现不了；少 host 行 → 宿主功能不挂载 |
 * | client bundle 的 id 逐字等于包名 | **宿主半边已正常加载**，只在浏览器里静默找不到 |
 * | host.apply 在服务缺失/抛错时不抛 | 一行失败拖垮 loader 整棵树 |
 * | effect 的 disposer 真的回收 | 停用/更新插件后残留路由与提示词段 |
 *
 * 每条都做过**反向自检**（把对应字段/行为改坏 → 断言必须变红）；变异清单与实测
 * 退出码见 `docs/`（t1 交付说明）。一个从未红过的断言与没有断言等价。
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { describe, expect, it, vi } from 'vitest'
import { parse as parseYaml } from 'yaml'

import pkg from '../package.json'

/** 包根目录（本文件在 tests/ 下）。 */
const PKG_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

/**
 * 构建产物目录是否存在。
 *
 * ⚠ `lib/` 是**构建产物且被 .gitignore 忽略**（与上游 dsh-agent-teams 一致：
 * 它也不入库 lib/，靠 `prepack` 现场构建）。因此「刚 clone 下来没构建」是
 * 一个**必然而非异常**的状态。
 *
 * 这里刻意**不静默跳过**依赖产物的断言：t1 的验收物里本就包含构建产物，
 * 产物不在时让它**明确地红**、并把补救命令写进错误，比给一条绿色假象强
 * （本仓已有 `.md 被扩展名过滤 → 0 files reviewed` 的假绿先例）。
 */
const BUILD_PRESENT = existsSync(join(PKG_ROOT, 'lib'))

/** 产物缺失时的统一说法：把「怎么修」写进错误本身。 */
const NEEDS_BUILD = 'lib/ 不存在（构建产物不入库）—— 先跑：pnpm --filter @sophia/core run build'

/**
 * 把 `lib/` 下的产物文件名转成可 `import()` 的 URL。
 *
 * ## ⚠ 为什么必须绕这一下（这是修一个真实缺陷，别改成字面量）
 *
 * **tsc 会解析模块说明符**，而 `lib/` **不在** `tsconfig.json` 的
 * `include: ["src","tests",…]` 里 ⇒ 新鲜 clone（产物不入库，`.gitignore:12`）
 * 上会直接 `TS2307: Cannot find module '../lib/host.js'` —— 实测过。
 *
 * ## ⚠⚠ 一个**很常见但我实测推翻**的误判
 *
 * 「把静态 `import` 改成 `await import('…')` 就不会被解析」是**错的**：
 * tsc 对**字面量** dynamic import **同样解析**。实测（同配置、路径不存在）：
 *
 * | 写法 | 结果 |
 * |---|---|
 * | 静态 `import x from '../lib/y.js'` | TS2307 ✗ |
 * | 字面量 `await import('../lib/y.js')` | **TS2307 ✗** |
 * | 计算出的 specifier（本函数） | exit 0 ✓ |
 *
 * ⇒ 只有**计算出的 specifier** 才豁免解析。本函数即为此存在；
 * 它的"字面量"部分只出现在**运行期**求值的字符串里，类型检查看不到。
 *
 * 好处是**双赢**：类型检查不再依赖 `lib/` 是否构建过，而运行期仍**真的**加载产物
 * ——「产物驱动」这条测试意图一点没丢（`BUILD_PRESENT` 守卫照旧管运行期）。
 */
function libUrl(fileName: string): string {
  return pathToFileURL(join(PKG_ROOT, 'lib', fileName)).href
}

/** 把一个 exports 子路径解析成包内相对路径。 */
function exportTarget(subpath: string): string {
  const entry = (pkg.exports as Record<string, unknown>)[subpath]
  if (typeof entry === 'string') return entry
  if (typeof entry === 'object' && entry !== null) {
    const def = (entry as { default?: unknown }).default
    if (typeof def === 'string') return def
  }
  throw new Error(`exports["${subpath}"] 形状不是 string / {default: string}`)
}

/**
 * 剥掉 `//` 行注释与块注释，只留可执行代码。
 *
 * 为什么必须这么做：本仓的源码注释里**正当引用**了不该出现的 import 反例
 * （如「不得 `import type { Context } from '@deepseek-ai/cordis'`」）。
 * 直接扫原文会把「文档里提到它」读成「代码用了它」——
 * 这与本仓已记录的「markdown 强调标记夹在词中间会让逐字扫描既漏真命中、
 * 又误判假冲突」是同一类问题。
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\s\/\/.*$/gm, '')
}

// ── 假宿主环境（用于验证 host 半的**行为**，不只是形状）──────────────

/** 假响应对象。 */
interface FakeRes {
  status: number
  body: string
  writeHead(status: number, headers?: Record<string, string>): void
  end(body?: string): void
}

/** 假 webserver 路由行。 */
interface FakeRoute {
  path: string
  handler(req: unknown, res: FakeRes): void
}

/** 假 systemPrompt 段。 */
interface FakeSection {
  name: string
  text: string
}

/**
 * 构造一个假宿主 ctx 与其可观测状态。
 *
 * 关键：真实服务实现**绑定到本次调用的数组**（不是共享的），
 * 否则 A 主机注册的路由会落进 B 主机的数组里，测试就会说谎。
 *
 * @param opts - `effectThrows` 模拟 effect 自身抛错（验证 try/catch 兜底）。
 */
function makeHost(opts: { effectThrows?: boolean } = {}) {
  const routes: FakeRoute[] = []
  const sections: FakeSection[] = []
  const effects: Array<() => void> = []
  const listeners: Array<(name: unknown) => void> = []
  /** 当前「已提供」的服务；测试用 set/provide 控制到齐时机与形状。 */
  const services: Record<string, unknown> = {}

  /** 形状合法的 webserver（register 返回 disposer，与真实服务一致）。 */
  const webServer = {
    register(route: FakeRoute) {
      routes.push(route)
      return () => {
        const i = routes.indexOf(route)
        if (i >= 0) routes.splice(i, 1)
      }
    },
  }
  /** 形状合法的 systemPrompt（section 返回 disposer）。 */
  const systemPrompt = {
    section(section: FakeSection) {
      sections.push(section)
      return () => {
        const i = sections.indexOf(section)
        if (i >= 0) sections.splice(i, 1)
      }
    },
  }

  const ctx = {
    get: (name: string): unknown => services[name],
    effect: (execute: () => void | (() => void)): unknown => {
      if (opts.effectThrows === true) throw new Error('effect exploded')
      const disposer = execute()
      effects.push(typeof disposer === 'function' ? disposer : () => {})
      return disposer
    },
    on: (event: string, listener: (name: unknown) => void): void => {
      if (event === 'internal/service') listeners.push(listener)
    },
  }

  return {
    ctx,
    routes,
    sections,
    effects,
    webServer,
    systemPrompt,
    /** 把一个服务设成任意形状（用于验证「形状不对要判不可用」）。 */
    set(name: string, value: unknown): void {
      services[name] = value
    },
    /**
     * 让一个服务「到齐」并触发 internal/service 监听（用于验证迟到挂载）。
     * `httpServer` 也要支持：它是 rc.1 的旧键，双键兼容是 OCR 复核 [2]/[3] 的修复点。
     */
    provide(name: 'webServer' | 'httpServer' | 'systemPrompt'): void {
      services[name] = name === 'systemPrompt' ? systemPrompt : webServer
      for (const listener of listeners) listener(name)
    },
    /**
     * **只派发事件、不动服务**。
     *
     * 为什么必须有它（这是被变异测试抓出来的，很值得记）：
     * `provide()` 会把服务替换成**健康的那份假实现**，所以拿它去测
     * 「服务形状不对/会抛时迟到挂载怎么办」是**空转的** —— 事件触发时
     * 服务早被换成好的了，抛错路径根本没跑到。
     * 第一版的两条「迟到挂载抛错被拦住」用例就是这么假绿的：
     * 去掉 host.ts 监听器里的 try/catch 后它们**仍然全绿**（实测）。
     * 用本方法就能在服务保持坏形状的前提下触发迟到路径。
     */
    fire(name: string): void {
      for (const listener of listeners) listener(name)
    },
  }
}

/** `/status` 路由的路径（本文件的多数用例都在验它）。 */
const STATUS_PATH = '/api/sophia/status'

/**
 * 按 path 取一条已注册的路由。
 *
 * ## ⚠ 为什么不再写 `host.routes[0]` / `toHaveLength(1)`
 *
 * 宿主从**1 条**路由扩到**4 条**（`/status` + `/view` + `/avatar` + `/member/model`，
 * 后三条是 t1 的数据路由）之后，本文件里「第 0 条是 `/status`」的**位置**断言与
 * 「只有 1 条」的**计数**断言双双失效 —— 实测一次红 12 条（`expected … to have a
 * length of 1 but got 4`、`expected 5 to be 2`）。位置与总数都是**实现细节**，
 * 而用例真正要断言的是「`/status` 挂上了、它答什么」。
 * 按 path 找是**结构性**的：以后再加路由，本文件不会连带变红。
 *
 * 「一共有几条路由」这件事由 `tests/host-routes.spec.ts` 专门负责 ——
 * 一份知识只在一个地方断言，两边不要互相复制。
 *
 * @param host - `makeHost()` 造的假宿主。
 * @param path - 目标路径，默认 `/status`。
 * @returns 找到的路由（找不到直接抛，报出实际有哪些，便于定位）。
 */
function routeOf(host: ReturnType<typeof makeHost>, path: string = STATUS_PATH): FakeRoute {
  const found = host.routes.find((route) => route.path === path)
  if (found === undefined) {
    throw new Error(`未注册路由 ${path}；现有：${host.routes.map((r) => r.path).join(', ') || '(空)'}`)
  }
  return found
}

/** 造一个假响应，并在回调后读回它。 */
function callRoute(route: FakeRoute, req: unknown = {}): FakeRes {
  const res: FakeRes = {
    status: 0,
    body: '',
    writeHead(status) {
      this.status = status
    },
    end(body) {
      this.body = body ?? ''
    },
  }
  route.handler(req, res)
  return res
}

describe('t1 · 插件外壳接线契约（静态）', () => {
  it('dsh.bundle.patch 存在且能被 YAML 解析成 insert 列表', () => {
    // 反恒真：把 cordis.patch.yml 改名/删掉 → 本条必须变红（实测已做）。
    expect(pkg.dsh.bundle.patch).toBe('./cordis.patch.yml')
    const patchPath = join(PKG_ROOT, pkg.dsh.bundle.patch)
    expect(existsSync(patchPath)).toBe(true)

    const doc = parseYaml(readFileSync(patchPath, 'utf8')) as unknown
    expect(Array.isArray(doc)).toBe(true)
    const layers = doc as Array<{ insert?: Array<{ id?: string; name?: string }> }>
    const inserted = layers.flatMap((layer) => layer.insert ?? [])
    expect(inserted.length).toBeGreaterThanOrEqual(2)
    // 每行都要有 id 与 name：缺一个 DSH 就报不出可定位的行。
    for (const row of inserted) {
      expect(typeof row.id).toBe('string')
      expect(typeof row.name).toBe('string')
    }
    const names = inserted.map((row) => row.name)
    // 裸包名行是 client 半的发现锚点：client-modules 的 exactPackageSpecifier
    // 只认两段（@scope/name），三段子路径会被整行跳过。
    // 反恒真：把裸名行写成 @sophia/core/typo → 本条必须变红（实测已做）。
    expect(names).toContain(pkg.name)
    // host 行是真正的宿主半边。
    expect(names).toContain(`${pkg.name}/host`)
  })

  it('dsh.client 声明齐全，且 exports["./client"] 真的落在文件上', () => {
    // 三条都是 dsh-client-modules 的硬门槛，缺一即「UI 静默不出现」：
    //   parseDshClient 要求 platform 是 string；
    //   resolveMeta 要求 platform === 'web' 否则 return null；
    //   clientExportOf 要求 exports['./client'] 存在，否则抛错。
    expect(typeof pkg.dsh.client).toBe('object')
    // 反恒真：platform 改 'desktop' → 本条必须变红（实测已做）。
    expect(pkg.dsh.client.platform).toBe('web')

    const rel = exportTarget('./client')
    expect(rel).toMatch(/\.js$/)
    // 反恒真：删掉 lib/client.js（不重跑构建）→ 本条必须变红（实测已做）。
    expect(existsSync(join(PKG_ROOT, rel))).toBe(true)
  })

  it('每个 exports 子路径的 types 与 default 都真实存在', () => {
    // 专治「构建 exit 0 但 exports 指到不存在的路径」——
    // 本任务实测踩到过：tsc 的 declarationDir 换成 outDir 后 .d.ts 落点变了，
    // 而 exports 里还写着旧路径。
    expect(BUILD_PRESENT, NEEDS_BUILD).toBe(true)
    const subpaths = Object.keys(pkg.exports as Record<string, unknown>)
    expect(subpaths).toContain('./host')
    expect(subpaths).toContain('./client')
    expect(subpaths).toContain('.')

    for (const subpath of subpaths) {
      const entry = (pkg.exports as Record<string, unknown>)[subpath]
      if (typeof entry !== 'object' || entry === null) continue
      const targets = entry as { types?: unknown; default?: unknown }
      for (const [field, value] of Object.entries(targets)) {
        if (typeof value !== 'string') continue
        expect(existsSync(join(PKG_ROOT, value)), `${subpath}.${field} → ${value} 不存在`).toBe(true)
      }
    }
  })

  it('字符串型 exports 子路径也真实存在（上一条的循环会跳过它们）', () => {
    // OCR 复核 [6]：上一条的循环用 `if (typeof entry !== 'object') continue`
    // 跳过了**字符串型**子路径（如 `"./cordis.patch.yml": "./cordis.patch.yml"`）。
    // 那是布局回归最不容易被发现的一类 —— 没人跳过它，也就没人发现它断了。
    // 这里把字符串型子路径单独补上。
    expect(BUILD_PRESENT, NEEDS_BUILD).toBe(true)
    const stringSubpaths = Object.entries(pkg.exports as Record<string, unknown>)
      .filter(([, value]) => typeof value === 'string') as Array<[string, string]>
    // 反恒真：删掉 "./cordis.patch.yml" 这一行 → 本条必须变红（已实测）。
    expect(stringSubpaths.length, 'exports 里应当有字符串型子路径').toBeGreaterThan(0)
    for (const [subpath, target] of stringSubpaths) {
      // `./package.json` 指向包根自己，同样必须存在。
      expect(existsSync(join(PKG_ROOT, target)), `exports["${subpath}"] → ${target} 不存在`).toBe(true)
    }
    // dsh.bundle.patch 与 exports 里的同一路径必须一致，否则「装得进、加载不到」。
    const patchViaExports = stringSubpaths.find(([sub]) => sub === './cordis.patch.yml')?.[1]
    expect(patchViaExports).toBe(pkg.dsh.bundle.patch)
  })

  it('engines 下限覆盖 node:sqlite 的免 flag 线（HIGH：这条链断了整块插件消失）', () => {
    // OCR 复核 [5]（HIGH）的**核心事实**在这里被钉住，理由写全：
    //   · `src/ledger.ts` 直接 `import { DatabaseSync } from 'node:sqlite'`；
    //   · 该模块经 `src/index.ts` → `src/plugin.ts` 的 re-export，落在**裸包名行**
    //     的加载链上，而裸包名行是浏览器半的**唯一发现锚点**；
    //   · `dsh-client-modules` 的 `processOne()` 跳过 `entry.fiber === undefined`
    //     的行（`lib/index.js:778`）⇒ 这一行 import 失败时，宿主半与浏览器半
    //     **一起**消失 —— 不是降级，是整块不出现。
    // 因此 `engines` 的下限是承重结构，不是装饰。
    //
    // 为什么 >=24.0.0 是安全的：Node 官方 sqlite 文档 History 记
    // 「v23.4.0, v22.13.0 | SQLite is no longer behind --experimental-sqlite」
    // （https://nodejs.org/api/sqlite.html），两条免 flag 线都**低于** 24.0.0。
    // ⇒ 任何满足本 engines 的运行时都无需 flag。
    //
    // ⚠ 本用例**只断言下限**，不假装能验证「运行时真的能 import sqlite」——
    // 后者由本文件里对产物的真实 import 在跑测时证明。
    const nodeRange = (pkg.engines as Record<string, string | undefined>).node
    // `noUncheckedIndexedAccess` 让上面这次索引取值为 `string | undefined`，
    // 所以先收窄再喂给 exec（这正是 verify 命令 2 抓到的那处 TS2345）。
    expect(typeof nodeRange, 'engines.node 必须是字符串').toBe('string')
    const lower = Number(/>=(\d+)\./.exec(nodeRange as string)?.[1])
    // 反恒真：把 engines.node 改成 ">=20.0.0"（低于免 flag 线）→ 本条必须变红（已实测）。
    expect(lower, `engines.node="${nodeRange}" 的下界需 >= 24（低于免 flag 线时该插件整块不加载）`)
      .toBeGreaterThanOrEqual(24)
  })

  it('client bundle 是 __ModuleLoader__ 闭包工厂，且 id 逐字等于包名', () => {
    // 这条最值钱：id 不一致时**宿主半边已经正常加载**，只在浏览器里静默找不到。
    expect(BUILD_PRESENT, NEEDS_BUILD).toBe(true)
    const source = readFileSync(join(PKG_ROOT, 'lib/client.js'), 'utf8')
    expect(source).toContain('window.__ModuleLoader__.load')
    expect(source).toContain(`id: ${JSON.stringify(pkg.name)}`)
    // CJS 闭包外壳：三段缺一，loader 就 materialize 不出 exports。
    expect(source).toContain('factory: (require) =>')
    expect(source).toContain('return module.exports')
  })

  it('tsdown 的 entryFileNames 与 exports["./client"] 指向同一路径', () => {
    // 两者分居两个文件；改名就会静默错位，所以把「必须一致」钉成断言。
    const cfg = readFileSync(join(PKG_ROOT, 'tsdown.config.ts'), 'utf8')
    expect(cfg).toContain("entryFileNames: 'client.js'")
    expect(exportTarget('./client')).toBe('./lib/client.js')
  })

  it('两条 loader 行指向的入口都能在真实运行时里 import（含领域库）', async () => {
    // 直接 import 产物：证明「构建出来的东西」，而不是「源码看起来对」。
    expect(BUILD_PRESENT, NEEDS_BUILD).toBe(true)
    const stub = await import(libUrl('plugin.js'))
    const host = await import(libUrl('host.js'))
    expect(typeof stub.apply).toBe('function')
    expect(Array.isArray(stub.inject)).toBe(true)
    expect(typeof host.apply).toBe('function')
    // 领域库也必须能加载（t2–t4 都从它取东西）。
    const domain = await import(libUrl('index.js'))
    expect(Object.keys(domain).length).toBeGreaterThan(0)
  })

  it('插件入口不 import 任何 @deepseek-ai/*（SPEC §1.1：本机 SDK 无 .d.ts）', () => {
    // 反恒真：在 src/plugin.ts 或 src/host.ts 里加一行
    // `import type { Context } from '@deepseek-ai/cordis'` → 本条必须变红。
    //
    // ⚠ 必须先剥掉注释：本文件头部**正当引用**了
    // `import type { Context } from '@deepseek-ai/cordis'` 作为反例说明，
    // 直接扫源码会把「文档里提到它」误判成「代码用了它」——
    // 本任务第一版就这么错过一次（断言红了，而代码是对的）。
    for (const file of ['src/plugin.ts', 'src/host.ts']) {
      const code = stripComments(readFileSync(join(PKG_ROOT, file), 'utf8'))
      expect(code).not.toMatch(/@deepseek-ai\//)
    }
  })

  it('裸名行入口（plugin.ts）re-export 领域库（下游 @sophia/core 契约不能被顶掉）', () => {
    // ⚠ 这条断言在 OCR 复核 [7] 之后被**反向改写**过，记下原因免得以后又被改回去：
    //
    // 第一版把 `exports["."]` 做成一个零 import 的空壳、领域库挪去 `./core`。
    // 那样 `import { ... } from '@sophia/core'` 拿不到任何领域符号 ——
    // 而 `src/types/index.ts` 与 `docs/SPEC-sophia-core.md` 都写明
    // 「下游一律从 `@sophia/core` 导入」，等于给 t2–t5 埋一个**静默**的坑。
    //
    // 改回「re-export 领域库」之后，下面这条**旧断言必须被删掉**：
    //   expect(code).not.toMatch(/^\s*import\b/m)   ← 已废除，勿恢复
    // 它当时守的性质（启动路径不拉依赖）确实是好的，但代价是毁掉对外契约，
    // 而实测 `lib/index.js` 在真实宿主运行时（DSH Desktop.exe +
    // ELECTRON_RUN_AS_NODE=1，node=24.18.1）import 成功、`node:sqlite` 可用、
    // `ledger.ts` 模块作用域无副作用 ⇒ 那个代价换来的收益并不成立。
    const code = stripComments(readFileSync(join(PKG_ROOT, 'src/plugin.ts'), 'utf8'))
    // 反恒真：删掉这行 re-export → 本条必须变红（已实测）。
    expect(code).toMatch(/export\s+\*\s+from\s+['"]\.\/index\.ts['"]/)
    // 插件三元组仍必须齐全：loader 靠它们认这一行。
    expect(code).toMatch(/export const name\b/)
    expect(code).toMatch(/export const inject\b/)
    expect(code).toMatch(/export function apply\b/)
  })

  it('exports["."] 实测同时给出领域符号与插件三元组（不是空壳）', async () => {
    // 上一条查源码，这一条查**产物**：证明构建出来的入口真的是那个形状。
    // 两条都留是有意的 —— tsc 的 outDir 换过一次，源码对而 exports 指错路径
    // 是本任务真实踩过的坑。
    expect(BUILD_PRESENT, NEEDS_BUILD).toBe(true)
    const entry = await import(libUrl('plugin.js'))
    const domain = await import(libUrl('index.js'))
    // 插件三元组在（loader 要）。
    expect(typeof entry.apply).toBe('function')
    expect(Array.isArray(entry.inject)).toBe(true)
    expect(entry.name).toBe('sophia')
    // 领域符号也在（下游 t2–t5 要）。逐个比对而不是数个数：
    // 数个数会在「导出总数巧合相同」时假绿。
    const exported = Object.keys(entry)
    for (const symbol of Object.keys(domain)) {
      expect(exported, `领域符号 ${symbol} 必须能从 @sophia/core 取到`).toContain(symbol)
    }
  })

  it('领域库与插件三元组不撞名（撞了就是静默覆盖，不是报错）', async () => {
    // re-export 领域库 + 自带 name/inject/apply 之所以合法，前提是**不撞名**。
    // 撞了的话 ESM 会直接语法报错，但 CJS/打包路径可能静默取其一 ——
    // 所以钉住这条前提，别让后续往领域库里加 `apply` 时无声地毁掉插件入口。
    expect(BUILD_PRESENT, NEEDS_BUILD).toBe(true)
    const domain = await import(libUrl('index.js'))
    const reserved = ['name', 'inject', 'apply', 'Config', 'reusable']
    const collisions = reserved.filter((key) => key in domain)
    expect(collisions, `领域库占用了插件保留键：${collisions.join(', ')}`).toEqual([])
  })

  it('client 半的 PLUGIN_ID 不是源码字面量，而是构建期注入（防两处真相漂移）', () => {
    // OCR 复核 [2]：banner 的 id 是 tsdown 读 package.json 来的，
    // 而 src/client/index.ts 里若再写一份 '@sophia/core' 字面量，就是第二个真相。
    // 修复后源码只留标识符，真值在 tsdown 的 define 里从 package.json 注入。
    //
    // ⚠ 这条必须有，而且必须查**两处**：
    //   (a) 源码里不得再出现裸字面量赋值；
    //   (b) 产物里标识符必须已被替换掉（否则 bundle 会 ReferenceError）。
    // 只查 (a) 会在「define 忘了配」时假绿 —— 源码干净、产物却带着未定义变量。
    const src = stripComments(readFileSync(join(PKG_ROOT, 'src/client/index.ts'), 'utf8'))
    // 反恒真：把 PLUGIN_ID 改回 `= '@sophia/core'` 字面量 → 本条必须变红（已实测）。
    expect(src).toMatch(/export const PLUGIN_ID: string = __SOPHIA_PLUGIN_ID__/)

    expect(BUILD_PRESENT, NEEDS_BUILD).toBe(true)
    const bundle = readFileSync(join(PKG_ROOT, 'lib/client.js'), 'utf8')
    // 反恒真：删掉 tsdown.config.ts 的 define → 本条必须变红（已实测）。
    //
    // ⚠ 判据必须**剥掉注释**再找标识符：第一次写这条时直接 `not.toContain`，
    // 结果被 client/index.ts 里**正当提到**这个标识符的说明文字弄红了
    // （tsdown 保留了注释）—— 与本文件顶部 stripComments 的由来是同一类问题：
    // 「文档里提到它」不等于「代码用了它」。
    const bundleCode = stripComments(bundle)
    expect(
      bundleCode,
      'define 没生效：产物代码里还留着未定义标识符',
    ).not.toContain('__SOPHIA_PLUGIN_ID__')
    expect(bundle).toContain(`id: ${JSON.stringify(pkg.name)}`)
  })

  it('不发布不可运行的 tsc 中间产物 lib/client/index.js', () => {
    // OCR 复核 [3]：client 的 `__SOPHIA_PLUGIN_ID__` 靠 tsdown 的 define 替换，
    // 所以**先 tsc 落一份 lib/client/index.js 再打包**会让那份中间产物带着一个
    // 未定义自由变量躺进 `files: ["lib"]` —— 谁按约定路径 require 它都
    // `ReferenceError: __SOPHIA_PLUGIN_ID__ is not defined`。
    // 修法：tsdown 直接吃 `src/client/index.ts`；tsc 那一趟只出 `.d.ts`
    // （`emitDeclarationOnly`）。
    // 反恒真：把 tsconfig.build-client.json 的 emitDeclarationOnly 去掉、
    // 且 tsdown entry 改回 lib/client/index.js → 本条必须变红（已实测）。
    expect(BUILD_PRESENT, NEEDS_BUILD).toBe(true)
    expect(
      existsSync(join(PKG_ROOT, 'lib/client/index.js')),
      'lib/client/index.js 不该存在：它含未替换的 __SOPHIA_PLUGIN_ID__，却随 files:["lib"] 发布',
    ).toBe(false)
    // 但类型声明必须还在 —— exports["./client"].types 指着它。
    expect(existsSync(join(PKG_ROOT, 'lib/client/index.d.ts'))).toBe(true)
  })

  it('client 半在非浏览器环境**不谎报挂载**（window 缺失要显式判掉）', async () => {
    // OCR 复核 [5]：原先 apply 直接裸用 `window`，靠 catch 吞掉
    // `ReferenceError: window is not defined` ⇒ apply 正常返回、
    // 却没写存活标记 ⇒ 「挂上了」与「没挂上」在调用方看来无法区分。
    // 现在显式判掉并记错误日志，且不声称成功。
    expect(BUILD_PRESENT, NEEDS_BUILD).toBe(true)

    // 用真实 loader 契约把 bundle 载进来（与生产路径同形）。
    const registry = new Map<string, (require: (id: string) => unknown) => { apply?: unknown }>()
    const savedWindow = (globalThis as { window?: unknown }).window
    ;(globalThis as { window?: unknown }).window = {
      __ModuleLoader__: {
        load(record: { id: string; factory: (require: (id: string) => unknown) => { apply?: unknown } }) {
          registry.set(record.id, record.factory)
        },
      },
    }
    try {
      await import(pathToFileURL(join(PKG_ROOT, 'lib/client.js')).href)
      const factory = [...registry.values()][0]
      expect(factory).toBeDefined()
      const mod = factory!((id) => { throw new Error(`unexpected require ${id}`) })
      expect(typeof mod.apply).toBe('function')

      // 现在把 window 拿掉，模拟非浏览器环境。
      delete (globalThis as { window?: unknown }).window
      const errors: unknown[] = []
      const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
        errors.push(args)
      })
      try {
        // 反恒真：去掉 client/index.ts 里的 `typeof window === 'undefined'` 判断
        // → errors 会是 0（异常被下面的 catch 吞成一条不同文案的日志），
        //   本条断言「日志里明说未挂载」必须变红（已实测）。
        expect(() => (mod.apply as (c: unknown) => void)({})).not.toThrow()
        expect(errors, '非浏览器环境必须留下一条明确的「未挂载」日志').toHaveLength(1)
        expect(String((errors[0] as unknown[])[0])).toContain('未挂载')
      } finally {
        spy.mockRestore()
      }
    } finally {
      ;(globalThis as { window?: unknown }).window = savedWindow
    }
  })
})

describe('t1 · 宿主半行为（假 ctx）', () => {
  it('服务全缺时不抛错，且不注册任何东西（可降级加载）', async () => {
    // 插件外壳最要紧的一条：webServer / systemPrompt 未必在 apply 时刻就绪；
    // 此时**必须仍能加载**，否则插件整个不出现。
    // 反恒真：去掉 host.ts 的 try/catch → 本条必须变红。
    const { apply } = await import(libUrl('host.js'))
    const host = makeHost()
    expect(() => apply(host.ctx as never)).not.toThrow()
    expect(host.routes).toHaveLength(0)
    expect(host.sections).toHaveLength(0)
  })

  it('服务形状不对（空对象）时干净跳过，且**不走异常路径**', async () => {
    // 本机踩坑先例（dsh-agy-art 的 /toolstatus 就是为这个加的）：
    // 只看「有没有抛异常」会把静默失败读成成功。
    //
    // ⚠ 这条断言的第一版是**假的**：它只断言 `routes.length === 0`，
    // 而那个结果在「有守卫」与「没守卫」两种实现下**相同** ——
    // 没守卫时 `{}.register(...)` 抛 TypeError，被 apply 的外层 try/catch 吞掉，
    // 路由数同样是 0。实测记录：去掉 asWebServer 守卫后本用例**仍然全绿**，
    // 这样的断言与没有断言等价。
    // 真正的区别在**走哪条路径**：有守卫 = 判不可用后干净跳过（不报错）；
    // 没守卫 = 在 effect 回调里炸出异常、靠最外层兜底。
    // 因此这里钉住「没有走进错误分支」，它才是守卫存在的意义。
    const { apply } = await import(libUrl('host.js'))
    const errors: unknown[] = []
    const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args)
    })
    try {
      const host = makeHost()
      host.set('webServer', {})
      host.set('systemPrompt', {})
      expect(() => apply(host.ctx as never)).not.toThrow()
      expect(host.routes).toHaveLength(0)
      expect(host.sections).toHaveLength(0)
      // 反恒真：去掉 host.ts 的 asWebServer/asSystemPrompt 守卫 → 本条必须变红
      // （实测已做：报错信息为 `[sophia] host apply failed...`）。
      expect(errors, '应当判不可用后静默跳过，而不是抛错后兜底').toHaveLength(0)
      // 两个 effect 都应正常登记：证明是「跳过」而非「中断」。
      expect(host.effects).toHaveLength(2)
    } finally {
      spy.mockRestore()
    }
  })

  it('服务可用时真正注册路由与公告，路由返回如实的能力边界', async () => {
    const { apply } = await import(libUrl('host.js'))
    const host = makeHost()
    host.set('webServer', host.webServer)
    host.set('systemPrompt', host.systemPrompt)
    apply(host.ctx as never)

    // ⚠ 按 path 找、且**不绑总数**（见 routeOf 的说明）：宿主有 4 条路由是
    // 数据面的正向能力，不该被本文件的「外壳」用例钉成具体数字。
    expect(routeOf(host).path).toBe(STATUS_PATH)

    // 必须带**回环**来源：handler 有 isLoopbackRequest 门（OCR 复核 [1]），
    // 不给 req 会被判 403（这正是门在起作用的证据）。
    const res = callRoute(routeOf(host), { socket: { remoteAddress: '127.0.0.1' } })
    expect(res.status).toBe(200)
    const payload = JSON.parse(res.body) as {
      ok: boolean
      plugin: string
      phase: string
      surfaces: { host: boolean; client: string; tools: boolean; runtime: boolean }
    }
    expect(payload.ok).toBe(true)
    expect(payload.plugin).toBe('sophia')
    expect(payload.surfaces.host).toBe(true)
    // 如实回报能力边界：外壳阶段 client 还是 skeleton、tools/runtime 尚未挂载。
    // 反恒真：把 surfaces.client 改成 'ready' → 本条必须变红。
    expect(payload.surfaces.client).toBe('skeleton')
    expect(payload.surfaces.tools).toBe(false)
    expect(payload.surfaces.runtime).toBe(false)

    expect(host.sections).toHaveLength(1)
    expect(host.sections[0]?.name).toBe('plugin:sophia')
    // 公告要能在用户说「索菲亚」时把意图路由到本插件。
    expect(host.sections[0]?.text).toContain('索菲亚')
  })

  it('同一服务不重复注册（迟到事件不会挂第二份）', async () => {
    const { apply } = await import(libUrl('host.js'))
    const host = makeHost()
    host.set('webServer', host.webServer)
    host.set('systemPrompt', host.systemPrompt)
    apply(host.ctx as never)
    // 记下「apply 挂了几条」，后面断言**它不再变** —— 这比写死 1 或 4 都稳，
    // 且正是本用例要证的事（不重复注册）。
    const afterApply = host.routes.length
    expect(afterApply, 'apply 至少该挂上 /status').toBeGreaterThan(0)

    // 再触发两次内部服务事件：应保持条数不变，而不是累加。
    // 反恒真：去掉 host.ts 的 `if (registered) return` → 本条必须变红（已实测）。
    host.provide('webServer')
    host.provide('webServer')
    expect(host.routes, '重复事件不得再挂一份').toHaveLength(afterApply)
  })

  it('服务迟到时通过 internal/service 事件补挂（不靠一次性探测）', async () => {
    const { apply } = await import(libUrl('host.js'))
    const host = makeHost()
    apply(host.ctx as never)
    // apply 时服务还没到 → 什么都不挂。
    expect(host.routes).toHaveLength(0)

    // 服务到齐 → 触发事件 → 应补挂上。
    host.provide('webServer')
    expect(routeOf(host).path).toBe(STATUS_PATH)

    host.provide('systemPrompt')
    expect(host.sections).toHaveLength(1)
  })

  it('webserver.register 抛错时 apply 仍不抛（外壳失败必须被拦住）', async () => {
    // 反恒真：去掉 host.ts 的 try/catch → 本条必须变红
    // （真实后果：文件插件一行失败会让 loader 整棵树报错）。
    const { apply } = await import(libUrl('host.js'))
    const host = makeHost()
    host.set('webServer', {
      register: () => {
        throw new Error('register exploded')
      },
    })
    expect(() => apply(host.ctx as never)).not.toThrow()
  })

  it('ctx.effect 自身抛错时 apply 仍不抛', async () => {
    const { apply } = await import(libUrl('host.js'))
    const host = makeHost({ effectThrows: true })
    host.set('webServer', host.webServer)
    expect(() => apply(host.ctx as never)).not.toThrow()
  })

  it('非回环来源被 403 挡在业务分支外（回环门是代码事实，不只是注释）', async () => {
    // OCR 复核 [1]：宿主允许把 webserver 绑到 `0.0.0.0`
    // （`dsh-host-webserver/lib/index.js:141`），所以「只服务回环」必须由
    // 代码保证，而不是靠「本机恰好配的是回环」这个配置事实。
    const { apply } = await import(libUrl('host.js'))
    const host = makeHost()
    host.set('webServer', host.webServer)
    apply(host.ctx as never)
    const route = routeOf(host)

    for (const address of ['203.0.113.7', '10.0.0.5', '192.168.1.20']) {
      const res = callRoute(route, { socket: { remoteAddress: address } })
      expect(res.status, `来源 ${address} 必须被拒`).toBe(403)
      // 被拒时**不能**泄露能力面信息。
      expect(res.body).not.toContain('surfaces')
    }

    // 拿不到来源时保守拒绝（读不到 ≠ 通过，与仓库既有口径一致）。
    expect(callRoute(route, {}).status).toBe(403)
    expect(callRoute(route, { socket: {} }).status).toBe(403)
    expect(callRoute(route, { socket: { remoteAddress: 123 } }).status).toBe(403)
  })

  it('回环的各种写法都被放行（IPv4 / IPv6 / IPv4-mapped）', async () => {
    const { apply } = await import(libUrl('host.js'))
    const host = makeHost()
    host.set('webServer', host.webServer)
    apply(host.ctx as never)
    const route = routeOf(host)

    // 反恒真：把 isLoopbackRequest 收窄成只认 '127.0.0.1' → 后两条必须变红（已实测）。
    for (const address of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
      const res = callRoute(route, { socket: { remoteAddress: address } })
      expect(res.status, `回环来源 ${address} 应放行`).toBe(200)
      expect(JSON.parse(res.body)).toMatchObject({ ok: true, plugin: 'sophia' })
    }
    // 老字段名 connection 也要认。
    expect(callRoute(route, { connection: { remoteAddress: '127.0.0.1' } }).status).toBe(200)
  })

  it('register 返回非函数时也**不**重复注册（否则会撞 duplicate route 抛错）', async () => {
    // OCR 复核 [3]：`registered` 原先由「返回值是不是函数」反推。真实服务
    // （`dsh-host-webserver/lib/index.js:176-183`）必返回 disposer，但若它改成
    // 返回 undefined，旧写法会判没注册 ⇒ 后续事件再 mountRoute() ⇒
    // `register` 抛 `webserver: duplicate exact route "…"`（该文件 178 行）。
    const { apply } = await import(libUrl('host.js'))
    const host = makeHost()
    let calls = 0
    host.set('webServer', {
      register: () => {
        calls += 1
        // 故意返回 undefined（不是 disposer）。
        return undefined as never
      },
    })
    apply(host.ctx as never)
    // ⚠ 计数不再写死：apply 会为**每条**路由调一次 register（现在 4 条）。
    // 本用例要证的是「**后续事件不再新增调用**」，与总数无关 ——
    // 写死数字会在每次加路由时假红，而那不是本用例的知识点。
    const afterApply = calls
    expect(afterApply, 'apply 应当为每条路由各调一次 register').toBeGreaterThan(0)
    // 反恒真：把 registered 的判定改回 `typeof detach === 'function'`
    // → 本条必须变红（已实测：calls 会翻倍）。
    host.fire('webServer')
    host.fire('webServer')
    expect(calls, '已注册过就不该再 register（真实 webserver 会因重复路径抛错）').toBe(afterApply)
  })

  it('新键 register() 抛错时**回退到旧键**（选键阶段回退不够）', async () => {
    // 数象主事 转交的 MEDIUM：只在「选键」阶段回退是不够的 ——
    // 新键形状合法但 register() 抛错（真实 webserver 对重复 (kind,path)
    // 直接 throw，`dsh-host-webserver/lib/index.js:178`）时，
    // 旧键本可以顶上却被整段跳过。
    const { apply } = await import(libUrl('host.js'))
    const host = makeHost()
    let newKeyCalls = 0
    let oldKeyCalls = 0
    host.set('webServer', {
      register: () => {
        newKeyCalls += 1
        throw new Error('webserver: duplicate exact route "/api/sophia/status"')
      },
    })
    host.set('httpServer', {
      register: () => {
        oldKeyCalls += 1
        return () => {}
      },
    })
    const errors: unknown[] = []
    const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args)
    })
    try {
      apply(host.ctx as never)
      // 反恒真：把 register 移出 try（回到「只选键回退」的写法）
      // → oldKeyCalls 会是 0，本条必须变红（已实测）。
      // ⚠ 计数不写死具体条数：新键在**第一条**路由上就抛 ⇒ 整键回滚、只试了 1 次；
      // 旧键则要把它**全部**路由挂上（现在是 4 条）。本用例的知识点是
      // 「旧键有没有被顶上」，不是「一共几条路由」—— 后者归 host-routes.spec.ts。
      expect(newKeyCalls, '新键试一次就抛，应当整键回滚').toBe(1)
      expect(oldKeyCalls, '旧键必须被顶上（回退要覆盖 register 抛错）').toBeGreaterThan(0)
      expect(errors, '失败要留痕，不能静默换键').toHaveLength(1)
    } finally {
      spy.mockRestore()
    }
  })

  it('同一个 register 失败对象不随事件重复重试（无界重试已修）', async () => {
    // 数象主事 转交的 MEDIUM（已实测复现）：原先 register 抛错后
    // `registered` 保持 false ⇒ **每个** internal/service 事件都重进 mountRoute()
    // 再抛一次（实测 3 次事件 → 3 次抛错 + 3 条日志）。同一个对象不该重复试。
    const { apply } = await import(libUrl('host.js'))
    const host = makeHost()
    apply(host.ctx as never)
    let calls = 0
    host.set('webServer', {
      register: () => {
        calls += 1
        throw new Error('webserver: duplicate exact route')
      },
    })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      host.fire('webServer')
      host.fire('webServer')
      host.fire('webServer')
      // 反恒真：去掉 lastFailedServer 的判定 → calls 会是 3，本条必须变红（已实测）。
      expect(calls, '同一个失败对象只试一次').toBe(1)
    } finally {
      spy.mockRestore()
    }
  })

  it('停用后允许对同一个服务再试（复位 lastFailedServer，不是永久拉黑）', async () => {
    // 上一条的对照：`lastFailedServer` 是「别在同一轮里重复试」，
    // **不是**永久拉黑 —— 停用后重新启用（服务可能已换好的）应当能挂上。
    const { apply } = await import(libUrl('host.js'))
    const host = makeHost()
    let calls = 0
    let shouldThrow = true
    let mounted = false
    host.set('webServer', {
      register: () => {
        calls += 1
        if (shouldThrow) throw new Error('webserver: duplicate exact route')
        mounted = true
        return () => {}
      },
    })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      apply(host.ctx as never)
      // ⚠ 计数不写死：apply 会为每条路由各调一次 register，且第一条就抛 ⇒
      // 整键回滚，总共只试 1 次。（这与「路由总数」无关：抛在第一次，
      // 后面的路由根本没机会被调用。）
      const afterApply = calls
      expect(afterApply, '整键回滚 ⇒ 只在第一条上试了一次').toBe(1)
      expect(mounted).toBe(false)

      // 停用 fiber → 复位 lastFailedServer。
      for (const dispose of host.effects) dispose()

      // 之后服务变健康，再触发事件应能真正挂上。
      shouldThrow = false
      host.fire('webServer')
      // 反恒真：去掉 cleanup 里对 lastFailedServer 的复位 → calls 会停在 afterApply，本条必须变红（已实测）。
      expect(calls, '停用后应允许重试').toBeGreaterThan(afterApply)
      // ⚠ 这里断言 `mounted` 而**不是** `host.routes`：本用例的 register 是
      // 自造的假实现（为了能按需抛错），它不会往 makeHost 的 routes 数组里塞东西
      // —— 用 routes 断言会得到一个与被测逻辑无关的空数组。
      expect(mounted, '这次应真正挂上').toBe(true)
    } finally {
      spy.mockRestore()
    }
  })

  it('effect 的 disposer 真的回收路由与公告（可逆，不留侧效应）', async () => {
    const { apply } = await import(libUrl('host.js'))
    const host = makeHost()
    host.set('webServer', host.webServer)
    host.set('systemPrompt', host.systemPrompt)
    apply(host.ctx as never)
    // 不绑具体条数（路由数由 host-routes.spec.ts 负责），只要求「挂上了」。
    expect(host.routes.length, 'appl 后应当挂上路由').toBeGreaterThan(0)
    expect(routeOf(host)).toBeDefined()
    expect(host.sections).toHaveLength(1)

    // 模拟 fiber 停用：cordis 会对每个 effect 调它的 disposer。
    // 反恒真：去掉 effect cleanup 里对 detachers 的遍历 → 本条必须变红（已实测：剩 3 条）。
    for (const dispose of host.effects) dispose()
    expect(host.routes, '全部路由都必须随 effect 回收').toHaveLength(0)
    expect(host.sections).toHaveLength(0)
  })

  it('迟到挂载自身抛错时也被拦住（apply 的 try/catch 罩不到事件路径）', async () => {
    // OCR 复核 [4]（真实缺陷）：apply 的外层 try/catch 只罩得住同步的
    // `ctx.on(...)` 注册那一下。事件真正派发时是 cordis 在调监听器，
    // 此时 mountRoute()/mountSection() 里抛的异常会冲进事件派发路径。
    // 而 `section()` **确实会抛**（`dsh-system-prompt/lib/index.js:239`：
    // order 不是有限数就 throw TypeError）—— 不是假想风险。
    //
    // ⚠ 这条用例被改过两次，两次都值得记：
    //  (1) 第一版用 `provide()` 触发事件 —— 而 `provide()` 会先把服务换成
    //      健康的假实现，于是会抛的 register 早不在场，用例**空转**。
    //      变异测试（去掉监听器 try/catch）仍然全绿才发现。
    //  (2) 第二版在 `apply` 前就把坏服务装上 —— 那样 apply 里的
    //      `ctx.effect(mountRoute)` 当场就抛、被外层兜住，
    //      **执行根本走不到 `ctx.on(...)`**，监听器压根没注册，
    //      `fire()` 自然什么都不做（实测 errors=[]）。这还顺带暴露了一个
    //      真实行为：apply 中途抛错会让**后面的**注册点全部跳过（见文末说明）。
    // 正确构造：apply 时服务**没到**（mount* 早退、不抛）⇒ 监听器正常注册 ⇒
    // 之后再装上坏服务 ⇒ `fire()`（只派发、不动服务）触发迟到路径。
    const { apply } = await import(libUrl('host.js'))
    const host = makeHost()
    apply(host.ctx as never)
    expect(host.routes).toHaveLength(0)

    host.set('webServer', {
      register: () => {
        throw new Error('late register exploded')
      },
    })

    const errors: unknown[] = []
    const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args)
    })
    try {
      // 反恒真：去掉 host.ts 监听器里的 try/catch → 本条必须变红（已实测）。
      expect(() => host.fire('webServer'), '迟到挂载的异常不该冲进事件派发路径').not.toThrow()
      expect(errors, '应当记一条日志，而不是静默吞掉').toHaveLength(1)
    } finally {
      spy.mockRestore()
    }

    // 顺带钉住上面 (2) 暴露的真实行为，免得被当成 bug 反复「修」：
    // apply 期间若某个注册点抛错，外层 try/catch 会兜住，但**其后的注册点
    // 不会执行**（异常打断了 apply 的剩余语句）。这是有意的降级：
    // 保住「不拖垮 loader」这一条，代价是本次加载少挂一部分。
    // 反恒真：若改成「每个注册点独立 try/catch」→ 本条必须变红。
    const host2 = makeHost()
    host2.set('webServer', {
      register: () => {
        throw new Error('apply-time register exploded')
      },
    })
    apply(host2.ctx as never)
    // 路由没挂上（第一段就炸了），后面的 systemPrompt 段也没轮到。
    expect(host2.routes).toHaveLength(0)
    expect(host2.sections, 'apply 中途抛错会跳过其后的注册点（已知且接受）').toHaveLength(0)
  })

  it('systemPrompt.section() 抛错时迟到路径也被拦住', async () => {
    // 上一条的另一半：`section()` 会因为 order 非法而抛（实测源码 239 行）。
    const { apply } = await import(libUrl('host.js'))
    const host = makeHost()
    apply(host.ctx as never)
    host.set('systemPrompt', {
      section: () => {
        throw new TypeError('prompt section "plugin:sophia" order must be a finite number')
      },
    })
    expect(() => host.fire('systemPrompt')).not.toThrow()
    expect(host.sections).toHaveLength(0)
  })

  it('**迟到挂载**的路由与公告同样随 effect 回收（可逆性不只在 apply 路径上）', async () => {
    // OCR 复核 [10]：迟到挂载没走 `ctx.effect(() => webServer.register(...))`，
    // 而是从事件监听里直接调 mount*()，靠共享的 detach/detachSection 变量回收。
    // 它的疑问是「这样还算不算可逆」。**实测答案：算**（本用例即证据）——
    // 两条 effect 各自持有变量，disposer 一跑就把迟到挂载的那份也收掉。
    // 故不改结构；但把结论钉成断言，免得以后加挂载点时无声地破坏它。
    const { apply } = await import(libUrl('host.js'))
    const host = makeHost()
    // apply 时一个服务都没有。
    apply(host.ctx as never)
    expect(host.routes).toHaveLength(0)
    expect(host.sections).toHaveLength(0)

    // 服务迟到：走事件补挂。
    host.provide('webServer')
    host.provide('systemPrompt')
    expect(routeOf(host).path).toBe(STATUS_PATH)
    expect(host.sections).toHaveLength(1)

    // 停用 fiber —— 迟到挂的那些也必须被回收。
    // 反恒真：把 effect 的 cleanup 改成不调 detach?.() → 本条必须变红（已实测）。
    for (const dispose of host.effects) dispose()
    expect(host.routes, '迟到挂载的路由必须随 effect 回收').toHaveLength(0)
    expect(host.sections, '迟到挂载的公告必须随 effect 回收').toHaveLength(0)
  })

  // ── OCR 复核 [2]/[3]：httpServer / webServer 双键兼容 ──────────────
  // 依据：本仓 dsh-agent-teams/docs/developing-dsh-plugins.md:157 逐字要求
  // 「过渡期不要硬绑定单一键名」，参照实现 src/index.ts:49 的 WEB_SERVER_KEYS。

  it('旧键 httpServer 也能挂上路由（rc.1 兼容，硬绑单键时本条必红）', async () => {
    const { apply } = await import(libUrl('host.js'))
    const host = makeHost()
    // 只提供旧键：模拟 rc.1（HttpServerService）。硬绑 'webServer' 时路由数为 0。
    host.set('httpServer', host.webServer)
    apply(host.ctx as never)
    // 反恒真：把 host.ts 的候选键改回 ['webServer'] → 本条必须变红（routeOf 会抛）。
    expect(routeOf(host).path).toBe(STATUS_PATH)
  })

  it('两个键同时存在时，新键优先且只注册一次（不重复挂）', async () => {
    // 过渡期真实状态：新旧键可能同时在。此时**不能**注册两条路由
    // （真实 webserver 对同 path 重复 register 会撞），也不能取到旧键。
    const { apply } = await import(libUrl('host.js'))
    const host = makeHost()
    const oldRoutes: FakeRoute[] = []
    host.set('httpServer', {
      register(route: FakeRoute) {
        oldRoutes.push(route)
        return () => {}
      },
    })
    host.set('webServer', host.webServer)
    apply(host.ctx as never)
    // 新键挂上了；旧键一条都不该收到（否则同 path 会在两个服务对象上各挂一份）。
    expect(routeOf(host).path).toBe(STATUS_PATH)
    expect(oldRoutes, '新键在时不该退回旧键').toHaveLength(0)
  })

  it('新键形状不对时仍回退到旧键（`??` 短路会让这条假绿）', async () => {
    // OCR 复核第二轮抓到的真实缺陷：把回退写成
    //   asWebServer(ctx.get('webServer') ?? ctx.get('httpServer'))
    // 时，`??` 只在取值为 null/undefined 才回退。过渡期两键并存、新键形状不对
    // （非空但没 register）⇒ 短路 ⇒ 旧键永不探测 ⇒ 路由静默挂不上。
    // 修复是**逐键过守卫**。这条断言只有修好后才绿。
    const { apply } = await import(libUrl('host.js'))
    const host = makeHost()
    host.set('webServer', { notAServer: true })
    host.set('httpServer', host.webServer)
    apply(host.ctx as never)
    // 反恒真：把 host.ts 改回 `asWebServer(a ?? b)` → 本条必须变红（已实测，routeOf 会抛）。
    expect(routeOf(host).path).toBe(STATUS_PATH)
  })

  it('旧键的 internal/service 事件也能触发补挂（事件名同样不能硬绑）', async () => {
    const { apply } = await import(libUrl('host.js'))
    const host = makeHost()
    apply(host.ctx as never)
    expect(host.routes).toHaveLength(0)
    // 反恒真：把 host.ts 的事件判断改回 `=== 'webServer'` → 本条必须变红（routeOf 会抛）。
    host.provide('httpServer')
    expect(routeOf(host).path).toBe(STATUS_PATH)
  })

  it('两个服务键形状都不对时仍干净跳过（双键不能把守卫绕过去）', async () => {
    const { apply } = await import(libUrl('host.js'))
    const errors: unknown[] = []
    const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args)
    })
    try {
      const host = makeHost()
      host.set('httpServer', {})
      host.set('webServer', { register: 'not-a-function' })
      expect(() => apply(host.ctx as never)).not.toThrow()
      expect(host.routes).toHaveLength(0)
      expect(errors).toHaveLength(0)
    } finally {
      spy.mockRestore()
    }
  })

  it('section() 返回 truthy 非函数时，停用不会炸（原始写法会 TypeError）', async () => {
    // OCR 复核抓到的**不对称**：mountRoute 校验了「disposer 是不是函数」，
    // mountSection 没有 —— 它无条件 `detachSection = returned`。
    //
    // ⚠ 这条断言的第一版写错了，记下来免得又被改回去：我原先断言「返回非函数时
    // 应重复尝试 3 次」，实测是 1 次（`??` 之后的门是 detachSection !== undefined，
    // 返回 undefined 时两种写法都拦不住、都会重试 ⇒ 那版断言**区分不出**修复与否）。
    // 真正的差异在**停用路径**：section() 返回 truthy 非函数（如 `{}`）时，
    // 原始写法把垃圾值存进 detachSection，effect 的 disposer 里执行
    // `detachSection?.()` 会 `TypeError: detachSection is not a function`
    // —— 副作用回收不掉。修复后只认函数，判为非 disposer 就不登记。
    // 实测：改回原始写法 → 下面这行抛 TypeError（已做，见 shell.spec 注释）。
    const { apply } = await import(libUrl('host.js'))
    const host = makeHost()
    host.set('systemPrompt', {
      section: () => ({ notAFunction: true }) as never,
    })
    apply(host.ctx as never)

    // 模拟 cordis 停用 fiber：逐个跑 effect 的 disposer。
    // 反恒真：去掉 host.ts 的 `if (typeof returned === 'function')` 校验
    // → 本条必须变红（实测报 `TypeError: detachSection is not a function`）。
    expect(() => {
      for (const dispose of host.effects) dispose()
    }).not.toThrow()
  })

  it('section() 返回非函数时也**不**重复挂公告（否则公告会累积且收不回）', async () => {
    // OCR 复核 [4]（真实缺陷）：mountRoute 靠独立布尔量 `registered` 防重复；
    // mountSection 原先**只**有 `detachSection !== undefined` 一道门 ——
    // 而 `section()` 成功注册但返回非函数时，detachSection 保持 undefined，
    // 门永远拦不住 ⇒ 每次 internal/service 事件都再挂一段（累积），
    // 且拿不到 disposer、停用时收不回。
    // 实测（修复前）：连续两次事件 → sectionCalls 1→2→3。
    const { apply } = await import(libUrl('host.js'))
    const host = makeHost()
    let sectionCalls = 0
    host.set('systemPrompt', {
      section: () => {
        sectionCalls += 1
        // 坏形状：注册成功了，但不返回 disposer。
        return undefined as never
      },
    })
    apply(host.ctx as never)
    expect(sectionCalls).toBe(1)

    // 反恒真：把 host.ts 的判定改回 `detachSection !== undefined`
    // → 本条必须变红（已实测：sectionCalls 会变成 3）。
    host.fire('systemPrompt')
    host.fire('systemPrompt')
    expect(sectionCalls, '已注册过就不该再挂（返回非函数不代表没挂上）').toBe(1)
  })

  it('section() 返回非函数时停用不炸，且会重新尝试挂载', async () => {
    // 上一条的补充：拿不到 disposer ⇒ 停用时不该去调一个非函数（否则 TypeError），
    // 同时 `registeredSection` 必须被复位，好让停用后能重新挂上。
    const { apply } = await import(libUrl('host.js'))
    const host = makeHost()
    let sectionCalls = 0
    host.set('systemPrompt', {
      section: () => {
        sectionCalls += 1
        return { notAFunction: true } as never
      },
    })
    apply(host.ctx as never)
    expect(sectionCalls).toBe(1)

    // 反恒真：去掉 host.ts 里 `if (typeof returned === 'function')` 这层
    // → 停用时会 `detachSection?.()` 调一个对象 → TypeError（已实测）。
    expect(() => {
      for (const dispose of host.effects) dispose()
    }).not.toThrow()

    // 停用后复位 ⇒ 可以重新挂载（否则插件重启就永久失去公告）。
    host.fire('systemPrompt')
    expect(sectionCalls, '停用后应能重新挂上').toBe(2)
  })

  it('section() 正常返回 disposer 时只挂一次（门是有效的）', async () => {
    // 上一条的对照：形状正常时必须只挂一次，否则「门」就是恒真/恒假。
    const { apply } = await import(libUrl('host.js'))
    const host = makeHost()
    host.set('systemPrompt', host.systemPrompt)
    apply(host.ctx as never)
    expect(host.sections).toHaveLength(1)
    host.provide('systemPrompt')
    host.provide('systemPrompt')
    expect(host.sections, 'disposer 正常时必须只挂一份').toHaveLength(1)
  })
})

