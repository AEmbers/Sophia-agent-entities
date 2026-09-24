# Sophia-agent-entities

索菲亚的 agent 实体存放库。把上游两个独立仓库**以内容并入（git subtree）**的方式收进来，作为本仓库的两个子目录 —— 克隆一次即可拿到全部代码，无需额外 `submodule init`。

## 子目录

| 子目录 | 上游仓库 | 并入库的分支 | 并入时上游 commit |
|---|---|---|---|
| [`dsh-agent-team/`](./dsh-agent-team) | [wowyuarm/dsh-agent-team](https://github.com/wowyuarm/dsh-agent-team) | `master` | `ef47ef7` |
| [`dsh-agent-teams/`](./dsh-agent-teams) | [NanmiCoder/dsh-agent-teams](https://github.com/NanmiCoder/dsh-agent-teams) | `main` | `87c95c9` |

并入时间：2026-09-18
最近同步：2026-09-20（`dsh-agent-team` `ce61be1` → `ef47ef7`，54 个提交，含 0.1.12–0.1.14 三个版本；`dsh-agent-teams` 已是最新，0 提交差）

## 为什么用 subtree 而不是 fork / submodule

- **不是 Fork**：Fork 是 GitHub 服务端的一个指针式副本，独立成一个仓库，不是"子目录"。
- **不用 submodule**：submodule 在父仓库里只存一个 commit 指针，别人克隆下来子目录是**空的**，还得再 `init` + 有上游访问权限。
- **用 subtree**：上游整棵树的内容真实落进本仓库，子目录在 clone 后立刻可用。代价是父仓库体积变大、同步时会产生合并提交。

## 同步上游更新

上游有新提交时，按下面步骤把更新拉进对应子目录。

### 一次性配置（首次同步前）

```bash
git remote add up-team  https://github.com/wowyuarm/dsh-agent-team.git
git remote add up-teams https://github.com/NanmiCoder/dsh-agent-teams.git
```

### 同步 dsh-agent-team

```bash
git fetch up-team master
git subtree pull --prefix=dsh-agent-team up-team/master --squash \
  -m "Sync wowyuarm/dsh-agent-team into dsh-agent-team/"
```

### 同步 dsh-agent-teams

```bash
git fetch up-teams main
git subtree pull --prefix=dsh-agent-teams up-teams/main --squash \
  -m "Sync NanmiCoder/dsh-agent-teams into dsh-agent-teams/"
```

> `--squash` 会把上游的一批提交压成一个，父仓库历史干净。去掉 `--squash` 则保留上游完整提交历史，但父仓库历史会变长、且首次同步后要一直保持同一模式，**不要中途切换**。

## 目录结构

```
Sophia-agent-entities/
├── dsh-agent-team/      # 上游 wowyuarm/dsh-agent-team
├── dsh-agent-teams/     # 上游 NanmiCoder/dsh-agent-teams
├── docs/                # 需求 / SPEC / 开发文档 / 验证与评审报告
├── packages/
│   └── sophia-core/     # 本框架的领域库 + DSH 插件外壳
├── README.md
└── LICENSE
```

## 安装到 DSH profile

`packages/sophia-core` 既是领域库，也是一个可被 DSH 加载的插件（宿主半 + 浏览器半）。
安装分两步：**先构建**（构建产物 `lib/` 不入库），**再挂进 profile 的 bundle 列表**。

### 1. 构建

```bash
pnpm install
pnpm --filter @sophia/core run build
```

`build` 依次跑：`tsc` 产出宿主半的 `.js` 与 `.d.ts` → `tsc` 只产出浏览器半的
`.d.ts`（`emitDeclarationOnly`）→ `tsdown` 把浏览器半打包成 DSH 的
`__ModuleLoader__` 闭包工厂（`lib/client.js`）。

> 浏览器半**不经 tsc 落 `.js`**：`src/client/index.ts` 里的包名要靠 tsdown
> 构建期注入（`define`），先让 tsc 落一份 `lib/client/index.js` 会留下一个
> 未定义自由变量，而它会随 `files: ["lib"]` 一起发布 —— 谁按约定路径 require
> 都 `ReferenceError`。`tests/shell.spec.ts` 有一条断言专门钉住这个文件**不存在**。

> ⚠ **`lib/` 是构建产物且被 `.gitignore` 忽略**。刚 clone 下来直接跑测试，
> `tests/shell.spec.ts` 里依赖产物的用例会**明确失败并打印补救命令** —— 这是刻意的：
> 给一条绿色假象比红得更糟。

### 2. 挂进 profile

推荐用 DSH 自己的命令（它会 pnpm 安装该包并把本包对进 profile 的
`dsh.profile.bundles` 列表）：

```bash
dsh plugin --profile desktop add <本仓库路径>/packages/sophia-core
```

也可以手工把包放进 profile，再在 profile 的 `package.json` 里把
`"@sophia/core"` 加进 `dsh.profile.bundles`。加载行由本包自带的
`packages/sophia-core/cordis.patch.yml` 声明（`dsh.bundle.patch` 指向它）：

| 行 id | 模块 | 作用 |
|---|---|---|
| `sophia-host` | `@sophia/core/host` | 宿主半边：只读自检路由 `/api/sophia/status` + 面向模型的公告 |
| `sophia` | `@sophia/core` | **裸包名行**，浏览器半边的发现锚点；同时是领域库入口 |

> **为什么是两行**：DSH 的 `dsh-client-modules` 只对**裸包名**行做包解析
> （`exactPackageSpecifier` 要求 `@scope/name` 恰两段，`@sophia/core/host`
> 三段会被整行跳过）。所以「让 GUI 认出浏览器半」必须有一条裸名行。
>
> 裸名行 import 的是 `exports["."]` —— 也就是领域库入口 `@sophia/core`。
> 它**同时**导出领域符号（31 个）与插件三元组 `name` / `inject` / `apply`，
> 与在跑的 `dsh-postman` 同构（它的 `exports["."]` 也既是宿主半边又是自己的 API）。
> 两侧不撞名，`tests/shell.spec.ts` 把这条前提钉成了断言。
>
> 另一行 `@sophia/core/host` 因为三段而**不会**被 client-modules 解析，
> 所以它不会和裸名行争同一个包（否则 `reconcilePackage` 会抛
> `resolves from multiple active Loader sources`）。

### 3. 验证安装

重启 DSH 后，宿主半会挂上只读自检路由（回环）：

```bash
curl http://127.0.0.1:<端口>/api/sophia/status
# {"ok":true,"plugin":"sophia","phase":"shell","route":"/api/sophia/status",
#  "surfaces":{"host":true,"client":"skeleton","tools":false,"runtime":false}}
```

浏览器控制台里应出现 `[sophia] client half mounted`，且 `window.__SOPHIA_CLIENT__` 有值。

> **诚实边界**：上面这条响应是**契约形状**（由 `tests/shell.spec.ts` 用假 ctx
> 驱动真实 `apply` 后断言的），本轮**没有**真的把包挂进运行中的 profile 去抓一次
> 真实响应 —— 那会改到主人的 DSH 配置，不在本任务范围内。
> 同理，`[sophia] client half mounted` 一行来自**在模拟 `__ModuleLoader__` 里
> 执行构建产物**的实测，不是从真实浏览器控制台抄来的。
> 「接线正确」在交付时是**静态+单元级**结论，端到端挂载验证属于集成任务。

> 当前是**外壳阶段**：`surfaces` 里的 `client` 为 `skeleton`、`tools`/`runtime` 为 `false`
> 是如实回报，不是故障 —— 成员运行时、Agent 工具集与真实 UI 由后续任务挂载。

## 许可

两个子目录各自受其上游 `LICENSE` 约束，见 `dsh-agent-team/LICENSE` 与 `dsh-agent-teams/LICENSE`。
