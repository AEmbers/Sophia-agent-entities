# #43 spec — Human 设置 v1（2026-09-18 human 拍板，task:79e59f11）

分工（human 21:49）：@Momo 先写 scratch → 做接口；回头 Iris 写 UI/UX。

## 做什么（用户视角）

设置面板里新增一个我方分区，human 在此改自己的名字、传头像，并看到版本号＋更新提示；改完即时生效（agents 能 @ 到新名，UI 显示新头像）。

## 范围 v1（锁死）

1. 新 `settings.section` 分区（如 id `team-human`）＋ Host settings namespace（如 `agent-team-human`，进 settings.yaml）。
2. name：`AGENT_TEAM_HUMAN_HANDLE` 解除写死，`member:human` 不动；team_view handle、@ 匹配、UI 显示三处同源；纳入 handle 唯一性校验；只影响之后解析（沿用 thread:7a9ae59d/12816 六条设计）。
3. description：**不做**，`'Human Team Member'` 留死。
4. avatar 上传：持久目录＋settings 存引用（附件缓存 TTL 不可用）；只收 `image/*`、上限沿用 10MB；渲染搬 `loadAttachmentDataUrl`，失败回 hue/首字母；**写入口 human-only**。
5. 版本脚注：版号（自家 package.json）＋GitHub 链接现成；“可更新”自查（建议 Host 侧），脚注只告知＋外链；更新走 `dsh plugin`，页内无更新按钮；验收对标截图行为（有新版才出现→进发布说明→更新后消失）。
6. 时区：**不同批**，单独立项（Team 三面一起改，Harness 会话不动）。

## 接口清单（@Momo 做）

- Host：`agent-team-human` namespace（zod schema：name/description 留位/avatarRef/version 不存）＋读/写面；avatar 持久存取（目录＋引用＋human-only 写 remote 或复用 `putAttachment` 并解决 workspace 作用域）；版本信息下发（版号＋repo URL；更新检查 Host 侧）。
- Client：`settings.section` 注册（id/order/label/locale＋inject）；section 页面骨架（字段先通、UI 文案 Iris 回头细化）。
- 契约：team_view handle 输出新名；@ 解析匹配表同源。

## 红线

- 不改 `../deepseek-harness`；slot 注册一律 `ctx.slots.inject()`；Team 模式 settings 不可达是已知约束（本 v1 只做普通模式）。
- avatar-set 不得出现在 agent 可调面；账本不存可变资料；settings 文档不塞 data URL。
- Commit 单行 Conventional Commits，只 add 自己路径；可见 UI 改动走 `npm run test:browser`＋390×844＋dev-profile 预览。

## 验收

- 改名后 team_view/@解析/UI 三处同名；旧名不再解析。
- 传头像后各 avatar 位显示图片，删/坏回 hue/首字母；agent 侧无变化（team_view 无 avatar 字段，写明）。
- 版本脚注：无新版只显示版号＋链接；有新版出现可更新＋发布说明入口。
