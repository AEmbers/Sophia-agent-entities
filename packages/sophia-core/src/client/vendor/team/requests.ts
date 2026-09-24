/**
 * 上游 `requests.ts` 的索菲亚版 —— **只留索菲亚真有的那一个请求**。
 *
 * ## 上游这个文件里有什么、索菲亚留下了什么
 *
 * | 上游导出 | 索菲亚处置 |
 * |---|---|
 * | `mintRequestId()` —— `crypto.randomUUID()` 生成幂等键 | **剥掉**（理由见下） |
 * | `uploadComposerFiles(putAttachment, …)` —— 逐个上传附件 | **剥掉**（索菲亚没有附件路由） |
 * | `bytesToBase64(bytes)`（来自 `attachment-preview.ts`） | 随附件一起剥掉 |
 * | —— | **新增** `requestTeamMessage()`：索菲亚唯一的发送入口 |
 *
 * ## 为什么 `mintRequestId` 必须剥掉（不是顺手）
 *
 * 上游每一个**写操作**都带一个客户端生成的 `requestId`，宿主用它做
 * **幂等重放保护**（同一个 requestId 重复提交只落盘一次）。这是上游
 * 「非乐观 UI + 可安全重试」的基础设施（`TeamThreadPage` 里有 5 处
 * `mintRequestId()`，`mutationRequests` 那个 Map 专门跨重试复用同一个 id）。
 *
 * 索菲亚的宿主**没有**这套幂等面：`host.ts` 注册的（现已 10 条）路由里没有一条
 * 接受 `requestId`（`/api/sophia/channel` 与 `/api/sophia/member` 都只有
 * `teamId` + 业务参数）。⇒ 留着一个生成的 `requestId` 只会石沉大海，
 * 而**更坏的是**：它会让阅读者以为「重试是幂等的」，从而以为重试安全 ——
 * 那是一句**没有实现支撑**的承诺。
 *
 * ⚠ 索菲亚**有**一条真正的幂等面，只是它在**另一层**：
 * `sophia_spawn_team` 的 `requestId`（工具面，见 `src/tools/spawn-team.ts`
 * 与 `sophia_spawn_team` 的描述）。那是**建团审批**的幂等键，与「发消息」
 * 无关，不能借来用。
 *
 * ## 为什么发送仍然要有一条路由（而不是整条剥掉）
 *
 * 因为 `TeamComposer` / `TeamThreadPage` 的**提交路径是两页的核心 UI**
 * （主人截图里那一页的输入框）。整条剥掉等于把输入框变成死控件。
 * ⇒ 保留一个**诚实的**实现：打到索菲亚的这条路由，
 * **路由不存在时如实把 404 变成可读错误**（与 `bridge.ts` 的 `PLAN_URL`
 * 同一处置手法 —— 那里也是「先指向候选项，宿主未实现时界面如实报错」）。
 * （订正：本条路由**已实现**，所以上面这段描述的是**降级路径**，不是当下的常态。）
 *
 * @module @sophia/core/client/vendor/team/requests
 */

import { requestAddMember, requestCreateChannel, requestLifecycle, type OpResult } from '../../panel-store.ts'
import type { AgentTeamMemberId, AgentTeamThreadRef } from './agent-team-types.ts'
import type {
  TeamAddMemberRequest,
  TeamCreateChannelRequest,
  TeamMemberLifecycleRequest,
  TeamRemoteResult,
  TeamReplyResult,
} from './slots.ts'

/**
 * 发送消息的路由。
 *
 * ⚠ **本文档曾是「候选路由」的写法，已订正。** 原文说「索菲亚宿主注册的 9 条路由里
 * **没有**发消息路由 ⇒ 本地址当下会 404」—— 那句现在**是错的**：
 * 宿主第 10 条路由 `POST /api/sophia/team/message` 已经存在
 * （`src/host.ts` 的 `teamMessageRoute` → `src/host-data.ts` 的 `sendTeamMessage`）。
 *
 * 它接受的请求体就是本模块 `TeamMessageRequest` 的形状
 * （`threadRef` / `body` / `recipients` —— **字段名照抄调用方，宿主侧没有改名**），
 * 响应是 `{ ok: true, messageId, occurredAt, sequence }`，
 * 或者 `{ ok: false, error }`（400 形状错 / 404 线程不存在 / 405 非 POST / 500 写账本失败）。
 *
 * 下文保留原注释里**仍然成立**的部分：那条 404 分支**不是缺陷掩盖**，而是降级路径 ——
 * 路由若被摘掉、或部署的是旧版本，`requestTeamMessage` 会把 404 变成可读原因
 * （「索菲亚宿主还没有消息发送路由」），界面在 composer 下方如实显示。
 * 「路由不存在」与「路由在但业务失败」必须**分开说**，混为一谈会让用户以为是
 * 自己的消息有问题。
 */
export const MESSAGE_ROUTE = '/api/sophia/team/message'

/** 一条待发消息。 */
export interface TeamMessageRequest {
  readonly threadRef: AgentTeamThreadRef
  readonly body: string
  /** 结构化提及：这些成员会被 @ 到（宿主侧据 id 而不是文本解析收件人）。 */
  readonly recipients: readonly AgentTeamMemberId[]
}

/** 从 response body 里取宿主的可读原因（照 `StagingPlanEditor.mutatePlan` 的手法）。 */
async function reasonOf(response: Response): Promise<string> {
  try {
    const body = await response.json() as { error?: unknown }
    if (typeof body.error === 'string' && body.error.trim() !== '') return body.error
  } catch {
    // body 不是 JSON / 读不出来 —— 退回 HTTP 状态码，**不吞掉**这个事实。
  }
  return `HTTP ${response.status}`
}

/**
 * 发一条消息。
 *
 * 返回形状与上游 `reply` 的 `RemoteResult` 一致（`{ok,value}|{ok,error}`），
 * 因为移植进来的调用点就是那么写的。
 *
 * ⚠ **结果只有两种，不是上游的五种。** 上游 `reply` 返回一个判别联合
 * （`committed` / `confirmation_required` / `unread_required` /
 * `stale_revision` / `member_not_following`）。后四种都是**宿主侧**
 * （确认挑战、已读围栏、revision 围栏、频道成员关系）才有意义的事实，
 * 索菲亚一个都没有 ⇒ 调用点那四段分支已整批剥掉（见 `TeamThreadPage.tsx`）。
 */
export async function requestTeamMessage(
  request: TeamMessageRequest,
  fetcher: typeof fetch = fetch,
): Promise<TeamRemoteResult<TeamReplyResult>> {
  let response: Response
  try {
    response = await fetcher(MESSAGE_ROUTE, {
      method: 'POST',
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
    })
  } catch (error) {
    // 网络层失败（宿主没起、连接被拒）：把原因如实带出去，不做静默重试。
    return { ok: false, error: { message: error instanceof Error ? error.message : String(error) } }
  }
  if (response.ok) {
    // ⚠ 宿主真的回了序号：`{ok, messageId, occurredAt(ISO 串), sequence}`
    // （`host.ts` 的消息路由 / `host-data.ts` 的提交返回值）。
    // 上一版这里写成 `typeof payload.messageId === 'string' ? 0 : 0` ——
    // **两个分支同为 0 的空转三元**，等于把宿主给的序号丢掉（独立评审抓到的 medium）。
    // 下游是可指认的：`TeamThreadPage` 拿 `messageSequence` 既当 `sequence`
    // 又当乐观消息的 `occurredAt`，而 `mergeFacts` 正是按 `sequence` 排序
    // ⇒ 恒 0 会让乐观消息排到 1970。现在读宿主真给的那个。
    const payload = await response.json().catch(() => ({})) as { messageId?: unknown; occurredAt?: unknown; sequence?: unknown }
    return {
      ok: true,
      value: {
        kind: 'committed',
        // 宿主给了就用宿主的；没给就 `0` / `''`。`0` 是**哨兵**（表示「没有序号」），
        // 不是一个真序号 —— 调用点拿不到时应回退成「重读一次快照」，**不猜**。
        messageSequence: typeof payload.sequence === 'number' ? payload.sequence : 0,
        occurredAt: typeof payload.occurredAt === 'string' ? payload.occurredAt : '',
      },
    }
  }
  const reason = await reasonOf(response)
  // 404 现在**不再**是最可能的一种（路由已存在），但仍必须单独说：
  // 部署的是旧版本、或路由被摘掉时它会回来；而「路由不存在」与「路由在但业务失败」
  // 混为一谈，会让用户以为是自己消息的内容有问题。
  const message = response.status === 404
    ? `索菲亚宿主还没有消息发送路由（${MESSAGE_ROUTE}）`
    : reason
  return { ok: false, error: { message } }
}

// ────────────────────────────────────────────────────────────────────────────
// 左栏（侧边栏）的三个写操作 —— 全部转向索菲亚**已有**的三条路由
// ────────────────────────────────────────────────────────────────────────────

/**
 * 形状换算：`OpResult` → `TeamRemoteResult`。
 *
 * ⚠ 这一节**不自己实现 HTTP**：路由地址（`CHANNEL_ROUTE` / `MEMBER_ROUTE` /
 * `LIFECYCLE_ROUTE`）与「读 body 的 `ok` 字段而不是只看 HTTP 状态」这条判成败的
 * 纪律都在 `../../panel-store.ts` 里，而**那里是唯一真相**。
 * 在这里重写一份 URL 字符串就是造第二个真相 —— 路由一改，一份跟着变、
 * 另一份静默失效（本仓把这类问题叫「第二个真相」，见 `view-model.ts` 文件头）。
 *
 * 本层只做一次形状换算，理由与 `index.ts` 里 `loadXxx` 一族完全相同：
 * 上游 UI 逐字在吃 `{ok,value}|{ok,error}`，而索菲亚既有的三个函数回的是
 * `{kind:'done'}|{kind:'failed',detail}`。换算放在适配层 ⇒ 上游调用点一行不改。
 *
 * ⚠ 三个函数的 `detail` 是**宿主原文**（`postOp` 从响应体的 `error` 里取）。
 * 上游 UI 把它显示在面板的错误行 —— 与 composer 的失败行同一条路径，
 * 也是本目录既有的一贯处置（不透传的只有 `panel.tsx` 的 notice 那条链）。
 */
function toRemoteResult(result: OpResult): TeamRemoteResult<void> {
  return result.kind === 'done'
    ? { ok: true, value: undefined }
    : { ok: false, error: { message: result.detail } }
}

/**
 * 建频道 → `POST /api/sophia/channel`（**真实路由**，`host.ts` 的 `channelRoute`）。
 *
 * ⚠ 索菲亚这条路由**只接受 `{teamId, title}`** ⇒ 上游请求里的
 * `description` 与 `memberIds` 在界面上是**只能看不能发**的字段
 * （见 `TeamChannelsPanel` 的说明），这里也不假装能传。
 *
 * ⚠ **两个字段都必须真的禁用 + 明说**（独立评审抓到的 high：初版只做了
 * `description`，`memberIds` 的多选是**活的**，选完静默丢弃）：
 * 一个能操作却永远发不出去的控件 = 承诺一件做不到的事。处置手法与
 * `bridge.ts` 的 `TEAM_HALT_AVAILABLE` 同源 —— **控件保留**（删了就没人知道
 * 为什么没有），但把「不可用」明说出来。
 */
export async function requestSidebarCreateChannel(request: TeamCreateChannelRequest): Promise<TeamRemoteResult<void>> {
  return toRemoteResult(await requestCreateChannel(request.workspaceId, request.title))
}

/**
 * 加成员 → `POST /api/sophia/member`（**真实路由**，`host.ts` 的 `memberRoute`）。
 *
 * ⚠ 上游的 `handle` 在这里映射到索菲亚的 `position`（**职位名**）：
 * 宿主用它跑命名门禁并派生命名（`src/naming.ts` 的 `POSITIONS`）。
 * 这不是改名，是同一个输入框在两边**指向不同的宿主字段**
 * （见 `slots.ts` 的 `TeamAddMemberRequest` 说明）。
 *
 * ⚠ 响应形状（独立评审核到的事实，上一版注释写错了）：宿主回
 * `{ok: true, memberId, name, sequence}`（`host.ts` 的 `memberRoute`）——
 * **不是**「只回 `{ok:true}`」，但它**确实不回完整的成员状态**（没有
 * `lifecycle` / `presence` / `avatarPath`）。
 * ⇒ 「**重读名册**」这个处置仍然正确（`TeamAgentsPanel.submit`），
 * 但理由不是「什么都没回」，而是「回的东西不够拼出一行」。这里不改成本地乐观插入：
 * 缺 `lifecycle` 就猜不出新成员该显示成「停用」还是「恢复」。
 */
export async function requestSidebarAddMember(request: TeamAddMemberRequest): Promise<TeamRemoteResult<void>> {
  return toRemoteResult(await requestAddMember(request.workspaceId, request.position))
}

/**
 * 改成员生命周期 → `POST /api/sophia/member/lifecycle`（**真实路由**）。
 *
 * 索菲亚只支持 `'suspend' | 'resume'` 两个动作（可逆）。上游那三个动作
 * （重启 / 归档 / 退出工作区）里**只有「恢复」有对应物**，其余两个见
 * `slots.ts` 的 `TeamMemberLifecycleRequest` 说明（归档是墓碑、不可逆，
 * 与挂起不是同一件事）。
 */
export async function requestSidebarMemberLifecycle(request: TeamMemberLifecycleRequest): Promise<TeamRemoteResult<void>> {
  return toRemoteResult(await requestLifecycle(request.memberId, request.action))
}
