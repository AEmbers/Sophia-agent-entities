# 03 — Human 控制面与硬化

**What to build:** Human 侧最小控制面 + 全特性收紧：创建 Agent 对话框新增「从其他 Workspace 引入」入口（列出未参与本 Workspace 的既有 Member，选中即 join）；归档动作按上下文分档（非默认 Workspace = 撤回，默认 Workspace = 全量归档），确认文案相应更新；成员显示全面复用现有模型——成员在每个已参与 Workspace 的列表自然出现，不加任何归属标识。随后是幂等/replay/授权回归硬化与文档收口。

**Blocked by:** 01（join/撤回操作与归档语义分档就绪）；02 就绪后补验证协作呈现。

**Status:** done（worktree commits 9ebf215 → 0b27b74 → d10690f → 6f6989c；文档契约同步随 docs commit 收口）

设计约定（自包含，Human 拍板）：

- 「全局」是默认形态不是特殊徽章：成员在每个已参与 workspace 的 Agents 区自然出现；**行上不加任何归属/默认标识**。
- Presence 全局真相；行点击打开唯一 live session；创建流程不变（创建即首参与）；composer/@mention 不动。
- 管理面 = 创建对话框的引入入口 + 归档动作分档，仅此两处新 UI；无编辑器 Workspaces 区、无全局成员专区。
- UI 变化属可见变更：组件检查 + `npm run test:browser`，桌面与 390×844 截图，验收键盘/焦点、对话框可访问性、空错态、普通 DSH 恢复。

- [x] 创建对话框「从其他 Workspace 引入」入口完整（成员选择 → join → 出现在本 workspace 列表；含 loading/error/空态）——`TeamAgentImport`，引入视图内 loading/读失败重试/真实空态三态齐备，requestId 失败复用
- [x] 归档动作分档：非默认 workspace = 撤回（`leaveWorkspace`，确认文案陈述其他 workspace 不受影响）；默认 workspace = 全量归档 + "同时从其他 N 个 workspace 收起"
- [x] 成员在每个已参与 workspace 的列表呈现（Host `members` 远端按参与投影过滤 + 每行 `workspaceIds`）；单参与成员 UI 零回归（组件套件既有用例未动语义）
- [x] 组件检查（21/21，含新增 3 用例）+ audit-ui-parity + test:browser 通过；桌面/390×844 截图核验（agent-create-modal 两端 + agent-import-empty）；对话框 aria-expanded/Escape/焦点返回触发钮/role="alert" 均有断言
- [x] 幂等/replay：Ticket 01 已交付（byRequest 幂等 + replay 校验）；UI 侧重试复用相同 requestId 已由组件用例钉住
- [x] 授权回归：Ticket 01/02 用例覆盖（缺省 workspace 参数级拒绝 + 未参与拒绝）；本轮唯一授权面改动是 `members` 远端支持全局查询（Human-only read，未放宽任何 mutate 检查）
- [x] `npm test` 627 全绿（含 boundary check）；`docs/domain-model.md`/`.zh`（Member 修订 + Workspace Participation + Withdraw 词条）、`frontend-design.md`/`.zh`（引入入口与撤回/归档分档）、`packages/agent-team/README(.zh)`（参与操作）已同步；`check:docs` 通过。注：本轮 Member 仍只有创建 workspace 的一条 live Session；按参与切分 Session 血统是后续工作（spec 内 B-full 档）
