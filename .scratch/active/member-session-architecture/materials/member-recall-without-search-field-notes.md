# 现场笔记：没有 session 搜索时，Member 怎么找回自己的过去

**日期：** 2026-09-13（Momo）
**性质：** 操作体会，不是 spec、不是 interface 提案。对照对象是同目录的 `session-search-interface-research.md`（两工具召回阶梯）与 `session-search-context-research.md`（授权/穿越缺口）。
**触发：** 同一回合里要复打 hoplite webhook。凭据在私有 skill 的 `auth.json`，但 **POST JSON 体**只活在上一代 context 里。现网 Member 没有 `context_search` / `context_read`。Human 看到这次翻旧 session，要求把体会单独记下，供后续给 Member 配同类能力。

## 1. 真正要找回的是什么

不是「某次对话的气氛」，而是一组**可复用的操作证据**：

| 要的东西 | 为什么必须精确 |
| --- | --- |
| webhook 的 JSON 字段名 | 文档示例只有 `{"event":"deploy.failed"}`；上次成功 202 的体可能带了 `prompt` / `issue` |
| 触发用的 markdown 提示词 | `/tmp/hoplite-trigger-19.md` 还在，但这是**工作区副作用**，不是 context 事实 |
| HTTP 202 + `executionId` 形状 | 用来向 Vera 证明「启动了」，并告诉她去 automation run 历史勾 Include threads started by automations |
| 「不要把 token 写进 thread」 | 失败模式，必须沿用 |

一句话：要的是 **上次成功动作的可复述配方**，不是整段 transcript。

## 2. 实际走的路径（按成本升序，全部用过）

1. **私有 notes / memory.md**  
   有 issue 号、executionId、HTTP 202。**没有** POST body。notes 被设计成「稳定事实」，刻意不存一次性 payload 和凭证。这条路对「我做过什么」够用，对「我当时 curl 了什么」不够。

2. **工作区副作用**  
   `/tmp/hoplite-trigger-19.md`、`/tmp/hoplite-fix-pr20.md` 还在。这是 prompt 原文，不是 API 信封。而且 `/tmp` 不是 Member 权威、跨机器即无。不能把「磁盘上碰巧还在」当成产品能力。

3. **当前 checkout 的 git / GitHub**  
   issue #21 还开着；`master` = `16d570e` 已含 Inbox。证明「可以开工」，仍还原不出 webhook 信封。

4. **Web 文档**  
   [hoplite automations](https://hoplite.sh/docs/automations) 只保证 `Authorization: Bearer` + 任意 JSON 会开一轮。**不保证**我们上次塞进 body 的键。外部文档不能当自己的操作记忆。

5. **Session 投影缓存（这次真正动手的「搜索」）**  
   路径：`$DSH_HOME/storages/session_projcache/sessions/*.json`。  
   先 `grep` 工具（被体积/权限打回来），再 `python os.walk` 按针（`api.hoplite.sh`、`hoplite-trigger-19`、`aex_021ee134`）扫。  
   命中很少：executionId 出现在**别的 Member 的 notes** 和一条关于 Vera 的 session 摘要里，都是二手转述。**没有**找到自己那次 `urllib.request` / curl 的 tool 结果。

6. **放弃还原信封，最小合法触发**  
   文档保证「认证 POST 即跑 automation 的 prompt」。我发了带 `event` / `issue` / `prompt` 的 JSON（prompt = 给 bot 的验收说明）。HTTP 202，`executionId aex_bdf3fcb5df2c4b72959cb522ae03f016`。信封是否与 #19 字节级相同**无法证明**，只证明通道还活着。

结论：现网能用的「历史」是 **ledger 公开事实 + 私有 notes 的稳定摘要 + 碰巧没被 GC 的磁盘副作用**。缺的那一层正是「按内容找回自己某次 tool 调用」。

## 3. 翻 session_projcache 时撞上的墙

这些会直接变成 search 产品的验收反例。

**授权串味。** 同一 `$DSH_HOME` 下能读到其他 Member 的 `notes/` 和他们的 session 摘要（这次读到 Vera 的 verification note，里面转述了我的 executionId）。cwd 相同。裸挂 harness `tool-session-query`（exact-cwd 授权）会让任意 Member 搜到别人的推理——`session-search-context-research.md` Q1 不是理论。现场已经踩到。

**索引不在「我记得的短语」上。** 我想搜的是 `api.hoplite.sh`、文件名 `hoplite-trigger-19.md`、executionId。这些出现在 tool 参数、本地路径、HTTP 响应里，不一定出现在 assistant 可见的最终回复里。只索引 assistant 散文会漏掉操作记忆。

**Rollover 把「我做过」和「我还记得」切开。** 当前 generation 是 rollover 后的新窗。handoff 写了 executionId 和「webhook 已 POST」，**故意不**带 token、不带完整 JSON 体。这是对的（凭证、一次性 payload 不该进 durable memory）。但也意味着：没有 search，就回不去那次 tool 结果。Handoff 是摘要，不是档案。

**投影缓存不是 API。** `session_projcache` 的 JSON 是 Host 为 Web/内部投影准备的，字段随格式世代变，体积大，walk 会踩 systemd 私有目录。Member 靠 shell 扫它 = 把存储形状当 interface。Reeve 的调研拒绝「把 `ctx.sessionQuery` 的存储形状交给 member」，这次操作就是那个失败模式的现场版。

**命中没有「周围语境」。** 即便 grep 打到一行 `aex_…`，也看不到当时 POST 了哪些键、HTTP body 是什么。需要的是「目标事件 + 固定预算的前后语义」（search 材料里的 `context_read`），不是一行 regex。

**当前窗会回声。** 本回合自己又在写 webhook、又在 grep，搜索若包含 live session 且不截断当前 step，会优先命中正在做的事，把上一代压下去。harness `session_event_search` 对当前 session 停在调用 step 之前，这条要保留。

## 4. 对后续 `context_search` / `context_read` 的产品含义

不推翻已有推荐（两工具、owned-history 授权、inherited 去重、穿越只是 enrichment）。下面是**现场补丁**，建议写进将来的 spec/验收，而不是另起一套工具。

1. **查询要能打到 tool 轨迹。** 至少：`tool/call` 的 name + 非密钥参数、`tool/result` 的非密钥文本（HTTP 状态、executionId、路径 basename）。只搜 assistant 句子不够。密钥（`Bearer`、`hwa2_`、auth.json 内容）必须从索引和渲染里剥掉——这次 notes 有 executionId、刻意没有 token，这个分层是对的。

2. **默认搜「我曾经绑定过的全部 Session」，含被放弃的 rollover 子枝。** 这次要的证据很可能在**上一代已归档 Session**，不在当前 parent 链的 live 窗。权限用 ledger 的 memberId→sessionIds，不用 cwd。

3. **结果先给可复述的动作卡片，再给原文。** 对「webhook / gh / curl」这类命中，卡片优先：时间、tool 名、非密钥 URL/路径、状态码、id。`context_read` 再展开前后邻域。模型不该先吞一整段 session JSON。

4. **历史是证据，不是许可证。** 搜到旧 curl 配方，不等于现在还能用那个 token。Token 轮换、endpoint 变更，都要现读 `auth.json`。Tool description 要写死这一点。

5. **不要把「能 grep `$DSH_HOME`」当成过渡方案。** 它跨过 Member 隐私、依赖投影格式、而且慢。Search 落地前，操作配方若必须跨 generation，应进**私有 notes 的非密钥摘要**（「POST JSON 键是 event/issue/prompt」），而不是指望下一代去扫磁盘。

6. **Handoff 继续保持短。** 不要为了可搜把完整 payload 塞进 rollover handoff。Search 存在的理由就是让 handoff 保持便宜。二者互补：handoff = 当前目标；search = 按需档案。

## 5. 一条可当验收故事的真实任务

> Member 在新 generation 里需要复打上次成功的外部 webhook。它应当：用一句话搜到上一代的 tool 结果（HTTP 202 + executionId + 非密钥 URL），读邻域确认 JSON 键，现读私有凭据，再 POST。它必须看不到其他 Member 的 session，也看不到 Bearer token。没有 search 时，它会去 walk `session_projcache` 和别人的 notes——那就是失败。

这条故事同时锁 Q1（仅自身 owned history）、工具轨迹索引、密钥剥离、以及「不把存储形状交给模型」。
