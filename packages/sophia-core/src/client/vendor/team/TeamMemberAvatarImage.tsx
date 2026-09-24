import type { ReactElement } from 'react'
import { resolveAvatarUrl } from '../../../avatar-paths.ts'
import { CLASS } from '../../styles.ts'
import { hooks } from '../../react-runtime.ts'

/**
 * 索菲亚的成员头像（`.sp-avatar`）—— **`vendor/team/` 里唯一画头像的地方**。
 *
 * ## 为什么移植时**不**用上游的头像实现（改动②A 的核心）
 *
 * 上游 `TeamAvatarStack.tsx` 与 `TeamMemberAvatar.tsx` 画的是
 * 「**确定性色相圆 + handle 首字**」：它们没有真实头像素材，成员身份只能靠
 * `memberHue(memberId)` 算出的色相来区分。索菲亚**有**真头像素材
 * （`assets/members/out-512/…`，见 `avatar-paths.ts`），主人的要求是
 * 「把成员头像换成我们的」⇒ 这里换成索菲亚的体系。
 *
 * ## 与索菲亚既有实现的**同源**（不是抄一份）
 *
 * `src/client/components.tsx` 的 `MemberAvatar` 已经在做这件事，而
 * `scripts/check-t5-structure.mjs` 逐条钉住 `.sp-avatar` 的硬约束
 * （只 `border-radius: 50%` + `object-fit: cover`，**不做二次裁切**：
 * 不许 `object-position` / `padding` / `clip-path` / `transform`）。
 *
 * ⚠ 那四条判据是**逐条**判 `styles.ts` 里 `.sp-avatar` 规则体的。
 * 本文件因此**不自己写任何样式**：类名从 `styles.ts` 的 `CLASS.avatar` 取、
 * 尺寸只走 `size`（上游那套 `compact ? 32 : 44` 的尺寸约定），
 * 样式规则与判据**只有一份**，改一处两处都跟着变。
 *
 * ## 为什么这里不 import `components.tsx` 的 `MemberAvatar`
 *
 * 两者输入形状不同：`MemberAvatar` 吃的是线格式的 `WireMember`，
 * 而移植页面的头像输入是**上游形状**（`{ memberId, name, avatarPath? }`，
 * 见 `adapters.ts`）。把 `WireMember` 硬塞进来需要造 `lifecycle` /
 * `tombstone` / `position` 这些**这里没有**的字段 —— 那就是发明数据。
 * ⇒ 这里只复用**判据与类名**（`resolveAvatarUrl` / `CLASS.avatar` /
 * `initialOf` 的口径），输入保持上游形状。
 */
export function TeamMemberAvatarImage(props: {
  /** 头像的仓库相对路径（`WireMember.avatarPath`，严格白名单校验在 `resolveAvatarUrl` 内）。 */
  readonly avatarPath?: string | undefined
  /** 显示名；取不到头像时用它出首字。 */
  readonly name: string
  /** 尺寸（px）。省略 = 不设内联尺寸，用 `.sp-avatar` 的默认 32px。 */
  readonly size?: number | undefined
  /** 无障碍名（给容器 `aria-label` 用；图片本身是装饰性的，见下）。 */
  readonly label?: string | undefined
}): ReactElement {
  const { avatarPath, name, size } = props
  const { useState } = hooks()
  const url = resolveAvatarUrl(avatarPath === undefined ? {} : { avatarPath })
  /**
   * ⚠ 失败标记**按 URL 记忆**（不是永久布尔）。
   *
   * 这是索菲亚 `components.tsx` 里那条 OCR 复核 LOW 抓到的**真实缺陷**的修法：
   * 初版 `const [failed, setFailed] = useState(false)` 是永久的，于是某次 404
   * 会把该成员的头像永久钉在首字方块上，即使后来头像路径被修正也不会再试。
   * 移植时**照同一条判据**做，否则就会把那个已修的缺陷重新引进 `vendor/`。
   * 回归判据：`tests/client-sources.spec.ts` 断言 `failedUrl === url` 且
   * **不得**出现 `const [failed, setFailed] = useState(false)`。
   */
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const style = size === undefined ? undefined : { width: `${size}px`, height: `${size}px` }
  if (url === null || failedUrl === url) {
    return (
      <span
        className={CLASS.avatarFallback}
        data-sophia-avatar="fallback"
        data-sophia-name={name}
        style={style}
        // 首字方块是**展示性**的（旁边总有 DOM 文本给姓名），故对读屏隐藏，
        // 与 `MemberAvatar` 同一口径。
        aria-hidden="true"
        title={name}
      >
        {initialOf(name)}
      </span>
    )
  }
  return (
    <img
      className={CLASS.avatar}
      data-sophia-avatar="image"
      src={url}
      // 装饰性图片：姓名由旁边的 DOM 文本给出（素材硬约束 2：
      // `scripts/check-t5-structure.mjs` 要求成员名走 `data-sophia-name` 的 DOM 文本）。
      alt=""
      aria-hidden="true"
      style={style}
      onError={() => {
        setFailedUrl(url)
      }}
    />
  )
}

/**
 * 首字。
 *
 * 口径与上游 `TeamAvatarStack.initial` **逐字一致**（先剥 `@`、再剥 `member:` 前缀、
 * 取首字符大写），也与索菲亚 `view-model.ts` 的 `initialOf` 同口径 ——
 * 两处都在做「同一个人在不同界面上首字要一样」这件事。
 * 这里写的是上游那版（它多剥一个 `member:` 前缀，对索菲亚的 `member:xxxx` id 正好有用）。
 */
export function initialOf(name: string): string {
  return name.replace(/^@/, '').replace(/^member:/, '').slice(0, 1).toUpperCase()
}
