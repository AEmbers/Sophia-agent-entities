/**
 * 槽位**座位组件**（需要 JSX，故单独一个 `.tsx`；`index.ts` 必须保持 `.ts`）。
 *
 * 为什么 `index.ts` 不能改成 `.tsx`：`tests/shell.spec.ts` 有一条验收
 * **直接读** `src/client/index.ts` 的源码并断言
 *
 * ```ts
 * expect(src).toMatch(/export const PLUGIN_ID: string = __SOPHIA_PLUGIN_ID__/)
 * ```
 *
 * 它守的是「插件名只有构建期一个真相」。把文件改名成 `.tsx` 会让那条断言
 * 因为**读不到文件**而变红 —— 那是把一条好断言弄坏，不是修它。
 *
 * @module @sophia/core/client/seats
 */

import type { ReactElement } from 'react'

import { CLASS } from './styles.ts'
import { SophiaPanel } from './panel.tsx'
import {
  requestAddMember,
  requestCreateChannel,
  requestLifecycle,
  requestModelSwitch,
  requestSpawnDecision,
  type OpResult,
  type PanelStore,
} from './panel-store.ts'
import type { Translate } from './components.tsx'
import type { WireMember } from './view-model.ts'

/** 主面板座位的注入 props。 */
export interface PanelSeatProps {
  readonly store: PanelStore
  readonly t: Translate
}

/** 侧边栏入口座位的注入 props（`sidebar.panellist` 只画一个字形）。 */
export interface EntrySeatProps {
  readonly t: Translate
  readonly size?: number
  readonly active?: boolean
}

/**
 * 主区页面座位。
 *
 * 换模请求**只负责发起**，成功与否由宿主决定（FR-6.5：成员正忙时在最近的
 * 步骤边界生效），因此这里**不**乐观改本地状态 —— 那是 FR-10.2 禁的
 * 「独立真相」。成功后才重新读一次视图（让界面显示宿主认可的新值）；
 * 失败就把原因写进控制台，界面保持宿主给的旧值。
 *
 * ⚠ **`model === null` 时拒绝发起**（OCR 复核 MEDIUM 抓到的真实缺陷）：
 * 初版直接 `member.model?.provider ?? ''`，于是「跟随全局默认」的成员被点换模时，
 * 会向宿主 POST `{provider:'', model:''}` —— 那不是一个有意义的换模目标，
 * 宿主只能拒掉，或（更糟）当成一次空选择应用掉。
 * 现在：**没有目标就不发请求**，并明确记一条日志说明为什么。
 * 界面上对应的入口也已隐藏（见 `components.tsx` 的 `MemberCard`），
 * 两层一起保证「界面不会展示一个做不到的操作」。
 */
export function PanelSeat(props: PanelSeatProps): ReactElement | null {
  const { store, t } = props
  const onSwitchModel = (member: WireMember): void => {
    const target = member.model
    // ⚠ 两道判据缺一不可（OCR 复核 MEDIUM ×2）：
    //   ① `target === null` ⇒ 该成员「跟随全局默认」，根本没有目标；
    //   ② **空串** provider/model ⇒ 线格式是外部输入，
    //      `view-model.ts` 用 `str()` 收窄（认不出的值 → `''`），
    //      所以空串**可能**绕过 `asModel` 的判空到达这里。
    //   只判 ① 的话，② 会照样 POST `{provider:'', model:''}` ——
    //   正是这次修复要消灭的那种无意义请求。
    //   在**请求边界**上自证不变量，而不是依赖上游收窄没漏。
    if (target === null || target.provider === '' || target.model === '') {
      console.warn(
        `[sophia] model switch skipped for ${member.memberId}: `
        + (target === null
          ? '该成员跟随全局默认（model === null），没有可提交的目标'
          : `模型目标不完整（provider="${target.provider}", model="${target.model}"）`),
      )
      return
    }
    void requestModelSwitch(member.memberId, target.provider, target.model).then((result) => {
      // ⚠ **三态**分别处理（captain 派修的 HIGH）：`applied-with-anomaly` 是
      //   「**已生效**但审计序号异常」——**不是**失败。
      //   按失败处理（提示重试）会**写第二条换模事件**，正是宿主用 200 而非 5xx
      //   要避免的事（见 `host.ts` 的 `sequence-mismatch` 分支与
      //   `ModelSwitchResult` 的说明）。
      //   `switch` 穷尽：将来多一态会编译不过，不会静默走错分支。
      switch (result.kind) {
        case 'switched':
          // 成功才重新读视图（让界面显示宿主认可的新值）。
          // ⚠ `background: true` 是**承重**的（OCR 复核 HIGH 指出本处会闪掉整个面板）：
          // 不传它，`PanelStore.load` 会先把 snapshot 打成 `loading` 态 ⇒ `panel.tsx`
          // 把 body 换成 loading 视图 ⇒ `TeamPanel` 卸载重挂 ⇒ 用户在这一卡里选的
          // 频道/线程被重置，画面可见地闪一下。换模成功属于「原地更新」，
          // 刷新期间继续显示旧内容、拿到新数据再替换，体验才正确。
          void store.load(undefined, { background: true })
          break
        case 'applied-with-anomaly':
          // 已生效 ⇒ **仍然重读**（账本真的变了，界面要跟上），
          // 但走 `notice` 而不是 `error`：让界面用**警告**口径说明异常并劝止重试。
          // ⚠ 不用 `store.setNotice` 直接把宿主的原始 detail 塞进去 —— 那串可能
          //   泄露内网信息（`describeError`/`sanitizeErrorForDom` 那条纪律同源）。
          //   这里给**已翻译的固定文案**，原始 detail 只进 console。
          console.warn(`[sophia] model switch applied with audit anomaly: ${result.detail}`)
          // OCR HIGH [26]：标题之外必须带「请勿重试」的 hint —— 第三态的全部
          // 意义就是劝止重试（重试会写第二条换模事件），而 hint 此前从未被渲染。
          store.setNotice(`${t('appliedWithAnomalyTitle')} —— ${t('appliedWithAnomalyHint')}`)
          // ⚠ `background: true` 是**承重**的（OCR 复核 HIGH 指出本处会闪掉整个面板）：
          // 不传它，`PanelStore.load` 会先把 snapshot 打成 `loading` 态 ⇒ `panel.tsx`
          // 把 body 换成 loading 视图 ⇒ `TeamPanel` 卸载重挂 ⇒ 用户在这一卡里选的
          // 频道/线程被重置，画面可见地闪一下。换模成功属于「原地更新」，
          // 刷新期间继续显示旧内容、拿到新数据再替换，体验才正确。
          void store.load(undefined, { background: true })
          break
        case 'failed':
          console.warn(`[sophia] model switch failed: ${result.detail}`)
          break
      }
    })
  }
  // 审批（两级审批的第二级）：提交决定 → 成功才强刷视图。
  // ⚠ force：审批改变的是**结构**（建团 / 驳回），普通 load 可能命中缓存窗。
  //   失败走 console + 已翻译的固定 notice（不塞宿主原始 detail —— 泄露纪律
  //   与换模那条同源）。
  const onDecide = async (requestId: string, decision: 'approve' | 'reject'): Promise<void> => {
    const result = await requestSpawnDecision(requestId, decision)
    if (result.kind === 'decided') {
      // OCR MEDIUM [第五轮]：成功后**清掉旧失败横幅** —— notice 是粘性的
      //（settle 只保留不清），重试成功后旧「操作失败」会永远挂着。
      store.setNotice(null)
      // ⚠ `background: true` 与 `force` **都要**（OCR 复核 HIGH 指出本处会闪掉整个面板）：
      // `force` 负责绕过缓存窗（审批/运营改变的是**结构**：建团、建频道、加成员，
      // 普通 load 可能命中缓存而看不到变化）；`background` 负责**不要**把 snapshot
      // 打成 loading 态 —— 否则 `panel.tsx` 会卸载重挂 `TeamPanel`，
      // 用户选的频道/线程被重置、画面闪一下。两个选项各管一件事，缺一个就退化。
      void store.load(fetch, { force: true, background: true })
      return
    }
    console.warn(`[sophia] spawn decision failed: ${result.detail}`)
    store.setNotice(t('decisionFailed'))
  }

  // 运营入口三件套（文档 4）：成功一律 force 强刷（结构变了）；
  // 失败 console + 已翻译固定 notice（与审批/换模同一纪律，不塞原始 detail）。
  // 当前团 id 与 `panel.tsx` 的 `teams[0]` 同源（单团面板语义）；
  // 拿不到（还没有团）⇒ 显示失败 notice，不发一个会 404 的空请求。
  const currentTeamId = (): string | null =>
    store.getSnapshot().view?.teams[0]?.teamId ?? null
  // ⚠ OCR [3][4]：runOp 只服务运营三件套 —— 参数收窄成 `OpResult`（原先
  //   对 'switched'/'decided' 的比较是死分支），并返回**真实完成**的 promise：
  //   声明 `Promise<void>` 却立即 resolve，会邀请调用方 await 一个什么都没
  //   代表的空 promise。
  const runOp = (label: string, op: Promise<OpResult>): Promise<void> =>
    op.then((result) => {
      if (result.kind === 'done') {
        // 同 onDecide：成功清 notice（粘性横幅不残留）。
        store.setNotice(null)
        // ⚠ `background: true` 与 `force` **都要**（OCR 复核 HIGH 指出本处会闪掉整个面板）：
      // `force` 负责绕过缓存窗（审批/运营改变的是**结构**：建团、建频道、加成员，
      // 普通 load 可能命中缓存而看不到变化）；`background` 负责**不要**把 snapshot
      // 打成 loading 态 —— 否则 `panel.tsx` 会卸载重挂 `TeamPanel`，
      // 用户选的频道/线程被重置、画面闪一下。两个选项各管一件事，缺一个就退化。
      void store.load(fetch, { force: true, background: true })
        return
      }
      console.warn(`[sophia] ${label} failed: ${result.detail}`)
      store.setNotice(t('opFailed'))
    })
  const onCreateChannel = (title: string): Promise<void> => {
    const teamId = currentTeamId()
    if (teamId === null) {
      store.setNotice(t('opFailed'))
      return Promise.resolve()
    }
    return runOp('create channel', requestCreateChannel(teamId, title))
  }
  const onAddMember = (position: string): Promise<void> => {
    const teamId = currentTeamId()
    if (teamId === null) {
      store.setNotice(t('opFailed'))
      return Promise.resolve()
    }
    return runOp('add member', requestAddMember(teamId, position))
  }
  const onLifecycle = (memberId: string, action: 'suspend' | 'resume'): Promise<void> =>
    runOp('member lifecycle', requestLifecycle(memberId, action))

  return (
    <SophiaPanel
      store={store}
      t={t}
      onSwitchModel={onSwitchModel}
      onDecide={onDecide}
      onLifecycle={onLifecycle}
      onCreateChannel={onCreateChannel}
      onAddMember={onAddMember}
    />
  )
}

/**
 * 侧边栏入口的字形。
 *
 * 用 `currentColor` 描边，跟随主题（不写死色值）—— 与 `styles.ts` 同一纪律。
 * `aria-hidden`：标签文本由宿主的面板行渲染（它读我们给的 `label` thunk），
 * 字形再报一次名字会让读屏重复。
 */
export function EntrySeat(props: EntrySeatProps): ReactElement | null {
  const size = props.size ?? 18
  return (
    <span className={CLASS.entryGlyph} aria-hidden="true" data-sophia-entry-glyph>
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        focusable="false"
      >
        {/* 20 个成员分四梯队 ⇒ 四个节点连成一张「团队」图。 */}
        <circle cx="12" cy="6" r="2.4" />
        <circle cx="6" cy="16" r="2.2" />
        <circle cx="12" cy="18" r="2.2" />
        <circle cx="18" cy="16" r="2.2" />
        <path d="M12 8.4v3.2M6 13.8v1.1M12 15.8v-4.2M18 13.8v1.1" />
      </svg>
    </span>
  )
}
