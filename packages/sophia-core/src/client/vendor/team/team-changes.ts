/**
 * 上游 `team-changes.ts`（6.1KB）的索菲亚版。
 *
 * ## 上游结构里哪一部分**有宿主支撑**、哪一部分**没有**（逐条，不静默删）
 *
 * | 上游成员 | 索菲亚处置 | 依据 |
 * |---|---|---|
 * | `TeamChangeScope` / `scopeKey()` | **逐字保留**（纯类型 + 字符串拼接，零宿主依赖） | — |
 * | `TeamReadStream` | **逐字保留**（纯本地版本计数器） | — |
 * | `TeamChangeUpdate` / `TeamChangeListener` | **改为从 `./slots.ts` 转出** | 索菲亚早先已在 `slots.ts` 声明同形类型；两份定义会让「changed/failed 的载荷形状」分叉 ⇒ 一处真相 |
 * | `TeamChangeStream`（remote 流载体） | **载体重接**：`open()` 改接索菲亚的 `SubscribeTeamChanges`（`PanelStore.subscribe`） | 见下 |
 * | `RemoteStreamCarrierError` / `ClientRemote` / `RemoteStream` / `agentTeam.changes` | **索菲亚整条缺失** | 见下 |
 *
 * ## ⚠ 宿主事实面的真实缺口（可核）
 *
 * 上游这个类建立在三个索菲亚**没有**的东西上：
 *
 * 1. `@deepseek-ai/dsh-api-gateway/client` 的 `ClientRemote.$stream` —— 索菲亚的
 *    插件清单里没有这个包（`upstream-modules.d.ts` 只声明了 `ui-primitives` /
 *    `ui-model-selection` / `dsh-session/types` / `dsh-subagent/client` 四个模块），
 *    它也不在 `tsdown.config.ts` 的 `PLATFORM_MODULES` 里。
 * 2. 上游包 `@wowyuarm/dsh-agent-team/remote` 的 `agentTeam.changes` 声明。
 * 3. 上游包 `@wowyuarm/dsh-agent-team/types` 的 `AgentTeamChangeScope` /
 *    `AgentTeamChangesResult`。
 *
 * 索菲亚的对应物是 `PanelStore.subscribe`（`panel-store.ts`，文件头说明「只用
 * React 的 hook 订阅我们自己知道何时变化的那一个值」）—— 它**没有 scope 分片、
 * 没有版本流、没有 carrier 恢复**，`slots.ts` 的 `SubscribeTeamChanges` 就是它的类型。
 *
 * ⇒ 处置：**保留上游的类名、公开方法（`subscribe` / `recover` / `dispose`）与
 * 「一个 scope 一条订阅、最后一个 listener 走了才取消」的引用计数语义**，
 * 把载体从 remote stream 换成注入进来的索菲亚订阅函数。这样：
 * 界面侧的调用点（`TeamThreadPage` 的三条 `subscribeChanges`）**一行都不用改**，
 * 而上游那套语义在索菲亚的数据面下仍然成立（see `subscribe` 的注释）。
 *
 * **不写成「假的 remote stream」**：索菲亚没有 carrier 与重连，`recover()` 于是
 * 成了空操作并**显式注明原因**，而不是假装重开了一条流。
 *
 * @module @sophia/core/client/vendor/team/team-changes
 */

import type { AgentTeamChannelRef, AgentTeamThreadRef } from './agent-team-types.ts'
import type { SubscribeTeamChanges, TeamChangeListener, TeamChangeUpdate } from './slots.ts'

export type { TeamChangeListener, TeamChangeUpdate } from './slots.ts'

/**
 * 上游的变更作用域（四支判别联合）。
 *
 * ⚠ 索菲亚**没有 scope 分片**（`slots.ts` 的 `SubscribeTeamChanges` 说明：
 * 上游三条按 scope 分片的订阅在索菲亚塌缩成一条）。本类型**逐字保留**上游形状，
 * 是为了：① `scopeKey()` 有确定的输入契约；② 界面侧的
 * `subscribeChanges({ kind: 'thread', threadRef }, …)` 调用点能照抄上游、
 * 一看就知道对应哪一行。索菲亚的订阅实现**忽略**这个参数。
 */
export type TeamChangeScope =
  | { readonly kind: 'workspace'; readonly workspaceId: string }
  | { readonly kind: 'channel'; readonly channelRef: AgentTeamChannelRef }
  | { readonly kind: 'presence'; readonly workspaceId: string }
  | { readonly kind: 'thread'; readonly threadRef: AgentTeamThreadRef }
  | undefined

function scopeKey(scope: TeamChangeScope): string {
  return scope === undefined ? 'all'
    : scope.kind === 'workspace' ? `workspace:${scope.workspaceId}`
    : scope.kind === 'channel' ? `channel:${scope.channelRef}`
    : scope.kind === 'presence' ? `presence:${scope.workspaceId}`
    : `thread:${scope.threadRef}`
}

interface ScopeSubscription {
  readonly scope: TeamChangeScope
  /** 索菲亚的取消订阅函数（上游这里是 `RemoteStream<…>`，见文件头缺口说明）。 */
  readonly dispose: () => void
  readonly listeners: Set<TeamChangeListener>
  failure: string | undefined
}

/**
 * One logical subscription per scope per page.
 *
 * ⚠ 上游是「Harness owns the shared transport and recovery」——索菲亚**没有**
 * 共享传输层，它有的是 `PanelStore` 的一次 `subscribe`：索菲亚的唤醒是**无作用域**的，
 * 因此「一个 scope 一条流」在索菲亚塌缩成「一个 scope 一条**引用计数**」，
 * 底层共用同一个 `PanelStore` 订阅分发（每个 scope 各订阅一次，
 * 由 `PanelStore` 自己保证多次 `subscribe` 的开销可控）。
 */
export class TeamChangeStream {
  private readonly subscriptions = new Map<string, ScopeSubscription>()

  /**
   * ⚠ 上游构造参数是 `Pick<ClientRemote, '$stream' | 'agentTeam'>`（remote 载体）。
   * 索菲亚换成它真有的那一个订阅入口 —— `SubscribeTeamChanges`
   * （`slots.ts` 定义，实现是 `PanelStore.subscribe`）。
   */
  constructor(private readonly subscribeToChanges: SubscribeTeamChanges) {}

  subscribe(scope: TeamChangeScope, listener: TeamChangeListener): () => void {
    const key = scopeKey(scope)
    let subscription = this.subscriptions.get(key)
    if (subscription === undefined) {
      subscription = this.open(scope, new Set([listener]))
      this.subscriptions.set(key, subscription)
    } else {
      subscription.listeners.add(listener)
      if (subscription.failure !== undefined) listener({ type: 'failed', message: subscription.failure })
    }
    const owned = subscription
    return () => {
      if (!owned.listeners.delete(listener) || owned.listeners.size !== 0) return
      if (this.subscriptions.get(key) === owned) this.subscriptions.delete(key)
      owned.dispose()
    }
  }

  /**
   * Reopen every scope whose stream already ended for good.
   *
   * ⚠ 索菲亚处置：**空操作**。上游这段建立在「carrier 断开后有终态、需要一条新的
   * Host generation 才能恢复」之上；索菲亚的 `PanelStore.subscribe` **没有终态**
   * （它要么在、要么被取消），也就没有「已经死透的 scope」可重开。
   * 保留方法是为了让上游的调用点（页面在 reconnect 后调 `recover()`）不必改写法，
   * 并在它变成真实需求时（宿主接上流式载体）直接在这里接回去。
   */
  recover(): void {
    // 见方法注释：索菲亚没有 carrier 终态，无可恢复对象。
  }

  async dispose(): Promise<void> {
    const subscriptions = [...this.subscriptions.values()]
    this.subscriptions.clear()
    for (const subscription of subscriptions) subscription.dispose()
  }

  private fail(key: string, message: string): void {
    const subscription = this.subscriptions.get(key)
    if (subscription === undefined || subscription.failure !== undefined) return
    subscription.failure = message
    for (const listener of subscription.listeners) listener({ type: 'failed', message })
  }

  /** 打开一条 scope 订阅：载体是索菲亚的 `SubscribeTeamChanges`（见文件头缺口说明）。 */
  private open(scope: TeamChangeScope, listeners: Set<TeamChangeListener>): ScopeSubscription {
    const key = scopeKey(scope)
    // 上游这里 `open:` 拿到的是一批**带版本的 baseline**；索菲亚的唤醒载荷带
    // `version`（`PanelStore` 的单调计数）⇒ 上游「每次 baseline 落地都要唤醒」
    // 的语义直接成立，`run()` 那条驱动循环与 carrier 判据一并消失。
    const dispose = this.subscribeToChanges(scope, update => {
      if (this.subscriptions.get(key)?.scope !== scope && !this.subscriptions.has(key)) return
      // 索菲亚的 `TeamChangeUpdate.message` 是 `string | undefined`（只有 `failed`
      // 那一支带它）⇒ 这里 `?? ''`，与 `slots.ts` 的可选声明一致。
      if (update.type === 'failed') { this.fail(key, update.message ?? ''); return }
      // Every opening baseline invalidates too: this closes the initial-read
      // race and recovers failed reads even when nothing changed while offline.
      const subscription = this.subscriptions.get(key)
      if (subscription !== undefined) subscription.failure = undefined
      for (const listener of listeners) listener(update)
    })
    return { scope, dispose, listeners, failure: undefined }
  }
}

/**
 * The Host's `changes` stream never wakes on a Thread read — a read advances
 * only the reader's private watermark, so no shared projection changes. A
 * durable read does consume the reader's own mention markers, so the Human's
 * badge and Inbox page refresh from the completed read itself instead of
 * waiting for the next unrelated commit.
 *
 * ⚠ 本类**零宿主依赖**（纯本地版本计数器），故**逐字照抄上游**。
 */
export class TeamReadStream {
  private version = 0
  private readonly listeners = new Set<() => void>()

  bump(): void {
    this.version += 1
    for (const listener of this.listeners) listener()
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
}
