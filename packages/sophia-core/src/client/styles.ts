/**
 * 界面样式 —— **内联在 bundle 里的一个 `<style>` 标签**（与在跑的 `dsh-postman`
 * / `dsh-api-visualizer` 同构：它们的 client 半也是把 CSS 内联进 bundle，
 * 而不是发一个额外的 `.css` 文件）。
 *
 * ## 为什么不用 CSS 文件 / CSS Modules
 *
 * 宿主只按 `/plugins/<包名>/client.js` 这一张路由表发 bundle
 * （`dsh-client-modules/lib/index.js` 的 `comboUrl()`），**没有**任何机制
 * 去取同目录的 `.css`。实测证据：本任务配 `import './x.module.css'` 时
 * 打包器要把 CSS 外提成独立资源，而那份资源浏览器取不到。
 * 内联 `<style>` 是唯一不依赖新路由的做法。
 *
 * ## 为什么所有类名都带 `sp-` 前缀
 *
 * 宿主页面里已有很多插件（本机 `profiles/desktop/plugins/` 下就有若干个）。
 * 无前缀的类名（`.card` / `.row`）会与它们**互相污染**，而症状是
 * 「某个插件的界面莫名错位」—— 极难定位。前缀是这里最便宜的一道隔离。
 *
 * ## 颜色一律走 DSH 主题变量，**不写死色值**
 *
 * 实测可用变量来自 `dsh-client-ui-theme`（本机 rc.2）：`--dsw-alias-bg-base` /
 * `-bg-layer-1..3` / `-label-primary` / `-label-caption` / `-border-l1..l4` /
 * `-state-success-primary` / `-state-warn-primary` / `-state-error-primary` /
 * `-brand-primary` / `-interactive-bg-hover` 等。
 * 写死色值会让界面在另一个主题下变成**刺眼的白块**（素材 readme 专门记过
 * 深色主题下白底 avatar 显示的坑）。
 *
 * 每个变量都带**兜底值**（`var(--x, fallback)`）：变量缺失时退化成中性色，
 * 而不是让整条声明失效（`var()` 无兜底且变量不存在时，该属性**被丢弃**）。
 */

/** 样式标签的 `id`（幂等注入的判据；重复挂载不会插两份）。 */
export const STYLE_ELEMENT_ID = 'sophia-client-styles'

// 语义令牌（tokens.ts）：审批区与画布样式从这里取色/取距 —— 真引用，不是空表。
import { TOKENS } from './tokens.ts'

/** 组件用到的类名（集中定义，免得字符串散落各处而拼错）。 */
export const CLASS = {
  root: 'sp-root',
  header: 'sp-header',
  headerTitle: 'sp-header-title',
  headerMeta: 'sp-header-meta',
  body: 'sp-body',
  sidebar: 'sp-sidebar',
  sidebarSection: 'sp-sidebar-section',
  sidebarSectionTitle: 'sp-sidebar-section-title',
  channelItem: 'sp-channel-item',
  channelItemActive: 'sp-channel-item-active',
  main: 'sp-main',
  loading: 'sp-loading',
  empty: 'sp-empty',
  emptyTitle: 'sp-empty-title',
  emptyHint: 'sp-empty-hint',
  error: 'sp-error',
  // ── 覆盖度提示（增量盲区 / 投影诊断）──────────────────────────────────
  coverageNotice: 'sp-notices',
  // ⚠ 这里**原本**还有一个 `coverageTitle: 'sp-notices-title'`，已删除
  //   （OCR 复核 MEDIUM [26]）：覆盖度提示的标题视觉现在由上游
  //   taskDetailSubject 提供，PANEL_CSS 里已没有任何该类的规则 ——
  //   留一个**没有任何规则**的键，就是留一个将来会被误读成
  //   「样式丢了、去补一条」的陷阱。语义锚点由 `data-sophia-notice-title`
  //   属性承担（那个属性必须保留，它是既有断言的抓手）。
  // ── 审批区（待处理建团申请卡 · 文档 3.6）───────────────────────────────
  approval: 'sp-approval',
  approvalTitle: 'sp-approval-title',
  approvalCard: 'sp-approval-card',
  approvalCardHead: 'sp-approval-card-head',
  approvalBadge: 'sp-approval-badge',
  approvalMeta: 'sp-approval-meta',
  approvalActions: 'sp-approval-actions',
  approvalButton: 'sp-approval-button',
  approvalButtonApprove: 'sp-approval-button-approve',
  // ── 运营入口（lifecycle 按钮 / 行内表单）────────────────────────────────
  opsRow: 'sp-ops-row',
  opsInput: 'sp-ops-input',
  opsButton: 'sp-ops-button',
  // ── DAG 画布（文档 5）───────────────────────────────────────────────────
  dagWrap: 'sp-dag-wrap',
  dagTitle: 'sp-dag-title',
  dagCanvas: 'sp-dag-canvas',
  dagHead: 'sp-dag-head',
  dagMeta: 'sp-dag-meta',
  dagNodes: 'sp-dag-nodes',
  dagNode: 'sp-dag-node',
  // ── 模式单选（文档 2.4）─────────────────────────────────────────────────
  modeRow: 'sp-mode-row',
  modeLabel: 'sp-mode-label',
  // ⚠ 独立的类名（OCR 复核 LOW）：头部阻塞数此前复用 `tombstoneBadge` ——
  //   两个不同的语义（「历史成员」 vs 「有阻塞」）共用一个类，将来重调
  //   墓碑徽章的样式会**意外**改到阻塞提示。分开后各自可独立演进。
  headerBlockers: 'sp-header-blockers',
  // 非致命提示（「已生效但审计异常」）：与错误提示**分开**的类名，
  // 因为两者对用户的要求相反（一个别重试、一个要重试）。
  notice: 'sp-notice',
  // ⚠ 刻意只有 `bumpButton` 一个键（OCR 复核 LOW）：曾经还有一个 `bump`
  //    指向同一个 `'sp-bump'`，但没有任何地方用它 —— 两个键一个值会让读者
  //    以为界面上有两类元素。真需要第二类时再拆，别预留。
  bumpButton: 'sp-bump',

  // ── 活动面板 ─────────────────────────────────────────────────────────
  //
  // ⚠ 这里删掉了两个**没有任何规则**的键（`activityHeader` / `progressMeta`）——
  //   判据与上面 `coverageTitle` 相同（OCR 复核 MEDIUM [26]）：
  //   一个只在映射表里、styles 里没有对应规则、调用点也已被上游类接管的键，
  //   是一枚**看起来像"样式丢了"的诱饵** —— 后人会去补一条重复的规则，
  //   而不是先问"这块是不是已经交给上游了"。
  //   两个键的调用点都已改为只挂上游类（活动面板的折叠头、
  //   进度空态/摘要/任务行文字），语义锚点由各自的 `data-sophia-*` 属性承担。
  activity: 'sp-activity',
  activityToggle: 'sp-activity-toggle',
  activityTitle: 'sp-activity-title',
  activityBody: 'sp-activity-body',
  progressBar: 'sp-progress-bar',
  progressSegment: 'sp-progress-segment',
  'progressSegment-pending': 'sp-progress-segment-pending',
  'progressSegment-done': 'sp-progress-segment-done',
  'progressSegment-blocked': 'sp-progress-segment-blocked',
  memberCards: 'sp-member-cards',
  memberCard: 'sp-member-card',
  memberCardTombstone: 'sp-member-card-tombstone',
  blockerList: 'sp-blockers',
  blockerItem: 'sp-blocker-item',

  // ── 成员卡 ───────────────────────────────────────────────────────────
  avatar: 'sp-avatar',
  avatarFallback: 'sp-avatar-fallback',
  // ⚠ 成员名必须由 DOM 文本渲染：头像底部烧入的职位名在 24px 下**完全不可读**
  //    （素材硬约束），小尺寸场景唯一可读的来源就是这里。
  memberName: 'sp-member-name',
  memberPosition: 'sp-member-position',
  dot: 'sp-dot',
  dotIdle: 'sp-dot-idle',
  dotRunning: 'sp-dot-running',
  dotSuspended: 'sp-dot-suspended',
  dotTombstone: 'sp-dot-tombstone',
  dotUnknown: 'sp-dot-unknown',
  tombstoneBadge: 'sp-tombstone-badge',
  switchButton: 'sp-switch',

  // ── 消息流 ───────────────────────────────────────────────────────────
  messages: 'sp-messages',
  message: 'sp-message',
  messageHead: 'sp-message-head',
  messageSender: 'sp-message-sender',
  messageTime: 'sp-message-time',
  messageBody: 'sp-message-body',
  threadList: 'sp-threads',
  threadTitle: 'sp-thread-title',
  threadAssignee: 'sp-thread-assignee',

  // ── 覆盖层与侧边栏入口 ───────────────────────────────────────────────
  entryGlyph: 'sp-entry-glyph',
} as const

/**
 * 面板根节点上的属性名。
 *
 * 用 `data-` 属性而不是 `id`：`id` 在一个页面里必须唯一，而本插件可能被
 * 挂到多个面板（keyed slot 的每个 key 各一份），重复 id 是无效 HTML。
 */
export const PANEL_ATTR = 'data-sophia-panel'

/**
 * 面板的 CSS 文本。
 *
 * 尺寸相关的两条硬约束（来自素材实测，写在对应规则旁边）：
 * 1. **不做头像二次裁切** —— 只 `border-radius: 50%`，不加内边距/`object-position`
 *    微调（素材底部标签余量仅 15px，任何裁切都会切到字）；
 * 2. 成员名走 DOM 文本，故 `.sp-member-name` 用**可读字号**（≥12px）。
 *
 * ## 模板字符串内部有**两颗地雷**（各有一条真实用例守着，都踩过）
 *
 * 下面这一大段是一个模板字符串。写在它**内部**的注释同样会被两处检查当成 CSS：
 *
 * 1. **不能出现反引号** —— 会当场终止字符串（`tsc` 报 TS1005，
 *    而症状看起来跟 CSS 毫无关系）。门禁：`scripts/check-t5-structure.mjs`
 *    （那条 `PANEL_CSS 模板字符串内反引号` 的检查）。
 * 2. **不能出现「点 + 字母」形式的 token** —— 哪怕只是注释里提到某个文件名。
 *    `tests/client/panel.spec.tsx` 的「CSS 用 sp- 前缀隔离」用例是在**整段
 *    样式文本**上抓「点 + 字母」开头的 token 并要求它们都以 `sp-` 开头；
 *    注释里写组件文件名（带后缀的那种）就会被当成一个选择器、判成
 *    「缺少 sp- 前缀」。**实测代价**：本次改造中招过一次 ——
 *    注释里提了用例文件名，`vitest run` 立刻红（`expected false to be true`）。
 *    ⇒ 写注释时提到类名/文件名**一律不带点前缀**。
 */
export const PANEL_CSS = `
.${CLASS.root} {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--dsw-alias-bg-base, transparent);
  color: var(--dsw-alias-label-primary, inherit);
  font-size: var(--dsh-content-font-size, 13px);
  container-type: inline-size;
}
/* ── 面板头 / 团队卡头部：皮肤已交给上游 ──────────────────────────────
   components 组件文件 与 panel 组件文件 现在挂的是上游的 panelHead /
   teamHead / teamName / teamStats / panelTitle
   （构建期内联的类名映射）。这里**只剩两条显式覆盖**，理由：
   上游 panelHead 是给**可拖拽浮层**写的（cursor:grab + touch-action:none），
   而索菲亚的面板挂在宿主固定的 slot 里、根本拖不动 —— 留着那个抓手光标
   等于用一个做不到的操作暗示用户（本仓对「属性谎报能力」一贯零容忍）。
   ⚠ 本注释位于 PANEL_CSS **模板字符串内部** ⇒ 不能出现反引号，
      那会当场终止字符串（tsc 报 TS1005）；门禁
      node check-t5-structure 门禁脚本 也专门查这一条。 */
.${CLASS.header} {
  cursor: default;
  touch-action: auto;
}
.${CLASS.body} {
  display: flex;
  flex: 1 1 auto;
  min-height: 0;
}
.${CLASS.sidebar} {
  flex: 0 0 210px;
  min-width: 0;
  overflow: auto;
  border-right: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.25));
  padding: 8px;
}
.${CLASS.main} {
  flex: 1 1 auto;
  min-width: 0;
  overflow: auto;
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
/* 分区卡片化（对齐上游 sidebar 的层次语言：bg-layer + border + radius）。
   ⚠ 本注释位于模板字符串内部：不能出现反引号、不能出现点开头的类名。 */
.${CLASS.sidebarSection} {
  margin-bottom: 8px;
  border: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.2));
  border-radius: 8px;
  padding: 6px;
  background: var(--dsw-alias-bg-layer-1, transparent);
}
.${CLASS.sidebarSectionTitle} {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: .03em;
  text-transform: none;
  color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-caption, inherit));
  padding: 4px 6px 2px;
}
/* 骨架空态行：虚线框 —— 「这里将来会有一条条目」的视觉暗示，
   比一行裸字更像界面骨架、而不是报错文案。 */
.${CLASS.sidebar} .${CLASS.emptyHint} {
  padding: 6px 8px;
  border: 1px dashed var(--dsw-alias-border-l2, rgba(128,128,128,.3));
  border-radius: 6px;
  color: var(--dsw-alias-label-tertiary, inherit);
  font-size: 12px;
  opacity: 1;
}
.${CLASS.channelItem} {
  display: block;
  width: 100%;
  text-align: left;
  padding: 6px 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.${CLASS.channelItem}:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.12)); }
/* ⚠ 选中态必须**同时**盖住 :hover（OCR 复核 LOW）：两条规则 specificity 相同、
   而下面这条在源码里靠后 ⇒ 正常情况选中态胜出；但鼠标悬停在**已选中**项上时
   :hover 规则会把它压掉、高亮消失（看起来像「选中的项丢了」）。
   把选中态与 :hover 一起声明，语义上「选中优先于悬停」。
   ⚠ 注意：本文件整体是一个**模板字符串**，注释里**不能出现反引号** ——
   那会当场终止字符串（本文件第一次加这条注释时就是这么炸的，见 tsc TS1005）。 */
.${CLASS.channelItemActive},
.${CLASS.channelItemActive}:hover {
  background: var(--dsw-alias-interactive-bg-active, rgba(128,128,128,.2));
}
/* ⚠ 键盘可达性（OCR 复核 LOW）：本面板里 hover 背景是**唯一**的交互提示，
   于是纯键盘用户看不出焦点在哪。给所有可交互元素一个统一焦点环。
   用 :focus-visible 而非 :focus —— 鼠标点击不该留下焦点环。 */
.${CLASS.channelItem}:focus-visible,
.${CLASS.switchButton}:focus-visible,
.${CLASS.bumpButton}:focus-visible,
.${CLASS.activityToggle}:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary, currentColor);
  outline-offset: 1px;
}

.${CLASS.empty}, .${CLASS.loading} {
  color: var(--dsw-alias-label-caption, inherit);
  padding: 16px 8px;
}
/* ⚠ 加载态与空态共用同一个盒子（OCR 复核 LOW）：不给 loading 一个最小高度，
   它在有内容时只有几像素、随后内容到达会**跳一下**。让它占住一块稳定区域。 */
.${CLASS.loading} {
  min-height: 120px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.${CLASS.emptyTitle} { font-weight: 600; margin-bottom: 4px; }
.${CLASS.emptyHint} { font-size: .9em; opacity: .85; }
/* 空态主卡：居中卡片（标题/说明/引导三层），是空面板的视觉焦点。
   在 flex 列容器里用 margin:auto 居中；卡片层次对齐上游
   （bg-layer + border + radius 12 的卡片语言）。 */
.${CLASS.main} > .${CLASS.empty} {
  margin: auto;
  width: 100%;
  max-width: 440px;
  text-align: center;
  padding: 36px 28px;
  border: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.22));
  border-radius: 12px;
  background: var(--dsw-alias-bg-layer-1, transparent);
  color: var(--dsw-alias-label-primary, inherit);
}
.${CLASS.main} > .${CLASS.empty} .${CLASS.emptyTitle} {
  font-size: 16px;
  color: var(--dsw-alias-label-primary, inherit);
  margin-bottom: 8px;
}
.${CLASS.main} > .${CLASS.empty} .${CLASS.emptyHint} {
  font-size: 13px;
  line-height: 1.6;
  color: var(--dsw-alias-label-secondary, inherit);
  opacity: 1;
}
/* 建团引导：品牌色左边条 —— 空态里唯一的行动出口，与说明文字拉开层次
   （说明灰、引导有颜色与底色）。用属性选择器锚 panel 里的 create-hint 节点。 */
[data-sophia-create-hint] {
  margin-top: 14px;
  padding: 10px 14px;
  border-radius: 8px;
  text-align: left;
  border-left: 3px solid var(--dsw-alias-brand-primary, currentColor);
  background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.1));
  color: var(--dsw-alias-label-primary, inherit);
  line-height: 1.6;
}
.${CLASS.error} {
  border: 1px solid var(--dsw-alias-state-error-primary, #c33);
  border-radius: 8px;
  padding: 10px 12px;
  margin: 8px 0;
}

/* 覆盖度提示：语义是「如实告知」而非故障，皮肤与错误卡同语言 ——
   挂上游 taskDetail（浅色小卡）+ taskDetailSubject / taskDetailLine。
   ⚠ flex: 0 0 auto 保留：上游那两个类都没有 flex 声明，而这个提示
      在父 flex 列里不该被拉伸（它是一条说明，不是弹性内容）。 */
.${CLASS.coverageNotice} {
  flex: 0 0 auto;
}

/* ── 审批区（两级审批的人类出口 · 文档 3.6）──────────────────────────────── */
.${CLASS.approval} {
  flex: 0 0 auto;
  margin: 6px 0;
}
.${CLASS.approvalTitle} {
  font-weight: 600;
  font-size: .92em;
  margin-bottom: 4px;
}
.${CLASS.approvalCard} {
  border: 1px solid ${TOKENS.colorAccent};
  border-radius: ${TOKENS.radiusCard};
  background: ${TOKENS.colorBgLayer};
  padding: ${TOKENS.spaceMd} 10px;
  margin-bottom: ${TOKENS.spaceSm};
}
.${CLASS.approvalCardHead} {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
}
.${CLASS.approvalBadge} {
  font-size: .78em;
  padding: 1px 6px;
  border-radius: 999px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, .4));
  opacity: .85;
}
.${CLASS.approvalMeta} {
  font-size: .86em;
  opacity: .85;
  margin: 4px 0 2px;
}
.${CLASS.approvalActions} {
  display: flex;
  gap: 8px;
  margin-top: 6px;
}
.${CLASS.approvalButton} {
  border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, .45));
  background: transparent;
  color: inherit;
  border-radius: 6px;
  padding: 4px 14px;
  cursor: pointer;
  font: inherit;
}
.${CLASS.approvalButton}:disabled {
  opacity: .55;
  cursor: wait;
}
.${CLASS.approvalButtonApprove} {
  background: var(--dsw-alias-accent, rgba(96, 160, 255, .25));
  border-color: var(--dsw-alias-accent, rgba(96, 160, 255, .6));
}

/* ── 运营入口（行内表单 + lifecycle 按钮 · 文档 4）───────────────────────── */
.${CLASS.opsRow} {
  display: flex;
  gap: 6px;
  margin: 4px 0;
}
.${CLASS.opsInput} {
  flex: 1 1 auto;
  min-width: 0;
  border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, .45));
  background: var(--dsw-alias-bg-layer-1, rgba(128, 128, 128, .08));
  color: inherit;
  border-radius: 6px;
  padding: 3px 8px;
  font: inherit;
}
.${CLASS.opsButton} {
  border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, .45));
  background: transparent;
  color: inherit;
  border-radius: 6px;
  padding: 3px 10px;
  cursor: pointer;
  font: inherit;
  white-space: nowrap;
}
.${CLASS.opsButton}:disabled {
  opacity: .55;
  cursor: wait;
}

/* ── DAG 画布（文档 5 · 阶段 3 v1：任务节点 + 当前态，不画假边）───────────── */
.${CLASS.dagWrap} {
  flex: 0 0 auto;
  margin: 6px 0;
}
.${CLASS.dagTitle} {
  font-weight: 600;
  font-size: .92em;
  margin-bottom: 4px;
}
.${CLASS.dagCanvas} {
  border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, .35));
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1, rgba(128, 128, 128, .05));
  padding: 8px 10px;
  margin-bottom: 6px;
}
.${CLASS.dagHead} {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-weight: 600;
  font-size: .9em;
}
.${CLASS.dagMeta} {
  font-size: .8em;
  opacity: .75;
  margin-top: 4px;
}
.${CLASS.dagNodes} {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 6px;
}
.${CLASS.dagNode} {
  border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, .45));
  border-radius: 6px;
  padding: 2px 8px;
  font-size: .84em;
  background: var(--dsw-alias-bg-layer-1, rgba(128, 128, 128, .08));
}

/* ── 模式单选（文档 2.4：persistent 可见、dag 诚实禁用）──────────────────── */
.${CLASS.modeRow} {
  display: flex;
  gap: 10px;
  font-size: .84em;
  margin: 4px 0 2px;
}
.${CLASS.modeLabel} {
  opacity: .85;
  margin-right: 2px;
}
.${CLASS.bumpButton} {
  border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.4));
  background: transparent;
  color: inherit;
  border-radius: 6px;
  padding: 4px 10px;
  cursor: pointer;
  font: inherit;
}

/* ── 活动面板（可折叠 · FR-4.4）：皮肤走上游 ──────────────────────────
   外层 = 上游 planSection（带边框/圆角的浅色分区）；
   折叠头 = membersToggle（整宽浅底圆角标题栏）+ progressTitle
            + unreadPill（阻塞计数徽章）+ chevron（箭头）；
   正文 = progressOverview（竖排 7px 间距）。
   ⇒ 以下每块只保留**上游表达不了**的那几条。
   ⚠ flex: 0 0 auto 必须保留：上游 planSection 没有 flex 声明，
      不写它这个折叠区会被父 flex 列拉伸。 */
.${CLASS.activity} {
  flex: 0 0 auto;
}
/* 正文：内边距保留（上游 progressOverview 只管竖排间距，没有内边距；
   而这里没有 planSection 之外的父容器来提供它）。
   ⚠ 折叠头**没有**对应的本地规则 —— 它整个是上游 membersToggle 的皮肤，
      且组件里已不再套外层容器（见 components 组件文件的说明）。 */
.${CLASS.activityBody} {
  padding: 8px 10px;
}
/* ⚠ 分段条的**高度/圆角/底色**上游没有等价类（上游 progressEmpty 是"空条"，
   不是分段条）⇒ 保留这几条骨架声明。但**不声明 gap**：间距交给上游
   progressSegments（gap 3px），本地再写一条会把它压掉 —— 同 specificity
   时**后注入的本地样式表胜出**（顺序是：先上游 CSS Modules、后 PANEL_CSS）。 */
.${CLASS.progressBar} {
  display: flex;
  height: 8px;
  border-radius: 4px;
  overflow: hidden;
  background: var(--dsw-alias-bg-layer-2, rgba(128,128,128,.15));
}
.${CLASS.progressSegment} { flex: 1 1 0; min-width: 2px; }
/* 三档色调集中在主题变量里（不在组件里内联色值 —— 见文件头纪律）。 */
.${CLASS['progressSegment-pending']} { background: var(--dsw-alias-state-business-primary, rgba(128,128,128,.45)); }
.${CLASS['progressSegment-done']} { background: var(--dsw-alias-state-success-primary, #2a2); }
.${CLASS['progressSegment-blocked']} { background: var(--dsw-alias-state-error-primary, #c33); }
/* ── 进度摘要 / 成员区 / 任务行：皮肤也走上游 ──────────────────────────
   原先这五处各有一套手写样式（摘要灰字、成员横排胶囊、阻塞行警示色…），
   与上游不是同一套层次。现在它们分别挂：
     进度空态 → taskEmpty        进度摘要 → progressSummary
     成员容器 → members          成员行   → memberRow
     阻塞列表 → planList         任务行   → taskDetail
   故这里不再保留对应规则体（CLASS 上的键保留：它们是既有语义锚点，
   且被 tests 下的 client 用例文件 直接引用）。
   ⚠ 唯一保留的是墓碑成员的**透明度** —— 上游没有等价声明
      （它用 historicPill 表示"历史条目"，但没有整行变淡这一层）。 */
.${CLASS.memberCardTombstone} { opacity: .55; }

/* ── 头像（素材硬约束：不做二次裁切，只做圆形）──────────────────────── */
.${CLASS.avatar} {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  /* 素材已调好构图与底部标签余量（仅 15px）⇒ 只允许 cover，
     不允许放大/位移，任何\"把字挪出来\"的尝试都会切到标签。 */
  object-fit: cover;
  flex: 0 0 auto;
  background: var(--dsw-alias-bg-layer-2, rgba(128,128,128,.15));
}
.${CLASS.avatarFallback} {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--dsw-alias-bg-layer-2, rgba(128,128,128,.15));
  color: var(--dsw-alias-label-primary, inherit);
  font-weight: 600;
  flex: 0 0 auto;
  user-select: none;
}

/* ── 成员行：皮肤走上游 memberName / memberRole / memberModel 三个类 ──────
   ⚠ 硬约束仍在（改任何一处前先读）：头像上烧入的职位名在 24px 下**完全不可读**
   ⇒ 成员名必须由 DOM 文本渲染（data-sophia-name），且字号不得低于 12px。
   守门在 check-t5-structure 门禁脚本（成员名走 DOM 文本）+ components 组件文件，
   故这里不再手写姓名的完整规则体（手写一份等于给同一件事开第二个真相）。
   ⚠ 但 **font-size 必须由本地显式声明**，这不是重复而是刻意的守门
   （理由见下）；上游同名字号是 12.5px，本地取 13px —— 两者在 18px 行高下
   没有可见差别，而 12.5px 这个小数**表达不出来**：文件末尾那条
   「成员名字号不小于 12px」的用例只认整数 px（它的正则在点成员名片段后
   找「font-size: 数字 px」），写 12.5px 会让它读不到值、判成 missing。
   把这条约束钉在**本地**表里的真实价值：上游那份 CSS 是外部素材，
   它哪天把名字调到 11px，本面板的姓名就会重新变得不可读，而这里会拦住。 */
.${CLASS.memberName} {
  font-size: 13px;
}
.${CLASS.dot} {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: 0 0 auto;
  background: var(--dsw-alias-label-dimmed, rgba(128,128,128,.6));
}
.${CLASS.dotRunning} { background: var(--dsw-alias-state-success-primary, #2a2); }
.${CLASS.dotIdle} { background: var(--dsw-alias-label-dimmed, rgba(128,128,128,.6)); }
.${CLASS.dotSuspended} { background: var(--dsw-alias-state-warn-primary, #c90); }
.${CLASS.dotTombstone} { background: var(--dsw-alias-state-error-secondary, rgba(128,128,128,.4)); }
.${CLASS.dotUnknown} {
  background: transparent;
  border: 1px dashed var(--dsw-alias-label-dimmed, rgba(128,128,128,.6));
  box-sizing: border-box;
}
/* 墓碑徽章 = 上游 historicPill（"历史/归档条目"的小药丸），见 components 组件文件。
   本地类名（CLASS 映射里的 tombstoneBadge 那个键）仍留在 DOM 上：
   它是既有语义锚点，且被用例直接引用。 */
/* 非致命提示：警示色（不是错误色 —— 它不代表失败），且**不带**重试按钮。
   文案里已写明「已生效 / 勿重试」（见 locales 的 appliedWithAnomalyHint）。 */
.${CLASS.notice} {
  font-size: 11px;
  padding: 6px 8px;
  border-radius: 4px;
  border: 1px solid var(--dsw-alias-state-warn-primary, rgba(200,150,0,.5));
  background: var(--dsw-alias-bg-layer-2, rgba(128,128,128,.08));
  color: var(--dsw-alias-state-warn-label, inherit);
}
/* 头部阻塞数：**独立类名**的语义保留（它与墓碑徽章是两件事，将来各自演进），
   皮肤则换成上游 unreadPill + badgeCount（强调色小字 + 等宽数字）。
   故这里不再手写规则体。 */
.${CLASS.switchButton} {
  border: 1px solid transparent;
  background: transparent;
  color: var(--dsw-alias-label-caption, inherit);
  font: inherit;
  font-size: 11px;
  border-radius: 6px;
  padding: 2px 6px;
  cursor: pointer;
}
.${CLASS.switchButton}:hover {
  border-color: var(--dsw-alias-border-l2, rgba(128,128,128,.4));
  color: var(--dsw-alias-label-primary, inherit);
}

/* ── 消息流 ─────────────────────────────────────────────────────────── */
.${CLASS.messages} {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
}
.${CLASS.message} {
  border-left: 2px solid var(--dsw-alias-border-l2, rgba(128,128,128,.3));
  padding-left: 8px;
}
.${CLASS.messageHead} { display: flex; gap: 8px; align-items: baseline; }
.${CLASS.messageSender} { font-weight: 600; font-size: 12px; }
.${CLASS.messageTime} { font-size: 11px; color: var(--dsw-alias-label-caption, inherit); opacity: .8; }
.${CLASS.messageBody} { white-space: pre-wrap; word-break: break-word; }
.${CLASS.threadList} { display: flex; flex-direction: column; gap: 4px; }
.${CLASS.threadTitle} { flex: 1 1 auto; min-width: 0; }
.${CLASS.threadAssignee} { font-size: 11px; color: var(--dsw-alias-label-caption, inherit); }

/* ── 移植来的上游计划编辑器：**只读预览态** ────────────────────────────
   索菲亚的待批申请是**不可编辑**的（要改就得重新申请 —— 与上游「改草稿再批准」
   的模型不同），所以那份编辑器里的写控件在索菲亚**没有对应后端**：点下去只会
   得到 400。这里把它们明确禁掉，让**界面行为与注释里的契约一致** ——
   而不是留着一排点了必然报错的按钮（OCR 复核 HIGH 指出的正是这个矛盾）。
   用属性选择器而不是类名：上游的类名经 CSS Modules 哈希，构建期才生成。

   ⚠ 真正的只读机制是 panel 组件文件里那个 **fieldset 的 disabled**，不是这里的
   pointer-events（OCR 复核 HIGH [11]）：pointer-events 只挡指针，
   键盘 Tab + 回车仍能激活按钮 ⇒ 那些写动作照样发出去、拿 400、
   在卡片上弹出一条虚假失败。这里保留的 opacity 只是**视觉**上告诉人「不可点」，
   pointer-events 是给"disabled 之外仍想抢先把指针事件吃掉"的冗余一层。
   ⇒ fieldset 有浏览器默认外观（margin / padding / 凹槽边框 / min-width），
   必须归零，否则预览块会多出一圈边框与缩进。 */
[data-sophia-plan-preview] button,
[data-sophia-plan-preview] input,
[data-sophia-plan-preview] select {
  pointer-events: none;
  opacity: .55;
}
fieldset[data-sophia-plan-preview] {
  border: 0;
  margin: 0;
  padding: 0;
  min-width: 0;
}
[data-sophia-plan-preview]::after {
  content: '只读预览 · 决策请用下方的审批卡';
  display: block;
  margin-top: 6px;
  font-size: 11px;
  color: var(--dsw-alias-label-caption, inherit);
  opacity: .8;
}
`

/**
 * 每个文档一份样式节点的**引用计数**。
 *
 * ## 为什么需要它（OCR 复核 HIGH 抓到的真实缺陷）
 *
 * 初版在「节点已存在」时返回一个**空操作** disposer，并注释说
 * 「它的 disposer 属于上一次挂载」。这在**两次挂载重叠**时会坏掉：
 *
 * 1. 挂载 M1 插入 `<style>`；2. 热重载 / 第二次 `apply` 得到 M2，
 * M2 看见节点已在、返回空操作；3. **M1 的 disposer 随后被调用**
 * （它持有真正的 `style` 引用）⇒ 把那个**共享**节点删掉了；
 * 4. 于是**活着的** M2 完全没有样式，且没有任何自愈路径 ——
 * 界面不是报错，而是**静默地无样式**（最难查的一类）。
 *
 * 引用计数让「谁在用它」成为显式事实：只有**最后一个**使用者释放时才移除；
 * 期间若有新使用者加入，它会把计数加上去、并**刷新内容**（顺带修掉
 * 「CSS 改了但旧节点被保留 ⇒ 新样式永远不生效」那个静默降级）。
 *
 * 用 `WeakMap` 按文档隔离（不跨文档串），且**不持有文档的强引用**。
 */
const styleRegistry = new WeakMap<Document, { element: { textContent: string; remove: () => void }; refs: number }>()

/**
 * 把样式**幂等**注入文档（重复调用只插一份，且支持多使用者共享）。
 *
 * @returns 撤销函数：**递减**本使用者的引用；只有当它是最后一个使用者时
 *   才真的移除那个 `<style>`（且只移除**本插件插的那个**，不动别人的同 id 节点）。
 *   disposer 本身**幂等**：重复调用不会把计数减成负数。
 */
export function injectStyles(doc: Document): () => void {
  /**
   * 释放一份引用。
   *
   * ⚠ **两条路径共用同一个释放逻辑**（OCR 复核 MEDIUM）：
   *   初版「已存在」分支的 disposer 直接闭包改 `entry.refs`，而「新建」分支
   *   会重新查表核对身份。两者**判据不一致** ⇒ 若那个 entry 已因计数归零
   *   被删、同一文档又建了新 entry，旧的 disposer 会去减**那个孤儿对象**的
   *   计数（永远减不到 0），而新的 entry 自己的计数照旧 —— 守卫成了
   *   「碰巧靠对象身份成立」。现在两条路径都**按文档重新查表**，
   *   拿不到当前 entry 就直接返回（说明这个 disposer 已被取代）。
   */
  const release = (owned: { textContent: string; remove: () => void }): void => {
    const current = styleRegistry.get(doc)
    // 只在「确实是当前登记的那一个」时才动它（避免误删被换过的节点）。
    if (current === undefined || current.element !== owned) return
    current.refs -= 1
    if (current.refs <= 0) {
      styleRegistry.delete(doc)
      owned.remove()
    }
  }

  const entry = styleRegistry.get(doc)
  if (entry !== undefined) {
    // 已有节点：加入使用（计数 +1），并**刷新内容** —— 若 CSS 在两次挂载
    // 之间变了，旧文本会让新样式永远不生效（静默降级）。
    entry.refs += 1
    entry.element.textContent = PANEL_CSS
    let released = false
    return () => {
      // 幂等：重复调用 disposer 不能把计数减成负数（那会让后来者提前删节点）。
      if (released) return
      released = true
      release(entry.element)
    }
  }

  const style = doc.createElement('style')
  style.id = STYLE_ELEMENT_ID
  style.textContent = PANEL_CSS
  doc.head.appendChild(style)
  styleRegistry.set(doc, { element: style, refs: 1 })

  let released = false
  return () => {
    if (released) return
    released = true
    release(style)
  }
}
