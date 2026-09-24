/**
 * t5 自检：用**真实产物** `lib/client.js` 跑一遍「像宿主那样」的挂载。
 *
 * 这不是替代 vitest 的门禁，而是一次**端到端**确认：
 * 前面的用例大多直接 import `src/client/*`（源码路径），
 * 而这里走的是**产物**路径 —— bundle 的注册、materialize、
 * 惰性 `require('react')`、槽位注册的形状，全都在一条链上跑通。
 *
 * 用法：node scripts/sophia-client-smoke.mjs
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createContext, runInContext } from 'node:vm'

const REPO = dirname(dirname(fileURLToPath(import.meta.url)))
const BUNDLE = join(REPO, 'packages', 'sophia-core', 'lib', 'client.js')
const PKG_DIR = join(REPO, 'packages', 'sophia-core')
const require_ = createRequire(join(PKG_DIR, 'package.json'))
// 宿主模块表里**允许**被 require 的裸名（与 DSH 的 staticModules 一致）。
// ⚠ 白名单是「宿主模块表里**允许**被 require 的裸名」。`dsh-client-ui-primitives`
//   是 DSH 的**平台模块**（`tsdown.config.ts` 的 PLATFORM_MODULES 放行、宿主运行期提供），
//   所以渲染期 require 它是合法的 —— 漏了它会让活动面板一展开就报
//   `unexpected require @deepseek-ai/dsh-client-ui-primitives`（实测）。
const SEED = new Set(['react', 'react-dom', 'react/jsx-runtime', 'react-dom/client', '@deepseek-ai/dsh-client-ui-primitives'])

const failures = []
function check(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures.push(label)
}

// ── 1. 注册阶段：bundle 执行只登记工厂，不产生副作用 ─────────────────────
// ⚠ 用 `node:vm` 在**受限上下文**里跑产物，而不是间接 `eval`
//   （OCR 复核 HIGH：`eval` 会把产物**当代码在本进程全局作用域执行**，
//    产物一旦被替换就是任意代码执行、且没有沙箱）。
//   `vm` 的上下文是独立的一只：产物只能看到我们显式放进 `sandbox` 的东西
//   （它引用 `window`，所以给 `window` 就够），既更安全也更**更准确** ——
//   它验证的正是「在一个干净上下文里只靠 window 能否完成注册」。
//   （这与 `verify-t1-shell.mjs` 用 `await import()` 加载产物同属一类做法：
//    不在可信边界上执行来源不受控的代码。）
const registry = new Map()
const sandbox = {
  window: {
    __ModuleLoader__: {
      load(record) {
        registry.set(record.id, record.factory)
      },
    },
  },
  console,
    // ⚠ `performance` 必须显式种进来：vm 上下文只能看到显式放进 sandbox 的东西
    //   （见上面那段注释），而真实浏览器上下文里它是全局自带的 —— 缺了它会造出
    //   一种「真实环境不会发生、只有本脚本会发生」的失败。
    //
    //   实测代价：vendor/panel/ActivityPanel.tsx 的 useRef(performance.now()) 抛
    //   ReferenceError: performance is not defined（lib/client.js:7992），把整条
    //   smoke 打红；而这条 smoke 在 check-t5-structure.mjs 里只被打印、不被执行，
    //   于是这条真回归红了很久没人发现。
    //
    //   为什么不改 vendor/**：那是从上游整份抄来的代码，performance.now() 在真实
    //   浏览器里完全合法。要修的是测试环境缺全局，不是被抄来的代码。
    performance: globalThis.performance,
}
// `vm.createContext` 会**拷贝** sandbox 的属性到新上下文，
// 故要用返回的 contextified 对象来读回产物写进去的东西。
const context = createContext(sandbox)
const source = readFileSync(BUNDLE, 'utf8')
try {
  // `filename` 只为报错可读；超时防止产物里出现死循环把门禁挂死。
  runInContext(source, context, { filename: BUNDLE, timeout: 30_000 })
} catch (error) {
  console.error(`FAIL  产物执行失败（vm 上下文内）：${String(error)}`)
  process.exit(1)
}
// 产物写进 `window` 的东西要能从 contextified 对象读回来。
const win = context.window ?? sandbox.window

check('bundle 注册了恰好一个模块', registry.size === 1, `got ${registry.size}`)
check('注册 id 逐字等于包名', registry.has('@sophia/core'))
check('注册阶段未污染 window（无副作用）', win.__SOPHIA_CLIENT__ === undefined)

// ── 2. materialize：宿主模块表里的裸名必须能解析 ──────────────────────────
// ⚠ `factory` 缺失时**不能直接崩**（captain 派修 [31]）：`check()` 是**非致命**的
//   （失败会记下来并继续跑），所以上面那两条 ASSERT 失败后脚本会走到这里；
//   若此时 `factory` 是 `undefined`，`factory(...)` 会抛 `TypeError` 把整个脚本
//   崩掉 —— **前面的检查结果就全丢了**（用户只看到一个 TypeError，
//   不知道真正的原因是「注册 id 不对」）。⇒ 缺失时如实记为失败并输出已有结果。
const factory = registry.get('@sophia/core')
if (typeof factory !== 'function') {
  check('拿到可 materialize 的工厂', false, `registry 里的键：${[...registry.keys()].join(', ') || '（空）'}`)
  console.log('')
  console.error(`${failures.length} 项失败：${failures.join(' | ')}`)
  console.error('（未能 materialize ⇒ 后面的检查无法进行；上面已列出到此为止的结果）')
  process.exit(1)
}
const requires = []
const mod = factory((id) => {
  requires.push(id)
  if (!SEED.has(id)) throw new Error(`unexpected require ${id}`)
  return require_(id)
})

check('materialize 不 require 任何东西（注册期零 require）', requires.length === 0, `got ${JSON.stringify(requires)}`)
check('导出 apply', typeof mod.apply === 'function')
check('导出 inject', Array.isArray(mod.inject))
check('inject 只声明 slots', JSON.stringify(mod.inject) === '["slots"]', JSON.stringify(mod.inject))

// ── 3. 假宿主 ctx：注册槽位并检查形状 ────────────────────────────────────
const registers = []
const injections = []
const effects = []
const slots = {
  register(options, component) {
    const entry = { options, component }
    registers.push(entry)
    return () => {
      const index = registers.indexOf(entry)
      if (index >= 0) registers.splice(index, 1)
    }
  },
  inject(key, callback) {
    injections.push(key)
    const returned = callback()
    return typeof returned === 'function' ? returned : () => {}
  },
}
const ctx = {
  get: (name) => (name === 'slots' ? slots : undefined),
  effect: (execute, label) => {
    const disposer = execute()
    effects.push(disposer)
    return disposer
  },
}

// ⚠ `apply()` 是**产物导出的函数**，在主 realm 里被调用 ⇒ 它需要主 realm 的
//   `window` / `document`（产物内部按裸名引用它们）。这里**保存并还原**原值
//   （OCR 复核 LOW）：脚本今天是一次性执行，但把它作为模块导入的消费者
//   不该被留下污染；用 try/finally 保证连异常路径也还原。
const savedGlobals = { window: globalThis.window, document: globalThis.document }
globalThis.window = globalThis.window ?? {}
globalThis.document = {
  createElement: () => ({ id: '', textContent: '', remove() {} }),
  head: { appendChild(node) { this._node = node } },
  getElementById: () => null,
}

try {
  mod.apply(ctx)
} finally {
  // 还原（而不是 delete）：把原本就存在的值放回去，原本没有的恢复成没有。
  if (savedGlobals.window === undefined) delete globalThis.window
  else globalThis.window = savedGlobals.window
  if (savedGlobals.document === undefined) delete globalThis.document
  else globalThis.document = savedGlobals.document
}

check('等待了两个槽位的声明', JSON.stringify(injections) === '["sidebar.panellist","main"]', JSON.stringify(injections))
check('注册了两处槽位', registers.length === 2, `got ${registers.length}`)
const sidebar = registers.find((entry) => entry.options.name === 'sidebar.panellist')
const main = registers.find((entry) => entry.options.name === 'main')
check('sidebar 槽用 list 单元的 id', sidebar?.options.id === 'sophia', String(sidebar?.options.id))
check('main 槽用同名 key（否则宿主 selectPanel 会抛）', main?.options.key === 'sophia', String(main?.options.key))
check('两处都带 locale 命名空间', sidebar?.options.locale === 'sophia' && main?.options.locale === 'sophia')
check('label 是 thunk（能跟随语言切换）', typeof sidebar?.options.label === 'function')
check('两侧都提供了座位组件', typeof sidebar?.component === 'function' && typeof main?.component === 'function')

// ── 4. 用真实 React SSR 渲染座位组件，确认界面真的出得来 ────────────────
// ⚠ `main` 缺失时**不能直接解引用**（OCR 复核 MEDIUM）：上面的 `check()` 是
//   **非致命**的（会记下来继续跑），所以「main 槽没注册」之后脚本会走到这里；
//   `main.options` 会抛 `TypeError` 把脚本崩掉 —— **前面所有检查结果全丢**，
//   用户只看到一个 TypeError，而真正的原因是「main 槽没注册」。
//   （这与 captain 派修的 [31] 是同一族：**崩溃掩盖了已有的检查结果**。）
if (typeof main?.component !== 'function' || typeof main.options?.inject !== 'function') {
  check('main 槽可用（能取到 component 与 inject）', false, '未注册 ⇒ 跳过 SSR 渲染检查')
  console.log('')
  console.error(`${failures.length} 项失败：${failures.join(' | ')}`)
  console.error('（main 槽不可用 ⇒ SSR 渲染检查无法进行；上面已列出到此为止的结果）')
  process.exit(1)
}
const React = require_('react')
const { renderToStaticMarkup } = require_('react-dom/server')
const injected = main.options.inject()
check('主面板座位拿到 store 与 t', injected.store !== undefined && typeof injected.t === 'function')

class FakeStore {
  getSnapshot() {
    return {
      status: 'ready',
      readAt: Date.now(),
      error: null,
      view: {
        ok: true,
        teams: [{
          teamId: 'team:1',
          name: '钦天监',
          kind: 'persistent',
          members: [
            { memberId: 'm1', position: '钦天监监正', name: '钦天监监正', displayName: '钦天监监正', lifecycle: 'active', tombstone: false, model: { provider: 'p', model: 'm' }, presence: 'running' },
            { memberId: 'm2', position: '历算主事', name: '历算主事', displayName: '历算主事', lifecycle: 'archived', tombstone: true, model: null },
          ],
          channels: [{ channelId: 'c1', title: '研发', threads: [{ threadId: 't1', channelId: 'c1', title: '修 bug', assigneeMemberId: 'm1' }] }],
          messages: [{ messageId: 'a1', channelId: 'c1', threadId: 't1', senderMemberId: 'm1', body: '开始干活', occurredAt: 1 }],
          tasks: [
            { taskId: 'k1', title: '已完成', status: 'done', assigneeMemberId: 'm1', blockedBy: null },
            { taskId: 'k2', title: '被挡住', status: 'in_progress', assigneeMemberId: 'm1', blockedBy: '等签批' },
          ],
          activity: [],
        }],
      },
    }
  }
  subscribe() { return () => {} }
  load() { return Promise.resolve() }
}

const html = renderToStaticMarkup(
  React.createElement(main.component, { store: new FakeStore(), t: injected.t }),
)
// 诊断开关：`SOPHIA_SMOKE_DUMP=1` 时把渲染出的 HTML 打出来。
// 存在的理由：这份 DOM 是「真实产物端到端」**唯一的可观测量**，断言失败时没有它
// 就只能读组件源码猜「为什么没渲染」—— 实测猜三轮都不如直接打一次。
// 它不改变任何断言，只多一条输出。
if (process.env.SOPHIA_SMOKE_DUMP === '1') {
  console.log('─── 渲染出的 HTML（起）───')
  console.log(html)
  console.log('─── 渲染出的 HTML（止）───')
}
const must = [
  ['data-sophia-state="ready"', '面板进入就绪态'],
  ['data-sophia-team="team:1"', '渲染了团（主团语义）'],
  // ⚠ 2026-09-24 旧团队卡下线（收件箱不再灌成员与频道，主人实测否掉）⇒
  //   原来挂在卡上的 成员名册 / 头像位 / 团名 DOM 文本 断言随之失效，
  //   换成**同一素材硬约束在搬家后仍被钉住**的断言：
  //   · 团队工作区整体在（左栏 + 会话座 + 收件箱头三块结构锚点）；
  //   · 收件箱 = 活动面板（hosted 形态，主人的成品定义）；
  //   · 左栏三分区骨架（收件箱入口 / 频道 / Agents）—— 成员名与头像
  //     在左栏是**异步加载**（smoke 同步渲染拿不到），它们的素材约束
  //     由 `TeamMemberIdentity` / `TeamMemberAvatarImage` 的单测与
  //     门禁「.sp-avatar 只做 cover」那条守 —— 这里如实不假装覆盖。
  ['data-sophia-team-surface="workspace"', '团队工作区整体在（surface 锚点）'],
  ['data-sophia-team-sidebar', '左栏在'],
  ['data-sophia-team-conversation', '上游会话座在'],
  // ⚠ **不**断言 `data-agent-teams-activity`（OCR [47] HIGH 抓到的恒假红）：
  //   下方长注释（历史记录）已写明 —— ActivityPanel 的首帧 tick 在微任务里，
  //   `renderToStaticMarkup` 同步 ⇒ 这个标记在 smoke 这条渲染链上**结构性拿不到**，
  //   是"实测恒失败"才删掉的。刚才改写时误加回来，OCR 当场抓住 ⇒ 再删并留痕。
  //   收件箱 = 活动面板的覆盖只能靠浏览器运行期（活客户端已实测渲染）。
  ['aria-label="收件箱"', '左栏收件箱入口在'],
  ['Agents', '左栏 Agents 分区在（换模/挂起恢复/加成员搬进这里）'],
  ['data-sophia-team-count="1"', '团数如实进 DOM'],
]

// ⚠ 这一段是**实测之后**的结论，与最初写的替换方案不同 —— 不静默改口，逐条留痕：
//
//   最初的做法是把 3 条旧断言换成抄来面板的同类标记（`data-agent-teams-collapsed` /
//   `data-agent-teams-activity`）。**实测这两条恒失败**，根因是结构性的：
//   `ActivityPanel` 的数据来自 `activity-monitor` 的 tick，而它的首帧 tick 被推到
//   `Promise.resolve().then(...)`（微任务）里；`renderToStaticMarkup` 是**同步**的，
//   所以这份 DOM 里 `ActivityPanel` 会走 `if (!conversationVisible || (!hasTeams &&
//   !expanded)) return null`（`vendor/panel/ActivityPanel.tsx:1434`）**整体不渲染**。
//   ⇒ 那两条不是「还没修好」，是**这个渲染路径下永远拿不到**。故删除，不留恒假断言。
//   ⇒ **代价如实写在这里**：活动面板在 smoke 这条链上是**覆盖盲区**，它的覆盖只能靠
//     浏览器运行期（`SOPHIA_SMOKE_DUMP=1` 能看到这份 DOM 里确实一个标记都没有）。
//
//   保留的替换（2026-09-24 二次改写后与 must 数组**实际**一致）：
//   · 原 `'开始干活'`（「消息流在」）—— 那是**自研** `MessageStream` 渲染的**消息正文**。
//     消息流已被抄来的收件箱/Thread 页替代，而它默认停在收件箱列表（`threadRef` 未选时
//     不进 Thread 页），不保证渲染这条正文。
//   · 现在钉的是：`data-sophia-team-sidebar` / `data-sophia-team-conversation`
//     （团队工作区两块结构）+ `aria-label="收件箱"`（左栏收件箱入口）+ `Agents`
//     （左栏分区，换模/挂起恢复/加成员的家）+ `data-sophia-team-count`（团数如实）。
//     （`data-agent-teams-activity` 不可用 —— 见本文件上方"恒失败"长注释。）
//     **不等强**于「消息正文可见」。
for (const [needle, label] of must) check(label, html.includes(needle))

// ⚠ 进度分段条**不在**这份 DOM 里，这是**设计**而非缺陷：活动面板默认折叠
//   （`DEVELOPMENT.md` §6「单页信息密度过高 → 默认折叠」），折叠时它的整个
//   body（进度条 / 成员卡 / 阻塞列表）**不渲染**。
//   展开态的进度条由 `tests/client/components.spec.tsx` 的
//   「`initiallyOpen=true` 时展开，且三块内容都在」覆盖。
//   这里如实验「折叠就是折叠」——而不是假装它展开了。
check('折叠态不渲染面板 body（进度条按设计缺省）', !html.includes('data-sophia-progress'))
// ⚠ 2026-09-24：`data-sophia-member-card="m1"` 原来挂在旧团队卡的名册上，
//   卡下线后这个标记不再出现在面板 DOM 里 —— 守卫对象换成「收件箱头部确实装着
//   索菲亚的面板内容」（活动面板 + 审批卡都住那里，见 team-mode.tsx 的说明）。
check('收件箱头部装着索菲亚面板内容（inbox-header）', html.includes('data-sophia-team-inbox-header'))

// ── 5. 可逆：跑 disposer 后槽位回收 ──────────────────────────────────────
for (const dispose of effects) if (typeof dispose === 'function') dispose()
check('可逆：disposer 后槽位全部回收', registers.length === 0, `got ${registers.length}`)

console.log('')
if (failures.length > 0) {
  console.error(`${failures.length} 项失败：${failures.join(' | ')}`)
  process.exit(1)
}
console.log('全部通过：真实产物可注册、可 materialize、零顶层 require、界面渲染正常、可逆回收。')
