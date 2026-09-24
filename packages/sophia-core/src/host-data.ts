/**
 * 宿主侧**数据面**：把账本 + 投影折成线格式（`WireView`），并实现三条数据路由的
 * 纯逻辑部分。路由注册留在 `src/host.ts`（它管插件外壳），本文件管「取数 + 组装」。
 *
 * ## 为什么单独一个文件，而不是塞进 `host.ts`
 *
 * `host.ts` 的职责是「让插件被 DSH 正确加载」（外壳、双键回退、回环门、可逆性）。
 * 取数逻辑与它无关，且**必须能在没有 webserver、没有 cordx ctx 的情况下单测** ——
 * 塞在一起就只能通过「注册路由再伪造 req/res」来测，那是间接且脆的。
 *
 * ## 三条路由（与 t5 的 client 契约逐字对齐）
 *
 * | 路由 | client 调用点 | 本文件的实现 |
 * |---|---|---|
 * | `GET /api/sophia/view` | `panel-store.ts` `VIEW_ROUTE` | {@link buildWireView} |
 * | `GET /api/sophia/avatar?path=` | `avatar.ts` `AVATAR_ROUTE` | {@link resolveAvatarFile} |
 * | `POST /api/sophia/member/model` | `panel-store.ts` `MODEL_SWITCH_ROUTE` | {@link switchMemberModel} |
 *
 * ## 安全要点（头等，勿简化）
 *
 * 头像路由的 `path` 是**外部输入**。`%2e%2e%2f` 解码后仍是 `../` ⇒
 * 「前端已经编码过」**不提供任何安全性**。因此本文件在**解码之后**重新跑
 * t5 的 `sanitizeAvatarPath`（**复用，不重写** —— 抄一份就是第二个真相，
 * 且两处会各自漂移），并在其后追加一道**归一化后的前缀复核**作为纵深防御。
 *
 * @module @sophia/core/host-data
 */

import { readFileSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'

// ⚠ 这两个 import 都指向 `src/` 下的**宿主侧中立**文件，**不得**改成 `./client/...`
// （那是浏览器半：`src/client/` 里有 DOM 引用，而宿主 tsconfig 无 DOM）。
// 实测过的真实故障：`./client/view-model.ts` 会顺着 `locales.ts` 把 `document`
// 拉进宿主 program，契约命令 `npx tsc --noEmit -p .../tsconfig.json` 直接 exit 2
// —— `exclude: ["src/client"]` 拦不住被 import 拉进来的文件。
// 详见 `src/wire.ts` / `src/avatar-paths.ts` 的文件头。
import { sanitizeAvatarPath } from './avatar-paths.ts'
import {
  allocateMemberName,
  newUuid8,
  toMemberId,
  validatePosition,
  type NameOccupancy,
  type NamingViolation,
} from './naming.ts'
import {
  projectChannel,
  projectChannelMessages,
  projectRoster,
  rebuildFold,
  type ProjectionFold,
  type RosterMember,
} from './projection/index.ts'
import type { Ledger } from './ledger.ts'
// ⚠ 这两个 import 的方向是**宿主数据面 → 工具面**（写账本与唤醒这两件事的唯一实现在那边）。
// 反方向（工具面 import host-data）会是循环，且工具面**不得**依赖宿主外壳；
// 而这里只是调两个 `deps` 无关的函数（`writeMessageSent`）或把运行时交进去的函数
//（`wakeMemberForMessage`），没有把宿主外壳拖进工具面。
// 为什么不自己 commit / 自己拼通知：见 `writeMessageSent` / `wakeMemberForMessage` 的文档
// —— 载荷字段/id 生成/actor 口径、以及待办项 ref/去重签名/通道选择，各写一份必然漂移。
import {
  SOPHIA_REPLY_REF_MARKER,
  wakeMemberForMessage,
  writeMessageSent,
  type MessageNotifier,
  type TeamMessageDelivery,
} from './tools/message.ts'
import type { MemberLogger } from './runtime/member-runtime.ts'
import type { ChannelId, DagTeamId, MemberId, TeamId, ThreadId } from './types/index.ts'
import type {
  WireChannel,
  WireMember,
  WireMessage,
  WirePendingPlan,
  WireTeam,
  WireThread,
  WireView,
} from './wire.ts'

/** 头像素材在仓库根下的目录（与 `avatar.ts` 的 `AVATAR_ROOT` 同源）。 */
const AVATAR_DIR_PARTS: readonly string[] = ['assets', 'members', 'out-512']

/**
 * 非负安全整数（序号 / 计数类字段的唯一合法形状）。
 *
 * 为什么用 `Number.isSafeInteger` 而不是 `isFinite`：后者放行小数与超出 2^53 的整数，
 * 而 `JSON.stringify` 会把 `NaN`/`Infinity` 写成 `null` ⇒ 两个**不同**的值会落成
 * **同一个** `null`。语义与 `src/tools/internal.ts:60` 的同名函数逐字同源；
 * 这里**本地重写**而不是 import：`tools/` 那一层是**工具面**的内部模块，
 * 宿主数据面反向依赖它会把分层倒过来（且 `internal.ts` 的文件头写明「不导出内部符号」）。
 * 三行纯函数重复一次，比建立一条方向错误的依赖便宜。
 */
function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

/** 把一个值渲染成适合放进错误信息的短文本（**绝不抛错**）。 */
function describeValue(value: unknown): string {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value)
  }
  try {
    const json = JSON.stringify(value)
    return typeof json === 'string' ? json : `一个 ${typeof value}（无 JSON 表示）`
  } catch {
    // 循环引用 / toJSON 抛错 ⇒ 退回类型名：渲染错误信息这件事本身绝不能抛。
    return `一个 ${typeof value}（无法序列化）`
  }
}

/**
 * 头像路径 → 绝对路径的解析结果。
 *
 * 用「查到 / 查不到」的显式联合而不是 `string | null`：调用方要能把
 * 「路径不合法」（400）与「素材不存在」（404）分开回答，而这两种失败
 * 对用户是**不同的事**（前者是攻击或客户端 bug，后者是素材缺失）。
 */
export type AvatarResolution =
  | { readonly kind: 'ok'; readonly absolutePath: string }
  | { readonly kind: 'rejected'; readonly reason: string }
  | { readonly kind: 'missing'; readonly reason: string }

/**
 * 把「仓库相对的头像路径」解析成磁盘绝对路径，并做两道校验。
 *
 * @param repoRoot - 仓库根目录的绝对路径。
 * @param rawPath - **已 `decodeURIComponent` 过**的路径（来自查询参数）。
 * @returns 解析结果；绝不抛（失败以联合成员形式返回）。
 */
export function resolveAvatarFile(repoRoot: string, rawPath: string): AvatarResolution {
  // ── 第 1 道：复用 t5 的**逐段白名单**判据 ──
  // 这一步必须在 decode **之后**：`%2e%2e%2f` 解码后才现出 `../`。
  const safe = sanitizeAvatarPath(rawPath)
  if (safe === null) {
    return { kind: 'rejected', reason: 'path 不在头像素材白名单内（逐段白名单拒绝）' }
  }

  // ── 第 2 道：归一化后的前缀复核（纵深防御，不是第 1 道的替代）──
  // 为什么还要它：第 1 道是**纯字符串**判据。这里把解析后的绝对路径与素材根
  // 都归一化后比前缀，于是「解析结果在词法上确实落在素材根下」成为结构性事实。
  // 前缀比较带 `sep`：避免 `/a/bb` 被 `/a/b` 误判为前缀。
  //
  // ⚠ **它挡不住符号链接**（OCR 复核 LOW [32] 指出的真缺陷：初版注释宣称它
  //   能挡链接，而 `path.resolve` 是**纯词法**的、根本不碰文件系统 —— 那句话是假的，
  //   已按实测改正）。链接的防护在第 3.5 道（realpath 复核）里，见下。
  const assetsRoot = resolve(repoRoot, ...AVATAR_DIR_PARTS)
  const absolutePath = resolve(repoRoot, safe)
  if (absolutePath !== assetsRoot && !absolutePath.startsWith(assetsRoot + sep)) {
    return { kind: 'rejected', reason: 'path 归一化后跑出了头像素材根（疑似编码绕过）' }
  }

  // ── 存在性 ──
  try {
    if (!statSync(absolutePath).isFile()) return { kind: 'missing', reason: '不是普通文件' }
  } catch {
    return { kind: 'missing', reason: '素材不存在' }
  }

  // ── 第 3.5 道：realpath 复核（**这一道**才是真正挡符号链接的）──
  // 为什么必须有：`assets/members/out-512/evil.png` 可以是**指向任意文件**的符号链接，
  // 那样前两道（纯词法）全部通过，而 `readFileSync` 会忠实地把目标文件读出来。
  // `realpathSync` 解析链接后再比一次前缀，才把「真的在素材根下」变成事实。
  // 放在存在性检查**之后**：realpath 要求路径存在。
  //
  // ⚠ **返回的必须是 `realPath`，不能是词法的 `absolutePath`**（队长核实的安全缺陷，
  //   已修）。原实现校验 `realPath` 却返回 `absolutePath` ⇒ **校验的对象与实际打开的对象
  //   不是同一个路径** ⇒ 校验通过之后、`readFileSync` 之前的那段窗口里，链接可以被换成
  //   指向根外（TOCTOU）。返回 `realPath` 把窗口**大幅收窄** —— 被验证与被读取的是同一
  //   个字符串；OCR [第四轮] 指出措辞曾写成「窗口消失」，那是过强声明：
  //   `readFileSync` 仍会重新解析路径，理论上残留窄窗（彻底关闭需 openSync+fstatSync
  //   同 fd 读）。本函数承诺的是「收窄」，不是「原子关闭」。
  let realPath: string
  try {
    const realRoot = realpathSync(assetsRoot)
    realPath = realpathSync(absolutePath)
    if (realPath !== realRoot && !realPath.startsWith(realRoot + sep)) {
      return { kind: 'rejected', reason: 'path 经符号链接解析后跑出了头像素材根（疑似链接绕过）' }
    }
  } catch {
    // 解析不了（权限/竞态/文件刚被删）⇒ 保守拒绝，不当作通过。
    // 与仓库既有口径一致：读不到就判不可用，而不是当成没问题。
    return { kind: 'missing', reason: '素材路径无法解析（realpath 失败）' }
  }
  return { kind: 'ok', absolutePath: realPath }
}

/** 读取头像字节；失败返回 `null`（调用方答 404）。 */
export function readAvatarBytes(absolutePath: string): Buffer | null {
  try {
    return readFileSync(absolutePath)
  } catch {
    return null
  }
}

/**
 * 头像素材根在**仓库相对**路径里的那一段（`assets/members/out-512`，正斜杠）。
 *
 * ⚠ 从 `AVATAR_DIR_PARTS` **推导**，不手写字符串（OCR 复核 LOW [9]）：
 * 初版写的是 `AVATAR_DIR_PARTS.slice(2)` 硬编码下标 —— `AVATAR_DIR_PARTS`
 * 一旦增减前缀，那个 `2` 就会静默取错段，拼出一条错误的相对路径，
 * 而症状只是「头像 404」，极难追。这里改成从**权威常量**派生。
 */
const AVATAR_REL_ROOT = `${AVATAR_DIR_PARTS.join('/')}/`

/**
 * `repoRoot` → 已建好的「职位 → 相对路径」表。
 *
 * ⚠ 为什么要有这个缓存（OCR 复核 MEDIUM [10]）：`buildWireView` 每次调用都会
 * 建一次解析器，而 `GET /api/sophia/view` 是**热路径**（界面在轮询它）。
 * 每次轮询都同步递归扫 4 个梯队目录 = 每轮都阻塞一次事件循环，
 * 且开销随素材树规模增长。素材在**一次进程生命周期内**不会变（它们是随包发布的
 * PNG，不参与编辑），所以按 `repoRoot` 缓存是安全且必要的。
 *
 * ⚠ 上限（OCR 复核 LOW [2]）：生产里只有**一个** root，但测试会造很多临时 root，
 * 无上限的 Map 会把那些字符串与整份素材表**永久**留在进程里。
 * ⇒ 按插入序淘汰最旧的一条（FIFO）。上限取 8：够覆盖「多条生产线/多个测试文件
 * 交错」的实况，又不会把临时目录攒住。
 *
 * 失效策略：**本进程内不失效**（素材不在运行期变）。若哪天需要热更新素材，
 * 正确做法是**重启插件**，而不是给热路径加一次 mtime 探测 ——
 * 后者会把缓存的价值吃掉一半，而需求并不存在。
 * 代价如实记：同一个 root 路径下**改动了素材树**（测试里会发生）会读到旧表。
 * 测试若要验「重扫」，用**新的 root 路径**而不是改同一个根。
 */
/**
 * 按 `repoRoot` 缓存的**扫描结果**（含失败信息，见 `createAvatarPathResolver`）。
 *
 * `error` 与 `notified` 是 OCR 复核 [30] 补的：缓存对**失败**也生效（热路径必需），
 * 于是「首个调用者没给回调 ⇒ 诊断永久丢失」必须由缓存项自己记住，
 * 交给**第一个带回调的**调用者补报一次。
 */
interface AvatarPathCacheEntry {
  readonly table: Map<string, string>
  /** 扫描时的错误；`undefined` = 扫成功。 */
  readonly error: unknown
  /** 该错误是否已经报过一次（避免在轮询热路径上刷日志）。 */
  notified: boolean
}

const avatarPathCaches = new Map<string, AvatarPathCacheEntry>()
/** 缓存上限（见 {@link avatarPathCaches}）。 */
const AVATAR_CACHE_LIMIT = 8

/**
 * 职位 → 头像相对路径的解析器（按**磁盘实况**建表，不复制第二份映射）。
 *
 * ⚠ 关键设计（别改成硬编码梯队目录名）：素材文件名就是规范职位名
 * （`naming.spec.ts` 对「名册 ↔ 素材目录」有双向断言），而**梯队目录名**
 * （`01_第一梯队_管理与总控组` …）只存在于磁盘上。若在这里写死「职位 → 目录」，
 * 就是继 `POSITIONS` 之后的**第二个真相** —— 素材目录一改，两边就分叉，
 * 且分叉是静默的（界面只是少个头像）。
 * ⇒ 这里**扫一次目录**建表：`职位.png` 在哪个目录下，它的相对路径就是那条。
 *
 * @param repoRoot - 仓库根绝对路径。
 * @param onScanFailure - 扫不动时的回调（OCR 复核 MEDIUM [7]）：初版静默 `catch {}`，
 *   于是「`SOPHIA_REPO_ROOT` 配错 / 素材目录被改名」与「这个职位就是没有头像」
 *   在**任何地方都不可区分** —— 界面只是少个头像，日志里一个字都没有。
 *   默认 `undefined` = 不报（纯函数便于测试），由宿主传入 `console.error`。
 * @returns 解析函数；同一 `repoRoot` 只扫一次盘（见 {@link avatarPathCaches}）。
 */
export function createAvatarPathResolver(
  repoRoot: string,
  onScanFailure?: ((error: unknown) => void) | undefined,
): (position: string) => string | undefined {
  const cached = avatarPathCaches.get(repoRoot)
  if (cached === undefined) {
    const assetsRoot = resolve(repoRoot, ...AVATAR_DIR_PARTS)
    /** 职位名 → 仓库相对路径。 */
    const byPosition = new Map<string, string>()
    let scanError: unknown
    try {
      for (const dir of readdirSync(assetsRoot, { withFileTypes: true })) {
        if (!dir.isDirectory()) continue
        const dirAbs = join(assetsRoot, dir.name)
        for (const file of readdirSync(dirAbs, { withFileTypes: true })) {
          if (!file.isFile() || !file.name.toLowerCase().endsWith('.png')) continue
          const position = file.name.replace(/\.png$/i, '')
          // 相对路径用正斜杠（线格式是 URL 语义，Windows 的反斜杠会被前端判为非法）。
          byPosition.set(position, `${AVATAR_REL_ROOT}${dir.name}/${file.name}`)
        }
      }
    } catch (error) {
      // 素材目录缺失/不可读**不是致命错误**（界面退回「首字 + 姓名」，t5 已实现降级），
      // 但**必须留痕** —— 否则「素材没了」与「这职位没头像」无从区分。
      scanError = error
      onScanFailure?.(error)
    }
    // ⚠ 失败的**记在缓存里**（OCR 复核 [30]，已修）：缓存是**无条件**写入的
    //（包括扫失败那次，这是热路径 `/view` 必需的 —— 不能每轮都重扫盘）。
    // 但若**首个**调用者没给 `onScanFailure`，那条诊断就永久丢失了：
    // 后来**带着**回调的调用者只会命中缓存、拿到空表，**永远不会知道扫失败过**。
    // ⇒ 记下错误；由**第一个带回调的**调用者补报一次，之后置 `notified` 不再重复
    //（既不丢诊断，也不在轮询的热路径上刷日志）。
    const entry: { table: Map<string, string>; error: unknown; notified: boolean } = {
      table: byPosition,
      error: scanError,
      // 上面已经报过（或有回调）就算已通知；没回调时才留给后来者补报。
      notified: scanError === undefined || onScanFailure !== undefined,
    }
    avatarPathCaches.set(repoRoot, entry)
    // 超限就丢最旧的一条（Map 保证插入序，见 AVATAR_CACHE_LIMIT 的理由）。
    while (avatarPathCaches.size > AVATAR_CACHE_LIMIT) {
      const oldest = avatarPathCaches.keys().next()
      if (oldest.done === true) break
      avatarPathCaches.delete(oldest.value)
    }
    return (position: string) => byPosition.get(position)
  }
  // ── 命中缓存 ──
  // 若首次扫描**失败**且当时没有回调，这里补报一次（见上面的 `entry` 说明）。
  if (cached.error !== undefined && !cached.notified) {
    cached.notified = true
    onScanFailure?.(cached.error)
  }
  const table = cached.table
  return (position: string) => table.get(position)
}

/** 把投影名册里的一员转成线格式成员。 */
function toWireMember(member: RosterMember, avatarPathOf: (position: string) => string | undefined): WireMember {
  const avatarPath = avatarPathOf(member.position)
  return {
    memberId: member.memberId,
    position: member.position,
    name: member.name,
    displayName: member.displayName,
    lifecycle: member.lifecycle,
    tombstone: member.tombstone,
    model: member.model === null ? null : { provider: member.model.provider, model: member.model.model },
    // `exactOptionalPropertyTypes` 下「可选」与「显式 undefined」不同：
    // 不给就不要这个键（线格式里 `avatarPath` 缺失 = 客户端走降级分支）。
    ...(avatarPath === undefined ? {} : { avatarPath }),
  }
}

/**
 * 组装一个团的线格式视图。
 *
 * @param fold - 投影折叠结果。
 * @param teamId - 目标团。
 * @param avatarPathOf - 职位 → 头像相对路径。
 * @returns 线格式团视图；团不存在时返回 `null`。
 */
export function buildWireTeam(
  fold: ProjectionFold,
  teamId: TeamId,
  avatarPathOf: (position: string) => string | undefined,
): WireTeam | null {
  const roster = projectRoster(fold, teamId)
  if (roster === null) return null

  // 团队级中止（`team/destroyed`）：被中止的团**不再进 wire 视图** ——
  // 收件箱/活动面板不再显示它（主人：演示团删不掉、一直占空间）。
  // 它的账本历史完好（投影只是打标，不删事实）⇒ 审计可查。
  const teamFact = fold.teams.get(teamId)
  if (teamFact !== undefined && teamFact.destroyedAtSequence !== undefined) return null

  // ⚠ 消息按**本团的频道**收集，而不是把 `fold.messages` 全量倒出来。
  //
  // 理由不是洁癖：`fold` 来自 `rebuildFold`（不带 scopes ⇒ 全量），它里面**同时**
  // 装着别的团的消息。原样倒出会让团 A 的视图里出现团 B 的消息 —— 界面按
  // `channelId` 也能对上号，于是这条越界**在界面上看不出来**（显示得像本团的历史）。
  // `roster.channelIds` 就是本团频道的**唯一权威来源**（`projectRoster` 已按
  // `channel.teamId === teamId` 筛过），因此遍历它 = 只取本团消息，不需要再维护
  // 一份 `Set<ChannelId>` 白名单（两份判据迟早会分叉）。
  //
  // 频道之间按 `roster.channelIds` 的顺序拼接（该顺序是「频道创建序号升序」），
  // 保证同一次重建的产出**逐字稳定** —— 否则「视图有没有变」这种判断会被
  // Map 迭代顺序的抖动污染。
  const messages: WireMessage[] = roster.channelIds.flatMap((channelId) =>
    projectChannelMessages(fold, channelId).map((fact) => ({
      messageId: fact.messageId,
      channelId: fact.channelId,
      threadId: fact.threadId,
      // ⚠ **人类（主人）经面板发的消息在这里是空串**（`fact.senderMemberId === null`）。
      // 理由（本处是本批唯一一处 `null → ''` 的换算，别处不要复制这个技巧）：
      // - 线格式的 `senderMemberId` 是 `string`，**不改它的类型**是为了不打断正在并行
      //   改 `src/client/**` 的两个 agent：`adapters.ts` 把 `message.senderMemberId`
      //   塞进 `Set<string>`，改成 `string | null` 会让他们的文件**编译不过**。
      // - 空串**不可能**是任何成员的 id（成员 id 形态见 `types/ids.ts`：
      //   `sophia-<职位 slug>-<uuid8>`，恒非空；投影层也用 `asNonEmptyString` 挡空串），
      //   所以成员名解析（`adapters.ts` 的 `actorOf`）**不可能**把主人显示成某个成员 ——
      //   它查不到就退回 id 原样显示，于是显示成空白名。
      // 代价如实记下：界面现在把主人自己发的消息渲染成**没有名字的气泡**；
      // 要让界面上写「主人 / 你」，需要客户端加一处「非成员发送者」的渲染（本批未做）。
      // 谁是发送者（哪个人类）在账本里由事件基座的 `actor` 承载，线格式不含它。
      senderMemberId: fact.senderMemberId === null ? '' : fact.senderMemberId,
      body: fact.body,
      // ⚠ 时间来自投影层抄下的**事件基座 `occurredAt`**，不是 `event.data`
      // （`data` 里没有它，见 `types/operations.ts` 的 `MessageSentData`）。
      // 契约形状见 `src/wire.ts:120-127`。
      occurredAt: fact.occurredAt,
    })),
  )

  const channels: WireChannel[] = roster.channelIds.map((channelId: ChannelId) => {
    // ⚠ 线程用 `projectChannel`（它读 fold 的 threads 表），**不是**按 scope 再查账本。
    // 理由（任务书点名）：`team/thread-started` 的 changeScope 是 `[]`，
    // 任何**带 scopes 的增量读取都看不见线程**。本文件的 fold 由 `rebuildFold`
    // 不带 scopes 重建，因此线程是全的；`coverage.scoped=false` 如实告诉界面这条。
    const snapshot = projectChannel(fold, channelId)
    const threads: WireThread[] = snapshot.threads.map((thread) => ({
      threadId: thread.threadId,
      channelId: thread.channelId,
      title: thread.title,
      assigneeMemberId: thread.assigneeMemberId === null ? null : String(thread.assigneeMemberId),
    }))
    return {
      channelId,
      title: snapshot.channel === null ? '' : snapshot.channel.title,
      threads,
    }
  })

  return {
    teamId: roster.team.teamId,
    name: roster.team.name,
    kind: roster.team.kind,
    members: roster.members.map((member) => toWireMember(member, avatarPathOf)),
    channels,
    // `messages` 已经不是空态：账本有了承载它的 `team/message-sent`
    //（`src/types/operations.ts` 的 `MessageSentData`），生产者在
    // `src/tools/message.ts`（起线程与回复两条路径都落这一条）。
    // ⚠ 它**只**含本团频道下的消息（见上面「按本团频道收集」那段的说明）。
    //
    // 下面两项**如实留空**，不是偷懒：账本的 `LedgerEventMap` 里仍然
    // **没有任何** task / activity 事件 kind（`messages` 是本次新增的那一个）。
    // 线格式留着这两个字段是为了让界面与未来版本兼容，但**当前没有任何生产者** ——
    // 凭空造几条出来才是真正的错（那会让界面显示从未发生过的活动，
    // 与「账本是唯一真相」直接冲突）。
    messages,
    tasks: [],
    activity: [],
  }
}

/** `buildWireView` 的可选参数。 */
export interface BuildWireViewOptions {
  /** 仓库根（用于解析头像素材）。省略 = 只返回 `avatarPath` 字段即可，不扫素材。 */
  readonly repoRoot?: string | undefined
  /** 扫素材失败时的回调（诊断用；见 `createAvatarPathResolver`）。 */
  readonly onAvatarScanFailure?: ((error: unknown) => void) | undefined
}

/**
 * 从账本重建整份线格式视图（`GET /api/sophia/view` 的载荷）。
 *
 * @param ledger - 账本句柄。
 * @param options - 见 {@link BuildWireViewOptions}。
 * @returns 线格式视图；`ok` 反映「这次读取是否成功」。
 */
export function buildWireView(ledger: Ledger, options: BuildWireViewOptions = {}): WireView {
  const avatarPathOf = options.repoRoot === undefined
    ? (): undefined => undefined
    : createAvatarPathResolver(options.repoRoot, options.onAvatarScanFailure)

  try {
    // 不带 scopes ⇒ 全量、且**看得到线程**（见 `buildWireTeam` 的说明）。
    const outcome = rebuildFold(ledger)
    const fold = outcome.fold
    const teams: WireTeam[] = []
    for (const teamId of fold.teams.keys()) {
      const team = buildWireTeam(fold, teamId, avatarPathOf)
      if (team !== null) teams.push(team)
    }
    // 审批票 → wire（文档 3.6 审批区）。按首次入账序号升序 —— 待办顺序稳定。
    const pendingPlans: WirePendingPlan[] = []
    const tickets = [...fold.spawnTickets.values()]
      .sort((left, right) => left.raisedAtSequence - right.raisedAtSequence)
    for (const fact of tickets) {
      pendingPlans.push({
        requestId: fact.requestId,
        targetKind: fact.targetKind,
        status: fact.status,
        name: fact.spec.name,
        requesterMemberId: fact.requesterMemberId,
        roster: fact.spec.roster.map((entry) => ({
          position: entry.position,
          count: entry.count,
          // TeamSpec（输入侧）是 `? | null`，wire（记录侧口径）必填可空 —— 归一。
          model: entry.model ?? null,
        })),
        tasks: [...fact.spec.tasks],
        reason: fact.reason,
        humanOperatorId: fact.humanOperatorId,
        raisedAtSequence: fact.raisedAtSequence,
      })
    }
    return {
      ok: true,
      teams,
      pendingPlans,
      // DAG 团表（文档 5 · DagCanvas 数据源）：owner / 任务当前态如实透出。
      dagTeams: [...fold.dagTeams.values()].map((dag) => ({
        dagTeamId: dag.dagTeamId,
        ownerMemberId: dag.ownerMemberId,
        parentTeamId: dag.parentTeamId,
        tasks: [...dag.tasks.entries()].map(([taskId, task]) => ({
          taskId,
          state: task.state,
          reason: task.reason,
        })),
      })),
      // 如实透传投影层数出来的两件事（客户端只显示、不自己算）：见 `WireView` 的说明。
      coverage: {
        scoped: outcome.coverage.scoped,
        unscopedKindsOmitted: [...outcome.coverage.unscopedKindsOmitted],
      },
      malformedEvents: fold.malformedEvents,
      unresolvedReferences: fold.unresolvedReferences,
    }
  } catch (error) {
    // 读账本失败 → 如实回 `ok:false` + 可读原因（界面走 error 态并给重试按钮），
    // **不是**抛给路由层（那样会变成 500 + 空 body，界面只能显示「HTTP 500」）。
    return {
      ok: false,
      error: `读账本失败：${error instanceof Error ? error.message : String(error)}`,
      teams: [],
      pendingPlans: [],
      dagTeams: [],
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// 换模（POST /api/sophia/member/model）
// ────────────────────────────────────────────────────────────────────────────

/** 换模入参（来自请求体，**外部输入** ⇒ 逐字段校验）。 */
export interface SwitchModelRequest {
  readonly memberId: string
  readonly provider: string
  readonly model: string
  readonly reason: string
}

/** 换模结果。 */
export type SwitchModelResult =
  | { readonly kind: 'ok'; readonly sequence: number }
  | { readonly kind: 'unknown-member'; readonly reason: string }
  | { readonly kind: 'unknown-current-model'; readonly reason: string }
  | { readonly kind: 'no-change'; readonly reason: string }
  /**
   * 写序校验失败：事件**已写入**（不可撤销），但 `receipt.sequence` 与预测不符。
   *
   * ⚠ 它不是「失败」而是「写进去了、但那条载荷里的 `effectiveAtSequence` 可能是错的」
   * —— 两者对调用方的处置完全不同（前者可重试，后者**不能**重试，重试会写第二条）。
   * 与 t4 `switch-model.ts` 的 `sequence-mismatch` 同一语义与同一措辞口径。
   */
  | { readonly kind: 'sequence-mismatch'; readonly predicted: number; readonly actual: number; readonly reason: string }
  | { readonly kind: 'failed'; readonly reason: string }

/**
 * 一个非空字符串字段的校验 + **裁剪**。
 *
 * ⚠ 必须**裁剪**，不能只判非空（OCR 复核 MEDIUM [30]）。t4 已在同族字段上
 * 踩过并写明后果（`src/tools/internal.ts` 的 `narrowTrimmedString` 文件头）：
 * 一个看起来无害的 `' deepseek '` 带着空格一路写进账本 ⇒ 与当前模型**不相等**
 * ⇒ 同模型短路失效 ⇒ **写出一条 `from === to` 的假转换**，而账本不可改写。
 * 本路由是同一条链的另一半入口，**必须用同一判据**，否则从路由进来的空格
 * 照样能污染账本。
 *
 * @param value - 不可信输入。
 * @returns 裁剪后的值，或 `null`。
 */
function trimmedNonEmpty(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

/**
 * 把任意 JSON 收窄成 {@link SwitchModelRequest}。
 *
 * @param payload - 请求体解析后的值（不可信）。
 * @returns 合法时返回请求，否则返回可读原因。
 */
export function parseSwitchModelRequest(payload: unknown): SwitchModelRequest | string {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return 'body 必须是一个 JSON 对象'
  }
  const record = payload as Record<string, unknown>
  const memberId = trimmedNonEmpty(record['memberId'])
  const provider = trimmedNonEmpty(record['provider'])
  const model = trimmedNonEmpty(record['model'])
  const reason = trimmedNonEmpty(record['reason'])
  if (memberId === null) return 'memberId 必须是非空字符串'
  if (provider === null) return 'provider 必须是非空字符串'
  if (model === null) return 'model 必须是非空字符串'
  if (reason === null) return 'reason 必须是非空字符串'
  return { memberId, provider, model, reason }
}

/**
 * 审批决议请求（文档 3.6 Approve & Run 的入参；来自请求体 ⇒ 逐字段校验）。
 *
 * `operator` 是**批准者标识**（进 `humanOperatorId`，AC-5-9 非空）：
 * 面板批准时客户端可带上自己的标识；缺省 `'web-operator'` ——
 * 这是**显式默认**而非静默空值：账本上「谁批的」永远可答（经 Web 面批准）。
 * `reason` 在 reject 时若缺失给显式默认（human-rejected 载荷的 reason 是必填 string，
 * 不给默认就会在这里造出一个 400 分支去覆盖「人类否决了」这个事实本身）。
 */
export interface SpawnDecisionRequest {
  readonly requestId: string
  readonly decision: 'approve' | 'reject'
  readonly reason: string | null
  readonly operator: string
}

/**
 * 把任意 JSON 收窄成 {@link SpawnDecisionRequest}。
 *
 * @param payload - 请求体解析后的值（不可信）。
 * @returns 合法时返回请求，否则返回可读原因。
 */
export function parseSpawnDecisionRequest(payload: unknown): SpawnDecisionRequest | string {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return 'body 必须是一个 JSON 对象'
  }
  const record = payload as Record<string, unknown>
  const requestId = trimmedNonEmpty(record['requestId'])
  if (requestId === null) return 'requestId 必须是非空字符串'
  const decision = record['decision']
  if (decision !== 'approve' && decision !== 'reject') {
    return 'decision 必须是 "approve" 或 "reject"'
  }
  const reasonRaw = record['reason']
  let reason: string | null = null
  if (reasonRaw !== undefined && reasonRaw !== null) {
    const trimmed = trimmedNonEmpty(reasonRaw)
    if (trimmed === null) return 'reason 若提供必须是非空字符串'
    reason = trimmed
  }
  if (decision === 'reject' && reason === null) {
    reason = '（否决时未填写理由）'
  }
  const operator = trimmedNonEmpty(record['operator']) ?? 'web-operator'
  return { requestId, decision, reason, operator }
}

// ────────────────────────────────────────────────────────────────────────────
// 运营入口（文档 4 节 remote 面）：channel / member-add / lifecycle / dag 移交
//
// 与换模同构：parse 收窄（外部输入逐字段校验）+ do 函数（读投影 → commit，
// 绝不抛、结果联合）。actor 一律 `{kind:'human', humanId:'sophia-ui'}` ——
// 与换模路由同一口径：这些动作都是**人类在 Web 界面**上点的，不是成员自操作。
// ────────────────────────────────────────────────────────────────────────────

/**
 * Web 界面操作者的账本 actor（与换模路由同口径）。
 *
 * 导出是给 `POST /api/sophia/team/message` 用的：主人从面板手打的消息，
 * 发送者是**人类**而不是团内成员（见 `MessageSentData` 的 `senderMemberId: null` 说明）。
 * 复用同一个常量而不是在 host.ts 里另写一份 —— 两处各写一份就会在某天漂移出
 * 两个 humanId，而 `humanId` 是「谁干的」这条审计线索的一部分。
 */
export const WEB_ACTOR = { kind: 'human', humanId: 'sophia-ui' } as const

/** 新频道 id（与 createTeam 的 `team-<uuid8>` 同风格）。 */
function newChannelId(): ChannelId {
  return `channel-${newUuid8()}` as ChannelId
}

/** 运营入口的通用失败形态。 */
type OpFailure =
  | { readonly kind: 'unknown-team'; readonly reason: string }
  | { readonly kind: 'unknown-member'; readonly reason: string }
  | { readonly kind: 'unknown-dag'; readonly reason: string }
  | { readonly kind: 'no-change'; readonly reason: string }
  | { readonly kind: 'conflict'; readonly reason: string }
  | { readonly kind: 'naming-violation'; readonly violation: NamingViolation }
  | { readonly kind: 'failed'; readonly reason: string }

// ── createChannel ───────────────────────────────────────────────────────────

export interface CreateChannelRequest {
  readonly teamId: string
  readonly title: string
}

export function parseCreateChannelRequest(payload: unknown): CreateChannelRequest | string {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return 'body 必须是一个 JSON 对象'
  }
  const record = payload as Record<string, unknown>
  const teamId = trimmedNonEmpty(record['teamId'])
  const title = trimmedNonEmpty(record['title'])
  if (teamId === null) return 'teamId 必须是非空字符串'
  if (title === null) return 'title 必须是非空字符串'
  return { teamId, title }
}

export type CreateChannelResult =
  | { readonly kind: 'ok'; readonly channelId: string; readonly sequence: number }
  | Extract<OpFailure, { readonly kind: 'unknown-team' | 'failed' }>

/** 建频道：team 必须存在 → 落 `team/channel-created`。 */
export function createChannel(ledger: Ledger, request: CreateChannelRequest): CreateChannelResult {
  let fold: ProjectionFold
  try {
    fold = rebuildFold(ledger).fold
  } catch (error) {
    return { kind: 'failed', reason: `读账本失败：${error instanceof Error ? error.message : String(error)}` }
  }
  const teamId = request.teamId as TeamId
  if (!fold.teams.has(teamId)) {
    return { kind: 'unknown-team', reason: `账本里没有团队 ${request.teamId}` }
  }
  try {
    const channelId = newChannelId()
    const receipt = ledger.commit({
      kind: 'team/channel-created',
      data: { channelId, teamId, title: request.title },
      actor: WEB_ACTOR,
    })
    return { kind: 'ok', channelId, sequence: receipt.sequence }
  } catch (error) {
    return { kind: 'failed', reason: `落账失败：${error instanceof Error ? error.message : String(error)}` }
  }
}

// ── destroyTeam（团队级中止，2026-09-24）──────────────────────────────────────
// 主人的成品行为：「停止团队」按钮 = 真的把团停掉（不再占面板空间），
// 且已完成结果保留（账本 append-only，历史事件一条不删 —— 语义见 TeamDestroyedData）。

/** 团队中止请求体。`reason` 可选：人类在确认弹窗里可以不给理由。 */
export interface DestroyTeamRequest {
  readonly teamId: string
  readonly reason: string | null
}

/**
 * 把任意 JSON 收窄成 {@link DestroyTeamRequest}。
 * 判据口径与 `parseSpawnDecisionRequest` 一致（非空字符串 / reason 可空）。
 */
export function parseDestroyTeamRequest(payload: unknown): DestroyTeamRequest | string {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return 'body 必须是一个 JSON 对象'
  }
  const record = payload as Record<string, unknown>
  const teamId = trimmedNonEmpty(record['teamId'])
  if (teamId === null) return 'teamId 必须是非空字符串'
  let reason: string | null = null
  const reasonRaw = record['reason']
  if (reasonRaw !== undefined && reasonRaw !== null) {
    const trimmed = trimmedNonEmpty(reasonRaw)
    if (trimmed === null) return 'reason 若提供必须是非空字符串'
    reason = trimmed
  }
  return { teamId, reason }
}

export type DestroyTeamResult =
  | { readonly kind: 'ok'; readonly sequence: number }
  | Extract<OpFailure, { readonly kind: 'unknown-team' | 'failed' }>

/** 中止整团：team 必须存在 → 落 `team/destroyed`（幂等：重复中止返回 ok，不重复落账）。 */
export function destroyTeam(ledger: Ledger, request: DestroyTeamRequest): DestroyTeamResult {
  let fold: ProjectionFold
  try {
    fold = rebuildFold(ledger).fold
  } catch (error) {
    return { kind: 'failed', reason: `读账本失败：${error instanceof Error ? error.message : String(error)}` }
  }
  const teamId = request.teamId as TeamId
  const fact = fold.teams.get(teamId)
  if (fact === undefined) {
    return { kind: 'unknown-team', reason: `账本里没有团队 ${request.teamId}` }
  }
  // 幂等：已中止的团再点「停止」⇒ 直接 ok（不落第二条 destroyed —— 终态不可重复）。
  if (fact.destroyedAtSequence !== undefined) {
    return { kind: 'ok', sequence: fact.destroyedAtSequence }
  }
  try {
    const receipt = ledger.commit({
      kind: 'team/destroyed',
      data: { teamId, reason: request.reason },
      actor: WEB_ACTOR,
    })
    return { kind: 'ok', sequence: receipt.sequence }
  } catch (error) {
    return { kind: 'failed', reason: `落账失败：${error instanceof Error ? error.message : String(error)}` }
  }
}

// ── sendTeamMessage（面板 composer → 账本）──────────────────────────────────

/**
 * 面板 composer 的请求体。
 *
 * ⚠ **形状以调用方实际发的为准**，不是按文档猜的：唯一调用点是
 * `src/client/vendor/team/requests.ts` 的 `requestTeamMessage()`，它 POST 的是
 * `TeamMessageRequest = { threadRef, body, recipients }`（字段名就是 `threadRef`，
 * 不是 `threadId` —— 这里刻意保留调用方的字段名，避免同一条线上出现两个名字）。
 */
export interface SendTeamMessageRequest {
  readonly threadId: ThreadId
  readonly body: string
  /**
   * 结构化提及的成员 id（`@` 到的人）。**当前只做形状校验，不产生行为** ——
   * 为什么（以及代价）见 `sendTeamMessage` 的说明。
   */
  readonly recipients: readonly string[]
}

export function parseSendTeamMessageRequest(payload: unknown): SendTeamMessageRequest | string {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return 'body 必须是一个 JSON 对象'
  }
  const record = payload as Record<string, unknown>
  const threadId = trimmedNonEmpty(record['threadRef'])
  const body = trimmedNonEmpty(record['body'])
  if (threadId === null) return 'threadRef 必须是非空字符串'
  if (body === null) return 'body 必须是非空字符串'
  // ⚠ `body` 用 `trimmedNonEmpty` ⇒ **空白正文当场拒**。口径与账本侧一致：
  // 投影层对空正文 `malformed += 1` 丢弃（见 `projection/index.ts` 的 `team/message-sent`），
  // 若这里放行，界面会收到「发送成功」而消息**永远不出现**（写进去就被投影丢掉）。
  // 宁可 400 现在说清楚。
  //
  // `recipients` 可以省略（上游 `reply` 在无人被 @ 时就发空数组），但**给了就必须是
  // 非空字符串的数组**：不合形状当场拒，而不是先收下再忽略 ——
  // 收下一条读不懂的载荷、然后什么都不做，正是本仓最怕的「把读不懂读成成功」。
  const rawRecipients: unknown = record['recipients']
  const recipients: unknown = rawRecipients === undefined ? [] : rawRecipients
  if (!Array.isArray(recipients) || recipients.some((one) => trimmedNonEmpty(one) === null)) {
    return 'recipients 必须是（元素为非空字符串的）数组'
  }
  return {
    threadId: threadId as ThreadId,
    body,
    recipients: recipients as readonly string[],
  }
}

export type SendTeamMessageResult =
  | {
      readonly kind: 'ok'
      readonly messageId: string
      readonly sequence: number
      /** 落账用的时间戳（epoch 毫秒）。响应里换算成 ISO 串给界面。 */
      readonly occurredAt: number
      /**
       * 被 @ 的成员各自的唤醒结论（**尽力而为**，与 `sophia_team_message` 的
       * `delivery` 同一口径）。空数组 = 本次没有任何人被 @（`recipients` 为空）。
       *
       * ⚠ **落账失败不会回滚唤醒，唤醒失败也不会回滚落账**：账本是事实，
       * 通知是尽力而为（与 `delegation.ts` 对 inbox.push 失败的处置同一取舍）。
       */
      readonly wakes: readonly MessageWake[]
    }
  | { readonly kind: 'unknown-thread'; readonly reason: string }
  | { readonly kind: 'failed'; readonly reason: string }

/** 一个被 @ 的成员的唤醒结论。 */
export interface MessageWake {
  readonly recipientMemberId: string
  readonly delivery: TeamMessageDelivery
}

/**
 * 激活一个成员的端口（由宿主把 `MemberRuntime.activate` 适配成它）。
 *
 * 为什么要这一层而不是在 `sendTeamMessage` 里直接调 `runtime.activate`：
 * 前者只需要「激活/没激活 + 原因」这两件事，而 `activate` 的入参还包含
 * `presetId`（**只有宿主知道该挂哪个 preset**，见 `host-agent-deps.ts` 的
 * `SOPHIA_MEMBER_PRESET_ID`）。把 preset 的选择塞进数据面 = 让数据面拥有一份
 * 它不该有的部署知识。
 */
export type MemberActivator = (input: {
  readonly memberId: MemberId
  readonly teamId: TeamId
}) => Promise<MemberActivationReport>

/** 一次激活尝试的结论。`reason` 只在 `ok:false` 时有值。 */
export interface MemberActivationReport {
  readonly ok: boolean
  readonly reason: string | null
}

/**
 * `sendTeamMessage` 的接线依赖。
 *
 * `notifier` **必填**：唤醒面是这条路由的一半职责（主人 @ 了成员，成员就该开始干活），
 * 把它做成可选等于允许「悄悄不唤醒」——那正是本批要修的缺陷形状。
 *
 * `activate` **可选但给不出就恒回 `no-handle`**：没有活句柄就没有任何投递对象。
 * 做成可选是为了让「不接线」这件事有一个**如实**的表现（结论里写着 `no-handle`），
 * 而不是让整个路由挂掉。
 */
export interface SendTeamMessageDeps {
  /** 运行时（只用到 `notify`，见 `MessageNotifier`）。 */
  readonly notifier: MessageNotifier
  /**
   * 先激活收件人，再唤醒他。
   *
   * ⚠ **顺序**：`activate` 必须在 `notify` **之前**完成 —— 唤醒只是「往一个已存在的
   * 句柄里投消息」，没有句柄就没得投（运行时的句柄门会回 `no-handle`）。
   * 这正是「成员被挂进频道**然后开始干活**」那一步在本模块的落点。
   */
  readonly activate?: MemberActivator | undefined
  readonly logger?: MemberLogger | undefined
  /** 注入时钟（测试用）；缺省 `Date.now`。 */
  readonly now?: (() => number) | undefined
}

/**
 * 面板里发一条消息 → 落一条 `team/message-sent` → **唤醒被 @ 的成员**
 *（写账本这件事只有一个实现，唤醒也只有一个：见 `writeMessageSent` / `wakeMemberForMessage`）。
 *
 * ## 四个关键决定
 *
 * 1. **发送者是人类，不是成员。** 事件基座的 `actor` 是 `WEB_ACTOR`（`{kind:'human', humanId:'sophia-ui'}`，
 *    与换模/建频道同口径），载荷的 `senderMemberId` 是 **`null`**。
 *    为什么不用某个成员的 id 顶上：那会把主人说的话**记成成员说的**（审计线索被伪造），
 *    而账本是「谁干的」这件事的唯一真相。完整理由与代价见 `MessageSentData`。
 * 2. **`channelId` 由宿主从投影里取，不信客户端报**。`MessageSentData` 需要
 *    `channelId`，但它是**线程的既有事实**（记在 `team/thread-started` 上）——
 *    让客户端在 body 里再报一份，就会出现「线程属于频道 A、消息自称频道 B」这种
 *    两个真相的记录。取不到线程 → 404 且**不落账**（不写孤儿消息：见 `team/message-sent`
 *    不校验引用的那段说明 —— 投影层收下它，但界面上它会永远挂不到任何线程下）。
 * 3. **只唤醒 `recipients`（被 @ 的人），不唤醒线程的 assignee。** 依据是主人的原话
 *    语境（「这些成员被挂在频道里，然后他们开始干活」）与 composer 的语义：
 *    `recipients` 就是**结构化提及**的成员集合（`requests.ts` 的 `TeamMessageRequest.recipients`）。
 *    顺手把 assignee 也唤醒会变成「我没 @ 他，他却被叫起来了」——
 *    那是一个**没被要求的行为**，且它会消耗一次真实的模型 turn（要花钱）。
 *    `recipients` 为空 ⇒ 谁都不唤醒（`wakes: []`）：主人没点名，就是一则记录。
 * 4. **唤醒是尽力而为，结论如实回报，不回滚落账。** 成员可能没被激活
 *   （`notify` 回 `no-handle`）、可能不是 `active`、可能正忙（走 steer 通道）——
 *    这些都由运行时判定，本函数**照抄它的结论**，一个字都不改写
 *   （唯一例外：激活失败时补一个 `reason`，见 `withActivationReason`）。
 * 5. **先激活，再唤醒**（`deps.activate` → `notify`）。这一步就是主人的原话
 *   「成员被挂在这个频道里，**然后他们开始干活**」在宿主侧的落点：不激活的话，
 *   唤醒只会得到 `no-handle` —— **消息落了账，人一次都没被叫起来**。
 *   顺序不可颠倒，且激活失败**不吞**：它的原因会出现在对应那条 `wakes[].delivery.reason` 里。
 *
 * ## `ref` 的口径（与工具面同源）
 *
 * 待办项的 `ref` 是 `unreadCount` 去重的键（见 `MemberPendingItem`）。工具面用的是
 * `${threadId}${SOPHIA_REPLY_REF_MARKER}${messageId}`（`@msg-<uuid>`：线程 + 具体那条消息）。
 * 这里**照抄那个形状**而不是自创：同一个线程里的两条不同消息必须得到**两个不同的 ref**
 *（否则第二条会被运行时判成 `duplicate` 而**不唤醒** —— 那正是「消息到了、人没起来」）。
 * 复用 `SOPHIA_REPLY_REF_MARKER` 常量而不是手写字面量：那个标记还有别的下游
 *（`sophia_message_ref` 的解析），手写一份就是第二个真相。
 */
export async function sendTeamMessage(
  ledger: Ledger,
  request: SendTeamMessageRequest,
  deps: SendTeamMessageDeps,
): Promise<SendTeamMessageResult> {
  let fold: ProjectionFold
  try {
    fold = rebuildFold(ledger).fold
  } catch (error) {
    return { kind: 'failed', reason: `读账本失败：${error instanceof Error ? error.message : String(error)}` }
  }
  const thread = fold.threads.get(request.threadId)
  if (thread === undefined) {
    return { kind: 'unknown-thread', reason: `账本里没有线程 ${request.threadId}` }
  }
  // 成员所属团要从**频道**上取：`ThreadFact` 只带 `channelId`（线程挂在频道下，
  // 频道才挂在团下 —— 这是账本的事实结构，不是可以省略的一跳）。
  // 取不到 ⇒ `failed` 且**不落账**：`activate` 需要一个 teamId 做授权/诊断，
  // 猜一个团等于把成员激活到别人团里（与「不写孤儿消息」同一条纪律）。
  const channel = fold.channels.get(thread.channelId)
  if (channel === undefined) {
    return {
      kind: 'failed',
      reason: `账本里没有线程 ${request.threadId} 所在频道 ${thread.channelId}（账本未被触碰）`,
    }
  }
  const teamId = channel.teamId

  // ⚠ 取时钟在自己的 try 里、且在碰账本**之前**（与 `switchMemberModel` 同纪律）：
  // 注入的时钟抛错时，调用方不能收到「写账本失败」——账本那时**根本没被碰过**，
  // 而那句话会让人去核对一条不存在的事件。这里文案明说「账本未被触碰」。
  const now = deps.now ?? Date.now
  let occurredAt: number
  try {
    occurredAt = now()
  } catch (error) {
    return {
      kind: 'failed',
      reason: `取当前时间失败（账本未被触碰）：${error instanceof Error ? error.message : String(error)}`,
    }
  }

  const written = writeMessageSent({
    ledger,
    actor: WEB_ACTOR,
    occurredAt,
    channelId: thread.channelId,
    threadId: thread.threadId,
    senderMemberId: null,
    body: request.body,
  })
  if (!written.ok) return { kind: 'failed', reason: written.reason }

  // ── 唤醒被 @ 的成员：**先激活他，再投消息**（尽力而为；结论逐条如实回报）──────
  //
  // ⚠ 次序是本段全部的意义所在：「把成员挂进频道」= 让他有一个活 Agent；
  // 「然后他们开始干活」= 那条消息真的进了他的 inbox。反过来的话，
  // 运行时的句柄门会回 `no-handle` —— 消息落了账、人却一次都没被叫起来。
  const wakes: MessageWake[] = []
  for (const recipientMemberId of request.recipients) {
    const memberId = recipientMemberId as MemberId
    const activation = await activateRecipient(deps, memberId, teamId)
    const delivery = wakeMemberForMessage({
      notifier: deps.notifier,
      logger: deps.logger,
      // ⚠ 发信人是**人类**（主人）——唤醒文案因此说「来自主人」而不是「来自成员 X」。
      senderMemberId: null,
      threadId: thread.threadId,
      recipientMemberId: memberId,
      content: request.body,
      refKey: `${thread.threadId}${SOPHIA_REPLY_REF_MARKER}${written.messageId}`,
      newestSequence: written.sequence,
    })
    wakes.push({
      recipientMemberId,
      delivery: withActivationReason(delivery, activation),
    })
  }

  return { kind: 'ok', messageId: written.messageId, sequence: written.sequence, occurredAt, wakes }
}

/**
 * 激活一个收件人（**不抛**）。
 *
 * 不抛的理由：这条路径在**请求处理**中跑，且激活失败是**预期内**的结果
 * （成员可能挂着未知 preset、宿主可能没挂 `agents` 行、模型可能配错）。
 * 契约是「只返回错误、绝不抛」—— 一次激活失败不该让整个发消息请求 500，
 * 因为**消息已经落账了**，而账本是事实。
 */
async function activateRecipient(
  deps: SendTeamMessageDeps,
  memberId: MemberId,
  teamId: TeamId,
): Promise<MemberActivationReport> {
  const activate = deps.activate
  if (activate === undefined) {
    // 没接线：不假装成功，也不报错。`null` 原因表示「没有激活这一步」，
    // 最终结论由运行时给出（无句柄 ⇒ `no-handle`）。
    return { ok: false, reason: null }
  }
  try {
    const report = await activate({ memberId, teamId })
    // 注入实现可能返回形状不对的值：那种情况下**不能**当成功（否则
    // 「激活失败」会静默变成「唤醒失败」，排查会指向错的地方）。
    if (typeof report?.ok !== 'boolean') {
      return { ok: false, reason: `激活端口返回了非预期形状（${String(report)}）—— 接线不符契约。` }
    }
    return { ok: report.ok, reason: typeof report.reason === 'string' ? report.reason : null }
  } catch (error) {
    deps.logger?.warn(`[sophia] 激活成员 ${memberId} 抛错：${error instanceof Error ? error.message : String(error)}`)
    return { ok: false, reason: `激活抛错：${error instanceof Error ? error.message : String(error)}` }
  }
}

/**
 * 把激活结论贴到唤醒结论上（只在激活失败时**替换 `reason`**）。
 *
 * 为什么保留运行时给的 `kind`：那个 `kind` 是**运行时**观察到的真相
 *（没有活句柄 ⇒ `no-handle`），本模块无权改写。而激活失败的原因它不可能知道
 *（激活发生在它之外），偏偏那正是排查唯一的线索 —— 所以只补 `reason`。
 *
 * 实测（本批）：不激活时这里必然是 `{kind:'no-handle', delivered:false}`；
 * 激活失败被压成一句没有原因的 `no-handle` 时，「为什么没起来」无从查起。
 */
function withActivationReason(
  delivery: TeamMessageDelivery,
  activation: MemberActivationReport,
): TeamMessageDelivery {
  if (activation.ok || activation.reason === null) return delivery
  return { ...delivery, reason: `成员未能激活：${activation.reason}` }
}

// ── addMember ───────────────────────────────────────────────────────────────

export interface AddMemberRequest {
  readonly teamId: string
  readonly position: string
  readonly model: { readonly provider: string; readonly model: string } | null
}

export function parseAddMemberRequest(payload: unknown): AddMemberRequest | string {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return 'body 必须是一个 JSON 对象'
  }
  const record = payload as Record<string, unknown>
  const teamId = trimmedNonEmpty(record['teamId'])
  const position = trimmedNonEmpty(record['position'])
  if (teamId === null) return 'teamId 必须是非空字符串'
  if (position === null) return 'position 必须是非空字符串'
  const provider = record['provider']
  const model = record['model']
  if ((provider === undefined || provider === null) && (model === undefined || model === null)) {
    return { teamId, position, model: null }
  }
  const providerTrimmed = trimmedNonEmpty(provider)
  const modelTrimmed = trimmedNonEmpty(model)
  // OCR LOW：两个分支给出可区分的文案（「谁缺了」——同文案对排错零信息量）。
  if (providerTrimmed === null) {
    return 'provider 与 model 必须同时提供且为非空字符串（当前：model 有值、provider 缺失或为空白）'
  }
  if (modelTrimmed === null) {
    return 'provider 与 model 必须同时提供且为非空字符串（当前：provider 有值、model 缺失或为空白）'
  }
  return { teamId, position, model: { provider: providerTrimmed, model: modelTrimmed } }
}

export type AddMemberResult =
  | { readonly kind: 'ok'; readonly memberId: string; readonly name: string; readonly sequence: number }
  | OpFailure

/**
 * 加成员：命名门禁在本入口也**硬拒绝**（裁定 Q-D）——
 * `validatePosition` 拒非名册职位，`allocateMemberName` 分配团内唯一名
 * （同职位第二个 → `<职位>-2`）。与 createTeam 展开名册用的是同一套门禁。
 */
export function addMember(ledger: Ledger, request: AddMemberRequest): AddMemberResult {
  const positionCheck = validatePosition(request.position)
  if (!positionCheck.ok) {
    return { kind: 'naming-violation', violation: positionCheck.violation }
  }
  let fold: ProjectionFold
  try {
    fold = rebuildFold(ledger).fold
  } catch (error) {
    return { kind: 'failed', reason: `读账本失败：${error instanceof Error ? error.message : String(error)}` }
  }
  const teamId = request.teamId as TeamId
  if (!fold.teams.has(teamId)) {
    return { kind: 'unknown-team', reason: `账本里没有团队 ${request.teamId}` }
  }
  try {
    const occupied: NameOccupancy[] = []
    for (const member of fold.members.values()) {
      if (member.teamId !== teamId) continue
      occupied.push({ name: member.name as NameOccupancy['name'], lifecycle: member.lifecycle })
    }
    const name = allocateMemberName(request.position, occupied)
    const memberId = toMemberId(request.position, newUuid8())
    const receipt = ledger.commit({
      kind: 'team/member-added',
      data: {
        teamId,
        member: { position: request.position, name, memberId },
        lifecycle: 'active',
        model: request.model,
      },
      actor: WEB_ACTOR,
    })
    return { kind: 'ok', memberId, name, sequence: receipt.sequence }
  } catch (error) {
    return { kind: 'failed', reason: `落账失败：${error instanceof Error ? error.message : String(error)}` }
  }
}

// ── member lifecycle ────────────────────────────────────────────────────────

export type LifecycleAction = 'suspend' | 'resume' | 'destroy'

export interface LifecycleActionRequest {
  readonly memberId: string
  readonly action: LifecycleAction
  readonly reason: string | null
}

export function parseLifecycleActionRequest(payload: unknown): LifecycleActionRequest | string {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return 'body 必须是一个 JSON 对象'
  }
  const record = payload as Record<string, unknown>
  const memberId = trimmedNonEmpty(record['memberId'])
  const action = record['action']
  if (memberId === null) return 'memberId 必须是非空字符串'
  if (action !== 'suspend' && action !== 'resume' && action !== 'destroy') {
    return 'action 必须是 "suspend" | "resume" | "destroy"'
  }
  // OCR MEDIUM [4]：给了 reason 字段却给空白 = 显式矛盾（与
  // parseSpawnDecisionRequest 口径对齐：「省略字段」是唯一表达不给理由的方式）。
  const rawReason = record['reason']
  if (rawReason !== undefined && rawReason !== null && trimmedNonEmpty(rawReason) === null) {
    return 'reason 若提供必须是非空字符串（要省略请直接不传该字段）'
  }
  const reason = trimmedNonEmpty(rawReason)
  return { memberId, action, reason }
}

const LIFECYCLE_TARGET: Record<LifecycleAction, { to: 'suspended' | 'active' | 'destroyed'; kind: 'team/member-suspended' | 'team/member-resumed' | 'team/member-destroyed' }> = {
  suspend: { to: 'suspended', kind: 'team/member-suspended' },
  resume: { to: 'active', kind: 'team/member-resumed' },
  destroy: { to: 'destroyed', kind: 'team/member-destroyed' },
}

export type LifecycleActionResult =
  | { readonly kind: 'ok'; readonly sequence: number }
  | Extract<OpFailure, { readonly kind: 'unknown-member' | 'no-change' | 'conflict' | 'failed' }>

/**
 * 生命周期操作：from 取投影当前态（不接受调用方自报），
 * 已是目标态 → `no-change`（409）—— 不写 `from === to` 的冗余事件（同换模口径）。
 */
export function memberLifecycleAction(
  ledger: Ledger,
  request: LifecycleActionRequest,
): LifecycleActionResult {
  let fold: ProjectionFold
  try {
    fold = rebuildFold(ledger).fold
  } catch (error) {
    return { kind: 'failed', reason: `读账本失败：${error instanceof Error ? error.message : String(error)}` }
  }
  const member = fold.members.get(request.memberId as MemberId)
  if (member === undefined) {
    return { kind: 'unknown-member', reason: `账本里没有成员 ${request.memberId}` }
  }
  const plan = LIFECYCLE_TARGET[request.action]
  // ⚠ OCR MEDIUM [第七轮]：**终态成员不许复活** —— destroyed/archived 之后
  // resume/suspend 会写 `from: 'destroyed'` 的复活事件，append-only 不可逆。
  if (member.lifecycle === 'destroyed' || member.lifecycle === 'archived') {
    return {
      kind: 'conflict',
      reason: `成员 ${request.memberId} 处于终态 ${member.lifecycle} —— 生命周期不可逆，拒绝复活/再挂起`,
    }
  }
  // OCR MEDIUM [3]：销毁不可回滚 —— 仍是某个 DAG 团归属的成员销毁后会留下
  // 悬空 `ownerMemberId`（投影不自动清）。先移交归属，再销毁。
  if (request.action === 'destroy') {
    for (const dag of fold.dagTeams.values()) {
      if (dag.ownerMemberId === request.memberId) {
        return {
          kind: 'conflict',
          reason: `成员 ${request.memberId} 仍是 DAG 团 ${dag.dagTeamId} 的归属 —— 销毁会造成悬空引用，请先移交归属`,
        }
      }
    }
  }
  if (member.lifecycle === plan.to) {
    return {
      kind: 'no-change',
      reason: `成员 ${request.memberId} 已经是 ${plan.to} 状态（拒绝写 from===to 的冗余事件）`,
    }
  }
  try {
    const receipt = ledger.commit({
      kind: plan.kind,
      data: {
        teamId: member.teamId,
        memberId: member.memberId,
        from: member.lifecycle,
        to: plan.to,
        ...(request.reason !== null ? { reason: request.reason } : {}),
      },
      actor: WEB_ACTOR,
    })
    return { kind: 'ok', sequence: receipt.sequence }
  } catch (error) {
    return { kind: 'failed', reason: `落账失败：${error instanceof Error ? error.message : String(error)}` }
  }
}

// ── DAG 归属移交 ─────────────────────────────────────────────────────────────

export interface TransferOwnershipRequest {
  readonly dagTeamId: string
  readonly from: string
  readonly to: string
}

export function parseTransferOwnershipRequest(payload: unknown): TransferOwnershipRequest | string {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return 'body 必须是一个 JSON 对象'
  }
  const record = payload as Record<string, unknown>
  const dagTeamId = trimmedNonEmpty(record['dagTeamId'])
  const from = trimmedNonEmpty(record['from'])
  const to = trimmedNonEmpty(record['to'])
  if (dagTeamId === null) return 'dagTeamId 必须是非空字符串'
  if (from === null) return 'from 必须是非空字符串'
  if (to === null) return 'to 必须是非空字符串'
  return { dagTeamId, from, to }
}

/**
 * dag 团是否在投影里 —— 直接查 `fold.dagTeams`（OCR [16]：
 * 初版在这里做全账本分页扫描，而同一函数上文刚重建过 fold，那是 O(账本) 的重复读）。
 * 判据不变：不向账本写一条指向不存在 dag 的移交事件。
 */
function dagTeamExists(fold: ProjectionFold, dagTeamId: string): boolean {
  return fold.dagTeams.has(dagTeamId as DagTeamId)
}

export type TransferOwnershipResult =
  | { readonly kind: 'ok'; readonly sequence: number }
  | Extract<OpFailure, { readonly kind: 'unknown-dag' | 'unknown-member' | 'conflict' | 'failed' }>

/** dag 归属移交（FR-7.4）：dag 存在 + from/to 都是成员 → 落 `dag/ownership-transferred`。 */
export function transferDagOwnership(
  ledger: Ledger,
  request: TransferOwnershipRequest,
): TransferOwnershipResult {
  let fold: ProjectionFold
  try {
    fold = rebuildFold(ledger).fold
  } catch (error) {
    return { kind: 'failed', reason: `读账本失败：${error instanceof Error ? error.message : String(error)}` }
  }
  if (!dagTeamExists(fold, request.dagTeamId)) {
    return { kind: 'unknown-dag', reason: `账本里没有 DAG 团 ${request.dagTeamId}` }
  }
  // OCR HIGH [1]：移交不可回滚 —— `from` 必须是**当前归属**，且 from !== to。
  // 否则账本会永久记录一次「由不是 owner 的人发起」的移交（伪造 from = 永久污染）。
  const dag = fold.dagTeams.get(request.dagTeamId as DagTeamId)
  if (dag === undefined) {
    return { kind: 'unknown-dag', reason: `账本里没有 DAG 团 ${request.dagTeamId}` }
  }
  if (request.from === request.to) {
    return { kind: 'conflict', reason: 'from 与 to 相同：无意义的移交被拒绝' }
  }
  if (dag.ownerMemberId !== request.from) {
    return {
      kind: 'conflict',
      reason: `成员 ${request.from} 不是 DAG 团 ${request.dagTeamId} 的当前归属（当前归属：${dag.ownerMemberId}）`,
    }
  }
  // OCR LOW [18]：只做存在性检查 —— 不留「声明了却不读」的绑定
  //（下游 commit 用的是 request.from/to 的直接转型）。
  if (fold.members.get(request.from as MemberId) === undefined) {
    return { kind: 'unknown-member', reason: `账本里没有成员 ${request.from}` }
  }
  if (fold.members.get(request.to as MemberId) === undefined) {
    return { kind: 'unknown-member', reason: `账本里没有成员 ${request.to}` }
  }
  try {
    const receipt = ledger.commit({
      kind: 'dag/ownership-transferred',
      data: {
        dagTeamId: request.dagTeamId as DagTeamId,
        from: request.from as MemberId,
        to: request.to as MemberId,
      },
      actor: WEB_ACTOR,
    })
    return { kind: 'ok', sequence: receipt.sequence }
  } catch (error) {
    return { kind: 'failed', reason: `落账失败：${error instanceof Error ? error.message : String(error)}` }
  }
}

/**
 * 换模：读当前模型 → 提交 `team/member-model-switched`。
 *
 * ⚠ 为什么**不**复用 t4 的 `createSwitchModelTool`：那个工具的入参是
 * `SophiaToolCaller`（`{memberId, teamId}`）且固定以 `trigger: 'member-self'`
 * 落账 —— 它表达的是「**成员自己**换模」。而本路由是**人类在界面上**点的按钮，
 * 按 FR-6.2 的闭集应落 `trigger: 'human'`、`actor: {kind:'human'}`。
 * 硬套那个工具要么伪造一个成员身份（往账本里写一个从未发生的「成员自换」），
 * 要么绕过它 —— 两者都比「直接用账本提交」更差。
 * 权限矩阵与审批属于**派生**链路（`sophia_spawn_team`），换模不在其中。
 *
 * 关于 `effectiveAtSequence`：`Ledger.head()` 与 `commit()` 都是同步的、
 * 两者之间没有 `await`（见 t4 `switch-model.ts` 文件头对这条的论证），
 * 因此「预测 = head+1」在同一 tick 内成立。
 *
 * ⚠ 但「同 tick 成立」只是**本进程内**的保证（OCR 复核 MEDIUM [6]）：
 * 账本是 SQLite，`busy_timeout` 明确预期「另一个进程/另一条连接会碰同一个文件」
 * （见 `openLedger` 的注释），所以另一个写者在 `head()` 与 `commit()` 之间插入
 * 是完全可能的 —— 那时**预测值就错了**，而它会作为 `effectiveAtSequence`
 * 落进**不可改写**的账本，且没有任何信号。
 * ⇒ 因此 `commit` 之后**必须校验** `receipt.sequence === predicted`，
 * 不符就如实回 {@link SwitchModelResult} 的 `sequence-mismatch`
 * （**不能**重试 —— 事件已经写进去了，重试会写第二条）。
 * 这与 t4 `switch-model.ts:374` 的「predict + verify」是同一处置。
 *
 * @param ledger - 账本句柄。
 * @param request - 已收窄的请求。
 * @param now - 注入时钟。
 * @returns 结果联合；绝不抛。
 */
export function switchMemberModel(
  ledger: Ledger,
  request: SwitchModelRequest,
  now: () => number = Date.now,
): SwitchModelResult {
  let fold: ProjectionFold
  try {
    fold = rebuildFold(ledger).fold
  } catch (error) {
    return { kind: 'failed', reason: `读账本失败：${error instanceof Error ? error.message : String(error)}` }
  }

  const memberId = request.memberId as MemberId
  const current = fold.members.get(memberId)
  if (current === undefined) {
    return { kind: 'unknown-member', reason: `账本里没有成员 ${request.memberId}` }
  }
  if (current.model === null) {
    return {
      kind: 'unknown-current-model',
      reason:
        `成员 ${request.memberId} 在账本里没有当前模型（它从未换过模）。`
        + '换模事件必须携带真实的旧模型（FR-6.4）—— 用猜测值当 from 会在不可改写的账本上'
        + '留下一条从未发生过的转换，故拒绝而不是将就。',
    }
  }
  if (current.model.provider === request.provider && current.model.model === request.model) {
    // 同模型不落账：`from === to` 的事件在账本上表现为一次**真实发生**的换模，
    // 「换过几次模」这类统计会多算一次，而账本不可改写。（与 t4 同一判据。）
    return { kind: 'no-change', reason: '目标模型与当前一致，未落账' }
  }

  // ⚠ `now()` 必须在**临界区之外**、且在自己的 try 里取值
  // （OCR 复核 MEDIUM [23] 在 t4 同族代码上指出，复审又指出我这里**只改了位置没改归属**）：
  // 初版把它挪到 commit 实参之前，但仍在**同一个** try 里 —— 而那个 catch 的文案
  // 是「写 team/member-model-switched 失败」。于是注入时钟一抛，调用方收到
  // 「写失败」，可账本**根本没被碰过**，他会去核对一条不存在的事件。
  // 现在它自成一个分支：时钟坏了就是「时钟坏了」，与「写失败」分得清。
  //
  // 顺序也有讲究：时钟读在 `head()` **之前**。`predicted = head()+1` 与 `commit()`
  // 之间**不能夹任何别的东西**（那是预测成立的唯一理由），而 `now()` 是注入的
  // 外部代码 —— 把它放到 head() 前面，临界区里就只剩这两步。
  let occurredAt: number
  try {
    occurredAt = now()
  } catch (error) {
    return {
      kind: 'failed',
      reason: `取当前时间失败（账本未被触碰）：${error instanceof Error ? error.message : String(error)}`,
    }
  }

  let predicted: number
  try {
    const head = ledger.head()
    // ⚠ `head().sequence` **必须校验形状**（队长核实的高危缺陷，已修；与 `switch-model.ts:439`
    //   和 `task-claim.ts:443` 的既有做法逐字同源）。
    // 为什么这里比那两处**更重**：不校验时 `undefined + 1` 得 `NaN`，
    // 而 `NaN` 会被 `JSON.stringify` 序列化成 `null` 落进**不可撤销**的账本
    //（`effectiveAtSequence: null`）。此后每次回放都读到一条序号含义不明的事件 ——
    // 账本 append-only，**没有撤销手段**。那两处只是把真因误报成 `sequence-mismatch`，
    // 这里是**污染账本本身**。
    // 关键：这一步在 `commit` **之前** ⇒ 判 `failed` 时账本一根毛都没碰过。
    if (!isNonNegativeSafeInteger(head.sequence)) {
      return {
        kind: 'failed',
        reason:
          `账本 head() 返回的序号不是非负安全整数（收到 ${describeValue(head.sequence)}）—— `
          + '说明注入的 Ledger 实现与契约不符。此处**尚未写账本**，故没有留下任何痕迹。',
      }
    }
    predicted = head.sequence + 1
  } catch (error) {
    return { kind: 'failed', reason: `读账本头部失败：${error instanceof Error ? error.message : String(error)}` }
  }

  try {
    const receipt = ledger.commit({
      kind: 'team/member-model-switched',
      // 人类在界面上操作 ⇒ `human`（FR-6.2 的三值闭集：human / member-self / policy）。
      // OCR [19]：与运营三路由同一 actor 单源（WEB_ACTOR）—— 两处各写一遍
    // 字面量会各自漂移。
    actor: WEB_ACTOR,
      occurredAt,
      data: {
        teamId: current.teamId,
        memberId,
        from: { provider: current.model.provider, model: current.model.model },
        to: { provider: request.provider, model: request.model },
        reason: request.reason,
        trigger: 'human',
        effectiveAtSequence: predicted,
      },
    })
    // 写序校验：见文件头。⚠ 走到这里事件**已经落账**，所以 mismatch 不是
    // 「没写成」而是「写成了、但序号与预测不符」—— 调用方**不能**重试。
    //
    // ⚠ `receipt.sequence` 同样**必须校验形状**（族A 同处，队长一并指出）：
    // 注入的 Ledger 若返回 `undefined`/非整数，`receipt.sequence !== predicted` 会**恒真**
    // ⇒ 被误报成「跨进程并发插入」——而那是一个**声称有别人在写**的分支，
    // 会把人工核对引向一条并不存在的并发轨迹。形状不符与并发是**两件事**，分开报。
    const actualSequence = receipt.sequence
    if (!isNonNegativeSafeInteger(actualSequence)) {
      return {
        kind: 'failed',
        reason:
          `账本 commit 返回的序号不是非负安全整数（收到 ${describeValue(actualSequence)}）—— `
          + '说明注入的 Ledger 实现与契约不符。事件**可能已写入**，请人工核对账本尾部；'
          + '这里拒绝把它当成「跨进程并发」上报（那是两件不同的事）。',
      }
    }
    if (actualSequence !== predicted) {
      console.error(
        `[sophia] 换模已写入，但写序校验失败：预测 ${String(predicted)}、实际 ${String(actualSequence)}`,
      )
      return {
        kind: 'sequence-mismatch',
        predicted,
        actual: actualSequence,
        reason:
          `换模事实已写入账本（序号 ${String(actualSequence)}），但预测序号 ${String(predicted)} 不符：`
          + '期间有另一个写者插入了事件。⚠ **不要重试** —— 重试会写入第二条换模事件；'
          + `该事件的 effectiveAtSequence 是 ${String(predicted)}，与它的实际序号不一致。`,
      }
    }
    return { kind: 'ok', sequence: actualSequence }
  } catch (error) {
    return { kind: 'failed', reason: `写 team/member-model-switched 失败：${error instanceof Error ? error.message : String(error)}` }
  }
}
