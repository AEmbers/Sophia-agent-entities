# Sophia-agent-entities · 端到端集成总验收报告（t7 总）

> 2026-09-24 · 队长（mimo-v2.6-pro 主线）收尾出具
> phase1（36 条 OCR 勾销 / 路径穿越 / FR-3.6 / 反恒真）见 `docs/VERIFY-t7-phase1.md`（星验主事2 出具，队长抽核 5 条关键判定属实）。
> 本文件是 phase2 总验收。`.md` 结构性拿不到 OCR 评审，仅供人眼复核。

## 一、总判定：**通过（可交付）**

797 用例 / 17 文件全绿、四门禁全绿、build 产物可出、5 个 sophia_* 工具结构化注册断言在位、createTeam 落账+幂等+派生全验、OCR review 45 文件 0 条意见。

## 二、验收证据（机器裁决 runId=sophia-t7-final）

| # | 声明 | 判据 | 结果 |
|---|---|---|---|
| 1 | tsc main 门禁 | `npx tsc --noEmit -p packages/sophia-core/tsconfig.json` exit 0 | ✅ |
| 2 | tsc client 门禁 | `tsconfig.client.json` exit 0 | ✅ |
| 3 | 全量测试 | vitest **17 files / 797 tests**（基线 786 ⇒ +11） | ✅ |
| 4 | 装配专项 | assembly.spec **8/8** | ✅ |
| 5 | build 产物 | `npm run build` exit 0，lib/host.js 45529B | ✅ |
| 6 | phase1 文档 | docs/VERIFY-t7-phase1.md 存在 | ✅ |
| 7 | OCR 评审 | review 模式 **45 文件被审 / 0 意见** | ✅ |
| 8 | 阳性对照 | 两组变异实验见下 | ✅ |

### 阳性对照（证明仪器能报错、断言非恒真）
1. **tsc 门禁**：注入 `export const broken: number = 'not a number'` ⇒ exit 2；删除 ⇒ exit 0。
2. **t9 用例**（t11 反恒真抽查）：spawn-team 守卫三元式替换为裸访问 ⇒ tools.spec **1 failed**；恢复原文（字节核对 44435B）⇒ **112 passed**。

## 三、装配层（t8）关键断言清单

- `assembly.spec.ts:302` **★ 5 个 sophia_* 工具结构化注册断言**（不得以未抛错作判据）—— 验收第 1 条达成
- `:166` createTeam 落账（team/created requestId 在基座 + team/member-added 含 model）
- `:244` 跨进程幂等（同 requestId 同 teamId 不追加事件）
- `:270` delegation 派生入口（临时团免审直建落账并查回）
- `:347` effect 可逆性（卸载注销全部 5 工具）
- `:373` 双服务访问方式（ctx.tools 属性 + ctx.get('tools')）
- `:399` 迟到挂载（internal/service 补挂）
- `:428` status 路由 surfaces 如实化

## 四、修复闭环（OCR 归档 36 条 + 4 族）

| 项 | 状态 |
|---|---|
| 族 A head().sequence 形状守卫（3 落点） | ✅ 全闭合（task-claim / host-data ×2） |
| 族 B caller/收件人 fail-closed（4 落点） | ✅ 全闭合（含 t9 修 [18] spawn-team，t11 变异抽查过） |
| 族 C JSON.stringify 无保护（2 落点） | ✅ 全闭合（t10 safeStringify，队长抽核 12 处构成） |
| 族 D surfaces 标记对称 | ✅ 已修（client styles/locale） |
| 全 36 条 | 已修 20+ / 待修 13 条 LOW（文档/死代码级，判「可不做批次」暂缓，清单在 phase1 文档） / 误报 1（[21] 有反证）/ 落点在他人 1 |

## 五、诚实边界（写清楚，不藏）

1. **OCR 的 429 窗口**：t9/t10 修复时撞上共享配额冷却，当时的「评审」以人眼+变异替代（t11 的变异抽查补上了机器级证伪）；最终 OCR review（45 文件 0 意见）覆盖了全部改动文件，闭环。
2. **verify-plugin.mjs 两条警示均判模拟器缺陷**（依据）：
   - `inject 无 "tools"`：设计内 —— t1 结论 `inject: []` + `ctx.get()` 惰性探测 + `internal/service` 迟到补挂（assembly.spec:373/:399 覆盖）；mock 无 tools 服务时**如实降级 0 注册**是设计行为。
   - `ctx.on is not a function`：mock ctx 不完整 —— `ctx.on` 是 cordis 内置（verify-plugin 自己的静态检查输出「属 cordis 内置（get, effect, on）」）；真实 DSH 的 cordis ctx 有 `.on()`（各已装插件同用法）。
3. **真 Agent 底座**：createDefaultMemberRuntime 在无真实 Agent substrate 时走**如实降级桩**（注释标明「真 Agent 底座待宿主接线」），未伪造激活。
4. **FR-3.6 边界**（phase1 已审）：「**DSH 运行期间**窗口关了团照常干活」为真；DSH 退出则不行 —— 各文档措辞无夸大。
5. **13 条 LOW 待修**按收尾口径暂缓（AGENTS.md 五）：不影响「打开就能用」，避免收尾期 diff 互相搅；清单与责任人划分在 phase1 文档 §勾销表。

## 六、交付清单

- `src/host-assembly.ts`（装配层：createTeam / delegation deps / projection ports / runtime / caller 解析）
- `src/host.ts`（工具注册 mountToolsSync + tryMountTools 惰性探测 + 迟到补挂 + 4 路由 + status 如实化）
- `src/tools/`（5 工具定义层，spawn-team 含 t9 守卫）
- `src/runtime/member-runtime.ts`（t10 safeStringify never-throws 闭环）
- `src/client/`（12 源文件 UI + panel-store anomaly 消费）
- `tests/`（17 文件 797 用例）+ `docs/`（SPEC / REQUIREMENTS / SPIKE / OCR 归档 / VERIFY ×2）

## 七、残余风险（继承自 SPEC/phase1，不变）

R1 跨进程并发审批需 requestId 唯一索引；R2 派生范围缺口（spawn-ticket）；R3 幂等表不回收；R4 pending-principal 无账本事实；R5 sequence-mismatch 读写过期 from 捕不到。
