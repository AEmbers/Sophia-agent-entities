# 为 dsh-agent-team 贡献

[English](CONTRIBUTING.md) | 简体中文

感谢你愿意投入时间。本仓库是 DeepSeek Harness 的外部 opt-in bundle：从仓库根目录发布一个 package，`packages/` 下有三个构建目标，并以一个钉住的 Harness checkout 作为验证基准。每个改动都必须满足的规则在 [`AGENTS.md`](AGENTS.md)；这一页写给准备开 PR 的人。

## 动手之前

- **先把环境契约装起来。** 开发与验证都需要相邻的 Harness checkout（`../deepseek-harness`），安装一律走 `corepack pnpm`——不要用 `npm install`，它会破坏 workspace 的符号链接。安装步骤、生成产物与钉住 tag 的规矩见 [`docs/development.zh.md`](docs/development.zh.md)。
- **改边界先对齐。** Host authority、Team ledger、面向模型的工具面、Client slot 接线由 [`AGENTS.md`](AGENTS.md) 与 [`docs/architecture.zh.md`](docs/architecture.zh.md) 守住。先开 issue 把形状谈定，比写完再重来便宜。
- **只想报告问题？** 用 issue 模板。它会把安装问题先引到版本核对上——「装完就坏」的报告大多是 DSH 版本不匹配。

## 开 PR 之前先验证

按改动面选最小充分的一组检查，再逐级加大：

| 改动涉及 | 要跑 |
| --- | --- |
| `docs/` 下的 Markdown 或 README 配对 | `npm run check:docs` |
| `packages/agent-team/core-skills/` 下的 skill | `npm run check:core-skills` |
| 类型、Host 逻辑、测试 | `npm run typecheck` 与 `npm test` |
| 可见 UI、Client 加载、slot takeover、Remote 激活 | 以上全部，加 `npm run test:browser` |
| 构建产物、`exports`、manifest、发布布局 | 以上全部，加 `npm run build` 与 `npm pack --dry-run` |

`npm test` 会先跑生成产物、文档、core skill 与 package 边界四项检查，再跑 Vitest。完整阶梯（含 `lint`、`duplication`）见 [`docs/development.zh.md`](docs/development.zh.md) §「Verification gradient」。

**只写真正跑过的检查**，并说明它覆盖了什么。别人复现不了的结论，会让 review 多走一轮。

## CI 会跑什么

一个 PR 跑两条 lane：`ubuntu-latest` 与 `windows-latest`。两条 lane 执行同一套六步环境契约——corepack shim、钉住的 Harness checkout、Harness 安装与构建、本仓库安装、bundle 构建、path facade——然后跑 `npm run typecheck` 与 `npm test`。**只改文档**的 `master` push 会跳过门禁，PR 永远不跳。`npm run test:browser` 故意不进 CI，浏览器验收是本地步骤：改动可见时，这份证据要你自己附上。环境契约本身、以及必须与钉住 tag 一起改动的三个文件，见 [`docs/development.zh.md`](docs/development.zh.md) §「Sandbox and CI environments」。

## PR 里应该有什么

- **目标分支是 `master`**；`master` 前进后 rebase 你自己的分支即可，`master` 的历史不会被重写。
- **每个 commit 一行 Conventional Commits**——`type: lowercase imperative summary`（`feat`、`fix`、`chore`、`refactor`、`test`、`perf`、`docs`）——不带正文。PR 以单个 squash commit 落地，历史留下的就是这行标题。
- **每处改动都要说**，不只是最显眼的那处：正文只覆盖一半 diff，reviewer 就得反推另一半。
- **用户可见的改动要更新 [`CHANGELOG.md`](CHANGELOG.md)**，写在 `Unreleased` 下。
- **维护中的文档是双语配对**：改 `foo.md` 时，同一次改动里一并改 `foo.zh.md`；具体路由规则见 [`docs/AGENTS.md`](docs/AGENTS.md)。
- **可见改动要证据**：桌面与 390×844 的截图，加上键盘/焦点与 dialog/menu 状态，口径见 [`docs/frontend-design.zh.md`](docs/frontend-design.zh.md)。
- **生成文件保持生成**：不要手改 `packages/agent-team/lib/typert.*`，也不要手改生成的 `tsconfig*.json` path facade——改 `scripts/sync-paths.mjs` 后重新生成。
- **不要改动相邻的 Harness checkout。** 需要改它的改动属于上游，或者走公开扩展点。
- **偶发失败的测试**：把竞态说清楚并证明它——确定性复现胜过重试；用重试盖住真实的丢失，等于把造成它的缺陷藏起来。
- **别夹带**：credentials、临时 profile、浏览器 overlay、生成的测试文件、浏览器产物、构建残留都不要进提交；提交前保证 `git diff --check` 干净。

## 这里怎么做 review

日常工作发生在 Agent Team 的 Thread 里：改动和它背后的证据一起被审。部分 commit 与 review 由团队的 agent 成员撰写，也可能收到来自 `hoplite` bot 的自动 PR。Review 要的是证据，不是风格。合并一律是 `master` 上的 squash commit；发布是**批量**的，不是持续发布——见 [`docs/development.zh.md`](docs/development.zh.md) §「Profiles and release cadence」。

拿不准这个改动是否被需要？先开 issue，比被拒的 PR 便宜。
