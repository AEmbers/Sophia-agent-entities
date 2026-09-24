# SPIKE — 常驻调度体：窗口关了团还能干活吗

> **任务**：t6 [spike]，本项目最大技术风险。
> **性质**：调研 + 最小验证。**未改任何实现文件**（除本报告）。
> **结论先行**：**可行**。机制层面已验证到底（含冷启动唤醒真实成员）。
> 真正的约束不是「有没有机制」，而是**会话写锁跨进程独占**与**上游调度器把每次 kick
> 都绑在 `captainSessionId` 的 live agent 上** —— 两者都有解，但决定了唯一可行的形态。

---

## 0. 证据标注约定

本文凡出现结论，都带强度标注。**没验的就写没验，不写成实测**。

| 标注 | 含义 |
|---|---|
| `[实测]` | 本机跑过，附命令与逐字输出 |
| `[实测-窄]` | 跑过，但被测对象与生产形态有明确差异（差异已写出） |
| `[源码]` | 读源码得出，附 `文件:行号`；未运行 |
| `[推断]` | 由 `[实测]`/`[源码]` 推导，**未独立验证** |
| `[未验证]` | 明确没验，且写出怎么验 |

本报告的机器事实**只对以下指纹负责**（`~/.dsh/AGENTS.md` 第三节要求：断言前先固定被测对象）。

### 环境指纹

| 对象 | 取值 |
|---|---|
| DSH Desktop | `dsh-plugin-desktop` **2.0.13** |
| `@nanmicoder/dsh-agent-teams` | **0.1.20**（`~/.dsh/profiles/desktop/node_modules/`） |
| node（宿主） | v24.18.1（Desktop 日志）/ v24.19.0（spike 宿主） |
| electron | 43.3.0 |
| `resources/app/lib/main.js` | bytes=206125　sha256=`844AFC7E132A2971EF3F59F944C2EAB2C6C6A533248C74C0758D9FB85CBFB4F5`　mtime=2026-09-19T17:13:54 |
| `resources/app/lib/electron-runtime-CHyIF9_h.js` | bytes=129192　sha256=`1CD63FD62CB07655A0546C5A3B482DDD4C1CBAA505B87AED156D2815EF44AA1E`　mtime=2026-09-19T17:13:54 |

### ⚠️ 证据留存实况（先说清楚，避免读者去找一个不存在的文件）

本 spike 最终**删掉了一次性 profile**（§附）。因此：

- **探针自己的输出** `resident-probe.jsonl`（含下表引用的 `drive-start` / `drive-done` 行）
  与 fixture 账本，**随 profile 一起被删，现已不存在**。删除前记录到的指纹是
  bytes=7240　sha256=`6E3C235C8F6A639FD20915047AEEAA632BACE7E94AC788287D7E407298DBCA15`。
  **该文件不可再核验** —— 本文引用它的行时，请按「已删除产物的历史快照」看待。
- **会话日志（地面真相）活下来了**，且**可独立核验**。它们是比探针自述更强的证据：
  探针可能报告错（本 spike 就发生过两次，见 §4.3），但会话日志是框架自己写的。
| 会话（关键几条） | bytes | sha256 |
|---|---|---|
| `t6-parent-1790161913239`（Run A/B 的父会话） | 7651 | `3D8D1061DBB01C3CBD1E7DB41BD42CF30C056150070D4FC6937A5E6F6AA60091` |
| `b668e1f4-6b40-4ea9-94ec-aac671c7aaa2`（**被常驻体唤醒的成员**） | 6195 | `C2D5054BE680DA6464C74BFB8D7D772CC4E2BD601896E2ADD42B917CEC2974F2` |

它们位于 `~/.dsh/sessions/--C-Users-Administrator-.dsh-profiles-t6spike--/<会话id>/session.v3.jsonl.zstd`。
核验方式（Windows 上该文件是**多帧 zstd**，node 的 `zstdDecompressSync` 只解第一帧，
必须用 CLI）：

```powershell
& "$env:USERPROFILE\miniconda3\Library\bin\zstd.exe" -d -c "<上面的路径>"
```

> 上面这条「多帧」不是猜的：`[实测]` 用 node `zstdDecompressSync` 解同一个文件只得到
> **1 条**事件（`{"type":"session",...}`，258 bytes），而 `zstd.exe -d -c` 解出 **29 行**。
> 谁若用 node 核对，会误以为日志是空的。

### 复现方式（spike 用完即删，见文末「附」）

一次性 profile `~/.dsh/profiles/t6spike`（从 web 模板生成），挂一个探针插件：

```yaml
# ~/.dsh/profiles/t6spike/cordis.patch.yml
- insert:
    - id: t6-resident-probe
      name: './plugins/t6-resident/index.js'
```

宿主以**完全无窗口**的方式启动（纯 node，无 Electron、无 BrowserWindow）：

```powershell
node "<app>\node_modules\@deepseek-ai\dsh\lib\bin.js" --profile t6spike --no-open --port 0
# 逐字输出：dsh web: http://127.0.0.1:65513/?token=foo75aj3K7WsIqU0TYzvA2GWr2NljYyYOOVVmyqf4qE
```

探针自身报告 `processType: null`、`electron: null` — **确认无渲染进程参与**（对照：Electron
renderer 会报 `process.type === 'renderer'`）。

---

## 1. 结论（直接回答任务三问）

### 1.1 「窗口关了」到底关了什么 —— 先纠正问题前提

**`[源码]`（**未实测**，见下方强度声明）：在 DSH Desktop 上，点 X 关窗口 ≠ 退出应用，
DSH 宿主进程继续存活。**

> **强度声明（先说清楚）**：我**没有真的去关用户正在用的那个窗口**——那会打断正在进行的工作，
> 风险不对称，我不做。所以本节三条全部是**读源码 + 读当前进程树**得来的 `[源码]`/`[实测-窄]`，
> 不是「我关了窗，然后看宿主还在」。**真正验证这一点只需一条人眼观察**：
> 点 X 后看托盘图标是否还在、任务管理器里 `DSH Desktop.exe` 是否还在 —— 建议 t7 顺手确认。

- `main.js:3322` 逐字：`const windowAllClosed = () => {};`
  这是个**空函数**并注册给 `app.on("window-all-closed", windowAllClosed)`（`main.js:3326`）。
  Electron 默认「所有窗口关闭即退出」的行为被这行**刻意抑制**掉。
  `[实测-窄]`：该注册调用在 `main.js:3890`（`removeShutdownRequests = installShutdownRequests(...)`），
  位于顶层启动流程、**不在任何 `if`/`try` 内**（已向上扫描 40 行确认无包裹分支）。
- `electron-runtime-CHyIF9_h.js:1462-1480` 的 close 处理器逐字：
  ```js
  const close = (event) => {
      persistWindowState();
      if (this.options.isQuitting()) return;
      event.preventDefault();
      ...
      window.hide();          // L1479
  };
  ```
  ⇒ 关窗只是 **`hide()`**，`BrowserWindow` 根本没被 destroy。

- `[实测]` 进程树（本机当时实况）：宿主是一个**独立于窗口**的 utility 进程：
  ```
  PID 7572 [DSH Desktop.exe]              <- Electron main
    PID 11028  utility ...NodeService     <- DSH Host（宿主）
    PID 27288  renderer                   <- 窗口（可被 hide/destroy）
    PID 32680  renderer
  ```
  `main.js:64`：`const child = utilityProcess.fork(.../host-process-entry.js, [], {...})`
  —— **宿主是 main 的子进程，不是 renderer 的子进程**。
  这条是**关键**：它说明「宿主存活与否」与「窗口存活与否」在**进程结构上就无关**，
  所以 §1.1 的结论对渲染进程的实际状态不敏感。

> **这一条本身就是对 task 原话的修正**：`types.ts:248` 的 `captainSessionId` 把团队绑在
> **会话**上，而不是绑在**窗口**上。窗口隐藏时宿主仍在跑，会话仍在内存里。
> 「窗口关了团变僵尸」的真凶**不是窗口关闭**，而是下面 §3.1 的 kick 触发点。

### 1.2 三问结论

| # | 问题 | 结论 | 依据强度 |
|---|---|---|---|
| 1 | DSH 里有哪些机制能在窗口关闭后继续跑？ | **有**，且有多条；最小可用的是**宿主内 plugin 的 fiber 自持定时器** | `[实测]`（**无窗口**宿主里定时器照常跑；「点 X 后的进程存活」是 `[源码]`，见 §1.1 强度声明） |
| 2 | 账本做「拉模式」常驻轮询，能扫未完成工作吗？ | **能**，已真实读到账本并算出 ready 集 | `[实测]` |
| 3 | 不依附窗口的驱动体，能把待办事实变成成员被唤醒吗？ | **能**，已真实跑通（跨进程冷启动） | `[实测]` |

> 注意第 1 行的口径：我实测的是「**一个从启动起就没有任何窗口**的宿主能跑常驻定时器」，
> 这比「关了窗之后还能跑」**更强**（无窗口是关窗的极限情形）。而「关窗 = hide 而非退出」
> 这一环是**读源码**（§1.1），两者合起来才是我敢下「窗口关了团还能干活」的完整依据。

**最终判定：可行。** 但「可行」不等于「照抄一个 setInterval 就行」—— 有两个硬约束（§3），
以及一条**能力边界**必须写进需求（§5）。

---

## 2. 机制清点（问题 1）

按「能否在窗口关闭后继续跑」排序，全部给出源码位置。

| 机制 | 位置 | 窗口关了还跑吗 | 本 spike 是否采用 |
|---|---|---|---|
| **宿主内 plugin 的 `ctx.interval` / `ctx.timeout`** | `cordis-plugin-timer/src/index.ts` | ✅ 绑 fiber，不绑会话 | ✅ **采用**（主方案）|
| `ctx.on('agent/status')` 事件驱动 | `dsh-agent/lib/index.js:215-249` | ✅ 宿主级事件 | ✅ 增强用（§6.2）|
| `ctx.agents.resume()` 冷恢复 | `dsh-agent/lib/index.js:430`；`dsh-agent-loop/lib/index.js:1876` | ✅ 从磁盘恢复 | ✅ **采用**（唤醒前置）|
| `ctx.subagents` 投递 / 冷恢复子会话 | `dsh-subagent/lib/index.js:2898`、`:1796` | ✅ | ✅ 采用 |
| **`ctx.jobs`（后台 job）** | `dsh-jobs/lib/index.js:58`；`dsh-jobs-local` | ⚠️ **owner 相对** | ❌ 不采用（§2.1）|
| `@deepseek-ai/dsh-goal-round-driver` | `lib/index.js`（`readyToDrive`） | ❌ **绑 live agent** | ❌ 参照物（§2.2）|
| Electron 侧常驻（tray 等） | `electron-runtime-CHyIF9_h.js:1626` | ✅ 但**不是插件面** | ❌ 越界 |

### 2.1 为什么不用 `ctx.jobs`

`dsh-jobs/lib/index.js:53-56` 的契约（逐字）：*"One registry serves every composition in the
process, so this question — and completion-listener delivery — is owner-relative rather than
process-wide: registrations made from an unscoped context serve every owner"*。

⇒ job 是**归属相对**的：要么挂在某个 owner（→ 又绑回会话），要么做成 unscoped（→ 归属语义含糊）。
而我们的驱动体需要的是**进程级、无条件、周期性**的心跳 —— 这正是 `ctx.interval` 的语义。
`[推断]`：jobs 并非不可用，但对本需求是更重且语义不贴的选择，未做 PoC 对比。

### 2.2 `goal-round-driver` 是**反面参照物**，值得记一笔

它的 `readyToDrive(state)` 逐字要求：

```js
return ctx.fiber.state === 2 && !state.stopping
  && ctx.agents.get(state.agent.id) === state.agent   // ← 必须 exact live agent
  && state.agent.status === "idle" && !state.competingQueued;
```

**它和上游 AgentTeams 调度器犯的是同一个错**：把「有没有人在驱动」绑在**某个 live agent**
上。区别只是它绑的是自己的 goal agent，AgentTeams 绑的是 `captainSessionId`。
⇒ 这不是「上游没做好」，而是**这类设计普遍会踩的坑**；我们必须在架构上显式绕开。

### 2.3 一个必须澄清的现场矛盾：`ctx.timeout` 在文件插件里到底有没有？

本机 `~/.dsh/profiles/desktop/plugins/dsh-agy-see/index.js:759-765` 有条自检，注释逐字写着：

> `// 这条探测是**教训固化**：文件插件里 ctx.timeout === undefined，`
> `// 调它会让整个 runPs 炸成 "Cannot read properties of undefined (reading 'includes')"。`

**我的实测与这条注释冲突。** `[实测]` 探针（文件插件，`cordis.patch.yml` 以
`./plugins/t6-resident/index.js` 挂载，`inject: ['timer']`）逐字输出：

```json
{"event":"timer-surface","typeofInterval":"function","typeofTimeout":"function","typeofTimerService":"object","injectList":["timer"]}
```

⇒ **在本机 2.0.13 上，文件插件里 `ctx.timeout` 是 function**，且 `ctx.interval` / `ctx.timeout`
都真的触发了（`ctx.interval` 计到 25 / 31 次 tick，`ctx.timeout` 在 5000ms 处 fire 出
`setup-done`）。我以**直接测量**为准，并提示：那条注释可能是更早 rc 的结论，或与被测上下文
不同；**建议 t7 集成验证时顺手复测**（这条会影响任何人写的文件插件定时逻辑）。

> 附带一条本 spike 自己踩的坑：ESM 插件里**没有 `module`**。我一度在 `apply` 里读
> `module.exports.inject`，整个插件挂载失败：
> `ReferenceError: module is not defined at new apply (.../t6-resident/index.js:154:34)`
> —— 好消息是 loader **fail loud**（报错打出完整插件路径），不是静默跳过。

---

## 3. 两个硬约束（本 spike 最有价值的发现）

### 3.1 约束 A：上游每次 kick 都要求「captain 的 live agent」

`dsh-agent-teams/src/scheduler.ts` 逐字：

```ts
// L178-181
function liveCaptain(ctx: Context, captainSessionId: string, supplied?: Agent): Agent | undefined {
  if (supplied !== undefined && supplied.id === captainSessionId) return supplied
  return ctx.agents.get(captainSessionId as SessionId)
}
// L292-294（kickTeam 内）
const captain = liveCaptain(ctx, team.captainSessionId, suppliedCaptain)
if (captain === undefined) return          // ← 没有 live captain，直接静默返回
// L306-307（kickMember 内）同样
```

而 **`kickTeam`/`kickMember` 的全部触发点都在工具调用里**（`src/tools.ts` 的
L433/614/818/996/1132/1188/1350/1471/1778/1993/2163）+ 一条 `agent/status` 监听
（`scheduler.ts:510`）。

⇒ **结论**：上游调度器**没有任何自主心跳**。它只在「有人调工具」或「某个 agent 状态翻转」时
才动。这就是 `docs/usage.md:146` 自称的「调度是事件驱动而非常驻轮询；队长离线时无法冷恢复成员」。

**对我们的意义**：我们要的驱动体**必须自己造**，且它必须能让 `ctx.agents.get(captainSessionId)`
返回一个 live agent —— 这就直接推到约束 B 的解法：**先 resume 父会话**。

### 3.2 约束 B（本 spike 挖出的、文档里没有的）：会话写锁**跨进程独占**

`[实测]` 两个独立 spike 宿主，先后 resume **同一个** parent 会话：

```
host1 (pid 29912) → {"event":"hold-acquired","parent":"t6-parent-1790161363655","restored":28}
host2 (pid 27856) → {"event":"hold-failed","error":"session \"t6-parent-1790161363655\" is already owned by an active write handle"}
```

`[源码]` 锁实现（`dsh-session-persistence-jsonl/lib/index.js`）：

- L545-550 契约逐字：*"Acquire the session write lock as a named kernel semaphore (count 1)
  whose name is derived from the canonical lock path. A kernel object never touches the
  filesystem ... a second acquirer's zero-timeout wait times out (`EBUSY`)"*
- L557 名字：`` `Local\\dsh-session-lock-${sha256(resolve(path).toLowerCase())}` ``
- L313：`claimWrite(id)` → 已有 writer 则抛 `SessionAlreadyOwnedError`

⇒ **同一时刻，一个会话的写句柄只能被一个进程持有。**

**这条约束直接否决了一种看起来很自然的方案**：「另起一个常驻 node 进程，定期扫账本唤成员」。
因为那些成员会话的写锁**正被 DSH 宿主握着**（本机实况：团队成员正在干活，见 §1.1 进程树）。

**可行形态因此收敛为两种**（§4）：

| 形态 | 锁冲突 | 说明 |
|---|---|---|
| **A. 宿主内常驻插件** | ✅ 无（同进程） | **推荐**。已 `[实测]` |
| B. 独立外部进程 | ❌ **必然冲突** | 仅当宿主没加载这些会话时才成立（真 headless 部署） |

---

## 4. 最小实现路径（问题 3 的答案）

### 4.1 已验证的完整链路

`[实测]` 两次运行，宿主均**完全无窗口**。证据文件
`~/.dsh/profiles/t6spike/resident-probe.jsonl`（sha256 见 §0）。

**Run A** — 建立 fixture：父会话 + 一个 durable continuable 子会话（成员形态）。

```
{"event":"apply","mode":"setup","pid":14192,"processType":null}
{"event":"timer-surface","typeofInterval":"function","typeofTimeout":"function","injectList":["timer"]}
（该进程 ctx.interval tick 计 25 次）
{"event":"setup-done","parentId":"t6-parent-1790161913239",
 "childId":"b668e1f4-6b40-4ea9-94ec-aac671c7aaa2",
 "seedTurn":{"reason":"completed","text":"The user wants exactly \"T6_CHILD_SEEDED\". Just reply that.T6_CHILD_SEEDED"}}
```

**Run B** — **全新进程**（pid 23312，父会话**不在**内存里，窗口不存在）。
**没有任何工具调用、没有任何用户轮次**，只有 resident tick：

```
{"event":"drive-start","tick":1,"fact":{"id":"F1","assignee":"b668e1f4-6b40-4ea9-94ec-aac671c7aaa2"}}
（该进程 ctx.interval tick 计 31 次）
{"event":"drive-done","factId":"F1","ok":true,
 "turn":{"reason":"completed","text":"The user is asking me to reply with exactly \"T6_DRIVEN_OK\". This is a simple instruction from the parent agent.T6_DRIVEN"}}
```

fixture 账本随之从 `pending` 变 `completed`（同一文件，驱动体自己收尾）：

```json
{"id":"F1","subject":"wake the member","status":"completed",
 "assignee":"b668e1f4-6b40-4ea9-94ec-aac671c7aaa2",
 "output":"woken by resident driver: ...","updatedAt":1790161966484}
```

**落在成员会话日志上的地面真相** —— `[实测]` 直接解压
`b668e1f4-6b40-4ea9-94ec-aac671c7aaa2/session.v3.jsonl.zstd`
（sha256=`C2D5054BE680DA6464C74BFB8D7D772CC4E2BD601896E2ADD42B917CEC2974F2`，**该文件仍在盘上**）。
第 2 轮的 `assistant/message` 内容块逐字为：

```
[reasoning] The user is asking me to reply with exactly "T6_DRIVEN_OK". This is a simple instruction from the parent agent. ...
[text] T6_DRIVEN_OK
```

且 `turn/end` 逐字 `{"turn":2,"reason":{"kind":"completed"}}`，第 2 轮的 user 消息来源是
`"source":{"kind":"agent-message","form":"relay","senderSe...}` —— 即**被父 agent 唤醒**，
不是被用户唤醒。

### 4.2 最小驱动体形状（≈40 行）

```js
export const name = 'xyz-resident-driver'
export const inject = ['timer']          // 缺它 → ctx.interval/timeout 不存在，Guard 拒绝激活

export function apply(ctx) {
  let running = false
  ctx.interval(async () => {             // 绑 fiber，不绑会话；无窗口也 tick
    if (running) return                  // 防重叠（长轮询必须显式防）
    running = true
    try {
      const ready = pullReadyWork()      // 读账本 → 算 ready 集（依赖已满足的 pending）
      for (const fact of ready) {
        const parent = await ctx.get('agents').resume({      // ① 先 resume 父会话
          resumeSessionId: fact.parentSessionId, agentOptions: route,
        })
        await deliverToMember(parent.agent, fact.assignee, prompt)  // ② 再投递给成员
      }
    } finally { running = false }
  }, 3000)
}
```

两个**必需的**前置步骤，缺一即静默失败：

1. **必须 `resume` 父会话**。`dsh-subagent/lib/index.js:966-969` 逐字：
   ```js
   authorizeLineage(parent, childId, parentSession) {
     if (this.ctx.agents.get(parent.id) !== parent) throw new SubagentError(
       `subagent "${childId}" delivery requires the exact live parent agent`, "UNAUTHORIZED");
     if (parentSession !== parent.id) throw new SubagentError(...);
   }
   ```
   冷启动时父不在内存 ⇒ `ctx.agents.get()` 为 undefined ⇒ 投递 `UNAUTHORIZED`。
   `[实测]` Run B 正是先 resume（`parentRestored: 17/28`）再投递才成功。
2. **投递入口是 Symbol-keyed 的**，或走公开 `sendMessage`。
   `[实测]` `subagents.steerPrompt` **不是**公开方法（`ok:false, error:"subagents.steerPrompt is not a function"`）；
   公开面是 `sendMessage(sender, targetId, content, options)`（`dsh-subagent/lib/index.js:2898`）。
   上游真实插件另探两个 Symbol 缝：`Symbol.for('dsh.subagent.queuePrompt')` /
   `'dsh.subagent.deliverPrompt'`（`dsh-agent-teams/src/harness-compat.ts:25-27`）。
   `[实测]` 本 spike 最终走 `sendMessage` 成功（`via:"sendMessage"`）。

### 4.3 本 spike 自己踩的两个「假绿」坑（**实现时必须内建这种防御**）

这两条不是花絮：它们正好证明了**为什么常驻驱动体不能靠自述成功**。

1. **`ok:true` 而轮次其实失败了。** 第一版探针用 `await agent.whenIdle()` 后即判成功。
   `[实测]` 一次「成功」的真相是（解压会话日志逐字）：
   ```
   {"type":"turn/end","seq":8,"time":...,"data":{"turn":1,"reason":{"kind":"error",
    "error":{"message":"prompt variable \"{{cwd}}\" has no value for this assembly (section \"deployment:persona-suffix\")","code":"UNKNOWN"}}}}
   ```
   ⇒ **`whenIdle()` resolve ≠ 轮次成功**。真实原因是我把 `cwd` 传在了
   `agents.create()` 的**顶层**，而它在 `meta.cwd` 里
   （`CreateAgentOptions`：`meta?: { cwd?: string; ... }`）。传错位置时 `{{cwd}}` 未绑定，
   **每一个**轮次都会在 persona 组装阶段死掉。
   **修法（已采用）**：读 `turn/end.data.reason.kind`，且要求 assistant 文本真的出现。
2. **读错属性得到静默空数组。** `session.events` 在本 Harness 上**不存在**；
   正确访问器是 `session.ownEvents()`
   （上游真实插件 `dsh-agent-teams/src/harness-compat.ts` 的 `sessionOwnEvents` 也是这么做的）。
   `[实测]` 读 `.events` 得到 `eventCount:0` → 探针报「没看到预期文本」→ **假红**。

> **给常驻体的设计含义**：驱动体必须把「投递被接受」和「成员真的干完了」当**两件事**，
> 且只能以**框架写入的事实**（`turn/end` reason、任务终态）判定成功。
> 本 spike 最终的判定就是这么改的（§4.1 的 `ok:true` 来自 `turnEndReason === 'completed'`
> 且文本命中，而非 `whenIdle()` 返回）。

### 4.4 与规范的关系（FR-3.5 / FR-5.0.5）

`docs/REQUIREMENTS.md:76` 与 `:110` 要求「团的存续**不依赖任何窗口会话**」、
「团须有不依赖任何窗口的调度体」。本 spike **证实这条要求在 DSH 上可实现**，
并给出实现必须依赖的三件套：`ctx.interval` + `ctx.agents.resume` + 成员投递缝。

### 4.5 断言自检（`~/.dsh/AGENTS.md` 第七节：会红的断言才算断言）

本 spike 的成功判据我做了**反向验证**，不是只看它变绿。在冻结的成员日志上跑两个谓词：

```
block types            = reasoning,text
strict(text)           = "T6_DRIVEN_OK"
canary WRONG_VALUE in loose = false          <- 反向对照：错的标记确实不命中
reasoning has token    = true                <- ⚠ 见下
```

**发现一个真实的判据弱点**：我的「宽松」判据把所有 content block 的文本拼起来再 `includes`，
而 `[实测]` 该成员把 `T6_DRIVEN_OK` **也写进了 `reasoning` 块**。这意味着在特定输出下，
**宽松判据可能在模型只在思考里提过、正文没答的时候也变绿**。
⇒ 本轮的结论不受影响（`turn/end` reason 独立为 `completed`，且 `strict(text)` 精确等于
`"T6_DRIVEN_OK"`），但**实现时的判据应当只取 `type === 'text'` 的块**。
这条是我自己发现的、对 §4.3 防御的补强。

---

## 5. 能力边界（**必须写进需求，否则交付即误导**）

### 5.1 「窗口关了」✅，「DSH 退出后」❌

| 场景 | 团队还能干活吗 | 依据 |
|---|---|---|
| 窗口 **hide**（点 X） | ✅ 能 | `[实测]` 无窗口宿主照常驱动 + `[源码]` hide 不销毁进程 |
| 窗口最小化 / 切走 | ✅ 能 | 同上（与窗口状态无关） |
| **DSH 完全退出**（托盘退出 / 杀进程） | ❌ **不能** | `[源码]` 宿主是 main 的 `utilityProcess` 子进程，随 main 一起收 `shutdown.request()`（`main.js:3883-3888`、`3322` 侧无保活） |

⇒ **准确的对外说法是**：「**DSH 运行期间**，窗口关了团照常干活」。
而不是「窗口关了团照常干活」（读者会理解成 DSH 可以退出）。

### 5.2 冷启动后**不能**自动接管「别人正持有的会话」

`[实测]` §3.2：跨进程 resume 会 `EBUSY`。所以：

- 若 DSH 宿主正跑着 → 常驻体**必须**在**同一个宿主进程内**（形态 A）。
- 若想做到「DSH 退出后仍继续」→ 唯一的架构出路是**外部 supervisor 进程**，
  且它必须在 DSH 完全退出、**会话锁释放后**才能接管（时序敏感，见 §6.4）。
  **本 spike 未验证**这条时序（`[未验证]`，见 §6.4）。

### 5.3 模型成本是真实的

`[实测]` 每次唤醒 = 一次真实 LLM 轮次（Run B 的成员轮次花了约 4.0s：1445122→1448679 ms）。
常驻轮询**必须**把「扫到 ready 工作」和「真的叫人」分开 —— 否则空转轮的 token 成本会失控。

---

## 6. 未验证项与后续（诚实清单）

### 6.1 `[未验证]` Desktop 宿主（utilityProcess）里跑同一个常驻插件

我的载体是**独立 `dsh` 进程**（无窗口、纯 node），**不是** Desktop 的 utilityProcess 宿主。
两者都走 `@deepseek-ai/dsh-app-boot` 的 `boot()`、同一个 profile 组合（`host-process-entry.js`
→ `bootDesktopHost`），且 `desktop` profile 已用**完全相同的方式**（`cordis.patch.yml` 的
`- insert: ./plugins/...`）挂了 13 个文件插件 —— `[推断]` 同一机制成立。

**没验的原因（诚实）**：要验就得改**正在运行中**的 `desktop` profile —— 那会动到用户正在
用的、且**正承载本任务团队**的宿主。风险不对称（可能打断团队 / 丢活跃会话），**我不做**。

**怎么验（留给 t7）**：在 t7 的端到端验证轮次里，把常驻行加进 `desktop/cordis.patch.yml`
（该 profile 有 `patchReload: live`，见下）并观察 —— 这是**低风险窗口**，因为那时本来就要
重启/验证宿主。

### 6.2 `[未验证]` 与上游 scheduler 的**接线**（不是并列，而是替代/包裹）

本 spike 验证的是**驱动体本身**能工作，**没有**去改 `scheduler.ts`。真实的集成问题是：
`kickTeam` 硬要求 `liveCaptain`（§3.1），所以常驻体要么

- **先 resume captain 再调 `kickTeam(workspace, teamId, captain)`**（复用上游全部逻辑，改动最小），或
- 自己实现一套不依赖 captain 的 kick（重复上游大量 claim/attempt 语义，不推荐）。

**推荐前者**，且这正是我 §4.2 第 ① 步做的事。`[推断]`：resume 出来的 captain agent
能通过 `liveCaptain` 的 `ctx.agents.get(captainSessionId) === supplied` 判定。
**未验证**点在于：captain 会话被 resume 后，`team.json` 里那些 `claimed/in_progress`
的 attempt 会不会被 `scheduler.ts` 的 `parkedAttempts` 逻辑（L351-353、L266）误判为
「本进程没观察过的开放任务」而**重复投递一次**。这**必须**在 t7 里用真实账本验。

### 6.3 `[未验证]` 并发/多宿主下的账本写竞争

本 spike 的 fixture 是自己独占的单写者。真实场景里宿主内常驻体与工具调用会**并发写**
`team.json`。上游有 `withTeamLock`（`scheduler.ts:174-176` 定义键
`` `team:${stateRoot}:${teamId}` ``），但那是**进程内**锁；跨进程（形态 B）**没有**跨进程锁。
`[未验证]`：形态 B 下两个进程同写会不会静默互相覆盖。**若选形态 B，这是必须先解决的前置。**

### 6.4 `[未验证]` 「DSH 退出后外部 supervisor 接管」的时序

理论上：main 退出 → utilityProcess 宿主被杀 → 内核信号量随最后句柄关闭而销毁
（`dsh-session-persistence-jsonl/lib/index.js:549-550` 逐字：*"when the last handle closes —
including on any process death — the object is destroyed, so a successor's create starts fresh"*）
⇒ 外部进程此时 resume 应能成功。

但**「DSH 何时算完全退出」「supervisor 要用什么退避重试」都没验**。这是形态 B 的核心风险，
建议**不在本轮做**（见 §8）。

### 6.5 `[未验证]` 长跑稳定性 / 定时器漂移 / 宿主 HMR

`ctx.interval` 只跑了 31 tick（约 47s）量级，**没有**做小时级长跑、**没有**验
`patchReload: live`（`t6spike/package.json` 里是 `"live"`，`desktop` profile 也是 `live`）
下插件热重载是否会出现**双循环**（上游 `dsh-ui-drive/index.js:86` 明确记过这个坑：
「模块级单例：宿主热重载/多路复用下绝不出现两个 setInterval」）。

⇒ **实现时必须**把驱动体做成模块级单例 + 幂等（与上游同一手法），**并补一条长跑证据**。

---

## 7. 备选方案（若选不做常驻）

按代价从低到高，**都不是「不可行」，而是取舍**：

| 方案 | 可行性 | 代价 |
|---|---|---|
| **① 窗口在时才跑**（维持现状） | ✅ 已成立 | 「无人对话时团不前进」。**必须**在 UI/文档里如实标注，别宣称常驻 |
| **② 宿主内常驻插件**（本报告推荐） | ✅ `[实测]` | 需解决 §6.2 的 attempt 重投递、§6.5 的 HMR 单例 |
| **③ 外部 supervisor 进程** | ⚠️ `[未验证]` | 需先解决 §6.3 跨进程写锁 + §6.4 接管时序；且**只能**在 DSH 完全退出后工作 |
| ④ 借 Electron 常驻面（tray 等） | ❌ | 越出插件面；`desktop` profile 无法保证被挂载；不可移植 |

### 对本项目（t1–t7）的具体建议

**选 ②**，并把 ① 的边界**如实写进 README**（`~/.dsh/AGENTS.md` 第五节：不要「把够用推成完备」）。

---

## 8. 给下游的一句话交接

> 常驻调度体**在 DSH 上可行，且本 spike 已跑通**（无窗口宿主 → 扫账本 → resume 父会话 →
> 唤醒真实 durable 成员，落在会话日志上 `turn/end reason=completed`）。
> 实现路径三条依赖：`inject:['timer']` + `ctx.agents.resume(parent)` + 成员投递（`sendMessage`
> 或 Symbol 缝）。**两个硬约束**：上游 kick 要 live captain（所以必须先 resume）；
> **会话写锁跨进程独占**（所以驱动体**必须**在宿主进程内）。
> **能力边界**：DSH 运行期间窗口关了照常干活；**DSH 退出后不行**（除非另做外部 supervisor，
> 那条路本轮未验证）。
> 落地前**必做**：在 t7 用真实账本验「resume captain 后上游 `parkedAttempts` 会不会重投递」。

---

## 附：本 spike 对实现文件的改动 = **零**

- 唯一新增的插件文件在**一次性 profile** `~/.dsh/profiles/t6spike/` 下，**不在本项目仓库**，
  且与本任务 inScope 无关。**用完即删**（已删，见下）。
- 本报告是**唯一**落在 `Sophia-agent-entities` 仓库里的改动：`docs/SPIKE-resident-driver.md`。
- `~/.agent-teams/` 与 `team.json` **全程只读**：探针读的是**自己建的 fixture**
  （`t6spike/fixture-team.json`），从未写入团队状态（遵守 state policy）。
- **未**触碰任何 live 团队成员会话：所有 resume 只针对探针自建的
  `t6-parent-*` / `t6-wake-*` / `t6-probe-*` 会话。

### 清理

```powershell
Remove-Item -Recurse -Force "$env:USERPROFILE\.dsh\profiles\t6spike"   # 已执行
# 探针遗留的会话目录（t6-parent-* / t6-wake-* / t6-probe-*）未删，见 §0「证据留存实况」
```

> **一处我自己的失误，如实记录**：我按「用完即删」把一次性 profile 整个删掉了，
> **连带把探针源码也删了** —— 这让「复现方式」在删除后不可复现，是**证据管理的失误**。
> 补救：把探针源码**按本会话的写入/编辑记录重建**到下面附录 A。
> **强度声明（重要）**：附录 A 是**重建**，不是「与盘上文件逐字核对过的」——文件已删，
> **无法再比对**，因此我**不主张**它逐字一致（差异风险在注释措辞上，逻辑结构可保证）。
> 可核验的只有 §0 里那些**仍存在**的会话日志指纹。

---

## 附录 A：最小原型源码（**按编辑记录重建**，非与盘上文件逐字核对）

这是 §4.1 那次成功运行所用的驱动体。它同时承担 4 个探针角色（tick / 能力 / 唤醒 /
锁竞争），所以在「真实现」里应当拆开、只保留 `apply()` 里的 tick + resume + 投递三段。

```js
/**
 * t6 spike — MINIMAL RESIDENT DRIVER prototype (throwaway, not a deliverable).
 *
 * Run A: T6_DRIVE unset  — writes the fixture ledger, creates parent + child.
 * Run B: T6_DRIVE=1      — fresh process, no window: the resident tick finds the
 *         pending fact and wakes the same durable child.
 */
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'

export const name = 't6-resident-probe'
export const inject = ['timer']

const OUT = 'C:\\Users\\Administrator\\.dsh\\profiles\\t6spike\\resident-probe.jsonl'
/** Fixture ledger owned by this probe — NOT the live team's ledger. */
const FIXTURE = 'C:\\Users\\Administrator\\.dsh\\profiles\\t6spike\\fixture-team.json'
const PROBE_CWD = 'C:\\Users\\Administrator\\.dsh\\profiles\\t6spike'
const TICK_MS = 1500
const TERMINAL = ['completed', 'failed', 'cancelled']

function emit(record) {
  const line = JSON.stringify({
    ts: Date.now(),
    pid: process.pid,
    ppid: process.ppid,
    // An Electron renderer reports process.type === 'renderer'; the DSH Host
    // child (utilityProcess) reports undefined. Window-liveness discriminator.
    processType: process.type ?? null,
    ...record,
  })
  try { appendFileSync(OUT, `${line}\n`) } catch { /* probe only */ }
  return line
}

/** PULL MODE: read a durable ledger and find the work that is actually ready. */
function readyWork(ledgerPath) {
  try {
    const team = JSON.parse(readFileSync(ledgerPath, 'utf8'))
    const tasks = Array.isArray(team.tasks) ? team.tasks : []
    const done = new Set(tasks.filter((task) => task.status === 'completed').map((task) => task.id))
    const ready = tasks.filter((task) => task.status === 'pending'
      && (task.dependencies ?? []).every((dependency) => done.has(dependency)))
    return { total: tasks.length, ready: ready.map((task) => ({ id: task.id, assignee: task.assignee })) }
  } catch (error) {
    return { error: String(error), ready: [] }
  }
}

/** Mark the fixture fact done (status is the durable fact). */
function completeFact(ledgerPath, taskId, output) {
  const team = JSON.parse(readFileSync(ledgerPath, 'utf8'))
  const task = team.tasks.find((candidate) => candidate.id === taskId)
  if (task !== undefined) { task.status = 'completed'; task.output = output; task.updatedAt = Date.now() }
  writeFileSync(ledgerPath, JSON.stringify(team, null, 2))
}

function ownEvents(session) {
  // `session.events` does not exist on this build; the accessor is ownEvents().
  // Reading the wrong property returns a silent empty array.
  if (typeof session.ownEvents === 'function') return session.ownEvents()
  return session.events ?? []
}

function lastTurn(events) {
  const ended = [...events].reverse().find((event) => event.type === 'turn/end')
  const text = [...events].reverse().find((event) => event.type === 'assistant/message')
  const parts = text?.data?.message?.content ?? []
  return { reason: ended?.data?.reason?.kind ?? null, text: parts.map((part) => part.text ?? '').join('').slice(0, 120) }
}

/** The wake primitive: resume the parent, then deliver into the durable child. */
async function wakeMember(ctx, route, parentId, childId, prompt) {
  const agents = ctx.get('agents')
  const subagents = ctx.get('subagents')
  // Upstream `authorizeLineage` demands the exact live parent agent, so a
  // window-less driver must resume the parent before it can reach the child.
  const parent = (await agents.resume({
    resumeSessionId: parentId,
    agentOptions: { provider: route.provider, model: route.model },
  })).agent
  const content = [{ type: 'text', text: prompt }]
  const queue = subagents[Symbol.for('dsh.subagent.queuePrompt')]
  if (typeof queue === 'function') await queue.call(subagents, parent, childId, content, { kind: 'plugin', plugin: 't6-resident-probe' }, new AbortController().signal)
  else await subagents.sendMessage(parent, childId, content, { signal: new AbortController().signal })
  const child = agents.get(childId)
  if (child !== undefined) await child.whenIdle()
  return child === undefined
    ? { reason: null, text: '', note: 'child not resident after delivery' }
    : lastTurn(ownEvents(child.session))
}

export function apply(ctx) {
  const provider = process.env.T6_WAKE_PROVIDER
  const model = process.env.T6_WAKE_MODEL
  const route = { provider, model }

  // ── The resident driver body ────────────────────────────────────────────
  // Owned by THIS fiber, not by any turn or session. Survives with no window.
  let ticks = 0
  let driving = false
  const ledger = process.env.T6_DRIVE === '1' ? FIXTURE : undefined

  ctx.interval(() => {
    ticks += 1
    ctx.logger.info(`t6-resident-probe: ${emit({ event: 'tick', tick: ticks, mode: ledger === undefined ? 'setup' : 'drive' })}`)
    if (ledger === undefined || driving || provider === undefined || model === undefined) return
    const work = readyWork(ledger)
    if (work.ready.length === 0) return
    const fact = work.ready[0]
    driving = true
    ctx.logger.info(`t6-resident-probe: ${emit({ event: 'drive-start', tick: ticks, fact })}`)
    void wakeMember(ctx, route, process.env.T6_PARENT_SESSION, fact.assignee, 'Reply with exactly: T6_DRIVEN_OK')
      .then((turn) => {
        const ok = turn.reason === 'completed' && turn.text.includes('T6_DRIVEN_OK')
        completeFact(ledger, fact.id, `woken by resident driver: ${turn.text}`)
        ctx.logger.info(`t6-resident-probe: ${emit({ event: 'drive-done', factId: fact.id, ok, turn })}`)
      }, (error) => {
        ctx.logger.info(`t6-resident-probe: ${emit({ event: 'drive-failed', factId: fact.id, error: String(error?.message ?? error) })}`)
      })
      .finally(() => { driving = false })
  }, TICK_MS)

  ctx.logger.info(`t6-resident-probe: ${emit({ event: 'apply', note: 'resident probe mounted', mode: ledger === undefined ? 'setup' : 'drive' })}`)

  // Resolve an apparent contradiction before the report leans on timers:
  // plugins/dsh-agy-see/index.js:759 records "ctx.timeout 在文件插件里应无"
  // (typeof undefined) while injecting 'timer' — yet this probe calls both
  // ctx.interval and ctx.timeout and they fire. Record the actual typeofs.
  ctx.logger.info(`t6-resident-probe: ${emit({
    event: 'timer-surface',
    typeofInterval: typeof ctx.interval,
    typeofTimeout: typeof ctx.timeout,
    typeofTimerService: typeof ctx.timer,
    // `module` does not exist in this ESM plugin (declaring it crashes apply).
    injectList: inject,
  })}`)

  if (provider === undefined || model === undefined) return

  // ── Contention probe ────────────────────────────────────────────────────
  // Can a second process resume a session the GUI still holds? §3.2.
  const holdParent = process.env.T6_HOLD_PARENT
  if (holdParent !== undefined) {
    ctx.timeout(() => {
      void (async () => {
        try {
          const parent = (await ctx.get('agents').resume({ resumeSessionId: holdParent, agentOptions: route })).agent
          ctx.logger.info(`t6-resident-probe: ${emit({ event: 'hold-acquired', parent: parent.id, restored: ownEvents(parent.session).length })}`)
        } catch (error) {
          ctx.logger.info(`t6-resident-probe: ${emit({ event: 'hold-failed', error: String(error?.message ?? error) })}`)
        }
      })()
    }, 5000)
  }

  // ── Run A: create the fixture, a parent, and one durable continuable child.
  if (ledger === undefined) {
    ctx.timeout(() => {
      void (async () => {
        const agents = ctx.get('agents')
        const subagents = ctx.get('subagents')
        const handle = await agents.create({
          sessionId: `t6-parent-${Date.now()}`,
          // cwd lives under `meta`, NOT top-level: passing it top-level leaves
          // {{cwd}} unbound and every turn dies in persona assembly.
          meta: { cwd: PROBE_CWD },
          agentOptions: route,
        })
        const parent = handle.agent
        const started = await subagents.startContinuable({
          provider: 'spawn',
          label: `t6-probe:${parent.id}:child`,
          request: {
            prompt: [{ type: 'text', text: 'Reply with exactly: T6_CHILD_SEEDED' }],
            parent,
            agentOptions: route,
          },
          signal: new AbortController().signal,
        })
        const child = agents.get(started.childId)
        if (child !== undefined) await child.whenIdle()
        writeFileSync(FIXTURE, JSON.stringify({
          id: 't6-fixture',
          parentSessionId: parent.id,
          tasks: [{ id: 'F1', subject: 'wake the member', status: 'pending', assignee: started.childId, dependencies: [] }],
        }, null, 2))
        ctx.logger.info(`t6-resident-probe: ${emit({
          event: 'setup-done',
          parentId: parent.id,
          childId: started.childId,
          seedTurn: child === undefined ? null : lastTurn(ownEvents(child.session)),
        })}`)
      })().catch((error) => {
        ctx.logger.info(`t6-resident-probe: ${emit({ event: 'setup-failed', error: String(error?.message ?? error) })}`)
      })
    }, 5000)
  }
}
```

### 复现命令（与附录 A 配套）

```powershell
$b = "<app>\node_modules\@deepseek-ai\dsh\lib\bin.js"      # <app> = DSH Desktop\resources\app

# Run A：建 fixture + 父会话 + durable 成员
Start-Process node -ArgumentList "`"$b`"","--profile","t6spike","--no-open","--port","0" `
  -Environment @{T6_WAKE_PROVIDER="deepseek2";T6_WAKE_MODEL="deepseek-v4.1-flash"}

# （确认 setup-done 出现后）Run B：全新进程，无窗口，常驻 tick 自己驱动
Start-Process node -ArgumentList "`"$b`"","--profile","t6spike","--no-open","--port","0" `
  -Environment @{T6_WAKE_PROVIDER="deepseek2";T6_WAKE_MODEL="deepseek-v4.1-flash";
                 T6_DRIVE="1";T6_PARENT_SESSION="<Run A 的 parentId>"}

# 锁竞争（§3.2）：两个进程对同一 parent 先后 hold
#   先起 host1(带 T6_HOLD_PARENT)，再起 host2(同一个 T6_HOLD_PARENT) → host2 报 EBUSY
```

> **`T6_WAKE_PROVIDER` / `T6_WAKE_MODEL` 是本机 `settings.yaml` 的既有路由**
> （`llm-pi-ai.providers.deepseek2` → `deepseek-v4.1-flash`），不是新配置、也不在仓库里。

---

## 附录 B：关于本报告的第三方评审（`~/.dsh/AGENTS.md` 第一条）

**如实说明：本报告拿不到有效的 OCR 第三方评审。**

`[实测]` 对该文件跑 `ocr_review(mode="scan", path="docs/SPIKE-resident-driver.md")`，逐字返回：

```
代码评审完成 · scan · C:\Users\Administrator\Sophia-agent-entities
文件 0 个 · 意见 0 条（HIGH 0 / MEDIUM 0 / LOW 0）
（无意见）
```

`文件 0 个` —— ocr 按扩展名过滤，`.md` 全被滤掉。所以「（无意见）」是**假绿，不是通过**，
与 `~/.dsh/AGENTS.md` 第四条第 6 点记录的已知结构性缺陷一致。

⇒ **本报告的结论只有人眼可审**；其中**机器可核验**的部分已在 §0 全部给出指纹与命令，
请优先按指纹复核，而不是采信本文的叙述。

