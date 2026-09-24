/**
 * t5 最终裁决用的守卫脚本（内容锚定，不看退出码 —— 见失败样本库
 * fc-20260923-4f3994ec71ce：`npx tsc --version` 的「通过」若只由 exit 0 表达，
 * 就会被 npx 伪包/cwd 吃成恒真，必须断言**输出内容**）。
 *
 * 每条断言都把**实际取到的输出**打出来，便于机器裁决时人工复核。
 */
import { execSync } from 'node:child_process'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 仓库根 —— **从脚本自身位置推导**，不依赖 `process.cwd()`。
 *
 * ⚠ OCR 复核 LOW [32]：初版用 `cwd: process.cwd()`，而本脚本的所有命令
 *   （`npx tsc --noEmit -p packages/sophia-core/...`、`npx vitest --root ...`）
 *   都带**仓库相对路径** ⇒ 从别的目录调用时命令会指向不存在的位置，
 *   于是「门禁假红」；更糟的是 `npx` 找不到本地 devDependencies 时会去
 *   npm-cache 拉临时包（失败样本库记过这个坑：既可能假绿也可能假红）。
 *   ⇒ 显式锚定到脚本所在仓库根，调用者的 cwd 不再影响判定。
 */
const REPO = dirname(dirname(fileURLToPath(import.meta.url)))

/**
 * 剥掉 ANSI 转义序列。
 *
 * ⚠ 这条是**实测代价**换来的（本脚本第一版就这么栽了）：vitest 在非 TTY 下
 * 也会给数字/文件名上色，于是输出里是 `Tests  \x1b[32m574 passed\x1b[39m` 这种形态 ——
 * `/Tests\s+(\d+) passed/` 直接匹配不到，通过数读成 `undefined`，
 * 一条**为真**的 claim 就此被判 fail（机器裁决报告里写着
 * 「FAIL vitest 通过数 ≥ 574（实为 undefined）」，而人工跑同一脚本是 OK）。
 * ⇒ 判据在**内容**上是对的（这正是上一条失败样本 fc-…4f3994ec71ce 的要求），
 *   但内容必须先归一化：**带色的文本不是文本**。
 * 教训合并成一句话：**断言内容时，先把内容规范化到与肉眼所见一致的形态。**
 */
function stripAnsi(text) {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001B\[[0-9;]*[A-Za-z]/g, '')
}

function run(cmd) {
  try {
    const stdout = execSync(cmd, {
      encoding: 'utf8',
      stdio: 'pipe',
      cwd: REPO,
      // ⚠ **必须有超时**（OCR 复核 MEDIUM）：本脚本存在的唯一产出就是最后那份
      //   summary。若 `npx` 卡在包安装提示、或 vitest 挂住，没有超时的话
      //   它会**永远不打印 summary** —— 即「门禁自己变成挂死」，比判红更糟
      //   （裁决方等不到任何结论）。超时会让 execSync 抛错，被下面的 catch
      //   转成一次明确的失败 + 可读输出。
      timeout: 300_000,
      killSignal: 'SIGKILL',
    })
    return { code: 0, stdout: stripAnsi(stdout) }
  } catch (error) {
    // `error.status` 为 null 时（超时/被杀）用 1，避免把 `null` 当成「成功」。
    return {
      code: typeof error.status === 'number' ? error.status : 1,
      stdout: stripAnsi(String(error.stdout ?? '')),
      stderr: stripAnsi(String(error.stderr ?? '')),
    }
  }
}

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL ${message}`)
    process.exit(1)
  }
  console.log(`OK   ${message}`)
}

// ① 守卫：必须**真的**是 tsc 5.9.3，而不是 npx 的安装提示（内容锚定）。
const tsc = run('npx tsc --version')
assert(tsc.code === 0, `tsc --version 退出码 0（实为 ${tsc.code}）`)
// ⚠ 断言**形状**而不是写死版本（captain 派修 [27]）：写死 `5.9.3` 会在合法升级
//   TypeScript 后假红。但也**不能**放宽成「输出非空」——那会让 npx 的
//   「This is not the tsc command」安装提示通过（失败样本库里记过这个恒真守卫）。
//   ⇒ 判据是「真的是 tsc 打的版本号」：`Version <数字>.<数字>.<数字>`。
assert(
  /^Version \d+\.\d+\.\d+/.test(tsc.stdout.trim()),
  `tsc --version 输出形如 "Version x.y.z"（实为 "${tsc.stdout.trim()}"）`,
)

// ② 两套类型检查：必须**零错误行**，不能只看退出码。
for (const project of ['tsconfig.json', 'tsconfig.client.json']) {
  const result = run(`npx tsc --noEmit -p packages/sophia-core/${project}`)
  assert(result.code === 0, `tsc --noEmit -p ${project} 退出码 0`)
  assert(!/error TS/.test(result.stdout), `tsc --noEmit -p ${project} 无 error TS 行`)
}

// ③ 全量用例：判据用**结构性**信号，不写死条数。
const vitest = run('npx vitest run --root packages/sophia-core')
const passed = /Tests\s+(\d+) passed/.exec(vitest.stdout)?.[1]
const failed = /Tests\s+.*?(\d+) failed/.exec(vitest.stdout)?.[1]
const totalFiles = /Test Files\s+(\d+) passed/.exec(vitest.stdout)?.[1]
assert(vitest.code === 0, `vitest 退出码 0（实为 ${vitest.code}）`)
// ⚠ **不写死 `≥574`**（captain 派修 [26]）：用例数一涨就假红的判据是**负债**。
//   但也**不能**退化成「只要不为 0」——那是恒真门禁（本仓明令禁止）。
//   可用的**不随规模漂移**判据：
//   - 有失败数 ⇒ 直接红；
//   - 通过数为 0 ⇒ 红（「0 个测试通过」正是本仓记过的假绿形态：
//     测试文件没跑起来时 vitest 也可能 exit 0）；
//   - 至少有一个测试文件通过 ⇒ 说明确实收集到了用例。
assert(failed === undefined, `vitest 无失败用例（实为 ${failed ?? 0}）`)
assert(
  passed !== undefined && Number(passed) > 0,
  `vitest 有测试真的通过（实为 ${passed ?? '未解析到'}）—— 0 通过是「没跑起来」的假绿`,
)
assert(
  totalFiles !== undefined && Number(totalFiles) > 0,
  `vitest 至少收集到一个测试文件（实为 ${totalFiles ?? '未解析到'}）`,
)
assert(!/FAIL/.test(vitest.stdout), 'vitest 输出无 FAIL')

console.log(`\nsummary: tsc=${tsc.stdout.trim()} tests=${passed} passed`)
