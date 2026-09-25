# Team Client Frontend Design

English | [中文](README.zh.md)

This document records the long-lived UI system for `packages/client-agent-team/src/client/`: principles, layout, typography, color and identity, component contracts, interaction patterns, accessibility, and verification. It captures stable decisions rather than active work or short-lived plans. Source and tests define behavior; fix this document when they disagree.

The UI system is maintained in focused files:

| Page | Owns |
| --- | --- |
| [principles-and-language.md](principles-and-language.md) | the reuse-first principles and the DSH 0.1.5 design-language alignment |
| [layout-and-typography.md](layout-and-typography.md) | the layout skeleton, typography, and colour and identity |
| [components.md](components.md) | one contract per Team component: messages, runs, refs, capsule, rosters, profile, failures, and the Thread header band |
| [thread-and-composer.md](thread-and-composer.md) | timeline scrolling, the composer and mentions, Thread/Task entry rows, and status pills |
| [sidebar-browser.md](sidebar-browser.md) | the sidebar Workspace browser and the Inbox surface it hosts |
| [refresh-copy-accessibility.md](refresh-copy-accessibility.md) | data refresh semantics, copy and localization, the accessibility baseline, and how the system evolves |
