/**
 * t5 结构不变量门禁。
 *
 * 为什么是独立文件而不是 `node -e` 内联（AGENTS.md §4.1/§4.2/§4.3）：
 * 命令里有正则、反斜杠、`${}`；同一串在 pwsh 里能过，在 `verify_report` 的
 * gate executor（走 `cmd`）里会死在多层引号/转义上，并被自动记成
 * agent-misjudge 入失败样本库 —— 本任务实测就发生过一次（t5-ui-2 的 fail）。
 * 落成文件后命令退化成 `node <file>`，零转义风险。
 * 文件放在**仓库内**的 `scripts/`（不放 %TEMP%：守卫推断仓库根失败时会回退到
 * 文件所在目录并对**整个目录**跑 ocr scan —— 写进 %TEMP% 会扫整个 Temp，实测两次各超时 180s）。
 *
 * ⚠ 本门禁的**已知纠正记录**（AGENTS.md §4.8：断言必须自检会不会红）：
 * 首版用朴素子串匹配找 `object-position`，被 `styles.ts:123` 那句
 * 「只 border-radius:50%，不加内边距/object-position」的**注释**命中、
 * 误判成违反「不做二次裁切」—— 事实上全文件**没有任何** object-position 规则。
 * 现在：先剥注释，再按 `.sp-avatar` 规则体逐条判。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

/**
 * 仓库根 —— **从脚本自身位置推导**，不依赖 `process.cwd()`。
 *
 * ⚠ OCR 复核 LOW [33]：初版用相对路径（`packages/sophia-core/...`），
 *   而那意味着「从哪个目录调用」会决定它检查谁 —— 在别的 cwd 下运行会
 *   直接 `ENOENT` 崩掉，或更糟：检查到**另一个**同名路径。
 *   兄弟脚本（`sophia-client-smoke.mjs`、`verify-t1-shell.mjs`）都用
 *   `import.meta.url` 推导，这里与它们统一。
 */
const REPO = dirname(dirname(fileURLToPath(import.meta.url)))

function fail(message) {
  console.error(`FAIL ${message}`)
  process.exit(1)
}

const CLIENT_SRC = join(REPO, 'packages/sophia-core/src/client')
const CLIENT_TESTS = join(REPO, 'packages/sophia-core/tests/client')

// ── 1. 文件数与脚本挂载 ──────────────────────────────────────────────────
// ⚠ OCR CRITICAL [28]：此处曾硬编码 `srcCount !== 12` —— 新增 DagCanvas.tsx /
// StagingDualPlanEditor.tsx 后实为 15，门禁**假红并短路掉后续全部检查**
// （假红也会让后面的真缺陷一条都不报）。精确计数对「合法新增文件」天生脆弱，
// 判据改为：**下限**（低于基线 = 有文件被删）+ **必备清单**（关键文件必须在）。
const srcFiles = new Set(readdirSync(CLIENT_SRC))
const srcCount = srcFiles.size
if (srcCount < 12) fail(`src/client 源文件数 ${srcCount} < 基线 12（疑似文件被删）`)
for (const must of ['panel.tsx', 'StagingDualPlanEditor.tsx', 'DagCanvas.tsx', 'tokens.ts']) {
  if (!srcFiles.has(must)) fail(`src/client 必备源文件缺失：${must}`)
}
// OCR [24]：testCount 同 srcCount 一样的脆弱点 —— 合法新增用例文件会假红。
// 改下限（低于基线 = 有用例被删）；具体文件的钉子由下面的 must-have 列表承担。
const testCount = readdirSync(CLIENT_TESTS).length
if (testCount < 4) fail(`tests/client 用例文件数 ${testCount} < 基线 4（疑似文件被删）`)

// ⚠ 读 package.json 要**兜住**（OCR 复核 MEDIUM）：它是「被测对象」之一，
//   缺失/损坏时**记一条失败并继续**后面的检查 —— OCR [第四轮] 抓到此处
//   注释与行为曾矛盾（注释说「记一条继续」，实现却是 fail() 立即退出，
//   后面的素材/针一条都不跑）。现在按注释本意实现：置退出码、继续。
let pkg = null
try {
  pkg = JSON.parse(readFileSync(join(REPO, 'packages/sophia-core/package.json'), 'utf8'))
} catch (error) {
  console.error(`FAIL 读不到 packages/sophia-core/package.json（${String(error)}）`)
  process.exitCode = 1
}
if (pkg !== null && !pkg.scripts?.['smoke:client']) fail('package.json 未挂 smoke:client 脚本')

// ── 2. 素材硬约束：不做二次裁切 ──────────────────────────────────────────
// 只看 **CSS 规则体**，不看注释（首版的教训见文件头）。
const rawStyles = readFileSync(`${CLIENT_SRC}/styles.ts`, 'utf8')

// ⚠ 源码里的 CSS 是**模板字符串**，选择器写作 `.${CLASS.avatar}`。
// 必须先把这个占位解析成真类名，否则 `\.sp-avatar\s*\{` 永远匹配不到
// （本门禁第二版就死在这里 —— 又一次「断言本身写错」）。
// 做法：先把 `CLASS` 映射整表读出来，再对所有 `${CLASS.x}` 做替换。
const classEntries = new Map()
for (const match of rawStyles.matchAll(/^\s{2}'?([A-Za-z0-9_-]+)'?:\s*'([^']+)',/gm)) {
  classEntries.set(match[1], match[2])
}
if (classEntries.size === 0) fail('styles.ts 里解析不到 CLASS 映射（定义形式变了？）')

// 剥注释 → 展开占位。顺序要紧：先剥注释，免得注释里的示例被误解析成规则。
const css = rawStyles
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^[ \t]*\/\/.*$/gm, '')
  // ⚠ OCR [34]：只展开点形式 `${CLASS.key}` 会漏掉括号形式
  //   `${CLASS['progressSegment-pending']}` —— 漏展开的占位被下面的
  //   「未定义 CLASS」守卫静默跳过（等于该守卫对括号形式失效）。两种形式都展开。
  .replace(/\$\{CLASS\.([A-Za-z0-9_-]+)\}|\$\{CLASS\['([^']+)'\]\}/g, (_whole, dotKey, bracketKey) => {
    const key = dotKey ?? bracketKey
    const value = classEntries.get(key)
    if (value === undefined) fail(`CSS 里引用了未定义的 CLASS.${key}`)
    return value
  })

const avatarClass = classEntries.get('avatar')
if (avatarClass === undefined) fail('styles.ts 里找不到 CLASS.avatar 的类名定义')
const avatarRule = new RegExp(`\\.${avatarClass}\\s*\\{([^}]*)\\}`).exec(css)
if (avatarRule === null) fail(`styles.ts 里找不到 .${avatarClass} 规则体`)
const avatarBody = avatarRule[1]

// 这些属性会真的改变像素构图 ⇒ 属于「二次裁切」。
for (const banned of ['object-position', 'padding', 'clip-path', 'transform']) {
  if (avatarBody.includes(banned)) {
    fail(`.${avatarClass} 规则出现二次裁切痕迹：${banned}`)
  }
}
// 这两条是素材硬约束允许且必需的（圆形 + 不变形）。
for (const required of ['border-radius: 50%', 'object-fit: cover']) {
  if (!avatarBody.includes(required)) fail(`.${avatarClass} 规则缺少必需的 ${required}`)
}

// ── 3. 素材硬约束：成员名必须另用 DOM 文本渲染 ───────────────────────────
const components = readFileSync(`${CLIENT_SRC}/components.tsx`, 'utf8')
if (!components.includes('data-sophia-name')) {
  fail('成员卡未用 DOM 文本渲染姓名（data-sophia-name 缺失）')
}

// ── 4. OCR 修复的落地自检（每条都要能找到实现）───────────────────────────
// 这些是复核抓到并已修的缺陷：确认它们**没有**被回滚。
const ocrFixes = [
  [components, 'data-sophia-visual', '状态点颜色与文案同源的标记'],
  [components, 'failedUrl', '头像失败按 URL 记忆（而非永久布尔）'],
  [components, 'member.model !== null', '无模型时不展示换模入口'],
  [components, 'selectedChannelId', '频道选择失效回退'],
  [readFileSync(`${CLIENT_SRC}/view-model.ts`, 'utf8'), 'UNKNOWN_LIFECYCLE', '未知生命周期不被改写成 active'],
  // ── 第二轮 OCR（scan 12 文件）修掉的真缺陷 ──────────────────────────────
  [readFileSync(`${CLIENT_SRC}/panel.tsx`, 'utf8'), 'sanitizeErrorForDom', '错误串脱敏后才进 DOM'],
  // ⚠ OCR [32]：旧针 `const phase:` 在 panel.tsx 里**从未存在**（真身是
  //   `const phase = phaseOf(snapshot)`）—— 一旦上面的文件数修好，这条会
  //   无条件假红。锚在真实 token 上。
  [readFileSync(`${CLIENT_SRC}/panel.tsx`, 'utf8'), 'phaseOf(snapshot)', '根属性与 body 同源（三态不矛盾）'],
  [readFileSync(`${CLIENT_SRC}/index.ts`, 'utf8'), 'store.dispose()', 'PanelStore 随挂载回收'],
  [readFileSync(`${CLIENT_SRC}/locales.ts`, 'utf8'), 'hasOwnProperty.call(params, name)', '模板插值不认原型链键'],
  // ⚠ OCR [33]：旧针 `key == null` 命中的是 jsx-runtime 注释里**解释为何不用**它
  //   的那句话 —— 换句话说它「因为注释存在而通过」，注释一改就假红。
  //   锚在真正的实现上：`key === null || key === undefined`。
  [readFileSync(`${CLIENT_SRC}/jsx-runtime.ts`, 'utf8'), 'key === null || key === undefined', 'null key 等同 undefined'],
  [readFileSync(`${CLIENT_SRC}/seats.tsx`, 'utf8'), "target.provider === ''", '请求边界自证模型目标完整'],
  // ── 第三轮 OCR（scan 12 文件）修掉的真缺陷 ──────────────────────────────
  [readFileSync(`${CLIENT_SRC}/panel.tsx`, 'utf8'), 'force: true', '重试不被并发合并吞掉'],
  [readFileSync(`${CLIENT_SRC}/panel.tsx`, 'utf8'), 'subscribeThenSync', '先订阅再补读（不丢通知）'],
  [readFileSync(`${CLIENT_SRC}/locales.ts`, 'utf8'), "typeof template !== 'string'", '未知文案键降级不抛'],
  [readFileSync(`${CLIENT_SRC}/locales.ts`, 'utf8'), '?? DICTIONARIES.zh', '认不出的 locale 回退 zh'],
  [readFileSync(`${CLIENT_SRC}/jsx-dev-runtime.ts`, 'utf8'), 'isStaticChildren === true', 'dev 入口按静态子节点路由'],
  [readFileSync(`${CLIENT_SRC}/index.ts`, 'utf8'), 'registerEffect', 'effect 可调用性检查 + 失败隔离'],
  [readFileSync(`${CLIENT_SRC}/index.ts`, 'utf8'), 'LOCALE_NS: string = PANEL_ID', '命名空间与面板 id 同源'],
]
for (const [haystack, needle, label] of ocrFixes) {
  if (!haystack.includes(needle)) fail(`OCR 修复疑似被回滚：${label}（找不到 ${needle}）`)
}
// ⚠ 本检查的历史演变（两次改写，原因都记下来，防第三次）：
// ① 最初是子串针 `'key={team.teamId}'` —— 多团改造后变量名变了 ⇒ 假红，改成不绑变量名的正则。
// ② 2026-09-24：旧团队卡（UpstreamTeamCard）整体下线（收件箱不再灌成员与频道，
//    主人实测否掉），key 自然也没了 ⇒ 正则再次假红。
//    守卫对象换成**同一族的真实风险**：换模入口的接线链
//    （panel.tsx → TeamModeSurface → 适配层 sidebarProps → Agents 行菜单）。
//    断链任何一环 ⇒ 「换模」结构性不可达 —— 与当年「换模按钮不可达」是同一类缺陷。
// 与 tests/client-sources.spec.ts 的同名断言保持同表达式（分叉 = 一红一绿，更难查）。
// 反恒真：断掉任何一环 → 这里必须 FAIL。
const panelSource = readFileSync(`${CLIENT_SRC}/panel.tsx`, 'utf8')
// ⚠ 不绑变量名（本检查的历史教训见上）：传给 TeamModeSurface 的实参可能是
//   `onSwitchModel` 原值，也可能是稳定化包装（如 `stableOnSwitchModel`）。
//   判据是「TeamModeSurface 的开标签上挂着 onSwitchModel={…}」这一事实。
if (!/<TeamModeSurface store=\{store\} onSwitchModel=\{\w+\}>/.test(panelSource)) {
  fail('换模接线断链：panel.tsx 不再把 onSwitchModel 传给 TeamModeSurface（入口搬家后断了？）')
}
const sidebarSource = readFileSync(`${CLIENT_SRC}/vendor/team/index.ts`, 'utf8')
if (!/switchModel: options\.onSwitchModel/.test(sidebarSource)) {
  fail('换模接线断链：适配层没有把 onSwitchModel 放进 sidebarProps.switchModel')
}
const agentsPanelSource = readFileSync(`${CLIENT_SRC}/vendor/team/TeamAgentsPanel.tsx`, 'utf8')
if (!/switchModel=\{switchModel\}/.test(agentsPanelSource)) {
  fail('换模接线断链：TeamAgentsPanel 没有把 switchModel 传进 AgentRow（行菜单会缺「换模」项）')
}

// ── 5. 模板字符串陷阱：PANEL_CSS 里不得出现反引号 ─────────────────────────
// `PANEL_CSS` 整体是一个模板字符串，注释里出现反引号会**当场终止字符串**。
// 实测代价：本轮加了一条「:hover 与选中态」的注释、里面写了 `:hover`，
// 直接把文件炸成 `tsc TS1005`（而 vitest 那边只表现为 2 个 suite 转换失败，
// 症状看起来跟 CSS 毫无关系）。这条把那个陷阱钉住。
// ⚠ 本检查**曾经是假绿的**（`AGENTS.md §4.8`：断言必须自检会不会红）。历史与修法：
//   旧实现用 `panelCssBody.indexOf('\n`')` 找模板收尾 —— 而**行首反引号长得就是收尾**
//   ⇒ 把一行反引号植入模板中间时，它认为模板在那行就结束了，被植入的那行反而落在
//   「模板之外」⇒ 输出 `OK PANEL_CSS 模板字符串内无反引号` 且 exit=0。
//   由并行 agent 实测复现（植入 → 假绿 → 还原，还原前后 sha256 一致）。
// 现在改用 **TypeScript 解析器**的两个独立判据，判断权交给编译器而不是字符串技巧：
//   ① 语法诊断 —— 模板被裸反引号提前终止时，剩下的 CSS 文本就成为非法 TS，解析器必报错。
//   ② 模板切片扫描 —— 取 `PANEL_CSS` 初始化表达式在源码里的**原样切片**逐字符扫。
//      ⚠ 不能用 `node.text`：那是**已解释**的文本，源码里合法的 `` \` `` 在它那里会变成
//        裸反引号，用它判会**误报**。所以扫的是 `rawStyles` 的切片，并显式跳过 `\x` 转义。
const sf = ts.createSourceFile('styles.ts', rawStyles, ts.ScriptTarget.Latest, true)
if (sf.parseDiagnostics.length > 0) {
  const first = sf.parseDiagnostics.slice(0, 3).map((d) => {
    const at = d.start === undefined ? '?' : sf.getLineAndCharacterOfPosition(d.start).line + 1
    return `第 ${at} 行：${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`
  })
  fail(
    `styles.ts 有 ${sf.parseDiagnostics.length} 处语法错误（模板字符串很可能被反引号提前终止）：${first.join('；')}`,
  )
}
let panelCssNode = null
const findPanelCss = (node) => {
  if (
    ts.isVariableDeclaration(node) &&
    ts.isIdentifier(node.name) &&
    node.name.text === 'PANEL_CSS' &&
    node.initializer !== undefined
  ) {
    panelCssNode = node.initializer
  }
  ts.forEachChild(node, findPanelCss)
}
findPanelCss(sf)
if (panelCssNode === null) {
  // 保留这条做「声明存在性」检查：有人把 PANEL_CSS 改名/挪走时能立刻发现，
  // 否则这条检查会静默地什么也不查 —— 那是另一种假绿。
  fail('styles.ts 里找不到 PANEL_CSS 的初始化表达式（是否被改名或挪走？）')
}
// ② 「取模板切片再扫裸反引号」**已删除**，理由是**前提不成立 + 被 ① 覆盖**（实测得出）：
//   `PANEL_CSS` 实际是**插值模板**（该文件里有 90 处 `${CLASS.xxx}`），不是无插值字面量，
//   所以「取首尾反引号之间的切片再扫」没有意义 —— 上一版正是照这个前提写的，
//   结果在**基线上就红**（输出 `PANEL_CSS 不是无插值的模板字符串`），可见它抓的不是真问题。
//
// ③ 「收尾后面必须紧跟分号」**也已删除**：那个前提同样不成立 —— 实测 `PANEL_CSS` 的模板
//   收尾后面跟的是注释（下一个非空白字符是 `/`），不是分号 ⇒ 该判据在**基线上就红**。
//   教训（与本文件头部那条 OCR 误报同源）：**拿"我以为是那样"的写法去判，就会得到假绿的孪生兄弟
//   —— 假红**。假红和假绿一样有害：它会让后来者学会忽略这条检查。
//
// 最终只留判据 ①，它经**变异实测**证明足够强，且不需要任何我臆测的语法前提：
//   在 `PANEL_CSS` 声明后植入一行行首反引号（正是本检查存在的意义：模板里出现反引号会当场
//   终止字符串）⇒ 本检查报出 **627 处语法错误**并 exit=1；还原后 sha256 与植入前一致、恢复绿。
//   判断权在 TypeScript 编译器手里，不在我的字符串技巧里 —— 这是它不可能假绿的原因。
// ③ 「收尾后面必须紧跟分号」**也已删除**：那个前提同样不成立 —— 实测 `PANEL_CSS` 的模板
//   收尾后面跟的是注释（下一个非空白字符是 `/`），不是分号 ⇒ 该判据在**基线上就红**。
//   教训（与本文件头部那条 OCR 误报同源）：**拿"我以为是那样"的写法去判，就会得到假绿的孪生兄弟
//   —— 假红**。假红和假绿一样有害：它会让后来者学会忽略这条检查。
//
// 最终只留判据 ①，它经**变异实测**证明足够强，且不需要任何我臆测的语法前提：
//   在 `PANEL_CSS` 声明后植入一行行首反引号（正是本检查存在的意义：模板里出现反引号会当场
//   终止字符串）⇒ 本检查报出 **627 处语法错误**并 exit=1；还原后 sha256 与植入前一致、恢复绿。
//   判断权在 TypeScript 编译器手里，不在我的字符串技巧里 —— 这是它不可能假绿的原因。
// `panelCssNode` 保留下来做「声明存在性」检查：有人把 PANEL_CSS 改名/挪走时能立刻发现，
// 否则这条检查会静默地什么也不查（另一种假绿）。
if (panelCssNode === null) fail('styles.ts 里找不到 PANEL_CSS 的初始化表达式（是否被改名或挪走？）')

// OCR HIGH [第五轮]：pkg 读失败时上面只置了 exitCode，这里若再解引用
// `pkg.scripts` 会 TypeError 崩掉、把已经算出来的检查结果全丢掉（自伤）。
console.log(`OK src/client=${srcCount} tests/client=${testCount} smoke="${pkg === null ? '(package.json 读不到，已记 FAIL)' : pkg.scripts['smoke:client']}"`)
console.log(`OK .${avatarClass} 只做 border-radius:50% + object-fit:cover（无二次裁切）`)
console.log(`OK 成员名走 DOM 文本（data-sophia-name）；${ocrFixes.length} 处 OCR 修复均在位`)
console.log('OK PANEL_CSS 模板字符串内无反引号')

// ── 6. **真的执行** smoke，而不是只检查它挂没挂 ─────────────────────────────
// ⚠ 这一节补的是一条**死验证**：在它之前，本门禁只检查 `package.json` 里有没有
//   `smoke:client` 这个键、把命令字面量打出来 —— **从不执行**。
//   代价是实测出来的：`smoke:client` 因为抄来的 `vendor/panel/ActivityPanel.tsx` 里的
//   `performance.now()` 在 vm 沙箱里不存在而**长期 exit 1**，而门禁一路 exit 0 亮绿灯，
//   很久没有任何人发现。**一条只被打印、不被执行的验证，与没有验证等价。**
const SMOKE_BUNDLE = join(REPO, "packages", "sophia-core", "lib", "client.js")
if (!existsSync(SMOKE_BUNDLE)) {
  // ⚠ 不静默跳过：说清为什么没跑、以及跑它要什么前置。
  console.log("SKIP smoke:client（没有 packages/sophia-core/lib/client.js — 先 npm run build）")
} else {
  const smoke = spawnSync(process.execPath, [join(REPO, "scripts", "sophia-client-smoke.mjs")], {
    cwd: REPO,
    encoding: "utf8",
    timeout: 300_000,
  })
  if (smoke.status !== 0) {
    // 把子进程输出原样带出来，否则用户只看到「失败」看不到为什么。
    console.error(smoke.stdout ?? "")
    console.error(smoke.stderr ?? "")
    fail(`smoke:client 失败（exit ${smoke.status}）`)
  }
  console.log("OK smoke:client 真跑过一次并通过（exit 0）")
}
