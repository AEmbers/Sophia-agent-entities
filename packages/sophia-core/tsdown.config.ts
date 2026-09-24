/**
 * tsdown 配置 —— 只为 **client（浏览器）半** 产出 DSH 认识的 bundle。
 *
 * ── 产物契约（照 DSH `@deepseek-ai/dsh-client-modules` 实测协议）──
 *
 * host 半（`lib/*.js`）由 `tsc -p tsconfig.build.json` 产出，是普通 ESM，
 * 不经 tsdown。只有 client 半需要变成浏览器模块加载器认得的形状：
 *
 *   window.__ModuleLoader__.load({
 *     id: '<package.json 的 name>',
 *     factory: (require) => { var module = {exports:{}}; ... return module.exports }
 *   })
 *
 * 三条硬要求（每条都有踩坑代价）：
 *
 * 1. **`id` 必须逐字等于 package.json 的 `name`**。宿主按包名查找 bundle；
 *    名字不一致时**宿主半边已经正常加载**，只在浏览器里静默找不到，
 *    是极难定位的故障 → 因此这里从 package.json 读，而不是再写一遍字面量。
 * 2. **必须是 CJS 闭包工厂**（不是 ESM）。banner/intro/footer 三段拼出外壳；
 *    `exports.apply` 是 loader 认的入口（与在跑的 dsh-postman client.js 同形）。
 * 3. **执行只注册工厂、不产生副作用**。CSS 注入等一切副作用必须留到
 *    factory 被 materialize 时（DSH 明确的懒加载模型）；本骨架无副作用。
 *
 * @see 本机 `@deepseek-ai/dsh-client-modules/lib/index.js`（resolveMeta / clientExportOf）
 */

import { existsSync, readFileSync } from 'node:fs'
import { basename, dirname, relative, resolve as resolvePath, sep } from 'node:path'
import { transform } from 'lightningcss'
import { defineConfig, type UserConfig } from 'tsdown'

/**
 * 把 `catch` 绑定到的未知值收窄成可读的错误文本。
 *
 * 为什么要这个 helper（captain 转交的实测缺陷）：直接写 `error?.message`
 * 在 strict 下是 **TS2339**（`Property 'message' does not exist on type '{}'`，
 * `useUnknownInCatchVariables` 让 catch 变量是 `unknown`）。
 * 那个错原先**看不见** —— 本文件不在任何 tsconfig 的 include 内，
 * `npm run typecheck` 永远走不到它。已把本文件纳入 tsconfig.json 的 include
 * （见该文件的注释），所以现在这个错会真的报出来。
 */
function errorText(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

/**
 * 插件 id：**读** package.json 的 name，不重述字面量。
 * 重命名包时若两边不同步，会得到「宿主好了、浏览器半找不到」的隐性故障。
 *
 * ⚠ 读到空/非字符串时**当场失败**（OCR 复核 [3]）：否则 banner 会印出
 * `id: undefined`，而这个失败模式恰好是静默的 —— 宿主半边照常加载，
 * 只在浏览器里找不到 bundle。配置里其余部分都围绕「id 必须正确」，
 * 这里值得一句断言。
 */
const PLUGIN_ID: string = (() => {
  const pkgPath = new URL('./package.json', import.meta.url)
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(pkgPath, 'utf8'))
  } catch (error) {
    // OCR 复核 [5]：不包起来的话，package.json 写坏只会得到一句光秃秃的
    // `SyntaxError: Unexpected token …`，看不出是「读插件 id 失败」——
    // 而下面是专门为「id 必须正确」写的断言，报错却指不到这里就很讽刺。
    // 错误文本走 errorText()（不再写 `error?.message`，那是 TS2339）。
    throw new Error(`tsdown: 读不出 ${pkgPath.pathname} 的 JSON（插件 id 来源）：${errorText(error)}`)
  }
  const name = (parsed as { name?: unknown }).name
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error(
      'tsdown: package.json 的 name 缺失或不是非空字符串 —— '
      + 'bundle 的 id 会退化成 undefined，宿主半边照常加载而浏览器半静默找不到',
    )
  }
  return name
})()

/**
 * 平台已种入浏览器模块表的裸名（external）。
 * client 半可以 require 它们；其它 `@deepseek-ai/*` 值导入一律是构建错误：
 * 跨插件值导入要么内联出重复的运行时实例，要么要求模块表答不上来的说明符。
 *
 * ⚠ 这是**手工维护的快照**（OCR 复核 [5]）。宿主将来往模块表里加新裸名时，
 * 唯一症状是构建在这里失败。因此下面的报错**把已知清单与「可能只是清单过期」
 * 一起印出来** —— 否则这条硬失败看起来像代码写错了，而不是清单该更新了。
 */
const PLATFORM_MODULES: readonly string[] = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
]

/**
 * 单一判据：这个说明符是不是「平台已种入模块表」的。
 *
 * 抽出函数而不是在三处各写一遍 `PLATFORM_MODULES.includes(id)`
 * （OCR 复核 [5]）：三处判据必须永远一致 —— 不一致的后果是
 * 「external 了没种进表的模块」或「内联了该 external 的模块」，
 * 两者都是本文件头部警告的**静默**故障（宿主好了、浏览器半找不到）。
 * 一句话判据只写一次，就不会漂移。
 */
function isPlatformModule(id: string): boolean {
  return PLATFORM_MODULES.includes(id)
}

/**
 * 虚拟 id 前缀/后缀：把 `.module.css` 从 tsdown 自己的 css 管线里**抢过来**。
 *
 * 为什么要抢（上游实现里已写明、这里照抄其理由）：tsdown 内置的 css 处理
 * 产出的是「样式被抽成独立资源」的形状，而我们要的是**类名映射 + 运行期注入**
 * —— 即 `import css from './X.module.css'` 拿到 `{ planChevron: '<hash>_planChevron' }`
 * 这样的对象。虚拟 id 让 rolldown 把一个 `.css` 文件当成**我们自己产出的 JS 模块**
 * 来加载，从而绕开内置管线。
 */
const CSS_VIRTUAL_PREFIX = '\0sophia-css:'
const CSS_VIRTUAL_SUFFIX = '.mjs'

/**
 * 把一个「源码里写的 css 相对路径」解析成磁盘上的绝对路径。
 *
 * 索菲亚的 client 入口是 `src/client/index.ts`（**直接吃 TS 源**，见 entry 的注释），
 * 所以 `importer` 本来就在 `src/` 里，第一分支通常就命中。第二分支是兜底：
 * 上游的 entry 是 `lib/client/index.js`，`tsc` 会把 `src/` 镜像到 `lib/` 下，
 * 那种布局下 `lib/` 里的相对产物要 rebase 回 `src/` 才找得到 `.css`。
 */
function sourceAssetPath(source: string, importer: string): string {
  const emitted = resolvePath(dirname(importer), source)
  if (existsSync(emitted)) return emitted
  const marker = `${sep}lib${sep}`
  const srcIndex = emitted.indexOf(marker)
  if (srcIndex !== -1) {
    const srcPath = `${emitted.slice(0, srcIndex)}${sep}src${sep}${emitted.slice(srcIndex + marker.length)}`
    if (existsSync(srcPath)) return srcPath
  }
  return source
}

const config: UserConfig = {
  name: `${PLUGIN_ID}/client`,
  // 直接吃 **TypeScript 源**，不经过 `lib/client/index.js` 这个中间产物（OCR 复核 [3]）。
  //
  // 为什么必须这样：client 源码里的 `__SOPHIA_PLUGIN_ID__` 是靠下面的 `define`
  // 在**打包时**替换的。若先让 tsc 落一份 `lib/client/index.js` 再打包，
  // 那份中间产物里就留着一个**未定义的自由变量**（`ReferenceError`），
  // 而它躺在 `files: ["lib"]` 里会被一起发布 —— 谁按约定路径去 require 它都会炸。
  // 直接从 .ts 打包后，`lib/` 里只剩：host 半的 .js/.d.ts、client 的 .d.ts、client.js。
  entry: { client: 'src/client/index.ts' },
  // 用 client 那套 tsconfig（lib 含 DOM、jsx: react-jsx）解析这个入口，
  // 否则会落到主 tsconfig（lib 无 DOM）→ 浏览器半当场 TS2304。
  tsconfig: 'tsconfig.client.json',
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  dts: false,
  sourcemap: true,
  // 不清空：lib/ 里还有 tsc 产出的 host 半与 .d.ts（clean: true 会把它们删掉）。
  clean: false,
  deps: {
    neverBundle: isPlatformModule,
    // ✓ alwaysBundle 是**必需**的（OCR 复核 [9]，已实测）：只声明 neverBundle 时，
    // tsdown 的默认外部化会对任何进了 dependencies/peerDependencies 的包生效，
    // 于是浏览器 bundle 里会留下宿主模块表答不上来的裸 `require(...)` ——
    // 正是本文件头部警告的「宿主好了、浏览器半静默失败」。
    // 本包目前没有运行时依赖，所以这是**预防性**的；等 t5 长起来再补就晚了。
    alwaysBundle: (id: string) => !isPlatformModule(id),
  },
  // ✓ 环境量注入是**必需**的（OCR 复核 [8]，已实测）：
  // 由 `.ts` 直接打包意味着任何被内联的库（t5 的 React 生态、图表库等）
  // 若读 `process.env.NODE_ENV`，就会在**浏览器** bundle 里留下裸 `process` 引用
  // （浏览器没有这个全局）⇒ 运行期 ReferenceError。
  // 实测：把一个读 process.env 的库移出 PLATFORM_MODULES 逼它内联 →
  // bundle 里确实出现裸 `process.env`。下面几条 define 让它在打包期被替换成字面量。
  // `__SOPHIA_PLUGIN_ID__` 同理：注入包名，避免源码里出现第二处字面量（OCR 复核 [2]）；
  // 与 banner 的 `id` 同源 ⇒ 两处不可能再漂移。
  // 与上游 `dsh-agent-teams/tsdown.config.ts:72-76` 同形。
  define: {
    __SOPHIA_PLUGIN_ID__: JSON.stringify(PLUGIN_ID),
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
  },
  plugins: [{
    // ⚠ 本门只管 `@deepseek-ai/*`，**不是**「一切危险导入的兜底」。
    // OCR 复核 [1] 担心「`alwaysBundle` 对任何非平台 id 都返回 true，
    // 于是 `node:*` 或别的裸依赖会被静默内联进浏览器 bundle」。
    // 已实测，两种情况都不成立：
    //   · `node:*` 导入：**tsc 阶段就红**，根本走不到 tsdown ——
    //     `tsc -p tsconfig.build-client.json` 报
    //     `TS2307: Cannot find module 'node:path'` 且 exit 2
    //     （client 配置 `types: []` + lib 只有 es2024/DOM，没有 node 类型）。
    //   · 别的裸依赖（实测拿 `yaml` 试）：会被**内联**进 bundle
    //     （249,939 字节，产物里没有裸 `require("yaml")`）——
    //     内联是安全的（浏览器侧不需要模块表答得上来说明符），
    //     代价只是体积，不是运行期失败。
    // 所以这里**不**加「拒绝一切非相对路径」的硬门：那会误伤
    // 合法的内联依赖，而它要防的两种情况一种已被上游步骤挡住、一种本就安全。
    name: 'sophia-client-bundle-purity',
    resolveId(source: string) {
      if (!source.startsWith('@deepseek-ai/')) return null
      if (isPlatformModule(source)) return null
      throw new Error(
        `client bundle purity: "${source}" 既不在 PLATFORM_MODULES 里，也不是本包自有代码。\n`
        + '两种可能，先判是哪种再动手：\n'
        + '  (a) 真的跨插件值导入 —— 禁止；请改用 cordis 服务协作。\n'
        + '  (b) 只是本清单过期 —— 宿主往浏览器模块表里种了这个裸名，'
        + '把 PLATFORM_MODULES 补上即可（先确认它确实在宿主的模块表里）。\n'
        + '⚠ 关于「type-only import 会被擦除」：那条只对**语句级**\n'
        + '`import type { T } from "..."` 成立（erasableSyntaxOnly 语义）；\n'
        + '若标识符出现在**内联类型位置**（如函数类型注解里直接写该模块名），\n'
        + '它不会被擦除，会走到本门。此时正确解法是给 `tsconfig.client.json` '
        + '补 `paths` / 类型桩，而不是放宽本门。\n'
        + `当前已知清单（${PLATFORM_MODULES.length} 项）：${PLATFORM_MODULES.join(', ')}`,
      )
    },
  }, {
    /**
     * CSS Modules 内联（照上游 `dsh-agent-teams/tsdown.config.ts:89-126` 的实现）。
     *
     * 为什么需要：移植进来的上游 UI 组件用 `import css from './X.module.css'` 拿
     * hashed 类名映射。构建期把类名编译成 `<hash>_<local>` 并**连同 CSS 文本一起**
     * 发成一个 JS 模块 ⇒ 浏览器侧 `import css` 直接得到映射对象，样式则在同一刻注入。
     *
     * 注入时机是**模块求值那一刻**（不是构建期）：符合 DSH 的懒加载模型 ——
     * bundle factory 被 materialize 时才插 `<style>`，并用 `data-plugin-css`
     * 去重（同一个 id 只插一次，热重载不会叠加）。
     */
    name: 'sophia-css-modules-inline',
    resolveId(source: string, importer: string | undefined) {
      if (!source.endsWith('.module.css')) return null
      const abs = importer !== undefined ? sourceAssetPath(source, importer) : source
      return CSS_VIRTUAL_PREFIX + abs + CSS_VIRTUAL_SUFFIX
    },
    async load(virtualId: string) {
      if (!virtualId.startsWith(CSS_VIRTUAL_PREFIX) || !virtualId.endsWith(CSS_VIRTUAL_SUFFIX)) return null
      const fileId = virtualId.slice(CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
      this.addWatchFile(fileId)
      const { code, exports: cssExports } = transform({
        filename: fileId,
        code: readFileSync(fileId),
        cssModules: { pattern: '[hash]_[local]' },
        minify: true,
      })
      // 排序是为了让映射 **byte-stable**：lightningcss 不承诺导出顺序，而不稳定的
      // 顺序会让每次构建都重写 lib/client.js —— 本仓提交构建产物，那全是 diff 噪音。
      const classMap: Record<string, string> = {}
      const sorted = Object.entries(cssExports ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      for (const [local, exp] of sorted) classMap[local] = exp.name
      return [
        `const css = ${JSON.stringify(code.toString())};`,
        // ⚠ 判重键用「相对构建根的路径」而不是 `basename`：两个不同目录下的同名 CSS
      // 模块（例如 `vendor/X.module.css` 与别处另一个 `X.module.css`）用 basename 会
      // **折叠成同一个 tagId**，第二个样式表被 `data-plugin-css` 判重跳过 ⇒
      // 它的样式**永远不注入**，而症状是「某些类没样式」，极难定位（OCR 复核指出）。
      // 相对路径既唯一，又不会把机器上的绝对路径写进产物。
      `const tagId = ${JSON.stringify(`${PLUGIN_ID}/${relative(process.cwd(), fileId)}`)};`,
        "if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']') === null) {",
        "  const tag = document.createElement('style');",
        `  tag.dataset.plugin = ${JSON.stringify(PLUGIN_ID)};`,
        '  tag.dataset.pluginCss = tagId;',
        '  tag.textContent = css;',
        '  document.head.appendChild(tag);',
        '}',
        `export default ${JSON.stringify(classMap)};`,
      ].join('\n')
    },
  }],
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PLUGIN_ID)}, factory: (require) => {`,
    // ⚠ 这里用 `var` 是**有意为之**，不是漏改（OCR 复核 [2] 要求写明理由）：
    // 这三段是拼给**宿主 loader 的 CJS 闭包**看的，复刻 CommonJS 的
    // `module` / `exports` 语义。用 `var` 让二者具备函数作用域提升，与
    // CommonJS 包装器（`(function(exports, require, module, __filename, __dirname){…})`）
    // 的语义一致；本仓「禁用 var」的风格规则针对**我们自己写的源码**，
    // 不含这层生成出来的 CJS 外壳。
    //
    // ⚠ 如实说明验证边界：我先前在这里写「换成 `let` 会 TDZ 崩掉」——
    // 随后实测**不成立**：把这两处改成 `let` 后构建 exit 0、bundle 照常挂载
    // （`apply` 跑通、`window.__SOPHIA_CLIENT__` 正常写入）。
    // 因此保留 `var` 的**真实**理由只有「与 CJS 语义 / 上游参照实现同形」，
    // **不是**「`let` 会坏」。别再把这个已证伪的理由复述回来。
    intro: 'var module = { exports: {} }; var exports = module.exports;',
    footer: 'return module.exports; } });',
  },
}

export default defineConfig(config)
