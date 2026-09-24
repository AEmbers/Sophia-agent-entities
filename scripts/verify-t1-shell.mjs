#!/usr/bin/env node
/**
 * t1 插件外壳 —— 门禁脚本。
 *
 * 为什么写成文件而不是把命令塞进 verify_report 的 `cmd`：
 * 本仓实测踩过坑（AGENTS.md §四・1）—— 带引号/正则/反斜杠的命令在 pwsh 过、
 * 却在 gate executor（走 `cmd`）里死在 shell 转义上，并被自动记成 agent-misjudge。
 * 这个脚本自带 cwd（相对自身定位），所以 `cmd` 里只有 `node <file>` 一个形态。
 *
 * ── 本脚本的**前提与保证**（OCR 复核 [2] 要求写明，勿省略）──
 *
 * 它**自己先跑构建**，再检查产物。原因是实测踩到过一次「假绿」：
 * 源码改坏后构建失败，但 `lib/` 还是上一次的产物，只看产物的检查照常全绿。
 * 所以顺序固定为「构建 → 检查产物」；构建失败会记成失败项，且后续产物检查
 * 仍会跑（好让你同时看到「构建失败」和「产物是旧的」）。
 * 唯一**不**由本脚本保证的是「依赖已安装」——那需要联网，见下面的 preflight 探测：
 * 探测失败会明确报「工具链没跑起来」，而不是伪装成测试失败。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync, writeSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = dirname(HERE)
const PKG = join(REPO, 'packages', 'sophia-core')

/** 单步超时：够 vitest / tsc 跑完，又不至于真的挂死（OCR 复核 [1]）。 */
const STEP_TIMEOUT_MS = 600_000
/** 输出上限 32MB：足够放下失败 dump，又不至于把日志撑爆（OCR 复核 [1]）。 */
const MAX_BUFFER = 32 * 1024 * 1024

let failed = 0
/** 工具链是否有问题（与「检查项失败」分开计数，见 checkToolchain 的注释）。 */
let toolchainBroken = false

/**
 * 退出码契约（**唯一**决定退出码的地方，便于自检 —— 见文件末的 `--self-test-exit`）。
 *
 * | failed | toolchainOk | exit | 含义 |
 * |---|---|---|---|
 * | 0 | true  | 0 | 全过 |
 * | ≥1| true  | 1 | **真实检查失败** |
 * | 任意 | false | 2 | **环境问题（工具链不可用）** |
 *
 * ⚠ 这里被 captain（t3 转交）实测抓过一个真缺陷，记下来免得改回去：
 * 原式是 `failed === 0 && !toolchainOk ? 2 : failed === 0 ? 0 : 1`，
 * 在「工具链坏 **且** 有失败项」那一格返回 **1**（伪装成真实检查失败），
 * 恰好毁掉「不让环境问题与检查失败混在同一个数字里」这个设计目的。
 * 改法：工具链不可用**优先**返回 2，与 failed 是否为 0 无关。
 *
 * @param failed - 失败检查项数。
 * @param toolchainOk - 工具链是否可用。
 * @returns 进程退出码：0 全过 / 1 检查失败 / 2 环境问题。
 */
function exitCodeFor(failed, toolchainOk) {
  if (!toolchainOk) return 2
  return failed === 0 ? 0 : 1
}

/**
 * 写完一段输出、**确保它已交给 OS** 之后再退出。
 *
 * 为什么不能直接 `write(text); process.exit(code)`（评审 HIGH）：
 * 管道下的 stdout 写入是**异步**的，`process.exit()` 不等待它 flush，
 * 于是紧邻退出前那次 summary 可能整行丢掉 —— 而它正是本脚本存在的意义。
 * （诚实边界：本机用 20 万行 / 200MB 输出**没能**复现丢行，两种收尾方式
 *   捕获到的字节数逐字节相同。所以这是防御性修正，不是已复现的故障。）
 *
 * ⚠ 这里用 `fs.writeSync(1, …)` **同步**写 fd 1，而不是「异步 write + 回调/定时器」。
 * 原因是 eval 抓到的一版真缺陷：我最初写成
 * `Promise.race([write 回调, 3s 定时器])` 再 `process.exit()` ——
 * **定时器一赢就等于没保护**（buffer 仍未 flush 就退出），
 * 恰好在这个函数唯一要防的场景里失效。
 * 同步写把「等 flush」变成「写完才返回」，竞态从根上消失。
 *
 * 为什么要**立刻** `process.exit`（不能只设 `process.exitCode`）：
 * 实测过 —— 只设 exitCode 不显式退出时，本脚本**不会结束**（≥60s 仍挂）。
 * 因为自检模式是提前返回语义，后面还有整段门禁代码与子进程句柄。
 * 所以这里必须显式退出；而既然上面是同步写，退出时输出已落盘。
 *
 * 用法上它**永不返回**（内部 `process.exit`），调用它的分支天然短路。
 *
 * @param text - 要写出的文本。
 * @param code - 退出码。
 */
function writeThenExit(text, code) {
  try {
    writeSync(1, text)
  } catch {
    // fd 1 不可写（极罕见）时退回异步写：至少尝试留下结论。
    // 此时不保证 flush，但没有更好的选择。
    process.stdout.write(text)
  }
  process.exit(code)
}

// ── 自检模式：只验上面这张真值表，不跑门禁 ──
// 为什么需要它：退出码是本脚本对外的**契约**，而它恰恰不在 vitest 的覆盖内
// （gate 脚本在仓库根的 scripts/，packages/sophia-core 的测试够不着）。
// 一个从未红过的契约与没有契约等价，所以给它一条能自证的通道。
// 用法：`node scripts/verify-t1-shell.mjs --self-test-exit`
if (process.argv.includes('--self-test-exit')) {
  const CASES = [
    { failed: 0, toolchainOk: true, want: 0, note: '全过' },
    { failed: 1, toolchainOk: true, want: 1, note: '真实检查失败' },
    { failed: 0, toolchainOk: false, want: 2, note: '工具链坏、无失败项' },
    { failed: 1, toolchainOk: false, want: 2, note: '工具链坏 + 有失败项（原缺陷格：曾返回 1）' },
  ]
  let bad = 0
  process.stdout.write('退出码真值表自检：\n')
  for (const c of CASES) {
    const got = exitCodeFor(c.failed, c.toolchainOk)
    const ok = got === c.want
    if (!ok) bad += 1
    process.stdout.write(
      `  failed=${c.failed} toolchainOk=${c.toolchainOk} -> ${got}（应 ${c.want}）${ok ? ' OK' : ' **不符**'}  ${c.note}\n`,
    )
  }
  // ⚠ 收尾方式（评审 HIGH）：`process.exit()` 不等待 stdout 异步 flush，
  // 而本脚本的输出正是被 gate executor 以**管道**捕获的。走 writeThenExit()。
  // 它内部 `process.exit()`，所以不会返回 —— 自检模式到此结束。
  writeThenExit(bad === 0 ? '真值表全部符合\n' : `${bad} 格不符\n`, bad === 0 ? 0 : 1)
}

/**
 * 跑一步并把输出直通到本进程输出。
 *
 * ⚠ Windows 上 `npx` 不是可执行文件而是 `npx.cmd`，`execFileSync('npx', …)`
 * 会直接 ENOENT（实测：exit=null、输出为空）。所以统一走 `shell: true`。
 *
 * ⚠ 而「走 shell」这件事本身让 `error.code` **几乎不可能**出现（OCR 复核 [7]：
 * shell 进程自己总能启动成功，缺的是里面的二进制）—— 此时拿到的是
 * shell 的退出码，POSIX 下 127、Windows 下 1/9009，与「测试失败」长得一样。
 * 所以本函数**不再假装**能靠 error.code 分辨这两者；分辨改由
 * 显式的 preflight 探测负责（见 checkToolchain）。
 */
function step(label, command, cwd) {
  process.stdout.write(`\n=== ${label} ===\n`)
  try {
    const out = execFileSync(command, {
      cwd,
      encoding: 'utf8',
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: STEP_TIMEOUT_MS,
      maxBuffer: MAX_BUFFER,
    })
    if (out.trim()) process.stdout.write(out)
    process.stdout.write(`[${label}] exit=0\n`)
    return true
  } catch (error) {
    failed += 1
    process.stdout.write(String(error.stdout ?? ''))
    process.stdout.write(String(error.stderr ?? ''))
    if (error.killed === true) {
      process.stdout.write(`[${label}] 超时（>${STEP_TIMEOUT_MS}ms）—— 可能是命令进入了交互式等待\n`)
    } else {
      process.stdout.write(`[${label}] exit=${error.status ?? 'null'}\n`)
    }
    return false
  }
}

/**
 * 显式探测工具链是否真的能跑（OCR 复核 [7]）。
 *
 * 这是「命令没跑起来」与「命令跑了但失败」唯一可靠的分界：
 * 先确认 `npx` 本身可用，后面的失败就都是**真实的检查失败**。
 *
 * ⚠ 返回值必须被使用（OCR 复核 [2]/[5]）：本函数只置 `toolchainBroken`、
 * **不**计进 `failed`，否则它在总结里与真实检查失败长得一样，
 * 恰好毁掉它存在的意义。调用处据此在总结里单独标注。
 *
 * ⚠ 为什么必须走 `shell: true`（评审建议过 `execFileSync('npx', ['--version'])`，
 * 实测**不能采纳**，见下）：本机实测四种写法 ——
 *   · `execFileSync('npx --version', {shell:true})`  → OK（"11.17.0"）← 采用
 *   · `execFileSync('npx', ['--version'])`           → **ENOENT**（Windows 上 npx 是 npx.cmd）
 *   · `execFileSync('npx.cmd', ['--version'])`       → **EINVAL**（.cmd 需 cmd.exe 解释）
 *   · `execFileSync(process.execPath, ['-e', …])`    → OK（无 .cmd 参与时非 shell 可用）
 * 即：把这个探针改成非 shell 形式会**直接打破探测本身**（它变成永远失败 ⇒
 * 门禁恒判「工具链坏」）。所以保留 shell，并把理由写在这里。
 * 相应地，`error.code`（spawn 层）在 shell 形态下几乎不出现，
 * 「没跑起来」只能靠本探针的**独立性**判定，而不是靠错误码 —— 这也是本函数存在的理由。
 */
function checkToolchain() {
  process.stdout.write('\n=== preflight: 工具链可用性 ===\n')
  // ⚠ 两个都要探（评审 [11]）：构建步骤走的是 `npx pnpm --filter …`，
  // 而 `pnpm` 通常是**单独安装**的、不一定跟着 npm/npx 来。
  // 只探 npx 的话，在「有 npx、没有 pnpm」的机器上构建会失败并被记成
  // 真实检查失败（exit 1），而不是环境问题（exit 2）—— 恰好毁掉 preflight 的意义。
  const probes = ['npx --version', 'pnpm --version']
  for (const probe of probes) {
    try {
      const version = execFileSync(probe, {
        cwd: REPO,
        encoding: 'utf8',
        shell: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 120_000,
      }).trim()
      process.stdout.write(`  ${probe.split(' ')[0]} 可用：${version}\n`)
    } catch {
      toolchainBroken = true
      process.stdout.write(`  **${probe.split(' ')[0]} 不可用** —— 后面的失败都不算真实检查结果；请先装依赖\n`)
    }
  }
  return !toolchainBroken
}

const toolchainOk = checkToolchain()

// ── 0：退出码真值表自检 ──
// 先跑它：退出码是本脚本对外的契约，若它错了，后面所有结论的可信度都受影响。
// 自检本身也是一个 step（失败会进 failed 计数），这样它**不会**静默烂掉。
step('self-test: 退出码真值表',
  `node "${fileURLToPath(import.meta.url)}" --self-test-exit`, REPO)

// ── 1–3：类型门禁（契约里的前两条 verify 命令，逐字等价）──
step('tsc --version', 'npx tsc --version', REPO)
step('tsc --noEmit -p packages/sophia-core/tsconfig.json',
  'npx tsc --noEmit -p packages/sophia-core/tsconfig.json', REPO)
// 浏览器半边有独立 tsconfig（主配置 exclude 了 src/client）。
step('tsc --noEmit -p packages/sophia-core/tsconfig.client.json',
  'npx tsc --noEmit -p packages/sophia-core/tsconfig.client.json', REPO)

// ── 4：**先构建**，再跑测试（顺序很关键，见下）──
//
// ⚠ 这里被 数象主事 抓到一条 HIGH（已实测复现，勿改回去）：
// `tests/shell.spec.ts` 是**产物驱动**的 —— 它 `import '../lib/plugin.js'`、
// `../lib/host.js`、`../lib/client.js`、`../lib/index.js`，并直接读 `lib/client.js` 的文本。
// 原先 vitest 排在 build **之前**，于是第 4 步验的是**上一版** lib/，
// 第 5 步才重新构建 ⇒ 正是文件头声称要修掉的「stale artifact ⇒ 假绿」，
// 只是没应用到测试步。它还有一个更难看的方向：产物**缺失**时，
// 测的是「上一份产物」或直接红掉，而不是「本次源码构建出来的东西」。
// 实测复现：手工删掉 lib/client.js 后跑原顺序的 gate ⇒ vitest 5 条红，
// 而随后的 build 又把 client.js 生成回来 —— 证明测试跑在旧/缺产物上。
// 修法：**先构建、再测试**，让测试验的是本次构建的产物。
//
// ⚠ 这里用的是 `build`（不清 lib/）而不是 `build:clean`：本仓是共享包，
// 别的成员可能正在改 src/ 的其它文件。若构建前先清空，一旦构建因**别人的**
// 在途改动而失败，就会把上一份可用的 lib/ 也一起毁掉（实测踩到过：
// lib/client.js 被清掉后没再生成，依赖产物的测试全红）。
// 「构建前清空」的语义留给 `build:clean`（prepack 用），包发布时才有必要。
// 注意：`build` 失败**不阻断**后面的 vitest —— 那样能同时看到
// 「构建失败」与「测试对旧产物说了什么」，比只报第一个错信息量大。
const buildStartedAt = Date.now()
const built = step('build (@sophia/core)',
  'npx pnpm --filter @sophia/core run build', REPO)

// ── 5：测试套件（契约里的第 3 条 verify 命令）──
step('vitest run --root packages/sophia-core',
  'npx vitest run --root packages/sophia-core', REPO)

// ── 6：dsh 字段存在（契约第 4 条 verify 命令的等价物）──
// OCR 复核 [7]：parse 要包起来 —— package.json 写坏时不该让整个脚本崩掉，
// 那会把前面 tsc / vitest / build 已跑出的结论一起丢掉。
process.stdout.write('\n=== dsh field present ===\n')
let pkg
try {
  pkg = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8'))
} catch (error) {
  failed += 1
  process.stdout.write(`  package.json 解析失败 => FAIL: ${error?.message ?? error}\n`)
}
if (pkg !== undefined) {
  const dshOk = Boolean(pkg.dsh && pkg.dsh.bundle && pkg.dsh.client)
  process.stdout.write(`  dsh.bundle=${JSON.stringify(pkg.dsh?.bundle)} dsh.client=${JSON.stringify(pkg.dsh?.client)}\n`)
  if (!dshOk) failed += 1
  process.stdout.write(`  => ${dshOk ? 'OK' : 'MISSING'}\n`)
}

// ── 7：产物齐备 + 新鲜度 ──
process.stdout.write('\n=== build artifacts present & fresh ===\n')
const REQUIRED = ['lib/plugin.js', 'lib/host.js', 'lib/client.js', 'lib/client/index.d.ts']
for (const rel of REQUIRED) {
  const abs = join(PKG, rel)
  const present = existsSync(abs)
  process.stdout.write(`  ${present ? 'OK  ' : 'MISS'} ${rel}\n`)
  if (!present) failed += 1
}
// 新鲜度：与**构建开始前**打的时间戳比，而不是与源码 mtime 比
// （OCR 复核 [3]）。源码 mtime 判定在粗粒度文件系统上会漏掉
// 「构建失败但没重新生成」——`>=` 在 1s 分辨率下几乎恒真。
// 用严格 `>` 且基准是构建前的时刻，才真正表达「这份产物是本次构建产出的」。
//
// ⚠ 已知边界（历算主事 转交的 MEDIUM，如实记录，未改判据）：
// 本判据假设「构建耗时 > mtime 粒度」。**实测**本机差值约 3.5s
// （多次 gate 运行：bundle−buildStart = 3455 / 3519 / … ms），
// 远大于 FAT 的 2s 与多数文件系统的 1s 粒度，所以在本机不会误判 STALE。
// 若将来 build 变成 near-no-op（如全量缓存命中、构建 <1s）且盘是 2s 粒度，
// 理论上可能把新鲜产物判成 STALE。那时正确的做法不是换成 `>=`
// （那会让「构建失败没重新生成」漏过去，正是这条要挡的），
// 而是改用显式标记：构建后 touch 一个 marker 文件、比 marker 与产物的先后。
if (built && existsSync(join(PKG, 'lib/client.js'))) {
  const bundleMtime = statSync(join(PKG, 'lib/client.js')).mtimeMs
  const fresh = bundleMtime > buildStartedAt
  process.stdout.write(`  ${fresh ? 'OK  ' : 'STALE'} lib/client.js 是本次构建产出的（bundle ${Math.round(bundleMtime)} > 构建前 ${Math.round(buildStartedAt)}）\n`)
  if (!fresh) failed += 1
} else if (!built) {
  process.stdout.write('  SKIP 新鲜度检查（构建没成功，产物可能是旧的）\n')
}
// 不可运行的 tsc 中间产物**不该**存在（OCR 复核 [3]）。
// ⚠ 标签用 `STRAY` 而不是 `MISS`（OCR 复核 [3]）：这里的极性是**反的**
// —— 存在才是坏消息。沿用 `MISS` 会让「一个该删的残留文件」在日志里
// 显示成「缺了个文件」，读日志的人会往错误方向查。
const stray = existsSync(join(PKG, 'lib/client/index.js'))
process.stdout.write(`  ${stray ? 'STRAY' : 'OK  '} lib/client/index.js 必须不存在（含未替换的 __SOPHIA_PLUGIN_ID__）\n`)
if (stray) failed += 1

// ── 8：client bundle 的 loader 契约 ──
//
// ⚠ 这一段整体包在 try 里（OCR 复核 [2]/[3]）：门禁脚本最不能做的事，
// 就是在**被测对象坏掉时自己崩掉** —— 那会把「哪几项已经过了」的结论一起丢掉。
// 而这里恰恰是最可能坏的环节：标识符没替换（模块**求值期**就抛）、
// 注册 0 个模块（`[...values()][0]` 是 undefined）、`apply()` 自己抛。
process.stdout.write('\n=== client bundle loader contract ===\n')
if (!existsSync(join(PKG, 'lib/client.js'))) {
  // ⚠ 这里**不再** `failed += 1`（OCR 复核 [2]）：lib/client.js 缺失已被上面的
  // REQUIRED 产物循环记过一次了，再记一次会让同一个根因报成 2 项失败，
  // 把「N 项失败」这个数字变得不可解释。而且原来那句「SKIP」与「又计一次失败」
  // 自相矛盾 —— 要么跳过（不计），要么失败（计一次）。这里是「跳过验证」。
  process.stdout.write('  SKIP：lib/client.js 不存在，无法验证 loader 契约（该缺件已在上面「build artifacts」一节记为失败）\n')
} else {
  const registry = new Map()
  // OCR 复核 [1]：这份 window 是**替身**，用完要还原，别把宿主的环境污染了
  // （本脚本眼下只作为入口运行，但「只作为入口」是调用方的约定，不该由这里隐式承担）。
  const savedWindow = globalThis.window
  globalThis.window = { __ModuleLoader__: { load({ id, factory }) { registry.set(id, factory) } } }
  try {
    // 用 pathToFileURL（OCR [3]）：手工把 `\` 换成 `/` 拼 file:// 在跨平台时很脆。
    //
    // ⚠ 加超时（历算主事 转交的 MEDIUM）：`await import(...)` **不受**
    // `execFileSync` 的 timeout 覆盖（那个只管子进程）。若它永不 resolve
    // （产物损坏、或某个顶层 await 卡住），门禁会**挂死**且永远走不到 summary ——
    // 而 summary 是本脚本唯一的对外结论。所以这里自己设上限。
    const IMPORT_TIMEOUT_MS = 30_000
    let importTimer
    try {
      await Promise.race([
        import(pathToFileURL(join(PKG, 'lib/client.js')).href),
        new Promise((_resolve, reject) => {
          importTimer = setTimeout(
            () => reject(new Error(`lib/client.js 加载超过 ${IMPORT_TIMEOUT_MS}ms 未完成（疑似挂死）`)),
            IMPORT_TIMEOUT_MS,
          )
        }),
      ])
    } finally {
      // 清掉定时器：否则它会让事件循环多活 30s（本脚本最后会 exit，
      // 但「靠 exit 兜住」不该是省略清理的理由）。
      clearTimeout(importTimer)
    }

    const ids = [...registry.keys()]
    const factory = [...registry.values()][0]
    if (factory === undefined) {
      // ⚠ 这里**只计一次**（数象主事 转交的 LOW）：bundle 一个模块都没注册时，
      // 「id 不等于包名」与「注册数为 0」是**同一个根因**。原先两处各 `failed += 1`
      // ⇒ 一个缺失的 bundle 报成 2 项失败，让「N 项失败」这个数字不可解释，
      // 也与本文件别处「同一根因不重复计数」的原则相悖（见 lib/client.js 的 SKIP 处理）。
      failed += 1
      process.stdout.write('  factories registered = 0 => FAIL（bundle 没有调用 __ModuleLoader__.load；id 检查因无模块而跳过）\n')
    } else {
      const idOk = ids.length === 1 && ids[0] === pkg?.name
      process.stdout.write(`  registered id = ${JSON.stringify(ids[0])} (pkg.name = ${JSON.stringify(pkg?.name)}) => ${idOk ? 'OK' : 'MISMATCH'}\n`)
      if (!idOk) failed += 1

      const exports = factory((n) => { throw new Error(`unexpected require ${n}`) })
      const applyOk = typeof exports?.apply === 'function'
      process.stdout.write(`  exports.apply = ${typeof exports?.apply} => ${applyOk ? 'OK' : 'MISSING'}\n`)
      if (!applyOk) failed += 1
      try {
        // ⚠ stub ctx 必须提供 client 半的**硬依赖服务**（历算主事 转交的 HIGH，已实测）：
        // 原先 stub 的 `get()` 恒返回 undefined，而 t5 的 client `apply()` 把
        // `slots` 当硬依赖 —— 拿不到就「如实报未挂载」并早返回，
        // ⇒ `window.__SOPHIA_CLIENT__` **永不写入** ⇒ 下面这条 mounted 判定
        // **恒假**：对一份完全正确的 bundle 也报失败（实测确认）。
        // 这是「用自己的桩把被测对象饿死」的典型：桩不是越空越好，
        // 得把**被测代码真正需要的东西**给够，否则测的是桩、不是产物。
        const stubCtx = {
          get: (name) => (name === 'slots'
            ? { register: () => () => {}, inject: () => {} }
            : undefined),
          effect: (fn) => fn(),
          on: () => {},
        }
        exports.apply(stubCtx)
        const mounted = globalThis.window.__SOPHIA_CLIENT__ !== undefined
        process.stdout.write(`  apply() 后 window.__SOPHIA_CLIENT__ = ${JSON.stringify(globalThis.window.__SOPHIA_CLIENT__)} => ${mounted ? 'OK' : 'NOT SET'}\n`)
        if (!mounted) failed += 1
      } catch (error) {
        failed += 1
        process.stdout.write(`  apply() 抛错 => FAIL: ${error?.message ?? error}\n`)
      }
    }
  } catch (error) {
    failed += 1
    process.stdout.write(`  bundle 加载失败 => FAIL: ${error?.message ?? error}\n`)
    process.stdout.write('  提示：若信息含 __SOPHIA_PLUGIN_ID__，说明 tsdown 的 define 没生效。\n')
  } finally {
    // 还原替身（见上面 savedWindow 的说明）。
    // ⚠ 用 `delete` 而不是赋值 `undefined`（评审 [2]）：原先 Node 下本来**没有**
    // `window` 这个自有属性，赋 undefined 会让它变成一个存在的键
    // （`'window' in globalThis` 从 false 变 true）—— 那正是这里想避免的环境污染。
    if (savedWindow === undefined) delete globalThis.window
    else globalThis.window = savedWindow
  }
}

// 总结：先算出后缀，再拼一行 —— 避免嵌套三元表达式（OCR 复核 [1]：
// 那种写法可读性差，且本项目风格规则禁止）。
const toolchainSuffix = toolchainBroken
  ? '，且**工具链不可用**（上面的失败不一定是真实检查结论）'
  : ''
const summary = failed === 0 && !toolchainBroken
  ? 'ALL PASS'
  : `${failed} 项失败${toolchainSuffix}`
const exitCode = exitCodeFor(failed, toolchainOk)
// 工具链坏了就明确以「环境问题」收场（OCR 复核 [2]/[5]，以及 captain 转交的实测缺陷）：
// 不让它与「检查项失败」混在同一个数字里 —— 那正是 preflight 要消除的歧义。
// 退出码的唯一判据在 exitCodeFor()，其真值表由 `--self-test-exit` 自证。
writeThenExit(`\n=== 总结：${summary} ===\n`, exitCode)
