/**
 * 宿主浏览器模块的**类型桩**。
 *
 * ## 为什么必须自己写（实测，不是推测）
 *
 * 宿主那 247 个 `@deepseek-ai/*` 包里**一个 `.d.ts` 都没有**：
 * 在 `C:\Users\Administrator\.dsh\core-0.1.5-rc.1\@deepseek-ai\` 下逐包统计，
 * `dsh-client-ui-primitives` 与 `dsh-client-ui-model-selection` 的 `.d.ts` 计数
 * **都是 0** —— 尽管前者的 package.json 声明了 `"types": "lib/types/index.d.ts"`
 * 且 `files` 里有 `lib/types/**`（那个目录实际不存在，发布时被裁掉了）。
 * 这与 `docs/SPEC-sophia-core.md §1.1` 记录的现象一致（"一 import 就是 TS7016"）。
 *
 * ⇒ 结论：这些模块的**值**可以 `require`（宿主模块表答得上，它们在
 * `tsdown.config.ts` 的 `PLATFORM_MODULES` 里），但**类型**只能由本文件提供。
 *
 * ## 形状从哪来（不是猜的）
 *
 * 全部逐条反推自上游的**真实调用点**（`vendor/StagingPlanEditor.tsx`）：
 * - `<Menu open portal align="end" compact className items footer selectedId onSelect onClose anchor />`
 * - `MenuEntry`：`{ id, label }`；另有 `{ type: 'separator', id }` 与
 *   `{ type: 'label', id, text }` 两种**不带 label** 的形态
 * - `useSyncExternalStore(directory.store.subscribe, directory.store.getSnapshot)`
 *   —— 注意是 **`getSnapshot`**，不是 `get`
 * - `state.groups[].id` / `.name` / `.models[]`；`state.status`；`state.failures.length`；`state.error`
 * - `candidate.id` / `.name` / `.description` / `.reasoning?.efforts[]`（`{ id, name, description? }`）
 *   / `.reasoning?.defaultEffort`
 *
 * ## `| undefined` 为什么到处写（本仓约定，不是啰嗦）
 *
 * 本包开了 `exactOptionalPropertyTypes: true`：`?: T` 的含义是"**可以缺省**，
 * 但**不能显式传 `undefined`**"。上游代码里确实有 `className={css.planModelMenu}`
 * （类型是 `string | undefined`）这种写法 ⇒ 桩里必须写成 `?: T | undefined`，
 * 否则每个这样的调用点都会报 TS2375。这是本仓与上游的**真实差异**，不能照抄上游。
 *
 * ## 边界（如实说明）
 *
 * 只声明**用到的那部分**。全量形状无处可查（宿主包不带类型），多声明只会制造
 * "看起来权威"的假信息 —— 那比缺声明更危险。将来移植更多上游组件、用到这里
 * 没声明的成员时，**先从宿主包的 `lib/index.js` 反推真实形状再补**，
 * 不要凭命名习惯补。
 */

declare module '@deepseek-ai/dsh-client-ui-primitives' {
  import type { ReactElement, ReactNode } from 'react'

  /** 菜单项。三种实见形态：普通项 / `type:'separator'` / `type:'label'`。 */
  export interface MenuEntry {
    readonly id: string
    /** ⚠ 可选：`separator` 与 `label` 两种项**没有** `label`。 */
    readonly label?: ReactNode | undefined
    /** `'separator'` / `'label'` 是实见取值；放宽成 string，因为无法穷举宿主包的内部枚举。 */
    readonly type?: string | undefined
    /** `type: 'label'` 项用它承载文本。 */
    readonly text?: string | undefined
    readonly disabled?: boolean | undefined
    /**
     * 行首图标。
     *
     * ⚠ 调用点：`vendor/team/multi-menu-field.tsx`（左栏创建表单的成员多选
     * 把 `TeamPresenceDot` 作为 `icon` 传进来）。上游那份 `MenuEntry`
     * 本来就带这个字段（这正是上游能传的原因），故补进本声明。
     */
    readonly icon?: ReactNode | undefined
  }

  /**
   * 上游 `ui-primitives` 的菜单原子。
   *
   * 返回类型必须是 `ReactElement | null`（不能用 `ReactNode`）：JSX 元素的
   * 返回类型约束不接受 `ReactNode`，写宽了会在每个 `<Menu />` 处报 TS2786。
   */
  export function Menu(props: {
    readonly open: boolean
    readonly items: readonly MenuEntry[]
    readonly selectedId?: string | undefined
    /**
     * 多选菜单的已选项集合。
     *
     * ⚠ 调用点：`vendor/team/multi-menu-field.tsx`（`selectedIds={selected}`）与
     * `TeamWorkspaceSelector.tsx`（`selectedIds={[selected.workspaceId]}`）。
     * 两者都传**数组**而不是 `selectedId`（单数）—— 上游的成员多选本来就是多选，
     * 选择器的「只有一个选中」用长度 1 的数组表达。
     */
    readonly selectedIds?: readonly string[] | undefined
    readonly footer?: readonly MenuEntry[] | undefined
    readonly onSelect: (id: string) => void
    readonly onClose: () => void
    readonly anchor?: ReactNode | undefined
    readonly portal?: boolean | undefined
    readonly compact?: boolean | undefined
    readonly align?: 'start' | 'end' | undefined
    readonly className?: string | undefined
    /**
     * 打开时把焦点交给列表。
     *
     * ⚠ 调用点：`vendor/team/TeamWorkspaceSelector.tsx`（`autoFocus`）。
     */
    readonly autoFocus?: boolean | undefined
    /**
     * 指针离开就把弹出层收起来。
     *
     * ⚠ 调用点：`vendor/team/TeamRowMenu.tsx`（悬停出现的行尾省略号菜单）。
     */
    readonly closeOnPointerLeave?: boolean | undefined
  }): ReactElement | null

  // ──────────────────────────────────────────────────────────────────────────
  // 以下是移植 `vendor/team/`（收件箱 + Thread 两页）时**新增**的声明。
  //
  // 形状来源与上面 `Menu` 同一条纪律：**逐条反推自真实调用点**，不凭命名习惯补。
  // 全部调用点都在 `vendor/team/` 下，可逐一核对（文件:行号见每条的说明）。
  //
  // ⚠ 为什么返回类型必须写 `ReactElement | null` 而不是 `ReactNode`：
  // 与 `Menu` 同一条理由（JSX 元素返回类型约束不接受 `ReactNode`，写宽了
  // 会在每个调用点报 `TS2786`）。
  // ⚠ 为什么 `className?: string | undefined`（而不是 `className?: string`）：
  // 本包开了 `exactOptionalPropertyTypes: true`，上游传的是 `string | undefined`
  // 的表达式（如 `css.xxx` 查表结果）⇒ 不写 `| undefined` 会在每个调用点报 TS2375。
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * 按钮。
   *
   * 调用点：`vendor/team/TeamThreadPage.tsx`（11 处）、`TeamMemberRow.tsx`。
   * 用到的 props：`size`（`'sm'`）、`variant`（`'primary'` / `'outline'`）、
   * `icon`、`disabled`、`onClick`、`children`、`className`。
   */
  export function Button(props: {
    readonly size?: 'sm' | 'md' | undefined
    readonly variant?: 'primary' | 'outline' | undefined
    readonly icon?: ReactNode | undefined
    readonly disabled?: boolean | undefined
    readonly onClick?: (() => void) | undefined
    readonly className?: string | undefined
    readonly children?: ReactNode | undefined
    /**
     * 原生 button 的 `type`。
     *
     * ⚠ 调用点：`vendor/team/TeamChannelsPanel.tsx` / `TeamAgentsPanel.tsx` 的
     * **创建表单页脚**那颗「创建」键（`type="submit"` + `form="…"`
     * —— 按钮在 `<Modal footer>` 里、表单在 `<Modal>` 的正文里，
     * 靠 HTML 的 `form` 属性跨 DOM 提交，这是上游原文的写法）。
     */
    readonly type?: 'button' | 'submit' | undefined
    /**
     * 该按钮提交哪一个表单（跨 DOM 的 `form` 关联）。
     *
     * ⚠ 同上两个调用点；见 `type` 的说明。
     */
    readonly form?: string | undefined
  }): ReactElement | null

  /**
   * 可展开行（`<details>` 语义）。
   *
   * 调用点：`vendor/team/TeamThreadPage.tsx`（claims 工作区）。
   * 用到的 props：`expandOnRowClick`、`expandable`、`open`、`onToggle`、
   * `icon`、`title`、`children`。
   */
  export function DisclosureRow(props: {
    readonly open?: boolean | undefined
    readonly onToggle?: (() => void) | undefined
    readonly expandOnRowClick?: boolean | undefined
    readonly expandable?: boolean | undefined
    readonly icon?: ReactNode | undefined
    readonly title?: ReactNode | undefined
    readonly children?: ReactNode | undefined
    readonly className?: string | undefined
  }): ReactElement | null

  /**
   * 模态框。
   *
   * 调用点：`vendor/team/TeamThreadPage.tsx`（提前验收确认）、
   * `TeamMessage.tsx`（附件预览）。
   * 用到的 props：`open`、`onClose`、`title`、`closeLabel`、`footer`、`children`。
   *
   * ⚠ **并发追加**（活动面板移植）：`vendor/panel/ActivityPanel.tsx` 的「停止本团」
   * 确认框还传了 `description`（标题下的说明句）。补进同一份声明而不是另开一条
   * 重载 —— 模块里同名函数再声明一次虽然 TS 会当重载处理，但重载集里哪个先匹配
   * 取决于声明顺序，而那是**两个人各自追加**时最容易踩静默选错的地方。
   * 这三个 prop 的实际形状反推自宿主 `dsh-client-ui-primitives/lib/index.js:2315`
   * 的签名（`class`/`contentClassName`/`headless` 都在它的解构里）。
   */
  export function Modal(props: {
    readonly open: boolean
    readonly onClose?: (() => void) | undefined
    readonly title?: ReactNode | undefined
    readonly closeLabel?: string | undefined
    readonly footer?: ReactNode | undefined
    readonly children?: ReactNode | undefined
    readonly className?: string | undefined
    /** 标题下的说明句（宿主 `:2343`：空串 = 不渲染，与省略等价）。 */
    readonly description?: string | undefined
    /** 可滚动内容区的类名（宿主 `:2315` 的 `contentClassName`）。 */
    readonly contentClassName?: string | undefined
    /** 只渲染 children、不要默认的页头/关闭键/正文壳（宿主 `:2315` 的 `headless`）。 */
    readonly headless?: boolean | undefined
  }): ReactElement | null

  /**
   * 胶囊标签。
   *
   * 调用点：`vendor/team/TeamThreadPage.tsx`（标题行的状态胶囊，
   * 内含 `TeamStateDot` + `formatTaskStatus` 的文本）。
   */
  export function Pill(props: {
    readonly children?: ReactNode | undefined
    readonly className?: string | undefined
    readonly tone?: string | undefined
  }): ReactElement | null

  /**
   * 工具提示。
   *
   * 调用点：`vendor/team/TeamPresenceDot.tsx`（`label` + `delayMs`）、
   * `TeamMemberRow.tsx`。`children` 是被提示的元素。
   */
  export function Tooltip(props: {
    readonly label: ReactNode
    readonly delayMs?: number | undefined
    readonly children?: ReactNode | undefined
    readonly className?: string | undefined
    /**
     * 窄栏（rail）时不挂 tooltip。
     *
     * ⚠ 调用点：`vendor/team/TeamFooterAction.tsx`（模式切换按钮，
     * `disabled={wide}` —— 宽栏时按钮自己带文字标签，不再叠一个 tooltip）
     * 与 `TeamMembersAction.tsx`。
     */
    readonly disabled?: boolean | undefined
    /**
     * 提示气泡的方位。
     *
     * ⚠ 调用点：`vendor/team/TeamWorkspaceBrowser.tsx` 的窄栏（`!wide`）分支
     * —— 三枚 rail 图标都传 `side="right"`（图标贴着屏幕左缘，提示要向右弹
     * 才不会被裁掉）。上游原文逐字带了这一项。
     */
    readonly side?: 'top' | 'right' | 'bottom' | 'left' | undefined
  }): ReactElement | null

  /** 渲染 Markdown 文本（调用点：`TeamMessage.tsx`，props 含 `labels` / `className`）。 */
  export function MarkdownText(props: {
    readonly children?: ReactNode | undefined
    readonly text?: string | undefined
    readonly className?: string | undefined
    readonly labels?: MarkdownLabels | undefined
  }): ReactElement | null

  /**
   * Markdown 渲染的文案标签集。
   *
   * ⚠ 形状**逐条反推自真实调用点**（`vendor/team/TeamMessage.tsx` 的
   * `useMemo<MarkdownLabels>(() => ({ code: { copyLabel, copiedLabel }, footnotes }))`），
   * 不是照命名习惯补的 —— 初版写成 `{ readonly [key: string]: string }`
   * （索引签名），当场在调用点报
   * `TS2322: Type '{ copyLabel: string; copiedLabel: string; }' is not assignable to type 'string'`，
   * 因为嵌套对象不满足「值都是 string」的索引签名。
   */
  export interface MarkdownLabels {
    readonly code: {
      readonly copyLabel: string
      readonly copiedLabel: string
    }
    readonly footnotes: string
  }

  /**
   * 图标：`Menu` 同族，都是无状态 SVG 组件。
   *
   * 只声明**被移植文件真正用到**的那几个（`grep` 过 `vendor/team/` 的全部 import）。
   * 尺寸用 `size` 传（`TeamThreadPage` 给 `IconChecklistOutline14` 传 `size={14}`）。
   */
  export function IconChevronLeftOutline14(props: { readonly size?: number | undefined; readonly className?: string | undefined }): ReactElement | null
  export function IconChevronDownOutline14(props: { readonly size?: number | undefined; readonly className?: string | undefined }): ReactElement | null
  export function IconChecklistOutline14(props: { readonly size?: number | undefined; readonly className?: string | undefined }): ReactElement | null
  export function IconPaperclipOutline16(props: { readonly size?: number | undefined; readonly className?: string | undefined }): ReactElement | null
  export function IconSendOutline16(props: { readonly size?: number | undefined; readonly className?: string | undefined }): ReactElement | null

  // ── 同族图标：`vendor/panel/ActivityPanel.tsx`（活动面板）用到的四个 ──────────
  // 与上面五条同一个形状（`{ size?, className? }`），来源逐条反推自宿主包
  // `dsh-client-ui-primitives/lib/index.js` 的实现：
  //   `:196` IconPanelLeftOutline16（默认 size 16）、`:273` IconBranchOutline16、
  //   `:752` IconWarningOutline16（默认 size 14）、`:804` IconStopFill16（默认 size 16）。
  // 默认值不进类型：那由宿主组件自己兜住，抄一份数字就等于开第二个真相。
  /** 左面板图标（面板的「停靠 / 浮动」切换按钮）。 */
  export function IconPanelLeftOutline16(props: { readonly size?: number | undefined; readonly className?: string | undefined }): ReactElement | null
  /** 依赖分支图标（活动面板的「依赖 / 并行」分组标题）。 */
  export function IconBranchOutline16(props: { readonly size?: number | undefined; readonly className?: string | undefined }): ReactElement | null
  /** 停止实心方块（停止本团按钮 + 确认弹窗的危险按钮）。 */
  export function IconStopFill16(props: { readonly size?: number | undefined; readonly className?: string | undefined }): ReactElement | null
  /** 警告三角（停止失败时的行内告警）。 */
  export function IconWarningOutline16(props: { readonly size?: number | undefined; readonly className?: string | undefined }): ReactElement | null

  // ── 频道页 + 模式切换控件带来的三个新成员（来源逐条给在这里）──────────────
  /**
   * 右向箭头。
   *
   * 调用点：`vendor/team/TeamChannelPage.tsx` 的 `ThreadEntryRow`
   * （上游 `TeamChannelPage.tsx:571` 的 `<IconChevronRightOutline14 size={12} />`
   * —— 「打开这个线程」那枚行尾箭头）。
   */
  export function IconChevronRightOutline14(props: { readonly size?: number | undefined; readonly className?: string | undefined }): ReactElement | null
  /**
   * 「Agent 预设」图标。
   *
   * 调用点：`vendor/team/TeamFooterAction.tsx`（**模式切换按钮**在
   * 「对话模式」下显示的那枚图标）。上游 `TeamFooterAction.tsx:31`
   * 用 `size={wide ? 16 : 18}` —— 两个尺寸都从调用点来，不写默认值。
   */
  export function IconAgentPresetOutline16(props: { readonly size?: number | undefined; readonly className?: string | undefined }): ReactElement | null

  /**
   * 单行文本输入框。
   *
   * 调用点：`vendor/team/TeamMemberEditor.tsx` 的两处 `Input`
   * （`agentName` / `agentDescription`），用到
   * `value` / `onChange` / `disabled` / `autoFocus` / `placeholder` / `className`。
   *
   * ⚠ `onChange` 的参数形状按调用点的实参反推：`event.target.value`
   * （上游 `TeamMemberEditor.tsx:288`）⇒ 给一个 `{ target: { value: string } }`
   * 的最小结构，而不是 `React.ChangeEvent` —— 索菲亚没有那个 DOM 事件类型的
   * 依赖保证（`lib` 里的 DOM 版本随宿主），用一个结构面更稳。
   */
  export function Input(props: {
    readonly value?: string | undefined
    readonly onChange?: ((event: { readonly target: { readonly value: string } }) => void) | undefined
    readonly disabled?: boolean | undefined
    readonly autoFocus?: boolean | undefined
    readonly placeholder?: string | undefined
    readonly className?: string | undefined
  }): ReactElement | null

  /**
   * 下拉/弹出层的定位 hook（返回最大可用高度）。
   *
   * 调用点：`vendor/team/TeamComposer.tsx` ——
   * `useAnchoredMaxHeight(menuRef, 320, menuOpen ? draft : null)`。
   * 三个参数的类型按**调用点的实参形状**反推（不凭命名习惯补）：
   * ① 容器 ref；② 兜底上限；③ 依赖值（可为 `null`）。
   */
  export function useAnchoredMaxHeight(
    container: { readonly current: unknown },
    fallback: number,
    dependency: unknown,
  ): number

  /**
   * 点外部/按 Esc 关闭 hook。
   *
   * 调用点：`vendor/team/TeamComposer.tsx` ——
   * `useDismissOnOutsidePointer(rootRef, menuOpen, open => { … })`。
   * 第三个参数是「开关状态变化」的回调（收 `boolean`）。
   */
  export function useDismissOnOutsidePointer(
    container: { readonly current: unknown },
    active: boolean,
    onChange: (open: boolean) => void,
  ): void

  // ── 左栏（侧边栏）移植带来的七枚图标 ──────────────────────────────────────
  // 与上面每一枚同一个形状（`{ size?, className? }`）——**默认尺寸不进类型**：
  // 那由宿主组件自己兜住（抄一份数字就是开第二个真相，与上面那条注释同一纪律）。
  //
  // 调用点逐条给在这里，可逐一核对（`grep` 本目录即可复现）：
  /** 「新建」加号。`TeamChannelsPanel.tsx` / `TeamAgentsPanel.tsx` 的分组标题 `+` 按钮（`size={14}`）。 */
  export function IconPlusOutline16(props: { readonly size?: number | undefined; readonly className?: string | undefined }): ReactElement | null
  /** 行尾省略号。`TeamRowMenu.tsx` 的触发键（不传 size，用宿主默认）。 */
  export function IconEllipsisOutline16(props: { readonly size?: number | undefined; readonly className?: string | undefined }): ReactElement | null
  /** 打开的文件夹。`TeamWorkspaceSelector.tsx` 的触发器前导图标（`size={16}`）。 */
  export function IconFolderOpen16(props: { readonly size?: number | undefined; readonly className?: string | undefined }): ReactElement | null
  /** 队列/收件箱。`TeamWorkspaceBrowser.tsx` 的收件箱入口图标（`size={16}`）。 */
  export function IconQueueOutline14(props: { readonly size?: number | undefined; readonly className?: string | undefined }): ReactElement | null
  /** 列表与笔。窄栏（`!wide`）的「频道」图标（`size={16}`）。 */
  export function IconListPenOutline16(props: { readonly size?: number | undefined; readonly className?: string | undefined }): ReactElement | null
  /** 单人形。`TeamMembersAction.tsx` 的底部「成员」按钮（`size={wide ? 16 : 18}`）。 */
  export function IconUserOutline16(props: { readonly size?: number | undefined; readonly className?: string | undefined }): ReactElement | null
  /** 播放三角。`TeamAgentsPanel.tsx` 行菜单的「恢复」项（不传 size，用宿主默认）。 */
  export function IconPlayOutline16(props: { readonly size?: number | undefined; readonly className?: string | undefined }): ReactElement | null
}

declare module '@deepseek-ai/dsh-client-ui-model-selection/client' {
  /** 一个推理强度档位（上游用法：`effort.id` / `.name` / `.description`）。 */
  export interface ModelEffort {
    readonly id: string
    readonly name: string
    readonly description?: string | undefined
  }

  /** 一个候选模型（上游用法：`candidate.id` / `.name` / `.description` / `.reasoning?`）。 */
  export interface ModelCandidate {
    readonly id: string
    readonly name: string
    readonly description?: string | undefined
    readonly reasoning?: {
      readonly efforts: readonly ModelEffort[]
      readonly defaultEffort?: string | undefined
    } | undefined
  }

  /** 一个 provider 分组（上游用法：`group.id` / `.name` / `.models`）。 */
  export interface ModelGroup {
    readonly id: string
    readonly name: string
    readonly models: readonly ModelCandidate[]
  }

  /** 目录状态快照（直接喂给 `useSyncExternalStore`）。 */
  export interface ModelDirectoryState {
    readonly status: 'loading' | 'ready' | 'error'
    readonly groups: readonly ModelGroup[]
    readonly failures: readonly unknown[]
    readonly error?: string | undefined
  }

  /** 模型目录服务。 */
  export interface ModelDirectory {
    readonly store: {
      subscribe(listener: () => void): () => void
      /** ⚠ 名字是 `getSnapshot`（不是 `get`）。 */
      getSnapshot(): ModelDirectoryState
    }
    load(): Promise<unknown>
  }
}

/**
 * 会话标识的品牌类型（`vendor/panel/session-navigation.ts` 用）。
 *
 * 反推自上游的 pnpm 安装树（宿主 `.dsh` 那份**没有** `.d.ts`，见本文件头；
 * 上游那份 install 有）：`dsh-session/lib/types/types.d.ts:5`
 * `export type SessionId = Branded<'SessionId'>`（同文件 `:11` 还有一个同名的品牌函数
 * `SessionId(id: string): SessionId`）。
 *
 * ⚠ 只声明**类型**、不声明那个品牌函数：索菲亚有代码**引用**这个类型
 * （`session-navigation.ts` 的签名），但没有**构造**它的人（索菲亚没有会话服务
 * ⇒ 没有 id 的生产者）。声明品牌函数等于凭空给一个没人调用、也无法验证语义的 API。
 * `Branded<>` 背后的唯一符号同样无法从宿主 `.js` 反推 ⇒ 「不透明字符串」是
 * **恰好够用且不说谎**的形状。
 */
declare module '@deepseek-ai/dsh-session/types' {
  export type SessionId = string & { readonly __brand: 'SessionId' }
}

/**
 * 子代理寻址（`vendor/panel/session-navigation.ts` 用）。
 *
 * 反推自上游安装树 `dsh-subagent/lib/types/control-types.d.ts:77-85`，逐字照录
 * （含 `mode` 那个二选一的判别联合）：
 *
 * ```ts
 * export type SubagentAddress = {
 *   readonly parentSessionId: SessionId
 *   readonly childSessionId: SessionId
 * } & ({ readonly mode: 'one-shot' } | { readonly mode: 'continuable' })
 * ```
 */
declare module '@deepseek-ai/dsh-subagent/client' {
  import type { SessionId } from '@deepseek-ai/dsh-session/types'

  export type SubagentAddress = {
    readonly parentSessionId: SessionId
    readonly childSessionId: SessionId
  } & ({ readonly mode: 'one-shot' } | { readonly mode: 'continuable' })
}
