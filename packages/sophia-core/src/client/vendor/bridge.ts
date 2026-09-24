/**
 * 上游 UI ⇄ 索菲亚的**桥接层**。
 *
 * 移植进来的上游组件（`vendor/`）需要三样索菲亚没有的东西。把这三样集中在这里，
 * 是为了让上游 UI 文件**几乎保持原样**（只改一行地址引用）—— 跟上游版本时省力，
 * 出问题时也只在这一个文件里排查。
 *
 * | 上游需要 | 索菲亚的替代 |
 * |---|---|
 * | `t`（`AgentTeamsTranslate`） | 用 vendored `locales.ts` 的中文字典实现插值 |
 * | `modelDirectory`（宿主模型目录服务） | 空目录桩：索菲亚一期没有接宿主模型目录 |
 * | `PLAN_URL`（计划的写入口） | 索菲亚自己的路由（见下方⚠） |
 *
 * @module sophia-core/client/vendor/bridge
 */

import type { ModelDirectory, ModelDirectoryState } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type * as Primitives from '@deepseek-ai/dsh-client-ui-primitives'

import { zh, type AgentTeamsTranslate } from './locales.ts'

/**
 * 宿主 `require` —— 在 bundle 里就是 CJS 闭包工厂的**形参**。
 *
 * `declare` 只给 tsc 一个类型、不产生运行时代码；它出现在**函数体内**时，
 * 打包器不会把它提升到顶层（这正是索菲亚 `react-runtime.ts` 的核心手法）。
 */
declare const require: (id: string) => unknown

/**
 * 宿主 `ui-primitives` 的**惰性代理**。
 *
 * 为什么不能直接 `import { Menu } from '@deepseek-ai/dsh-client-ui-primitives'`：
 * 那是**顶层值导入**，产物里会出现一条**顶层**的模块加载调用，同时踩红两条既有断言（实测）：
 * - `tests/shell.spec.ts`：「materialize 那一刻不得 require 任何东西」
 * - `tests/client-sources.spec.ts:254`：产物里模块加载调用的出现次数 ≤ 2
 *
 * ⚠ 后一条断言是**文本级**的（直接在 bundle 字符串上数）：**注释里写出那个字面量
 * 也会被计入** —— 本文件初版就因此多出 3 次匹配（真代码 2 处 + 注释 3 处 = 5）。
 * 所以这段注释刻意不写出该字面量。后人改这个文件时，请不要把裸的
 * 「require + 左括号」写进注释或字符串。
 *
 * 代理只在**首次属性访问**时才加载宿主模块 —— 与 `react-runtime.ts` 完全同一手法。
 * 类型走 `typeof Primitives`（借 `.d.ts` 的结构），所以 `primitives.Menu` 在
 * JSX 里仍是类型正确的组件，而不是 `unknown`。
 */
export const primitives: typeof Primitives = new Proxy({} as typeof Primitives, {
  get: (_target, key: string) =>
    (require('@deepseek-ai/dsh-client-ui-primitives') as Record<string, unknown>)[key],
})

/**
 * 计划写入路由。
 *
 * ⚠ **本文档是这一处地址的唯一真相**。上游原值是
 * `/plugins/dsh-agent-teams/plan`（它自己的 host 路由）。
 *
 * 索菲亚已有的决策路由是 `POST /api/sophia/spawn/decision`，它接受
 * `{ requestId, decision: 'approve' | 'reject' }` —— 也就是说它只覆盖
 * 「批准 / 驳回」两个动作，**不覆盖**「改名单 / 加任务 / 换模型」。
 * 后三个动作需要宿主半新增一个 `/api/sophia/plan` 路由（未实现）；
 * 在那之前，编辑器里那三类按钮会拿到非 2xx 并把原因显示在卡片的反馈行上
 * （`StagingPlanEditor` 的 `mutatePlan` 会抛，界面**如实报错**而不是静默失败）。
 */
export const PLAN_URL = '/api/sophia/spawn/decision'

/**
 * 「停止本团」写入路由（活动面板 `vendor/panel/ActivityPanel.tsx` 的确认弹窗用它 POST）。
 *
 * ⚠ 上游原值是 `/plugins/dsh-agent-teams/halt`（它自己宿主的路由，索菲亚**没有**）。
 *
 * ⚠ **实现状态：宿主半尚未实现这条索菲亚路由。** 这不是"假装有"：
 * `src/host.ts` 目前注册的是
 * `/api/sophia/view`（:605）、`/api/sophia/avatar`（:647）、
 * `/api/sophia/member/model`（:705）、`/api/sophia/spawn/decision`（:763）、
 * `/api/sophia/channel`（:854）、`/api/sophia/member`（:893）、
 * `/api/sophia/member/lifecycle`（:940）、`/api/sophia/dag/ownership`（:986）
 * —— **没有**团队级中止路由，也没有任何一条现成路由承载这个语义
 * （`member/lifecycle` 是**成员级**挂起/恢复，拿它当团队中止会做错事：它只动一个成员）。
 *
 * 所以这个地址是**待实现**的索菲亚路由，而不是某个已存在路由的别名。表现：
 * 现在点「停止本团」→ 404 ⇒ `TeamSection.stopTeam` 把可读原因显示在确认弹窗里
 * （上游自带的错误分支），**不静默失败**。命名与 `/api/sophia/dag/ownership`
 * 同一风格（动词在最后一段）。
 */
export const HALT_URL = '/api/sophia/team/destroy'

/**
 * 「停止本团」这个动作在当前构建里**能不能用**。`false` = 不能用。
 *
 * ## 为什么需要这个开关（而不是让按钮去打一个 404）
 *
 * 直接 POST 一条不存在的路由，用户看到的是「服务器未能停止团队，请重试」——
 * 那句话在**误导**：它不是"服务器暂时不行"，而是"这个功能在这个构建里根本没有"。
 * 反复"重试"永远也不会好。⇒ 由这个开关把「不可用」这件事**明说**出来：
 * 界面照常渲染停止键（**不删按钮** —— 删了就等于把"为什么没有"一起藏起来），
 * 但 `ActivityPanel` 会：① 把原因挂到按钮 `title`；② 在确认弹窗里写明原因；
 * ③ 让确认键 `disabled`、并**根本不发这条请求**。
 *
 * ## ⚠ 已复活（2026-09-24，按上面"怎么复活"的三步原样执行）
 *
 * ① `src/host.ts` 注册了 `POST /api/sophia/team/destroy`（语义：中止整团、
 *    保留已完成结果 —— 账本落 `team/destroyed`，wire 对该团不再下发）；
 * ② `HALT_URL` 已指向那条路由（上面那行）；
 * ③ 开关改 `true`。
 * `ActivityPanel` 一行没动 —— 禁用态的所有分支都以这个开关为唯一判据
 * （`grep TEAM_HALT_AVAILABLE` 能全找到）。请求体由 `stopTeam` 发
 * `{sessionId, teamId}`；宿主 `parseDestroyTeamRequest` 只取 `teamId`
 * （`sessionId` 是上游形状的遗留字段，宿主侧忽略 —— 载荷形状见
 * `host-data.ts` 的 `parseDestroyTeamRequest`）。
 */
export const TEAM_HALT_AVAILABLE = true

/**
 * 上游 UI 的翻译函数（中文字典 + `{name}` 插值）。
 *
 * 插值语法与上游一致（`locales.ts` 里形如 `'{count} 名成员'`）：
 * 认得的占位符替换成参数值，**认不得的原样保留** —— 不静默抹掉，
 * 否则界面上会出现「 名成员」这种看不出哪里错的文本。
 */
export const t: AgentTeamsTranslate = (key, params) => {
  const template: string = zh[key]
  if (params === undefined) return template
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = params[name]
    return value === undefined ? whole : String(value)
  })
}

/** 空目录的固定快照（同一引用，满足 `useSyncExternalStore` 的稳定性要求）。 */
const EMPTY_STATE: ModelDirectoryState = {
  status: 'ready',
  groups: [],
  failures: [],
}

/**
 * 模型目录桩。
 *
 * 为什么是桩：`ModelDirectory` 是**宿主**的模型目录服务（`ctx.modelDirectories`），
 * 索菲亚的 client 半目前只声明了 `inject: ['slots']`，没有接这个服务；
 * 而且索菲亚的模型能力本来就走宿主已注册的 provider/model（REQUIREMENTS 的 N3）。
 *
 * 表现：计划编辑器里的模型选择器显示为空目录（`'plan.model.empty'` = 空态文案），
 * 成员的模型跟随全局默认 —— 即**不假装能选**，这与「不发明数据」一致。
 * 接上真实目录服务只需替换本函数的实现，不影响上游 UI 一行。
 */
export function createEmptyModelDirectory(): ModelDirectory {
  return {
    store: {
      subscribe: () => () => {},
      getSnapshot: () => EMPTY_STATE,
    },
    load: () => Promise.resolve(),
  }
}
