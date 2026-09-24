// ⚠ 索菲亚移植点（**只改 import、取值时机与一处调用签名**）：
// 1. `useEffect` / `useRef` / `useState` 走 `hooks()`、
//    `IconUserOutline16` / `Modal` / `Tooltip` 走 `primitives` 惰性代理。
// 2. `<TeamMemberRow … t={t} />` 那一处的 `t` **不再传**：索菲亚版的
//    `TeamMemberRow`（本次交付的同一目录文件）已经**剥掉了 `t`** ——
//    它的文案全部来自 `status` 与 `action.label`，由调用方给（见该文件头的
//    「改动②A」说明）。这不是随手改：多传一个 prop 会当场
//    `TS2322: Property 't' does not exist on type …`，即 tsc 会自己抓住。
// 3. `TeamSettingsProps` 仍在 `./slots.ts`，但只声明索菲亚真有的成员。
import { hooks } from '../../react-runtime.ts'
import { primitives } from '../bridge.ts'
import type { TeamSettingsProps } from './slots.ts'
import { TeamMemberRow } from './TeamMemberRow.tsx'
import membersCss from './members.module.css'
import css from './team.module.css'

type TeamMembersActionProps = Pick<TeamSettingsProps, 'wide' | 'loadMemberGroups' | 't'>

export function TeamMembersAction({ wide, loadMemberGroups, t }: TeamMembersActionProps) {
  const { useEffect, useRef, useState } = hooks()
  const { IconUserOutline16, Modal, Tooltip } = primitives
  const [panelOpen, setPanelOpen] = useState(false)
  const [groups, setGroups] = useState<Awaited<ReturnType<typeof loadMemberGroups>>>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!panelOpen) return
    queueMicrotask(() => { contentRef.current?.focus() })
  }, [panelOpen])

  const openMembers = () => {
    setPanelOpen(true)
    setLoading(true)
    setError(undefined)
    void loadMemberGroups().then(setGroups).catch(cause => {
      setError(cause instanceof Error ? cause.message : String(cause))
    }).finally(() => { setLoading(false) })
  }

  const closeMembers = () => {
    setPanelOpen(false)
    queueMicrotask(() => { triggerRef.current?.focus() })
  }

  return (
    <>
      <Tooltip label={t('members')} delayMs={500} disabled={wide}>
        <button ref={triggerRef} type="button" className={wide ? css.settingsAction : `${css.settingsAction} ${css.rail}`} aria-label={t('members')} aria-haspopup="dialog" onClick={openMembers}>
          <IconUserOutline16 size={wide ? 16 : 18} />
          {wide && <span>{t('members')}</span>}
        </button>
      </Tooltip>
      <Modal open={panelOpen} onClose={closeMembers} title={t('members')} closeLabel={t('close')} contentClassName={membersCss.body!}>
        <div ref={contentRef} className={membersCss.content} tabIndex={-1}>
          {loading && <p className={membersCss.state} role="status">{t('loadingAgents')}</p>}
          {!loading && groups.length === 0 && error === undefined && <p className={membersCss.state}>{t('emptyAgents')}</p>}
          {!loading && groups.map(group => (
            <section className={membersCss.group} key={group.workspaceId} aria-labelledby={`team-members-${group.workspaceId}`}>
              <h3 id={`team-members-${group.workspaceId}`}>{group.workspaceTitle}</h3>
              {group.members.map(status => <TeamMemberRow key={status.member.memberId} status={status} className={membersCss.member} />)}
            </section>
          ))}
          {error !== undefined && <p className={membersCss.error} role="alert">{error}</p>}
        </div>
      </Modal>
    </>
  )
}
