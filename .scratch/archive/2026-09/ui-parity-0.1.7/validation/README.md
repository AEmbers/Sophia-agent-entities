# 验收代表图

- **工作项：** `.scratch/archive/2026-09/ui-parity-0.1.7/`（0.1.7 UI 设计语言再基线，2026-09-24 归档）
- **交付提交：** 末笔 `chore: settle the neutral separator width on the 1px Chromium renders`（同工作项前 5 笔的 subject 见目录 README）
- **运行环境：** 相邻 `../deepseek-harness` checkout、`/usr/bin/google-chrome`、临时 profile（`npm run test:browser` 自带）
- **复跑命令：** `npm run test:browser`（内部先 `npm run build`）；截图写入 Git 忽略的 `artifacts/browser/ui-04/`、`ui-09/`

| 文件 | 验收点 | 产生它的 case 与产物名 |
| --- | --- | --- |
| `all-mention-menu.png` | Human 点名的 mention 弹层可读性：0.1.7 把 `--dsw-specific-menu` 改成半透明（名字没变），弹层改用 shipped 毛玻璃配方（`blur(40px) saturate(150%)` + elevation 描边与阴影）后不再被下层对话透穿。图上即该弹层的交付态（`@all` 候选行）。 | journey case「drives the complete opt-in Agent Team journey in real Web」 → `artifacts/browser/ui-04/all-mention-menu.png` |
| `narrow-channel.png` | 390×844 窄栏：模式控件（作为任务）在此宽度仍保留文字标签（图上可见）；原来 460px 处隐藏文字的先例已废，改由工具组间距收窄承接（窄栏 8px / 宽栏 12px，这两个数字由 e2e 在浏览器里断言，不是从图上看出来的）。 | 同一 journey case → `artifacts/browser/ui-04/narrow-channel.png` |
| `human-profile.png` | 「我的资料」页交付态：行分隔线源码写 `1px` 而非 shipped 的 `0.5px`，两者渲染等价（Chromium 把 `border-width` 取整到 1px，逐列像素实测相同），页面观感与改前一致（1440×960）。 | 「configures the Human profile from Settings in real Web」 case → `artifacts/browser/ui-09/human-profile.png` |

两点说明：

- 这三张不是像素级视觉回归基线。每次复跑的新图都落在 Git 忽略的 `artifacts/browser/`；只有能说明验收结论的少量代表图才进入本目录。
- 半径分档（B6：行 12px / 浮层 16px 面 + 8px 行 / 密集双行结果行 8px）与 D 类（中性描边 1px）的完整证据不在这里：B6 由 `scripts/team-ui.e2e.ts` 在浏览器里直接断言，D 类由一次性探针完成，两者的耐久结论都已进 `docs/frontend-design/principles-and-language{,.zh}.md` 与 `scripts/audit-ui-parity.mjs`。
