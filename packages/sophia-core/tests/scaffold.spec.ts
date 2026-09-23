import { describe, expect, it } from 'vitest'

import pkg from '../package.json'
import { SOPHIA_CORE_VERSION } from '../src/index.ts'

describe('@sophia/core 脚手架', () => {
  it('源码导出的版本与 package.json 的 version 一致', () => {
    // 非恒真断言：改动 index.ts 的常量或 package.json 的 version 任一侧，
    // 本用例即变红（已用反向自检实测：故意改成 9.9.9 后 vitest exit 1）。
    expect(SOPHIA_CORE_VERSION).toBe(pkg.version)
  })

  it('包名与包管理器识别一致', () => {
    expect(pkg.name).toBe('@sophia/core')
    expect(pkg.private).toBe(true)
    expect(pkg.type).toBe('module')
  })

  it('OCR [2]：声明了 engines.node（本包依赖 node:sqlite，非任意 Node 版本都能跑）', () => {
    // `ledger.ts` 直接 `import { DatabaseSync } from 'node:sqlite'` —— 该模块在
    // 较旧的 Node 上不存在（本机实测 v24.19.0 可用）。没有 `engines` 时，
    // 消费者在一个不支持的 Node 上只会拿到一个晦涩的模块解析错误。
    // 反恒真：删掉 package.json 的 engines 字段，本条必须变红。
    expect(pkg.engines?.node).toBe('>=24.0.0')
  })
})
