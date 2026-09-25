# Human 设置调研：放哪里、配置哪些

源头：thread:7a9ae59d（human 2026-09-13「增加配置面板并支持一些设置可以去自定义」；2026-09-18 点名先做这两个调研）。
核实基线：本仓 `packages/` 源码 + `../deepseek-harness` 只读契约（2026-09-18）。结论：**无需改 Harness 源码即可做**，全部走公开扩展点。

## Q1 — 放哪里

设置面有三条公开扩展点（不存在“插件栏目”这一个笼统位置，human 说的两处对应 A 与 B）：

### A. `settings.section`：设置面板里新开一个顶层分区（推荐放 human 资料表单）

- Settings 外壳（`sidebar.settings` 占位、导航、chrome）在 ui-settings-general；导航是 `settings.section` 账本的投影，每个注册项带 nav 身份 `id` / `order` / `label`（`../deepseek-harness/packages/client/ui-settings/README.md:36`；`ui-settings-general/README.md:28,54`）。
- 先例：Models 分区（`id: 'models', order: 10`，`ui-settings-models/src/client/index.ts:131-135`）、AgentPreset 分区（`id: 'agent-presets', order: 20`，`ui-agent-preset/src/client/index.ts:196-202`）、Plugins 分区本身也是一个 section（`ui-settings-plugins/src/client/index.ts:145-146`）。
- 注册形状：`ctx.slots.inject('settings.section', () => ctx.slots.register({ name, id, order, label, locale, inject }, SectionComponent))`；section 只收到 `{ close }`（`ui-settings/src/client/contract/slots.ts:54,116-126`），数据走自己的 Remote 或 `settingsScope`。
- 适合多字段表单（name/description/avatar/timezone 放一页），互不干扰；加设置永远不用改外壳（`contract/slots.ts:4-10`）。

### B. `settings.plugins.tab`：Plugins 分区里加一个 tab

- Plugins 分区拥有导航入口与标签栏；各 tab 由 `settings.plugins.tab` 贡献的 `id`/`order`/`label` 排成有序标签页（`ui-settings-plugins/README.md:54-56`）。
- 先例：Plugin 列表 tab（`id: 'all', order: 10`，`ui-settings-plugin-inventory/src/client/index.ts:50-58`）。
- 概念上这是“插件的标签页”，human 身份资料放这里属于借地，不是回家的路；且 tab 与 A 同样受下面的 Team 模式约束。

### C. `settings.general.item`：通用分区里加一行（只适合单个小开关）

- General 分区本身没有内置行，只堆叠各功能插件贡献的行；行自己画全部内部结构（`ui-settings-general/README.md:30-32`；`contract/slots.ts:76-89`）。
- 先例：Language 行（`id: 'language', order: 0`，`locale/src/client/index.ts:574-581`）、Appearance/FontSize 行（`ui-theme/src/client/index.ts:454-471`）、Composer Enter 行（`ui-conversation/src/client/apply.ts:132-133`）。
- human 资料这种多字段表单不适合拆成行；时区若单做，将来可以是一行，但先看时区的作用域结论。

### D. Plugins「Plugin configuration」卡片（不推荐给身份资料）

- 该 tab 按“Host 已服务的 namespace × 已注册卡片”取交集渲染；卡片以所编辑的 namespace 为键（`settings.plugin.item`），带草稿暂存、保存/丢弃、按 revision 拒写、重置回 composed（`ui-settings-plugins/README.md:30-40,56-60`）。
- 卡片是给 host-plane 插件配**插件行为**的；human 的名字头像是**用户身份**，塞进插件配置卡在概念上是错的。机制虽可行（见持久化一节），但不建议。

### 持久化（A/B/C 共用，D 必需）

- Host 插件用 `ctx.settings.installSection(owner, ns, schema, entry, hooks)` 注册命名空间：schema 缺省＋部署配置＋用户覆盖三层解析；写只动用户层，按 namespace 修订号设防，冲突拒写不覆盖；无服务时回落 composed（`settings/settings/README.md:32,58`）。
- namespace 文法：小写字母/数字/连字符（如 `agent-team-human`）。
- 用户覆盖进 `settings.yaml` 单文档，可直接编辑，live 生效；不加载的插件拥有的节不会被丢（`settings-file/README.md:12`；`settings/README.md:12`）。
- 我方 Host 是 host-plane 行（`cordis.patch.yml:10-11` 的 `@wowyuarm/dsh-agent-team/host`），**可以**注册 namespace；preset 里挂载的插件则不能（`ui-settings-plugins/README.md:95`；`agent-presets/src/index.ts:183` 刻意不用 `installSection`）。现状：我方**没有任何 settings namespace**（全仓 grep `ctx.settings|settingsScope|installSection` 零命中，测试桩除外）。
- 账本（ledger append-only）不适合放可变资料；客户端 localStorage 只够纯展示偏好（sidebar 顺序有先例），human 名字必须 Host 可读（team_view 与 @ 匹配在 Host 侧），所以名字/描述/时区应进 Host settings namespace，客户端经 `settingsScope.bind` 或自有 Remote 读。

### 硬约束（位置决策必须回答）

1. **Team 模式下设置面板不可达**：`sidebar.settings` 席位在 Team 模式被 `TeamMembersAction` 以 priority -100 接管（`packages/client-agent-team/src/client/index.ts:265`；按钮渲染见 `TeamMembersAction.tsx:37-44`）。A/B/C 的页面都在设置外壳里，**改 human 资料要先退出 Team 模式**，除非另开“Team 内入口”（如扩展 Members 弹窗）——那是第二个 ticket，不在本调研内。
2. **slot 父级的 `children` 声明是渲染权威**，不复制 shipped 私有 UI、不重声明 `directoryFlow` 一类（仓规；Harness 侧 duplicate live child 直接拒绝）。注册一律用 `ctx.slots.inject()` 等声明到达（inventory 先例：`ui-settings-plugin-inventory/README.md:54`）。

### Q1 建议（默认）

- **human 资料表单走 A**：新 `settings.section`（如 id `team-human`），字段一次配齐；持久化走新建 Host namespace（如 `agent-team-human`）。
- 时区若单做，将来可拆成 C 的一行，但先定作用域（见 Q2）。
- B、D 不建议：身份资料不属于插件栏目。

## Q2 — 配置哪些

### P0：human name/handle（已有设计，直接复用）

- 现状三处写死：`AGENT_TEAM_HUMAN_HANDLE = 'human'`（`packages/agent-team/src/ledger.ts:141`）；`HUMAN_ACTOR`（同文件 `146-150`，账本一切 human 操作的 actor 锚点）；team_view 输出 human 时 handle 与 description 硬编码（`packages/tool-agent-team/src/index.ts:678`）。
- thread:7a9ae59d 的 12816 已有六条设计（memberId `member:human` 不动、作用域全局、一值三读、纳入唯一性校验、沿用 handle 匹配规则、只影响之后解析）与三个决策点（全局/旧名不再解析/description 一并可配），本调研不再重复，建议首批 ticket 直接引用。

### P0：human description（与名字同一行代码，顺手）

- 同 `tool-agent-team/src/index.ts:678` 的 `'Human Team Member'`；agents 经 team_view 可见。建议与 name 同一个值来源、同一次保存。

### P1：human avatar（最重的一项，建议分期）

- 现状**纯派生、无图片**：确定性 hue（`memberHue`，`team-formatters.ts:40`）＋名字首字母（`TeamMemberAvatar.tsx:24-30`；`TeamMessage.tsx:57,168`；`TeamAvatarStack.tsx:30`）。
- 成员类型里**没有 avatar 字段**（`types/entities.ts` 只有 `presence` 等），即 avatar 今天纯粹人端显示、agent 经 team_view 看不见——配了头像也不影响 agent 侧，这是可以接受的，但要在验收里写明。
- 选项按成本排序：① 选 hue/首字母（纯客户端，零存储）；② 贴 URL（存字符串即可，但要处理不可达/混入）；③ 上传图片（需 blob 存储＋引用，settings 文档只存 JSON/YAML、不适合存二进制；附件管线 `putAttachment/getAttachment` 可复用，需另行设计）。建议首批最多做到 ①，③ 单独立 ticket。

### P1：时区（human 点名，要先定作用域再定字段）

三个渲染面，改一个不管另外两个等于没改：

1. **Host→agent**：固定 UTC+8（`TEAM_ZONE_OFFSET_MINUTES = 8*60`，`time-format.ts:17`；`formatTeamTimestamp`，同文件 `28-35`）。模块注释**已预言可配置**，但立了不变式：同一 instant 必须单确定性渲染（context-cache 不变式，同文件 `10-12`）。
2. **Web→human**：全部浏览器本地时区（`formatAbsoluteTime/formatMessageTime/formatInboxTime`，`team-formatters.ts:209-252`；`timelineDayKey/daySeparatorLabel`，`team-separators.ts:24-37`）。可配时区要把 tz 线穿进这些纯函数。
3. **存储**：一律 UTC ISO（`ledger.ts:529`；`spec.ts:46` `z.string().datetime()`），不动。
4. 另有坑：`member-time-context.ts:15-21` 刻意**不用** shipped `dsh-time-context`（它的 browser-zone 政策会在后台 wake 时打扰 model 确认日期）；若 Harness 将来出 canonical-zone 政策，我方这一行应退位。时区方案要与这条注释兼容，不要另起第二套时钟。
5. 作用域问题：Harness 会话时间是 Harness 拥有的；Team-only 时区会在一个 App 里造出两口时钟。决策点：时区是只改 Team 三个面，还是等 Harness 的全局时区（目前没有）。

### P2：可列入候选、但建议本轮不碰

- 收件箱密度：客户端 `RECENT_ROWS_LIMIT = 5`（`TeamInboxPage.tsx:35`）与 Host `RECENT_INBOX_LIMIT = 10`（`ledger.ts:454`），且客户端必须 ≤ Host（`ledger.ts:450` 注释）。human 之前亲手调过 5/10，可配但要带着耦合注释一起走。
- 自动续读轮数：`MAX_AUTO_READ_ROUNDS = 50`（`TeamThreadPage.tsx:128`），配了也只是调参，价值不明。
- human presence：team_view 里 human 常年 `'available'`（`tool-agent-team/src/index.ts:678`）；DND 概念今天不存在，先不做。
- 草稿上限（`drafts.ts:25` `LIMIT = 50`）、头像堆叠数（`TeamAvatarStack.tsx:7` `MAX_VISIBLE = 3`）：内部量/纯展示，不做。

### 明确不做

- **Language**：跟随 Harness 全局 Language 行；Team 只注册自己的 `team` 词典（`client/index.ts:183`），不另起语言设置。
- Composer Enter 等 Harness 拥有的行：那是别人家的设置项。

## 2026-09-18 21:40 追补（human：description 不要；avatar 要上传；还做哪些）

### description：drop

`'Human Team Member'` 留死在 `tool-agent-team/src/index.ts:678`，不动。name 照做（同一行只改 handle）。

### avatar 上传：可行，但字节不能进现有附件缓存（已核实）

- 附件缓存是**缓存不是存档**（`attachments.ts:7-13`）：上限 10MB（同文件 `14`）；被消息引用 72h 清、无引用 24h 清（`16-18`，`sweepAttachmentCache` `177-188`，调用在 `index.ts:1016`）。
- 保命集合＝“被已存消息引用的 id”（`ledger.ts:1714-1721`）——头像 id 永不进这个集合；**即使塞进去，72h 照样死**。所以 avatar 字节必须另有持久放法：
  - (a 推荐) 另起持久目录（如 `agent-team/human/v1/`），settings namespace 里只存引用（attachmentId 或相对路径）；
  - (b) 给 sweep 加豁免（pinned 集合，永不过期）——改 GC 语义，面比 (a) 大；
  - (c) settings 文档里塞 data URL——不推荐，撑大 settings.yaml，且 schema/体积上限未知。
- 渲染有现成套路：`loadAttachmentDataUrl`（`attachment-preview.ts:27-34`：image/* 转 data URL、会话级缓存、失败记 `null` 回退）——avatar `<img>` 照搬，失败回 hue/首字母。
- 上传入口：`putAttachment` Remote 可复用（workspace 作用域、10MB 上限、写后不可变，`index.ts:1239-1249`），但 human 是跨 workspace 身份——传哪个 workspaceId，或单开 workspace-free 上传入口，交实现定。
- **红线**：写入口必须 human-only。agent 传附件走的是消息 `attachments` 绝对路径那条路（`tool-agent-team/src/index.ts:434-490` → `copyPathAttachment`），与 avatar 设置入口必须分开；avatar-set remote/tool 绝不能出现在 agent 可调面上。

### “还做哪些”短名单（按人天天看得到排序）

1. 时区（P1 不变）：三面一起改；默认 Team 范围、Harness 会话不动。
2. 收件箱密度（`RECENT_ROWS_LIMIT=5` / `RECENT_INBOX_LIMIT=10`，带 client≤Host 耦合）。
3. 自动续读轮数（50）——调参价值不明，默认不做。
4. presence/DND——无概念，默认不做。
5. 不做：description（已毙）、Language、草稿上限、堆叠数。

### 更新后的决策点

① 首批＝name＋avatar 上传（description 已 drop）；时区是否同批默认**不同批**；② avatar 存法默认 (a) 持久目录＋settings 存引用，上限沿用 10MB、只收 `image/*`；③ 上面 2–4 默认都不做。

## 2026-09-18 21:48 追补（human 截图＋开工拍板）

human 贴了一个外部 Command Code 插件的设置页截图：底部一行 "Command Code Provider v0.10.6 · v0.11.5 可更新"，tooltip 写“已发布新版本，点击查看发布说明；更新插件后版本号，提示会自动消失”。要求：我方设置分区也要版本脚注＋更新提示＋GitHub 入口。

核实结论：

- Harness **没有**插件更新检查面：`client/`＋`bundle/` 源码里无 outdated/latestVersion/release-notes/发行说明/可更新/新版本字样（测试除外）；Plugin 列表 tab 只做列表。截图里的脚注是该外部插件**自己实现**的，不是 Harness 给的 widget。
- 我方可做，拆三件：① 版号文本——自家 `package.json`（当前 `0.1.13`），编译进客户端或经自有 Remote 下发，零成本；② GitHub 入口——`repository.url`（`https://github.com/wowyuarm/dsh-agent-team.git`）贴链接，零成本；③ “可更新”检查——必须自建，建议 Host 侧查（如 GitHub releases）而非浏览器 fetch（离线/CORS），脚注只告知＋链接。
- 红线：更新本身走 `dsh plugin` CLI（`bundle/README.md:32`），**设置页里不做更新按钮**，只告知＋外链；验收对标截图行为（有新版才出现 → 点进发布说明 → 更新后消失）。

human 同时拍板（21:48）：“先按首轮建议把接口等都做好”。**首批范围锁定 v1**：新 `settings.section`＋Host namespace（如 `agent-team-human`）＋name（description 已 drop，`'Human Team Member'` 留死）＋avatar 上传（持久目录＋settings 存引用，human-only 写入口）＋版本脚注；时区单独立项。下一步按承载流程交接 Reeve 排实施。

## 可行性结论（intake 门禁）

- **成立**：全部走公开扩展点（`settings.section`＋Host settings namespace＋自有 Remote/`settingsScope`），**无需改 `../deepseek-harness`**。硬约束是不改 dsh 源码——本方案不碰。
- 风险不在可行性，在范围：avatar 图片与时区作用域是两个无底洞，已在上文切成 P1 并各给一个决策点。

## 决策点（请 human 拍）

1. 放哪里：默认 **A（新 `settings.section` 分区）**；B/C/D 否决（理由见上）。
2. 首批字段：默认 **P0（name＋description）** 先行；avatar 先只做“选 hue/首字母”或 defer；timezone 单独立项、作用域另议。
3. 时区作用域：默认 **Team 三个面一起改、Harness 会话时间不动**（并在 UI 文案写明只影响 Team 时间显示）；若要全局，等 Harness 出 canonical-zone 再跟。
4. avatar 图片（上传）：默认 **defer**，需要时单独立 ticket（含存储与 agent 可见性说明）。
