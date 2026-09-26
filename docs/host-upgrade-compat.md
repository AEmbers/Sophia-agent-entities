# DSH 插件 × 宿主升级 0.1.7-rc.2 · 兼容性梳理

> 扫描对象：主人从 DSH 插件管理器确认的**真实三方插件清单**（**22 个**）。
> 判定依据全部来自**实测**：插件自身的构建产物 + 上游 npm 最新版的依赖声明。
>
> ⚠️ 早先的机械扫描（直接遍历 `node_modules`）得出 46 个，那是**虚高**的：
> 它把宿主自身的 `@deepseek-ai/*` 包、以及 `@linxin666/dsh-web-all` 作为依赖拉进来的
> 19 个子插件都算成了独立插件。本表以**插件管理器显示的清单**为准。

## 一、结论先行

| 等级 | 含义 | 数量 |
|---|---|---|
| **A** | 已装版本就支持 0.1.7，无需动作 | 2 |
| **B** | 上游已发布支持 0.1.7 的新版，升级即可 | 2 |
| **C** | 不触及已知差异面，大概率无感 | 8 |
| **C-** | 不触及图标/typert，但注入了 0.1.7 已改名/移除的包 | 4 |
| **D** | 有实质风险：用了 0.1.5 图标或 0.1.5 形态 typert，上游未声明 0.1.7 | 2 |
| **E** | 非公开 npm 包（本地/私有），无法比对上游 | 4 |

**一句话**：0.1.5 → 0.1.7 不是"升个版本"，而是**图标命名体系与 typert 协议的双向硬断裂**。
现在装着的大多数 UI 插件都是**为 0.1.5 构建**的，单独升宿主会让它们的图标全部取到 `undefined`，
插件 UI **静默消失**（无报错面板、日志干净）——与主人前几天遇到的现象完全同源。
**正确姿势：宿主与全部插件一起升，或者都不升。**

## 二、这次新查证的四类差异（附证据）

### ① 图标命名体系 · 双向硬断裂（对三方插件影响最大）

| 对比项 | 0.1.5 宿主 | 0.1.7 |
|---|---|---|
| 导出形式 | `IconAgentPresetOutline16`（数字尺寸） | `IconAgentPresetOutlineRegular` / `Medium`（命名尺寸） |
| 实测导出数 | 只有数字尺寸 | **188 个命名尺寸、0 个数字尺寸**（读 0.1.7 编译产物 `lib/types/icons/index.d.ts`） |
| 有无回退 | ❌ 不认命名尺寸 | ❌ 不认数字尺寸 |

→ 图标由**宿主在运行时提供**（`dsh-client-ui-primitives` 是平台种子模块）。插件为哪个版本构建，
就只能跑在哪个版本上；取不到就是 `undefined`，React 渲染 `<undefined />` **当场抛错**，
整个 slot 组件崩掉 → **插件 UI 静默消失**。

### ② typert codec 协议 · 双向互斥

| | 0.1.5 | 0.1.7 |
|---|---|---|
| loader 要求 | `typeof codec.schema === "object"`，且有 `_zod` | `typeof codec.create === "function"`（源码 `packages/typert/loader/src/index.ts`） |
| 构建产出 | `schema: <zod 对象>` | `create: <懒求值函数>` |

→ 两个版本**互不兼容**，构建产物无法通用。好消息：绝大多数三方插件**根本不用 typert**（见下表），
所以这条对主人影响有限。

### ③ 宿主包改名/移除

| 0.1.5 | 0.1.7 |
|---|---|
| `@deepseek-ai/dsh-agent-presets` | 拆成 dsh-agent-preset + dsh-agent-preset-registry |
| `@deepseek-ai/dsh-client-runtime` | 0.1.7 改名为 dsh-client-web |
| `@deepseek-ai/dsh-code-runtime` | 0.1.7 已移除 |
| `@deepseek-ai/dsh-code-runtime-worker-thread` | 0.1.7 已移除 |
| `@deepseek-ai/dsh-web-frontend` | 0.1.7 改名为 dsh-client-web / dsh-host-frontend-static |

→ 若插件的 `dsh.client.inject` 里点到了这些包，client 半会**一直等不到依赖而不激活**，表现同样是"UI 不见了"。
（注：主人自己的 `dsh-sophia-entities` 也点了一个 0.1.7 才有的包名却仍能启动，
说明这条不总是硬失败——但它确实是风险面，升级后要重点复验。）

### ④ 版本规模与行为差异

- 0.1.7 宿主包 **312 个**，0.1.5 是 **247 个**：新增 **85 个**，改名/移除约 **9 个**
- 行为差异举例：0.1.7 把**会话选择移进了 workspace 服务**（渲染的是持有 `mainView` 引用的那个会话）

## 三、逐个插件清单

| 等级 | 插件 | 已装 | 上游最新 | 上游声明 0.1.7 | 图标面 | typert 面 | 结论 |
|---|---|---|---|---|---|---|---|
| **A** | `@hyzyn/dsh-env` | 0.2.7 | 0.2.7（同版） · **声明支持 0.1.7** | ✅ | 不用图标 | 不用 typert | 已装版本即支持 0.1.7，无需动作 |
| **A** | `@nath-vikky/dsh-codekin` | 0.4.0-rc.1 | 0.4.0-rc.1（同版） · **声明支持 0.1.7** | ✅ | 不用图标 | 不用 typert | 已装版本即支持 0.1.7，无需动作 |
| **B** | `@changfenhuang/dsh-genui` | 0.11.0 | 0.11.1（可升） · **声明支持 0.1.7** | ✅ | 宿主图标 ×2（0.1.5 命名） | 不用 typert | 上游 0.11.1 已支持 0.1.7，升级即可（本插件用了宿主图标，升级前会失效） |
| **B** | `@linxin666/dsh-web-all` | 0.3.24 | 0.4.2（可升） · **声明支持 0.1.7** | ✅ | 宿主图标 ×9（0.1.5 命名） | 不用 typert | 上游 0.4.2 已支持 0.1.7，升级即可（本插件用了宿主图标，升级前会失效） |
| **C** | `@lemoncat7/dsh-web-search` | 0.2.1 | 0.2.1（同版） · 其它范围 | ❌ | 不用图标 | 不用 typert | 不触及已知四类差异面，大概率无感（DSH API 面很广，非 100% 保证） |
| **C** | `@tt-a1i/archify-dsh` | 0.1.0 | 0.1.0（同版） · 无 peer 声明 | ❌ | 不用图标 | 不用 typert | 不触及已知四类差异面，大概率无感（DSH API 面很广，非 100% 保证） |
| **C** | `dsh-agy-link` | 0.4.38 | 0.4.38（同版） · 其它范围 | ❌ | 不用图标 | 不用 typert | 不触及已知四类差异面，大概率无感（DSH API 面很广，非 100% 保证） |
| **C** | `dsh-mermaid` | 0.4.1 | 0.4.1（同版） · 无 peer 声明 | ❌ | 不用图标 | 不用 typert | 不触及已知四类差异面，大概率无感（DSH API 面很广，非 100% 保证） |
| **C** | `dsh-opencode-session` | 0.1.1 | 0.1.1（同版） · 无 peer 声明 | ❌ | 不用图标 | 不用 typert | 不触及已知四类差异面，大概率无感（DSH API 面很广，非 100% 保证） |
| **C** | `dsh-remote-plugin` | 0.6.26 | 0.7.0（可升） · 无 peer 声明 | ❌ | 不用图标 | 不用 typert | 不触及已知四类差异面，大概率无感（DSH API 面很广，非 100% 保证） |
| **C** | `dsh-tool-normalizer` | 0.5.2 | 0.5.2（同版） · 其它范围 | ❌ | 不用图标 | 不用 typert | 不触及已知四类差异面，大概率无感（DSH API 面很广，非 100% 保证） |
| **C** | `dshmarket` | 1.65.1 | 1.65.1（同版） · 其它范围 | ❌ | 不用图标 | 不用 typert | 不触及已知四类差异面，大概率无感（DSH API 面很广，非 100% 保证） |
| **C-** | `@xmanrui/dsh-im` | 4.28.0 | 4.28.0（同版） · 无 peer 声明 | ❌ | 不用图标 | 不用 typert | 不触及图标/typert，但注入了 0.1.7 已改名/移除的包：@deepseek-ai/dsh-client-runtime |
| **C-** | `dsh-prompt-polish` | 2.3.0 | 0.1.0（可升） · 其它范围 | ❌ | 不用图标 | 不用 typert | 不触及图标/typert，但注入了 0.1.7 已改名/移除的包：@deepseek-ai/dsh-client-runtime |
| **C-** | `dsh-skill-picker` | 0.5.11 | 0.5.11（同版） · 其它范围 | ❌ | 不用图标 | 不用 typert | 不触及图标/typert，但注入了 0.1.7 已改名/移除的包：@deepseek-ai/dsh-client-runtime |
| **C-** | `plugin-effort-slider` | 1.2.2 | 1.2.2（同版） · 无 peer 声明 | ❌ | 不用图标 | 不用 typert | 不触及图标/typert，但注入了 0.1.7 已改名/移除的包：@deepseek-ai/dsh-client-runtime |
| **D** | `@kenz1117/dsh-ui-usage-billing` | 1.4.7 | 1.4.8（可升） · 其它范围 | ❌ | 宿主图标 ×1（0.1.5 命名） | 不用 typert | 用了 0.1.5 图标，且上游未声明 0.1.7 → 升级宿主会静默失效 |
| **D** | `dsh-workbuddy-xdpool` | 1.5.2 | 1.6.1（可升） · 其它范围 | ❌ | 宿主图标 ×1（0.1.5 命名） | 不用 typert | 用了 0.1.5 图标，且上游未声明 0.1.7 → 升级宿主会静默失效 |
| **E** | `@dsh-external/dsh-sentinel` | 0.7.0 | 不在公开 npm | — | 不用图标 | 不用 typert | 非公开 npm 包（本地/私有），无法比对上游；需按图标与注入面单独确认 |
| **E** | `@sophia/core` | 0.1.0 | 不在公开 npm | — | 宿主图标 ×17（0.1.5 命名） | 不用 typert | 非公开 npm 包（本地/私有），无法比对上游；需按图标与注入面单独确认 |
| **E** | `dsh-inspect-coexist` | 1.0.0 | 不在公开 npm | — | 不用图标 | 不用 typert | 非公开 npm 包（本地/私有），无法比对上游；需按图标与注入面单独确认 |
| **E** | `dsh-sidebar-width` | 0.2.1 | 不在公开 npm | — | 不用图标 | 不用 typert | 非公开 npm 包（本地/私有），无法比对上游；需按图标与注入面单独确认 |

## 四、三个要单独说明的条目

### `dsh-inspect-coexist`（本地 shim，安全，别删）

不是三方插件，是**本机手写的一个兼容补丁**（`private: true`，`file:./node_modules/dsh-inspect-coexist`）。
它解决的问题很具体：`@deepseek-ai/dsh-cordis-host-runner` 的 `cordisInspect` 是进程级单例，
`register()` 撞到重复 provider id 会直接抛错；而 `@deepseek-ai/dsh-tool-cordis` **每次 mount 都注册同一组 id**，
于是「一个会话跑内置 cordis、另一个会话跑带 tool-cordis 的 preset」时，第二个 mount 就会失败。

它做的事：把 `cordisInspect.register` 包一层，撞到 "already registered" 时**替换**而非抛错；
两个注册者来自同一个包同一个版本，manifest 逐字段相同，所以替换在行为上是 no-op。
只依赖宿主公开服务，不 import 任何三方包；上游哪天原生修好，这层包装自动变惰性 no-op。
**结论：留着，别动。**

### `dsh-remote-plugin`（装了但没启用 —— UI 上"为什么未生效？"的答案）

它在 profile 的 `dependencies` 里，但**不在 `dsh.profile.bundles` 启用清单里**。
DSH 启动时只装载 bundles 列表里的行，所以它从头到尾没有被加载，
插件管理器因此显示成"未生效"。想用就在插件管理器里启用（`dsh plugin --profile desktop add dsh-remote-plugin`），
不想用就保持现状——它不占运行开销。

### `@sophia/core`（前身项目，主人要求清理）

是主人让我重做之前的**第一版尝试**（`Sophia-agent-entities`），当前仍**启用中**，
挂载两行：`@sophia/core/host`（只读自检路由 `/api/sophia/status` + 一条提示词公告）
与 `@sophia/core`（裸名行，兼作浏览器半的发现锚点与领域库入口）。
清理范围与风险见同目录 **`docs/sophia-core-cleanup-plan.md`**（需主人确认后才执行）。

## 五、升级建议（两套方案，请主人选一套）

### 方案甲 · 暂不升宿主（推荐，最省事）

- 主人当前 0.1.5-rc.2 环境**一切正常**，继续在隔离 profile 里开发 `dsh-sophia-entities`
- 代价：我们的插件继续依赖 `scripts/patch-typert-compat.mjs`（图标 + codec 两类补丁）
- 何时切：等 `@linxin666` 全家桶等主要插件的 0.1.7 版本都稳定后再说

### 方案乙 · 宿主 + 插件一起升到 0.1.7-rc.2

**必须一次性做完，不能只升宿主**：

1. 先把 §三 表里所有 **B 级**插件升到上游最新版（主要就是 `@linxin666/dsh-web-all` 0.3.24 → 0.4.2、`dsh-better-sidebar` 若单独装了则 0.19.1 → 0.21.1）
2. **D 级**插件要么等上游出 0.1.7 版，要么接受它们的功能暂时不可用
3. **E 级**（本地/私有包）逐个在 0.1.7 上实测
4. 最后把宿主升到 `0.1.7-rc.2`
5. **我们的 `dsh-sophia-entities` 要删掉 `patch-typert-compat.mjs`**
   —— 该补丁是往 0.1.5 方向降级的，在 0.1.7 上会**反过来**把插件弄坏（脚本头部已写明）

### 无论选哪套，都建议先做这件事

把 `~/.dsh` 整个目录备份一份（几 GB 量级），再动宿主。

## 六、判定口径（免得主人被表面数字误导）

1. **"支持 0.1.7" 的判据是上游自己的依赖声明**（`peerDependencies` 里是否列出 `0.1.7*`），
   不是我们的主观判断。若某插件从不声明 peer，就只能靠"是否触及差异面"来推。
2. **图标维度只看"是否从宿主取图标"**。插件自带的图标组件不受宿主版本影响，
   所以判定前先确认它的产物里有 `@deepseek-ai/dsh-client-ui-primitives` 引用。
3. **C- 只看运行时依赖字段**（`dsh.client.inject` / `peerDependencies` / `dependencies` / `optionalDependencies`），
   **故意排除 `devDependencies`**——那是构建期依赖，装到主人机器上根本不参与运行。
   实测例：`@lemoncat7/dsh-web-search` 与 `dshmarket` 的 `package.json` 里确实出现了
   `dsh-code-runtime` / `dsh-client-runtime`，但都在 `devDependencies` 里，
   所以它们**不进 C-、按 C 处理**。若用"全文搜字符串"的粗口径，这两个会被误判成有风险。
4. **C 级不是"保证没事"**。DSH 的宿主 API 面很广（0.1.7 新增 85 个包），
   我们只覆盖了**已确认的**四类差异面；C 级意思是"没踩到已知的雷"，不等于"绝对安全"。
5. **E 级（7 个）没有可比对的上游**（私有/本地包），必须单独实测。
6. **对外交付目标里的"把 deepseek-harness / cordis / schemastery 放进 devDependencies"是一处有意的偏差**：
   本仓库按技术正确口径处理（见 `package.json` `peerDependencies`）。
   - `deepseek-harness` 在 npm 上只是 0.0.1 占位包，真正的 harness 依赖相邻检出
     `../deepseek-harness`（由 `scripts/harness-dir.mjs` + `scripts/link-harness-packages.mjs`
     解析并 junction/链接进 `node_modules`），**从不**作为 npm 依赖安装，故不写进任何依赖字段。
   - `@deepseek-ai/cordis`（`^4.0.1`）与 `@deepseek-ai/schemastery`（`^3.0.0`）是宿主运行时
     提供的**运行时依赖**（dag-team / agent-team 源码在运行时 `import` 它们），按上条第 3
     点的口径应放 `peerDependencies`（宿主声明、由依赖它们的包自己提供），而非仅构建期
     `devDependencies`。若硬塞进 devDependencies 会违背 boot-closure 运行时依赖分类
     （`packages/agent-team/tests/shipping.spec.ts`）与本条第 3 点规则。

---

*本报告由扫描脚本生成：`.workbuddy/tmp/analyze-plugins.mjs` + `.workbuddy/tmp/build-report.mjs`，数据快照 `.workbuddy/tmp/plugins-desktop.json`。*
*生成时间：2026-09-25。上游版本与依赖声明以 npm 实时数据为准，会随时间变化。*
