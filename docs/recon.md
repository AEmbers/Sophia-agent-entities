# dsh-sophia-entities · 前置侦察报告

> 目标：以 `dsh-agent-team` 为基座，反向吸收 `dsh-agent-teams` 的能力，做二次开发。
> 本报告仅为调研记录，**尚未开始任何开发**。
> 生成时间：2026-09-25

---

## 一、当前工作区状态

```
C:/Users/Administrator/WorkBuddy/2026-09-25-14-50-12/
├── dsh-agent-team/          # 上游基座（只读参考，保留原始 git 历史）
├── dsh-agent-teams/         # 上游能力来源（只读参考，保留原始 git 历史）
└── dsh-sophia-entities/     # 我们的项目工作目录（已导入基座源码 + 独立 git 仓库）
    ├── docs/recon.md        # 本文件
    ├── packages/            # ← 由 dsh-agent-team 导入的源码
    ├── scripts/  docs/  assets/  .github/
    ├── cordis.patch.yml  package.json  pnpm-workspace.yaml
    └── tsconfig*.json  vitest.config.ts
```

两个上游仓库均已克隆完毕，`git` 历史完整，可随时 `git log` / `git diff` 对照。
`dsh-sophia-entities/` 已从一个纯空目录变为**完整的基座快照仓库**，详见第七节。

---

## 二、上游项目画像

### 2.1 dsh-agent-team（wowyuarm）· 基座

| 项 | 值 |
|---|---|
| 包名 | `@wowyuarm/dsh-agent-team` |
| 版本 | 0.1.15 |
| 定位 | A persistent agent team for long-running collaboration |
| 形态 | `bundle` + `client`（platform: web） |
| 仓库结构 | **pnpm monorepo**（`packages/*`） |
| 构建 | `tsc` 分三包编译 + 自研 `scripts/build-client.mjs` |
| 第三方依赖 | `@wowyuarm/dsh-context-continuity`、`yaml`、`zod` |

**子包划分（3 个）**

| 子包 | 文件数 | 职责 |
|---|---|---|
| `packages/agent-team` | ~24 | 核心：成员运行时、上下文、账本、恢复、压力策略 |
| `packages/tool-agent-team` | 3 | 工具暴露层（host-access / context-tools） |
| `packages/client-agent-team` | ~60 | 全部 Web UI |

**Node 侧核心模块（值得吸收的设计）**

- `member-runtime.ts` / `member-skills.ts` / `member-context.ts` — 成员生命周期与上下文注入
- `ledger.ts` — 团队事件账本（durable）
- `pressure-policy.ts` — 上下文压力策略
- `recovery.ts` — 崩溃/中断恢复
- `context-continuity-host.ts` / `context-source.ts` / `context-projection.ts` — 跨轮上下文连续性
- `human-profile.ts` / `human-avatar.ts` / `human-update-check.ts` — **把人类（Human）建模为团队成员**
- `invariant.ts`、`session-event-cursor.ts`、`mentions.ts`、`attachments.ts`

**Client 侧亮点（约 60 个文件，UI 完成度极高）**

- 三级页面：`TeamChannelPage` / `TeamInboxPage` / `TeamThreadPage`
- 会话组件：`TeamConversation`、`TeamComposer`、`TeamMessage`、`TeamRunDivider`
- 侧栏体系：`TeamSidebarSection`、`TeamChannelsPanel`、`TeamAgentsPanel`、`sidebar-drag`、`sidebar-order`、`sidebar-sections`
- 成员管理：`TeamMemberEditor`、`TeamMemberRow`、`TeamMemberAvatar`、`TeamAvatarStack`、`TeamPresenceDot`、`TeamStateDot`
- 人设与导入：`HumanSettingsSection`、`TeamAgentImport`、`human-identity.ts`、`avatar-image.ts`
- 工程化：`drafts.ts`、`navigation.ts`、`refs.ts`、`requests.ts`、`timeline-scroll.ts`、`team-formatters.ts`，配套 15+ 个 `.module.css`

**Composition 特征**：`cordis.patch.yml`（19KB，内容最丰富的一份）使用 **group + isolate** 模式：

```yaml
- insert:
    - id: wowyuarm-agent-team-scope
      name: cordis:group
      group: true
      isolate:
        agentPresets: true
      config:
        - id: wowyuarm-agent-team-preset-registry
          name: '@deepseek-ai/dsh-agent-preset-registry'
          config: { default: team-member }
        - id: wowyuarm-agent-team-preset-team-member
          name: '@deepseek-ai/dsh-agent-preset'
          config: { id: team-member, plugins: [...] }
```

即：**它自带一套隔离的 agent preset 注册表**，把 `team-member` 作为私有 preset，不污染宿主默认的 `standard` preset。preset 的 `prefix` 里内嵌了完整的「频道/受众/消息形态」行为规范（Thread 为持久账本、`@human` 提及机制、DM 上限 3 轮等），规范颗粒度非常高。

---

### 2.2 dsh-agent-teams（NanmiCoder）· 能力来源

| 项 | 值 |
|---|---|
| 包名 | `@nanmicoder/dsh-agent-teams` |
| 版本 | 0.1.21 |
| 定位 | multi-agent team collaboration（captain + members + 带依赖的 tasks + messaging）+ Web tree monitor |
| 形态 | `bundle` + `client`（platform: web） |
| 仓库结构 | **单包**（`src/` + `src/client/`） |
| 构建 | `tsdown` + `lightningcss`（`tsdown.config.ts`） |
| 第三方依赖 | 无重依赖（Node 侧轻） |

**Node 侧模块（33 个文件中的服务端部分）**

- `tools.ts` / `tool-names.ts` — `agent_teams_*` 工具族注册进共享 `tools` registry
- `members.ts` / `profiles.ts` — 成员与角色档位
- `scheduler.ts` — **调度器**
- `quality-gates.ts` — **质量门禁**
- `mailbox.ts` — 基于 `inbox/*.jsonl` 的邮箱
- `state.ts` / `snapshot.ts` — 状态与快照
- `web-routes.ts` — HTTP 路由
- `events.ts` / `event-types.ts` — 事件总线
- `harness-compat.ts` — 宿主兼容层
- `capabilities.ts` / `command.ts` / `types.ts`

**Client 侧（精悍，5 个组件 + 4 个 model 文件）**

- `AgentTeamsCard.tsx` + `agent-teams-card-definition.ts` — 卡片式入口
- `ActivityPanel.tsx` / `WorkspaceActivity.tsx` / `activity-model.ts` / `activity-monitor.ts` — **活动树监控**
- `StagingPlanEditor.tsx` — 计划暂存与编辑
- `TeamChatEntry.tsx` — 会话入口
- `session-navigation.ts` / `workspace-state.ts` / `panel-geometry.ts` / `locales.ts`

**Composition 特征**：`cordis.patch.yml` 极简（1.1KB），一行 insert：

```yaml
- insert:
    - id: agent-teams
      name: '@nanmicoder/dsh-agent-teams'
      config:
        stateDir: .agent-teams
        memberProvider: spawn
```

状态落地在 `<session workspace>/.agent-teams/<teamId>/`（`team.json` + `inbox/*.jsonl`）。

**它顺带打包了一整套插件开发 skill 库**（`skills/` + `.dsh/skills/`，11 个）：`dsh-plugin-development`、`plugin-release`、`plugin-runtime-debug`、`plugin-test`、`plugin-upgrade`、`plugin-write`、`plugin-workflow`、`plugin-heavy-dep`、`generic-migration`、`dsh-upgrade-audit`、`dsh-benchmark-case`。这是**附加资产**，可考虑吸收进我们的开发流程。

**Client bundle 协议**（`tsdown.config.ts`，非常关键）：

- 产物是 **CJS closure-factory**：`window.__ModuleLoader__.load({ id, factory: (require) => ... })`
- id **必须等于 package.json 的 `name`**（脚本主动从 package.json 读取，防止改名后失配）
- 平台种子模块（`react`、`react/jsx-runtime`、`react-dom*`、`@deepseek-ai/cordis`、`dsh-client-store`、`dsh-client-ui-slots`、`dsh-client-ui-primitives`）必须 external
- 有**纯度门禁**：任何其它 `@deepseek-ai/*` 的 value import 直接构建报错（只允许 type-only import 或 `/remote` 生成物）
- CSS Modules 用 lightningcss 编译成 hash 类名，并在 factory 执行时自动注入 `<style data-plugin>` 标签

---

## 三、能力对照表

| 能力 | dsh-agent-team | dsh-agent-teams | 整合取向 |
|---|---|---|---|
| 团队持久化 | 强（ledger + recovery + 账本） | 中（team.json + sqlite 可选） | 以 team 为主 |
| 成员运行时 | 强（member-runtime + skills + context） | 中（members + profiles） | 以 team 为主 |
| 任务与依赖 | 弱 | **强（tasks with dependencies）** | **吸收 teams** |
| 调度器 | 无 | **有（scheduler.ts）** | **吸收 teams** |
| 质量门禁 | 无 | **有（quality-gates.ts）** | **吸收 teams** |
| 邮箱/消息 | 强（mentions + thread + DM 规范） | 中（mailbox jsonl） | 以 team 为主 |
| 人类建模 | **强（human-profile / avatar / identity）** | 弱 | 以 team 为主 |
| 上下文连续性 | **强（context-continuity 三件套）** | 无 | 以 team 为主 |
| 压力策略 | **有（pressure-policy）** | 无 | 以 team 为主 |
| Web UI | **极强（60 文件三级页面）** | 精悍（卡片 + 活动树） | team 为骨架，吸收活动树 |
| 活动/进度监控 | 中（presence / state dot） | **强（ActivityPanel + 活动树）** | **吸收 teams** |
| 计划编辑 | 无 | **有（StagingPlanEditor）** | **吸收 teams** |
| HTTP 路由 | 无独立路由层 | **有（web-routes.ts）** | **吸收 teams** |
| 宿主兼容层 | 分散 | **有（harness-compat.ts）** | **吸收 teams** |
| 开发 skill 库 | 无 | **有（11 个）** | **吸收 teams** |
| Composition | group + isolate + 私有 preset | 单行 insert | 需重新设计 |
| 构建链 | tsc ×3 + 自研 build-client | tsdown + lightningcss | **需二选一** |

**结论**：两者能力互补性极高，几乎没有正面冗余——`team` 强在**持久化协作内核 + 人类参与 + UI 完成度**，`teams` 强在**任务编排 + 调度 + 质量门禁 + 可观测性 + 工程规范**。

---

## 四、建议的整合路径（待主人拍板）

### 4.1 结构方案

保留 `team` 的 monorepo 骨架，按能力归位：

```
dsh-sophia-entities/
├── package.json                 # name: @sophia/dsh-sophia-entities（暂定）
├── cordis.patch.yml             # 重写：统一 id = 包名
├── pnpm-workspace.yaml
└── packages/
    ├── core/                    # ← 由 agent-team 演化，注入 teams 的 scheduler / quality-gates / tasks
    ├── tools/                   # ← 由 tool-agent-team 演化，并入 teams 的 tool-names 体系
    ├── client/                  # ← 由 client-agent-team 演化，并入 ActivityPanel / StagingPlanEditor
    └── compat/                  # ← 新增，吸收 teams 的 harness-compat + web-routes
```

### 4.2 吸收优先级（建议分四批）

- **P0 · 合同层**：统一包名 / patch id / ModuleLoader id；选定构建链；跑通 hello 冒烟（命令 + health 路由 + UI 标记）
- **P1 · 内核吸收**：tasks 依赖图 + scheduler + quality-gates 并入 core
- **P2 · 可观测性**：ActivityPanel / 活动树 / StagingPlanEditor 并入 client
- **P3 · 工程资产**：11 个插件开发 skill 与 `harness-compat` 并入仓库工程流

### 4.3 构建链选择（关键决策）

| 方案 | 优点 | 代价 |
|---|---|---|
| A · 沿用 team 的 tsc ×3 + build-client.mjs | 改动最小，基座原样能跑 | 需自行核对是否满足 ModuleLoader 纯度门禁 |
| B · 换用 teams 的 tsdown + lightningcss | 协议实现更严谨，内置纯度门禁与 CSS 注入 | 需重写 team 的构建脚本，产物路径要重新对齐 |

初步倾向 **B**：`tsdown.config.ts` 里那套纯度门禁和 `PLUGIN_ID` 从 package.json 读取的做法，是防踩坑的硬保障。

---

## 五、风险与硬约束清单

1. **id 三处一致**：`package.json.name` = `cordis.patch.yml` 的 insert id/name = client `__ModuleLoader__` id。任一不一致 → Node 半能加载、浏览器半静默失败。
2. **禁止声明 `@deepseek-ai/*` 依赖**：DSH profile 已提供，声明会污染依赖树。
3. **client bundle 纯度**：跨插件 `@deepseek-ai/*` value import 会构建报错，只能走 cordis service + type-only import。
4. **React 必须 external**：`react` / `react/jsx-runtime` / `react-dom` / `react-dom/client`，否则出现重复 React 实例与 `useState` null 崩溃。
5. **CSS Modules 是两种实现**：team 与 teams 各有一套（后者 lightningcss + `<style data-plugin>` 注入），整合时必须择一，不能并存。
6. **patch 的 group/isolate 语义**：team 用 `isolate: agentPresets` 保护宿主 preset 不被污染，重写 patch 时必须保留这层隔离，否则会覆盖用户的 `standard` preset。
7. **Node 侧变更需重启 web**：ESM 缓存不热更，改 Node 半必须重启，否则会误判为"没生效"。
8. **上游版本漂移**：两者都在快速迭代（team 0.1.15 / teams 0.1.21）。基线 commit 已记录如下，后续合并上游更新时以它们为 diff 参照：

   | 上游 | 版本 | 基线 commit | 提交时间 | 提交信息 |
   |---|---|---|---|---|
   | dsh-agent-team | 0.1.15 | `b70a80fb8c28485aa578df3f6e59ecac0404f86b` | 2026-09-24 15:10:55 +0800 | chore: release 0.1.15 |
   | dsh-agent-teams | 0.1.21 | `f60d40d7dddbdd2283a2d79f823a9c9852e19d13` | 2026-09-25 03:21:53 +0800 | feat: release 0.1.21 with compact native team workspace |

9. **`.gitignore` 与分发方式存在矛盾（需决策）**：上游 `.gitignore` 第 2 行忽略了 `lib/`，即构建产物**不入 git**；但 `package.json.files` 却把 `packages/agent-team/lib/**/*` 等列为分发内容。这相当于"产物靠 `npm pack` / CI 现场构建"。若我们后续选择 **git 源分发**（DSH 插件常见做法，通常要求构建产物入库，否则安装端拿不到 `lib/`），需要把 `lib/` 从 `.gitignore` 摘掉，或改为 CI 构建 + npm 分发。

---

## 六、待主人拍板的决策项

| # | 决策 | 选项 |
|---|---|---|
| D1 | 最终包名 | `@sophia/dsh-sophia-entities` / `dsh-sophia-entities` / 其它 |
| D2 | 构建链 | A 沿用 tsc 链 ／ **B 换 tsdown（倾向）** |
| D3 | 目录结构 | 4 包拆分 ／ 保持 3 包 ／ 单包扁平 |
| D4 | P1 吸收范围 | 全部（tasks + scheduler + quality-gates）／ 仅 tasks + scheduler |
| D5 | 是否吸收 11 个开发 skill | 是（进仓库工程流）／ 否 |
| D6 | 上游基线 | 是否记录当前 commit 作为 diff 参照 |

---

---

## 七、进度更新日志

### 2026-09-25 · 第一步：基座源码导入（已完成）

将 `dsh-agent-team` 全量源码导入 `dsh-sophia-entities/`，共 **553 个文件**（含本报告）。

**排除项**（有意不带）：

- `.git/` — 上游 git 历史。带去会让我们这个仓库的 remote / 历史与上游纠缠，不利于独立演进。
- `packages/agent-team/node_modules/` — 依赖残留（实际仅 1 个文件）。

**导入后的完整可构建结构**：

| 路径 | 文件数 | 说明 |
|---|---|---|
| `packages/agent-team/` | 71 | 核心运行时 + `core-skills/` |
| `packages/tool-agent-team/` | 11 | 工具暴露层 |
| `packages/client-agent-team/` | 89 | Web UI（含全部 `.module.css`） |
| `scripts/` | 25 | 构建与校验脚本 |
| `docs/` | — | 上游架构文档全量（architecture / development / frontend-design / team-collaboration 等，均含中英双语） |
| 其它 | — | `assets/`、`.github/`、`AGENTS.md`、`CHANGELOG.md`、`CONTRIBUTING*`、`LICENSE` |

配置文件全部就位：`package.json`、`cordis.patch.yml`（19KB）、`pnpm-workspace.yaml`、`pnpm-lock.yaml`、`tsconfig.json` / `tsconfig.build-deps.json` / `tsconfig.types.json` / `tsconfig.scripts.json`、`vitest.config.ts`、`.jscpd.json`、`.npmrc`。

**已初始化独立 git 仓库**（分支 `main`），导入结果作为首个提交：

| 项 | 值 |
|---|---|
| 基线提交 | `a90875c` — chore: import @wowyuarm/dsh-agent-team v0.1.15 as development baseline |
| 入库文件数 | 553 |
| 上游来源 | `wowyuarm/dsh-agent-team` @ `b70a80fb8c28485aa578df3f6e59ecac0404f86b`（v0.1.15） |

该提交即**纯净基座快照**，后续任何改动都可与之 `git diff a90875c` 对照。

### 仍未开始（等待主人指令）

- 包名 / patch id / ModuleLoader id **尚未改名**，当前仍是上游的 `@wowyuarm/dsh-agent-team`。
- **尚未引入 `dsh-agent-teams` 的任何代码**（它只在旁路目录 `../dsh-agent-teams/` 待命）。
- 尚未执行 `pnpm install`，未执行任何构建或测试。

---

*本报告随开发推进持续更新。*
