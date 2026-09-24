/**
 * 成员头像查表 —— 上游叫「whale artwork lookup（角色关键词 → 打包的鲸鱼插画）」，
 * 索菲亚这一份换成**自己的头像体系**。
 *
 * ## 与上游的差异（只此一处是「素材 + 命名规则」的替换点）
 *
 * 上游的实现是**客户端正则匹配**：
 *
 * ```ts
 * // 上游 artwork.ts 原文（`…` 表示省略；这张表本仓不再保留，理由见下）
 * const ROLE_ART: ReadonlyArray<readonly [RegExp, string]> = [
 *   [/data|analys|metric|performance|数据|分析|指标|性能/, 'member-data-v2.png'],
 *   …,   // 共 8 条：data / researcher / qa / engineer / design / secur / docs / release
 * ]
 * export const ART_BASE = '/plugins/dsh-agent-teams/assets/'
 * export function memberArtUrl(name: string, role: string): string | null {
 *   const identity = `${name} ${role}`.toLowerCase()
 *   for (const [pattern, art] of ROLE_ART) {
 *     if (pattern.test(identity)) return `${ART_BASE}${art}`
 *   }
 *   return null
 * }
 * ```
 *   （以上逐字抄自上游 `src/client/artwork.ts` 的 `:9`/`:12-22`/`:41-47`；
 *    上一版我在这里把第一条正则写成了只带中文四关键词的短版，是**误引**，已改回逐字。）
 *
 * 索菲亚**不能**照这个形状移植，三条各自独立的理由：
 *
 * 1. **素材归属不同**：索菲亚的头像在 `assets/members/out-512/` 下按**梯队目录**组织、
 *    文件名就是规范职位名（20 个，见 `src/naming.ts` 的 `POSITIONS`）。
 *    「职位 → 路径」这份映射的**唯一真相在宿主半**
 *    （`src/host-data.ts` 的 `createAvatarPathResolver` 扫盘得出），
 *    经线格式的 `WireMember.avatarPath` 交给客户端 —— `src/wire.ts:90-99` 明文写着
 *    「客户端**不自己按职位名拼路径** …… 复制就是第二个真相」。
 * 2. **匹配方式不适用**：上游按「英文/中文关键词族」匹配（data / qa / engineer …），
 *    而索菲亚的职位名是一个**闭集**（20 个纯中文规范名，`naming.ts` 的裁定 Q-D），
 *    不存在需要正则归类的开放集合。
 * 3. **客户端 import 不了 `naming.ts`**：那个文件 `import { randomBytes } from 'node:crypto'`
 *    （`src/naming.ts:30`）⇒ 进浏览器半就是 `TS2307` / 运行期 `ReferenceError`。
 *    所以「客户端自己按职位查梯队目录」这条路在索菲亚是**结构性不可行**的，
 *    不是风格取舍。
 *
 * ⇒ 结果：本文件的 `memberArtUrl` 只做一件事 —— 把宿主给的相对路径翻成可用 URL，
 * 判据**复用** `src/avatar-paths.ts` 的白名单（不另写一份）。
 *
 * @module dsh-agent-teams/client/artwork
 *   （保留上游的 @module 标签：本文件是它那份的移植件，跟上游版本时靠这行对得上号。）
 */

import { AVATAR_ROUTE, avatarUrlFor, resolveAvatarUrl } from '../../../avatar-paths.ts'

/**
 * 头像路由前缀。
 *
 * 上游是它自己打包素材的插件路由 `/plugins/dsh-agent-teams/assets/`。
 * 索菲亚的等效物是宿主的 `GET /api/sophia/avatar?path=`（`src/avatar-paths.ts:62`
 * 的 `AVATAR_ROUTE`，路由实现在 `src/host.ts`）。
 *
 * 保留这个名字只是为了让「上游有这个导出、索菲亚也有」这件事可核对；
 * 本文件内部一律走 `avatarUrlFor()`（它自己拼 `${AVATAR_ROUTE}?path=`），
 * 所以这个常量**不是**第二个真相 —— 它就是 `AVATAR_ROUTE` 的别名。
 */
export const ART_BASE: string = AVATAR_ROUTE

/**
 * 队长（团长）头像的**仓库相对路径**。
 *
 * ⚠ 这是客户端**唯一**一处硬编码的素材路径，理由必须写清（否则它看起来像是
 * 「客户端在自己拼路径」，正是上面第 1 条禁止的事）：
 * 面板左上角的「队长」节点**不是一个 roster 成员** —— 它没有 `WireMember`，
 * 也就没有宿主给的 `avatarPath` 可透传（上游那份同样是常量：`LEAD_ART`）。
 * 索菲亚的队长 = 名册第一位 `钦天监监正`（`src/naming.ts:49` 的 `POSITIONS[0]`，
 * 第一梯队 · 管理与总控组）。
 *
 * 可核验取值（本机实测）：
 * - 文件存在：`C:\Users\Administrator\Sophia-agent-entities\assets\members\out-512\01_第一梯队_管理与总控组\钦天监监正.png`
 * - 通过 `sanitizeAvatarPath` 的三道门：以 `assets/members/` 开头 / 逐段非空非 `..` /
 *   扩展名 `.png`（`src/avatar-paths.ts:77-112`）。
 *
 * ⚠ 素材改名或换目录时**必须同步这一行**；换名后 `avatarUrlFor` 仍会返回合法 URL
 * （它只校验**形状**、不碰文件系统），所以失效表现为**图片 404**，不会静默画错图。
 */
export const LEAD_AVATAR_PATH = 'assets/members/out-512/01_第一梯队_管理与总控组/钦天监监正.png'

/**
 * 队长头像 URL。
 *
 * `?? ''` 的那一支对上面这个字面量**不可达**（形状已核对，见 `LEAD_AVATAR_PATH`）；
 * 留着它是因为类型上 `avatarUrlFor` 可能返回 `null`，而 `src=""` 只会渲染成
 * 浏览器的破图占位，不会崩、不会影响其它节点。
 */
export const LEAD_ART: string = avatarUrlFor(LEAD_AVATAR_PATH) ?? ''

/**
 * 成员状态动作插画（上游：`action-working-v2.png` / `action-sleeping-v2.png` /
 * `action-thinking-v2.png` 三张鲸鱼动作图，叠在成员头像右下角）。
 *
 * 索菲亚**没有**这套素材，且不是漏抄 —— 实测盘点
 * （`Get-ChildItem C:\Users\Administrator\Sophia-agent-entities\assets -Recurse -File`）：
 * **41 个文件**，其中 **32 张 PNG** = 20 张成员立绘（`assets/members/out-512/**`，
 * 4 个梯队目录 × 5 张，512×512）+ 12 张校对/合成产物（`assets/members/` 2 张、
 * `assets/members/_inspect/**` 10 张），**没有任何按状态分档的动作插画**。
 *   （上一版这里写「+ 3 张校对/预览图」，与实测的 12 张不符，已改正。）
 *
 * ⇒ 三条都映射成 `null`（**不是**占位图、**不是**外链、**不是**复用成员立绘糊一个），
 * `ActivityPanel` 据此**不渲染** `css.stateArt` 那个 `<img>`；成员的忙/闲状态仍由
 * 上游既有的 `data-activity` 属性表达（面板的选择器与类名一个都没动）。
 * 将来若真做出这三个状态图，把对应项从 `null` 改成 `avatarUrlFor(<路径>)` 即可。
 *
 * ⚠ 类型写成 `string | null`（而不是上游的 `Record<…, string>`）：这正是「诚实地
 * 表示『这个素材不存在』」的类型表达 —— 若写成 `string` 并填 `''`，
 * 界面会得到一个 `src=""` 的破图元素，看起来像加载失败而不是「没有这套素材」。
 */
export const ACTION_ART: Record<'working' | 'idle' | 'unknown', string | null> = {
  working: null,
  idle: null,
  unknown: null,
}

/**
 * 成员头像 URL，认不出时返回 `null`（调用方走首字降级，与上游同一条分支）。
 *
 * ## 为什么签名与上游不同（`(name, role)` → `(member)`）
 *
 * 上游按 `name + role` 做正则匹配，所以必须把这两个字段传进来。
 * 索菲亚的判据是宿主给的 `avatarPath`（见文件头三条理由）——`name`/`role`
 * 已经不再参与任何判断，留着它们会暗示「名字会影响选图」，那是**假的**接口。
 * ⇒ 收窄成只吃 `avatarPath` 的入参形状，与 `resolveAvatarUrl` 的入参一致。
 *
 * ⚠ 本函数是 `src/avatar-paths.ts:154` 的 `resolveAvatarUrl` 的**别名**，
 * 不是它的第二份实现：路径白名单只有那一处（同一份判据同时被宿主侧的
 * `resolveAvatarFile` 使用，抄一份就等着两边漂移）。
 *
 * @param member - 只要带 `avatarPath` 即可（`ActivityMember` / `WireMember` 都满足）。
 * @returns `<img src>` 可用的 URL，或 `null`。
 */
export function memberArtUrl(member: {
  readonly avatarPath?: string | undefined
}): string | null {
  return resolveAvatarUrl(member)
}
