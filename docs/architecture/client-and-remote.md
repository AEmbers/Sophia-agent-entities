# Typed Remote and Client boundaries

English | [中文](client-and-remote.zh.md)

## Typed Remote
`@Remote` annotations on the Team service are inputs to `scripts/generate-typert.mjs`, which uses Harness `WorkspaceAnalyzer` and `FaceModelEmitter` to emit Host and Client artifacts under `packages/agent-team/lib/`.

```text
Host face declaration → generate:typert → Typert Host + Remote client → ctx.remote.$mount(...) → Client remote service
```

`InvocationDescriptor` is local reflection metadata, not a wire message. Wire fields remain explicit typed values. Update declarations/tests, regenerate, and run typecheck/build; never hand-edit artifacts.

## Client plugin and slot composition
The external Client plugin leaves the shipped Shell as outer-layout owner. Team adds one footer action and shadows three seats:

```text
sidebar.footer.action       additive Team entry
sidebar.workspaces          Team shadow, priority -100
main (key conversation)     Team shadow, priority -100
sidebar.settings            Team shadow, priority -100
```

Activation mounts `agentTeamRemote`, waits for `remote.agentTeam`, then registers Team footer and mode shadows. `dsh.client.inject` describes the module graph but does not guarantee apply order or service readiness; use `ctx.slots.inject()` when a declaration may appear later.

`dsh.client.inject` is also not a place to declare a build-time type dependency. The browser loader arrives every named row before its consumer, so listing a package the client never uses at runtime forces the Host to activate that row as a side effect of enabling this one.

Listing `@deepseek-ai/dsh-api-session-controller` did exactly that. The client only imported its `client` subpath as a type, which erases under compilation, and the real `ctx.sessions` face it reads comes from `@deepseek-ai/dsh-api-remotes`. The forced activation re-instantiated `ApiSessionController`, whose constructor registers a file-upload Agent resolver unconditionally into a single-registration slot, so enabling the plugin failed that entry group and left it pending. Every `inject` entry must be a package this client actually loads at runtime.

A slot parent's `children` declaration is both render site and authority. Team's `sidebar.workspaces` shadow must not redeclare shipped `sidebar.workspaces.directoryFlow`; Harness SlotCore rejects duplicate live declarations. Do not copy private WorkspaceBrowser, ConversationRoot, Shell, or private CSS. Use public Harness services and exports, such as `ctx.workspaces.pickDirectory()`, and record limitations rather than depending silently on private implementation.

## Client data and presentation boundary
Client components do not reach into `ctx`, the operation ledger, or Host classes. Data and callbacks arrive through slot owner props, runtime props, declared stores, or injected faces. Presentation consumes Host projections and local navigation state and does not invent durable facts.

Human navigation is Workspace → Channel → Thread; a Task is a card/header overlay. New Channel composition defaults to taskless and exposes default-off 「作为任务」 for atomic Task creation. Taskless Threads retain reply/read/follow/Inbox behavior but gate status, Claims, and resolution controls until promotion. Promotion is non-optimistic and followed by rereading Thread and supplemental projections.

The Human Client consumes the Host's Inbox projection (the 「收件箱 / Inbox」 queue: the merged per-Workspace badge and page, covering each reader's whole unread slice — mentions are counted inside it, never its admission rule, plus a second 「最近活跃」 slice — the Threads that reader has written a Message in, so a Thread they replied to is theirs whether or not they follow it, newest activity first, each Workspace's own slice bounded to ten while the merged page shows at most five, which an Agent's Inbox never carries); it never keeps a parallel Inbox authority, and opening the page acknowledges nothing.

Team navigation mode, Workspace selection, the last Channel/Thread, and the Inbox page position are browser-persisted; unread and Attention are Host-owned.

The Team sidebar keeps Channels/Agents ordering as a browser-only `localStorage` preference, merged over Remote defaults.

An embedded Member Session uses the shipped composer unmodified: the Team registers no member-session composer surface — no seat shadow, no trigger sources, no dock strip. rc.1 moved the trigger-menu overlay into `conversation.composer.bar`'s children (a shadowing entry would inherit — and strand — the overlay), and the Team's own command/member reference entry points carried no irreplaceable value over the shipped vocabulary, so they were removed together.

Ordinary and member sessions share the same composer and vocabulary. Reuse public primitives and `--dsw-*` tokens, keep CSS in CSS Modules, and preserve Team mode restoration and narrow layouts.
