/**
 * 上游 `team-dialog-save.ts`（45 行）的索菲亚版 —— **编辑对话框的保存生命周期**。
 *
 * ## 索菲亚移植点（三处，逻辑逐字）
 *
 * | 上游 | 索菲亚 | 理由 |
 * |---|---|---|
 * | `import { useRef, useState } from 'react'` | `hooks()` 惰性取 | 顶层值导入会多撞一次 `require(` ≤ 2 的断言 |
 * | `RemoteResult<T>`（`@deepseek-ai/dsh-typert-protocol`） | `TeamRemoteResult<T>`（`./slots.ts`） | 索菲亚没有 typert 那个包；形状逐字相同（`{ok,value}\|{ok,error:{message}}`） |
 * | `import type { MutableRefObject } from 'react'` | **保留** | type-only import 会被擦除，不产生模块加载调用（索菲亚既有先例：`panel.tsx` 的 `import type { ReactElement } from 'react'`） |
 *
 * 函数体（一次在途的持久更新 / 期间对话框禁用 / 拒绝就地报出 /
 * 只有父组件重读完成后才关闭）**逐字照抄**。
 *
 * @module @sophia/core/client/vendor/team/team-dialog-save
 */

import type { MutableRefObject } from 'react'
import { hooks } from '../../react-runtime.ts'
import type { TeamRemoteResult } from './slots.ts'

/**
 * Shared edit-dialog save lifecycle: one in-flight durable update, the dialog
 * held disabled while it runs, a refusal reported in place, and a close only
 * after the parent has re-read the committed state. Callers keep their own
 * payload and request reuse, and hold `pendingRequest` so that editing a field
 * drops a request the Host may already have committed.
 */
export function useEditDialogSave<Request>({ save, onCommitted, onClose }: {
  readonly save: (request: Request) => Promise<TeamRemoteResult<unknown>>
  readonly onCommitted: () => Promise<void> | void
  readonly onClose: () => void
}): {
  readonly saving: boolean
  readonly error: string | undefined
  readonly pendingRequest: MutableRefObject<Request | undefined>
  readonly save: (request: Request) => Promise<void>
} {
  const { useRef, useState } = hooks()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()
  // ⚠ 上游写的是 `useRef<Request>()`（无参）。索菲亚的 `ReactFace.useRef` 要求
  //   显式给初值（`useRef<T>(initial: T)`）⇒ 这里写 `useRef<Request | undefined>(undefined)`，
  //   并把返回类型标成 `MutableRefObject<Request | undefined>`。
  //   语义与上游一致：`current` 在有在途请求时是那个请求，否则是 `undefined`
  //   —— 上游那两处读法（`pendingRequest.current = undefined` / 读它复用）都不用改。
  const pendingRequest = useRef<Request | undefined>(undefined)
  const submit = async (request: Request): Promise<void> => {
    pendingRequest.current = request
    setSaving(true)
    setError(undefined)
    try {
      const result = await save(request)
      if (result.ok) {
        pendingRequest.current = undefined
        await onCommitted()
        onClose()
      } else {
        setError(result.error.message)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }
  return { saving, error, pendingRequest, save: submit }
}
