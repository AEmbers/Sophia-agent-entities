/**
 * 品牌化 ID（SPEC §2.1）。
 *
 * 这些 ID 在编译期互不可赋值（AC-ID-1）—— 把「团 ID」传进要「成员 ID」的参数会直接报错，
 * 而运行期它们都只是 `string`，零运行时开销。
 *
 * 为什么自持定义而不从 `@deepseek-ai/*` 引入（SPEC §1.1，本机实测）：
 * DSH SDK 安装（`~/.dsh/core-0.1.5-rc.1/@deepseek-ai`，243 个包目录）递归含 **0** 个 `.d.ts`，
 * `import type { SessionId } from '@deepseek-ai/dsh-session'` 报 `TS7016` 并以 exit 2 失败。
 */

declare const brand: unique symbol

/**
 * 品牌类型构造器。
 *
 * 单独导出仅为让下游包（`sophia-tools` 等）能声明自己的品牌 ID；它不削弱
 * SPEC §2.1 的约束 —— 每个 `B` 是不同的字面量，两个品牌之间互相不可赋值。
 * （实现与 SPEC §2.1 的 `declare` 片段等价，仅多了一个 `export`。）
 */
export type Brand<T, B extends string> = T & { readonly [brand]: B }

/** 团 ID（持久团 / 临时团 / DAG 团队统一使用，FR-5.1）。 */
export type TeamId = Brand<string, 'TeamId'>
/** 成员 ID，形如 `sophia-<position-slug>-<uuid8>`（FR-8.3）。 */
export type MemberId = Brand<string, 'MemberId'>
/** DAG 团队 ID（FR-7.1）。 */
export type DagTeamId = Brand<string, 'DagTeamId'>
/** 频道 ID。 */
export type ChannelId = Brand<string, 'ChannelId'>
/** Task Thread ID（FR-3.3）。 */
export type ThreadId = Brand<string, 'ThreadId'>
/**
 * 消息 ID（`team/message-sent` 的载荷字段）。
 *
 * 为什么单开一个品牌而不是复用 `EventId`：两者**生命周期不同** ——
 * 账本事件的 `eventId` 由账本自己发（一条事件一个），而消息 ID 由**写入方**发，
 * 是「这条消息」在界面上的稳定身份（线程时间线/频道预览都按它去重与排序）。
 * 复用 `EventId` 会把「消息身份」与「账本行身份」绑死，将来消息被别的事件
 * 形态承载（如编辑、撤回）时就没有独立身份可用。
 */
export type MessageId = Brand<string, 'MessageId'>
/** 双模草案 ID（FR-1）。 */
export type PlanId = Brand<string, 'PlanId'>
/** 账本事件 ID（FR-10.1）。 */
export type EventId = Brand<string, 'EventId'>
/** 派生审批票据 ID（FR-5.3）。 */
export type SpawnTicketId = Brand<string, 'SpawnTicketId'>
/** 幂等 / 审计请求 ID（FR-5.3.4 的「不得绕开」按此绑定）。 */
export type RequestId = Brand<string, 'RequestId'>
/**
 * 窗口会话 ID（宿主 / 传旨通道）。
 *
 * ⚠ 它**不是**团的存在性锚点，具体到字段级是两条（AC-ROLE-1）：
 * - `Host` 上**没有** `teamId`（宿主与团是多对多、可替换的引用，不是所有权）；
 * - `Team` 上**没有** `hostSessionId`，只有可选的、**纯审计**的 `lastHostSessionId`
 *   （见 `team.ts`）—— 「最近一次是哪个窗口呈送的」不构成团的存在条件，
 *   所以窗口关闭不会让团变成僵尸团。
 *
 * （措辞精确到「没有 `hostSessionId` 而只有 `lastHostSessionId`」很重要：
 * 写成宽松的「Team 上没有任何会话字段」会诱导后来者把审计字段也删掉。）
 *
 * 对治上游 `dsh-agent-teams/src/types.ts:248` 的 `captainSessionId` 僵尸团。
 */
export type HostSessionId = Brand<string, 'HostSessionId'>
