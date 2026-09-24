/**
 * CSS Modules 的类型桩 —— 逐字照抄上游 `dsh-agent-teams/src/css-modules.d.ts`。
 *
 * 为什么必须有：`tsdown.config.ts` 的 `sophia-css-modules-inline` 插件在**构建期**
 * 把 `.module.css` 编译成「CSS 文本 + 类名映射」的 JS 模块，但 **tsc 不认识**
 * `.css` 后缀 —— 没有这条声明，`import css from './X.module.css'` 会报
 * `TS2307: Cannot find module`，而真正的原因（缺桩）看起来像"文件路径写错了"。
 *
 * 形状与构建期产物一致：`{ [localName]: '<hash>_<localName>' }`，
 * 因此 TSX 里 `css.planChevron` 得到 `string`，与运行期完全对齐。
 */
declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}
