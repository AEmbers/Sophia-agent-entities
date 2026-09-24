/**
 * 设计令牌（文档 3.6 / 5）。
 *
 * 真源是 DSW 主题变量（`--dsw-alias-*`）：令牌只做**语义命名 + 兜底值**，
 * 让面板样式里的颜色/间距有一个可 grep、可统一切换的落点 ——
 * `styles.ts` 的审批区与画布样式已按此引用（不是声明着玩的空表）。
 *
 * @module @sophia/core/client/tokens
 */
export const TOKENS = {
  /** 主题强调色（审批主按钮 / 卡片描边）。 */
  colorAccent: 'var(--dsw-alias-accent, rgba(96, 160, 255, .55))',
  /** 分层背景。 */
  colorBgLayer: 'var(--dsw-alias-bg-layer-1, rgba(128, 128, 128, .06))',
  /** 卡片圆角。 */
  radiusCard: '8px',
  /** 间距档位（md/sm）。 */
  spaceMd: '8px',
  spaceSm: '6px',
} as const
