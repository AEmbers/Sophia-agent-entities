# 别再踩

硬约束和测出来的坑。改性能时先读这一页。

## 产品

- 不改 `../deepseek-harness` 源码。
- 不拆 `view` Remote；不改 Inbox / mention 语义；不改布局导航。第一刀 human 定的，后续仍有效。
- 不要重开已关的 issue #21。新刀新 issue。

## 校验网

- invariant 是**记录级重推导**：对每条记录用前序记录重算期望 payload，再 `isDeepStrictEqual`。它不拿内存里的活投影去比。
- 因此「把同一次全量重放挪到响应之后 / 空闲 / 抽样」覆盖范围一模一样，只是发现得晚。这是 A 选的形态。
- 「只校验刚提交那条」更弱：前序只能取自活投影，`apply` 一漂校验就跟着漂。不要走这条。
- 网必须能红：砍掉一条已存 `team/thread-read` 的一条 fact → `invalid Thread read projection`。三条腿缺一不可：热路径变快、变异仍红、启动和测试仍全量。
- 残余 ~0.8 s/批要压，只能靠瘦记录（B2），不能靠把校验改弱。

## 测量

- 探针必须挂真实装配（sqlite + 服务 + invariant）。只驱动 ledger 会得到「Host 不是瓶颈」的假阴性——第一刀之后进 thread 仍慢就是这样漏的。
- 弃用小规模档比值。S1 绝对值在噪声底，比值由它主导。主判据 = 大档绝对量。同 tree 三跑是为了量噪声（S3 inbox 能从 4.69 跳到 6.26 ms，+34%）；小于这个幅度的「改进」判噪声。
- 截图字节比对对本仓库无效。同 tree 连跑两次只有 0–3/60 张相同。可见 UI 证据是旅程 exit 0。
- `web-dev` profile 链的是共享树。不要在 Human 正用的 GUI 上切 PR head。机器证据走 `test:browser`；肉眼预览另起指向隔离 clone 的临时 profile。
- 改完 lib 必须重启 `dsh web --profile web-dev` 才看得到。运行中的进程不会重载 `main`/`exports`。重启会掐 member 会话。

## 账本与共享树

- 追加本身不是问题。问题是把「看」当成「发生的事」记下来，还带上整批 facts 快照。
- 共享 worktree：`git status --short` 后只 add 自己的路径。别人常在 `.scratch/active/` 留 WIP。绝不 `git add -A`。
- 本地 master 可能被 squash 重写（hash 变、内容同）。自己的提交用 `rebase --onto` 重放，不要在脏工作区强推。

## 真实账本探针会搬走真实 Member 的私有目录（2026-09-14，Aster 定位）

- 机制：`member-runtime.ts` 的 `migrateLegacyMemoryDirectory` 会 `rename` 记录里那条**绝对** `privateMemoryPath`，进程 `DSH_HOME` 一隔离就把它搬进隔离 home；`cleanupRemovedMember` 同源还有一条 `rm -rf`。触发 = 真装配 + 账本带真实绝对路径 + 另一个 `DSH_HOME`。
- 实测暴露面：`artifacts/team-perf/frozen-ledger-11695ops.sqlite.gz` 有 **358 处**绝对 `privateMemoryPath`、25 个不同值、**1 个在本机仍是真目录**。⇒ `zz-p0-boot/scale/version` 这类探针用**消毒副本**。
- 处置：① 跑之前先 `python3 materials/phase0/sanitize-ledger-paths.py <copy>`（聚合输出、不打印真实路径）；② 已产出 `artifacts/team-perf/frozen-ledger-11695ops.sanitized.sqlite.gz`（rewrites 358、absolute_remaining 0、记录数 11,695 不变）；原冻结件保留未改以保字节可比；③ Aster 的护栏 `ab119d9`（同父目录才 rename + 删除限当前 members root）**尚未合入**，合入前不要跑未消毒的真实账本 + 隔离 home 组合。

