# Session fold 增量（07 续作）

本工作项是已归档 `team-perf` 的 **07** 的续作。归档原则要求不复活 `archive/2026-09/team-perf/`，所以票面在 [`issues/01-session-fold-incremental.md`](issues/01-session-fold-incremental.md) 重新落一份，**原文要求一字不改**；`archive/` 里那份保持历史原样。

## Status

closed 2026-09-14 — 07 当日落地、**Vera 独立验收通过**，终态 tip **`bf4c172`**（`perf: fold Session projections incrementally instead of per event`，11 路径，父 `cdf4dcf`）。把本目录从 `active/` 折进 `archive/2026-09/` 的那次 amend 只动 `.scratch/**`，**代码树逐字节等于 Vera 验收过的树**（判据 `git diff --name-only bf4c172 <tip> -- packages docs CHANGELOG.md package.json` 为空）。以下为归档时的历史状态。

active — 2026-09-14 开工并当日落地 `bf4c172`。01–06 与本票在归档 `team-perf` 里是同一序列；Human 2026-09-14 09:35 拍「把 07 一并做了」。

last-checked: 2026-09-14。开工时基线：本地 master `cdf4dcf`（未推），代码树逐字节等于浏览器 lane 转绿时验证过的 `564c7de`（01–06 + lane 修复已由 Vera 独立验收）。

## Current frontier

- **Tars 已交付 `bf4c172`**（`perf: fold Session projections incrementally instead of per event`，11 路径，父 `cdf4dcf`）：新模块 `session-event-cursor.ts` + 三处接线 + CHANGELOG/architecture 双语。门禁：`npm test` 597 passed / 1 skipped、build RC=0、typecheck RC=0、lint 0/0、`check:docs` OK。**未跑 `test:browser`**（只碰 server 侧源码，与 Vera 的口径一致）。
- **Vera 独立验收通过**（claim `b1943d76`，2026-09-14 09:58，在 `bf4c172` 自己的树上整套重跑）：① 三指纹逐字相同，且比的是**生产本体**（从模块导出加载 `contextProjectionFold(sessionId)` 与 `PRESSURE_NOTICE_FOLD`，与她的重建互校相同）；② 继承前缀（rollover 槽位）四档 k=1/5,000/18,980/18,983 与 pre-07 legacy oracle **逐键相同**；③ 真实 148 个 turn 逐次增量折，在 turn 10/50/100/148 采样点 `cursor.value` 逐字等于该前缀的全量重折；④ 守卫四臂（type 变 / 长度缩 / `logFrom` 变 / 追加）全部等于新日志的全量重折；⑤ 具名残留三票**见证到**（context seq 8、clock seq 18,980 改 `time`、pressure 剥掉 2 条 notice ⇒ 放行且锚点事件逐字未变）。
- **加分项曲线（Vera 交错 before→after→before，生产形状）**：before 全折 0.143 / 0.691 / 1.790 ms（n=1,898 / 9,491 / 18,983，12.5×）；after 一回合只折尾巴，n=18,983 档 **1.790 → 0.015 ms**，且代价跟尾巴走、不跟日志走。**两套尺子别混**：Tars 那套纯步进（0.0021 / 0.0025 / 0.0038 ms）不含每回合真读 `ownEvents()` 与绝对坐标，量级天然低一档。
- **无 blocker**；**未 push** —— 三条 `a84aada` + `cdf4dcf` + `bf4c172` 在共享树 master 上、相对 GitHub `423c234` ahead 3、fast-forward、无需 force，推令在 Human。

## 未纳入本票（记录在案）

- `progress-nudge.ts` 的 `recoverClaimSuggestions` **有意保留整表扫，不是「没做完的半条」**：Vera 给了量测口径并核过——它只在 **generation 切换**时跑（`state.sessionId !== sessionId`，一代一次），每 commit 调用的 `reconcileAll()` 只遍历**有 pending notice 的 member**、不碰日志；同档 pressure 全扫 18,983 事件 = 0.16–0.23 ms ⇒ 非热路径，没有可量的收益。
- 探针（真会话副本 + 真实读路径）是临时文件，跑完即删，不进 commit；副本在 `/tmp/tars/p07root`。

## 目标与语义约束

三处热点都是「每来一个事件就重折整个会话历史」：

| 调用点 | 现状 | 频率 |
| --- | --- | --- |
| `ContextManagementCoordinator` 的 `projectionForMember` | 全量 `foldContextProjection(ownEvents())` | 每次成功 `tool/result` 与 `turn/end` |
| `member-time-context.ts` 的 clock baseline | 全量 `foldClockBaseline(ownEvents())` | **每个 pre-step** |
| `pressure-policy.ts` 的 `noticeDelivered` | 全扫 `ownEvents()` 找 notice | 每步 |
| `progress-nudge.ts` 的 `recoverClaimSuggestions` | 全扫 `log.events` | reconcile 时 |

**判据不是「快了多少」，是曲线形状**：before 实测 context 单折随事件数线性涨（1,898 → 0.13 ms、9,491 → 1.14、18,983 → 2.94，≈0.155 µs/事件），after 两档应落进彼此噪声内。同树 A/A 噪声可达 −56%，**不看细比值**。

**语义必须先冻结再改**（after 必须逐字相同）：`contextProjection = 9a9aa149e65ee394`、`clockBaseline = cacb7ad86314fb75`、`pressureDelivered = true`。

**身份守卫**：游标不只看 `foldedThrough` 这个位置，还要比该位置事件的 `(seq, type)`；失配即从 `logFrom` 整体重折，而不是接在旧尾巴上。这样 rollover / fork / 恢复路径最坏只退化成今天的成本，不会拿到错画面。

## 完成条件

- 三处调用点的 fold 成本与**新增事件数**相关、与会话总长基本无关；曲线变平有绝对量证据。
- 三个语义指纹逐字相同；rollover / compact / 恢复路径行为不变。
- 变动只影响 Session 侧投影，不触碰 ledger 权威与记录级校验。
- Vera 独立验收通过（含对抗臂：同长度不同内容的事件列表必须触发全量重折）。

## 正式文档出口

- `CHANGELOG.md` [Unreleased] 追加一条。
- 若游标的语义（尤其身份守卫与退化规则）成为对外可依赖的契约，进 `docs/architecture.md` 与 `docs/architecture.zh.md` 同一句。
- 本目录收尾时作为纯移动（R100）折进 `archive/2026-09/`。
