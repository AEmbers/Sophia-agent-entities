# OC 成员素材包接入设计（sophia-avatars）

> 状态：**设计 + 实施记录**。素材已落位；体积治理（512×512 WebP）与代码接入（§5.3 OC 路由 + §8 清单前两行）已由 Lead 于本版本实施完毕，实施差异见 §5.3 注。**2026-09-26 更新**：母版已从 2048 PNG 重制为 1024 WebP（§2、§7），仓库不再携带 87 MB 原图——GitHub 地址安装会整仓打包下载，母版体积直接决定安装能否在默认超时内完成。2048 原图归档在仓外 `.scratch/avatar-sources-2048/`（已 gitignore）。
>
> > TODO：本文件目前是独立设计稿，未按 [`docs/AGENTS.md`](AGENTS.md) 的结对规范维护（缺 `material-integration.zh.md` 对、未登记进 `README.md`/`README.zh.md` 索引、未跑 `npm run check:docs`）。如 Lead 决定将其转正为 maintained 文档，需在同一次变更中补齐上述项并同步更新受影响事实的归属文档（`frontend-design/components.md`、`architecture/client-and-remote.md`）。

## 1. 素材包规范摘要（来源：素材包内 readme.md v1.0，2026-09-21）

- **角色体系**：白发狐耳女官 OC 基底，20 个岗位差分头像；共享同一张脸、同一服饰结构、同一画风。
- **OC 锁定项（不可改）**：白色长发、黑尖狐耳（耳尖黑色渐染/外侧白色绒毛）、红宝石额坠、金珀/琥珀色眼眸、红绳十字星锁骨链、红黑袍服 + 白色毛领 + 金色星形腰饰 + 红色褶边袖口。
- **差分维度（仅此四类）**：视角机位、神态表情、专属法器道具、动作；每张底部带职位文字标签。
- **规格**：2048 × 2048 px、1:1、PNG（RGB）；`preview/` 为 400 × 400 JPG 缩略图（约 39–47 KB/张）。
- **命名规则**：`职位名.png`，全中文、无空格、无编号/版本前缀；20 个职位名全局唯一；**梯队归属只体现在目录，不写入文件名**。
- **目录结构**：`01_第一梯队_管理与总控组/`、`02_第二梯队_产品分析与设计组/`、`03_第三梯队_架构与研发组/`、`04_第四梯队_测试运维与文档组/`，每梯队 5 张。

## 2. 落位方案与体积统计（第一步产物）

源：`C:\Users\Administrator\Downloads\dsh-sophia-entities成员素材UI包.zip`（约 92 MB，解压至 `C:\Sophia\.scratch-material\`，用后可删）。

目标：`packages/dag-team/assets/sophia-avatars/`。**目录用 ASCII slug（仓库/工具链友好），文件名保留素材包规范的中文职位名**。

> **2026-09-26 重制**：本表记录的是素材包原始落位时的体积。母版随后由 `scripts/shrink-avatar-masters.py` 就地重制为 **1024×1024 WebP q90**，现为 **20 文件 / 3.38 MB**（单张 156–195 KB），见 §7。

| 目录 | 对应源梯队 | 文件数 | 合计体积 |
| --- | --- | --- | --- |
| `1-command/` | 01_第一梯队_管理与总控组 | 5 | 22.02 MB |
| `2-analysis/` | 02_第二梯队_产品分析与设计组 | 5 | 21.53 MB |
| `3-tech/` | 03_第三梯队_架构与研发组 | 5 | 22.73 MB |
| `4-qa/` | 04_第四梯队_测试运维与文档组 | 5 | 21.26 MB |
| **合计** | | **20** | **87.53 MB**（单张 3.76–4.87 MB） |
| **重制后** | 同上 | **20** | **3.38 MB**（单张 156–195 KB，`*.webp`） |

对照：现有鲸鱼素材 `assets/agent-teams/` = 15 文件 / **0.94 MB**。落位当时 `assets/` 总量约 88.5 MB（约 94×）；重制后 `assets/` 总量约 **4.5 MB**。

校验：复制后 `Get-ChildItem` 确认 4 目录 × 5 = 20 文件，逐文件与源比对名称+字节数一致（ALL 20 OK，见 §7 命令）。

## 3. 现有 artwork 管线现状解读

### 3.1 客户端映射 `packages/client-agent-team/src/client/dag/artwork.ts`（共 47 行，已读全文）

- `ART_BASE = '/plugins/dsh-agent-teams/assets/'` —— 前端引用的素材 URL 前缀，由宿主编译期静态服务（§3.2）。
- `ROLE_ART`：8 条 `[正则, 图片名]`，对 `${name} ${role}`.toLowerCase() 做**首条命中即返回**的正则匹配：

| 键桶 | 关键词（正则片段） | 图片来源 |
| --- | --- | --- |
| data | `data|analys|metric|performance|数据|分析|指标|性能` | member-data-v2.png |
| researcher | `resear|investig|explor|study|研究|调查|探索|调研` | member-researcher-v2.png |
| qa | `\bqa\b|test|verif|quality|测试|质量|验证` | member-qa-v2.png |
| engineer | `engineer|dev\b|server|backend|\bapi\b|runtime|watcher|contract|工程|后端|服务|接口|开发|代码|编程` | member-engineer-v2.png |
| designer | `design|\bui\b|\bux\b|front|theme|accessib|设计|前端|主题|无障碍` | member-designer-v2.png |
| security | `secur|audit|risk|threat|review|安全|审计|审查|风险` | member-security-v2.png |
| docs | `docs|writer|product|spec|撰写|文案|写作|文档|规范` | member-docs-v2.png |
| operator | `release|\bbuild\b|deploy|\bops\b|\bci\b|ship|coordin|发布|构建|部署|运维|协调` | member-operator-v2.png |

> 注：qa 桶（第 3 条）刻意排在 engineer 桶之前，避免 "QA Engineer" 宽匹配到 engineer 图。

- `LEAD_ART = ${ART_BASE}team-lead-v2.png` —— 队长固定鲸鱼 lead 图。
- `ACTION_ART: Record<'working'|'idle'|'unknown', string>` —— 三键映射 action-working / action-sleeping / action-thinking v2 图。
- `memberArtUrl(name, role)`：拼接 `name + ' ' + role` 转小写 → 依次测试 8 条正则 → 命中返回 `${ART_BASE}${art}`；**全部未命中返回 null**，调用方（ActivityPanel.tsx:664-668、AgentTeamsCard.tsx:115-116）降级为首字母色块 `memberInitial`。

### 3.2 宿主编译期服务 `packages/dag-team/src/index.ts:429-465`

- `artDir = fileURLToPath(new URL('../assets/agent-teams/', import.meta.url))` —— **硬编码指向 agent-teams 子目录**。
- `ART_ALLOWLIST`：15 个文件名 Set（1 lead + 8 member + 6 action），handler 取 URL 最后一段 `decodeURIComponent(...pathname.split('/').pop())` 后**只允许白名单内的纯文件名**，否则 404；命中后 `readFile(join(artDir, name))` 以 `image/png` 返回。
- **限制**：① 路由不支持子目录（只取末段）；② artDir 单一目录；③ 白名单硬编码。
- 磁盘上另有 `action-reporting/celebrating/sending-v2.png` 三张未被 `ACTION_ART` 引用（遗留资源）。

### 3.3 活动枚举与角色模型

- 活动枚举 `snapshot.ts:34`: `activity: 'working' | 'idle' | 'unknown'` —— 与 `ACTION_ART` 三键**精确一一对应**，`ACTION_ART[member.activity]` 不会出现 undefined。
- 后端角色：`types.ts:181-182` `role?: string` **自由文本，无枚举**；`tools.ts:1048` 文档示例 researcher/engineer/reviewer；`quality-gates.ts` 另有 analyst/tester/reviewer/integrator 指派语义。因此「现有角色集合」的事实来源 = ROLE_ART 的 8 个桶 + 文档示例词，**没有权威角色枚举可核对**。
- 匹配串构造 `identity = ${name} ${role}` —— 成员 name 也会参与正则，极少数情况下 name 文本可能干扰命中。

## 4. 20 岗位 → 现代岗位 → ROLE_ART 关键词映射（含缺口）

下表 `命中(中文)`/`命中(英文)` 为按 §3.1 正则对**现代岗位文本**的模拟结果（运行时 role 文本由 roster 提供，语言不定，故两列并列为`可变`；`NONE` 表示当前会落到首字母回退）。

| 梯队 | 职位（落位文件名） | 现代岗位 | 建议 OC slug（运行时） | 命中(中文) | 命中(英文) | 缺口 / 备注 |
| --- | --- | --- | --- | --- | --- | --- |
| 1-command | 钦天监监正.png | CEO / 总负责人 | lead-ceo | NONE | NONE | 语义=队长，应走 LEAD_ART 而非 member 桶 |
| 1-command | 灵台主事.png | 产品总监 | product-director | NONE | docs | en 因 `product` 命中 docs 桶 |
| 1-command | 时宪主事.png | 项目总监 | program-director | NONE | NONE | 无匹配 |
| 1-command | 典籍掌事.png | 资源 & 行政主管 | resource-admin | NONE | NONE | 无匹配 |
| 1-command | 星禁掌察.png | 风控 & 合规 | risk-compliance | NONE | security | en 命中 security（risk） |
| 2-analysis | 观象访事.png | 需求分析师 | requirement-analyst | **data**（误伤） | data | zh "分析" 命中 data 桶（正则误伤） |
| 2-analysis | 星图主事.png | 产品经理 | product-manager | NONE | docs | en 因 `product` 命中 docs 桶 |
| 2-analysis | 象绘主事.png | UX 设计师 | ux-designer | designer | designer | 一致 |
| 2-analysis | 星绘主事.png | UI 视觉设计师 | ui-designer | designer | designer | 一致 |
| 2-analysis | 传报主事.png | 客户/用户对接 | client-success | NONE | NONE | 无匹配 |
| 3-tech | 灵台郎.png | 系统架构师 | architect | NONE | NONE | 无匹配（engineer 桶不含架构词） |
| 3-tech | 历算主事.png | 后端工程师 | backend-engineer | engineer | engineer | 一致 |
| 3-tech | 星仪主事.png | 前端工程师 | frontend-engineer | designer | engineer | zh 前端→designer；en frontend→engineer（不一致） |
| 3-tech | 数象主事.png | 数据工程师 | data-engineer | data | data | 一致 |
| 3-tech | 推步主事.png | 算法工程师 | algorithm-engineer | NONE | engineer | en 含 engineer 兜底；zh 算法无匹配 |
| 4-qa | 星验主事.png | 业务 QA | business-qa | NONE | qa | en `qa` 命中 |
| 4-qa | 星机校验.png | 技术测试工程师 | test-engineer | qa | qa | 一致 |
| 4-qa | 天象值守.png | 运维工程师 | ops-engineer | operator | operator | 一致 |
| 4-qa | 星文审校.png | 技术审核/代码评审 | code-reviewer | NONE | security | en review→security；zh 审校无匹配 |
| 4-qa | 录典主事.png | 文档撰写 | docs-writer | docs | docs | 一致 |

**缺口结论**：
- 纯中文 role 文本下 8/20 岗位当前 NONE（钦天监监正、时宪主事、典籍掌事、传报主事、灵台郎、推步主事、星验主事、星文审校），会显示首字母色块——接入后 20 岗应全量有图。
- 现有正则存在**误伤与语言不一致**：需求分析→data；前端→designer(zh)/engineer(en)；product 类岗位→docs。接入 OC 后这些岗位应优先命中 OC 确定性映射，而非依赖正则猜测。
- 20 岗 ⊃ 8 类：一个 OC slug 对应一个岗位；8 个鲸鱼桶是岗位的「上卷（fallback）桶」而非一一对应。

## 5. 替换改法建议（diff 草案，勿直接实施）

### 5.1 命名方案（运行时）

- **推荐：语义英文 slug、扁平目录**。理由：① 规避中文 URL 风险（见 5.2）；② slug 自描述（`ceo.png`、`architect.png`），排障可读；③ 扁平目录匹配当前 host 路由「只取末段文件名」的限制，零子目录改动。
- slug 表见 §4「建议 OC slug」列（20 个唯一名：lead-ceo、product-director、program-director、resource-admin、risk-compliance、requirement-analyst、product-manager、ux-designer、ui-designer、client-success、architect、backend-engineer、frontend-engineer、data-engineer、algorithm-engineer、business-qa、test-engineer、ops-engineer、code-reviewer、docs-writer）。
- 备选：拼音 slug（`qintianjian-jianzheng.png` 等）——无歧义但可读性差，不推荐；若坚持用梯队子目录，则必须改 host 路由支持多段路径（见 5.3 方案 B2）。
- 仓库内落位文件（中文职位名）与运行时文件名（slug）**两套名字解耦**：以「中文职位名 ⇄ slug」映射表为唯一纽带（§4 表已给出），避免把中文名带进 URL。

### 5.2 中文 URL 编码风险评估

- **现状可行性**：host 路由已做 `decodeURIComponent`，Node `readFile` 在 Windows 处理 UTF-8 文件名正常；浏览器 img src 中的非 ASCII 会自动百分号编码 → 服务端解码 → 与白名单（UTF-8 字符串）比对，**技术路径是可通的**。
- **风险清单**：① npm pack / git 跨平台与老旧归档工具对中文文件名的兼容性（发布物解包后文件仍为 UTF-8 名，但部分平台工具链显示/打包异常）；② 未来若换成无解码的静态宿主/CDN 目录直出，编码后 URL 直接 404；③ 缓存键、日志、监控里中文可读性差；④ 若 filename=职位名，则「岗位→文件名」耦合素材包命名，换素材规则要改代码。
- **结论**：仓库内可保留中文名（素材包规范要求），**运行时 URL 一律用 ASCII slug + 映射表**。

### 5.3 diff 草案

**A. `packages/client-agent-team/src/client/dag/artwork.ts`**

```ts
// 新增：OC 队长图（语义上钦天监监正=队长）
export const OC_LEAD_ART = `${ART_BASE}sophia/lead-ceo.png`

// 新增：20 岗位确定性映射（放 ROLE_ART 之前优先命中，窄先宽后）
const OC_ROLE_ART: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bceo\b|总负责|钦天监监正/, 'sophia/lead-ceo.png'],
  [/\bproduct\s*director\b|产品总监|灵台主事/, 'sophia/product-director.png'],
  // ... 其余 18 项按 §4 slug 表补齐
]

// memberArtUrl 改为：OC 表优先 → ROLE_ART 桶兜底 → null（首字母回退）
export function memberArtUrl(name: string, role: string): string | null {
  const identity = `${name} ${role}`.toLowerCase()
  for (const [pattern, art] of OC_ROLE_ART) { if (pattern.test(identity)) return `${ART_BASE}${art}` }
  for (const [pattern, art] of ROLE_ART)    { if (pattern.test(identity)) return `${ART_BASE}${art}` }
  return null
}
```

**B. `packages/dag-team/src/index.ts`（宿主管线，~429-465）**

> ✅ **已实施（实际差异）**：采用方案 B1 + **独立前缀** `/plugins/dsh-sophia-entities/sophia-assets`，新增 `ocArtDir = ../assets/sophia-avatars-webp/` + `OC_ALLOWLIST`（20 个 `.webp` 文件名），handler 与原 artwork 路由同构（只取末段文件名、白名单校验、防路径穿越），`content-type: image/webp`、`cache-control: public, max-age=86400`。资源文件为**扁平 `<slug>.webp`**（512×512，由 `scripts/optimize-avatars.py` 从母版生成，母版现为 1024×1024 WebP），非文档早期草案中的 `sophia/lead-ceo.png` 子目录形式。

- 方案 B1（最小侵入，推荐配扁平 slug）：新增 `ocArtDir = ../assets/sophia-avatars-webp/` + `OC_ALLOWLIST`（20 个 slug 文件名），仿照现有 handler 注册第二个前缀 `/plugins/dsh-sophia-entities/sophia-assets`，仍只取末段文件名。
- 方案 B2（保留梯队子目录）：handler 需改为解析 `{tier, name}` 双段并**逐段白名单校验**（防路径穿越），改动更大，仅当坚持目录结构时采用。

**C. 其余同步点**
- `ART_BASE` 可保持不变（`/plugins/dsh-agent-teams/assets/` + 子路径），或新增 `OC_ART_BASE` 常量——由 B 方案前缀决定。
- `ActivityPanel.tsx` / `AgentTeamsCard.tsx` / `TeamChatEntry.tsx` 三处使用点**无需改动**（只消费 artwork.ts 导出）。

## 6. LEAD_ART 与 ACTION_ART 处理

- **LEAD_ART**：钦天监监正语义即队长（CEO/总负责人）。✅ **已实施**：`LEAD_ART = ${OC_ART_BASE}lead-ceo.webp`（直接替换鲸鱼 lead 图），符合「推荐直接替换」路线；三处消费点只读常量、零改动。若后续想回归鲸鱼队长观感，改回 `LEAD_ART = ${ART_BASE}team-lead-v2.png` 一行即可。
- **ACTION_ART**：OC 素材包**只有静态头像、无 working/idle/unknown 状态帧**。✅ **维持鲸鱼三态图不变**（活动枚举 `working|idle|unknown` 与三键精确一一对应，不存在 undefined 风险）——与本文建议一致。
- 若 Lead 后续拿到 OC 状态帧，扩 `ACTION_ART` 键即可，接口形状不变。

## 7. 体积风险与建议（强标注）

- **现状（重制后）**：`assets/` 鲸鱼 0.94 MB（15 文件）+ `sophia-avatars/` **3.38 MB**（20 文件，1024×1024 WebP 母版）+ `sophia-avatars-webp/` 0.84 MB（20 文件，512 运行时集）。`assets/` 合计约 **4.5 MB**，与鲸鱼素材同量级。
- **历史（已解决）**：落位时 `sophia-avatars/` 为 2048 PNG、87.53 MB，`assets/` 总量约 88.5 MB（约 94×）。该形态被 Git 地址安装实测证伪——`pnpm add https://github.com/AEmbers/dsh-sophia-entities` 会把整仓打包下载，87.5 MB 图片使 codeload tarball 达 99 MB，在默认 60s fetch 超时下必然 `TimeoutError: The operation was aborted due to timeout`。修法是重制母版（下述），而非放宽超时。
- **UI 真实渲染尺寸小**（面板头像/成员卡），2048 全尺寸进 UI 无意义且首屏每张多拉 4–5 MB。
- **建议方案（按优先级）**：
  1. **UI 只入 512×512 WebP**（预期单张 20–60 KB，20 张合计 < 2 MB）——面板效果不变，体积趋同鲸鱼素材；转换脚本（Pillow / sharp）挂在 prepack 或 build-client 阶段。
  2. 2048 原图**不入 npm tarball**：放独立 assets 仓库 / git LFS / 外部对象存储，仓库内仅留预览级资源。**注意（2026-09-26 更正）**：这条只适用于**母版**；`assets/agent-teams/` 与 `assets/sophia-avatars-webp/` 是宿主路由真正读的运行时资源，**必须**留在 `files` 白名单里——见 §7 末条。
  3. 素材包自带 `preview/`（400×400 JPG，共 0.82 MB）可作为 UI 兜底集。
- **✅ 已实施（建议 1 落地）**：`scripts/optimize-avatars.py`（Pillow，依赖无——用 DSH bundled Python，Pillow 12.3.0）将 `assets/sophia-avatars/<tier>/<中文职位名>.webp`（1024×1024 母版）转成扁平 `assets/sophia-avatars-webp/<slug>.webp`（512×512、WebP quality 82、LANCZOS）。实测：**87.53 MB → 863.9 KB（0.96%）**，20 张单张 39.1–48.5 KB，均 < 2 MB 预期上限；20/20 尺寸/格式校验通过，抽样 `architect.webp` vs 源图平均通道差 2.87（同主体，无损观感）。脚本幂等、含 `--dry-run`/`--size`/`--quality` 参数与 20 条「中文职位名 ⇄ slug」映射（§4 表为唯一事实源）。
- **✅ 已实施（母版重制，2026-09-26）**：`scripts/shrink-avatar-masters.py`（Pillow）就地把 `assets/sophia-avatars/<tier>/<中文职位名>.png`（2048×2048，87.53 MB）重制为同名 `.webp`（**1024×1024 q90，method=6**），实测 **83.38 MB → 3.38 MB（4.1%）**，单张 156–195 KB。1024 而非 512 是因为运行时集就是 512，母版留一档余量便于日后放大重导。2048 原图归档在仓外 `.scratch/avatar-sources-2048/`（20 文件 / 87.5 MB，已 gitignore）；脚本会在归档不存在时告警，避免误丢母版。
- 仓库体积账（决定性）：`.git` 约 95.5 MB 中 88.4 MB 是头像 PNG 的历史累计（`git rev-list --objects --all` 按路径聚合），当前 HEAD 树里即 87.5 MB。母版重制把**树**降到 3.38 MB，但**历史**仍需 `git filter-repo` 才能回收——本版本决策「重写历史暂缓」，因为那会改写已推送的 commit 且需全员重新克隆。
- ROOT `package.json` `files` 白名单：**纳入运行时资源、排除母版**（2026-09-26 更正，此前决策是错的）。纳入 `packages/dag-team/assets/agent-teams/**/*`（鲸鱼 15 PNG，0.94 MB）+ `packages/dag-team/assets/sophia-avatars-webp/**/*`（运行时 20 WebP，0.84 MB）；仍排除 `sophia-avatars/`（1024 母版 3.38 MB）与 `ui.png`。
- **错在哪**：原决策的论据是「Git 地址安装走整仓打包，所以不纳入也不影响安装」，但实测 pnpm 对 git 依赖是**克隆后按 `files` 白名单打包**（`scripts/check-bundle.mjs` 头部注释同此结论）。白名单不含 dag-team 任何路径 ⇒ 安装副本里 `packages/dag-team/assets/` **整个不存在** ⇒ 宿主两条资源路由（`../assets/agent-teams/`、`../assets/sophia-avatars-webp/`，见 `packages/dag-team/src/index.ts:474/521`）全部 404 ⇒ 审批卡、团队卡、活动面板里**每一张头像都渲染成裂图**。源码 checkout 里文件都在，所以本地完全看不出来。
- **门禁补齐**：`scripts/check-artifact.mjs` 新增第 4 项断言——扫描已发布 `.js` 里的 `new URL('<相对路径>', import.meta.url)`，要求该路径在 `npm pack` 清单里有对应条目（文件本身，或该目录下的文件）。原脚本只查相对 `import`，看不见「用 URL 拼出来的资源目录」，这正是本次漏网的原因。已做负控：把两条 assets 从 `files` 拿掉 → 门禁转红并指名两条路径；CI 两条 lane 都在 `check:bundle` 之后加了 `npm run check:artifact`。

## 8. 代码改动点清单（Lead 统一实施）

| 文件 | 改动 | 说明 |
| --- | --- | --- |
| ✅ `packages/client-agent-team/src/client/dag/artwork.ts` | **已实施**：新增 OC_ART_BASE、OC_ROLE_ART（20 项，中文职位名+现代岗位名双匹配）、OC_LEAD_ART；`LEAD_ART` 替换为 OC lead-ceo；`memberArtUrl` 改为 OC 表优先 → ROLE_ART 桶兜底 → null | 三处消费组件零改动（只消费 artwork.ts 导出）；`packages/client-agent-team/tests/artwork.spec.ts` 覆盖 20 岗位（英文名 + 中文名各一遍）+ 别名 + 鲸鱼兜底 + null ✓ |
| ✅ 岗位别名层（2026-09-26 追加） | **已实施**：`OC_ALIAS_ART`（17 项）插在 `OC_ROLE_ART` 之后、`ROLE_ART` 之前 | **起因**：`memberArtUrl` 只按「岗位全称」匹配，成员角色写成 `verifier` / `reviewer` 这类普通词时 20 项全不命中，直接落到鲸鱼桶（`member-qa-v2.png` / `member-security-v2.png`）——用户看到的就是「我们的头像一个都没用上」。别名层把这些普通词归到最近的岗位（`verifier`/`tester`/`qa` → test-engineer，`reviewer` → code-reviewer，`researcher`/`analyst` → requirement-analyst 等）；顺序保证岗位全称永远优先，鲸鱼桶只剩真正无岗位可归的角色（如 `engineer`） |
| ✅ `packages/dag-team/src/index.ts`（~429-465 后） | **已实施**：新增 `ocArtDir = ../assets/sophia-avatars-webp/` + `OC_ALLOWLIST`（20 个 `.webp`）并注册独立前缀 `/plugins/dsh-sophia-entities/sophia-assets`；handler 与原 artwork 路由同构（末段文件名、白名单、`image/webp`） | 交叉校验：artwork.ts 20 slug ↔ allowlist 20 ↔ 磁盘 20 文件全部一致 ✓ |
| ✅ 发布物 | root `package.json` `files` 白名单**纳入** `packages/dag-team/assets/agent-teams/**/*` 与 `packages/dag-team/assets/sophia-avatars-webp/**/*`，另加 `assets/readme/**/*`（README 截图） | **2026-09-26 更正**：运行时资源必须入白名单，否则安装副本里整个 `assets/` 缺失、头像全裂图；母版 `sophia-avatars/` 与 `ui.png` 仍排除。白名单实测 `npm pack` 433 项、约 3 MB |
| ✅ 体积治理 | **已实施**：`scripts/optimize-avatars.py`（Pillow）母版 → 512×512 WebP q82；87.53 MB → 863.9 KB | 幂等脚本；运行时集为扁平 `<slug>.webp` |
| ✅ 母版重制 | **已实施（2026-09-26）**：`scripts/shrink-avatar-masters.py` 2048 PNG → 1024 WebP q90；83.38 MB → 3.38 MB | 母版改为 `.webp`（中文名保留、tier 目录保留）；2048 原图归档于仓外 `.scratch/avatar-sources-2048/` |
| 映射表维护 | 中文职位名 ⇄ slug 以本文 §4 为唯一事实源 | 素材包升级时同步更新 |

**本次已做**：素材复制（§2，逐文件校验）+ 本文档 + 体积治理（§7）+ 代码接入（artwork.ts 与 index.ts，§5.3/§8，跨文件 slug 交叉校验与逻辑 smoke 测试通过）。
**本次未做（待决策/待工具链）**：未构建（harness 工具链已随 2026-09-25 环境清理丢失）、未提交、未登记文档转正（缺 .zh.md 对、README 索引、check:docs）。临时解压目录 `C:\Sophia\.scratch-material\`（含 preview/ 与 readme.md）待清理，删除不影响落位结果。