/**
 * `team/message-sent` 的**端到端**覆盖：账本 → 投影折叠 → 线格式（wire）。
 *
 * ## 为什么必须有这个文件（它补的是哪条缝）
 *
 * 本仓已有三处各自覆盖了这条链的**片段**：
 * - `tests/ledger.spec.ts` 证「kind 能提交并读回」（它用的是空载荷 `{}`，不验字段语义）；
 * - `tests/projection.spec.ts` 证「`changeScopesOf` 对全部 kind 的返回」；
 * - `tests/tools.spec.ts` 证「工具会落这条事件」。
 *
 * 但**没有任何一处**回答这个组合问题：
 * **「一条 message-sent 落进账本之后，界面数据面（`buildWireTeam().messages`）
 * 到底能不能读到它，字段是不是逐字对得上？」** ——
 * 而这正是本次改动的**全部目的**：此前 `src/host-data.ts` 的 `messages: []`
 * 是唯一的填充点，界面消息流因此恒为空态。
 *
 * ⇒ 本文件**从账本一路断言到 wire**，不 mock 中间任何一层（用真 `openLedger`
 * 的进程内库 + 真 `rebuildFold` + 真 `buildWireTeam`）。
 *
 * ## 反恒真纪律（每条都注明「怎么改才会红」）
 *
 * - 把 `src/host-data.ts` 里 `messages,` 改回 `messages: []` ⇒ 「wire 不再为空」那条必红
 *   （**已实测**，输出见交付报告）。
 * - 把 `buildWireTeam` 里的 `roster.channelIds.flatMap(...)` 改成遍历 `fold.messages`
 *   全部值（去掉本团过滤） ⇒ 「跨团消息不得漏进来」那条必红。
 * - 把投影 case 里的 `body` 校验去掉（允许空串） ⇒ 「空正文被拒采信」那条必红。
 *
 * @module tests/message-events
 */

import { afterEach, describe, expect, it } from 'vitest'

import { openLedger, type Ledger, type LedgerCommitInput } from '../src/ledger.ts'
import { rebuildFold } from '../src/projection/index.ts'
import { buildWireTeam, sendTeamMessage } from '../src/host-data.ts'
import { createDefaultMemberRuntime } from '../src/host-assembly.ts'
import type {
  MemberAgent,
  MemberNotice,
  MemberRuntime,
  MemberWakeOutcome,
} from '../src/runtime/member-runtime.ts'
import { SOPHIA_REPLY_REF_MARKER, wakeMemberForMessage } from '../src/tools/message.ts'
// 投递给 agent 的是**消息**；它的形状与 `summary` 常量都取自那个唯一转换处。
import {
  SOPHIA_NOTICE_SUMMARY,
  type SophiaUserMessage,
} from '../src/runtime/notice-message.ts'
import type { ChannelId, MemberId, MessageId, TeamId, ThreadId } from '../src/types/index.ts'

// ── 固定件（字面量集中在这里，断言里不再出现裸串）────────────────────────────

const TEAM_A = 'sophia-team-0000000a' as TeamId
const TEAM_B = 'sophia-team-0000000b' as TeamId
const MEMBER_A = 'sophia-xing-yi-zhu-shi-0000000a' as MemberId
const MEMBER_B = 'sophia-xing-yi-zhu-shi-0000000b' as MemberId
const CHANNEL_A = 'sophia-channel-0000000a' as ChannelId
const CHANNEL_B = 'sophia-channel-0000000b' as ChannelId
const THREAD_A = 'sophia-thread-0000000a' as ThreadId
const THREAD_B = 'sophia-thread-0000000b' as ThreadId
/** 消息 id 用带前缀的字面量，好在断言里一眼看出「这就是我写进去的那条」。 */
const MESSAGE_A = 'msg-00000000000000000000000000000001' as MessageId
const MESSAGE_B = 'msg-00000000000000000000000000000002' as MessageId

const POSITION_A = '星仪主事'
const POSITION_B = '推步主事'

/**
 * 写进账本的时间戳（毫秒）。**显式给出**而不是靠注入时钟：
 * 断言里要出现一个具体的数字，才能证明线格式的 `occurredAt` 确实来自
 * **事件基座**（`LedgerEventBase.occurredAt`），而不是被谁现算了。
 * 若有人把时间塞进 `data`、wire 侧改读 `data`，下面 `toEqual` 的逐字比对仍会过 ——
 * 但「载荷里没有 occurredAt」这一条会被 `tests/types.spec.ts` 的载荷类型钉住；
 * 这里再加一条**运行期**的：见 `dataOf` 断言（`data` 里取不到该键）。
 */
const OCCURRED_AT = 1_700_000_000_123
const BODY_A = '请复核 t4 的工具集'
const BODY_B = '另一条消息'

const humanActor = { kind: 'human', humanId: 'tester' } as const

const opened: Ledger[] = []

afterEach(() => {
  for (const ledger of opened) {
    try {
      ledger.close()
    } catch {
      // 关闭失败不该让用例变红（进程内库本来也会随进程消失）。
    }
  }
  opened.length = 0
})

function newLedger(): Ledger {
  const ledger = openLedger({ path: ':memory:' })
  opened.push(ledger)
  return ledger
}

function commit(ledger: Ledger, input: LedgerCommitInput): void {
  ledger.commit(input)
}

/** 建团 + 加一名成员 + 建频道 + 起线程 —— 让 `buildWireTeam` 能拼出非空视图。 */
function seedTeam(
  ledger: Ledger,
  teamId: TeamId,
  teamName: string,
  memberId: MemberId,
  position: string,
  channelId: ChannelId,
  threadId: ThreadId,
): void {
  commit(ledger, {
    kind: 'team/created',
    actor: humanActor,
    data: { teamId, kind: 'persistent', ownerMemberId: null, parentTeamId: null, name: teamName },
  })
  commit(ledger, {
    kind: 'team/member-added',
    actor: humanActor,
    data: {
      teamId,
      member: { position, name: position, memberId },
      lifecycle: 'active',
      model: null,
    },
  })
  commit(ledger, {
    kind: 'team/channel-created',
    actor: humanActor,
    data: { channelId, teamId, title: `${teamName}的频道` },
  })
  commit(ledger, {
    kind: 'team/thread-started',
    actor: humanActor,
    data: { threadId, channelId, title: '线程', assigneeMemberId: null },
  })
}

/**
 * 写一条消息事件（字段齐备）。
 *
 * @param senderMemberId - 发送者成员 id；**`null` = 不是团内成员发的**
 *   （主人经面板发送，见 `MessageSentData`）。传 `null` 时基座 actor 也换成人类 ——
 *   载荷与基座必须说同一件事（这正是「只有一份真相」的用法）。
 */
function messageSent(
  messageId: MessageId,
  channelId: ChannelId,
  threadId: ThreadId,
  senderMemberId: MemberId | null,
  body: string,
): LedgerCommitInput {
  return {
    kind: 'team/message-sent',
    actor: senderMemberId === null
      ? { kind: 'human', humanId: 'sophia-ui' }
      : { kind: 'member', memberId: senderMemberId },
    occurredAt: OCCURRED_AT,
    data: { messageId, channelId, threadId, senderMemberId, body },
  }
}

describe('team/message-sent：账本 → 投影（fold.messages）', () => {
  it('写一条后，rebuildFold(ledger).fold.messages 里能读到它，且字段与写入值逐字相等', () => {
    const ledger = newLedger()
    seedTeam(ledger, TEAM_A, '甲团', MEMBER_A, POSITION_A, CHANNEL_A, THREAD_A)
    commit(ledger, messageSent(MESSAGE_A, CHANNEL_A, THREAD_A, MEMBER_A, BODY_A))

    const fold = rebuildFold(ledger).fold

    // 反恒真：把投影 case 里那句 `messages.set(...)` 删掉 / 改成写别的表 → 必红。
    expect(fold.messages.size, '账本里有一条 message-sent ⇒ 投影必须有一行').toBe(1)
    const fact = fold.messages.get(MESSAGE_A)
    expect(fact).toBeDefined()
    expect(fact).toEqual({
      messageId: MESSAGE_A,
      channelId: CHANNEL_A,
      threadId: THREAD_A,
      senderMemberId: MEMBER_A,
      body: BODY_A,
      // 时间取自**事件基座**（`data` 里没有它 —— 见 `MessageSentData` 的说明）。
      occurredAt: OCCURRED_AT,
      appearedAtSequence: 5,
    })
    // 全量重建下没有任何事件被拒采信（`malformedEvents` 不为 0 就说明校验过严/过松）。
    expect(fold.malformedEvents).toBe(0)
  })

  it('载荷缺字段（无 body）⇒ 拒绝采信并计数，**不抛异常打断整次折叠**', () => {
    const ledger = newLedger()
    seedTeam(ledger, TEAM_A, '甲团', MEMBER_A, POSITION_A, CHANNEL_A, THREAD_A)
    // 缺 `body` 的载荷：`isLedgerEvent` 只保证 `data` 是非 null 对象，
    // **不保证**载荷与 kind 匹配 ⇒ 投影层必须自己判，不能假设它合法。
    commit(ledger, {
      kind: 'team/message-sent',
      actor: { kind: 'member', memberId: MEMBER_A },
      data: { messageId: MESSAGE_A, channelId: CHANNEL_A, threadId: THREAD_A, senderMemberId: MEMBER_A },
    })
    // 紧随其后的一条**合法**事件：用来证明折叠**没有**被上一条打断（不是「抛了就完」）。
    commit(ledger, messageSent(MESSAGE_B, CHANNEL_A, THREAD_A, MEMBER_A, BODY_B))

    const fold = rebuildFold(ledger).fold

    expect(fold.messages.has(MESSAGE_A), '缺字段的那条不得被采信').toBe(false)
    expect(fold.messages.size, '合法的那条必须照样进去').toBe(1)
    expect(fold.messages.get(MESSAGE_B)?.body).toBe(BODY_B)
    // 一条被拒采信 ⇒ 计数加一（可见的缺失 > 静默的空行）。
    expect(fold.malformedEvents).toBe(1)
  })

  it('发送者**不是成员**（`senderMemberId: null`，主人经面板发的）⇒ 照常采信，事实里也是 `null`', () => {
    const ledger = newLedger()
    seedTeam(ledger, TEAM_A, '甲团', MEMBER_A, POSITION_A, CHANNEL_A, THREAD_A)
    commit(ledger, messageSent(MESSAGE_A, CHANNEL_A, THREAD_A, null, BODY_A))

    const fold = rebuildFold(ledger).fold

    // 反恒真：把投影里的三态判定改回 `asNonEmptyString(event.data.senderMemberId)` → 必红
    //（`null` 会被判成坏载荷 ⇒ `messages.size === 0`）。
    expect(fold.messages.size, '人类的发言也必须被采信（它不是坏载荷）').toBe(1)
    expect(fold.messages.get(MESSAGE_A)).toEqual({
      messageId: MESSAGE_A,
      channelId: CHANNEL_A,
      threadId: THREAD_A,
      // ⚠ `null` 的含义**严格等于**「没有成员发送者」；「那是谁」去读事件基座的 `actor`。
      senderMemberId: null,
      body: BODY_A,
      occurredAt: OCCURRED_AT,
      appearedAtSequence: 5,
    })
    expect(fold.malformedEvents).toBe(0)
  })

  it('发送者字段是**坏形状**（数字 / 空串）⇒ 拒采信并计数，**不得**被当成「人类发的」收下', () => {
    const ledger = newLedger()
    seedTeam(ledger, TEAM_A, '甲团', MEMBER_A, POSITION_A, CHANNEL_A, THREAD_A)
    // 这条是 `senderMemberId` 三态判定的**反恒真**：如果实现图省事写成
    // `asOptionalId(event.data.senderMemberId)`（非空串→值，其它一律→null），
    // 那么 `42` 与 `''` 都会被**当成合法的人类消息**收下 —— 那就是
    // 「把读不懂的东西读成成功」，而这里要的是「当场拒 + 计数」。
    commit(ledger, {
      kind: 'team/message-sent',
      actor: { kind: 'member', memberId: MEMBER_A },
      occurredAt: OCCURRED_AT,
      data: { messageId: MESSAGE_A, channelId: CHANNEL_A, threadId: THREAD_A, senderMemberId: 42, body: BODY_A },
    })
    commit(ledger, {
      kind: 'team/message-sent',
      actor: { kind: 'member', memberId: MEMBER_A },
      occurredAt: OCCURRED_AT,
      data: { messageId: MESSAGE_B, channelId: CHANNEL_A, threadId: THREAD_A, senderMemberId: '', body: BODY_B },
    })

    const fold = rebuildFold(ledger).fold

    expect(fold.messages.size, '两条坏载荷都不得被采信').toBe(0)
    expect(fold.malformedEvents).toBe(2)
  })
})

describe('team/message-sent：投影 → 线格式（buildWireTeam().messages）', () => {
  it('★ wire 的 messages **不再为空**，且六个字段与写入值逐字相等', () => {
    const ledger = newLedger()
    seedTeam(ledger, TEAM_A, '甲团', MEMBER_A, POSITION_A, CHANNEL_A, THREAD_A)
    commit(ledger, messageSent(MESSAGE_A, CHANNEL_A, THREAD_A, MEMBER_A, BODY_A))

    const team = buildWireTeam(rebuildFold(ledger).fold, TEAM_A, () => undefined)

    expect(team, '团存在 ⇒ 视图必须非 null').not.toBeNull()
    // ⚠ 本行就是本次改动的**要害断言**：改动前 `src/host-data.ts` 这里是 `messages: []`。
    // 反恒真（已实测）：把它改回 `[]` → 本行必红。
    expect(team?.messages, '账本有消息 ⇒ wire 不得为空态').toHaveLength(1)
    // 逐字相等（不是 `toMatchObject`）：多一个字段、少一个字段、改一个值都会红。
    // `occurredAt` 必须是**时间戳数字**且等于事件基座那个值（契约见 `src/wire.ts:120-127`）。
    expect(team?.messages).toEqual([
      {
        messageId: MESSAGE_A,
        channelId: CHANNEL_A,
        threadId: THREAD_A,
        senderMemberId: MEMBER_A,
        body: BODY_A,
        occurredAt: OCCURRED_AT,
      },
    ])
    // 时间进的是**基座**，不在 `data` 里 —— 这条把「别往 data 里塞时间」的运行期事实钉住。
    const event = ledger.read({}).events.find((e) => e.kind === 'team/message-sent')
    expect(event).toBeDefined()
    expect(Object.hasOwn(event?.data ?? {}, 'occurredAt'), 'data 里不得有 occurredAt').toBe(false)
  })

  it('wire 只带**本团频道**的消息（别的团的消息不得漏进来）', () => {
    const ledger = newLedger()
    seedTeam(ledger, TEAM_A, '甲团', MEMBER_A, POSITION_A, CHANNEL_A, THREAD_A)
    seedTeam(ledger, TEAM_B, '乙团', MEMBER_B, POSITION_B, CHANNEL_B, THREAD_B)
    commit(ledger, messageSent(MESSAGE_A, CHANNEL_A, THREAD_A, MEMBER_A, BODY_A))
    commit(ledger, messageSent(MESSAGE_B, CHANNEL_B, THREAD_B, MEMBER_B, BODY_B))

    // `fold` 是**全量**的（不带 scopes 的 rebuildFold），两张团的消息都在它里面。
    const fold = rebuildFold(ledger).fold
    expect(fold.messages.size, '前置：折叠里确实有两条消息').toBe(2)

    const teamA = buildWireTeam(fold, TEAM_A, () => undefined)
    // 反恒真：把 host-data 里的本团频道过滤去掉（直接倒 `fold.messages`）→ 必红。
    expect(teamA?.messages.map((m) => m.body)).toEqual([BODY_A])

    const teamB = buildWireTeam(fold, TEAM_B, () => undefined)
    expect(teamB?.messages.map((m) => m.body)).toEqual([BODY_B])
  })

  it('空账本（只有团/频道/线程，没有消息）⇒ wire 的 messages 如实为 `[]`（不是 undefined）', () => {
    const ledger = newLedger()
    seedTeam(ledger, TEAM_A, '甲团', MEMBER_A, POSITION_A, CHANNEL_A, THREAD_A)

    const team = buildWireTeam(rebuildFold(ledger).fold, TEAM_A, () => undefined)

    // 「没有消息」与「宿主没实现这个字段」必须可区分（undefined ≠ 无消息）。
    expect(team?.messages).toEqual([])
  })
})

/**
 * 宿主 → 运行时的**通知**边界（`wakeMemberForMessage` → `MemberRuntime.notify`）。
 *
 * ## 为什么这组单独存在
 *
 * 2026-09-24 起，运行时投给 agent 的是**合法 user message**（`{role,id,content,source}`，
 * 见 `src/runtime/notice-message.ts`）—— 于是 `MemberNotice`（`{items,text}`）
 * **不再**出现在 agent 边界上，而 `ref` / `newestSequence` 是运行时的**去重与水位**载体：
 * 它们在**这一层**（宿主交给运行时的输入）仍然完全可观测。
 *
 * 把 ref 的断言放在这一层而不是 agent 那一层，是**如实**而不是弱化：
 * ref 本来就是"宿主怎么描述这条待办"，不是"agent 读到什么"。
 */
describe('宿主 → 运行时：通知里的待办项（ref / 水位）', () => {
  it('★ ref = `<threadId>@msg-<messageId>`；两条不同消息的 ref 必不相同', () => {
    const seen: MemberNotice[] = []
    const notifier = {
      notify: (memberId: MemberId, notice: MemberNotice): MemberWakeOutcome => {
        seen.push(notice)
        return { kind: 'delivered', channel: memberId === MEMBER_A ? 'followup' : 'followup' }
      },
    }
    const deliveries = ['msg-aaaa', 'msg-bbbb'].map((messageId) =>
      wakeMemberForMessage({
        notifier,
        senderMemberId: null,
        threadId: THREAD_A as ThreadId,
        recipientMemberId: MEMBER_A,
        content: '正文',
        // 与宿主侧的取法逐字一致（`src/host-data.ts` 的 `refKey`）。
        refKey: `${THREAD_A}${SOPHIA_REPLY_REF_MARKER}${messageId}`,
        newestSequence: 7,
      }),
    )
    expect(deliveries.map((one) => one.delivered)).toEqual([true, true])
    expect(seen).toHaveLength(2)
    expect(seen[0]!.items[0]).toEqual({
      ref: `${THREAD_A}${SOPHIA_REPLY_REF_MARKER}msg-aaaa`,
      revision: 7,
      unreadCount: 1,
      newestSequence: 7,
    })
    // ⚠ 这是**唯一**还能观测到 ref 的地方：ref 撞了 ⇒ 运行时会判 duplicate ⇒
    // agent 边界上那条消息**根本不会出现**（那边只剩"投递次数"这一个信号）。
    expect(seen[0]!.items[0]!.ref).not.toBe(seen[1]!.items[0]!.ref)
    // 人类发信人 ⇒ 文案说「来自主人」（不是"某个成员"）。
    expect(seen[0]!.text).toBe(`你收到了来自主人的一条消息（线程 ${THREAD_A}）：正文`)
  })
})

/**
 * 面板发消息 → **唤醒被 @ 的成员**。
 *
 * ## 为什么这一组要「真运行时 + 假 agent」
 *
 * 唤醒的可观测结果**不在宿主这一侧**：宿主能做的是「把一条形状正确、发信人写着
 * 主人的通知交给运行时」。运行时内部还隔着三道门（输入形状 → 生命周期 → **活句柄**），
 * 只有全过才会真正调 `agent.followup()/steer()`。
 *
 * 所以本组用**真的** `createDefaultMemberRuntime`（三道门、去重签名、双通道选择
 * 全都是真代码），只在**最外层**把 agent 换成记录器 —— 那是「成员到底收没收到」的
 * 唯一可观测边界。用假运行时去断言 `notify` 被调用过，只能证明宿主**写了这行代码**，
 * 证明不了「人起来了」。
 *
 * ⚠ 能证到的最强一句是「一条**合法 user message** 到达了 agent 边界」——
 * **不是**「真 agent 收到了/开始干活了」。后者要真 Agent 跑一次（烧一次真实模型
 * turn），留给后续分段；本组证明的是：一旦某个成员有活句柄，这条链就会把一条
 * 形状合法的消息交到那个边界上。
 *
 * ⚠ 另一个已修的坑（本组留了两条用例把两侧都钉住）：缺活句柄时唤醒结论必须是
 * `no-handle` 且 `delivered:false` —— 所谓「唤醒」在那种情况下**什么都没发生**，
 * 不许因为「字段写对了」就报成功。
 */
describe('面板发消息 → 唤醒被 @ 的成员（真运行时 + 假 agent）', () => {
  /** 一个记录器 agent：`status: 'idle'` ⇒ 运行时该走 `followup` 通道。 */
  function recordingAgent(
    followedUp: SophiaUserMessage[],
    steered: SophiaUserMessage[],
  ): MemberAgent {
    return {
      id: 'fake-agent-1',
      status: 'idle',
      followup: (message) => {
        followedUp.push(message)
      },
      // 记下来而不是抛：走错通道要能在断言里**看见**（抛错只会变成 delivery-failed，
      // 反而看不出「通道选错了」）。
      steer: (message) => {
        steered.push(message)
      },
    }
  }

  /**
   * 真运行时 + 一个**真的能激活**的 `createHandle`（这是与产品现状唯一的差别，
   * 见本 describe 的说明）。
   */
  function runtimeWithLiveHandle(
    ledger: Ledger,
    followedUp: SophiaUserMessage[],
    steered: SophiaUserMessage[],
  ): MemberRuntime {
    return createDefaultMemberRuntime(ledger, {
      mountPreset: () => undefined,
      applyToolPolicy: () => undefined,
      createHandle: async (input) => {
        // ⚠ 必须调 `input.setup(...)`：运行时靠它把 preset 与工具策略**真的**挂上去，
        // 并校验它被调用过 —— 不调就判 `failed`（实测：第一次写这个假件时漏了它，
        // `activate` 返回 `failed`，唤醒全被句柄门挡成 `no-handle`）。
        await input.setup({ memberId: input.memberId, agentContext: {} })
        return { agent: recordingAgent(followedUp, steered), dispose: () => undefined }
      },
      // 生命周期门：账本里 `seedTeam` 写的是 `active`。
      lifecycleOf: () => 'active',
    })
  }

  it('★ 被 @ 的成员收到的是一条**合法 user message**（role/content/source/id 齐备、已冻结），正文「来自主人」逐字相等', async () => {
    const ledger = newLedger()
    seedTeam(ledger, TEAM_A, '甲团', MEMBER_A, POSITION_A, CHANNEL_A, THREAD_A)
    const followedUp: SophiaUserMessage[] = []
    const steered: SophiaUserMessage[] = []
    const runtime = runtimeWithLiveHandle(ledger, followedUp, steered)
    // 前置：先真的激活他，否则运行时的句柄门会回 `no-handle`（那条路也有用例覆盖）。
    const activated = await runtime.activate({ memberId: MEMBER_A, teamId: TEAM_A, presetId: 'preset-x' })
    expect(activated.kind, '前置：成员必须真的被激活（有活句柄）').toBe('activated')

    const result = await sendTeamMessage(
      ledger,
      { threadId: THREAD_A, body: BODY_A, recipients: [MEMBER_A] },
      { notifier: runtime },
    )

    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') return
    // ⚠ 这两行就是「唤醒面」的**要害断言**：
    // 反恒真（已实测）：把 `sendTeamMessage` 里的 `wakes` 映射删掉 / 改成空数组 → 必红。
    expect(result.wakes, '被 @ 了一个人 ⇒ 一条唤醒结论').toHaveLength(1)
    expect(result.wakes[0]).toEqual({
      recipientMemberId: MEMBER_A,
      delivery: { kind: 'delivered', channel: 'followup', reason: null, delivered: true },
    })

    // ── 真正的证据在 agent 那一侧：它收到的是**什么形状的东西** ──
    //
    // ⚠ 本批把口径收紧了：能证到的最强一句是「一条**合法 user message** 进入了 agent 边界」。
    // 在此之前这里断言的是 `{items, text}` —— 那是运行时内部的**通知**载体，
    // 对真 agent 是一条没有 `content`/`source` 的**空消息**（不报错，只是成员读不到东西）。
    // 形状依据：`dsh-llm/lib/types/message.js:26-39`（`createMessage` = 展开入参 + 铸 id，
    // `freezeMessage` = `deepFreeze(structuredClone(msg))`），调用点
    // `dsh-api-session-controller/lib/types/commands.js:317`、
    // `dsh-agent-team/packages/agent-team/src/index.ts:2838-2841`。
    // **不声称**它已被真 agent 消费过 —— 那要真 Agent 跑一次（父任务留到后续分段）。
    expect(followedUp, 'idle 成员必须走 followup（走 steer 说明通道判错）').toHaveLength(1)
    expect(steered, '另一条通道必须 0 次').toHaveLength(0)
    const message = followedUp[0]!
    expect(message.role).toBe('user')
    expect(typeof message.id, 'id 必须存在：真 inbox 靠它增删条目').toBe('string')
    expect(message.id.length).toBeGreaterThan(0)
    expect(message.content).toEqual([
      // ⚠ 发信人是**主人**（不是「成员 X」）——这正是本批要求的那套通知口径。
      { type: 'text', text: `你收到了来自主人的一条消息（线程 ${THREAD_A}）：${BODY_A}` },
    ])
    expect(message.source).toEqual({
      kind: 'plugin',
      plugin: 'sophia',
      form: 'notice',
      summary: SOPHIA_NOTICE_SUMMARY,
    })
    // 冻结：上游 `freezeMessage` 就是 `deepFreeze(structuredClone(...))`。
    // 不冻结的消息对象能被下游就地改写，而它已经进了 inbox / 会被写进事件流。
    expect(Object.isFrozen(message)).toBe(true)
    expect(Object.isFrozen(message.content)).toBe(true)
  })

  it('同线程的**第二条**消息会再唤醒一次（ref 含 messageId ⇒ 不会被去重误压制）', async () => {
    const ledger = newLedger()
    seedTeam(ledger, TEAM_A, '甲团', MEMBER_A, POSITION_A, CHANNEL_A, THREAD_A)
    const followedUp: SophiaUserMessage[] = []
    const steered: SophiaUserMessage[] = []
    const runtime = runtimeWithLiveHandle(ledger, followedUp, steered)
    await runtime.activate({ memberId: MEMBER_A, teamId: TEAM_A, presetId: 'preset-x' })

    const first = await sendTeamMessage(ledger, { threadId: THREAD_A, body: BODY_A, recipients: [MEMBER_A] }, { notifier: runtime })
    const second = await sendTeamMessage(ledger, { threadId: THREAD_A, body: BODY_B, recipients: [MEMBER_A] }, { notifier: runtime })
    expect(first.kind).toBe('ok')
    expect(second.kind).toBe('ok')
    if (first.kind !== 'ok' || second.kind !== 'ok') return

    // 反恒真：把 `refKey` 换成只含 threadId（丢掉 messageId）→ 本条必红
    //（第二次会被运行时的去重签名判成 duplicate ⇒ `followup` 只被调 1 次）。
    expect(first.messageId).not.toBe(second.messageId)
    expect(followedUp, '两条不同的消息 ⇒ 两次唤醒').toHaveLength(2)
    expect(followedUp[0]?.content).toEqual([{ type: 'text', text: `你收到了来自主人的一条消息（线程 ${THREAD_A}）：${BODY_A}` }])
    expect(followedUp[1]?.content).toEqual([{ type: 'text', text: `你收到了来自主人的一条消息（线程 ${THREAD_A}）：${BODY_B}` }])
    // 两条消息的 id 必须不同（同一条消息重投才是 duplicate，不是"同一条被发两次"）。
    expect(followedUp[0]?.id).not.toBe(followedUp[1]?.id)
    expect(second.wakes[0]?.delivery.kind).toBe('delivered')
  })

  it('★ 没人激活过这个成员时，唤醒结论如实回 `no-handle`（**不假装送达**）', async () => {
    const ledger = newLedger()
    seedTeam(ledger, TEAM_A, '甲团', MEMBER_A, POSITION_A, CHANNEL_A, THREAD_A)
    const followedUp: SophiaUserMessage[] = []
    const steered: SophiaUserMessage[] = []
    // 真运行时，但**不**调 `activate`：这正是产品在「Agent 底座没接上」时的形状。
    const runtime = runtimeWithLiveHandle(ledger, followedUp, steered)

    const result = await sendTeamMessage(ledger, { threadId: THREAD_A, body: BODY_A, recipients: [MEMBER_A] }, { notifier: runtime })

    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') return
    expect(result.wakes[0]?.delivery).toEqual({
      kind: 'no-handle',
      channel: null,
      reason: null,
      delivered: false,
    })
    expect(followedUp, '没有活句柄 ⇒ 一次投递都不该发生').toHaveLength(0)
    // 但消息照样落账：唤醒是尽力而为，账本是事实。
    expect(rebuildFold(ledger).fold.messages.get(result.messageId as MessageId)?.body).toBe(BODY_A)
  })

  it('`recipients` 为空（主人没 @ 谁）⇒ 谁都不唤醒，但消息**照样落账**', async () => {
    const ledger = newLedger()
    seedTeam(ledger, TEAM_A, '甲团', MEMBER_A, POSITION_A, CHANNEL_A, THREAD_A)
    const followedUp: SophiaUserMessage[] = []
    const steered: SophiaUserMessage[] = []
    const runtime = runtimeWithLiveHandle(ledger, followedUp, steered)
    await runtime.activate({ memberId: MEMBER_A, teamId: TEAM_A, presetId: 'preset-x' })

    const result = await sendTeamMessage(ledger, { threadId: THREAD_A, body: BODY_A, recipients: [] }, { notifier: runtime })

    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') return
    // 决定：只唤醒被 @ 的人，**不**顺手唤醒线程的 assignee（那会烧一次没被要求的模型 turn）。
    expect(result.wakes).toEqual([])
    expect(followedUp, '没人被 @ ⇒ 一次都不该唤醒').toHaveLength(0)
    // 但「主人说了这句话」是事实，必须落账并在视图里可见。
    expect(rebuildFold(ledger).fold.messages.get(result.messageId as MessageId)?.body).toBe(BODY_A)
  })
})
