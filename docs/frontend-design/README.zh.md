# Team Client 前端设计文档

[English](README.md) | 中文

本文记录 `packages/client-agent-team/src/client/` 的长期 UI 设计体系：设计原则、布局骨架、排版、颜色与身份、组件合同、交互模式、可访问性基线和验证流程。它只沉淀跨工作项稳定的决策与合同；进行中的工作项、短期问题和未实现的计划记录在 `.scratch/active/`，不进入本文。实现以源码和测试为准，文档与代码冲突时先修正文档。

这套 UI 体系按主题维护在多个文件里：

| Page | Owns |
| --- | --- |
| [principles-and-language.zh.md](principles-and-language.zh.md) | 复用优先的设计原则与 DSH 0.1.5 设计语言对齐 |
| [layout-and-typography.zh.md](layout-and-typography.zh.md) | 布局骨架、排版体系，以及颜色与身份 |
| [components.zh.md](components.zh.md) | 每个 Team 组件一份合同：消息、消息块、ref、计数胶囊、花名册、资料页、失败态与 Thread 顶层栏 |
| [thread-and-composer.zh.md](thread-and-composer.zh.md) | 时间线滚动、composer 与 mention、Thread/Task 入口行，以及状态胶囊与弹层 |
| [sidebar-browser.zh.md](sidebar-browser.zh.md) | 侧栏工作区浏览器，以及它承载的 Inbox 界面 |
| [refresh-copy-accessibility.zh.md](refresh-copy-accessibility.zh.md) | 数据刷新语义、文案与本地化、可访问性基线，以及体系如何演进 |
