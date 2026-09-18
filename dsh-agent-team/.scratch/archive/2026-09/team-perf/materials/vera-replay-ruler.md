# 重放尺子 —— Thread 打开耗时与 invariant 重放成本的可复跑测量

**用途**：跨 build、跨日期判定「打开 Thread 的 Host 侧成本」和「invariant 全量重放的代价」有没有被改动影响，
并用来证伪「把校验摘掉」式的假修复。输入是一份冻结账本，所以不同时间的数字可比。

**为什么需要它（踩过的坑）**：直接驱动 `AgentTeamLedger` 的裸探针把 `readThread` 量到 0.06 ms —— 因为真开销
不在投影里，而在 `ctx.emit('agent-team/committed')` 挂着的 invariant 监听器里（每次提交把整个账本重放一遍）。
**不挂真实插件的探针会漏掉 99.9% 的开销。** 本目录的两个 spec 都是按真实装配写的：真 sqlite 后端、
真 storage-domain、真 `AgentTeam` service、真 `@deepseek-ai/dsh-invariants`。

## 一、输入：冻结账本

| 项 | 值 |
| --- | --- |
| 文件名 | `frozen-ledger-11695ops.sqlite.gz` |
| 大小 | gzip 5,722,951 B；解压 56,606,720 B |
| sha256 | `0ec12e31947c1f14400e4124ffca4e53197a52eb42af0b5ab384cbd2da77be13` |
| 冻结时刻 | 2026-09-13 18:39 (+08) |
| 规模 | 11,695 operations；221 threads；主 channel `channel:046dd831-c679-4279-b6aa-7813476cf12e` 有 1,625 条 message；value 合计 38,063,589 B |
| 来源 | `~/.dsh/storages/agent_team.sqlite` 的只读导出（`sqlite3 "file:…?mode=ro"`） |
| 分发 | 仓库外本机副本：`artifacts/team-perf/frozen-ledger-11695ops.sqlite.gz`（`artifacts/` 被 gitignore，5.7 MB 二进制不进 git）；副本被清理后按第二节重建等价输入。 |

两条硬约束：

- **`readThread` 会写库**（它是写操作，会追加 `team/thread-read`），所以每次测量都要**新解一份**，不要在冻结件上重复跑。
- 冻结件只固定输入规模，不代表当前活账本。活账本每天 +304 条 thread-read（≈1.63 MB/天），重建出来的输入数字不能直接与历史比。

## 二、复跑

```bash
# 1) 新解一份冻结账本
mkdir -p /tmp/ruler && gunzip -c frozen-ledger-11695ops.sqlite.gz > /tmp/ruler/frozen.sqlite

# 2) JSONL 导出（latency 探针的输入；只读模式，不碰任何在跑的库）
sqlite3 "file:/tmp/ruler/frozen.sqlite?mode=ro" \
  "select json_object('key',key,'value',value) from u_agent_team_operations;" > /tmp/ruler/at-ops.jsonl

# 3) 在 provisioned clone 里装探针（探针故意不 type-clean；跑完必须删）
#    源码就在本文件末尾的附录里，存成同名文件即可
cp zz-thread-latency.spec.ts zz-thread-open-e2e.spec.ts packages/agent-team/tests/
LEDGER_DUMP=/tmp/ruler/at-ops.jsonl BENCH_ITERS=3 \
  npx vitest run packages/agent-team/tests/zz-thread-latency.spec.ts

# 4) 真装配尺子（另需一份「可写」的 sqlite 副本）
cp /tmp/ruler/frozen.sqlite /tmp/ruler/run-e2e.sqlite
BENCH_DB=/tmp/ruler/run-e2e.sqlite npx vitest run packages/agent-team/tests/zz-thread-open-e2e.spec.ts
```

没有现成 gz 时，从活账本重建等价输入：

```bash
sqlite3 "$HOME/.dsh/storages/agent_team.sqlite" ".backup /tmp/ruler/frozen.sqlite"
```

环境变量：`LEDGER_DUMP`（jsonl 路径）、`BENCH_DB`（sqlite 路径）、`BENCH_ITERS`（每格采样次数）、
`BENCH_WS` / `BENCH_CHANNEL` / `BENCH_THREAD`（默认钉在冻结件里那个 Workspace / channel / thread 上）。

## 三、五个 case

`zz-thread-latency.spec.ts`（5 个 case，均以冻结账本为输入，输出一行 `KEY {json}` 便于抓取）：

| case / 输出前缀 | 量什么 | 判据 |
| --- | --- | --- |
| `THREAD_LATENCY` | Client 打开 Channel / Thread 会走的每条读路径：`view` / `threadHistory` / `threadObservations` / `inbox` / `readThread`（冷开、热读），并给出各请求形状的响应字节拆解 | 读数路径本身的成本，确认瓶颈不在投影里 |
| `INVARIANT_COST` | 同一份账本上：裸 `readThread`、`ledger.validate()` 单次、真实接线的 `ctx.emit('agent-team/committed')` 耗时 | **必须单跑**（`npx vitest run -t 'measures the per-commit invariant validation cost'`）才准：同进程多 case 会被 GC 抬高 |
| `MUTATION_CHECK` | 直调 `validate()`：clean → 篡改一条已存 `team/thread-read` 的 fact → 再验 → 还原 → 再验 | 网必须有红能力：`clean / threw: invalid Thread read projection / clean` |
| `WIRED_DEFERRED` | 挂真 invariant 后的提交路径：突发两次提交，提交调用内跑了几次重放、一个 immediate 后跑了几次 | 提交调用内 0 次（挂载那次除外）+ 突发只合并成 1 次 |
| `WIRED_DRIFT` | 挂真 invariant、**挂载之后**再篡改一条存好的 thread-read：漂移那次提交、下一帧日志、下一次提交、还原之后 | 日志含 `diverged` + 下一次提交抛 `invariant violated` + 还原后一帧内解除 |

`zz-thread-open-e2e.spec.ts`（输出 `ASSEMBLED_THREAD_OPEN`）：真 sqlite + 真 service + 真 invariant，
同一份库跑两遍（invariant off / on），给出 boot、`view(limit:1)`、channel 打开、`readThread`×3。
**这是「打开一个 Thread 到底等多久」的最终口径**，其它探针都只是拆解。

## 四、观测值（同一份冻结件）

修复前 = `5b734ef`（PR #22 之后）；修复后 = `2b8b62b`（延后合并重放）。

| 指标 | 修复前 | 修复后 |
| --- | --- | --- |
| 真装配 `readThread`（invariant **on**） | 850 / 828 / 827 ms；复跑 866 / 813 / 826 ms | **8 / 6 / 5 ms** |
| 真装配 `readThread`（invariant **off**） | 8 / 7 / 7 ms；复跑 8 / 7 / 6 ms | 12 / 7 / 7 ms |
| channel 打开（纯读，不提交） | 0.70 ms（on）/ 1.40 ms（off） | 1.17 ms（on）/ 1.74 ms（off） |
| boot（含启动同步全量重放） | 2370 ms（on）/ 1711 ms（off） | 2461 ms（on）/ 2116 ms（off） |
| `INVARIANT_COST.emitMs`（真实接线的提交） | 587 / 622 ms | **0.1 ms** |
| `INVARIANT_COST.validations`（单次全量重放） | 703 / 776 / 713 ms | 842.6 / 826.2 / 758.9 ms |
| 裸 `readThread`（不挂 invariant） | 0.10 ms | 0.3 ms |

读法：

- **① 响应路径**：`readThread` 从 ~0.83 s 回到个位数 ms。
- **② 网还在**：`MUTATION_CHECK` 修复前后都是 `clean / threw / clean`；`WIRED_DRIFT`（修复后新增）证明
  延后之后的失败面仍然致命：日志 + 下一次提交抛 `invariant violated` + 还原后自愈。
- **③ 全量重放没被摘掉**：`WIRED_DEFERRED` 的提交调用内计数只含挂载那一次；启动 boot 仍 ~2.4 s（同步全量）。
- **残余代价（别粉饰）**：`validations` 仍是 0.76–0.84 s/次——重放没变快，只是**移出响应路径**并且**每批只付一次**。
  100k ops 外推约 7.6 s/批，1M ops 约 76 s/批。压它只能靠瘦记录（B2 那条线），不能靠削弱校验。

## 五、已知限制

- 五个 case 同进程跑时，前面 case 留下的 48 MB dump 与 spy 开销会把绝对值抬高（`WIRED_DEFERRED.deferredMs` 量到 1.59 s，
  干净进程单跑约 0.8 s）。**要下结论就用 `-t` 单跑对应 case**，或只信同一进程内的相对比较。
- 探针故意写得不是 type-clean，**不进 CI**；跑完必须从 `packages/agent-team/tests/` 删除，仓库里不留。
- `THREAD_LATENCY` 的冷开样本数受冻结件里可用的 thread 数限制，`skipped` 字段记录本轮跳过数。
- 浏览器的端到端体感（含 Client 渲染）没有被这份尺子覆盖：要量「用户在页面上等多久」还得另做 invariant on/off 的 browser 差分。

## 附录：探针源码

### A. `zz-thread-latency.spec.ts`
```ts
/**
 * Vera's follow-up probe for the Human's post-merge report:
 * "Channel switching is fast, but entering threads still has clearly
 *  perceptible load time."
 *
 * Unlike zz-perf-bench.spec.ts (synthetic ledger), this probe replays the
 * REAL ledger (11,663 operations dumped from ~/.dsh/storages/agent_team.sqlite,
 * read-only copy) so the measurement carries the real thread/message/marker
 * distribution — 221 threads, one channel with 1,625 messages.
 *
 * It times every Remote read path the Client uses when a Human opens a
 * Channel or a Thread, and records the response payload size of each call.
 *
 * Run from a provisioned clone:
 *   LEDGER_DUMP=/tmp/at-ops.jsonl BENCH_ITERS=15 npx vitest run \
 *     packages/agent-team/tests/zz-thread-latency.spec.ts
 *
 * THROWAWAY probe: copy in, run, delete. Not type-clean on purpose.
 */
import { readFileSync } from 'node:fs'
import { describe, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { AgentTeamLedger, agentTeamHumanActor } from '../src/ledger.ts'
import * as agentTeamInvariant from '../src/invariant.ts'

const DUMP = process.env.LEDGER_DUMP ?? '/tmp/at-ops.jsonl'
const WS = process.env.BENCH_WS ?? '40459c33-743d-4030-9e50-9419d72abe06'
const MAIN_CHANNEL = process.env.BENCH_CHANNEL ?? 'channel:046dd831-c679-4279-b6aa-7813476cf12e'
const THREAD = process.env.BENCH_THREAD ?? 'thread:a303aabc-70f7-40a2-9828-17edfd047a19'
const ITERS = Number(process.env.BENCH_ITERS ?? 15)

function load(): Array<[string, any]> {
  return readFileSync(DUMP, 'utf8').trim().split('\n').map(line => {
    const row = JSON.parse(line) as { key: string, value: string }
    return [row.key, JSON.parse(row.value)] as [string, any]
  })
}

/** Minimal KvTable over a Map; `put` is deliberately instant so the samples
 * isolate projection compute from durable-write cost. */
function shimTable(rows: Array<[string, any]>): { table: any, puts: () => number } {
  const map = new Map<string, any>(rows)
  let puts = 0
  const table: any = {
    get: (key: string) => map.get(key),
    entries: () => map.entries(),
    keys: () => map.keys(),
    get size() { return map.size },
    put: async (key: string, value: any) => { puts += 1; map.set(key, value) },
    delete: async (key: string) => map.delete(key),
    update: async (key: string, fn: (current: any) => any) => {
      const next = fn(map.get(key)); map.set(key, next); return next
    },
  }
  return { table, puts: () => puts }
}

const quantile = (sorted: number[], q: number): number =>
  Number(sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * q)))]!.toFixed(3))

function payloadBytes(result: any): number {
  const value = result?.value ?? result
  try { return JSON.stringify(value).length } catch { return -1 }
}

function sampleSync(fn: () => unknown, iterations: number): Record<string, number> {
  const taken: number[] = []
  let bytes = 0
  for (let index = 0; index < iterations; index += 1) {
    const start = performance.now()
    const result = fn()
    taken.push(performance.now() - start)
    bytes = Math.max(bytes, payloadBytes(result))
  }
  taken.sort((left, right) => left - right)
  return { min: quantile(taken, 0), median: quantile(taken, 0.5), p90: quantile(taken, 0.9), bytes }
}

async function sampleAsync(fn: () => Promise<unknown>, iterations: number): Promise<Record<string, number>> {
  const taken: number[] = []
  let bytes = 0
  for (let index = 0; index < iterations; index += 1) {
    const start = performance.now()
    const result = await fn()
    taken.push(performance.now() - start)
    bytes = Math.max(bytes, payloadBytes(result))
  }
  taken.sort((left, right) => left - right)
  return { min: quantile(taken, 0), median: quantile(taken, 0.5), p90: quantile(taken, 0.9), bytes }
}

describe('real-ledger thread entry latency', () => {
  it('times every Client read path on the real ledger', async () => {
    const rows = load()
    const { table, puts } = shimTable(rows)

    const replayStart = performance.now()
    const ledger: any = new AgentTeamLedger(table)
    const replayMs = Number((performance.now() - replayStart).toFixed(1))

    const human = agentTeamHumanActor()

    // Distinct threads for cold opens, and one already-read thread for warm reads.
    const coldThreads: string[] = []
    for (const [, operation] of rows) {
      if (operation.kind !== 'team/message-sent' || operation.data?.workspaceId !== WS) continue
      const threadRef = operation.data?.thread?.threadRef
      if (typeof threadRef === 'string' && !coldThreads.includes(threadRef)) coldThreads.push(threadRef)
    }

    const results: Record<string, Record<string, number>> = {}
    results['view(limit:1)'] = sampleSync(() => ledger.view({ workspaceId: WS, limit: 1 }), ITERS)
    results['view(channel,topLevelOnly,limit:20)'] = sampleSync(
      () => ledger.view({ workspaceId: WS, channelRef: MAIN_CHANNEL, topLevelOnly: true, limit: 20 }), ITERS)
    results['view(channel,limit:20)'] = sampleSync(
      () => ledger.view({ workspaceId: WS, channelRef: MAIN_CHANNEL, limit: 20 }), ITERS)
    results['threadHistory(limit:20)'] = sampleSync(
      () => ledger.threadHistory(human, { workspaceId: WS, threadRef: THREAD, limit: 20 }), ITERS)
    results['threadObservations()'] = sampleSync(
      () => ledger.threadObservations(human, { workspaceId: WS, threadRef: THREAD }), ITERS)
    results['inbox(directOnly,limit:1)'] = sampleSync(
      () => ledger.inbox(human, { workspaceId: WS, directOnly: true, limit: 1 }), ITERS)

    // Warm re-reads of one thread the Human has already read.
    await ledger.readThread({ requestId: 'warmup', actor: human, workspaceId: WS, threadRef: THREAD })
    let warmIndex = 0
    results['readThread(warm,already-read)'] = await sampleAsync(
      () => ledger.readThread({ requestId: `warm-${warmIndex++}`, actor: human, workspaceId: WS, threadRef: THREAD }), ITERS)

    // Cold opens: one distinct thread per sample, exactly what a Human click does.
    const coldSamples: number[] = []
    const coldBytes: number[] = []
    let skipped = 0
    let index = 0
    while (coldSamples.length < Math.min(ITERS, coldThreads.length) && index < coldThreads.length) {
      const threadRef = coldThreads[index]!
      index += 1
      try {
        const start = performance.now()
        const result = await ledger.readThread({ requestId: `cold-${index}`, actor: human, workspaceId: WS, threadRef })
        coldSamples.push(performance.now() - start)
        coldBytes.push(payloadBytes(result))
      } catch { skipped += 1 }
    }
    const sortedCold = [...coldSamples].sort((left, right) => left - right)
    results['readThread(cold,first-open)'] = {
      min: quantile(sortedCold, 0), median: quantile(sortedCold, 0.5), p90: quantile(sortedCold, 0.9),
      bytes: Math.max(...coldBytes),
    }

    // The exact request shapes the Client issues on each navigation, plus a
    // per-field byte breakdown so the payload composition is visible.
    const shapes: Record<string, unknown> = {
      'SIDEBAR view(workspace,limit:1)': { workspaceId: WS, limit: 1 },
      'CHANNEL view(channel,before,topLevelOnly,limit:20)': { workspaceId: WS, channelRef: MAIN_CHANNEL, direction: 'before', topLevelOnly: true, includeActivities: false, limit: 20 },
      'THREAD supplemental view(channel,thread,limit:1)': { workspaceId: WS, channelRef: MAIN_CHANNEL, threadRef: THREAD, includeActivities: false, limit: 1 },
      'THREAD history(limit:20)': { workspaceId: WS, threadRef: THREAD, limit: 20 },
    }
    const breakdown: Record<string, Record<string, number>> = {}
    for (const [name, request] of Object.entries(shapes)) {
      const result: any = name.startsWith('THREAD history')
        ? ledger.threadHistory(human, request as never)
        : ledger.view(request as never)
      const value = result?.value ?? result
      const fields: Record<string, number> = {}
      if (value !== null && typeof value === 'object') {
        for (const [key, field] of Object.entries(value)) fields[key] = JSON.stringify(field).length
      }
      fields['__total'] = JSON.stringify(value).length
      breakdown[name] = fields
    }

    console.log('THREAD_LATENCY ' + JSON.stringify({
      ledger: { operations: rows.length, replayMs, puts: puts(), threads: coldThreads.length, skipped },
      results,
      breakdown,
      perSampleColdMs: coldSamples.map(value => Number(value.toFixed(2))),
      perSampleColdBytes: coldBytes,
    }))
  }, 600_000)

  /**
   * The invariant companion registers `ctx.on('agent-team/committed', validateLedger)`
   * and `validateLedger()` runs `AgentTeamLedger.validate()` — the same full
   * replay as construction. `readThread` commits, so this measures what one
   * Thread open actually costs with the shipped plugin wiring in place.
   */
  it('measures the per-commit invariant validation cost', async () => {
    const rows = load()
    const { table } = shimTable(rows)
    const ledger: any = new AgentTeamLedger(table)
    const human = agentTeamHumanActor()
    const read = (requestId: string): Promise<unknown> =>
      ledger.readThread({ requestId, actor: human, workspaceId: WS, threadRef: THREAD })

    await read('warmup')

    const bareStart = performance.now()
    await read('bare')
    const readMs = Number((performance.now() - bareStart).toFixed(1))

    const validations: number[] = []
    for (let index = 0; index < 3; index += 1) {
      const start = performance.now()
      ledger.validate()
      validations.push(Number((performance.now() - start).toFixed(1)))
    }

    // The shipped wiring: emit -> invariant listener -> validateLedger -> validate().
    const ctx: any = new Context()
    await ctx.plugin(InvariantRegistry)
    ctx.provide('agentTeam', { validateLedger: () => ledger.validate() })
    await ctx.plugin(agentTeamInvariant)
    const emitStart = performance.now()
    ctx.emit('agent-team/committed', { receipt: { operationId: 'probe' } })
    const emitMs = Number((performance.now() - emitStart).toFixed(1))

    const wiredStart = performance.now()
    await read('wired')
    const wiredReadMs = Number((performance.now() - wiredStart).toFixed(1))
    const wiredStart2 = performance.now()
    ctx.emit('agent-team/committed', { receipt: { operationId: 'probe-2' } })
    const wiredTotalMs = Number((performance.now() - wiredStart2).toFixed(1))

    console.log('INVARIANT_COST ' + JSON.stringify({
      operations: rows.length, readMs, validations, emitMs, wiredReadMs, wiredTotalMs,
    }))
    await ctx.stop?.()
  }, 600_000)

  /**
   * Red-capability check for the net itself: the invariant must still go red
   * when a stored record stops matching its derivation. Without this, a
   * "keep the check but move it off the hot path" fix could silently neuter it.
   */
  it('confirms the ledger validation still trips on a tampered record', () => {
    const rows = load()
    const { table } = shimTable(rows)
    const ledger: any = new AgentTeamLedger(table)

    const verdict = (): string => {
      try { ledger.validate(); return 'clean' } catch (error) { return `threw: ${String(error).slice(0, 140)}` }
    }

    const baseline = verdict()

    // Drop the last fact from one stored team/thread-read snapshot: the
    // derivation still produces the full list, so a working net must reject it.
    const target = rows.find(([, operation]) =>
      operation.kind === 'team/thread-read' && (operation.data?.facts?.length ?? 0) > 1)
    if (target === undefined) throw new Error('no tamperable thread-read record found')
    const [key, operation] = target
    const original = operation.data.facts
    operation.data.facts = original.slice(0, original.length - 1)
    const tampered = verdict()
    operation.data.facts = original
    const restored = verdict()

    console.log('MUTATION_CHECK ' + JSON.stringify({
      key, factCount: original.length, baseline, tampered, restored,
    }))
  }, 600_000)
  /**
   * Residual-cost evidence plus the "net still runs" half of leg #3, on the
   * REAL ledger: one burst must still pay exactly one full replay — just after
   * the response turn instead of inside it.
   */
  it('runs the deferred replay off the commit call but still runs it', async () => {
    const rows = load()
    const { table } = shimTable(rows)
    const ledger: any = new AgentTeamLedger(table)
    const ctx: any = new Context()
    await ctx.plugin(InvariantRegistry)
    const validate = vi.spyOn(ledger, 'validate')
    ctx.provide('agentTeam', { validateLedger: () => ledger.validate() })
    await ctx.plugin(agentTeamInvariant)

    const emitStart = performance.now()
    ctx.emit('agent-team/committed', { receipt: { operationId: 'deferred-1' } })
    ctx.emit('agent-team/committed', { receipt: { operationId: 'deferred-2' } })
    const emitMs = Number((performance.now() - emitStart).toFixed(2))
    const callsInCommit = validate.mock.calls.length

    const settleStart = performance.now()
    await new Promise(resolve => setImmediate(resolve))
    const deferredMs = Number((performance.now() - settleStart).toFixed(1))

    console.log('WIRED_DEFERRED ' + JSON.stringify({
      operations: rows.length, emitMs, callsInCommit, deferredMs, callsAfterSettle: validate.mock.calls.length,
    }))
    validate.mockRestore()
    await ctx.stop?.()
  }, 600_000)

  /**
   * Leg #2 on the WIRED path with the real ledger: the deferred net must still
   * go red on durable drift, now as the latched failure on the next commit, and
   * it must release again once a replay comes back clean.
   */
  it('latches the wired commit path on a tampered durable record and releases it', async () => {
    const rows = load()
    const { table } = shimTable(rows)
    const ledger: any = new AgentTeamLedger(table)
    const ctx: any = new Context()
    await ctx.plugin(InvariantRegistry)
    ctx.provide('agentTeam', { validateLedger: () => ledger.validate() })
    const logged: string[] = []
    vi.spyOn(ctx.logger, 'error').mockImplementation((...args: unknown[]) => { logged.push(args.map(value => String(value)).join(' ')) })
    await ctx.plugin(agentTeamInvariant)

    // Tamper AFTER mount: durable records stop matching their derivation while
    // the in-memory projection is untouched.
    const target = rows.find(([, operation]) =>
      operation.kind === 'team/thread-read' && (operation.data?.facts?.length ?? 0) > 1)
    if (target === undefined) throw new Error('no tamperable thread-read record found')
    const [key, operation] = target
    const original = operation.data.facts
    operation.data.facts = original.slice(0, original.length - 1)

    const emit = (operationId: string): { ms: number, threw?: string } => {
      const start = performance.now()
      try {
        ctx.emit('agent-team/committed', { receipt: { operationId } })
        return { ms: Number((performance.now() - start).toFixed(2)) }
      } catch (error) {
        return { ms: Number((performance.now() - start).toFixed(2)), threw: String(error).slice(0, 160) }
      }
    }
    const settle = (): Promise<void> => new Promise(resolve => setImmediate(resolve))

    const drifting = emit('drift-1')
    await settle()
    const next = emit('drift-2')

    operation.data.facts = original
    try { ctx.emit('agent-team/committed', { receipt: { operationId: 'drift-3' } }) } catch { /* still latched */ }
    await settle()
    const recovered = emit('drift-4')

    console.log('WIRED_DRIFT ' + JSON.stringify({
      key, factCount: original.length, logged: logged.slice(0, 2), drifting, next, recovered,
    }))
    await ctx.stop?.()
  }, 600_000)
})
```

### B. `zz-thread-open-e2e.spec.ts`

```ts
/**
 * Vera's assembled-path probe: one Human Thread open through the REAL service
 * wiring — sqlite storage backend on a copy of the live ledger, the AgentTeam
 * service, and (optionally) the shipped invariant companion — so the measured
 * number is the Host-side cost the Web Client actually waits for.
 *
 * Run from a provisioned clone:
 *   BENCH_DB=/tmp/bench-storages/agent_team.sqlite npx vitest run \
 *     packages/agent-team/tests/zz-thread-open-e2e.spec.ts
 *
 * THROWAWAY probe: copy in, run, delete. Not type-clean on purpose.
 */
import { describe, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import Storage from '@deepseek-ai/dsh-storage'
import { SqliteStorageBackend } from '@deepseek-ai/dsh-storage-sqlite'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { SessionId } from '@deepseek-ai/dsh-session'
import AgentTeam from '../src/index.ts'
import * as agentTeamInvariant from '../src/invariant.ts'

const DB = process.env.BENCH_DB ?? '/tmp/bench-storages/agent_team.sqlite'
const WS = WorkspaceId(process.env.BENCH_WS ?? '40459c33-743d-4030-9e50-9419d72abe06')
const THREAD = process.env.BENCH_THREAD ?? 'thread:a303aabc-70f7-40a2-9828-17edfd047a19'
const CHANNEL = process.env.BENCH_CHANNEL ?? 'channel:046dd831-c679-4279-b6aa-7813476cf12e'

async function boot(withInvariant: boolean): Promise<{ ctx: any, dispose: () => Promise<void> }> {
  const ctx: any = new Context()
  await ctx.plugin(Storage)
  const backend = new SqliteStorageBackend({ path: DB, journalMode: 'wal' })
  ctx.storage.backend.register('sqlite', backend)
  const facility = new DomainFacility(ctx, { backend: 'sqlite', routes: { agent_team: 'sqlite' } })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  ctx.provide('workspaceRegistry', {
    get: (id: WorkspaceId) => id === WS
      ? { id, path: process.cwd(), attachSession: async () => {}, archiveSession: async () => {} }
      : undefined,
    list: () => [{ id: WS, path: process.cwd() }],
  })
  ctx.provide('agents', {
    create: async () => { throw new Error('unused') },
    resume: async () => { throw new Error('unused') },
    list: () => [],
  })
  ctx.provide('agentDefaultModel', { currentSelection: () => ({ provider: 'mock', model: 'mock' }) })
  ctx.provide('agentPresets', { mount: async () => { throw new Error('unused') } })
  ctx.provide('tools', { schemas: () => [] })
  ctx.provide('sessionPersistence', { list: async () => [] })
  if (withInvariant) await ctx.plugin(InvariantRegistry)
  const fiber = await ctx.plugin(AgentTeam)
  if (withInvariant) await ctx.plugin(agentTeamInvariant)
  return {
    ctx,
    dispose: async () => { await fiber.dispose(); await facility.closeAll?.(); await ctx.stop?.() },
  }
}

describe('assembled Thread open cost', () => {
  it('measures one readThread through the real service, with and without the invariant', async () => {
    const rows: Record<string, unknown> = {}

    for (const withInvariant of [false, true]) {
      const label = withInvariant ? 'invariant-on' : 'invariant-off'
      const bootStart = performance.now()
      const { ctx, dispose } = await boot(withInvariant)
      const bootMs = Number((performance.now() - bootStart).toFixed(0))
      const service: any = ctx.agentTeam

      // One read-only call for reference (no commit, no validation).
      const viewStart = performance.now()
      service.view({ workspaceId: WS, limit: 1 })
      const viewMs = Number((performance.now() - viewStart).toFixed(2))

      const reads: number[] = []
      for (let index = 0; index < 3; index += 1) {
        const start = performance.now()
        await service.readThread({ requestId: `e2e-${label}-${index}`, workspaceId: WS, threadRef: THREAD })
        reads.push(Number((performance.now() - start).toFixed(0)))
      }

      // A Channel open for comparison: read-only, no commit.
      const channelStart = performance.now()
      service.view({ workspaceId: WS, channelRef: CHANNEL, direction: 'before', topLevelOnly: true, includeActivities: false, limit: 20 })
      const channelMs = Number((performance.now() - channelStart).toFixed(2))

      rows[label] = { bootMs, viewMs, channelMs, reads }
      await dispose()
    }

    console.log('ASSEMBLED_THREAD_OPEN ' + JSON.stringify({ db: DB, workspace: WS, thread: THREAD, rows }))
  }, 900_000)
})
```
