/**
 * 双模草案与运行模式（SPEC §2.4 / FR-1 / FR-2）。
 *
 * ⚠ 本文件只冻结**类型与默认常量**；草案的**生成行为**（FR-1/FR-2）属于里程碑，
 * 在 `sophia-core` 本期范围外（SPEC §0）。
 */

import type { ChannelId, MemberId, PlanId } from './ids.ts'

/** FR-2.2 模式二选一；FR-2.1 默认 `persistent-team`。 */
export type RunMode = 'persistent-team' | 'dag-scheduler'

/**
 * 默认运行模式（FR-2.1）。
 *
 * 由 `tests/types.spec.ts` 断言取值（AC-STAGE-1）；把字面量改成 `'dag-scheduler'` 该用例必须变红。
 */
export const DEFAULT_RUN_MODE: RunMode = 'persistent-team'

/**
 * 双模草案（FR-1）：一次核准同时给出「团队形态」与「DAG 形态」两套编排，
 * 由人类在 FR-2 的核准动作里二选一。
 *
 * ⚠ **本接口的形状逐字来自 SPEC §2.4，不得自行加字段**（评审提过若干「应该加」的建议，
 * 逐条说明为何不加，以免后来者重复提）：
 * - 不加 `threadId` 到 `threads[]`：SPEC §2.4 钉的是 `{title, assignee}`。草案里的线程是
 *   **尚不存在的拟建项**，其 ID 在核准后由账本分配（`team/thread-started`）；草案里就写 ID
 *   等于让「拟定」与「已建」共享标识，反而制造两者混淆。真正需要 ID 的是已建线程，
 *   它在 `ThreadStartedData` 里。
 * - 不给 `assigneeLabel` 加品牌/外键约束：`teamPlan` 的成员已有 `MemberId`，
 *   而 `dagPlan` 的 roster 成员是**尚未创建**的（provider/model 由草案选定），
 *   此刻没有 `memberId` 可指，只能用 label 关联。跨引用校验属 FR-1 的生成行为
 *   （SPEC §0 明确划在范围外），不是类型层能表达的。
 * - `workspaceId` 保持 `string`：`ids.ts` 没有 `WorkspaceId`，而 SPEC §2.4 逐字写的是
 *   `readonly workspaceId: string`；发明一个品牌会让本接口与契约产生差异。
 */
export interface StagingDualPlan {
  readonly planId: PlanId
  readonly workspaceId: string
  readonly goal: string
  readonly teamPlan: {
    readonly channelId: ChannelId
    readonly members: readonly {
      readonly memberId: MemberId
      readonly label: string
      readonly role: string
    }[]
    readonly threads: readonly { readonly title: string; readonly assignee: MemberId }[]
  }
  readonly dagPlan: {
    readonly roster: readonly {
      readonly label: string
      readonly provider: string
      readonly model: string
    }[]
    readonly tasks: readonly {
      readonly id: string
      readonly name: string
      readonly deps: readonly string[]
      readonly assigneeLabel: string
    }[]
  }
}
