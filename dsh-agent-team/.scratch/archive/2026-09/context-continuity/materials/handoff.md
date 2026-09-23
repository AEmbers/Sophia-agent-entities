> 迁入自 `packages/context-continuity/HANDOFF.md`（2026-09-21，原孵化目录已删除）。抽取工作的任务书与顺序，保留作为过程出处；其中当时的路径、行数与状态只代表当时。

# Handoff: 把 context-continuity 独立成 `dsh-context-continuity` 插件

**状态:** 通用引擎核心已写成并通过类型检查,尚未写测试、尚未独立成库、尚未接入 Team。
**目标读者:** 接手把本包拆成独立 DSH 插件项目的人。
**写于:** dsh-agent-team 仓库内的 `packages/context-continuity/`(就地孵化产物)。

---

## 1. 这是什么,为什么做

`dsh-agent-team` 里发明了一套"一个主体跨多个物理 Session、可回溯的连续 context 一生"的机制:
`context_rollover`(向前换新场继续同一身份)、`context_checkpoint`(埋可回锚点)、
`context_timeline`(游走自己的谱系)、以及待做的 session search 召回。

这套机制不是 Team 独有需求。任何"活得比单个 model session 长"的主体都需要它:

| 消费者 | 主体(Subject) | 领域锚点(domain anchor) |
| --- | --- | --- |
| dsh-agent-team | Member | team_message / claim / thread 首达 |
| Loom | Individual | Input / Effect / Delivery |
| 长任务 coding agent | 一个 agent | commit / 测试通过 / 里程碑 |
| 写作 agent | 一个 draft 主体 | 章节完成 / 大纲定稿 |

**任务:把这套机制抽成独立插件 `@wowyuarm/dsh-context-continuity`**,Team 和 Loom 都作为外部依赖引用它。
本包(`packages/context-continuity/`)是就地孵化的引擎核心,拆库时整体搬过去。

## 2. Core-gap 判定(已核实,决定抽什么/不抽什么)

用官方 `dsh-developer` 的 `knowledge` 查过 DSH 本体,结论:

```
  能力                          DSH 本体状态          处置
  ───────────────────────      ─────────────────    ──────────────────────
  session fork/seed             原生 (SessionStore   直接复用,不抽
                                .create({seed,meta}) )
  session header 谱系            原生 (parentSession   直接复用
                                / seedLength)
  session 全文检索               原生但默认关          复用 provider,只做授权+两工具封装
                                (dsh-session-query    不造第二索引
                                -sqlite, openAt:never)
  session 投影框架               原生                  ★ 投影 fold 应做成
                                (dsh-session-          ProjectionDefinition 插进它,
                                projection)            不要自己手写驱动(见 §5)
  rollover/checkpoint/timeline   ✗ 本体没有,只在        ← 这才是真 core-gap,本包拥有
  作为"连续一生"语义             dsh-agent-team
```

结论:引擎提供"连续性语义",底层机制全部复用 DSH 原生能力。

## 3. 已完成的真实状态(可直接搬)

`packages/context-continuity/src/`,共 ~1018 行,**已通过 `tsc --noEmit`(exit 0),对 Team 零 import(包边界检查通过)**:

| 文件 | 职责 | 复用/新增 |
| --- | --- | --- |
| `host.ts` | `ContextContinuityHost<SubjectId>` hook 接口——引擎向 host 要的全部东西 | 新增(核心抽象) |
| `types.ts` | `ContextSubject` / `TransitionPlan` / `RolloverIdentity` / `RolloverTrigger` | 新增 |
| `projection-state.ts` | 投影状态类型 + `DomainBoundary`(领域锚点抽象) + `continuationDelivered` | 类型完成,fold 待改造 |
| `message-codec.ts` | handoff / 续接消息编解码,pluginId + 文案参数化 | 复用 DSH 消息格式 |
| `coordinator.ts` | rollover 生命周期:idle 边界切换 / admission gate / carried input / checkpoint 续接 / 崩溃恢复 | 新增(harness 无) |
| `stored-session-reader.ts` | 读取 seam + 5 类 typed failure(missing/refused/corrupt/io/unknown) | 复用 DSH persistence |
| `index.ts` | 出口 | — |

### 核心设计决策(已定,别推翻,除非有新证据)

1. **领域锚点走 host 提供的 fold 片段,不做"标签器"。** 因为 Team 的"恰好归属一个 topic 才是可选默认锚点"这类规则需要读事件语义。通用投影状态里,checkpoint/pending/continuation/carried/turn 游标由引擎拥有;`DomainBoundary` 由 host 贡献(带 `kind`/`label`/`attributions`)。
2. **命名方案归 host。** rollover 的 session id 命名和幂等 requestId 是持久性领域关切,引擎不拥有——通过 `host.rolloverIdentity(previousSessionId, toolCallId)` 注入。Team 原来是 `agent-team-rollover-${sha256(...)}`。
3. **codec 参数化 pluginId + 两句文案。** section 名(HANDOFF / Previous session 等)是**固定的**,因为要从历史日志读回——host 不能改,否则解不了自己的历史。pluginId 是 host 的持久身份,必须跨自己的世代保持不变。
4. **coordinator 不关心 fold 怎么实现。** 它通过 `host.projectionForSubject()` 拿 state,state 来自手写 fold 还是 harness 框架是 host 的事。所以 coordinator/codec 的测试不受 projection 重构影响。

## 4. 待做的工作(按顺序)

### 步骤 1:建独立项目
- `~/projects/dsh-context-continuity`,独立 git repo。
- `package.json` 依赖**发布的** `@deepseek-ai/dsh-*` npm 包(带预编译 lib),**不要**像 dsh-agent-team 那样指向 harness 源码树 checkout。
- 包名 `@wowyuarm/dsh-context-continuity`(scope 与 dsh-agent-team 一致)。
- 参考 dsh-agent-team 的 tsconfig / vitest / 边界检查约定,但去掉 harness-源码-树的依赖。

### 步骤 2:搬 6 个模块
- 整体复制 `packages/context-continuity/src/` 过去。
- 改 `@module` 注释里的路径(现在写的是 `@wowyuarm/dsh-agent-team/context-continuity/*`)。

### 步骤 3:先写测试(独立项目里秒级,不吃 §6 的 8 分钟)
- `message-codec`:handoff 往返(encode→decode 字段不丢)、optional 字段缺省、legacy `', '` 相关文件解码、pluginId 隔离(别的插件同名 section 不误判)、handoff/续接不互串。
- `coordinator`(mock host + mock agent):
  - rollover 只在 intent result 持久 + turn idle 后才 swap;
  - 结果 seq 不匹配的 tool result 被忽略;errored result 被忽略;
  - 真实输入 carried 过 swap、ephemeral notice 被丢;
  - 每个已解析 checkpoint 恰好一次续接、重复 turn/end 不重投;未解析 checkpoint 不续接;
  - `recoverPendingTransition` 崩溃恢复两分支(turn 未结束 vs 已结束)。

### 步骤 4:投影 fold 改造(§5)
把 `projection-state.ts` 的手写状态改造成 `dsh-session-projection` 的 `ProjectionDefinition`。

### 步骤 5:timeline 工具 + search(独立增量)
- `context_timeline`:谱系游走(顺 parentSession 拼多文件为一条线)、return-anchor 统一策略。
- search 两工具阶梯(`context_search` / `context_read`):见 dsh-agent-team 的
  `.scratch/active/member-session-architecture/`(read seam / return-anchor / owned-history 授权设计已收敛)。

### 步骤 6:Team 接入(等主线通知后再做)
Team 实现 `ContextContinuityHost<MemberId>`,删除自己的 context-management/context-source 副本,改为消费本包。
**验收:Team 现有测试全绿、行为不变**(这是硬约束)。这步在能跑 Team 完整测试的环境里做。

## 5. 投影 fold 改造要点

DSH 自带 `dsh-session-projection`:domain 只提供纯 fold(`ProjectionDefinition`:`init`/`apply`/可选 `wire`/`stateVersion`),
harness 负责驱动它过每个已提交事件、维护 per-session watermark 缓存、持久化状态、发变更通知。约束:
- `apply` 必须同步、state 必须纯 JSON;
- 不感兴趣的事件必须返回**同一个 state 引用**(`Object.is`),否则触发无谓下游工作;
- state 变更时 `stateVersion` bump,让旧缓存失效。

Team 的 `packages/agent-team/src/context-projection.ts` 已经在用这个框架,是可参考的现成实现(注意它混了 Team 专属锚点,通用化时锚点部分要抽给 host)。

## 6. 环境坑(实测)

- **dsh-agent-team 的 vitest 冷启动 ~8 分钟**:它的 vitest 配置把整棵 sibling `deepseek-harness` 源码树实时转译。独立项目依赖发布的 npm 包就没这问题,测试秒级。这是独立成库的一个实际收益。
- **`../deepseek-harness` sibling 曾经工作树为空**(只剩 .git),`scripts/sync-paths.mjs` 跑不了;已 `git checkout` 恢复到 `dsh-v0.1.5-rc.2` tag。独立项目不依赖它。
- **官方开发工具 `dsh-developer`** 已作为 pi skill 装好,`knowledge`(查精确 DSH 源码)/`verify`(一次性 profile 跑工具比对)/`dev`(起 Web UI 自检)可用。真机验收用得上。

## 7. 参考坐标

- 现成实现: `packages/agent-team/src/` 里的 `context-management.ts` / `context-projection.ts` / `context-source.ts` / `pressure-policy.ts` / `stored-session-reader.ts`(本包就是从这几个泛型化来的)。
- search 设计: `.scratch/active/member-session-architecture/README.md` + `spec.md` + `materials/session-search-interface-research.md`(两工具召回阶梯 `context_search`/`context_read`,复用 harness sessionQuery)。
- 工具契约: `packages/tool-agent-team/src/context-tools.ts`(三个 context_* 工具的模型面描述)。
