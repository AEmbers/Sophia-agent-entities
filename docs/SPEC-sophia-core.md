# sophia-core API 契约与验收标准

> 版本：v0.1
> 日期：2026-09-23
> 状态：待评审（`t1` 产出）
> 对应需求：`docs/REQUIREMENTS.md` v0.1（FR-5A / FR-5 / FR-10）
> 对应开发文档：`docs/DEVELOPMENT.md` §2 §3.1 §3.4 §4 §5
> 包路径：`packages/sophia-core/`

---

## 0. 本文档的定位与边界

**本文档只冻结契约，不含实现。** 所有 TypeScript 片段是 `declare`/`interface`/类型别名形式的**签名**，
不含函数体。实现由 `t3`–`t6` 按本契约完成。

在范围内：

| FR | 主题 | 本契约章节 |
|---|---|---|
| FR-5A | 成员标识三层模型 | §3 |
| FR-5 | 团队派生策略、权限矩阵、两级审批、子团归属 | §4 §5 |
| FR-10 | 统一追加式账本与 scope 增量投影 | §6 |
| — | 支撑类型（角色模型 / 团队实体 / 双模草案） | §2 |

在范围外（本契约只冻结签名，行为验收留待里程碑）：FR-1/FR-2 双模草案的生成行为、
FR-6 热换模的执行语义、FR-7 DAG 归属守卫、FR-9 生命周期的运行时重建。

**一句话**：本文档是 `sophia-core` 的**唯一契约来源**。实现与契约冲突时契约优先；
需要改契约时改本文档并同步验收表，不得由实现单方面改口径。

---

## 1. 工程前置约束（实测得出，非推断）

> 本节每一条都有可复现命令与实测取值。下游 `t2`–`t6` 若违反本节，会在编译或测试阶段直接卡死。

### 1.1 不要 import `@deepseek-ai/*` 的类型（最重要）

**实测结论**：本机所有 DSH SDK 安装**都不含 `.d.ts` 声明文件**，因此
`import type { SessionId } from '@deepseek-ai/dsh-session'` **无法通过类型检查**。

实测证据：

| 检查 | 命令 / 对象 | 实测取值 |
|---|---|---|
| SDK 版目录 | `C:\Users\Administrator\.dsh\core-0.1.5-rc.1\@deepseek-ai` | 243 个包目录 |
| 该目录下 `.d.ts` 总数 | 递归计数 `*.d.ts` | **0**（总文件 2275） |
| 各包 `package.json` 的 `types` 字段 | 逐个读取后 `Test-Path` | 7/7 包均声明 `lib/types/index.d.ts`，**7/7 实际不存在** |
| DSH 自身 `node_modules` | `resources\app\node_modules\@deepseek-ai` | 243 包，`.d.ts` **0** |
| 直接引用该路径做类型检查 | `tsc` 对一个 `import type` 探针 | `error TS7016: Could not find a declaration file for module ...`，**exit 2** |
| npm 上的 `@deepseek-ai/dsh-session` | `npm install @deepseek-ai/dsh-session@0.0.1-rc.1` | **install exit 1**；`404 Not Found - GET .../@deepseek-ai%2fdsh-type-meta`（peer 依赖在 registry 不存在），且版本线为 `0.0.1-rc.1`，远旧于本地 `0.1.5-rc.1` |

**契约要求**：`packages/sophia-core` 必须**自持全部领域类型**，不得从 `@deepseek-ai/*` 引入类型。
需要的 ID 类型自行用品牌化类型定义（见 §2.1）。

> 这与 `DEVELOPMENT.md` §3.1 的规划一致（`sophia-core` 本就只放领域模型与契约），
> 但与 `t2` 任务描述里「用 file: 依赖或 tsconfig paths 指向它解析 `@deepseek-ai/*`」的设想**冲突** ——
> 那条路走不通。**按本节执行**，`t2` 不要花时间在 SDK 类型解析上。

### 1.2 工具链版本（已实测可跑通）

在探针仓库中以本契约规定的布局实测，两个验收命令均通过：

| 项 | 取值 | 实测 |
|---|---|---|
| Node | v24.19.0 | `node -v` |
| 内建 SQLite | SQLite 3.53.3，`node:sqlite` 可用 | `DatabaseSync` 建表/触发器/增删改查全部成功 |
| typescript | 5.9.3 | `tsc --version` → `Version 5.9.3` |
| vitest | 4.1.11 | `vitest run` 正常运行 |
| @types/node | 24.13.6 | 含 `sqlite.d.ts`，`import { DatabaseSync } from 'node:sqlite'` 类型检查 **exit 0** |
| 包管理器 | pnpm 11.8.0 / npm 11.17.0 | `pnpm -v` / `npm -v` |
| registry | `https://registry.npmmirror.com`（`~/.npmrc`） | 可安装上述全部包 |

**依赖固定**（写进 `packages/sophia-core/package.json` 的 `devDependencies`；根目录安装）：

```json
{
  "devDependencies": {
    "typescript": "5.9.3",
    "vitest": "4.1.11",
    "@types/node": "24.13.6"
  }
}
```

> 不引入 `pinyin-pro` 等第三方运行时依赖：slug 以 §3.3 的**规范表**为准（该表已足够覆盖 20 个规范职位），
> 引入运行库反而会给「表与库不一致」制造新的不确定来源（实测该库与需求文档已有一处不一致，见 §3.3）。

### 1.3 `tsconfig` 与 import 风格（已实测）

```jsonc
// packages/sophia-core/tsconfig.json
{
  "compilerOptions": {
    "target": "es2024",
    "module": "esnext",
    "moduleResolution": "bundler",
    "lib": ["es2024"],
    "types": ["node"],
    "allowImportingTsExtensions": true,
    "rewriteRelativeImportExtensions": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src", "tests", "vitest.config.ts"]
}
```

- 相对 import **必须带 `.ts` 扩展名**（`import { x } from './naming.ts'`）。此风格已实测
  `tsc exit 0` + `vitest exit 0`（探针仓库）。
- `noEmit: true`：本期只做类型检查与测试，不产出构建物。
- 刻意开启 `exactOptionalPropertyTypes` 与 `noUncheckedIndexedAccess`：本契约大量使用可选字段与索引读取，
  这两项能把「忘了判 undefined」变成编译错误。

### 1.4 仓库根工作区

仓库根**当前不存在** `package.json` 与 `pnpm-workspace.yaml`（实测 `Test-Path` 均为 False），由 `t2` 创建：

```yaml
# pnpm-workspace.yaml
packages:
  - 'packages/*'
```

> ⚠️ glob **只能写 `packages/*`**。`dsh-agent-team/` 与 `dsh-agent-teams/` 是 `git subtree` 收录的独立上游仓库，
> 各有自己的 workspace（`dsh-agent-team/pnpm-workspace.yaml` 已存在，含 `packages/*`）。
> 根 glob 若写成 `**` 会把上游子树的包卷进本仓工作区，破坏 C2「不以 fork/submodule 改写上游」。

---

## 2. 支撑类型：角色模型与团队实体

### 2.1 品牌化 ID

```ts
// src/types/ids.ts
declare const brand: unique symbol
type Brand<T, B extends string> = T & { readonly [brand]: B }

export type TeamId = Brand<string, 'TeamId'>
export type MemberId = Brand<string, 'MemberId'>
export type DagTeamId = Brand<string, 'DagTeamId'>
export type ChannelId = Brand<string, 'ChannelId'>
export type ThreadId = Brand<string, 'ThreadId'>
export type PlanId = Brand<string, 'PlanId'>
export type EventId = Brand<string, 'EventId'>
export type SpawnTicketId = Brand<string, 'SpawnTicketId'>
export type RequestId = Brand<string, 'RequestId'>
export type HostSessionId = Brand<string, 'HostSessionId'>
```

**AC-ID-1**：上述 10 个 ID 类型互不可赋值（`TeamId` 不能传给要 `MemberId` 的参数）。
**验证**：`tests/types.spec.ts` 用 `@ts-expect-error` 标注 3 组交叉赋值；若 `@ts-expect-error` 未报错则 `tsc` 失败。

### 2.2 角色模型（FR-5.0）

以「皇帝下旨」为喻的三权分立，**窗口不绑团**是本设计的核心：

```ts
// src/types/roles.ts

/** 人类用户（皇帝）。 */
export interface Human {
  readonly kind: 'human'
  readonly humanId: string
  readonly displayName: string
}

/**
 * 宿主 / 传旨通道（窗口会话，传旨小秘）。
 * FR-5.0.3：任意窗口可向任意持久团下达任务；窗口关闭不影响团队存续。
 * 关键：这里**没有** teamId —— 宿主与团是多对多、可替换的引用，不是所有权。
 */
export interface Host {
  readonly kind: 'host'
  readonly hostSessionId: HostSessionId
}

/** 持久团团长（监正）：团内成员，非窗口 Agent。FR-5.0.2 */
export interface Principal {
  readonly kind: 'principal'
  readonly teamId: TeamId
  readonly memberId: MemberId
}

/** 团内普通成员。 */
export interface Member {
  readonly kind: 'member'
  readonly teamId: TeamId
  readonly memberId: MemberId
}

export type Entity = Human | Host | Principal | Member
```

**AC-ROLE-1（锚点解耦）**：`Host` 上**不存在** `teamId` 字段；`Team` 上**不存在** `hostSessionId` 作为
存在性锚点（只能有可选的、可替换的 `lastHostSessionId` 审计字段）。
**验证**：`tests/types.spec.ts` 用 `@ts-expect-error` 断言 `host.teamId` / `team.hostSessionId` 不可访问。
> 这条直接对治上游 `dsh-agent-teams/src/types.ts:248` 的 `captainSessionId` 僵尸团问题
> （见 `DEVELOPMENT.md` §2A）。它是本包最重要的类型级约束，必须有测试守着。

**AC-ROLE-2**：构造一个 `Host` 不需要任何 `TeamId`，构造一个 `Team` 不需要任何 `HostSessionId`。
**验证**：`tests/types.spec.ts` 中直接字面量构造，`tsc exit 0` 即通过。

### 2.3 团队二分（FR-5.1）

```ts
// src/types/team.ts

/** 团队类型：持久团 / 临时团。FR-5.1 */
export type TeamKind = 'persistent' | 'temporary'

/** 派生发起方类型：由其所处团队的 kind 决定。 */
export type CallerKind = TeamKind

/** 成员可用性（持久态，由显式操作改变）。 */
export type MemberLifecycle = 'active' | 'suspended' | 'archived' | 'destroyed'

/** 成员存在态（运行期派生，**不得持久化**）。FR-3.2 */
export type MemberPresence = 'idle' | 'running'

export interface Team {
  readonly teamId: TeamId
  readonly kind: TeamKind
  /** FR-5.4.1：子团归发起成员个人所有；顶层团为 null。 */
  readonly ownerMemberId: MemberId | null
  readonly parentTeamId: TeamId | null
  /** 审计字段：最近一次呈送核准/下达任务的窗口。**不是**存在性锚点。 */
  readonly lastHostSessionId?: HostSessionId | undefined
  readonly state: 'active' | 'suspended' | 'destroyed'
  readonly createdAtSequence: number
}
```

> **⚠️ 需求书内部冲突，本契约的裁决**：`REQUIREMENTS.md` FR-3.2 写可用性为
> `active / inactive / archived`，而 FR-9.1 的挂起操作却把状态置为 `suspended` ——
> **同一个概念出现了两个名字**。本契约裁定：**规范名取 `suspended`**，
> FR-3.2 的 `inactive` 视为 `suspended` 的同义别名，**不得**实现为两个并存状态。
> 理由：FR-9 是生命周期操作的规范来源（`suspend`/`resume`/`destroy` 三个操作名），
> 状态名应与操作名一致；而 FR-3.2 只是枚举列举。此裁决需回写 `REQUIREMENTS.md` FR-3.2。

**AC-TEAM-1**：`MemberLifecycle` 恰为 4 个字面量，且 `'inactive'` 不在其中。
**验证**：`tests/types.spec.ts` 用 `@ts-expect-error` 断言 `const s: MemberLifecycle = 'inactive'` 报错。

### 2.4 双模草案（FR-1，仅冻结签名）

```ts
// src/types/staging.ts
export interface StagingDualPlan {
  readonly planId: PlanId
  readonly workspaceId: string
  readonly goal: string
  readonly teamPlan: {
    readonly channelId: ChannelId
    readonly members: readonly { readonly memberId: MemberId; readonly label: string; readonly role: string }[]
    readonly threads: readonly { readonly title: string; readonly assignee: MemberId }[]
  }
  readonly dagPlan: {
    readonly roster: readonly { readonly label: string; readonly provider: string; readonly model: string }[]
    readonly tasks: readonly {
      readonly id: string
      readonly name: string
      readonly deps: readonly string[]
      readonly assigneeLabel: string
    }[]
  }
}

/** FR-2.2 模式二选一；FR-2.1 默认 persistent-team。 */
export type RunMode = 'persistent-team' | 'dag-scheduler'
export declare const DEFAULT_RUN_MODE: RunMode
```

**AC-STAGE-1**：`DEFAULT_RUN_MODE === 'persistent-team'`（FR-2.1）。
**验证**：`tests/staging.spec.ts` 断言取值。

---

## 3. FR-5A：成员标识三层模型

### 3.1 三层定义

| 层 | 字段 | 唯一性 | 字符集 | 界面上是否展示 | 是否烧进素材像素 |
|---|---|---|---|---|---|
| 职位 | `position` | ❌ 可多实例 | 纯中文，且**必须**是 §3.2 规范职位之一 | ✅ 优先展示 | ✅ 是（实测不透明像素 94.4%） |
| 成员名 | `name` | ✅ 团队内唯一 | 职位名，或 `职位名-<序号>` | ✅ 重名时才露序号 | ❌ DOM 文本 |
| 成员 ID | `memberId` | ✅ 全局唯一 | `sophia-<slug>-<uuid8>` | ❌ 不展示 | ❌ |

```ts
// src/types/member.ts
export interface MemberIdentity {
  /** 职位（FR-5A.1）：非唯一，同职位可多实例。 */
  readonly position: Position
  /** 成员名（FR-5A.2）：团队内唯一。 */
  readonly name: MemberName
  /** 成员 ID（FR-5A.3）：全局唯一，界面不展示。 */
  readonly memberId: MemberId
}

/** 规范职位名（纯中文）。 */
export type Position = string
/** 成员名：职位名 或 职位名-序号。 */
export type MemberName = string
```

### 3.2 规范职位名册（20 位，**逐字**取自素材文件名）

来源：`assets/members/out-512/` 下的 PNG 文件名（实测列目录得到，20 个）。
FR-8.1 要求「须与素材图上的烧入标签**逐字一致**」，因此本名册是**闭集**。

```ts
// src/naming.ts
export declare const POSITIONS: readonly [
  // 第一梯队 · 管理与总控组
  '钦天监监正', '灵台主事', '时宪主事', '典籍掌事', '星禁掌察',
  // 第二梯队 · 产品分析与设计组
  '观象访事', '星图主事', '象绘主事', '星绘主事', '传报主事',
  // 第三梯队 · 架构与研发组
  '灵台郎', '历算主事', '星仪主事', '数象主事', '推步主事',
  // 第四梯队 · 测试运维与文档组
  '星验主事', '星机校验', '天象值守', '星文审校', '录典主事',
]
export type KnownPosition = (typeof POSITIONS)[number]
export declare function isKnownPosition(value: string): value is KnownPosition
```

**AC-5A-1**：`POSITIONS.length === 20`，且**按梯队分组**与素材目录**双向一致**（既无遗漏、也无多余），即 `POSITIONS` 与 `assets/members/out-512/**.png` 的 basename 集合**相等**。

**验证**：`tests/naming.spec.ts` 用 `node:fs` 读四个梯队目录，与下表逐组比对：

```ts
const TIER_EXPECTATION: Readonly<Record<string, readonly KnownPosition[]>> = {
  '01_第一梯队_管理与总控组':     ['钦天监监正', '灵台主事', '时宪主事', '典籍掌事', '星禁掌察'],
  '02_第二梯队_产品分析与设计组': ['观象访事', '星图主事', '象绘主事', '星绘主事', '传报主事'],
  '03_第三梯队_架构与研发组':     ['灵台郎', '历算主事', '星仪主事', '数象主事', '推步主事'],
  '04_第四梯队_测试运维与文档组': ['星验主事', '星机校验', '天象值守', '星文审校', '录典主事'],
}
```

断言：四个目录名恰好是上表的 4 个键；每组的 `.png` basename 集合与该组数组**互为子集**
（用排序后 `join(',')` 相等断言，避免「只查缺失不查多余」的半边断言）。

> **实测已核对（本契约作者执行）**：`spec count = 20; actual count = 20`、
> `missing in assets = []`、`extra in assets = []`，且四个梯队分组逐一 `MATCH`。
> 本契约列出的 20 个职位与素材文件名**双向零差异**。

**反恒真**：把 `POSITIONS` 里任意一项改成 `'不存在职位'`，测试必须变红；
把素材目录里任一 `.png` 改名后，测试同样必须变红（证明不是「只查一边」的恒真断言）。

### 3.3 职位 → slug 规范表

FR-8.3 要求 `memberId` 形如 `sophia-<position-slug>-<uuid8>`，并给出示例
`灵台郎 → lingtai-lang`（`REQUIREMENTS.md:204`）。

**实测发现：该示例不能用「逐字拼音连字符」这一条朴素规则得到。**
实测（`pinyin-pro@3.29.4`，`type:'array', toneType:'none'`）逐字结果为 `ling-tai-lang`，
而需求文档钉的是 `lingtai-lang` —— 说明**天文机构名（灵台）在 slug 中是一个不可切分的整体**。

**本契约的规则**（已用该规则复现文档示例，取值如下表实测）：

> 若职位名以机构名开头，则该机构名按**一个 token** 整体转写，其余部分逐字转写；
> 两种 token 之间用 `-` 连接。

```ts
// src/naming.ts

/** 可作为 slug 前缀整体的天文机构名。 */
export declare const INSTITUTIONS: readonly ['钦天监', '灵台', '推步', '历算']

/**
 * 规范 slug 表：20 个规范职位的唯一权威映射。
 * 实现必须以此表为准（表驱动），不得仅靠通用拼音库实时推导。
 */
export declare const POSITION_SLUGS: Readonly<Record<KnownPosition, string>>

/** 职位 → slug。未知名册的职位抛 NamingViolation。 */
export declare function positionSlug(position: string): string
```

**规范表（本契约钉死，实现须逐字匹配）**：

| 职位 | slug | 备注 |
|---|---|---|
| 钦天监监正 | `qintianjian-jian-zheng` | 机构 `钦天监` 整体 |
| 灵台主事 | `lingtai-zhu-shi` | 机构 `灵台` 整体 |
| 时宪主事 | `shi-xian-zhu-shi` | |
| 典籍掌事 | `dian-ji-zhang-shi` | |
| 星禁掌察 | `xing-jin-zhang-cha` | |
| 观象访事 | `guan-xiang-fang-shi` | |
| 星图主事 | `xing-tu-zhu-shi` | |
| 象绘主事 | `xiang-hui-zhu-shi` | |
| 星绘主事 | `xing-hui-zhu-shi` | |
| 传报主事 | `chuan-bao-zhu-shi` | |
| **灵台郎** | **`lingtai-lang`** | **文档示例，必须逐字一致** |
| 历算主事 | `lisuan-zhu-shi` | 机构 `历算` 整体 |
| 星仪主事 | `xing-yi-zhu-shi` | |
| 数象主事 | `shu-xiang-zhu-shi` | |
| 推步主事 | `tuibu-zhu-shi` | 机构 `推步` 整体 |
| 星验主事 | `xing-yan-zhu-shi` | |
| 星机校验 | `xing-ji-jiao-yan` | |
| 天象值守 | `tian-xiang-zhi-shou` | |
| 星文审校 | `xing-wen-shen-jiao` | ⚠️ 见下 |
| 录典主事 | `lu-dian-zhu-shi` | |

> **⚠️ 「星文审校」是本表唯一一处由本契约人工裁定的条目，依据必须写明**：
> 多音字「校」有两读 —— `xiào`（学校）与 `jiào`（校订、校对）。「审校」取**校订义**，
> 故为 `shěn jiào`。**实测**：通用拼音库 `pinyin-pro@3.29.4` 对该词返回 `shen-xiao`，
> 与词义不符（同库对「星机校验」返回 `jiao-yan`，是正确的那一读 ⇒ 库本身对「校」的两读都会用，只是此处选错）。
> 这正是「slug 必须以表为权威」的理由：**表把歧义消掉，测试才有唯一答案**。
> 若主人裁定应随库（`shen-xiao`），改本表一行即可，其余不受影响。

**AC-5A-2**：`positionSlug('灵台郎') === 'lingtai-lang'`（文档示例逐字）。
**AC-5A-3**：`POSITION_SLUGS` 覆盖全部 20 个职位，且所有 slug 匹配 `^[a-z]+(-[a-z]+)*$`（小写字母 + 连字符）。
**验证**：`tests/naming.spec.ts` 遍历 `POSITIONS` 断言 `positionSlug(p) === POSITION_SLUGS[p]` 且正则匹配。
**反恒真**：把 `POSITION_SLUGS['灵台郎']` 改成 `'ling-tai-lang'`，测试必须变红。

### 3.4 成员 ID 构造与解析

```ts
// src/naming.ts

/** FR-8.3：memberId 形如 sophia-<position-slug>-<uuid8>；uuid8 为 8 位小写十六进制。 */
export interface MemberIdParts {
  readonly slug: string
  readonly uuid8: string
}

/** 用给定 uuid8 构造 memberId。 */
export declare function toMemberId(position: string, uuid8: string): MemberId

/** 解析 memberId；不匹配规范格式时返回 null（不抛错）。 */
export declare function parseMemberId(memberId: string): MemberIdParts | null

/** 生成一个符合格式的 uuid8（调用方负责全局唯一性校验）。 */
export declare function newUuid8(): string
```

**AC-5A-4**：`parseMemberId(toMemberId('灵台郎', 'a1b2c3d4'))` 还原出 `{ slug: 'lingtai-lang', uuid8: 'a1b2c3d4' }`（往返一致）。
**AC-5A-5**：`parseMemberId` 对以下 5 类畸形输入均返回 `null` 而非抛错：
`''`、`'sophia-lingtai-lang'`（缺 uuid8）、`'lingtai-lang-a1b2c3d4'`（缺前缀）、
`'sophia-lingtai-lang-A1B2C3D4'`（大写）、`'sophia-lingtai-lang-a1b2c3d'`（7 位）。
**验证**：`tests/naming.spec.ts` 表驱动断言。**反恒真**：放宽正则使大写可过，第 4 条必须变红。

### 3.5 成员名分配（FR-5A.2 / FR-8.2）

```ts
// src/naming.ts

/** 成员名的占用判定范围：仍属于该团的成员。 */
export interface NameOccupancy {
  readonly name: MemberName
  readonly lifecycle: MemberLifecycle
}

/**
 * 为一个职位分配团队内唯一的成员名。
 * 规则：无冲突 → 职位名本身；已有 n 个同名 → 职位名 + '-' + (最小可用序号 ≥ 2)。
 */
export declare function allocateMemberName(
  position: string,
  occupied: readonly NameOccupancy[],
): MemberName

/** 界面显示名：优先职位名，仅在重名需要区分时露出序号。FR-5A.4 */
export declare function displayNameOf(identity: MemberIdentity): string
```

**占用语义（本契约裁定，必须实现并测试）**：

- 参与占用的生命周期：`'active'` 与 `'suspended'`（仍属该团，可 resume）。
- **不**参与占用的生命周期：`'archived'` 与 `'destroyed'` —— 名字释放，可被复用。
- 序号从小到大找**第一个未占用**的，即 `-2`、`-3`…

**AC-5A-6**：空占用时 `allocateMemberName('灵台郎', []) === '灵台郎'`。
**AC-5A-7**：已有一个 `'灵台郎'`（active）时 → `'灵台郎-2'`；再有 `'灵台郎-2'` 时 → `'灵台郎-3'`。
**AC-5A-8**：占用的 `'灵台郎'` 为 `destroyed` 时 → 回到 `'灵台郎'`（名字释放）。
**AC-5A-9**：已占用 `'灵台郎'` 与 `'灵台郎-3'`（跳过 `-2`）时 → 分配 `'灵台郎-2'`（**取最小可用，不取最大值+1**）。
**验证**：`tests/naming.spec.ts` 四个用例。**反恒真**：把「取最小可用」改成「取 max+1」，AC-5A-9 必须变红。

### 3.6 命名门禁与违例

FR-8.4：不合规须在创建/重命名入口拒绝，且**错误信息须说明规则与正确示例**。
FR-5A.5 / FR-8.1：职位名**不要求** `Sophia` 前缀。
FR-8.5：除成员 ID 的前缀外，对用户可见的名称**不得出现英文字母**。

> **⚠️ 与 `DEVELOPMENT.md` §3.1 的冲突，本契约的裁决**：
> `DEVELOPMENT.md:102` 仍写着 `src/naming.ts` 的职责是「命名门禁 `^Sophia[\u4e00-\u9fa5][\u4e00-\u9fa5_0-9]*$`」。
> **该正则是 FR-8 修订前的遗留，已作废**：它强制 `Sophia` 前缀，且允许下划线与阿拉伯数字 ——
> 三点都与现行需求冲突：
> 1. 与 FR-5A.5 / FR-8.1「职位名**不要求** `Sophia` 前缀」冲突；
> 2. 与 FR-8.1「纯中文」冲突（该正则允许 `_` 与 `0-9`）；
> 3. 与 FR-8.5「对用户可见名称不得出现英文字母」冲突（`Sophia` 前缀本身就是英文字母，
>    FR-8.5 只对**成员 ID** 开例外，不对职位名/成员名开）。
> `REQUIREMENTS.md:193-197` 的修订说明已明确记录这次方向变更，`DEVELOPMENT.md` 这里是漏改。
>
> **本契约的有效门禁**（取代该正则）：职位名走 §3.2 的**纯中文闭集**校验；
> 成员名走 §3.5 的形状 + 唯一性校验；`Sophia` 前缀**只**出现在 `memberId`（§3.4）。
> 建议同步修正 `DEVELOPMENT.md:102`。

```ts
// src/naming.ts

export type NamingErrorCode =
  | 'POSITION_NOT_CHINESE'      // 含非中文（如英文、数字、空格）
  | 'POSITION_UNKNOWN'          // 纯中文但不在 POSITIONS 名册内
  | 'NAME_NOT_UNIQUE'           // 团队内重名
  | 'NAME_SHAPE_INVALID'        // 不符 `职位名` 或 `职位名-<序号≥2>`
  | 'MEMBER_ID_SHAPE_INVALID'   // 不符 `sophia-<slug>-<uuid8>`

/** FR-8.4：违规必须同时带规则说明与正确示例。 */
export interface NamingViolation {
  readonly code: NamingErrorCode
  /** 面向用户的说明（中文）。 */
  readonly message: string
  /** 被违反的规则原文，如 `职位名须为纯中文且属于规范名册`。 */
  readonly rule: string
  /** 正确示例，如 `灵台郎`。 */
  readonly example: string
}

export type NamingResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly violation: NamingViolation }

/** 校验职位名：纯中文 + 属名册。 */
export declare function validatePosition(value: string): NamingResult<Position>

/** 校验成员名：形状合法 + 在给定占用下唯一。 */
export declare function validateMemberName(
  value: string,
  occupied: readonly NameOccupancy[],
): NamingResult<MemberName>

/** 校验 memberId：形状合法（全局唯一性由账本保证，不在此判定）。 */
export declare function validateMemberId(value: string): NamingResult<MemberId>
```

**AC-5A-10**：`validatePosition('灵台郎').ok === true`。
**AC-5A-11**：`validatePosition('Sophia灵台郎')` → `code === 'POSITION_NOT_CHINESE'`（含英文字母）。
**AC-5A-12**：`validatePosition('灵台郎2')` → `code === 'POSITION_NOT_CHINESE'`（含阿拉伯数字）。
**AC-5A-13**：`validatePosition('天官正')` → `code === 'POSITION_UNKNOWN'`（纯中文但不在名册）。
**AC-5A-14**：每一条违例的 `rule` 与 `example` 均**非空字符串**，且 `message` **包含** `rule` 中的规则关键词。
**AC-5A-15**：`validateMemberName('灵台郎', [{name:'灵台郎', lifecycle:'active'}])` → `code === 'NAME_NOT_UNIQUE'`，
且 `violation.example` 提示可用序号（内容非空）。
**验证**：`tests/naming.spec.ts`。**反恒真**：把 `validatePosition` 的中文正则改成恒真，
AC-5A-11/12 必须变红。

---

## 4. FR-5.2：派生权限矩阵

### 4.1 策略常量

`DEVELOPMENT.md` §3.4 已给出策略形状，本契约予以冻结：

```ts
// src/delegation.ts
import type { TeamKind, CallerKind } from './types/team.ts'

/** 一个派生申请：成员想开一个什么样的团。 */
export interface SpawnRequest {
  /** 幂等 + 审计键。同一 requestId 的重复提交按 FR-5.3.4 处理（见 §5.3）。 */
  readonly requestId: RequestId
  readonly requesterMemberId: MemberId
  /** 发起方类型：由其所处团队的 kind 决定。 */
  readonly requesterKind: CallerKind
  readonly targetKind: TeamKind
  /** 拟建团的规格。 */
  readonly spec: TeamSpec
}

/** 拟建团规格（字面沿用 DEVELOPMENT.md §3.4 的 TeamSpec）。 */
export interface TeamSpec {
  /** 拟用团名（展示用）。 */
  readonly name: string
  /** 拟建名册：职位 + 数量。 */
  readonly roster: readonly { readonly position: string; readonly count: number }[]
  /** 拟建任务标题。 */
  readonly tasks: readonly string[]
}

export interface DelegationPolicy {
  /** 该发起方允许创建的目标团队类型。 */
  readonly canSpawn: readonly TeamKind[]
  /** 目标类型 → 是否需要人类批准（两级审批）。 */
  readonly requiresApproval: Readonly<Record<TeamKind, boolean>>
}

/** 持久成员：两类都能开；持久团须两级审批，临时团免审。 */
export declare const PERSISTENT_POLICY: DelegationPolicy
/** 临时成员：只能开临时团，且免审。 */
export declare const TEMPORARY_POLICY: DelegationPolicy

export declare function policyOf(caller: CallerKind): DelegationPolicy
```

**AC-5-1（权限矩阵，逐格）**：

| 发起方 | 目标 = persistent | 目标 = temporary |
|---|---|---|
| persistent | 拒绝直建 → 进两级审批 | 直建（`created`） |
| temporary | **拒绝**（`ERR_SPAWN_FORBIDDEN`） | 直建（`created`） |

**验证**：`tests/delegation.spec.ts` 用 4 个用例覆盖整张矩阵，断言
`PERSISTENT_POLICY.canSpawn` 深等于 `['persistent','temporary']`、
`TEMPORARY_POLICY.canSpawn` 深等于 `['temporary']`、
两者 `requiresApproval` 深等于 `{persistent:true, temporary:false}`。
**反恒真**：把 `TEMPORARY_POLICY.canSpawn` 改成含 `'persistent'`，临时成员用例必须变红。

**AC-5-2（临时成员被拒 + 可读报错，FR-5.2.1）**：临时成员开持久团时：
- 结果为 `{ kind: 'forbidden' }`（**不是**抛异常，理由见 §4.3）；
- `reason` 为中文，且**同时**说明「为什么不行」与「该怎么办」（汇报给团长由持久成员发起）；
- **副作用为零**：不得创建任何团队、不得写入任何审批票据。

**验证**：`tests/delegation.spec.ts` 用注入的假账本记录 `commit` 调用次数，断言 `=== 0`。
**反恒真**：把 `requestSpawn` 的权限检查删掉，该用例必须变红（且 `commit` 次数变 1）。

**AC-5-3（不设层数上限，FR-5.2.2）**：派生链路上**不存在**任何深度阈值参数或常量。
**验证**：`tests/delegation.spec.ts` 断言语义 —— 在深度 0/1/2/3 各发起一次同规格持久团申请，
四次均返回 `awaitingHumanApproval`（而非 `forbidden`）；即 `requestSpawn` 的签名里没有 `depth`/`maxDepth`。
**反恒真**：在实现里加一个 `if (depth > 1) return forbidden`，该用例必须变红。

### 4.2 派生结果（可辨识联合）

```ts
// src/delegation.ts

export type SpawnOutcome =
  /** 免审直建：临时团。 */
  | { readonly kind: 'created'; readonly teamId: TeamId }
  /** 持久团：已进入第一级之后的第二级，等待人类批准。 */
  | { readonly kind: 'awaitingHumanApproval'; readonly ticketId: SpawnTicketId }
  /** 第一级被团长否决。 */
  | { readonly kind: 'rejectedByPrincipal'; readonly ticketId: SpawnTicketId; readonly reason: string }
  /** 权限矩阵拒绝（临时成员开持久团）。 */
  | { readonly kind: 'forbidden'; readonly reason: string }
  /** FR-5.3.4：同一 requestId 已被否决，禁止换目标类型绕开。 */
  | { readonly kind: 'noDowngradeBypass'; readonly ticketId: SpawnTicketId; readonly reason: string }

export type SpawnErrorCode = 'ERR_SPAWN_FORBIDDEN' | 'ERR_NO_DOWNGRADE_BYPASS'
```

**AC-5-4**：`SpawnOutcome` 恰有上述 5 个 `kind`，`kind` 是完整判别键（`switch` 无 `default` 也能穷尽）。
**验证**：`tests/delegation.spec.ts` 写一个穷尽 `switch`；若新增分支而漏处理，`tsc` 因
`noFallthroughCasesInSwitch` + 穷尽性检查而报错。

### 4.3 为什么用返回值而非异常

`DEVELOPMENT.md` §3.4 的草稿用 `throw new Error(...)` 表达「临时成员无权」。本契约**改为返回值**，理由：

1. 该分支是**预期内的业务结果**，不是异常；用返回值能让调用方被迫处理（穷尽 switch），
   而异常容易被上层 `catch` 后笼统吞掉，把一个权限拒绝变成静默失败。
2. 它要**落账本**（审计拒因），异常路径里落账更容易漏。
3. 可测性：返回值可被直接断言，无需 `expect(...).toThrow` 包住一条消息字符串。

> 交付 `sophia-tools` 时（M 后续），工具层再把这个返回值翻译成对模型可读的错误文本。

---

## 5. FR-5.3 / FR-5.4 / FR-5.6：两级审批与子团归属

### 5.1 审批票据与收件箱

```ts
// src/approval.ts
import type { TeamSpec, SpawnRequest } from './delegation.ts'

export type SpawnTicketStatus =
  | 'pending-principal'      // 等待第一级
  | 'pending-human'          // 第一级已过，等待第二级
  | 'rejected-principal'
  | 'approved'
  | 'rejected-human'

export interface SpawnTicket {
  readonly ticketId: SpawnTicketId
  readonly requestId: RequestId
  readonly requesterMemberId: MemberId
  /** 发起方所属团的团长（监正）。 */
  readonly principalMemberId: MemberId
  readonly targetKind: TeamKind
  readonly spec: TeamSpec
  readonly status: SpawnTicketStatus
  readonly raisedAtSequence: number
  readonly principalDecidedAtSequence?: number | undefined
  readonly humanDecidedAtSequence?: number | undefined
  readonly reason?: string | undefined
}

/** 第一级结论。 */
export interface PrincipalVerdict {
  readonly approved: boolean
  /** 否决时必填；批准时可为空。 */
  readonly reason?: string | undefined
}

/**
 * 第一级：团长预审（FR-5.3.1）。
 * 目的：避免人类被大量申请淹没，同时让架构老大大对技术决策负责。
 */
export interface PrincipalReviewer {
  reviewSpawn(request: SpawnRequest): Promise<PrincipalVerdict>
}

/**
 * 第二级通道：人类收件箱（FR-5.3.2）。
 * 沿 dsh-agent-team 已有的 Human Inbox 机制，使「任意窗口都能看到待办」。
 */
export interface HumanInbox {
  push(item: HumanInboxItem): Promise<void>
  list(): Promise<readonly HumanInboxItem[]>
}

export interface HumanInboxItem {
  readonly ticketId: SpawnTicketId
  readonly title: string
  /** FR-5.3.2 的待办动作。 */
  readonly actions: readonly ['approve', 'reject']
}
```

### 5.2 派生入口与两级流程

```ts
// src/delegation.ts
import type { PrincipalReviewer, HumanInbox, SpawnTicket } from './approval.ts'
import type { Ledger } from './ledger.ts'

export interface DelegationDeps {
  readonly ledger: Ledger
  readonly inbox: HumanInbox
  /** 按 memberId 解析其所属团的团长。 */
  readonly principalOf: (memberId: MemberId) => Promise<PrincipalReviewer>
  /** 仅免审路径使用：真正创建团队。 */
  readonly createTeam: (request: SpawnRequest) => Promise<TeamId>
  readonly now: () => number
}

/**
 * 派生入口：按策略决定「直接创建」还是「进入两级审批」。FR-5.2 / FR-5.3
 * 注意：深度不设层数上限 —— 控制手段是审批门（FR-5.2.2）。
 */
export declare function requestSpawn(
  deps: DelegationDeps,
  request: SpawnRequest,
): Promise<SpawnOutcome>

/** 第二级：人类批准/否决。批准后才创建团队（FR-5.3.3 落账本）。 */
export declare function decideSpawnTicket(
  deps: DelegationDeps,
  input: {
    readonly ticketId: SpawnTicketId
    readonly decision: 'approve' | 'reject'
    readonly reason?: string | undefined
  },
): Promise<SpawnOutcome>
```

### 5.3 两级审批顺序（不可跳级）

```
成员发起 → ① 团长（监正）预审 → ② 推送人类收件箱 → 人类批准 → 创建
                    ↓ 不通过                ↓ 不批准
                  打回并说明理由          不创建（成员不得降级为临时团绕开）
```

**AC-5-5（免审路径零审批，FR-5.3.5）**：持久成员开临时团 → `kind === 'created'`，
且 `inbox.push` 调用 **0 次**、`principalOf` 调用 **0 次**。
**AC-5-6（第一级否决不进第二级，FR-5.3.1）**：注入 `reviewSpawn → {approved:false, reason:'…'}` 的团长，
结果为 `kind === 'rejectedByPrincipal'`，且 `inbox.push` **0 次**、`createTeam` **0 次**。
**AC-5-7（第二级未批不创建，FR-5.3.2）**：团长批准后，结果为 `awaitingHumanApproval`；
在 `decideSpawnTicket` 被调用**之前**，`createTeam` **0 次**；`inbox.push` **1 次**，其 `actions` 恰为 `['approve','reject']`。
**AC-5-8（第二级批准才创建，FR-5.3.3）**：`decideSpawnTicket(..., 'approve')` → `kind === 'created'`，
且账本中可查到一条 `spawn/human-approved`，其载荷**同时**含
`requesterMemberId`、`principalMemberId`、`targetKind`、`spec`、`decidedAt`（即 FR-5.3.3 明列的六项：申请成员、目标团规格、两级审批人、时间、结论）。
**AC-5-9（两级审批人不缺项，FR-5.3.3）**：批准事件的载荷里 `principalMemberId` 与人类操作者标识**均非空**。
**验证**：`tests/delegation.spec.ts`，用计数假件（`createTeam`/`inbox.push`/`principalOf` 三个 spy）。
**反恒真**：把「先推送收件箱」与「先团长预审」调换顺序，AC-5-6 必须变红（会出现 `inbox.push` 1 次）。

### 5.4 不得绕开（FR-5.3.4）——本契约的精确定义

需求原文：「未获批准时，**不允许**该成员降级为『先开个临时团凑合』」。

**⚠️ 与 FR-5.3.5 的张力（本契约必须裁决）**：FR-5.3.5 说「成员开**临时团**无需任何审批，直接执行」。
若把 FR-5.3.4 读成「一旦被否，永久禁止该成员开临时团」，就直接违反 FR-5.3.5。
故本契约把它精确化为**按申请绑定**，而不是按成员封禁：

> **同一 `requestId` 一旦被否决（第一级或第二级），后续以该 `requestId` 发起的任何派生
> ——无论 `targetKind` 是什么——一律返回 `noDowngradeBypass`，不得创建。**
> 要开新的团，必须换一个新的 `requestId`。

这样：既堵死「同一次申请被拒后换个类型蒙混过关」（FR-5.3.4 的真实意图），
又不动 FR-5.3.5 的「临时团免审」自由（换新 requestId 即可，且无需审批）。

**AC-5-10**：以 `requestId = R`、`targetKind='persistent'` 申请，被团长否决后，
再以**同一** `R`、`targetKind='temporary'` 申请 → `kind === 'noDowngradeBypass'`，且 `createTeam` **0 次**。
**AC-5-11**：上述否决之后，换用**新的** `requestId = R2`、`targetKind='temporary'` 申请 →
`kind === 'created'`（FR-5.3.5 不被破坏）。
**AC-5-12**：人类否决（第二级）后，同一 `requestId` 同样返回 `noDowngradeBypass`。
**验证**：`tests/delegation.spec.ts` 三个用例。**反恒真**：把否决记录的查找改成「不记录 requestId」，
AC-5-10/12 必须变红。

### 5.5 子团归属与父成员消失（FR-5.4 / FR-5.6）

```ts
// src/delegation.ts

/** 父成员被回收/销毁时，把其名下子团转挂到最近的存活祖先（FR-5.6）。 */
export declare function reattachOrphanedTeams(
  deps: DelegationDeps,
  removedMemberId: MemberId,
): Promise<readonly TeamId[]>
```

**处置规则（FR-5.6 逐条）**：
- FR-5.6.1：子团**转挂**到最近的存活祖先（默认）；**不**级联销毁（保工作成果）；**不**冻结（免僵尸团）。
- FR-5.6.2：若无存活祖先，转挂到**该团团长（监正）**名下。
- FR-5.6.3：转挂事实**须落账本**。

**AC-5-13**：有存活祖先时，子团 `ownerMemberId` 变为该祖先，且未产生任何 destroy/suspend 事件。
**AC-5-14**：无存活祖先时，`ownerMemberId` 变为该团团长。
**AC-5-15**：每次转挂恰好写入一条 `team/ownership-reattached`，载荷含 `from` 与 `to` 两个 memberId。
**验证**：`tests/delegation.spec.ts`。**反恒真**：把兜底从「团长」改成「保持不变」，AC-5-14 必须变红。

---

## 6. FR-10：追加式账本与 scope 增量投影

### 6.1 事件基座

```ts
// src/types/operations.ts

/** 1 起的连续序号，无空洞。 */
export type LedgerSequence = number

export type LedgerActor =
  | { readonly kind: 'human'; readonly humanId: string }
  | { readonly kind: 'host'; readonly hostSessionId: HostSessionId }
  | { readonly kind: 'member'; readonly memberId: MemberId }

export interface LedgerEventBase {
  readonly eventId: EventId
  readonly sequence: LedgerSequence
  readonly occurredAt: number
  readonly actor: LedgerActor
  /** 链式完整性：首条为 null，其后等于前一条的 eventId。 */
  readonly previousEventId: EventId | null
  /** 幂等键（可选）。 */
  readonly requestId?: RequestId | undefined
}

export type LedgerEventKind =
  | 'team/initialized'
  | 'team/created'
  | 'team/member-added'
  | 'team/member-renamed'
  | 'team/member-suspended'
  | 'team/member-resumed'
  | 'team/member-destroyed'
  | 'team/member-model-switched'
  | 'team/channel-created'
  | 'team/thread-started'
  | 'plan/approved'
  | 'spawn/awaiting-human-approval'
  | 'spawn/principal-rejected'
  | 'spawn/human-approved'
  | 'spawn/human-rejected'
  | 'team/ownership-reattached'
  | 'dag/team-created'
  | 'dag/ownership-transferred'
  | 'dag/task-state-changed'

export type LedgerEvent = LedgerEventBase & { readonly kind: LedgerEventKind; readonly data: unknown }
```

事件联合（每条的具体 `data` 形状）由 `t3` 在 `src/types/operations.ts` 展开为可辨识联合；
本契约只钉**必须存在的 kind** 与**关键载荷字段**。已知必须含的关键字段：

| kind | 必须含的载荷字段 | 需求出处 |
|---|---|---|
| `plan/approved` | `planId`、`mode`（`RunMode`）、`operator` | FR-2.3 |
| `spawn/principal-rejected` | `requestId`、`requesterMemberId`、`principalMemberId`、`targetKind`、`spec`、`reason` | FR-5.3.1 |
| `spawn/awaiting-human-approval` | `requestId`、`requesterMemberId`、`principalMemberId`、`targetKind`、`spec` | FR-5.3.2 |
| `spawn/human-approved` | `requestId`、`requesterMemberId`、`principalMemberId`、`targetKind`、`spec`、`decision` | FR-5.3.3 |
| `spawn/human-rejected` | 同 approved，另 `reason` | FR-5.3.3 |
| `team/ownership-reattached` | `teamId`、`from`、`to`、`reason` | FR-5.6.3 |
| `dag/ownership-transferred` | `dagTeamId`、`from`、`to` | FR-7.4 |
| `team/member-added` | `member`（含 `position`/`name`/`memberId` 三层） | FR-5A |

### 6.2 账本接口

```ts
// src/ledger.ts

export interface LedgerReceipt {
  readonly eventId: EventId
  readonly sequence: LedgerSequence
  readonly occurredAt: number
}

export interface LedgerHead {
  readonly sequence: LedgerSequence
  readonly eventId: EventId | null
}

export interface LedgerCommitInput {
  readonly kind: LedgerEventKind
  readonly data: unknown
  readonly actor: LedgerActor
  readonly occurredAt?: number | undefined
  readonly requestId?: RequestId | undefined
}

export interface Ledger {
  /**
   * 只追加地提交一条事件。
   * 同步返回（见 §6.5 的口径说明）。
   */
  commit(input: LedgerCommitInput): LedgerReceipt

  /** 读取事件；见 §6.3 的 scope 与游标语义。 */
  read(query: LedgerReadQuery): LedgerPage

  head(): LedgerHead

  /** 完整性自检；见 §6.4。 */
  verifyIntegrity(): LedgerIntegrity

  close(): void
}

export interface OpenLedgerOptions {
  /** 数据库文件路径；`:memory:` 表示进程内库（测试用）。 */
  readonly path: string
  /** 注入时钟，便于确定性测试。 */
  readonly now?: (() => number) | undefined
}

export declare function openLedger(options: OpenLedgerOptions): Ledger
```

### 6.3 scope 与增量读取（FR-10.3）

```ts
// src/ledger.ts

export type ChangeScope =
  | { readonly kind: 'team'; readonly teamId: TeamId }
  | { readonly kind: 'member'; readonly memberId: MemberId }
  | { readonly kind: 'plan'; readonly planId: PlanId }
  | { readonly kind: 'spawn-ticket'; readonly ticketId: SpawnTicketId }
  | { readonly kind: 'dag-team'; readonly dagTeamId: DagTeamId }
  | { readonly kind: 'human-inbox' }

/** 一条事件影响的所有 scope。空数组表示「不对任何 scope 投影」——见下方语义 3。 */
export declare function changeScopesOf(event: LedgerEvent): readonly ChangeScope[]

export interface LedgerReadQuery {
  /** 省略 = 不过滤，返回全部事件。 */
  readonly scopes?: readonly ChangeScope[] | undefined
  /** 只返回 sequence **严格大于**该值的事件。省略 = 从 1 开始。 */
  readonly afterSequence?: LedgerSequence | undefined
  /** 单页上限，默认 100，最大 1000。 */
  readonly limit?: number | undefined
}

export interface LedgerPage {
  readonly events: readonly LedgerEvent[]
  /** 下一页的游标 = 本页最后一条的 sequence；无更多时为 null。 */
  readonly nextCursor: LedgerSequence | null
  readonly hasMore: boolean
}
```

**scope 语义（三条，必须实现并逐条测试）**：

1. **省略 `scopes`**：不做 scope 过滤，返回 `afterSequence` 之后的全部事件（按 sequence 升序）。
2. **给定 `scopes`**：只返回 `changeScopesOf(event)` 与查询 scopes **有交集**的事件
   （交集判定：`kind` 相同且对应 id 相等）。
3. **空 scope 的事件**（`changeScopesOf` 返回 `[]`）**不参与任何 scope 过滤结果**，
   仅在第 1 种（不过滤）读取中可见。理由与上游一致：这类事件不该唤醒任何 scope 的订阅者
   （上游 `dsh-agent-team/packages/agent-team/src/ledger.ts:2790` 正是
   `if (scopes === undefined || scopes.length !== 0) this.projectionVersion = operation.sequence` 的语义）。

**AC-10-1（只追加 + 按 scope 可查）**：提交 3 条分属不同 team 的事件后，
按 `{kind:'team', teamId:A}` 读取只得到 A 的那条；`hasMore === false`、`nextCursor === null`。
**AC-10-2（scope 计算正确）**：`changeScopesOf` 对 `team/member-added` 同时返回
`{kind:'member'}`（新成员）与 `{kind:'team', teamId}`（其所属团）两个 scope（断言长度 ≥ 2 且两者都在）。
**AC-10-3（增量游标）**：`limit=2` 分页读 5 条事件：第 1 页 `hasMore===true` 且 `nextCursor===2`；
带 `afterSequence=2` 读第 2 页首条 `sequence===3`；末页 `hasMore===false`、`nextCursor===null`。
**AC-10-4（空 scope 行为）**：提交一条 `changeScopesOf` 返回 `[]` 的事件后，
按任意 scope 读**读不到**它；不带 `scopes` 读**能**读到它。
**AC-10-5（空结果不等于出错）**：按一个不存在的 scope 读 → `events` 为空数组（**不是** `undefined`、不抛错）。
**验证**：`tests/ledger.spec.ts`。
**反恒真**：把 `read` 的 scope 过滤改成恒真（忽略 scopes），AC-10-1/AC-10-4 必须变红。

### 6.4 不可篡改与完整性（FR-10.1 / NFR-4）

**append-only 由存储层强制，而不是靠上层自觉。** 实测（本机 SQLite 3.53.3）：

```
建表 + 两个触发器后：
  UPDATE 尝试 → 抛出 "append-only: UPDATE forbidden"，行数不变
  DELETE 尝试 → 抛出 "append-only: DELETE forbidden"，行数不变
```

**AC-10-6（篡改历史被拒 —— 用独立连接验证）**：测试**另开一条 `DatabaseSync` 连接**直接对
账本文件执行 `UPDATE` / `DELETE`，断言两者均**抛出**，且事后 `read()` 仍能读到全部原事件、`verifyIntegrity().ok === true`。
> 之所以要**独立连接**而不是调 `Ledger` 的方法：这样才能证明约束在**存储层**生效，
> 而不是「`Ledger` 这个类碰巧没暴露 update 方法」。后者是恒真断言。

**AC-10-7（链式完整性）**：`verifyIntegrity()` 在正常账本上返回 `{ ok: true, sequence: N, brokenAt: null }`。
**AC-10-8（序号连续）**：手工往表里插一条 `sequence` 有空洞的记录后，
`verifyIntegrity()` 返回 `ok:false` 且 `brokenAt` 指向该处（不抛错）。
**AC-10-9（首条锚定）**：第一条事件的 `previousEventId` 必须为 `null`，`sequence` 必须为 `1`；
否则 `commit` 之后 `verifyIntegrity()` 报错。

```ts
export interface LedgerIntegrity {
  readonly ok: boolean
  readonly sequence: LedgerSequence
  /** 首个断裂处的 sequence；无断裂为 null。 */
  readonly brokenAt: LedgerSequence | null
}
```

**验证**：`tests/ledger.spec.ts`。
**反恒真**：删掉 `CREATE TRIGGER` 语句，AC-10-6 必须变红。

### 6.5 为什么 `commit` 是同步的（与 `DEVELOPMENT.md` 草稿的偏差）

`DEVELOPMENT.md` §3.4 的草稿写 `await ledger.commit({...})`。本契约把 `Ledger.commit` 定为**同步**：

- 本机 `node:sqlite` 提供的是 `DatabaseSync`（同步 API），无异步变体；
  「异步包一层同步调用」只会引入无意义的微任务边界与不确定性。
- 同步提交让测试**无需 fake timer / 忙等**即可断言序号与顺序，验收更硬。
- 真正的异步发生在**审批**那一层（`requestSpawn` 返回 `Promise`），因为那里要等团长与人类。
  两者分层清晰，**不冲突**：`Ledger` 同步，`Delegation` 异步。

> 该偏差需在评审时确认；若主人要求保持 `await` 风格，只需把 `commit` 的返回类型改为
> `Promise<LedgerReceipt>`，其余契约（尤其 §6.3/§6.4 的语义）不变。

### 6.6 投影纪律（FR-10.2）

**AC-10-10**：`sophia-core` 不导出任何「可变的视图状态」类型（如 `ChannelView`、`ActivityPanelState`）；
所有视图数据必须由 `read()` 的返回值派生。
**验证**：`tests/ledger.spec.ts` 断言 `Object.keys(await import('../src/index.ts'))` 中
不含任何以 `View`/`Projection`/`State` 结尾的导出。
> 这条把 FR-10.2「前端所有视图须为账本事实的投影，不得持有独立真相」变成可执行的接口级约束。

---

## 7. 验收标准：可执行验证总表

### 7.1 两个验收命令（逐字使用，含实测退出码）

```bash
npx tsc --noEmit -p packages/sophia-core/tsconfig.json
npx vitest run --root packages/sophia-core
```

实测口径（探针仓库，与本契约规定的布局一致）：

| 命令 | 通过时 | 失败时 |
|---|---|---|
| `npx tsc --noEmit -p packages/sophia-core/tsconfig.json` | exit **0** | 类型错误时 exit **2** |
| `npx vitest run --root packages/sophia-core` | exit **0** | 有失败用例时 exit **1** |

> ⚠️ **退出码必须在 shell 里直接取，不要管道化后取。**
> 实测：把 `npx vitest run ...` 的输出管进 `Select-String` 之后，`$LASTEXITCODE` 会变成 **0**
> （管道末段的退出码），把一次真实的失败读成通过 —— 本契约作者在探测阶段**实际踩到过这一次**，
> 当次 vitest 明明报了 `Tests 1 failed (1)`，而管道后的 `$LASTEXITCODE` 是 `0`。
> 要测量真实退出码用：
> `cmd /c "npx vitest run --root packages/sophia-core > out.txt 2>&1"`，再读 `$LASTEXITCODE`。

**实测的四个退出码（本契约作者逐字执行得到）**：

| 场景 | 命令形态 | 实测退出码 |
|---|---|---|
| tsc 干净 | `tsc --noEmit -p ...` | **0** |
| tsc 有类型错误 | `tsc --noEmit -p ...` | **2**（错误 `TS2322` 等，含文件:行:列） |
| vitest 全绿 | `vitest run --root ...` | **0** |
| vitest 有失败 | `vitest run --root ...` | **1** |

**另一处易错点**：`vitest run <path>` 的文件过滤器若**匹配不到任何文件**，退出码为 **1** 并提示
`No test files found, exiting with code 1` —— 不要把它读成「测试通过了但没输出」。

### 7.2 每条 AC 的执行方式与反恒真对照

| AC | 主题 | 测试文件 | 反恒真手法（必须变红） |
|---|---|---|---|
| AC-ID-1 | 品牌化 ID 互斥 | `tests/types.spec.ts` | 去掉任一品牌字段，`@ts-expect-error` 失效 → tsc 失败 |
| AC-ROLE-1 | 窗口不绑团 | `tests/types.spec.ts` | 给 `Host` 加 `teamId`，`@ts-expect-error` 失效 |
| AC-ROLE-2 | 锚点解耦可构造 | `tests/types.spec.ts` | 给 `Team` 加必填 `hostSessionId`，构造处编译失败 |
| AC-TEAM-1 | 生命周期无 `inactive` | `tests/types.spec.ts` | 把 `'inactive'` 加回联合，`@ts-expect-error` 失效 |
| AC-STAGE-1 | 默认模式为持久团队 | `tests/staging.spec.ts` | 改 `DEFAULT_RUN_MODE` 为 `dag-scheduler` |
| AC-5A-1 | 20 职位与素材同名 | `tests/naming.spec.ts` | 改任一项为 `'不存在职位'` |
| AC-5A-2 | `灵台郎→lingtai-lang` | `tests/naming.spec.ts` | 改成 `ling-tai-lang` |
| AC-5A-3 | slug 表完备且格式合法 | `tests/naming.spec.ts` | 删一项或写入大写 |
| AC-5A-4 | memberId 往返 | `tests/naming.spec.ts` | 让 `toMemberId` 丢弃 uuid8 |
| AC-5A-5 | 5 类畸形返回 null | `tests/naming.spec.ts` | 放宽正则使大写可过 |
| AC-5A-6..9 | 名字分配（含最小可用） | `tests/naming.spec.ts` | 把「取最小可用」改成「max+1」 |
| AC-5A-10..15 | 门禁与违例可读性 | `tests/naming.spec.ts` | 中文正则改恒真 |
| AC-5-1 | 权限矩阵 4 格 | `tests/delegation.spec.ts` | `TEMPORARY_POLICY.canSpawn` 加 `persistent` |
| AC-5-2 | 临时成员被拒 + 零副作用 | `tests/delegation.spec.ts` | 删掉权限检查 |
| AC-5-3 | 不设层数上限 | `tests/delegation.spec.ts` | 加 `if (depth > 1) forbidden` |
| AC-5-4 | 结果联合穷尽 | `tests/delegation.spec.ts` | 新增一个 `kind` 而 `switch` 不处理 |
| AC-5-5 | 免审路径零审批 | `tests/delegation.spec.ts` | 让临时团也走审批 |
| AC-5-6 | 第一级否决不进第二级 | `tests/delegation.spec.ts` | 调换预审与推送顺序 |
| AC-5-7 | 第二级前不创建 | `tests/delegation.spec.ts` | 在 `awaitingHumanApproval` 时就建团 |
| AC-5-8 | 批准落账本含六项 | `tests/delegation.spec.ts` | 事件载荷少写 `principalMemberId` |
| AC-5-9 | 两级审批人不缺 | `tests/delegation.spec.ts` | 人类操作者写空串 |
| AC-5-10 | 同 requestId 不得降级绕开 | `tests/delegation.spec.ts` | 否决记录不存 requestId |
| AC-5-11 | 换 requestId 仍可开临时团 | `tests/delegation.spec.ts` | 把「按 requestId」误写成「按 memberId」封禁 |
| AC-5-12 | 人类否决同样不可绕开 | `tests/delegation.spec.ts` | 同上 |
| AC-5-13..15 | 孤儿转挂三规则 | `tests/delegation.spec.ts` | 兜底改「保持不变」 |
| AC-10-1 | 只追加 + 按 scope 查 | `tests/ledger.spec.ts` | scope 过滤改恒真 |
| AC-10-2 | scope 计算多元 | `tests/ledger.spec.ts` | `member-added` 只返回 team scope |
| AC-10-3 | 游标增量分页 | `tests/ledger.spec.ts` | `nextCursor` 返回 0 |
| AC-10-4 | 空 scope 不参与投影 | `tests/ledger.spec.ts` | 空 scope 当成「匹配所有」 |
| AC-10-5 | 空结果非 undefined | `tests/ledger.spec.ts` | 返回 `undefined` |
| AC-10-6 | 存储层拒绝篡改 | `tests/ledger.spec.ts` | 删掉 `CREATE TRIGGER` |
| AC-10-7..9 | 完整性自检三态 | `tests/ledger.spec.ts` | 不校验序号连续性 |
| AC-10-10 | 不导出可变视图真相 | `tests/ledger.spec.ts` | 导出一个 `XxxView` 类型 |

### 7.3 交付验收门（`t7` 独立验证用）

1. `npx tsc --noEmit -p packages/sophia-core/tsconfig.json` → **exit 0**（逐字报告退出码）。
2. `npx vitest run --root packages/sophia-core` → **exit 0**（逐字报告通过数/失败数/退出码）。
3. **反恒真抽检 ≥ 2 条**：从 §7.2 中任选两条（建议 `AC-10-6` 与 `AC-5A-9`），
   按表中「反恒真手法」把实现故意改坏，确认测试**变红**，记录输出后**还原**并复跑确认回到绿色。
4. 逐条核对 §7.2 全表，产出 `docs/VERIFY-sophia-core.md`，如实记录发现的偏差。

> 「一个从未红过的断言，与没有断言等价」——第 3 步是本项目对这条纪律的落实，**不可省略**。

---

## 8. 待决事项（需主人裁定）

| 编号 | 事项 | 本契约的临时处置 | 影响面 |
|---|---|---|---|
| Q-A | `星文审校` 的 slug：`shen-jiao`（按词义，本契约取值）还是 `shen-xiao`（随通用拼音库） | 取 `shen-jiao`，理由见 §3.3 | 改 `POSITION_SLUGS` 一行 + 一条测试 |
| Q-B | `Ledger.commit` 同步（本契约）还是 `Promise`（`DEVELOPMENT.md` 草稿写法） | 取同步，理由见 §6.5 | 改返回类型，语义不变 |
| Q-C | FR-3.2 的 `inactive` 与 FR-9.1 的 `suspended` 是否合并为同一状态 | 合并，规范名取 `suspended`，见 §2.3 | 需回写 `REQUIREMENTS.md` FR-3.2 |
| Q-D | 「职位名必须属于 20 个规范职位」是否是硬拒绝 | 是硬拒绝（`POSITION_UNKNOWN`），理由：FR-8.1 要求与素材标签逐字一致 | 若要放开，需同时放开 §3.3 的 slug 表策略 |

---

## 9. 给下游任务的交接摘要

| 任务 | 依赖本契约的哪些章节 | 必须注意 |
|---|---|---|
| `t2` 脚手架 | §1 全文 | **不要解析 `@deepseek-ai/*` 类型**（§1.1）；根 `pnpm-workspace.yaml` 只写 `packages/*`（§1.4） |
| `t3` 领域类型 | §2 §3.1 §3.2 §6.1 | 角色模型必须让 AC-ROLE-1 通过（窗口不绑团） |
| `t4` 账本 | §6 全文 | append-only **必须落在存储层触发器**（§6.4/AC-10-6）；`commit` 同步（§6.5） |
| `t5` 命名门禁 | §3 全文 | slug 以**表**为准（§3.3）；`POSITIONS` 是闭集（§3.2） |
| `t6` 派生审批 | §4 §5 全文 | 不设层数上限（AC-5-3）；不得绕开按 **requestId** 绑定（§5.4） |
| `t7` 独立验证 | §7 全文 | 必须跑反恒真抽检 ≥ 2 条（§7.3 第 3 步） |

---

## 10. Captain 裁定（2026-09-23）

T1 提出的 4 项待裁事项，由 captain 裁定如下。裁定依据为 `docs/REQUIREMENTS.md` 的既有条款与本机实测。

### Q-A `星文审校` 的 slug —— 裁定：取 `shen-jiao`（按词义）

**理由**：
1. 该职位名的语义是「审校 = 审订校勘」，`校` 在此读 `jiao`（校订），不是 `xiao`（学校）。取 `xiao` 会让 ID 与职位语义脱节。
2. T1 已实测同一拼音库对「星机校验」给出的正是 `jiao-yan`，说明该库**两读都会用、只是此处选错** —— 这不是「库的规则 vs 我们的特例」，而是库在该词上判断有误。
3. slug 只在 `memberId` 内部使用，界面上永不展示（FR-5A.3 / FR-5A.4），因此**不受 FR-8.5「对用户可见名称不得出现英文」约束**，语义正确性优先。

⇒ 保持契约取值 `shen-jiao`，并在 `POSITION_SLUGS` 表旁加一行注释说明此裁决。

### Q-B `Ledger.commit` 同步还是异步 —— 裁定：**同步**

**理由**：
1. 本机实测 `node:sqlite` 的 `DatabaseSync` 为**同步 API**（SQLite 3.53.3，建表/触发器/增删改查全部成功）。账本底层是 SQLite，异步包装只会引入「假异步」——返回 `Promise` 但内部同步阻塞，反而掩盖真实的阻塞点。
2. append-only 的写入是**短事务**（单条事件插入 + 触发器校验），不存在需要 `await` 的 IO 等待。
3. 同步签名让调用方的时序确定（`commit` 返回即已落盘），这对 FR-10.1「所有协作事实须只追加写入」的因果顺序是**有利**的；异步反而会让「提交顺序」与「调用顺序」不一致。

⇒ 契约取同步。`DEVELOPMENT.md` 中草稿的 `await` 写法作废，由 captain 同步修订该文档。

### Q-C `inactive` / `suspended` 是否合并 —— 裁定：**合并，规范名取 `suspended`**

**理由**：
1. 两者是**同物异名**（FR-3.2 的 `inactive` 与 FR-9.1 的 `suspended` 都指「可逆的停用态」）。
2. 取 `suspended` 而非 `inactive`，因为 FR-9.1 为其定义了**明确的可逆操作对**（suspend / resume，含断点保存与运行时句柄释放）；而 `inactive` 只有名称、没有任何转换定义。
3. 一个状态若在需求里**没有任何进入/离开的转换**，它就不是一个真状态。合并到有转换定义的那个是正确的。

⇒ 已由 captain **回写 `REQUIREMENTS.md` FR-3.2**（附修订说明），`t3` 按 `suspended` 实现。

### Q-D 「职位名必须在 20 个规范名册内」是否硬拒绝 —— 裁定：**是硬拒绝**

**理由**：
1. FR-8.1 明确要求职位名「须与素材图上的烧入标签**逐字一致**」——素材图是不可改写的既有资产（实测标签已烧入像素，不透明占比 94.4%），名册就是这 20 个。
2. 允许名册外的职位名，会立刻产生**无头像可用**的成员（素材只有 20 张），而头像缺失是 FR-5A.4「显示名与图上标签始终一致」的直接反例。
3. 若将来要放开，正确做法是**先扩充素材**再放开名册，而不是先放开名册让界面出现无图成员。

⇒ `POSITION_UNKNOWN` 为硬拒绝。错误信息须列出合法职位名（便于调用方自查）。将来扩充素材时，同步扩充 `POSITIONS` 闭集即可。

### 附带裁定：slug 以规范表为准

采纳 T1 结论 —— **不引入 `pinyin-pro` 等运行时依赖**。理由：规范表已足够覆盖 20 个闭集职位；
引入运行库会为「表与库不一致」制造新的不确定来源（该库已在 `星文审校` 上给出错误结果，实测证据见 §3.3）。

---

## 11. Captain 裁定（2026-09-23 · 第二批）

### Q-E `spawn/principal-rejected` 载荷缺 `spec` —— 裁定：**(a) 扩载荷，补 `targetKind` 与 `spec`**

**T6 提出的冲突**：§6.1 给 `spawn/principal-rejected` 的载荷只有
`requestId / requesterMemberId / principalMemberId / reason`，而 §5.1 的 `SpawnTicket.spec: TeamSpec` 是**必填**
⇒ 只被第一级否决过的申请，无法投影出符合 §5.1 形状的票据（该状态在投影层「不可达」）。

**captain 核查发现的决定性证据 —— 契约内部自相矛盾（载荷不对称）**：

| 事件 kind | `targetKind` | `spec` |
|---|---|---|
| `spawn/human-approved`（§6.1 L893） | ✅ 有 | ✅ 有 |
| `spawn/human-rejected`（§6.1 L894） | ✅ 有 | ✅ 有 |
| **`spawn/principal-rejected`**（§6.1 L891） | ❌ **缺** | ❌ **缺** |

**两级审批的对称性被破坏了**：第二级（人类）的两种否决都携带完整规格，
而第一级（团长）的否决什么都不带 —— 这不是"设计选择"，是**漏写**。
两级审批在流程上是对称的（同一次申请、同一份规格，只是审核人不同），载荷也应当对称。

**裁定 (a)**，并明确补两个字段（不只补 `spec`）：
1. `targetKind` —— 理由同上表：它在第二级两种事件里都有，第一级否决缺它是同一处漏写。
2. `spec` —— 使 §5.1 的 `SpawnTicket.spec` 必填成立，`rejected-principal` 状态从「不可达」变为可达。

**对 T6 处置的确认**：T6 在等裁定期间返回 `null`、**刻意不填 `{name:'',roster:[],tasks:[]}` 空规格** ——
**这个判断是正确的，且理由充分**：空规格看起来是一份合法 `TeamSpec`，
调用方（如「把被否的申请原样重投」的 UI）会当真值使用，属「跑得通但内容全错」，
比「明确没有」危险得多。**保留这个宁缺勿假的处置，直到本条裁定被实施。**

**实施要求**（指派 t6）：
- §6.1 表格中 `spawn/principal-rejected` 一行补 `targetKind`、`spec`；
- `PrincipalRejectedData` 类型补这两个字段；`requestSpawn` 的团长否决路径落账时带上；
- `readSpawnTicket` 对 `rejected-principal` 返回**真票据**（替换当前的 `null`）；
- 原「返回 null」的测试改为断言真票据形状；新增一条断言：被第一级否决后
  `createTeam` === 0 次 **且** `inbox.push` === 0 次（否决不得触发后续流程）；
- 反恒真自证：把 `spec` 从载荷里去掉，新断言必须变红。

### 采纳 T6 的两处合规补全（不属改契约）

1. **另立 `SpawnDecisionOutcome = SpawnOutcome | rejectedByHuman | ticketNotFound`** —— 采纳。
   理由：§4.2 的 `SpawnOutcome` 恰 5 kind，**不含**「第二级被人类否决」。把它硬塞进 `forbidden`
   会把「人类行使否决权」**谎报成**「你没权限」，是语义污染。⇒ **§4.2 的 5 元闭集保持完好，AC-5-4 仍成立**。

2. **`PrincipalReviewer` 补 `readonly memberId: MemberId`** —— 采纳。
   理由：§5.1 只给 `reviewSpawn`，但 AC-5-8/5-9 要求事件载荷 `principalMemberId` 非空 ——
   两条不可能同时成立。方向与 `DEVELOPMENT.md:219` 草稿一致，属**消除契约内部矛盾**的必要补全。

### 工具口径（T6 实测，captain 已独立复现）

`verify_report` 的 `kind=gate` **不带 `cwd`** 时会在错误目录执行，产生两类失真：
1. **命令失效**：同一条 `npx vitest run --root packages/sophia-core` 在仓库根 exit 0，
   在无关目录（captain 用 `C:\Windows\Temp` 复现）exit **1** ⇒ 为真的 claim 被判 fail。
2. **守卫恒真（更隐蔽）**：`npx tsc --version` 在错误 cwd 下判 **pass**，但 detail 打印的是
   npx 安装提示（"This is not the tsc command..."，即 npm 伪包 `tsc`）而非 `Version 5.9.3` ——
   **退出码仍为 0**。即「防伪 tsc 的守卫」自身被绕过。

⇒ 强制口径：**每条 gate claim 显式带 `cwd`；守卫类断言必须锚定输出内容**（须含 `Version 5.9.3`），
不得只看退出码。已写入 t7/t8 任务描述。

### Q-F `spawn-ticket` scope 不可达 —— 裁定：**保留现状（诚实留白）**，并纠正 t7 指出的一处措辞

**T7 提出的张力**：§6.3 的 `ChangeScope` 词汇表**有** `spawn-ticket`（L960），但 §6.1 的 spawn 类事件载荷携带的是
`requestId` 而**无 `ticketId`**（§5.1 把 `SpawnTicketId` 与 `RequestId` 定义为 D 与 requestId 两个并列字段）
⇒ `changeScopesOf(spawn/awaiting-human-approval)` 实测为 `[{kind:'human-inbox'},{kind:'member',...}]`，
**永不产出 `spawn-ticket`**。该 scope 在词汇表里存在但在投影层不可达。

**裁定：保留现状**。理由：
1. **t4 的取舍是对的，且 t7 复核了它的性质**：宁可如实不投，也不硬塞一个订阅方永远匹配不上的 scope。
   投出去的通知若匹配不到数据，比不投更坏 —— 订阅方会收到"有事"却查不到"什么事"。
2. **改动成本高、收益不确定**：要让该 scope 可用，正确改法是**扩 §6.1 载荷**（与 Q-E 同一处补法），
   即让spawn 类事件落账时显式携带 `ticketId`。但 `ticketId` 是 `requestId` 的确定性派生值（见下），
   落账等于**存一份可推导的冗余**。在确有「按票号订阅」的真实消费方之前，不值得为它增字段。

**⚠ 纠正一处措辞（t7 的贡献，必须记下）**：开发文档与 t4 注释中「**无法还原** ticketId」的说法**不准确**。
实测事实：
- `spawnTicketIdOf(requestId)` 是**确定性派生**（`ticket:${requestId}`，`delegation.ts:315-316`）
- `ledger.ts` 的 import 列表里**没有** `delegation`（captain 已核实）⇒ 这是**分层约束**

⇒ 准确表述应为：「**ledger 层不得依赖 delegation 层，故 ledger 无法自行派生 ticketId**」，
而**不是**「信息不可恢复」。前者是架构约束，后者是事实错误 —— 二者给未来实现者的指引完全不同
（前者说"要么扩载荷、要么放宽分层"，后者会误导人以为要加索引或缓存）。
**该纠正已由 t7 如实写入 `docs/VERIFY-sophia-core.md`；t4 的代码注释若含同样措辞，属可接受的近似，
但不得据此认为「信息已丢失」。**

### Q-G t8 报告 §6 的「契约冻结类」8 条 —— 裁定：**全部维持契约原样，不改**

T8 把 OCR 的 56 条「不修 + 理由」归为三类，其中 8 条属「契约冻结类」（`R2-[13][31][33][34][43][45][47]`、`R1-[3]`），
指 `SpawnTicket.reason` 选项性、`TeamSpec.roster.count` 无约束、`DagTaskState = string`、`occurredAt` 裸 `number` 等。
T8 **没有单方面改口径**（SPEC 开头即写明「实现与契约冲突时契约优先」），做对了。

**captain 裁定：维持原样。** 逐条依据：

| 项 | 裁定理由 |
|---|---|
| `occurredAt` 裸 `number`（非品牌类型） | **品牌化挡不住真正的失效模式**。真实风险是"传了非法数值"（负数/非有限/小数），
这只能由**运行期校验**挡（`isFinite + ≥0 + isSafeInteger`，已实现）；品牌类型只挡"传错字段"，
却把校验压力挪到**每个构造点**。方向是反的 —— 同 t3 对 `position` 品牌化的既有裁决（见其代码注释）。 |
| `TeamSpec.roster.count` 无约束 | 「无约束」不等于「有缺陷」。真正的失效模式（空 roster / 负数 count）由 `createTeam` 注入点的宿主负责；
本包在**派生入口**已有 `canSpawn` 权限门禁。**在无真实消费方提出需求前加约束，属自我繁殖的复杂度**。 |
| `DagTaskState = string` | DAG 状态机属 `sophia-engine-dag`（本期未实现）。为未实现的模块预先收紧类型，
会**在尚无实现约束时冻结错误的形状**。待 M3 立项、有真实状态流转需要时再定。 |
| `SpawnTicket.reason` 选项性 | `reason` 在「待审」态**本就不存在**（还没被否决），选项性是**正确建模**而非疏漏。
强制必填会逼出空串占位 —— 正是 Q-E 我们要避免的"跑得通但内容全错"。 |

**通用判据（写下来供后续实现者遵循）**：
凡「契约冻结类」意见，判断顺序是 —— ①它指出的失效模式**真的会发生**吗？②若会，能否用**运行期门禁**兜住？
③若能，则**不改契约**（运行期门禁是低耦合的兜法）；④只有当运行期无法兜住、且失效模式确会触发时，才动契约。
T8 的处置符合此判据（它用运行期门禁兜住了真失效模式，如 `requireHumanOperator` 硬拒空操作者）。

### Q-H 其余两类（设计取舍 12 条 / 超范围 10 条）—— 裁定：**认可 t8 的不修处置**

- **设计取舍类**（注释措辞、文档精度、品牌注册表等）：非缺陷。其中 `R1-[20][21]`（品牌注册表、导出 `brand`）
  与 t3 的既有裁决一致，不重复裁定。
- **超范围类**（`displayNameOf` 对非名册输入的处置、`Promise.all` 并行化、`list()` 排序保证等）：
  属**未冻结的行为语义或性能优化**。本仓纪律明确：**理论上存在但现实中几乎不触发的缺陷判「可不做」并写明依据**。
  T8 已给出量级依据（转挂是成员回收时的控制面操作，`teamsOwnedBy` 规模是个位数），符合要求。
- **已实现、意见未看到类**（`HumanInbox.push` 无失败语义等）：t8 指出 `delegation.ts` **已实现** push 失败后的账本级恢复
  （正是 OCR [1] 抓出的缺陷，已有两条回归用例）。意见未看到既有实现，不成立。
