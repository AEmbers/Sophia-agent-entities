# DSH 插件 × 宿主升级 0.1.7-rc.2 · 兼容性梳理

> 扫描对象：`~/.dsh/profiles/desktop/node_modules` 下全部带 `dsh` 字段的插件（**46 个**，已剔除宿主自身的 `@deepseek-ai/*` 包）
> 判定依据全部来自**实测**：插件自身的构建产物 + 上游 npm 最新版的依赖声明。

## 一、结论先行

| 等级 | 含义 | 数量 |
|---|---|---|
| **A** | 已装版本就支持 0.1.7，无需动作 | 2 |
| **B** | 上游已发布支持 0.1.7 的新版，升级即可 | 20 |
| **C** | 不触及已知差异面，大概率无感 | 11 |
| **C-** | 不触及图标/typert，但注入了 0.1.7 已改名/移除的包 | 4 |
| **D** | 有实质风险：用了 0.1.5 图标或 0.1.5 形态 typert，上游未声明 0.1.7 | 2 |
| **E** | 非公开 npm 包（本地/私有），无法比对上游 | 7 |

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
| **B** | `@linxin666/dsh-client-ui-community-plugins` | 0.3.24 | 0.4.2（可升） · **声明支持 0.1.7** | ✅ | 不用图标 | 不用 typert | 上游 0.4.2 已支持 0.1.7，升级即可 |
| **B** | `@linxin666/dsh-client-ui-git-graph` | 0.3.24 | 0.4.2（可升） · **声明支持 0.1.7** | ✅ | 宿主图标 ×5（0.1.5 命名） | 不用 typert | 上游 0.4.2 已支持 0.1.7，升级即可（本插件用了宿主图标，升级前会失效） |
| **B** | `@linxin666/dsh-client-ui-market` | 0.3.24 | 0.4.2（可升） · **声明支持 0.1.7** | ✅ | 不用图标 | 不用 typert | 上游 0.4.2 已支持 0.1.7，升级即可 |
| **B** | `@linxin666/dsh-client-ui-model-capabilities` | 0.3.24 | 0.4.2（可升） · **声明支持 0.1.7** | ✅ | 不用图标 | 不用 typert | 上游 0.4.2 已支持 0.1.7，升级即可 |
| **B** | `@linxin666/dsh-client-ui-plugin-manager` | 0.3.24 | 0.4.2（可升） · **声明支持 0.1.7** | ✅ | 不用图标 | 不用 typert | 上游 0.4.2 已支持 0.1.7，升级即可 |
| **B** | `@linxin666/dsh-client-ui-preset-center` | 0.3.24 | 0.4.2（可升） · **声明支持 0.1.7** | ✅ | 不用图标 | 不用 typert | 上游 0.4.2 已支持 0.1.7，升级即可 |
| **B** | `@linxin666/dsh-client-ui-skill-explorer` | 0.3.24 | 0.4.2（可升） · **声明支持 0.1.7** | ✅ | 不用图标 | 不用 typert | 上游 0.4.2 已支持 0.1.7，升级即可 |
| **B** | `@linxin666/dsh-client-ui-skin-center` | 0.3.24 | 0.4.2（可升） · **声明支持 0.1.7** | ✅ | 不用图标 | 不用 typert | 上游 0.4.2 已支持 0.1.7，升级即可 |
| **B** | `@linxin666/dsh-client-ui-task-board` | 0.3.24 | 0.4.2（可升） · **声明支持 0.1.7** | ✅ | 不用图标 | 不用 typert | 上游 0.4.2 已支持 0.1.7，升级即可 |
| **B** | `@linxin666/dsh-client-ui-web-ui-settings` | 0.3.24 | 0.4.2（可升） · **声明支持 0.1.7** | ✅ | 不用图标 | 不用 typert | 上游 0.4.2 已支持 0.1.7，升级即可 |
| **B** | `@linxin666/dsh-i18n` | 0.3.24 | 0.4.2（可升） · **声明支持 0.1.7** | ✅ | 不用图标 | 不用 typert | 上游 0.4.2 已支持 0.1.7，升级即可 |
| **B** | `@linxin666/dsh-liangshen` | 0.3.24 | 0.4.2（可升） · **声明支持 0.1.7** | ✅ | 不用图标 | 不用 typert | 上游 0.4.2 已支持 0.1.7，升级即可 |
| **B** | `@linxin666/dsh-pet` | 0.3.24 | 0.4.2（可升） · **声明支持 0.1.7** | ✅ | 不用图标 | 不用 typert | 上游 0.4.2 已支持 0.1.7，升级即可 |
| **B** | `@linxin666/dsh-remote-web-ui` | 0.3.24 | 0.4.2（可升） · **声明支持 0.1.7** | ✅ | 宿主图标 ×5（0.1.5 命名） | 不用 typert | 上游 0.4.2 已支持 0.1.7，升级即可（本插件用了宿主图标，升级前会失效） |
| **B** | `@linxin666/dsh-session-archive` | 0.3.24 | 0.4.2（可升） · **声明支持 0.1.7** | ✅ | 不用图标 | 不用 typert | 上游 0.4.2 已支持 0.1.7，升级即可 |
| **B** | `@linxin666/dsh-ssh` | 0.3.24 | 0.4.2（可升） · **声明支持 0.1.7** | ✅ | 不用图标 | 不用 typert | 上游 0.4.2 已支持 0.1.7，升级即可 |
| **B** | `@linxin666/dsh-usage` | 0.3.24 | 0.4.2（可升） · **声明支持 0.1.7** | ✅ | 不用图标 | 不用 typert | 上游 0.4.2 已支持 0.1.7，升级即可 |
| **B** | `@linxin666/dsh-web-all` | 0.3.24 | 0.4.2（可升） · **声明支持 0.1.7** | ✅ | 宿主图标 ×9（0.1.5 命名） | 不用 typert | 上游 0.4.2 已支持 0.1.7，升级即可（本插件用了宿主图标，升级前会失效） |
| **B** | `dsh-better-sidebar` | 0.19.1 | 0.21.1（可升） · **声明支持 0.1.7** | ✅ | 宿主图标 ×38（0.1.5 命名） | 不用 typert | 上游 0.21.1 已支持 0.1.7，升级即可（本插件用了宿主图标，升级前会失效） |
| **C** | `@lemoncat7/dsh-web-search` | 0.2.1 | 0.2.1（同版） · 其它范围 | ❌ | 不用图标 | 不用 typert | 不触及已知四类差异面，大概率无感（DSH API 面很广，非 100% 保证） |
| **C** | `@linxin666/dsh-doctor` | 0.3.24 | 0.3.24（同版） · 无 peer 声明 | ❌ | 不用图标 | 不用 typert | 不触及已知四类差异面，大概率无感（DSH API 面很广，非 100% 保证） |
| **C** | `@linxin666/dsh-tool-describe-image` | 0.3.24 | 0.3.24（同版） · 无 peer 声明 | ❌ | 不用图标 | 不用 typert | 不触及已知四类差异面，大概率无感（DSH API 面很广，非 100% 保证） |
| **C** | `@tt-a1i/archify-dsh` | 0.1.0 | 0.1.0（同版） · 无 peer 声明 | ❌ | 不用图标 | 不用 typert | 不触及已知四类差异面，大概率无感（DSH API 面很广，非 100% 保证） |
| **C** | `billion-context` | 0.1.147 | 0.1.149（可升） · 无 peer 声明 | ❌ | 不用图标 | 不用 typert | 不触及已知四类差异面，大概率无感（DSH API 面很广，非 100% 保证） |
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
| **E** | `@dsh-agent-toolchain/dsh-api-visualizer` | 0.1.0 | 不在公开 npm | — | 不用图标 | 不用 typert | 非公开 npm 包（本地/私有），无法比对上游；需按图标与注入面单独确认 |
| **E** | `@dsh-agent-toolchain/dsh-hang-inspector` | 0.1.0 | 不在公开 npm | — | 不用图标 | 不用 typert | 非公开 npm 包（本地/私有），无法比对上游；需按图标与注入面单独确认 |
| **E** | `@dsh-agent-toolchain/dsh-postman` | 0.1.0 | 不在公开 npm | — | 不用图标 | 不用 typert | 非公开 npm 包（本地/私有），无法比对上游；需按图标与注入面单独确认 |
| **E** | `@dsh-external/dsh-sentinel` | 0.7.0 | 不在公开 npm | — | 不用图标 | 不用 typert | 非公开 npm 包（本地/私有），无法比对上游；需按图标与注入面单独确认 |
| **E** | `@sophia/core` | 0.1.0 | 不在公开 npm | — | 宿主图标 ×17（0.1.5 命名） | 不用 typert | 非公开 npm 包（本地/私有），无法比对上游；需按图标与注入面单独确认 |
| **E** | `dsh-inspect-coexist` | 1.0.0 | 不在公开 npm | — | 不用图标 | 不用 typert | 非公开 npm 包（本地/私有），无法比对上游；需按图标与注入面单独确认 |
| **E** | `dsh-sidebar-width` | 0.2.1 | 不在公开 npm | — | 不用图标 | 不用 typert | 非公开 npm 包（本地/私有），无法比对上游；需按图标与注入面单独确认 |

## 四、升级建议（两套方案，请主人选一套）

### 方案甲 · 暂不升宿主（推荐，最省事）

- 主人当前 0.1.5-rc.2 环境**一切正常**，继续在隔离 profile 里开发 `dsh-sophia-entities`
- 代价：我们的插件继续依赖 `scripts/patch-typert-compat.mjs`（图标 + codec 两类补丁）
- 何时切：等 `@linxin666` 全家桶等主要插件的 0.1.7 版本都稳定后再说

### 方案乙 · 宿主 + 插件一起升到 0.1.7-rc.2

**必须一次性做完，不能只升宿主**：

1. 先把 §三 表里所有 **B 级**插件升到上游最新版（尤其 `@linxin666/*` 0.3.24 → 0.4.2、`dsh-better-sidebar` 0.19.1 → 0.21.1）
2. **D 级**插件要么等上游出 0.1.7 版，要么接受它们的功能暂时不可用
3. **E 级**（本地/私有包）逐个在 0.1.7 上实测
4. 最后把宿主升到 `0.1.7-rc.2`
5. **我们的 `dsh-sophia-entities` 要删掉 `patch-typert-compat.mjs`**
   —— 该补丁是往 0.1.5 方向降级的，在 0.1.7 上会**反过来**把插件弄坏（脚本头部已写明）

### 无论选哪套，都建议先做这件事

把 `~/.dsh` 整个目录备份一份（几 GB 量级），再动宿主。

## 五、判定口径（免得主人被表面数字误导）

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

---

*本报告由扫描脚本生成：`.workbuddy/tmp/analyze-plugins.mjs` + `.workbuddy/tmp/build-report.mjs`，数据快照 `.workbuddy/tmp/plugins-desktop.json`。*
*生成时间：2026-09-25。上游版本与依赖声明以 npm 实时数据为准，会随时间变化。*
