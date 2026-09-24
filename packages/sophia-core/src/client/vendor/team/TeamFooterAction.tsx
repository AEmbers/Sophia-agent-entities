// ⚠ 索菲亚移植点（**只改 import、取值时机与 props 类型来源**）：
// 1. `useLayoutEffect` / `useSyncExternalStore` 走 `hooks()`、
//    `IconAgentPresetOutline16` / `IconChevronLeftOutline14` / `Tooltip` 走
//    `../bridge.ts` 的 `primitives` 惰性代理（两者都要在**函数体内**取值）。
// 2. `TeamFooterProps` 的来源：上游从 `./slots.ts` 取的是那份 20 项的
//    `TeamSidebarProps` 总表的一部分。索菲亚版仍在 `./slots.ts`，但只声明
//    索菲亚真有的成员（见该文件「左栏（侧边栏）的 props」一节）。
import { hooks } from '../../react-runtime.ts'
import { primitives } from '../bridge.ts'
import type { TeamFooterProps } from './slots.ts'
import css from './team.module.css'

export function TeamFooterAction({ wide, navigation, enterTeam, leaveTeam, t }: TeamFooterProps) {
  const { useLayoutEffect, useSyncExternalStore } = hooks()
  const { IconAgentPresetOutline16, IconChevronLeftOutline14, Tooltip } = primitives
  const state = useSyncExternalStore(navigation.subscribe, navigation.getSnapshot, navigation.getSnapshot)
  const inTeam = state.mode === 'team'
  const label = inTeam ? t('backToConversations') : t('team')

  useLayoutEffect(() => {
    if (typeof document === 'undefined') return
    if (inTeam) {
      document.documentElement.dataset.agentTeamMode = 'team'
      return () => { delete document.documentElement.dataset.agentTeamMode }
    }
    delete document.documentElement.dataset.agentTeamMode
    }, [inTeam])

  return (
    <>
      <div className={wide ? css.footerStack : `${css.footerStack} ${css.railStack}`}>
        <Tooltip label={label} delayMs={500} disabled={wide}>
          <button
            type="button"
            className={wide ? css.footerAction : `${css.footerAction} ${css.rail}`}
            aria-label={label}
            data-team-action={inTeam ? 'leave' : 'enter'}
            onClick={inTeam ? leaveTeam : enterTeam}
          >
            {inTeam ? <IconChevronLeftOutline14 size={wide ? 16 : 18} /> : <IconAgentPresetOutline16 size={wide ? 16 : 18} />}
            {wide && <span>{label}</span>}
          </button>
        </Tooltip>
      </div>
    </>
  )
}
