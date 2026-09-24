/**
 * 宿主侧工具注册适配层（`t1` 装配）。
 *
 * ## 这个 spec 的核心证据是什么
 *
 * 它不是「我自己写的桩能过」—— 那是**自证**。真正的证据是：
 * **把 `t4` 的描述符喂给宿主真机上跑着的那个 `defineTool`**，
 * 再断言「注册表里确实出现了这 5 个名字」。
 *
 * `defineTool` 来自本机 DSH 运行期安装（`~/.dsh/profiles/node_modules/...`），
 * 是**第三方**实现；它对 schema 形状的校验发生在**构造期**，形状写错会当场抛。
 * 所以这个 spec 能抓到「我的转接形状与真实 SDK 不符」这类错 —— 而纯桩测试抓不到。
 *
 * ## ⚠ 前提必须写明（否则这个绿是可被误读的）
 *
 * 本 spec **依赖本机 DSH SDK 在场**。不在场时它**响亮失败**（`expect.fail` 带路径），
 * 而不是静默跳过 —— 静默跳过会让「全绿」在 SDK 缺失的机器上照样成立，
 * 那就变成了一条**恒真的断言**（本仓纪律：从未红过的断言与没有断言等价）。
 * 实测在场路径见下方 `SDK_CANDIDATES`；本机命中
 * `C:\Users\Administrator\.dsh\profiles\node_modules\@deepseek-ai\dsh-tools\lib\index.js`。
 *
 * ## 跨目录引用为什么用「计算出的 specifier」
 *
 * 本仓实测过三种写法在 `tsc` 下的结果（`tests/shell.spec.ts` 的文件头记着那张对照表）：
 * 静态 `import` ✗ / **字面量**动态 `import('../lib/x.js')` ✗（`tsc` 照样解析它）/
 * **计算出的** specifier ✓。所以这里用 `pathToFileURL(...).href` —— 类型检查看不到那个裸包名，
 * 与 SPEC §1.1 的实测结论一致。
 */

import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it, beforeAll } from 'vitest'

import {
  asDefineTool,
  asToolsRegistry,
  registerSophiaTools,
  toDefineToolOptions,
} from '../src/host-tools.ts'
import { SOPHIA_TOOL_NAMES } from '../src/tools/index.ts'
import type { SophiaToolDescriptor, SophiaToolsDeps } from '../src/tools/index.ts'
import type { MemberId, TeamId } from '../src/types/ids.ts'
import type { SophiaDefineToolOptions } from '../src/host-tools.ts'

// ────────────────────────────────────────────────────────────────────────────
// 真实 defineTool 的定位
// ────────────────────────────────────────────────────────────────────────────

/** 本机 SDK 安装位置候选（新的 profiles 安装优先，其次 core 解包目录）。 */
function sdkCandidates(): readonly string[] {
  const dshHome = process.env['DSH_HOME'] ?? join(homedir(), '.dsh')
  const explicit = process.env['DSH_TOOLS_PATH']
  return [
    ...(typeof explicit === 'string' && explicit !== '' ? [explicit] : []),
    join(dshHome, 'profiles', 'node_modules', '@deepseek-ai', 'dsh-tools', 'lib', 'index.js'),
    join(dshHome, 'core-0.1.5-rc.1', '@deepseek-ai', 'dsh-tools', 'lib', 'index.js'),
  ]
}

/**
 * 真实的 `defineTool`（连同它被解析到的路径，用于在失败信息里指出前提）。
 *
 * 形参声明成 `unknown`：本 spec 有意把**多种形状**喂进去（正确转接的、缺 `output` 的、
 * 用占位 schema 的），若写死成某个具体形状，那些「反证用例」会在**编译期**就被拒，
 * 而它们要证明的恰恰是**运行期**的真实 SDK 会抛。
 */
interface RealDefineTool {
  readonly defineTool: (options: unknown) => unknown
  readonly path: string
}

let real: RealDefineTool | undefined

beforeAll(async () => {
  for (const candidate of sdkCandidates()) {
    if (!existsSync(candidate)) continue
    const mod = (await import(pathToFileURL(candidate).href)) as Record<string, unknown>
    const defineTool = mod['defineTool']
    if (typeof defineTool === 'function') {
      real = { defineTool: defineTool as (options: unknown) => unknown, path: candidate }
      return
    }
  }
})

/**
 * 取真实 `defineTool`；取不到就**响亮失败**并说明前提。
 *
 * 为什么不用本地桩顶替：那样这个 spec 就退化成「我的桩接受我的形状」，
 * 而它要证明的恰恰是「**真实 SDK** 接受我的形状」。
 */
function requireReal(): RealDefineTool {
  if (real === undefined) {
    expect.fail(
      `找不到本机 DSH SDK 的 dsh-tools（试过 ${sdkCandidates().length} 条候选路径）。`
        + '本 spec 的前提是「本机装过 DSH」，这是它唯一能证明「转接形状与真实 SDK 相符」的方式；'
        + '不在此处静默降级为自建桩，那会让断言失去意义。'
        + `候选：${sdkCandidates().join(' | ')}`,
    )
  }
  return real
}

// ────────────────────────────────────────────────────────────────────────────
// 测试用注册表（语义照 dsh-tools：重名抛错、返回 disposer）
// ────────────────────────────────────────────────────────────────────────────

/**
 * 一个**忠实**的注册表替身。
 *
 * 为什么不是 `() => {}` 那种空桩：空桩会把「重名覆盖」这种缺陷放过去，
 * 而真实 `tools` 服务对重名/保留名是**抛错**的（`dsh-tools/lib/index.js` 里
 * `name === 'run_code'` 直接 throw）。替身要能红，才配当判据。
 */
function makeRegistry(throwOn?: string): {
  readonly registered: Map<string, Record<string, unknown>>
  readonly calls: number
  readonly register: (definition: never) => () => void
} {
  const registered = new Map<string, Record<string, unknown>>()
  let calls = 0
  return {
    registered,
    get calls(): number {
      return calls
    },
    register(definition: never): () => void {
      calls += 1
      const def = definition as unknown as Record<string, unknown>
      const name = String(def['name'])
      if (name === throwOn) throw new Error(`测试替身：拒绝注册 ${name}`)
      if (registered.has(name)) throw new Error(`duplicate tool name: ${name}`)
      registered.set(name, def)
      return () => registered.delete(name)
    },
  }
}

/** 只为「拿描述符」而造的最小依赖：本 spec 不执行工具，执行面由 `tests/tools.spec.ts` 覆盖。 */
function stubDeps(): SophiaToolsDeps {
  const notUsed = (what: string) => () => {
    throw new Error(`本 spec 不应触达 ${what}`)
  }
  return {
    caller: {
      // brand 类型用 `as` 造（与本仓其他 spec 的约定一致，如 `tests/tools.spec.ts` 的 `self`）。
      memberId: 'sophia-xing-yi-zhu-shi-0000000a' as MemberId,
      teamId: 'team-0001' as TeamId,
    },
    ledger: {} as never,
    runtime: {} as never,
    projection: {
      callerKindOf: notUsed('callerKindOf'),
      modelOf: notUsed('modelOf'),
      lifecycleOf: notUsed('lifecycleOf'),
      teamOf: notUsed('teamOf'),
      unreadOf: notUsed('unreadOf'),
      resolveMemberRef: notUsed('resolveMemberRef'),
      threadOf: notUsed('threadOf'),
      channelTeamOf: notUsed('channelTeamOf'),
      dag: {
        ownerOf: notUsed('ownerOf'),
        taskStateOf: notUsed('taskStateOf'),
        unfinishedDependenciesOf: notUsed('unfinishedDependenciesOf'),
      },
    } as never,
    delegation: {} as never,
    now: () => 1_700_000_000_000,
  }
}

// ────────────────────────────────────────────────────────────────────────────
// 1. 转接形状（对真实 defineTool 的契约）
// ────────────────────────────────────────────────────────────────────────────

describe('toDefineToolOptions：把 t4 的描述符翻成 defineTool 的入参', () => {
  it('★ 真实 defineTool 接受转接结果，并把裸 map 编译成 object 根（回归：障碍 2）', () => {
    const { defineTool } = requireReal()
    // 显式标注成 `SophiaToolDescriptor`：让编译器按**真实契约**校验这个字面量，
    // 而不是让它自己推宽（`type: 'string'` 会被推成 `string` ⇒ 与描述符不兼容）。
    const descriptor: SophiaToolDescriptor = {
      name: 'sophia_switch_model',
      description: '切换成员模型',
      parameters: {
        provider: { type: 'string', required: true, description: 'provider' },
        model: { type: 'string', required: true, description: 'model' },
      },
      outputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { type: 'string', required: true, description: '结果分支' },
          ok: { type: 'boolean', description: 'ok' },
        },
      },
      render: () => [{ type: 'text', text: 'ok' }],
      run: async () => ({ ok: true }),
    }

    // 不抛 ⇒ 形状被真实 SDK 接受（不抛是必要证据，但**不够**，所以下一条断言结构化事实）。
    const tool = defineTool(toDefineToolOptions(descriptor)) as Record<string, unknown>

    // ★ 结构化事实：defineTool 真的把裸 map **编译** 成了 object 根 schema。
    const parameters = tool['parameters'] as Record<string, unknown>
    expect(parameters['type']).toBe('object')
    expect(Object.keys(parameters['properties'] as object).sort()).toEqual(['model', 'provider'])
    expect(parameters['required']).toEqual(['provider', 'model'])

    // ★ output 存在且带 schema —— 这正是障碍 2 里 `register()` 的硬要求。
    const output = tool['output'] as Record<string, unknown>
    expect(typeof output['render']).toBe('function')
    expect(output['schema']).toBeDefined()
    // ★ output schema 也真的被编译了（`additionalProperties:false` 保留 ⇒ 判别联合的封闭面没丢）。
    const outputSchema = output['schema'] as Record<string, unknown>
    expect(outputSchema['type']).toBe('object')
    expect(outputSchema['additionalProperties']).toBe(false)
  })

  it('★ 反证：只给 render、不给 output 的形状会炸 —— 证明这条转接不是空转', () => {
    const { defineTool } = requireReal()
    expect(() =>
      defineTool({
        name: 'sophia_probe_no_output',
        description: 'probe',
        parameters: { provider: { type: 'string', required: true, description: 'p' } },
        render: () => '',
        execute: async () => ({}),
      }),
    ).toThrow()
  })

  it('parameters / outputSchema / render 三者原样透传（编译只发生一处）', () => {
    const descriptor: SophiaToolDescriptor = {
      name: 'sophia_task_claim',
      description: 'd',
      parameters: {
        teamId: { type: 'string', required: true, description: '团' },
        nested: {
          type: 'object',
          required: false,
          description: '嵌套',
          properties: { x: { type: 'boolean', required: true, description: 'x' } },
          additionalProperties: false,
        },
      },
      outputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: { kind: { type: 'string', required: true, description: 'k' } },
      },
      render: () => [{ type: 'text', text: 'x' }],
      run: async () => ({}),
    }
    const options = toDefineToolOptions(descriptor)
    // 同一性（不是深拷贝、不是改写）—— 否则「模型看到的参数/输出」会有第二份实现。
    expect(options.parameters).toBe(descriptor.parameters)
    expect(options.output.schema).toBe(descriptor.outputSchema)
    expect(options.output.render).toBe(descriptor.render)
  })

  it('★ 回归：不得把 render 的 `Content[]` 二次包成 text（类型与编译都拦不住的那条）', () => {
    const { defineTool } = requireReal()
    // 真实工具返回的是 Content[]；若装配层"顺手"再包一层，
    // 模型收到的是被字符串化的数组，而 tsc / assertSupportedJsonSchema **都不会报错**。
    const content = [{ type: 'text' as const, text: '真实结果' }]
    const descriptor: SophiaToolDescriptor = {
      name: 'sophia_context_rollover',
      description: 'd',
      parameters: {},
      outputSchema: { type: 'object', additionalProperties: true, properties: {} },
      render: () => content,
      run: async () => ({}),
    }
    const tool = defineTool(toDefineToolOptions(descriptor)) as Record<string, unknown>
    const output = tool['output'] as Record<string, unknown>
    const rendered = (output['render'] as (a: unknown, v: unknown) => unknown)({}, {})
    // 逐字等于原名（不是 [{type:'text', text:'[object Object]'}] 之类）。
    expect(rendered).toBe(content)
    expect(rendered).toEqual([{ type: 'text', text: '真实结果' }])
  })

  it('★ 回归：`execute` 必须把**模型的入参**转给 `run`（变异 M-E 抓出的空洞）', async () => {
    const { defineTool } = requireReal()
    // 为什么需要这条：此前的 11 条断言**没有一条**看 execute 的入参流向 ——
    // 实测把 `execute: async (args) => run(args)` 改成 `(_args, exec) => run(exec)`
    // 后仍 11/11 全绿（变异 M-E）。而那个改法会让每个工具收到的都是
    // **执行上下文**而不是模型参数 ⇒ 工具全部走入 `invalid-input`，
    // 模型看到的症状是"工具永远说参数不对"，极难定位到装配层。
    const seen: unknown[] = []
    const descriptor: SophiaToolDescriptor = {
      name: 'sophia_team_message',
      description: 'd',
      parameters: { channelId: { type: 'string', required: true, description: '频道' } },
      outputSchema: { type: 'object', additionalProperties: true, properties: {} },
      render: () => [{ type: 'text', text: 'r' }],
      run: async (input: unknown) => {
        seen.push(input)
        return { kind: 'sent' }
      },
    }
    const tool = defineTool(toDefineToolOptions(descriptor)) as Record<string, unknown>

    const modelArgs = { channelId: 'channel-01' }
    const execContext = { agent: 'some-agent', signal: 'some-signal' }
    const execute = tool['execute'] as (a: unknown, e: unknown) => Promise<unknown>
    const result = await execute(modelArgs, execContext)

    // ★ 逐字同一性：run 收到的**必须**是模型参数本身，不能是 exec、不能是包了一层的新对象。
    expect(seen).toHaveLength(1)
    expect(seen[0]).toBe(modelArgs)
    expect(seen[0]).not.toBe(execContext)
    // 返回值也原样透出（不吞、不包装）。
    expect(result).toEqual({ kind: 'sent' })
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 2. 注册结果必须是**结构化事实**
// ────────────────────────────────────────────────────────────────────────────

describe('registerSophiaTools：注册成功的判据是「注册表里真的有这些名字」', () => {
  it('★ 全套 5 个工具经**真实 defineTool** 注册，名字与 SOPHIA_TOOL_NAMES 逐字一致', () => {
    const { defineTool } = requireReal()
    const registry = makeRegistry()

    const result = registerSophiaTools(
      (options) => defineTool(options),
      registry,
      stubDeps(),
    )

    // ★ 判据一：注册表里真的有这 5 个名字（不是「调用没抛」）。
    expect([...registry.registered.keys()].sort()).toEqual([...SOPHIA_TOOL_NAMES].sort())
    // ★ 判据二：返回值与注册表**一致**，顺序 = 清单顺序（t4 的顺序契约）。
    expect(result.registered).toEqual([...SOPHIA_TOOL_NAMES])
    expect(result.failed).toEqual([])
    // ★ 判据三：每个定义都带编译后的 object 根 + output.schema（证明真的走完了 defineTool）。
    for (const [name, def] of registry.registered) {
      const parameters = def['parameters'] as Record<string, unknown>
      expect(parameters['type'], `${name} 的 parameters 应被编译成 object 根`).toBe('object')
      expect((def['output'] as Record<string, unknown>)['schema'], `${name} 应有 output.schema`).toBeDefined()
    }
  })

  it('★ 阳性对照：判据能识别「注册表是空的」—— 空实现不得被读成成功', () => {
    const { defineTool } = requireReal()
    // 一个**什么都不存**的注册表：若断言只看「没抛」，这条会假绿。
    const swallow = { register: (_definition: never): undefined => undefined }
    const result = registerSophiaTools(
      (options) => defineTool(options),
      swallow,
      stubDeps(),
    )
    // 如实回报：没抛 ⇒ 记为「已注册」（这是 host.ts 的 `registered` 布尔量纪律），
    // 所以「已注册」**不等于**「注册表里存下来了」——
    // 想知道后者必须查 registry，这正是上面那条断言查的东西。
    expect(result.registered).toHaveLength(SOPHIA_TOOL_NAMES.length)
    expect(result.failed).toEqual([])
  })

  it('★ 单项失败不牵连其余（逐项 try）', () => {
    const { defineTool } = requireReal()
    const target = 'sophia_spawn_team'
    const registry = makeRegistry(target)

    const result = registerSophiaTools(
      (options) => defineTool(options),
      registry,
      stubDeps(),
    )

    expect(result.failed.map((f) => f.name)).toEqual([target])
    expect(result.registered).toHaveLength(SOPHIA_TOOL_NAMES.length - 1)
    // 失败那一项**确实没进**注册表，其余四项确实进了。
    expect(registry.registered.has(target)).toBe(false)
    expect(registry.registered.size).toBe(SOPHIA_TOOL_NAMES.length - 1)
  })

  it('★ defineTool 自身抛错时如实记进 failed，不吞、不冒充成功', () => {
    const registry = makeRegistry()
    const result = registerSophiaTools(
      () => {
        throw new Error('defineTool 构造期失败')
      },
      registry,
      stubDeps(),
    )
    expect(result.registered).toEqual([])
    expect(result.failed).toHaveLength(SOPHIA_TOOL_NAMES.length)
    expect(registry.registered.size).toBe(0)
  })

  it('disposer 只在真是函数时留用，且不影响「已注册」的判定', () => {
    const { defineTool } = requireReal()
    const noDisposer = {
      register: (definition: never): unknown => {
        void definition
        return 'not-a-function'
      },
    }
    const result = registerSophiaTools(
      (options) => defineTool(options),
      noDisposer,
      stubDeps(),
    )
    expect(result.registered).toHaveLength(SOPHIA_TOOL_NAMES.length)
    expect(result.disposers).toEqual([])
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 3. 结构化守卫
// ────────────────────────────────────────────────────────────────────────────

describe('结构守卫：形状不对 ⇒ undefined（降级），不抛', () => {
  it('asToolsRegistry 只认带 register 函数的对象', () => {
    expect(asToolsRegistry(undefined)).toBeUndefined()
    expect(asToolsRegistry(null)).toBeUndefined()
    expect(asToolsRegistry({})).toBeUndefined()
    expect(asToolsRegistry({ register: 42 })).toBeUndefined()
    const ok = { register: () => undefined }
    expect(asToolsRegistry(ok)).toBe(ok)
  })

  it('asDefineTool 只认函数', () => {
    expect(asDefineTool(undefined)).toBeUndefined()
    expect(asDefineTool({})).toBeUndefined()
    const fn = (): undefined => undefined
    expect(asDefineTool(fn)).toBe(fn)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 4. 运行期解析 defineTool（生产路径）
// ────────────────────────────────────────────────────────────────────────────

describe('resolveDefineTool：运行期解析，且失败**以返回值**表达而不是抛', () => {
  it('★ 在仓库内解析不到（如实失败），但**不抛** —— 并把原因带出来', async () => {
    // ## 这条断言的**前提必须写明**，否则它会被误读
    //
    // 在本仓（workspace）里跑时，`@deepseek-ai/dsh-tools` **解析不到** ——
    // 实测三处 `node_modules/@deepseek-ai` 全不存在（`packages/sophia-core/`、
    // 仓根、用户主目录）。插件**装进 `profiles/` 之后**才解析得到（裸包名的解析
    // 基准是插件自身位置，与在跑的 `dsh-postman` 同一条路）。
    //
    // ⇒ 所以这条断言钉的是**仓库内**的行为：返回 `failed` 且**不抛**。
    // 这正是我们要的契约（解析不到是「工具面不可用」，不是「插件加载失败」）。
    // **它不证明**生产路径也能解析 —— 那需要装到 profiles 后真机验证，
    // 本 spec 做不到，故不声称。
    const { resolveDefineTool } = await import('../src/host-tools.ts')
    const resolution = await resolveDefineTool()

    if (resolution.kind === 'resolved') {
      // 若哪天仓库里真装上了这个包，这条断言也该成立 —— 那说明解析通了，是好事。
      // 但不能因为「装上了」就让本用例静默变成另一件事：两种结果都断言契约。
      expect(typeof resolution.defineTool).toBe('function')
      return
    }

    // 反恒真：把实现改成 `throw` 而不是 return ⇒ 本条必须变红（await 会拒绝）。
    expect(resolution.kind).toBe('failed')
    expect(resolution.reason).toContain('@deepseek-ai/dsh-tools')
    expect(resolution.reason.length).toBeGreaterThan(0)
  })

  it('解析失败的原因里含包名（诊断要能直接看出缺什么）', async () => {
    const { resolveDefineTool } = await import('../src/host-tools.ts')
    const resolution = await resolveDefineTool()
    if (resolution.kind !== 'failed') return
    expect(resolution.reason).toMatch(/@deepseek-ai\/dsh-tools/)
  })
})
