/**
 * t5 · client 半的**源码级**用例（不是行为用例 —— 这一点如实写在每条身上）。
 *
 * ## 为什么需要这样一个文件
 *
 * client 半的行为用例（`tests/client/*.spec.tsx`）跑在
 * `tsconfig.client.json` 下：`types: []`、lib 无 node。它们用
 * `react-dom/server` 做**一次性**渲染（SSG），因此：
 *
 * - **能**验「给定输入渲染出什么 HTML」；
 * - **不能**验「状态更新之后怎样」（SSG 只跑一次 render）、
 *   「某个 hook 的初值是什么」这类**运行期**语义。
 *
 * 而本文件跑在**主** `tsconfig.json` 下（`types: ["node"]`、lib 无 DOM），
 * 所以它能 `readFileSync` 读源码，但**不能**渲染 JSX。
 * 两者是互补的：能用 SSG 验的一律走 SSG（那是真行为），
 * 只剩「源码结构」这一类的才落到这里。
 *
 * ⚠ **判据强度要说清楚**：本文件的断言只能证明「源码里是这么写的」，
 * 证明不了「运行期一定是那个行为」。因此：
 * - 每条断言都配一条**对应的行为用例**（见注释里的交叉引用），行为用例才是主证据；
 * - 这里只覆盖行为用例**结构上够不到**的那几处；
 * - 凡本文件能表达的语义，若行为用例也能表达，就**不该**只留在这里
 *   （否则就是本仓反复记录的「恒真/假覆盖」）。
 *
 * 手法先例：`tests/shell.spec.ts` 直接读 `src/client/index.ts` 断言
 * 「插件名只有构建期一个真相」—— 同属这一类。
 *
 * @module tests/client-sources.spec
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const PKG_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

function readClient(file: string): string {
  return readFileSync(join(PKG_ROOT, 'src', 'client', file), 'utf8')
}

describe('t5 · 源码级不变量（client 半）', () => {
  it('头像失败状态**按 URL 记忆**，不是永不重置的布尔', () => {
    // 缺陷（OCR 复核 LOW）：`const [failed, setFailed] = useState(false)`
    // 是永久标记 —— 组件按 `memberId` keyed，不会重挂，于是某次 404 会把该成员
    // 的头像**永久**钉在首字方块上，即使后来宿主头像路由上线/路径被修正
    // 也不会再试一次。
    //
    // 为什么不能放行为用例：URL 与失败态的联动只在**第二次渲染**之后才可见，
    // 而 SSG 只跑一次 render（见文件头）。
    // 交叉引用：`components.spec.tsx` 的「不同 URL 产出不同 src」验了输入侧，
    // 本条的**行为**一半（真的会重试）由浏览器运行期保证 —— 这里如实只验结构。
    const source = readClient('components.tsx')
    expect(source).toContain('failedUrl')
    expect(source).toMatch(/failedUrl === url/)
    expect(source).not.toMatch(/const \[failed, setFailed\] = useState\(false\)/)
  })

  it('首页频道的选择**有失效回退**（旧 id 不在新集合里时回退首个）', () => {
    // 缺陷（OCR 复核 MEDIUM）：`useState` 记的 `activeChannelId` 不会随
    // `team.channels` 变化而跟上 ⇒ `channel` 解析成 `null` ⇒ 侧栏线程列表与
    // 消息流**双双渲染成空**，看起来像「这个团没有消息」。
    // 交叉引用：`components.spec.tsx` 的「无频道时走空态且不串台」验了结果侧。
    const source = readClient('components.tsx')
    expect(source).toContain('selectedChannelId')
    // 必须同时有「找不到就回退」的那一步，而不是直接把 find 结果当 channel。
    expect(source).toMatch(/const selected = team\.channels\.find/)
    expect(source).toMatch(/const channel = selected/)
  })

  it('团队工作区与换模入口的**源码级**接线不变量', () => {
    // 历史注记：本条最初守的是「panel.tsx 渲染 TeamPanel 时按 teamId keyed」
    // （OCR 复核 MEDIUM 抓到的选择状态跨团串页缺陷）。2026-09-24 旧团队卡
    // 整体下线（收件箱里不再灌成员与频道，主人实测否掉）⇒ 卡没了、key 也没了。
    // 守卫对象**换成同一族的真实风险**：换模入口的接线链在源码层必须完整 ——
    // panel.tsx 把回调交给 TeamModeSurface、适配层把它放进 sidebarProps、
    // Agents 面板把它传进行菜单。断链的任何一环都会让「换模」在界面上
    // 结构性不可达（与当年换模按钮不可达是同一类缺陷）。
    // 反恒真：断掉任何一环（比如从 sidebarProps 里删掉 switchModel）→ 本条必红。
    const panel = readClient('panel.tsx')
    // ⚠ 不绑变量名（与 check-t5-structure.mjs 同源同判据）：实参可能是原值
    //   或稳定化包装（`stableOnSwitchModel`，OCR [22] 的 memo 修复）。
    expect(panel).toMatch(/<TeamModeSurface store=\{store\} onSwitchModel=\{\w+\}>/)
    const sidebarSource = readClient('vendor/team/index.ts')
    expect(sidebarSource).toMatch(/switchModel: options\.onSwitchModel/)
    const agentsPanel = readClient('vendor/team/TeamAgentsPanel.tsx')
    expect(agentsPanel).toMatch(/switchModel=\{switchModel\}/)
  })

  it('挂载层的占位标记与实际能力同源（不存在第二处硬编码的能力声明）', () => {
    // `surfaces` 必须是**计算出来的对象**，不能把任何一项写死成字面量 ——
    // 那会让「如实回报」退化成「照抄常量」。
    const source = readClient('index.ts')
    expect(source).toMatch(/const surfaces = \{/)
    for (const key of ['styles', 'locale', 'sidebarEntry', 'mainPanel']) {
      expect(source).toMatch(new RegExp(`surfaces\\.${key} = `))
    }
  })

  it('`canSwitchModel` **只有一处定义**，两处消费方都引用它（防止注释声称同源而实际分叉）', () => {
    // ⚠ OCR 复核 MEDIUM：初版这个判据在 `MemberCard`（渲染入口）与
    //   `panel.tsx`（决定 `data-sophia-pluginswitch`）里**各写了一遍**，
    //   而 `panel.tsx` 的注释还声称「与 MemberCard 同源」—— 注释与代码不一致。
    //   注意这条**不是**行为缺陷（两份条件今天恰好相同），而是
    //   **可维护性**问题：一旦 `MemberCard` 的条件改了，属性就会谎报能力。
    //   ⇒ 行为用例无法区分（等价代码结果相同），所以这里如实用**源码级**判据：
    //     要求 `components.tsx` 定义它、`panel.tsx` 引用它（而不是内联条件）。
    // 反恒真：把 `panel.tsx` 的 `some(canSwitchModel)` 换回内联条件 → 本条必须变红。
    const components = readClient('components.tsx')
    const panel = readClient('panel.tsx')
    // 定义恰好一处。
    const definitions = components.match(/export function canSwitchModel\(/g) ?? []
    expect(definitions).toHaveLength(1)
    // 消费方引用（而不是各写一份成员级条件）。
    expect(panel).toContain('canSwitchModel')
    expect(panel).toMatch(/team\.members\.some\(canSwitchModel\)/)
    // 且 `panel.tsx` 里**不再**出现内联的那两个成员级判断。
    expect(panel).not.toMatch(/member\.tombstone === false && member\.model !== null/)
    expect(panel).not.toMatch(/m\.tombstone === false && m\.model !== null/)
  })

  it('样式注入走**引用计数**，disposer 只移除自己那一份、且计数归零才删节点', () => {
    // ⚠ 这条在第二轮 OCR 修复后**改写了判据**（原判据断言 `if (current === style)`）：
    //   初版按「节点是否已存在」决定插不插，并在已存在时返回**空操作** disposer。
    //   缺陷：两次挂载重叠时（热重载 / 第二次 apply），先挂载的 M1 持有真引用，
    //   它一释放就把**共享节点**删掉 ⇒ 活着的 M2 **静默无样式**。
    //   现在按引用计数：只有最后一个使用者释放才移除。
    //
    // ⚠ 后来又重构了一次（OCR 复核 MEDIUM）：两条分支的释放逻辑抽成共用的
    //   `release(owned)`，删节点那一步由 `entry.element.remove()` 变成
    //   `owned.remove()`。**本正则同步跟着改了** —— 这正是「实现改了、spec 没跟上」
    //   会产生稳定红的地方（`灵台郎` 实测过这条红并报给我）。
    //   判据锚在**语义**上（有引用计数、归零才删、释放走共用路径），
    //   而不是某个局部变量名。
    // 反恒真：把计数逻辑去掉、回到「已存在就返回空操作」→
    //   `panel.spec.tsx` 的「两次重叠挂载」用例必须变红（已实测）。
    const source = readClient('styles.ts')
    expect(source).toMatch(/styleRegistry/)
    expect(source).toMatch(/refs \+= 1/)
    expect(source).toMatch(/refs <= 0/)
    // 删节点走共用释放函数（两条分支不再各写一份）。
    expect(source).toMatch(/owned\.remove\(\)/)
    expect(source).toMatch(/const release = \(owned:/)
    // 且两条分支都**按文档重新查表**核对身份（这是 OCR 复核 MEDIUM 的修复点：
    //   初版两条分支判据不一致，旧 disposer 会去减孤儿对象的计数）。
    expect(source).toMatch(/current\.element !== owned/)
  })

  it('样式注入**会刷新内容**（CSS 改了但旧节点被保留 ⇒ 新样式永不生效）', () => {
    // OCR 复核 MEDIUM：初版只检查「有没有这个 id 的节点」，不检查它是不是
    // **这一版**的 CSS ⇒ 改样式后旧文本被静默保留，界面降级且无任何错误。
    // 反恒真：去掉 `entry.element.textContent = PANEL_CSS` → 本条必须变红。
    const source = readClient('styles.ts')
    expect(source).toMatch(/entry\.element\.textContent = PANEL_CSS/)
    // 插入路径同样要写内容（否则第一次注入就是空的）。
    expect(source).toMatch(/style\.textContent = PANEL_CSS/)
  })

  it('client 半**不 import** projection / ledger（会把 node:sqlite 拉进浏览器）', () => {
    // 依据：`src/projection/index.ts` 的文件头明确警告过 —— 它经 `src/index.ts`
    // re-export，会拉进 `src/ledger.ts` 的 `node:sqlite`，在
    // `tsconfig.client.json`（`types: []`、lib 无 node）下报 TS2307；
    // 绕过类型检查则运行期 `ReferenceError`。
    // 这条把「就算有人 TypeScript 层面绕过去了，也不许在源码里出现」钉住。
    //
    // 反恒真：在 `src/client/index.ts` 里加一行
    // `import type { X } from '../projection/index.ts'` → 本条必须变红。
    // （已实测：加 `import type` 也一样会红 —— `tsc -p tsconfig.client.json`
    //   会以 TS2307 报 `node:crypto` / `node:sqlite`，见 t5 交付报告。）
    const files = [
      'index.ts', 'avatar.ts', 'components.tsx', 'jsx-dev-runtime.ts',
      'jsx-runtime.ts', 'locales.ts', 'panel-store.ts', 'panel.tsx',
      'react-runtime.ts', 'seats.tsx', 'styles.ts', 'view-model.ts',
    ]
    for (const file of files) {
      const source = readClient(file)
      expect(source, `${file} 不得 import projection`).not.toMatch(/from '[^']*projection/)
      expect(source, `${file} 不得 import ledger`).not.toMatch(/from '[^']*\/ledger\.ts'/)
      expect(source, `${file} 不得 import node: 内建`).not.toMatch(/from 'node:/)
      expect(source, `${file} 不得 import @deepseek-ai/*`).not.toMatch(/from '@deepseek-ai\//)
    }
  })

  it('client 半**没有**「在源码里、却根本没进编译」的文件', () => {
    // 本仓已知陷阱：新增文件没被引用时「构建通过但文件根本没编」。
    //
    // ⚠ 判据要分两类，不能一把抓（实测纠正过一版）：
    // 1. **普通模块**：必须从入口可达（`import` 链）；
    // 2. **JSX 运行时**（`jsx-runtime.ts` / `jsx-dev-runtime.ts`）**结构上不可达** ——
    //    它们是 TS 按 `jsxImportSource` + `paths` 映射**注入**的，
    //    源码里没有 `import ... from './jsx-runtime.ts'`。
    //    所以对它们用「可达性」判据会**误报**（首版就是这么红的）。
    //    正确的判据是「它真的进了产物」——由下面那条**产物级**用例覆盖。
    const plainModules = [
      'avatar.ts', 'components.tsx', 'locales.ts', 'panel-store.ts',
      'panel.tsx', 'react-runtime.ts', 'seats.tsx', 'styles.ts', 'view-model.ts',
    ]
    /** 由编译器注入、不在源码 import 链上的模块。 */
    const compilerInjected = ['jsx-runtime.ts', 'jsx-dev-runtime.ts']

    const sources = new Map<string, string>()
    for (const file of [...plainModules, 'index.ts', ...compilerInjected]) {
      sources.set(file, readClient(file))
    }

    const reachable = new Set<string>(['index.ts'])
    let grew = true
    while (grew) {
      grew = false
      for (const file of [...reachable]) {
        const source = sources.get(file) ?? ''
        for (const match of source.matchAll(/from '\.\/([^']+)'/g)) {
          const target = match[1] as string
          if (sources.has(target) && !reachable.has(target)) {
            reachable.add(target)
            grew = true
          }
        }
      }
    }

    for (const file of plainModules) {
      expect(reachable.has(file), `${file} 不在入口的可达闭包里`).toBe(true)
    }
    // JSX 运行时确实不可达 —— 这条**反向**钉住「它们靠编译器注入」这个事实，
    // 免得有人以为可以靠 import 链找到它们。
    for (const file of compilerInjected) {
      expect(reachable.has(file), `${file} 不该出现在 import 链上（它由 jsxImportSource 注入）`).toBe(false)
    }
    // 入口必须真的接到**座位组件**上（否则整个 UI 是死的）。
    // ⚠ 精确到实际那一跳：`index.ts` 直接 import 的是 `seats.tsx`
    //   （JSX 座位移到 `.tsx` 里，因为 `index.ts` 必须保持 `.ts` ——
    //    `shell.spec.ts` 直接读它的源码断言构建期注入）。
    //   首版这里写成断言 import `panel.tsx`，那是**错的**（panel.tsx 经 seats.tsx
    //   可达，而非由 index.ts 直连）—— 实测纠正。
    expect(sources.get('index.ts')).toMatch(/from '\.\/seats\.tsx'/)
    // 而 panel.tsx 必须**可达**（上一段已按 import 链断言过它在闭包里）。
    expect(reachable.has('panel.tsx')).toBe(true)
  })

  it('JSX 运行时真的进了产物（可达性够不到的它们，必须由产物级证据兜住）', () => {
    // 上一条说明了 JSX 运行时不在 import 链上。那怎么证明它们**没有**被漏编？
    // 只能看**产物**：`lib/client.js` 里必须内联着它们的实现。
    // ⚠ 这正是「可达性判据有盲区」时该做的补位 —— 不假装一条判据能覆盖两类。
    // 前置：`lib/` 是构建产物且被 .gitignore 忽略 ⇒ 未构建时本条**明确地红**，
    // 并把补救命令写进错误（与 `shell.spec.ts` 的 `NEEDS_BUILD` 同一口径）。
    const bundlePath = join(PKG_ROOT, 'lib', 'client.js')
    let bundle: string
    try {
      bundle = readFileSync(bundlePath, 'utf8')
    } catch {
      throw new Error(
        `lib/client.js 不存在（构建产物不入库）—— 先跑：pnpm --filter @sophia/core run build`,
      )
    }
    // 自证：本包 JSX 运行时的实现体（`jsx(type, props, key)`）必须被内联。
    expect(bundle).toContain('src/client/jsx-runtime.ts')
    expect(bundle).toMatch(/function jsx\(type, props, key\)/)
    // 且产物里**不得**残留说明符（残留说明符 = 浏览器解析不到 ⇒ 静默白屏）。
    expect(bundle).not.toContain('sophia-jsx')
    // 顶层 require 只允许「工厂形参」那一行与惰性 react 那一处。
    const requires = [...bundle.matchAll(/require\(/g)]
    expect(requires.length).toBeLessThanOrEqual(2)
  })

  it('用户可见文案里不出现 Markdown 强调标记（渲染层没有 Markdown 处理）', () => {
    // OCR 复核 LOW：`**…**` 会被当**纯文本**渲染（`title` 属性 / 文本节点），
    // 用户会真的看到星号；且 `en` 里没有标记，造成中英不一致。
    // 判据只看**值**（单引号字符串），不看注释 —— 注释里引用标记是正当的。
    const source = readClient('locales.ts')
    const valueLines = source
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('//'))
      .filter((line) => /^\s+[a-zA-Z]+: '.*',?$/.test(line))
    const offenders = valueLines.filter((line) => line.includes('**'))
    expect(offenders).toEqual([])
  })

  it('语言：navigator 信号排在 document lang 之前（模板 lang=en 不得压过系统中文）', () => {
    // 主人实测：面板显示英文。根因之一 —— 主界面 html 模板 lang="en"，
    // detectLocale 第一信号命中 en 直接返回，系统中文 navigator 没机会。
    // 判据强度：**源码级**（只能证明 candidates 数组里 nav 写在 doc 前，
    // 证明不了运行期行为 —— 行为级需要可构造 navigator 的 jsdom 环境，本包 client
    // 用例跑在无 document 的 node 环境，结构上够不到，如实标注）。
    const locales = readClient('locales.ts')
    const start = locales.indexOf('const candidates')
    expect(start).toBeGreaterThan(-1)
    const end = locales.indexOf("return 'zh'", start)
    expect(end).toBeGreaterThan(start)
    const block = locales.slice(start, end)
    expect(block.indexOf('nav')).toBeGreaterThan(-1)
    expect(block.indexOf('nav')).toBeLessThan(block.indexOf('doc'))
  })

  it('locale 注册字典带 id 兼容键（DSH 内部语言 id 规范化差异的防御）', () => {
    // 主人实测：面板显示英文。根因之二（假设链）—— locale 服务当前语言若规范成
    // 'zh-CN'/'zh_CN'，只注册 {zh, en} 会查不到字典 ⇒ bind 静默回退英文。
    // settings.yaml 的 locale.preference 是字面 'zh'，但服务内部规范化取不到真值，
    // 故把常见写法全部映上（无论服务用哪种 id 都命中中文）。
    const index = readClient('index.ts')
    expect(index).toContain("'zh-CN': zh")
    expect(index).toContain("'zh_CN': zh")
  })

  it('面板轮询必须带 `{ background: true }`（否则每 4 秒把界面打成 loading）', () => {
    // 为什么这条只能在这里（源码级）：行为级要驱动 `setInterval`，而本包 client 用例
    // 跑在无 document 的 node 环境、只做一次性 SSG 渲染 —— 结构上够不到定时器。
    //
    // ⚠ 本断言经过**反恒真自检**（实测）：把 `panel.tsx` 轮询处的
    // `{ background: true }` 删掉后，本条变红。
    //
    // ⚠ 第一版曾写在 `tests/client/panel.spec.tsx` 里、由**测试自己**传
    // `background: true` —— 那测的是「store 支持这个选项」，与「轮询点真的用了它」
    // 无关：删掉 panel.tsx 的传参它照样绿（假覆盖）。行为用例保留在那边测 store 语义；
    // 「轮询点有没有传」这类**接线**只能在这里盯。
    const panel = readClient('panel.tsx')
    expect(panel).toMatch(
      /setInterval\(\(\) => \{[\s\S]{0,400}?store\.load\(undefined, \{ background: true \}\)[\s\S]{0,80}?\}, PANEL_POLL_MS\)/,
    )
  })
})
