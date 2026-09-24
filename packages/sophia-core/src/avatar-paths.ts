/**
 * 成员头像**路径判据** —— 含真实的路径穿越防护（纯字符串，零依赖）。
 *
 * ## 为什么这个文件在 `src/` 而不在 `src/client/`
 *
 * ⚠ 这里的位置是**修一个真实缺陷**的结果，别挪回 `src/client/avatar.ts`。
 *
 * 这个判据有**两个**使用方，且分处插件两半：
 * - 宿主：`GET /api/sophia/avatar` 收到 `?path=` 后**必须**重跑它
 *   （见 `src/host-data.ts` 的 `resolveAvatarFile`）；
 * - 浏览器：`avatarUrlFor` 拼 URL 前先跑它。
 *
 * 放在 `src/client/` 时，宿主侧引用它会形成「宿主半 import 浏览器半」——
 * 而那条依赖一旦被宿主 `tsconfig.json`（`lib: ["es2024"]`，**无 DOM**）解析，
 * 该目录里**任何**一处 DOM 引用都会当场把宿主类型检查打红。
 * 这不是假想：本仓实测发生过 —— `src/host-data.ts` `import type` 了
 * `src/client/view-model.ts`，而后者 type-import `locales.ts`，
 * 于是 `locales.ts:245` 的 `document` 让契约命令
 * `npx tsc --noEmit -p packages/sophia-core/tsconfig.json` **exit 2**。
 * （`exclude: ["src/client"]` **拦不住被 import 拉进来的文件** —— 它只管根文件扫描范围。）
 *
 * 本文件**零 import、零 DOM、零 node:** ⇒ 两半都能安全引用，
 * 且两半用的是**同一份**判据：「抄一份到两边」会让两处各自漂移，
 * 而安全判据的漂移是静默的（弱的那一边先被绕过，强的那一边看着还在）。
 *
 * ## 素材硬约束（实测得出，勿凭直觉改）
 *
 * - 头像资产是 `assets/members/out-512/`（512×512 RGBA，**相对仓库根**）；
 * - **底部烧入的职位名在 24px 下完全不可读** ⇒ 小尺寸场景必须**另用 DOM 文本**
 *   渲染成员名，不能依赖图上的字；
 * - 职位标签**已烧入像素**（不透明占比 94.4%）⇒ 界面无法改写头像上的名字，
 *   显示名须与图上标签一致；
 * - **不要做头像二次裁切**（素材已调好，底部标签余量仅 15px）
 *   ⇒ 本文件只产出路径/URL，**不经手任何尺寸/裁切参数**；CSS 侧也只用
 *   `object-fit: cover` + 圆形裁切，不改内边距。
 *
 * ## 路径穿越防护（真防护，但边界必须说清）
 *
 * 查询参数里的路径来自线格式（外部输入）。若不校验，`?path=../../.credentials.yaml`
 * 会让宿主读任意文件。本仓记录过一次真实事故：某处「防护」写成恒真式比较、
 * 看起来防住了实际没有。因此这里的判据是**逐段白名单**。
 *
 * 三道门，缺一不可：
 * 1. **必须以 `assets/members/` 开头**（前缀白名单）；
 * 2. **逐段检查**：拒绝空段、`.`、`..`、反斜杠、以及 `:`（Windows 盘符/ADS）；
 * 3. **扩展名白名单** `.png`（素材只有 PNG；放宽会开出别的解释面）。
 *
 * 注意第 2 条**不能**被「第 1 条 + 归一化」替代：`assets/members/../../x.png`
 * 确实以白名单前缀开头，而归一化后跑出根目录 —— 「先归一化再查前缀」
 * 与「先查前缀再归一化」是**两种不同**的实现，只有逐段拒绝才不依赖顺序。
 *
 * ⚠ **本判据只处理「字符串形状」**：它**不**接触文件系统，因此
 * 「归一化后的绝对路径真的在素材根下」需要调用方另做一道（宿主侧已做，
 * 见 `host-data.ts` 的 `resolveAvatarFile` 第 2 道门）。
 * 另：`%2e%2e%2f` 解码后仍是 `../` ⇒ 调用方**必须**在 `decodeURIComponent`
 * **之后**才调本函数；「前端已经编码过」不提供任何安全性。
 *
 * @module @sophia/core/avatar-paths
 */

/** 头像路由（宿主侧实现见 `src/host.ts`）。 */
export const AVATAR_ROUTE = '/api/sophia/avatar'

/** 素材的仓库相对根。**必须**带结尾斜杠，前缀判据靠它。 */
export const AVATAR_ROOT = 'assets/members/'

/** 允许的扩展名（素材只有 PNG）。 */
const ALLOWED_EXTENSIONS: readonly string[] = ['.png']

/**
 * 校验一个仓库相对路径是不是合法的头像路径。
 *
 * @param path - 线格式给出的仓库相对路径（如
 *   `assets/members/out-512/03_第三梯队_架构与研发组/历算主事.png`）。
 * @returns 合法时返回路径本身，否则返回 `null`（调用方据此降级成首字头像 / 回 400）。
 */
export function sanitizeAvatarPath(path: string): string | null {
  if (typeof path !== 'string' || path === '') return null
  // ⚠ **第一道门：控制字符（含 NUL）**（OCR 复核 MEDIUM 要求提前）。
  //   初版放在**最后**，于是这类输入会被完整解析（前缀、分段、扩展名）之后才丢弃。
  //   今天没有可利用的缝（后面每一道都会拒），但它使「安全判据」的成立
  //   **依赖后续检查的相对顺序** —— 将来有人为了「早点返回」重排这些检查，
  //   这道防护就会被静默绕过。放最前面 ⇒ 它与后面的顺序无关。
  //   为什么危险：控制字符会让下游 fs/URL 解析出现**截断歧义**
  //   （`x.png\n//evil.example` 这类在日志与 URL 里的解释可能不一致）。
  if (/[\u0000-\u001f\u007f]/.test(path)) return null
  // 反斜杠一律拒绝：Windows 上 `..\..\x` 与 `../../x` 等价，
  // 只拦正斜杠会被绕过（本机是 Windows，这条不是理论风险）。
  if (path.includes('\\')) return null
  // 绝对路径 / 盘符 / UNC / 协议内嵌一律拒绝。
  // ⚠ 这里**没有**单独的 `startsWith('//')` 分支（OCR 复核 LOW 指出它是死代码）：
  //   `//…` 必然也以 `/` 开头，那个分支永远不会是**决定性的**。
  //   在本文件里，「每一道判据都是承重的」本身就是头等纪律 ——
  //   留一个恒被前一条覆盖的分支，会让复核者高估覆盖率（本仓有过
  //   「防护其实写成恒真式」的真实事故）。UNC 已由本行的 `/` 判据覆盖。
  if (path.startsWith('/') || path.includes(':')) return null
  if (!path.startsWith(AVATAR_ROOT)) return null
  // 逐段白名单 —— 见文件头第 2 条：这一条不能由前缀判据替代。
  const segments = path.split('/')
  for (const segment of segments) {
    if (segment === '' || segment === '.' || segment === '..') return null
  }
  const last = segments[segments.length - 1] ?? ''
  // 扩展名白名单（大小写不敏感：素材文件名是 `.png`，但别让 `.PNG` 被误杀 —— 它同样安全）。
  // ⚠ 要求**点前有非空文件名**（OCR 复核 LOW）：`dot > 0` 而不是 `dot >= 0`，
  //   否则 `assets/members/out-512/.png`（空 basename 的隐藏文件）会通过。
  const dot = last.lastIndexOf('.')
  if (dot <= 0) return null
  const extension = last.slice(dot).toLowerCase()
  if (!ALLOWED_EXTENSIONS.includes(extension)) return null
  return path
}

/**
 * 把仓库相对路径转成 `<img src>` 可用的 URL。
 *
 * ⚠ 用 `encodeURIComponent` **整体编码**路径（编码后 `/` 变成 `%2F`），
 * 而不是 `encodeURI`（它保留 `/`）。中文目录名（`03_第三梯队_架构与研发组`）
 * 必须被编码；整体编码也让宿主侧解析时**必须**先解码再判（见文件头）。
 */
export function avatarUrlFor(path: string): string | null {
  const safe = sanitizeAvatarPath(path)
  if (safe === null) return null
  return `${AVATAR_ROUTE}?path=${encodeURIComponent(safe)}`
}

/**
 * 从线格式的成员条目上取头像 URL。
 *
 * 只有**一条**路径：`avatarPath` → `avatarUrlFor()`（严格白名单）。
 *
 * ## ⚠ 为什么这里**没有**「宿主直接给 URL」的分支
 *
 * 曾经有过：一条 `entry.avatarUrl` 的分支，只查 `startsWith('/')` 就原样放行。
 * OCR 复核（HIGH）指出那条判据**远弱于** `sanitizeAvatarPath` 的白名单 ——
 * 一个含控制字符的值（如 `/\n//evil.example/x.png`）或含 `:` 的值
 * 会被浏览器归一化成**跨源**请求，把面板变成任意远端图片的加载器
 * （可做像素级追踪）。
 *
 * 当时的定级依据（如实写明，避免夸大或掩盖）：`WireMember` **没有**
 * `avatarUrl` 字段，唯一调用点传的是 `WireMember` ⇒ 那条分支**运行时不可达**，
 * 风险是「将来有人给线格式加了 `avatarUrl` 就会踩」。
 *
 * **处置：直接删掉那条分支，而不是给它补白名单。** 理由：
 * - 补白名单等于保留一条**当前没有生产者**的代码路径 —— 而线格式里没有它，
 *   那条路径永远测不到、也永远没人维护，属于本仓 §「不要造自己的需求」；
 * - 真要支持宿主给 URL，正确的形状是让宿主**给相对路径**（`avatarPath`，
 *   已有且已严格校验），而不是开一条更弱的旁路；
 * - 删除后唯一入口就是白名单，**这个安全性质变成结构性成立**，不依赖调用方自觉。
 *
 * 若将来确实需要「宿主已解析好的 URL」：请把它加进 `WireMember` 并**复用**
 * `sanitizeAvatarPath` 的判据（同源相对路径 + 无控制字符），不要另写一份。
 */
export function resolveAvatarUrl(entry: {
  readonly avatarPath?: string | undefined
}): string | null {
  const path = entry.avatarPath
  if (typeof path !== 'string' || path === '') return null
  return avatarUrlFor(path)
}
