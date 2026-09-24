/**
 * ⚠ **本文件已收成一个转出层** —— 真相搬到了 `./refs.ts`（上游原名）。
 *
 * ## 为什么要搬（不是重命名游戏）
 *
 * 上游 `refs.ts` 里 **Task refs 与 Thread refs 是同一套 store 的两个实例**
 * （`createRefStore` 泛型 + `taskStore` / `threadStore`）。先前索菲亚只移植了
 * Task 那一半，于是这个文件叫 `task-refs.ts`；本次把 Thread refs、`ResolvedMemberRef`、
 * `rosterChannelName` / `rosterMember` 一并补齐（上游 12.1KB 全量），
 * 若仍叫 `task-refs.ts` 会让名字与内容不符。
 *
 * ## 为什么保留这个文件而不是删掉它
 *
 * `TeamInboxPage.tsx` / `TeamComposer.tsx` / `TeamMemberRow.tsx` / `TeamAvatarStack.tsx`
 * 等既有调用点都 import 本文件，删掉会破坏它们（且本次只授权改两个页面）。
 * 保留转出对它们**零可见**，而「一个概念一个真相」得以维持：
 * 只有 `refs.ts` 里有 Map、有版本号、有解析链。
 *
 * @module @sophia/core/client/vendor/team/task-refs
 */

export {
  cachedResolvedTaskRef,
  cachedResolvedThreadRef,
  hostTaskRefLookup,
  hostThreadRefLookup,
  jumpToTaskThread,
  jumpToThread,
  refKeyOf,
  rememberResolvedTaskRef,
  rememberResolvedThreadRef,
  resolveUnknownTaskRefs,
  resolveUnknownThreadRefs,
  rosterChannelName,
  rosterMember,
  useResolvedTaskRefVersion,
  useResolvedThreadRefVersion,
  TASK_REF_RESOLUTION_AVAILABLE,
  __refKeyOfForFutureHostRoute,
} from './refs.ts'

export type { ResolvedMemberRef, ResolvedTaskRef, ResolvedThreadRef } from './refs.ts'
