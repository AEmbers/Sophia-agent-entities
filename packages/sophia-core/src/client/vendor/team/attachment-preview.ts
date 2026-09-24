/**
 * 上游 `attachment-preview.ts` 的索菲亚版 —— **函数体逐字照抄**，只改类型来源。
 *
 * ## 索菲亚移植点（只允许两类差异）
 *
 * | 上游 | 索菲亚 |
 * |---|---|
 * | `import type { AgentTeamAttachmentId, … } from '@wowyuarm/dsh-agent-team/types'` | 该包在索菲亚**不存在**（`upstream-modules.d.ts` 里没有它的桩）⇒ 本地声明同形别名，见下 |
 *
 * ⚠ **附件能力本身在索菲亚是缺席的**（不是本文件删的）：`src/host.ts` 注册的
 * 路由清单里没有 `putAttachment` / `getAttachment`（见 `../../host.ts` 的
 * `ROUTE_PREFIX` 各注册点），`slots.ts` 也据此不声明 `getAttachment`。
 * ⇒ 本文件的 `loadAttachmentDataUrl` 在索菲亚**没有调用方会传进 `getAttachment`**；
 * `TeamMessage` 的 `loadAttachment` prop 缺席时，附件 chip 走「无数据」分支
 * （见 `TeamMessage.tsx` 的 `AttachmentChip`）。
 * 保留这一整套实现是为了**结构照抄**：宿主补上附件路由后，接线即可用，不用回上游再抄一遍。
 *
 * @module @sophia/core/client/vendor/team/attachment-preview
 */

/**
 * 附件 id（上游品牌类型）。
 *
 * 索菲亚**没有**这个概念（线格式 `WireMessage` 只有 `body`，见 `../../wire.ts`），
 * 但本文件的两个存取函数需要一个键类型 ⇒ 按上游的品牌形状声明一个**本地别名**，
 * 不是把上游包的类型搬进来。
 */
export type AgentTeamAttachmentId = string

/** 取附件请求（上游形状的一对一映射）。 */
export interface AgentTeamGetAttachmentRequest {
  readonly attachmentId: AgentTeamAttachmentId
}

/** 取附件结果（上游形状的一对一映射）。 */
export interface AgentTeamGetAttachmentResult {
  readonly bytesBase64: string
  readonly mediaType: string
}

/** Base64 one file payload in chunks so large uploads stay off the call-stack limit. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let start = 0; start < bytes.length; start += chunk) {
    binary += String.fromCharCode(...bytes.subarray(start, start + chunk))
  }
  return btoa(binary)
}

/** Mirrors the slot's Remote result union without importing the slots module. */
type GetAttachment = (request: AgentTeamGetAttachmentRequest) => Promise<{ ok: true; value: AgentTeamGetAttachmentResult } | { ok: false; error: { message: string } }>

/**
 * Thumbnail data URLs live in one session-wide cache: message lists re-render
 * often, and each miss costs a Host round-trip plus a base64 decode. Failed
 * loads (bytes already GC'd) are cached as `null` so the chip fallback is stable.
 */
const dataUrlCache = new Map<AgentTeamAttachmentId, string | null>()

export function cachedAttachmentDataUrl(attachmentId: AgentTeamAttachmentId): string | null | undefined {
  return dataUrlCache.get(attachmentId)
}

export async function loadAttachmentDataUrl(getAttachment: GetAttachment, attachment: { attachmentId: AgentTeamAttachmentId; mediaType: string }): Promise<string | null> {
  const cached = dataUrlCache.get(attachment.attachmentId)
  if (cached !== undefined) return cached
  const result = await getAttachment({ attachmentId: attachment.attachmentId })
  const url = result.ok && attachment.mediaType.startsWith('image/') ? `data:${attachment.mediaType};base64,${result.value.bytesBase64}` : null
  dataUrlCache.set(attachment.attachmentId, url)
  return url
}

/**
 * Human-readable byte size for attachment chips.
 *
 * ⚠ **本文件是这一条口径的唯一真相**：索菲亚的 `team-formatters.ts` 早先把
 * 它并了进去（当时 `attachment-preview.ts` 还没移植），现在改为从**本文件**
 * re-export（见那个文件的 `formatByteSize` 段）。两个实现会让
 * 「1.0 MB」与「1024 KB」这类显示在两张卡上分叉 —— 那正是本仓
 * 「一个概念一个真相」纪律要堵的。
 */
export function formatByteSize(byteSize: number): string {
  if (byteSize < 1024) return `${byteSize} B`
  if (byteSize < 1024 * 1024) return `${(byteSize / 1024).toFixed(0)} KB`
  return `${(byteSize / (1024 * 1024)).toFixed(1)} MB`
}
