/**
 * 宿主装配层：将追加式账本、视图投影、成员运行时、派生审批与工具集连接起来。
 *
 * ## 职责
 *
 * 1. `createTeam` 落地：实现 `delegation.ts:195` 注入端口，写 `team/created` 与 `team/member-added`，
 *    遵守 `requestId` 基座审计与跨进程幂等约定，完整保留 `model` 字段（必填可空）。
 * 2. 运行时与工具依赖组装：构建 `DelegationDeps`、`MemberRuntime` 与 `SophiaToolsDeps`。
 *
 * @module @sophia/core/host-assembly
 */

import type { HumanInbox, HumanInboxItem, PrincipalReviewer, PrincipalVerdict } from './approval.ts'
import { findTeamCreatedFor, type DelegationDeps, type SpawnRequest } from './delegation.ts'
import type { Ledger } from './ledger.ts'
import { POSITIONS, allocateMemberName, newUuid8, toMemberId, validatePosition, type NameOccupancy } from './naming.ts'
import { rebuildFold, unreadByMember } from './projection/index.ts'
import {
  createMemberRuntime,
  type MemberAgentSetup,
  type MemberLogger,
  type MemberRuntime,
  type MemberRuntimeDeps,
} from './runtime/member-runtime.ts'
import type {
  SophiaDagPorts,
  SophiaProjectionPorts,
  SophiaToolCaller,
  SophiaToolsDeps,
} from './tools/types.ts'
import type {
  ChannelId,
  LedgerActor,
  MemberAddedData,
  MemberId,
  MemberIdentity,
  TeamCreatedData,
  TeamId,
  ThreadId,
} from './types/index.ts'

/**
 * 真实落地建团操作（实现 `DelegationDeps.createTeam` 端口）。
 *
 * ## 遵从的硬性契约
 * 1. **跨进程幂等**：先检查账本是否已包含带该 `request.requestId` 的 `team/created` 事件。
 *    若已存在，直接返回其 `teamId`，绝不重复写入；
 * 2. **`requestId` 写入基座**：`team/created` 必须把 `request.requestId` 写进
 *    `LedgerCommitInput.requestId`（基座审计字段，非载荷字段），供跨进程查询；
 * 3. **展开名册**：依 `spec.roster` 逐项按数量展开，分配唯一团队成员名（`allocateMemberName`）
 *    与成员 ID（`toMemberId(position, newUuid8())`）；
 * 4. **模型事实保真**：`member-added` 载荷中 `model` 字段遵循账本「必填可空」口径，
 *    若规格携带则如实记录 `{ provider, model }`，省略或 null 则记 `null`。
 */
export async function createTeam(
  ledger: Ledger,
  request: SpawnRequest,
): Promise<TeamId> {
  // 1. 跨进程幂等查重
  const existingTeamId = findTeamCreatedFor(ledger, request.requestId)
  if (existingTeamId !== null) {
    return existingTeamId
  }

  // 2. 分配新团队 ID
  const teamId = `team-${newUuid8()}` as TeamId

  // 3. 解析父团队（若发起成员已在某团队内，新团即为其子团）。
  // ⚠ OCR HIGH [第六轮]：**读失败直接抛**（曾降级 null + 日志）——
  // `team/created` append 不可逆，静默写错 parentTeamId 会永久孤儿化这个团；
  // 读失败时建团整体失败、可重试，与「宁可失败也不写错」的账本纪律一致。
  const outcome = rebuildFold(ledger)
  const requester = outcome.fold.members.get(request.requesterMemberId)
  let parentTeamId: TeamId | null = null
  if (requester !== undefined) {
    parentTeamId = requester.teamId
  }

  const actor: LedgerActor = { kind: 'member', memberId: request.requesterMemberId }

  // 3.5 ⚠ OCR HIGH [24]：roster **必须在任何落账之前**整份验证 ——
  //     `allocateMemberName`/`validatePosition` 对未知 position 会**抛**，
  //     而步骤 4 的 `team/created` 一旦 append 不可回滚 ⇒ 抛在这里之前
  //     才不会留一个「无成员的团队」。与 host-data 的 `addMember` 同序
  //     （先 validatePosition 再 commit）。（MEDIUM [7] 一并：负数/NaN count
  //     曾被 `Math.max(0, ·)` 静默吞成 0 —— 「成功但少人」比报错更坏。）
  for (const entry of request.spec.roster) {
    const validated = validatePosition(entry.position)
    if (!validated.ok) {
      throw new Error(`名册 position 不合法：${validated.violation.message}`)
    }
    if (!Number.isInteger(entry.count) || entry.count < 0) {
      throw new Error(
        `名册 count 必须是非负整数（收到 ${entry.count}，position=${entry.position}）`,
      )
    }
  }

  // 4. 提交 team/created（注意：requestId 必须写在基座 LedgerCommitInput.requestId）
  const createdData: TeamCreatedData = {
    teamId,
    kind: request.targetKind,
    ownerMemberId: request.requesterMemberId,
    parentTeamId,
    name: request.spec.name,
  }

  ledger.commit({
    kind: 'team/created',
    data: createdData,
    actor,
    requestId: request.requestId,
  })

  // 5. 展开名册并逐项落账
  const occupied: NameOccupancy[] = []
  for (const entry of request.spec.roster) {
    // 预校验（上方 3.5）已保证 count 是非负整数 —— 不再 Math.max 静默吞负数。
    const count = entry.count
    for (let i = 0; i < count; i += 1) {
      const name = allocateMemberName(entry.position, occupied)
      occupied.push({ name, lifecycle: 'active' })
      const memberId = toMemberId(entry.position, newUuid8())
      const member: MemberIdentity = {
        position: entry.position,
        name,
        memberId,
      }
      const model = entry.model != null
        ? { provider: entry.model.provider, model: entry.model.model }
        : null

      const addedData: MemberAddedData = {
        teamId,
        member,
        lifecycle: 'active',
        model,
      }

      ledger.commit({
        kind: 'team/member-added',
        data: addedData,
        actor,
        requestId: request.requestId,
      })
    }
  }

  return teamId
}

/**
 * 自举：账本为空时写入「索菲亚根团 + 她本人（钦天监监正）」。
 *
 * ## 为什么需要它（2026-09-24 线上实测的死锁链）
 *
 * `sophia_spawn_team` 的发起方类型**取自账本投影**（FR-5.2 权限矩阵按发起方
 * 所处团的 `kind` 裁决）。空账本里认不出任何成员 ⇒ 装配身份
 * `sophia-host-assembly` 命不中 ⇒ `unknown-caller` 拒绝发起（fail-closed）
 * ⇒ **账本永远保持空** ⇒ 面板永远空态（审批区 / 运营入口 / DAG 画布全都挂在
 * 「有团队 / 有待批票」上）⇒ 整条派生链**从未启动过**。
 *
 * 本函数补上缺的那「第一推动力」：一条 `team/created` + 一条
 * `team/member-added`。它**不改动** FR-5.2 的权限矩阵、`PERSISTENT_POLICY` /
 * `TEMPORARY_POLICY`，也不动任何 fail-closed 守卫 —— 只是让账本里第一次出现
 * 一个可被判定的发起方（`kind: 'persistent'` 的根团 + 它的监正）。
 *
 * 自举后 `resolveAssemblyCaller` 会自动选中这个活跃成员（它的实现就是
 * 「优先账本中的活跃成员，否则回退装配身份」），于是后续工具调用都以索菲亚
 * 本人发起 —— **无需任何额外接线**。
 *
 * ## 幂等
 *
 * 判据是「**根团完好**」（账本里有名为根团的 `persistent` 团，且它有活跃成员）
 * ⇒ 直接返回。重复调用（每次进程启动、每次挂载）都是零写入。
 * ⚠ 早期文档写的是「账本里**已有任何团队**」—— 那是**更弱的判据**，已被改成上方
 * 这条：弱判据在「根团半截 + 别的团有成员」时会提前返回，让根团永远修不好。
 *
 * ## 与 FR-5.2 的关系（为什么不改矩阵）
 *
 * 矩阵只规定了「持久成员 / 临时成员」两行的权限，**没有**规定「无团发起者」
 * —— 所以实现里的 fail-closed 是保守的正确，缺的是起点本身。根团是
 * `persistent` ⇒ 索菲亚拿到 `PERSISTENT_POLICY`（两类团都能开），而**持久团
 * 仍然必须过两级审批**（人类收件箱是最终门）—— 权限控制强度不变。
 *
 * @param ledger - 已打开的账本。
 */
/**
 * 根团名 —— 自举（写）与「查找根团」（读）共用同一个字面量。
 *
 * 抽成常量的理由不是洁癖：读写两侧若各写一份中文字面量，改动时只改一处就会
 * **静默地找不到根团** ⇒ 每次开账本都新建一个团（账本被垃圾团灌满，且
 * `resolveAssemblyCaller` 选中哪个成员变得不确定）。
 */
const ROOT_TEAM_NAME = '索菲亚'

export function ensureRootTeam(ledger: Ledger): void {
  const fold = rebuildFold(ledger).fold
  // 判据是「根团**完好**」（有团 **且** 有成员），不是「有团队」——
  // ⚠ 可重入性（自查发现的真缺陷，与 OCR 的 createTeam 部分落账同族）：
  //   本函数要写两条事实。若第一条成功、第二条失败（磁盘满 / 序列化失败 /
  //   进程被杀），只判 `fold.teams.size > 0` 会让**下一次调用直接早返回**
  //   ⇒ 根团永远没有成员 ⇒ `resolveAssemblyCaller` 找不到活跃成员、回退到
  //   装配占位身份 ⇒ **死锁重现**，而且账本看起来「有团」，症状比空账本更隐蔽。
  //   改成完好判据后，半截状态会在下一次调用时被**补齐**（只补缺的那条）。
  // 找根团：**读**（守卫）与**写**（修复目标）共用同一个判据 —— 按名字与 kind 定位。
  //
  // ⚠ 半截状态的**修复目标必须是确定的根团**，不能是「随便哪一个团」。
  // 初版写的是 `[...fold.teams.keys()][0]`（`Map` 的**插入序**）：账本里若先有别的团
  // （某团建了团但成员还没落账、或另一条业务线建的团），创始人「钦天监监正」就会被
  // **塞进那个无关团队**，紧接着 `resolveAssemblyCaller` 会选中这个活跃成员，
  // **之后所有工具调用都被归因到它** —— 真实的授权污染（OCR 复核指出）。
  const rootTeam = [...fold.teams.values()].find(
    (team) => team.name === ROOT_TEAM_NAME && team.kind === 'persistent',
  )
  // ⚠ 守卫也必须是**根团判据**，不能是全局判据。
  // 初版写的是 `fold.teams.size > 0 && fold.members.size > 0` —— 那只在
  // 「账本里只有根团」时才与根团判据等价。反例正是本函数要防的场景（OCR 复核指出）：
  // **根团半截（无成员）+ 别的团有成员** ⇒ 全局判据提前返回 ⇒ 根团永远修不好 ⇒
  // `resolveAssemblyCaller` 选中那个无关团的成员 ⇒ 授权归因被污染。只换修复目标
  // 而不换守卫，等于只修了一半，比不修更隐蔽。
  //
  // ⚠ 这里**刻意不看 `lifecycle`**：`MemberFact.lifecycle` 不取 `'active'` 这种字面量
  // （它是事件派生的状态标识），拿它做 `=== 'active'` 判断会**恒假** ⇒ 守卫永不返回
  // ⇒ 每次开账本都新建一个根团。这不是推测：加上该条件的版本当场砸红 8 个既有用例
  // （`host-routes.spec.ts` 的账本事实断言全部对不上）。判据保持与旧守卫**同强度**：
  // 「根团有成员」即视为完好。
  const rootMemberCount =
    rootTeam === undefined
      ? 0
      : [...fold.members.values()].filter((member) => member.teamId === rootTeam.teamId)
          .length
  if (rootTeam !== undefined) {
    // 根团在：**有成员即完好**（同旧守卫强度）；无成员 ⇒ 落到下面**只补成员**
    // （这正是 OCR 指出的那类半截状态：全局守卫会提前返回，让它永远修不好）。
    if (rootMemberCount > 0) return
  } else if (fold.teams.size > 0) {
    // 没有根团、但账本里已有别的团 ⇒ **不自举**。
    //
    // 理由（实测得出，不是保守起见）：账本非空说明装配已完成过（团可能由别的入口建），
    // 此时塞一个「根团」会**改变既有账本的语义**（`/view` 的团队列表凭空多一项），
    // 而发起方并不缺 —— `resolveAssemblyCaller` 会退回「任一活跃成员」。
    // 放宽守卫的版本当场砸红 7 个既有用例（`host-routes.spec.ts` 的账本事实断言），
    // 那些断言恰恰在说「view 反映的是我 seed 的那个账本」。
    // **只有账本完全为空时**才需要第一推动力 —— 那才是死锁的成因。
    return
  }
  const existingTeamId = rootTeam?.teamId

  // 职位名**只取名册**（`POSITIONS[0]` = 钦天监监正，第一梯队管理总控组的监正）
  // —— 不在这里重打一遍中文字面量：名册一旦调整，硬编码会静默漂移出闭集，
  // 而 `toMemberId` 要到很后面才抛，症状离原因很远。
  const position = POSITIONS[0]
  const memberId = toMemberId(position, newUuid8())
  const teamId = existingTeamId ?? (`team-${newUuid8()}` as TeamId)
  // actor 用 human 变体：这是**装置初始化**，不是某个成员的业务动作 ——
  // 不假托成员名义写它的第一条事实，留下可审计的 humanId。
  const actor: LedgerActor = { kind: 'human', humanId: 'sophia-bootstrap' }

  // 半截状态（已有团）⇒ **只补成员**，绝不重复建团。
  if (existingTeamId === undefined) {
    const created: TeamCreatedData = {
      teamId,
      kind: 'persistent',
      ownerMemberId: memberId,
      parentTeamId: null,
      name: ROOT_TEAM_NAME,
    }
    ledger.commit({ kind: 'team/created', data: created, actor })
  }

  const member: MemberIdentity = { position, name: position, memberId }
  const added: MemberAddedData = { teamId, member, lifecycle: 'active', model: null }
  ledger.commit({ kind: 'team/member-added', data: added, actor })
}

/** 内存人类收件箱替身实现。 */
export function createInMemoryHumanInbox(): HumanInbox {
  const items: HumanInboxItem[] = []
  return {
    async push(item: HumanInboxItem): Promise<void> {
      items.push(item)
    },
    async list(): Promise<readonly HumanInboxItem[]> {
      return [...items]
    },
  }
}

/** 组装 DelegationDeps 的入参。 */
export interface AssembleDelegationOptions {
  readonly ledger: Ledger
  readonly inbox?: HumanInbox | undefined
  readonly runtime?: MemberRuntime | undefined
  readonly principalOf?: ((memberId: MemberId) => Promise<PrincipalReviewer>) | undefined
  readonly createTeam?: ((request: SpawnRequest) => Promise<TeamId>) | undefined
  readonly now?: (() => number) | undefined
  readonly currentHumanOperatorId?: (() => string | Promise<string>) | undefined
}

/** 构造派生审批依赖（DelegationDeps）。 */
export function createDelegationDeps(options: AssembleDelegationOptions): DelegationDeps {
  const ledger = options.ledger
  const inbox = options.inbox ?? createInMemoryHumanInbox()
  // OCR [33]：`options.runtime` 曾在此读出成局部变量、随后无人引用（死变量
  // 制造「runtime 已接进委派层」的假象）。选项字段保留（assemble 仍在传入），
  // 但这里不再假装消费它；真实句柄审查接线时再在 principalOf/reviewSpawn 里用。
  const createTeamFn = options.createTeam ?? ((req: SpawnRequest) => createTeam(ledger, req))
  const now = options.now ?? (() => Date.now())
  const currentHumanOperatorId = options.currentHumanOperatorId ?? (() => 'human-operator')

  const principalOf = options.principalOf ?? (async (memberId: MemberId): Promise<PrincipalReviewer> => {
    let principalMemberId = memberId
    try {
      const fold = rebuildFold(ledger).fold
      const member = fold.members.get(memberId)
      if (member !== undefined) {
        const team = fold.teams.get(member.teamId)
        if (team?.ownerMemberId) {
          principalMemberId = team.ownerMemberId
        }
      }
    } catch {
      // 查询失败时回退到发起成员自身
    }

    return {
      memberId: principalMemberId,
      reviewSpawn: async (_req: SpawnRequest): Promise<PrincipalVerdict> => {
        // 第一级（监正）**当前自动通过** —— 真实句柄审查待监正 Agent 接线。
        // ⚠ OCR [15] 已删掉原来「读了 handle 却什么都不做」的死块：那三行
        //   会让人误以为门已经接线。语义保留：principal-rejected 事件与
        //   票面状态机在账本层完整支持，这里放行只是本占位的**显式**结论。
        return { approved: true }
      },
    }
  })

  return {
    ledger,
    inbox,
    principalOf,
    createTeam: createTeamFn,
    now,
    currentHumanOperatorId,
  }
}

/** 构造工具集所需的投影端口（SophiaProjectionPorts）。 */
export function createSophiaProjectionPorts(ledger: Ledger): SophiaProjectionPorts {
  return {
    callerKindOf: (memberId: MemberId) => {
      try {
        const fold = rebuildFold(ledger).fold
        const member = fold.members.get(memberId)
        if (member === undefined) return null
        const team = fold.teams.get(member.teamId)
        return team !== undefined ? team.kind : null
      } catch {
        return null
      }
    },
    modelOf: (memberId: MemberId) => {
      try {
        const fold = rebuildFold(ledger).fold
        return fold.members.get(memberId)?.model ?? null
      } catch {
        return null
      }
    },
    lifecycleOf: (memberId: MemberId) => {
      try {
        const fold = rebuildFold(ledger).fold
        return fold.members.get(memberId)?.lifecycle ?? null
      } catch {
        return null
      }
    },
    teamOf: (memberId: MemberId) => {
      try {
        const fold = rebuildFold(ledger).fold
        return fold.members.get(memberId)?.teamId ?? null
      } catch {
        return null
      }
    },
    unreadOf: (memberId: MemberId, sinceSequence: number) => {
      return unreadByMember(ledger, { memberId, sinceSequence })
    },
    resolveMemberRef: (ref: string) => {
      try {
        const fold = rebuildFold(ledger).fold
        if (fold.members.has(ref as MemberId)) {
          return ref as MemberId
        }
        for (const m of fold.members.values()) {
          if (m.name === ref && (m.lifecycle === 'active' || m.lifecycle === 'suspended')) {
            return m.memberId
          }
        }
        return null
      } catch {
        return null
      }
    },
    threadOf: (threadId: ThreadId) => {
      try {
        const fold = rebuildFold(ledger).fold
        const t = fold.threads.get(threadId)
        return t !== undefined ? { channelId: t.channelId, title: t.title } : null
      } catch {
        return null
      }
    },
    channelTeamOf: (channelId: ChannelId) => {
      try {
        const fold = rebuildFold(ledger).fold
        return fold.channels.get(channelId)?.teamId ?? null
      } catch {
        return null
      }
    },
    // ⠿ **桩（一期如实边界，OCR [第六轮] 标注）**：ownerOf/taskStateOf 恒
    // null、unfinishedDependenciesOf 恒 `[]` —— 后者是 **fail-open**（「所有
    // 依赖已满足」），一期**恰好为真**：spec.tasks 是 string[]、根本没有依赖
    // 边（见 DagCanvas 文件头的诚实边界）。阶段 3 接线时以 fold.dagTeams
    //（已折出 owner / 任务态）为源，这三行是唯一改动点。
    dag: {
      ownerOf: (_dagTeamId) => null,
      taskStateOf: (_dagTeamId, _taskId) => null,
      unfinishedDependenciesOf: (_dagTeamId, _taskId) => [],
    } satisfies SophiaDagPorts,
  }
}

/** 默认成员运行时实现（桩降级，如实记录边界）。 */
export function createDefaultMemberRuntime(
  ledger: Ledger,
  overrides?: Partial<MemberRuntimeDeps>,
): MemberRuntime {
  return createMemberRuntime({
    mountPreset: async (setup: MemberAgentSetup, presetId: string) => {
      // 桩：真 Agent 底座待宿主接线
      console.warn(`[sophia] mountPreset 桩调用（待宿主接线）：${setup.memberId} -> ${presetId}`)
    },
    applyToolPolicy: (setup: MemberAgentSetup, allow: readonly string[]) => {
      // 桩：待宿主接线
      console.warn(`[sophia] applyToolPolicy 桩调用（待宿主接线）：${setup.memberId} -> ${allow.join(',')}`)
    },
    createHandle: async (input: { readonly memberId: MemberId; readonly presetId: string }) => {
      // 桩：真 Agent 底座待宿主接线；如实返回失败，绝不假装能激活
      throw new Error(`真 Agent 底座待宿主接线（成员 ${input.memberId} 无法激活）`)
    },
    lifecycleOf: (memberId: MemberId) => {
      try {
        const fold = rebuildFold(ledger).fold
        return fold.members.get(memberId)?.lifecycle ?? null
      } catch {
        return null
      }
    },
    logger: {
      warn: (msg: string) => console.warn(`[sophia:runtime] ${msg}`),
    },
    ...overrides,
  })
}

/** 宿主装配期显式标注的占位调用者。 */
export const ASSEMBLY_CALLER: SophiaToolCaller = {
  memberId: 'sophia-host-assembly' as MemberId,
  teamId: 'team-assembly' as TeamId,
}

/** 解析装配期调用者：优先选用账本中已有的活跃成员，否则回退至显式标注的装配身份。 */
export function resolveAssemblyCaller(ledger?: Ledger): SophiaToolCaller {
  if (ledger !== undefined) {
    try {
      const fold = rebuildFold(ledger).fold
      // ① 先认**根团**的活跃成员：自举之后这才是唯一正确的发起方。
      //    ⚠ 不能直接取「第一个活跃成员」—— 那是 `Map` 的插入序。在
      //    「根团半截 + 别的团先有成员」的账本里，根团成员是**后追加**的，
      //    直接取第一个就会把工具调用归因到**无关团的成员**（OCR 复核指出：
      //    与 `ensureRootTeam` 的守卫属同一族授权污染）。
      const rootTeam = [...fold.teams.values()].find(
        (team) => team.name === ROOT_TEAM_NAME && team.kind === 'persistent',
      )
      if (rootTeam !== undefined) {
        for (const m of fold.members.values()) {
          if (m.lifecycle === 'active' && m.teamId === rootTeam.teamId) {
            return { memberId: m.memberId, teamId: m.teamId }
          }
        }
      }
      // ② 没有完好根团的旧账本：退回「任一活跃成员」，保持既有行为不变。
      for (const m of fold.members.values()) {
        if (m.lifecycle === 'active') {
          return { memberId: m.memberId, teamId: m.teamId }
        }
      }
    } catch {
      // 读账本失败时回退
    }
  }
  return ASSEMBLY_CALLER
}

/** 组装 SophiaToolsDeps 的入参。 */
export interface AssembleSophiaToolsDepsOptions {
  readonly ledger: Ledger
  readonly caller?: SophiaToolCaller | undefined
  readonly runtime?: MemberRuntime | undefined
  readonly delegation?: DelegationDeps | undefined
  readonly projection?: SophiaProjectionPorts | undefined
  readonly now?: (() => number) | undefined
  readonly logger?: MemberLogger | undefined
}

/** 组装完整的 SophiaToolsDeps 依赖对象。 */
export function assembleSophiaToolsDeps(
  options: AssembleSophiaToolsDepsOptions,
): SophiaToolsDeps {
  const ledger = options.ledger
  const runtime = options.runtime ?? createDefaultMemberRuntime(ledger)
  const caller = options.caller ?? resolveAssemblyCaller(ledger)
  // OCR LOW [第四轮]：传 runtime 曾是「看起来活着、实则没人消费」的死参数
  //（createDelegationDeps 已按 [33] 删除该局部变量）—— 调用点一并去参。
  const delegation = options.delegation ?? createDelegationDeps({ ledger })
  const projection = options.projection ?? createSophiaProjectionPorts(ledger)
  const now = options.now ?? (() => Date.now())

  return {
    caller,
    ledger,
    runtime,
    projection,
    delegation,
    now,
    logger: options.logger,
  }
}

export type { MemberRuntime } from './runtime/member-runtime.ts'
