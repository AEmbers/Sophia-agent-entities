# 走查与验收代表图

- **工作项：** `.scratch/archive/2026-09/claim-panel-ux/`（Claim 面板与 Thread/Channel 顶层栏走查，2026-09-19 归档）
- **交付提交：** `feat: rework the Thread header band and Claim panel`
- **运行环境：** 相邻 `../deepseek-harness` checkout、`/usr/bin/google-chrome`、无凭据的确定性 fixture（本地 e2e 配方，见 `../recipes/`）
- **复跑命令：** `node .scratch/archive/2026-09/claim-panel-ux/recipes/run-local.mjs <配方> <label>`；产物落在 Git 忽略的 `.scratch/local/claim-panel-ux/<label>/`

| 文件 | 验收点 | 产生它的配方与产物名 |
| --- | --- | --- |
| `thread-expanded-before-after-desktop.png` | 展开态首屏改前/改后对照（同一 fixture、1440×960）：顶层栏 426px → 360px、带内带边框元素 3 → 0、风险行 2 行 → 1 行、claim 行改为三轨全占满。下半是注入候选设计后的预览，即 human 16:35 验收依据的那一版。 | `preview.e2e.ts` → `thread-expanded-before-desktop.png` + `thread-expanded-after-desktop.png` |
| `band-three-states-shipped.png` | 交付态三态（真实实现，无注入 CSS）：1440 展开 360px、390 展开 390px、1440 折叠 224px；每态带内带边框元素 0、风险各 1 行、claim 行高 44px —— 图上标题就是这组实测数字。 | `verify.e2e.ts` → `verify-<label>/thread-expanded-desktop.png`、`thread-expanded-narrow.png`、`thread-collapsed-desktop.png` + `verify-<label>.json` |
| `taskless-one-line-opening-desktop.png` | taskless Thread（讨论）的开篇被压成 1 行：长开篇与短开篇的页头同为 114px，页头高度不再随正文长度变化。 | `taskless.e2e.ts` → `taskless-<label>/taskless-long-desktop.png` + `taskless-<label>.json` |

两点说明：

- 前两张是带标注的拼版对照图，由当时一次性使用的拼版脚本生成（该脚本按「一次性产物」在归档时删除）。上面的配方复跑的是同一次量测与同一组截图，但不复现拼版与标注本身。
- `thread-expanded-before-after-desktop.png` 的标注行中文渲染为方框（标注层字体缺 CJK），其中的数字可读。

这些图不是像素级视觉回归基线。每次复跑的新图都落在 Git 忽略的 `.scratch/local/`；只有人工确认能说明验收结论的少量代表图才进入本目录。
