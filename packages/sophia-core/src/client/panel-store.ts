/**
 * 面板的数据源：**只用 React 的 hook 订阅我们自己知道何时变化的那一个值**。
 *
 * ## 为什么这里没有引第三方状态库
 *
 * 上游用的是 `dsh-client-store` 的 `createSnapshotStore`（那是**平台模块表**
 * 里种好的裸名之一，故上游可以 `require` 它）。本插件刻意**不**这么做：
 * 每多依赖一个平台裸名，「宿主版本不匹配」就多一个静默失败面。而本面板需要
 * 的状态只有一个小对象，用 `useState` + 一个订阅集合就够 —— 代码量比接库少。
 *
 * ## 为什么拉数据走 `fetch` 而不是 cordis 服务
 *
 * 本机在跑的 `dsh-postman` / `dsh-api-visualizer` 都是这么做的（`fetch` 同源
 * 回环路由），且它们的 client 半同样是「纯 DOM、无 DSH 服务依赖」。
 * 好处是**失败面很小**：宿主路由不在就是 404，`fetch` 会如实报错，
 * 界面显示「不可用」而不是一片空白。
 *
 * ## 与 t1–t3 的事实对照（勿把这段当推测）
 *
 * - `src/host.ts`（t1）目前**只注册** `/api/sophia/status`（只读自检），
 *   **没有**视图路由。所以本文件请求 `/api/sophia/view` 在当下会 404，
 *   界面会走 `error` 分支并显示可读原因。这是**如实降级**，不是缺陷掩盖。
 * - 投影能力（`t3`）在**宿主侧** `src/projection/index.ts` 已就绪，宿主只要
 *   把 `rebuildFold` / `catchUpFold` 的结果按 `WireView` 形状吐出来即可 ——
 *   线格式字段名与投影输出**逐字一致**（见 `view-model.ts` 的说明）。
 *
 * @module @sophia/core/client/panel-store
 */

import { parseWireView, type WireView } from './view-model.ts'

/** 视图读取路由（宿主侧**待实现**；见文件头）。 */
export const VIEW_ROUTE = '/api/sophia/view'

/** 面板状态。 */
export interface PanelSnapshot {
  /** `loading` = 正在读；`ready` = 拿到合法载荷；`error` = 读取失败或载荷不可用。 */
  readonly status: 'loading' | 'ready' | 'error'
  /** 成功时的载荷；否则 `null`。 */
  readonly view: WireView | null
  /** 失败时的可读原因；否则 `null`。 */
  readonly error: string | null
  /** 最后一次**尝试**读取的时刻（epoch ms）；从未读过为 `0`。 */
  readonly readAt: number
  /**
   * **非致命提示**（可读文案）；没有时为 `null`。
   *
   * ## 为什么必须有这个字段（captain 派修的 HIGH 的 UI 出口）
   *
   * 「换模已生效、但审计序号异常」这一类结果**既不是成功也不是失败**：
   * 界面若走 `error` 会被读成「失败了、去重试」——而**重试会写第二条换模事件**。
   * 若走「成功」则把异常**藏起来**（正是初版的缺陷）。
   * ⇒ 需要一个**第三态**的展示位：中性/警告口径、且**劝止重试**。
   *
   * 与 `error` 分开而不是复用：两者语义不同（一个要重试、一个**不能**重试），
   * 合并会让渲染层无法区分，最终必然有一类被显示错。
   */
  readonly notice: string | null
}

/**
 * 初始快照。
 *
 * ⚠ **每个实例各拿一份**（OCR 复核 LOW）：初版是这个模块级对象被所有实例共享，
 * 且只标了 `readonly`（类型层面）而**没有冻结**。于是任何一个消费者若在
 * 「消费」时改了它（`readonly` 只在编译期拦、运行期拦不住），
 * 就会污染**所有** store 实例的初始值，而 `emit` 的引用比较还会拿被改过的
 * `previous` 去比对。这里改成工厂函数：每个实例一份，改不到别人。
 */
function initialSnapshot(): PanelSnapshot {
  return { status: 'loading', view: null, error: null, readAt: 0, notice: null }
}

/**
 * 一个极小的可订阅快照容器。
 *
 * `getSnapshot` 返回**同一个引用**直到状态真的变化 —— 这是 `useState` 订阅
 * 路径能避免无限重渲染的前提（每次返回新对象会让 `useEffect` 里的
 * `setState` 每次都判定为「变了」）。
 */
export class PanelStore {
  private snapshot: PanelSnapshot = initialSnapshot()
  private readonly listeners = new Set<() => void>()
  /** 进行中的请求；`null` 表示空闲。用于把并发 `load()` 合并成一次。 */
  private inFlight: Promise<void> | null = null
  /**
   * 世代号：每起一次请求 +1。
   *
   * 请求起跑时捕获自己那一代，**每个 `emit` 前**校验是否仍是当前世代；
   * 不是就整个不写状态（见 `load` 里的详细说明）。
   * 与 `inFlight` 的分工：`inFlight` 管「要不要复用这次请求」（合并），
   * `generation` 管「这次请求的结果还算不算数」（过期丢弃）——
   * 两者都是必需的：只合并不校验过期，慢的旧请求会覆盖新的。
   */
  private generation = 0
  private disposed = false

  getSnapshot = (): PanelSnapshot => this.snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private emit(next: PanelSnapshot): void {
    if (this.disposed) return
    // 只在**真的变了**的时候通知（否则订阅者会空转重渲染）。
    const previous = this.snapshot
    if (
      previous.status === next.status
      && previous.view === next.view
      && previous.error === next.error
      && previous.readAt === next.readAt
      // ⚠ `notice` **必须**参与去重：漏掉它会让「只设了 notice」的更新被当成
      //   「没变化」而**不通知订阅者** ⇒ 提示永远不显示（静默丢失）。
      //   这类缺陷特别隐蔽：状态确实写进了 `this.snapshot`，只有 UI 不动。
      && previous.notice === next.notice
    ) {
      return
    }
    this.snapshot = next
    for (const listener of this.listeners) {
      try {
        listener()
      } catch (error) {
        // 一个订阅者抛错不能连累其它订阅者（与 `slot` 的错误隔离同源理由）。
        console.error('[sophia] panel listener failed (ignored):', error)
      }
    }
  }

  /**
   * 设置（或清除）非致命提示。
   *
   * ⚠ 只动 `notice`，**不碰** `status` / `view` / `error` —— 「已生效但审计异常」
   *   时账本真的变了、界面也该照常显示数据，只是多一条提示。
   *   若这里顺手把 `status` 改成 `error`，就会退化成「报失败让用户重试」，
   *   而重试会写第二条换模事件（见 `ModelSwitchResult` 的说明）。
   */
  setNotice(notice: string | null): void {
    this.emit({ ...this.snapshot, notice })
  }

  /**
   * 读一次视图。
   *
   * ⚠ **并发合并**：面板挂载期可能被多次触发（重试按钮 + 初始加载）。
   * 不合并的话，后到的响应可能**覆盖**先到的，而两者的 `readAt` 顺序与
   * 到达顺序无关 —— 界面于是显示一份比当前更旧的数据。
   * 这里把进行中的 Promise 直接复用，语义是「这一刻的数据我要的就是这一份」。
   *
   * ⚠ **但「用户主动重试」不能被静默吞掉**（OCR 复核 HIGH 抓到的真实缺陷）：
   *   初版在 `inFlight !== null` 时无条件返回，于是**重试按钮点在慢请求进行中
   *   就是空操作** —— 不发新请求、不产生新的 loading 态，界面保持原样、
   *   用户以为点了没反应。合并在语义上只对「同一批自动触发」成立，
   *   对**人的操作**必须真的执行一次。
   *
   * @param fetcher - 取数据的方式（测试注入用）。
   * @param options.force - `true` = 用户主动刷新：**不合并**、立即起一次新请求。
   */
  load(
    fetcher: typeof fetch = fetch,
    options?: { readonly force?: boolean; readonly background?: boolean },
  ): Promise<void> {
    if (this.disposed) return Promise.resolve()
    const force = options?.force === true
    if (this.inFlight !== null && !force) return this.inFlight

    // ── 世代令牌：**过期响应一律不许写状态** ──────────────────────────────
    // ⚠ 这是 captain 派修的真缺陷，也是我原先**注释与事实不符**的地方。
    //   历史：我先修了「force 不能被合并吞掉」，并在注释里写「旧请求的结果
    //   会被丢弃」—— 但那次只改了 `finally` 里的 `inFlight` **记账**
    //   （`if (this.inFlight === request) this.inFlight = null`），
    //   而四处 `emit` 全是**无条件**调用。
    //   ⇒ 「丢弃」只发生在记账层，**没发生在 emit 层**：慢的旧请求能在新的
    //     之后落地并覆盖它。实测（captain 的探针 + 本仓三条用例）：
    //     慢 A 卡住 → 快 B 落地 → 放行 A ⇒ 最终状态是 **A 的旧数据**。
    //   两条路径都可达：①非 force + force；②两次 force。
    //   （频率上，①基本不可达 —— `retry` 按钮只在 error 态渲染，而 `load()`
    //    第一步就 `emit(loading)` 会让按钮消失；②需要在下一次重渲染前落下
    //    第二次点击，窗口很窄。但**可达性低不是不修的理由**：这条的代价是
    //    「界面显示一份被明确取代过的数据」，且注释已经声称它不会发生。）
    //
    //   修法：每起一次请求就推进世代号，请求内**每个** `emit` 前校验自己是否
    //   仍是当前世代 —— 不是就整个不写（成功、失败**一视同仁**：
    //   过期的失败同样会把界面从「已就绪」打成「错误」，而那次失败描述的是
    //   一个已经被取代的请求）。
    //   这里刻意**不上 AbortController**：那会在宿主侧产生取消语义、还要处理
    //   取消与超时的区分，而这里要的效果仅仅是「不写状态」，一行判据就够。
    this.generation += 1
    const generation = this.generation
    /** 本请求是否仍是当前世代（不是 ⇒ 它已被更新的请求取代）。 */
    const isCurrent = (): boolean => generation === this.generation

    /**
     * **本请求写状态的唯一通道** —— 带上世代校验。
     *
     * ⚠ 为什么不写成「每个 `emit` 前自己记得加一句 `if (!isCurrent()) return`」
     *   （那是我第一版的修法）：那种写法把正确性押在「后来改这里的人**记得**
     *   加校验」上 —— 而这正是本缺陷的成因本身（我当初确实**写了注释**说
     *   「旧请求会被丢弃」，却没在 `emit` 上做任何事）。
     *   对「缺失的防护」而言，**约定不如结构**：把校验内置进唯一写状态入口，
     *   请求体内就再也写不出一条无校验的状态更新 —— 想漏也漏不掉。
     *   这也是 captain 那条纪律的落地：搜 `abort/seq/stale` 是搜不出
     *   「防护的缺失」的，得让控制流**在结构上**不含无防护的路径。
     *
     * `readAt` 也一并由它写：避免四处各写一遍 `Date.now()` 而分叉。
     */
    const settle = (next: Omit<PanelSnapshot, 'readAt' | 'notice'> & { readonly notice?: string | null }): void => {
      // 过期的响应（成功、失败、解析失败**一视同仁**）一律不写：
      // 过期的失败同样会把「已就绪」打成「错误」，而那次失败描述的是一个
      // 已经被取代的请求。
      if (!isCurrent()) return
      // `notice` **默认沿用当前值**（而不是被清成 null）：它表达的是
      // 「换模已生效但审计异常」这类**独立于本次读取**的事实，
      // 一次普通重读不该把它抹掉 —— 那样用户会看到提示自己消失。
      // OCR MEDIUM [第六轮]：`notice?: string | null` 的 null 曾被 `??` 吞掉
      //（`null ?? x` = x，显式清除永远无效）—— undefined=保留、null=清除分开。
      this.emit({ ...next, notice: next.notice === undefined ? this.snapshot.notice : next.notice, readAt: Date.now() })
    }

    // ⚠ 这里必须区分**两条路径**（OCR 复核指出本处初版一刀切会在两种情况下各坏一次）：
    //
    // - **显式刷新 / 重试**（`background` 未给，默认）：切 loading ⇒ 用户点了要看到反馈。
    //   此时 body 进 loading 视图、根元素（取 `snapshot.status`）也说 loading，二者一致。
    //   这条不变量由 `tests/client/panel.spec.tsx` 的「重试期间根属性与 body 一致」专门盯着
    //   —— 它记录的是**先前**修掉的一个 HIGH：只按 `view === null` 判断会让重试**毫无反馈**。
    // - **后台轮询**（`background: true`，见 `panel.tsx` 的 `PANEL_POLL_MS`）：**不切** loading。
    //   否则每 4 秒把 body 换成 loading 视图 ⇒ `TeamPanel` 被卸载重挂 ⇒ 用户在面板里
    //   选的频道/线程**被定时器重置**，画面还会可见地闪一下（OCR 复核指出）。
    //   刷新期间继续显示旧内容，`readAt` 更新本身就表达了「刚读过」。
    if (options?.background !== true) {
      settle({ ...this.snapshot, status: 'loading' })
    }
    // ⚠ `request` 必须**先声明**（`let` 而非 `const`）：下面的 `finally` 要拿它跟
    //   `this.inFlight` 比。若写成 `const request = (async () => …)()`，
    //   当 `fetcher` **同步**抛错时（它在第一个 `await` **之前**被求值），
    //   `catch`/`finally` 会在赋值完成前跑到引用 `request` 那一行 ⇒
    //   **暂时性死区 ReferenceError**。初版如此，被 `tsc` 的
    //   `Variable 'request' is used before being assigned` 当场拦下。
    //   同时初始化为一个已决 promise：即便同步抛错也有定义的值可比。
    // ⚠ `const` 现在是安全的（OCR 复核 LOW 纠正了我原先的说法）：
    //   我最初写成 `let request = Promise.resolve(); request = (async …)()`，
    //   并注释说「`fetcher` 同步抛错会导致 TDZ」——**那个理由不成立**：
    //   async 函数体总是先返回 promise，赋值一定发生在 `finally` 之前。
    //   真正需要防的是「同步抛错会让 `finally` 抢在赋值前跑完」
    //   （见下面 `await Promise.resolve().then(…)` 那段），而那已经由
    //   **把 fetcher 调用推迟一个微任务**从根上消除了 ——
    //   异步体里第一个语句就是一个 `await`，`finally` 必然晚于赋值。
    //   ⇒ 那个 `let` + 初始值成了**死赋值**，改回 `const`。
    // ⚠ 这里的 `let` + 初始值是**编译器的要求，不是运行期的需要**
    //   （我原先注释说「同步抛会 TDZ」，那个理由**是错的** —— OCR 复核 LOW 指出，
    //    实测也确认：async 函数体总是先返回 promise，赋值一定先完成）。
    //   但它**不能**改成 `const`：`finally` 里引用了 `request`，
    //   而 TS 的控制流分析**无法证明**异步体里的 `finally` 一定晚于那句赋值
    //   （它对 async 体是保守的）⇒ 改 `const` 会报
    //   `TS2454: Variable 'request' is used before being assigned`（实测）。
    //   真正需要防的「同步抛错让 finally 抢在赋值前跑完」已由下面
    //   `await Promise.resolve().then(…)` 从根上消除。
    let request: Promise<void> = Promise.resolve()
    request = (async () => {
      try {
        // ⚠ **把 `fetcher` 的调用推迟到一个微任务**（OCR 复核对本文件的一条
        //   半对意见，顺控制流读出来的真缺陷 —— 但它说的理由不是真原因）：
        //
        //   OCR 说「`request` 的初值永不被读，因为 async IIFE 不可能同步抛，
        //   那句 TDZ 注释不成立」—— **这条是对的**，我照改了（见上）。
        //
        //   但顺着「同步抛错会怎样」读下去，暴露出一个**真的**缺陷：
        //   若 `fetcher` **同步**抛（最现实的路径是宿主环境没有 `fetch` ——
        //   默认参数 `fetcher = fetch` 拿到 `undefined`，调用它当场 TypeError），
        //   那么 `catch`/`finally` 会在 **IIFE 返回之前**的同步段里跑完，
        //   而 `this.inFlight = request` 是之后才执行的 ⇒
        //   `finally` 里 `this.inFlight === request` 必然为假、**清不掉**；
        //   紧接着 `inFlight` 被赋成那个**已结**的 promise ⇒
        //   **之后每一次非 force 的 `load()` 都直接复用它，再也不会真的发请求**
        //   ——面板从此永久停在错误态（重试是 force 能绕过，但任何**自动**
        //   重读都会永久失效）。实测：修复前「同步抛后第二次 load」的
        //   fetcher 调用次数是 **0**。
        //
        //   修法：用 `await Promise.resolve().then(…)` 把调用推到微任务里，
        //   保证赋值先完成。这也让「同步抛」与「异步抛」走**同一条**路径，
        //   不再有两种时序需要分别推理。
        const response = await Promise.resolve().then(() => fetcher(VIEW_ROUTE, {
          headers: { accept: 'application/json' },
          // 凭据口径见 REQUEST_CREDENTIALS 的说明（真实 DSH 的 connection 门要凭据）。
          credentials: REQUEST_CREDENTIALS,
        }))
        if (!response.ok) {
          settle({
            status: 'error',
            view: null,
            error: httpFailure(response.status, response.statusText, VIEW_ROUTE),
          })
          return
        }
        const payload: unknown = await response.json()
        const view = parseWireView(payload)
        if (!view.ok) {
          // ⚠ `view: null` 而不是 `view`（OCR 复核 MEDIUM 抓到的真实缺陷）：
          // 初版把解析结果传下去，而面板用 `snapshot.view !== null` 判是否渲染
          // `TeamPanel` ⇒ 当宿主回 `{ok:false, teams:[…]}` 时，界面会渲染出
          // 一个**看起来就绪**的团队列表，同时根元素带 `data-sophia-state="error"`
          // —— 三态视觉区分被破坏，而这种「看起来正常、内容却是错的」正是
          // 本仓反复要避免的失效模式。
          // 失败就是失败：错误分支**不携带**可用于渲染的数据。
          settle({
            status: 'error',
            view: null,
            error: view.error ?? 'the host reported an unsuccessful view read',
          })
          return
        }
        settle({ status: 'ready', view, error: null })
      } catch (error) {
        settle({ status: 'error', view: null, error: describeError(error) })
      } finally {
        // ⚠ **只清自己的坑**：主动刷新会替换 `inFlight`，旧请求收尾时不能把
        //   新请求的 `inFlight` 抹成 `null`（那会让随后的合并判据失效）。
        if (this.inFlight === request) this.inFlight = null
      }
    })()
    this.inFlight = request
    return request
  }

  dispose(): void {
    this.disposed = true
    this.listeners.clear()
  }
}

/**
 * 请求凭据口径（两处调用共用）。
 *
 * 提成常量（OCR 复核 LOW）：初版在 `load` 与 `requestModelSwitch` 各写一遍
 * `credentials: 'omit'`，改一处漏一处就会出现**静默的鉴权失败**
 * ——那种失败看起来像「路由 404」，极难定位。
 *
 * 为什么是 `include`（2026-09-24 实测改判，旧值 `omit` 被证伪）：本插件的两条宿主路由
 * 在真实 DSH 里要过 `connection` 身份门 —— 面板 fetch 不带凭据时该门回 401，
 * 实测现象：GUI 报「HTTP 401 Unauthorized (/api/sophia/view)」。
 * ⚠ 旧注释说「同源回环不需要 cookie、带上反而多一个失败面」——那只对**没有
 * connection 门的裸回环部署**成立，真实 DSH 上不成立。改凭据口径仍只动这一个常量。
 */
const REQUEST_CREDENTIALS: RequestCredentials = 'include'

/** 这些路由都与 `avatar.ts` 的 `AVATAR_ROUTE` 同属「宿主侧契约」。 */
export const MODEL_SWITCH_ROUTE = '/api/sophia/member/model'

/**
 * 换模请求的 `reason` 值（宿主契约里的业务枚举）。
 *
 * 提成常量（OCR 复核 MEDIUM）：初版把它写死在 body 字面量里，
 * 宿主契约一变就得靠人肉搜字符串；现在它是可 grep 的具名常量。
 */
export const MODEL_SWITCH_REASON = 'human-switch'

/**
 * 把原始错误统一成**可读**文案（OCR 复核 MEDIUM）。
 *
 * 初版在非 `Error` 抛出物上直接 `String(error)`，于是
 * - 对象会渲染成 `[object Object]`（用户完全无法理解）；
 * - `response.statusText` 在 HTTP/2 下**经常是空串**，
 *   于是 `.trim()` 只是把一个尾随空格去掉、消息退化成 `HTTP 404`，看不出是哪个路由。
 *
 * 判据：**任何输入都要产出一句人能读懂的话**。细类的区分留给调用点。
 */
export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (error === null || error === undefined) return 'unknown failure'
  if (typeof error === 'object') {
    // 只取**自有**的 message 字段；取不到就给类型名，绝不给 `[object Object]`。
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message !== '') return message
    return `unexpected ${Object.prototype.toString.call(error).slice(8, -1) || 'object'}`
  }
  return `unexpected ${typeof error}: ${String(error)}`
}

/** HTTP 失败的可读文案（`statusText` 可能是空串，见上）。 */
function httpFailure(status: number, statusText: string, route: string): string {
  const detail = statusText.trim()
  return detail === '' ? `HTTP ${status} from ${route}` : `HTTP ${status} ${detail} (${route})`
}

/**
 * 换模请求的结果。
 *
 * ## 为什么是**三态**而不是 `string | null`（captain 派修的 HIGH，根因在这）
 *
 * 初版的签名是 `Promise<string | null>`：`null` = 成功、字符串 = 失败原因。
 * **这个签名表达不了「已生效但审计异常」** —— 而那正是宿主刻意设计的一种结果：
 *
 * ```
 * host.ts  case 'sequence-mismatch':
 *   // 事件**已写入**（不可撤销），只是序号与预测不符 ⇒ 回 200 但带
 *   // `ok:false` 与显式标记，让界面能如实提示「已生效、但审计序号异常」，
 *   // **不**把它伪装成可重试的失败（重试会写第二条）。
 *   writeJson(res, 200, { ok: false, sequence, predicted, error })
 * ```
 *
 * 初版只判 `response.ok`（HTTP 层）⇒ **200 就返回 `null`（成功）**，
 * body 里的 `ok:false` 完全没被消费 ⇒ 这条最需要提示用户的情形在界面上
 * **表现为成功**，宿主精心设计的标记白写了。
 *
 * ⚠ 所以修法**不是**「把 `200 + ok:false` 当失败」——那会退化成
 *   「提示用户重试」，而重试会**写第二条换模事件**（宿主之所以用 200
 *   而非 5xx，正是为了不让它看起来可重试）。
 *   必须把「已生效/不可重试」与「未生效/可重试」**分成两态**。
 *
 * ⇒ 类型里把这件事写死：两个失败态**语义不同**，调用方必须分别处理
 *   （`switch` 穷尽时少一个分支就编译不过）。
 */
export type ModelSwitchResult =
  /** 换模成功，且审计序号正常。 */
  | { readonly kind: 'switched' }
  /**
   * **已生效**，但审计序号与预测不符。
   *
   * ⚠ 语义关键：这不是「失败」——事件**已经写进账本**、不可撤销。
   * 界面必须提示「已生效、序号异常」，并**明确劝止重试**（重试会写第二条）。
   */
  | { readonly kind: 'applied-with-anomaly'; readonly detail: string; readonly sequence?: number }
  /** **未生效**，可以安全重试。 */
  | { readonly kind: 'failed'; readonly detail: string }

/**
 * 换模：POST 到宿主。
 *
 * 与 `load` 同样地，路由不在就是 404 ⇒ 返回可读原因（而不是抛）。
 *
 * ⚠ 判成败必须**读到业务层字段**（`ok`），不能只看 `response.ok`：
 *   HTTP 200 只说明**通道**成功。见 `ModelSwitchResult` 的说明。
 */
export async function requestModelSwitch(
  memberId: string,
  provider: string,
  model: string,
  fetcher: typeof fetch = fetch,
): Promise<ModelSwitchResult> {
  try {
    const response = await fetcher(MODEL_SWITCH_ROUTE, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      // 与 `load` 同口径：凭据走共享 `REQUEST_CREDENTIALS`（'include' —— 真实
      // DSH 会过 connection 身份门；旧说法「同源回环不需要凭据」已被 401 实测
      // 证伪，见该常量的说明。OCR [12]：这里不再复述被证伪的旧口径）。
      credentials: REQUEST_CREDENTIALS,
      body: JSON.stringify({ memberId, provider, model, reason: MODEL_SWITCH_REASON }),
    })
    // HTTP 层失败：**未生效**（宿主没有回 200 ⇒ 那条 `sequence-mismatch` 分支没走到）。
    if (!response.ok) {
      return { kind: 'failed', detail: httpFailure(response.status, response.statusText, MODEL_SWITCH_ROUTE) }
    }
    // ⚠ HTTP 通了 ≠ 业务成功：必须读 body 的业务标记。
    const payload: unknown = await response.json().catch(() => null)
    // ⚠ OCR HIGH [第四轮]：2xx 但 body 解析不了 —— **不能**按「未生效/可重试」
    //   处理（旧注释写着「宁可让用户重试一次」，那是错的）：宿主的
    //   `sequence-mismatch` 分支就是 **200 + ok:false（已写入、不可重试）**，
    //   读不到 sequence 时若回 `failed`，UI 会劝重试 ⇒ **写第二条换模事件**
    //   （正是宿主用 200 而非 5xx 要防的事）。无法证明未写入 ⇒ 按已写入的
    //   异常态上报（与下分支同 kind，走「请勿重试」文案）。
    if (payload === null) {
      return {
        kind: 'applied-with-anomaly',
        detail: '换模响应无法解析（HTTP 2xx）——无法确认是否已写入，按已写入处理（请勿重试）',
      }
    }
    const businessOk = typeof payload === 'object' && payload !== null
      ? (payload as { ok?: unknown }).ok
      : undefined
    // ⚠ `ok` **必须显式是 `true`** 才算成功：缺失 / 非布尔 / `false` 都不算
    //   （与 `view-model.ts` 的 `ok` 判据同口径，避免「真值即成功」）。
    if (businessOk === true) return { kind: 'switched' }
    // 走到这里 = 200 但业务层报 `ok:false`。**读串里的区分标记**：
    //   宿主对 `sequence-mismatch` **额外**带了 `sequence`/`predicted`
    //   （见 `host.ts`），那是「已生效」的显式标记；其余 200+ok:false
    //   视作未生效。
    const record = (typeof payload === 'object' && payload !== null)
      ? payload as { sequence?: unknown; predicted?: unknown; error?: unknown }
      : {}
    if (typeof record.sequence === 'number') {
      return {
        kind: 'applied-with-anomaly',
        detail: typeof record.error === 'string' && record.error !== ''
          ? record.error
          : '换模已写入账本，但审计序号与预测不符',
        sequence: record.sequence,
      }
    }
    return {
      kind: 'failed',
      detail: typeof record.error === 'string' && record.error !== ''
        ? record.error
        : httpFailure(response.status, response.statusText, MODEL_SWITCH_ROUTE),
    }
  } catch (error) {
    // 网络层异常 ⇒ **未生效**（请求没到达 / 没回包），可安全重试。
    return { kind: 'failed', detail: describeError(error) }
  }
}

/** 审批路由（与 `host.ts` 的 `decisionRoute` 同契约）。 */
export const DECISION_ROUTE = '/api/sophia/spawn/decision'

/** 运营入口（文档 4）的路由。 */
export const CHANNEL_ROUTE = '/api/sophia/channel'
export const MEMBER_ROUTE = '/api/sophia/member'
export const LIFECYCLE_ROUTE = '/api/sophia/member/lifecycle'

export type OpResult =
  | { readonly kind: 'done' }
  | { readonly kind: 'failed'; readonly detail: string }

/**
 * 运营类 POST 的统一收口（建频道 / 加成员 / lifecycle）。
 *
 * 判据同 `requestSpawnDecision`：读 body 的 `ok === true`；HTTP 或业务层失败
 * 一律 `failed` 且带可读 detail（原始 detail 只进调用方的 console，不进 DOM）。
 */
async function postOp(route: string, body: Record<string, unknown>, fetcher: typeof fetch): Promise<OpResult> {
  try {
    const response = await fetcher(route, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      credentials: REQUEST_CREDENTIALS,
      body: JSON.stringify(body),
    })
    const payload: unknown = await response.json().catch(() => null)
    const record = (typeof payload === 'object' && payload !== null)
      ? payload as { ok?: unknown; error?: unknown }
      : {}
    if (response.ok && record.ok === true) return { kind: 'done' }
    return {
      kind: 'failed',
      detail: typeof record.error === 'string' && record.error !== ''
        ? record.error
        : httpFailure(response.status, response.statusText, route),
    }
  } catch (error) {
    return { kind: 'failed', detail: describeError(error) }
  }
}

export function requestCreateChannel(teamId: string, title: string, fetcher: typeof fetch = fetch): Promise<OpResult> {
  return postOp(CHANNEL_ROUTE, { teamId, title }, fetcher)
}

export function requestAddMember(teamId: string, position: string, fetcher: typeof fetch = fetch): Promise<OpResult> {
  return postOp(MEMBER_ROUTE, { teamId, position }, fetcher)
}

export function requestLifecycle(memberId: string, action: 'suspend' | 'resume', fetcher: typeof fetch = fetch): Promise<OpResult> {
  return postOp(LIFECYCLE_ROUTE, { memberId, action }, fetcher)
}

export type SpawnDecisionResult =
  | { readonly kind: 'decided' }
  | { readonly kind: 'failed'; readonly detail: string }

/**
 * 提交人类审批决定（两级审批的第二级：批准 / 否决）。
 *
 * ⚠ 判成败读 body 的业务标记 `ok === true`（与 `requestModelSwitch` 同口径）：
 *   HTTP 200 只说明通道成功；本路由 200 且 `ok:true` 才是「决定已落账」。
 *   404（票不存在）/ 409（仍在等待或结论冲突）走 `failed`，界面不谎报成功。
 * 否决理由 v1 不带输入框：宿主侧对缺失理由有默认文案（`（否决时未填写理由）`），
 * UI 的否决是**一键否决**；要带理由时给本函数补第三个参数即可（body 契约已支持 `reason`）。
 */
export async function requestSpawnDecision(
  requestId: string,
  decision: 'approve' | 'reject',
  fetcher: typeof fetch = fetch,
): Promise<SpawnDecisionResult> {
  try {
    const response = await fetcher(DECISION_ROUTE, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      credentials: REQUEST_CREDENTIALS,
      body: JSON.stringify({ requestId, decision }),
    })
    // OCR [第四轮]：先读 body 再定成败 —— `!response.ok` 短路会丢掉宿主的
    // 业务 error（409「票据仍在等待人类结论（…）」/404「票据不存在」），
    // 把唯一可读的诊断通道换成裸 HTTP 文案（与 postOp 的口径对齐）。
    const payload: unknown = await response.json().catch(() => null)
    const record = (typeof payload === 'object' && payload !== null)
      ? payload as { ok?: unknown; error?: unknown }
      : {}
    if (response.ok && record.ok === true) return { kind: 'decided' }
    return {
      kind: 'failed',
      detail: typeof record.error === 'string' && record.error !== ''
        ? record.error
        : httpFailure(response.status, response.statusText, DECISION_ROUTE),
    }
  } catch (error) {
    return { kind: 'failed', detail: describeError(error) }
  }
}
