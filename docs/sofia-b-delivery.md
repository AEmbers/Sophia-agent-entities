# 索菲亚 · 上游团队 UI 整份移植 + 「选模式」接线 · 交付报告

范围：`C:\Users\Administrator\Sophia-agent-entities\packages\sophia-core`
上游（只读，未改一个字节）：`…\dsh-agent-team\packages\client-agent-team\src\client\`

> **关于包根那批报告文件（2026-09-24 更正）**：包根下的 `_deliver-sofia-b.md` /
> `DELIVERY-sofia-b.md` / `_tsc-sofia-b.txt` / `_membereditor-report-sofia-b.txt` /
> `_baseline-sofia-b.txt` **一个字节都没丢** —— 是**团长主动移出**到仓外
> `C:\Users\Administrator\.dsh\sophia-work\reports\sofia-b\`（理由是包根的非源码文件会跟着
> `npm pack` 走，那些是过程产物不是交付物）。⇒ 本报告落在 `docs/`，
> 是在仓库里留一份**交付物**（与既有 `OCR-*.md` / `SPEC-*.md` 同区）。

---

## 摘要

| 项 | 结果 |
|---|---|
| 任务 A（整份照抄上游 UI） | **12 个文件全部落盘**（含主人点名「从没抄过」的频道页 + 会话座 + 模式控件 + 成员编辑器 + 设置页） |
| 任务 B（「选模式」） | **类型/持久化/切换三件已核对在位；控件 = `TeamFooterAction`；并已接上索菲亚：切了**真的换页 |
| 两份 tsc | **零错误** |
| `npx vitest run` | **23 文件 / 913 用例全绿**（基线 22/902 未降低） |
| `npm run build` | **exit 0** |
| 门禁 5 | **5 行 OK、exit 0**（含真跑 client smoke） |
| `lib/client.js` 里 `require(` | **2** ✓ |
| 机器裁决 `verify_report` | **verdict=pass（6/6）** |
| OCR 第三方评审 | **本批基本没有发生**（见第六节，不作通过声明） |

---

## 一、任务 B：「选模式」

### B.1 三件东西的位置（`vendor/team/navigation.ts`，行号为当前值）

| 东西 | 位置 |
|---|---|
| 类型 | **`:4`** `export type TeamMode = 'conversation' \| 'team'` |
| 快照字段 | `:7` `mode: TeamMode` |
| 持久化键 | `:25` `const STORAGE_KEY = 'dsh.agent-team.navigation'` |
| 降级 | `:28` `if (typeof localStorage === 'undefined') return { mode: 'conversation' }` |
| 读 + 值域收敛 | `:30`（getItem）/ `:33`（`parsed.mode === 'team' ? 'team' : 'conversation'`） |
| 写 | `:49` 守卫 / `:52` `setItem` |
| **切换动作** | `:101` `enterTeam` / `:102` `leaveTeam` / `:118` `private setMode` |

### B.2 渲染模式切换控件的组件 = **`TeamFooterAction`**
上游只在 `index.ts:276-293` 注册到槽 `sidebar.footer.action`（注释原文：*the footer is the only surface that leaves Team mode*）。
索菲亚文件 `vendor/team/TeamFooterAction.tsx`（2229 B）**当前是另一位并行 agent 的版本**（18:36:57 重写，改用 `slots.ts:562` 的统一 `TeamFooterProps`）—— 按用户口径「别人已抄就复用」，**我复用它**并接上。

### B.3 接上索菲亚（**切换真的换页**）
新增 `src/client/team-mode.tsx`（**14000 B**，sha256 `8C9397C0211359A3…`，索菲亚独有 —— 上游靠槽 `reconcile()`。⚠ 交付后该文件被并行 agent 扩写了注释：原 7472 B / sha `FF86F2E1…F75A6`；已复验，我的接线判据全在、两份 tsc 零错误、8 条用例全绿）：
- 持有**唯一一个** `TeamDataSource`（`useMemo`）⇒ `source.navigation` 即模式真源，控件与主区读**同一个** localStorage 快照；
- `mode==='team'` ⇒ 主区渲染上游 `TeamConversation`（按导航态在**收件箱 / Thread / 频道页**之间选页）；否则渲染索菲亚原本内容；
- 底部画 `TeamFooterAction`；DOM 锚点 `data-sophia-team-mode` / `data-sophia-team-surface`；
- `conversationProps()` 走 `useMemo`（它的 `loadInbox`/`loadMembers` 是新箭头函数，上游放进 `useEffect` 依赖 ⇒ 不 memo 就是无限重读风暴）。

`panel.tsx` 仅**两处追加**：一行 import；主区整块包进 `<TeamModeSurface store={store}>…</TeamModeSurface>`。

### B.4 ⚠ 与自研 `PlanMode` 的关系 —— **没合并，也不建议合并**
任务文本说它在 `panel.tsx`；**实测**：真源在 `panel.tsx`（`planModeControl`/`planModes`/`data-sophia-mode-confirmed`），另一处渲染在 `StagingDualPlanEditor.tsx`（`data-sophia-mode="persistent-team"|"dag-scheduler"`）。**我一个字节都没碰。**

| | 上游 `TeamMode` | 索菲亚 `PlanMode` |
|---|---|---|
| 问什么 | 面板显示**对话**还是**团队** | 待批票建**持久团**还是 **DAG 调度团** |
| 值来源 | `navigation.ts:4`，持久化 | 索菲亚 `useState`（不持久化） |
| 消费者 | 主区**页面选择** | **建团审批载荷** |
| 时序 | 任意时刻 | 只在审批那一刻 |

文案层也分得开：`teamMode` 在上游字典；`modePersistent`/`modeDag` **只**在索菲亚字典 ⇒ **语义正交，不建议合并**。

---

## 二、任务 A：逐文件 上游 → 索菲亚

| 文件 | 上游 B | 索菲亚 B | 备注 |
|---|---|---|---|
| `TeamChannelPage.tsx` | 31525 | **31832** | 主人点名的频道页 |
| `TeamConversation.tsx` | 4542 | **6890** | 会话座（按导航态选页） |
| `TeamFooterAction.tsx` | 1609 | **2229** | 模式控件（并行 agent 版，复用） |
| `team-dialog-save.ts` | 1705 | **3208** | 编辑对话框保存生命周期 |
| `team-membership.ts` | 3262 | **5230** | **当前无调用点** |
| `human-identity.ts` | 7216 | **9517** | **当前无消费者** |
| `TeamAgentImport.tsx` | 3834 | **7667** | 数据面恒空 |
| `TeamMemberEditor.tsx` | 14255 | **14769** | sha256 `BA29D001961AC9AC…` |
| `HumanSettingsSection.tsx` | 9299 | **20257** | sha256 `5111BB39397DA894…` |
| `attachment-preview.ts` | 2103 | 4194 | **别人已抄** ⇒ 复用 |
| `create.module.css` / `human-settings.module.css` / `sidebar.module.css` | 4880 / 4000 / 16974 | 同 | 逐字节相同 |
| `team-mode.tsx` | — | **14000** | 索菲亚独有（交付时 7472，后被并行 agent 扩注释） |
| `tests/client/team-mode.spec.tsx` | — | 8924 | 我新增的看门人（8 条） |

字节普遍变大 = 逐项移植说明（哪个 import 换、哪行被剥、为什么剥），剥掉的不静默删。

---

## 三、验证（真实输出）

1. `npx tsc --noEmit -p tsconfig.json` → **无输出（零错误）**
2. `npx tsc --noEmit -p tsconfig.client.json` → **无输出（零错误）**
3. `npx vitest run` →
   ```
    Test Files  23 passed (23)
         Tests  913 passed (913)
      Duration  3.07s
   ```
4. `npm run build` → `✔ [@sophia/core/client] Build complete in 96ms` / **EXIT: 0**
5. `node ..\..\scripts\check-t5-structure.mjs` →
   ```
   OK src/client=21 tests/client=8 smoke="node ../../scripts/sophia-client-smoke.mjs"
   OK .sp-avatar 只做 border-radius:50% + object-fit:cover（无二次裁切）
   OK 成员名走 DOM 文本（data-sophia-name）；18 处 OCR 修复均在位
   OK PANEL_CSS 模板字符串内无反引号
   OK smoke:client 真跑过一次并通过（exit 0）
   === GATE EXIT: 0 ===
   ```
6. `lib/client.js` 里 `require(` = **2**（`react` 惰性 + `primitives` 惰性）
   > 中途曾红过一次 `expected 3 to be less than or equal to 2` —— 成因是那次测试读的是**上一次构建的旧产物**，重新 build 后为 2。
7. `verify_report` → **verdict=pass（pass 6 / fail 0 / unverified 0）**

类型检查旁路取证：我 8 个文件里 `as any` / `@ts-ignore` / `@ts-expect-error` / `@ts-nocheck` / `eslint-disable` **零命中**；`tsconfig.json` 的 git 改动是**昨天 21:17** 的既有工作（mtime 取证）。

---

## 四、模式的行为用例（`tests/client/team-mode.spec.tsx`，8 条）

| 组 | 钉什么 |
|---|---|
| 状态机 + 持久化（4） | 无 `localStorage` 降级 `conversation`；`enterTeam` 落盘且**新实例读得回来**；`leaveTeam` 切回；订阅者唤醒 |
| 控件外壳 + 字典（1） | `_footerStack_` 外壳在；`teamTranslate('team') !== 'team'`（字典真是上游那份，不是返回键名的兜底） |
| **主区换页**（3） | `conversation` ⇒ 锚点 `panel` 且面板内容在；`team` ⇒ 锚点 `conversation`、**面板内容必须消失**、换成 `data-team-conversation`；索菲亚面板整体也带这两个锚点 |

**改坏自检**（证明会红）：把判据临时改成恒 `false` ⇒ `2 failed | 6 passed`；还原 ⇒ `8 passed`。

### ⚠ 一条结构性断言盲区
`tests/stubs/ui-primitives.ts:58` 把 `Tooltip` 声明成 `Null`（**不渲染 children**），而 `TeamFooterAction` 的按钮**整个在 Tooltip 内部** ⇒ 测试环境里那枚按钮**永远不在 markup 里**（实测 `<div class="_footerStack_…"></div>`：外壳在、里面空）。真实环境不受影响。我**没改共享 stub**、也**没写永远红的断言** —— 「按钮形态/可点」在测试层面结构性覆盖不到，如实记录。

---

## 五、降级与「做不到」清单

1. **频道页发帖**：宿主无该路由（`host-data.ts:746` 要求非空 `threadRef`）⇒ composer 照抄渲染，提交走**如实报错**分支，不假装成功。
2. **频道成员管理**：整块剥（索菲亚没有该事实）⇒ `team-membership.ts` **无调用点**。
3. **人类身份**：无 `humanProfile` 读面 ⇒ 走 `t('human')` 兜底；`human-identity.ts` **无消费者**。
4. **导入成员**：无 `workspaceIds`/`joinWorkspace` ⇒ 结构照抄，候选按索菲亚枚举过滤（`!== 'archived'`）；未给 `joinWorkspace` 时点行**明说**未生效。
5. **`TeamConversation` 欢迎面**：无 Workspace 维 ⇒ 恒走第一支。
6. **`TeamMemberEditor` / `HumanSettingsSection`**：独立核验（两份 tsc 零错误、指纹见上）但**无渲染调用点**；前者剥了模型选择器整块（索菲亚无模型目录读面）、后者依赖的宿主读面也不存在（接上需宿主补 2 读 3 写 + index.ts 挂 loader + 面板补设置页）。
7. **`updateMember`** 是照上游形状留的**洞**（宿主无「改成员」路由）。

---

## 六、OCR 评审 —— **本批基本没有发生**（不作通过声明）

| # | 调用 | 结果 |
|---|---|---|
| 1 | `scan` + `path=…/team-mode.tsx` | 失败 `429 Too Many Requests`（7 账号全冷却） |
| 2 | `scan` + `path=…/TeamConversation.tsx` | `文件 0 个 · 意见 0 条` |
| 3 | `review`（整仓） | `文件 61 个 · 意见 0 条` |
| 4 | `scan`（整仓） | **超时 900s 中止**（stderr 227439 字节，仓库内 >2MB 的 png/zip 耗光窗口） |

**没有一条能算「我这些文件被评过」**：
- 第 2 次是**假绿**：`path=` 底层 CLI 不认（`Error: unknown flag: --path`），工具把**命令失败**当「0 文件」。
- 第 3 次**覆盖面不可确认**：`review` 审 diff，而本批多数文件是**未跟踪**（`git status`：16 `M` + 35 `??`）⇒ 无法证明 61 里含我的文件。
- **最硬的一条**（子代理实测 stderr，逐字）：`src/client/vendor/**` 被 ocr 的 path/extension 规则**整目录排除**
  （`[ocr] Skipping src/client/vendor/team/HumanSettingsSection.tsx — filtered by path/extension rules`）
  ⇒ 抄进 `vendor/team/` 的 **12 个文件结构性拿不到第三方评审**。

### ⚠ 更正声明
本报告**第二版**曾写「第 3 次是有效结论、61 文件被真实评审 ⇒ **通过**」—— **已撤回**（把计数当成了覆盖面证据，依据不足）。
现在可核验的质量依据只有第三节那 7 项 + 第四节那 8 条（含改坏自检）。

### 工具缺陷（两条，均实测）
1. `ocr_review` 的 `path=` 参数不通（底层 `unknown flag: --path`）。
2. 整仓 `scan` 在本仓**结构性超时**（assets 大文件）⇒ 需先排除 assets。

---

## 七、并行施工的真实情况

- `TeamFooterAction.tsx` 被另一位 agent 重写 ⇒ **复用**，未各写一份。
- `TeamChannelPage.tsx` / `slots.ts` / `adapters.ts` / `index.ts` / `navigation.ts` / `locales.ts` 在**我的版本基础上被继续扩写**；核对过我列的契约（`loadChannelTimeline` / `sendChannelMessage` / `TeamChannelTimeline` / `TeamNavigationSource` / `toChannelTimeline` / `teamTranslate`）**都还在**。
- 中途实测到别人文件的错误（`TeamAgentsPanel.tsx` / `TeamChannelsPanel.tsx` 缺 `IconPlusOutline16` / `IconPlayOutline16`）—— **我没修**；最后一次全量 tsc 时它们已消失（对应 agent 已修好）。
- 包根那批报告/证据文件由**团长主动归档**到仓外 `.dsh\sophia-work\reports\sofia-b\`（有意为之、零丢失，**不是事故**）；本报告落在 `docs/` 作为仓库内的交付物。
