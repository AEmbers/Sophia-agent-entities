/**
 * 上游 `human-identity.ts`（169 行）的索菲亚版 —— **人类身份的唯一投影**。
 *
 * ## 索菲亚移植点（三处，逻辑逐字）
 *
 * | 上游 | 索菲亚 | 理由 |
 * |---|---|---|
 * | `import { useSyncExternalStore } from 'react'` | `hooks()` 惰性取 | 顶层值导入会多撞一次 `require(` ≤ 2 的断言 |
 * | `RemoteResult<T>`（`@deepseek-ai/dsh-typert-protocol`） | `TeamRemoteResult<T>`（`./slots.ts`） | 索菲亚没有 typert 那个包，形状逐字相同 |
 * | `AgentTeamHumanProfileResult`（`@wowyuarm/dsh-agent-team/types`） | 本文件的 `TeamHumanProfileResult` | 索菲亚的 `agent-team-types.ts` 里**没有**这个类型（见下） |
 *
 * ## ⚠ 索菲亚当前**没有消费者**，以及为什么仍然抄（如实说明）
 *
 * 上游这个 store 服务两处：① 会话座里每处画人类的地方（`useHumanIdentity`）；
 * ② **人类资料设置页**（`HumanSettingsSection`）。
 *
 * 索菲亚两处都还没接上，因为**宿主没有对应的读面**：
 * `src/host.ts` 注册的路由里没有 `humanProfile` / `getHumanAvatar`
 * （逐条清单见 `bridge.ts` 的「10 条路由」注释与 `slots.ts` 的剥除清单）。
 * 会话座因此走**本地化兜底**（`t('human')`，见 `TeamConversation.tsx`）——
 * 那正是上游 `identity.name ?? t('human')` 的右支。
 *
 * 抄它的理由与 `team-membership.ts` 同源：主人点名了这份依赖清单；
 * 而 store 的逻辑（「第一次订阅才开始读」「失败保留上一个已接受的值」
 * 「头像字节按 ref 记忆」）是**与数据源无关**的，宿主补上读面后
 * 只需在 `index.ts` 里接一个 `TeamHumanIdentityLoader`，本文件一行不用改。
 *
 * ## 为什么 profile 的形状是**本地重新声明**的
 *
 * 上游的 `AgentTeamHumanProfileResult` 是宿主侧类型（`@wowyuarm/dsh-agent-team/types`）。
 * 索菲亚的 `agent-team-types.ts` 只镜像**界面真的会用到的**那些上游类型，
 * 而人类 profile 目前没有被任何界面消费 ⇒ 不在那份镜像里（不发明）。
 * 本文件声明它的**用到的字段**（`name` / `avatarRef` / `version` / `repoUrl` /
 * `updateAvailable` / `latestVersion`），字段名与上游逐字一致 ——
 * 宿主将来把那份 result JSON 出来就能直接对上。
 *
 * @module @sophia/core/client/vendor/team/human-identity
 */

import { hooks } from '../../react-runtime.ts'
import type { TeamRemoteResult } from './slots.ts'

/**
 * Host settings namespace that holds the Human profile. The Host declares the
 * same string on its own side of the bundle boundary.
 *
 * ⚠ 索菲亚宿主**尚未**声明这个名字（没有人类资料设置面）——
 * 保留它是为了与上游同名，将来接上时不必改名。
 */
export const HUMAN_PROFILE_NAMESPACE = 'agent-team-human'

/**
 * 一次人类资料读取的结果。
 *
 * ⚠ 上游是 `AgentTeamHumanProfileResult`；索菲亚这里按**用到的字段**重新声明
 * （理由见文件头）。`updateAvailable` **不可选** —— 上游那份也必填，
 * 而「有没有新版本」是一个陈述，缺省即未知，不该被静默当成 `false`。
 */
export interface TeamHumanProfileResult {
  /** 宿主解析出的显示名。 */
  readonly name?: string | undefined
  /** 已配置的头像引用；`undefined` 表示用首字兜底。 */
  readonly avatarRef?: string | undefined
  /** 设置页脚注用的版本号。 */
  readonly version?: string | undefined
  /** 设置页脚注链接指向的仓库主页。 */
  readonly repoUrl?: string | undefined
  readonly updateAvailable: boolean
  readonly latestVersion?: string | undefined
}

/** One read of the Human identity, replaced wholesale on every change. */
export interface TeamHumanIdentitySnapshot {
  /**
   * `loading` until the first read settles, `ready` while an accepted value
   * stands (also when a later refresh failed), `unavailable` when no value was
   * ever accepted — the one state that hands the page a retry.
   */
  readonly status: 'loading' | 'ready' | 'unavailable'
  /** Host-resolved display name; undefined before the first accepted read. */
  readonly name?: string | undefined
  /** Configured avatar reference; undefined means the identity fallback is the avatar. */
  readonly avatarRef?: string | undefined
  /** Avatar bytes as a data URL for `<img>`; undefined renders the fallback. */
  readonly avatarUrl?: string | undefined
  /** Bundle version for the settings footnote. */
  readonly version?: string | undefined
  /** Repository home the footnote links to. */
  readonly repoUrl?: string | undefined
  readonly updateAvailable: boolean
  readonly latestVersion?: string | undefined
  /** Last failure, kept beside the last accepted value so a page can report it. */
  readonly error?: string | undefined
}

/** Read-side face every consumer binds: the seats' hook and the settings page alike. */
export interface TeamHumanIdentitySource {
  getSnapshot(): TeamHumanIdentitySnapshot
  subscribe(listener: () => void): () => void
}

/** The settings page's extra face: re-read after a failed or superseded read. */
export interface TeamHumanIdentityFace extends TeamHumanIdentitySource {
  refresh(): Promise<void>
}

/** Host calls the store reads through; one loader per Client context. */
export interface TeamHumanIdentityLoader {
  loadProfile: () => Promise<TeamRemoteResult<TeamHumanProfileResult>>
  /** Resolve one avatar reference to a displayable URL; null falls back to the initial. */
  loadAvatarUrl: (avatarRef: string) => Promise<string | null>
}

const INITIAL: TeamHumanIdentitySnapshot = { status: 'loading', updateAvailable: false }

export class TeamHumanIdentity implements TeamHumanIdentityFace {
  private snapshot: TeamHumanIdentitySnapshot = INITIAL
  private readonly listeners = new Set<() => void>()
  private reading: Promise<void> | undefined
  private readonly loader: TeamHumanIdentityLoader

  constructor(loader: TeamHumanIdentityLoader) {
    this.loader = loader
  }

  readonly getSnapshot = (): TeamHumanIdentitySnapshot => this.snapshot

  /**
   * Observe the identity, starting the first read when nobody has read yet.
   * @param listener - invoked after every snapshot replacement.
   * @returns the disposer removing this listener.
   */
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    if (this.snapshot.status === 'loading' && this.reading === undefined) void this.refresh()
    return () => { this.listeners.delete(listener) }
  }

  /**
   * Re-read the Host projection. Concurrent callers share one round trip, and a
   * failed refresh keeps the last accepted value beside the reported error —
   * the seats never blank out because a background read failed.
   * @returns settlement of this read (or of the read already in flight).
   */
  refresh(): Promise<void> {
    if (this.reading !== undefined) return this.reading
    const reading = this.read().finally(() => {
      if (this.reading === reading) this.reading = undefined
    })
    this.reading = reading
    return reading
  }

  dispose(): void {
    this.listeners.clear()
  }

  private async read(): Promise<void> {
    let profile: TeamHumanProfileResult
    try {
      const result = await this.loader.loadProfile()
      if (!result.ok) {
        this.fail(result.error.message)
        return
      }
      profile = result.value
    } catch (error) {
      // A dropped connection surfaces as a thrown carrier error, not a result:
      // both are read failures and both keep whatever value already stands.
      this.fail(error instanceof Error ? error.message : String(error))
      return
    }
    // Bytes are immutable per reference, so one fetch serves every later
    // refresh that still carries the same avatar.
    const avatarUrl = profile.avatarRef === undefined
      ? undefined
      : profile.avatarRef === this.snapshot.avatarRef && this.snapshot.avatarUrl !== undefined
        ? this.snapshot.avatarUrl
        : (await this.loader.loadAvatarUrl(profile.avatarRef)) ?? undefined
    this.commit({
      status: 'ready',
      name: profile.name,
      ...(profile.avatarRef === undefined ? {} : { avatarRef: profile.avatarRef }),
      ...(avatarUrl === undefined ? {} : { avatarUrl }),
      version: profile.version,
      repoUrl: profile.repoUrl,
      updateAvailable: profile.updateAvailable,
      ...(profile.latestVersion === undefined ? {} : { latestVersion: profile.latestVersion }),
    })
  }

  /**
   * Record one read failure. A value that was already accepted stays on screen
   * (the seats never blank out over a background read), and only an identity
   * that never loaded becomes `unavailable` — the state that offers a retry.
   */
  private fail(message: string): void {
    const held = this.snapshot
    this.commit(held.name === undefined
      ? { ...held, status: 'unavailable', error: message }
      : { ...held, status: 'ready', error: message })
  }

  private commit(snapshot: TeamHumanIdentitySnapshot): void {
    this.snapshot = snapshot
    for (const listener of this.listeners) listener()
  }
}

/** Subscribe one rendered seat to the identity. */
export function useHumanIdentity(identity: TeamHumanIdentitySource): TeamHumanIdentitySnapshot {
  const { useSyncExternalStore } = hooks()
  return useSyncExternalStore(identity.subscribe, identity.getSnapshot, identity.getSnapshot)
}
