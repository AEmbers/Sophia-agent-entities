# 诊断与源码依据

核查日期：2026-09-17。资料用于解释规划依据，不取代当前源码、测试和 Harness 契约。

## 已完成的复现

环境：Team checkout `e5a46f2` 的现有本地构建，邻接 Harness `dsh-v0.1.5-rc.2` / `fb2c4b9e69`，Chrome 临时 profile；单个 Host、SQLite、一个 Workspace 和 Channel，没有运行中的 Agent。同一个 BrowserContext 创建两页，包含实际 Web bundle、Remote 和 Gateway，不是 mock fetch。

| 对照 | 实测 |
| --- | --- |
| 单页 members 查询 | 多轮约 3–4 ms，HTTP 200、ok=true |
| 双页查询 | 多轮超过测试设置的 3 秒期限 |
| 双页保持打开，独立 APIRequestContext 发相同请求 | 约 11–26 ms，HTTP 200 |
| 关闭第一页后在第二页重新查询 | 约 3–5 ms，HTTP 200 |
| 较长观察中的第二页 inbox 请求 | 发出前等待约 22,791 ms，收到响应约 22,793 ms |
| 第二页主动置于前台 | 发送与超时时 visibility 均为 visible，仍超时；取消原因是测试的超时 signal |

结论：此复现的阻塞位于浏览器请求调度，而不是 Host 成员查询的计算耗时，也不是运行中 Agent 负载。Team 每页多个 25 秒 unary 长轮询与其他持续 HTTP 请求竞争同源连接资源。不要把测试主动超时产生的 `ERR_ABORTED` 当成产品主动取消了后台页请求。

现场还存在 `/plugins/events` 持续请求，故不能承诺每种部署都恰好在第二页开始失败。开发事件连接与部署 HTTP 协议会改变阈值；Team 长轮询的连接占用应独立消除。

## 证据边界

- 未测试用户实际浏览器或已发布稳定 profile；结论针对已复现路径，不排除其环境还有其他瓶颈。
- 当前测试是浏览器原生 HTTP 路径；不能将同一结论直接量化为所有 HTTP/2 部署的连接上限。
- 临时测试先使用了错误的按钮定位，后来改正；最终失败断言是“双页 members 在 3 秒内完成”，不是导航 locator 超时。
- 本次只检查现有构建，未重建并重新认证完整版本组合。
- 未运行完整 `npm run test:browser`，也未宣布修复通过。

## 本地复跑

本机忽略目录 `artifacts/diagnostics/` 中有 `multitab-probe.mjs`、`multitab.log` 和 `multitab-summary.md`。命令：

```sh
node artifacts/diagnostics/multitab-probe.mjs
```

脚本使用当前机器绝对路径及 Google Chrome，通过仓库已有 scaffold 在邻接 Harness 创建临时测试，结束后清理临时测试和 profile。它是诊断脚本，不是可移植的正式回归；文件缺失时按以上环境和对照通过官方 scaffold 重建。实施时应将真实多页加载断言纳入维护中的测试，而不是依赖此被忽略脚本。

## Team 源码导航

路径相对于仓库根目录，行号仅为本次核查参考。

| 位置 | 已检查内容 |
| --- | --- |
| `packages/agent-team/src/index.ts:619-655` | `changes()` 是 unary Remote，等待 scope 变化或 25 秒超时，支持 AbortSignal |
| `packages/agent-team/src/types/requests-results.ts` | scope 和 afterVersion 契约，Presence 与 durable 版本域分离 |
| `packages/client-agent-team/src/client/team-changes.ts` | `TeamChangeStream` 每页按 scope 共享长轮询、保留已观察版本、自有退避；首次静默采样明确存在漏更新窗口 |
| `packages/client-agent-team/src/client/index.ts` | 每次 Client apply 创建自己的 change/read stream，通过 slot props 注入 |
| `packages/client-agent-team/src/client/TeamWorkspaceBrowser.tsx` | 全局 Inbox badge 订阅及各 Workspace Inbox 读取 |
| `packages/client-agent-team/src/client/TeamAgentsPanel.tsx`、`TeamChannelPage.tsx`、`TeamThreadPage.tsx` | Workspace、Presence 与页面 scope 组合；频道页面连同侧栏通常需要四个独立 scope |
| `packages/client-agent-team/src/client/navigation.ts` | 启动读取共享 localStorage 导航，运行时各页独立，没有跨页 storage 监听 |
| `packages/client-agent-team/src/client/drafts.ts` | `TeamDraftStore` 从共享字典读取到页内 Map，写入/清理时持久化整个字典 |
| `packages/client-agent-team/src/client/TeamThreadPage.tsx` | 初始与刷新路径通过 `readThread` 获取投影并推进阅读；所查路径无 visibility 判断 |
| `packages/client-agent-team/src/client/team-changes.ts` 中 `TeamReadStream` | 成功读取只通知本 Client 的订阅者；不向其他页面传播 |

相关维护测试：

- `packages/agent-team/tests/change-scopes.spec.ts`：提交范围、取消、私有读进度不唤醒公共 scope。
- `packages/agent-team/tests/member-lifecycle.spec.ts`：Presence scope 和成员生命周期。
- `packages/client-agent-team/tests/team-changes.client.spec.ts`：同 scope 去重、版本回退、重连后补读、退订与重订阅。
- `packages/agent-team/tests/typert-generation.spec.ts`：生成 Remote 接口。
- `scripts/team-ui.e2e.ts`、`scripts/run-browser-test.mjs`：真实 Web composition 与临时安装布局。

## Harness 已有能力

以 `../deepseek-harness` 为根：

- `packages/api/gateway/README.md`：`@Remote({ mode: 'stream' })`，返回 AsyncIterable；每页逻辑流共享 `/api/remote.mux` WebSocket；`ctx.remote.$stream()` 管理跨连接代次消费。领域负责接受开场信息和恢复后重新读取，不自动推断 Team 游标语义。
- `packages/api/gateway/src/client/stream-client.ts`：多个逻辑流共用一个 WebSocket 的实际实现。
- `packages/client/connection/src/client/rpc.ts`：普通 unary Remote 经浏览器 fetch POST，解释长轮询为何占据普通请求通道。
- `packages/api/workspace-files/src/index.ts` 和 `src/client/change-feed.ts`：现有流式变化通知、就绪帧、共享与释放示例。
- `docs/subsystems/typert.md`：生成器、声明和传输契约的维护文档。

已用 `git show dsh-v0.1.5-rc.1:packages/api/gateway/README.md` 核对：最低声明版本也有 stream Remote、共享 WebSocket 和 `$stream()`。这是可行性依据，不等于 Team 新实现已通过 rc.1 的生成、类型和运行验证。无需为了取得这项能力预先提高最低版本。
