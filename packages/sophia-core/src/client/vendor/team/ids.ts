/**
 * 索菲亚侧的两个**不透明身份串**。
 *
 * ## 为什么单独一个文件（而且只有两行）
 *
 * 上游 `navigation.ts` 从两个宿主包取 `SessionId` 与 `WorkspaceId`：
 *
 * ```ts
 * import type { SessionId } from '@deepseek-ai/dsh-session'
 * import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
 * ```
 *
 * 这两个说明符索菲亚都**不能**出现，且是两条独立的原因：
 *
 * 1. **类型不存在**：两个包都不在 `vendor/upstream-modules.d.ts` 的声明里
 *    ⇒ 当场 `TS2307: Cannot find module`。
 * 2. **值会被构建期拒绝**：`tsdown.config.ts` 的 `sophia-client-bundle-purity`
 *    插件对任何不在 `PLATFORM_MODULES` 里的 `@deepseek-ai/*` 说明符
 *    **直接抛错**（该清单只有 8 项，其中不含这两个）。
 *    注意**这条对 `import type` 也成立** —— 只要标识符出现在类型位置，
 *    构建期插件看到的就是那个裸说明符。
 *
 * ## 为什么是 `string` 而不是 branded 类型
 *
 * 理由与 `agent-team-types.ts` 里 `AgentTeamMemberId` 的说明**同一条**：
 * 索菲亚的线格式是从 JSON 解析出来的裸字符串，运行期没有任何东西能把字符串
 * 变成 branded 值。硬造一个 phantom 品牌会得到「编译期像有保护、运行期没有」
 * 的假象 —— 比裸 `string` 更糟，因为它会让读者以为这里有保护。
 *
 * ⚠ **这两个名字在索菲亚的语义是「不透明串」**，界面上只做相等比较与存储，
 * 不解析、不做前缀判断。因此弱化的代价是**可核实的**：本目录内对这两个类型
 * 的用法只有 `===` 与 JSON 往返（`navigation.ts` 的 `readSnapshot` /
 * `persistSnapshot`）。若将来有调用点开始按前缀解析它们，这条说明就失效了，
 * 那时应当引入索菲亚自己的 branded 构造器（宿主侧产出的地方加）。
 *
 * @module @sophia/core/client/vendor/team/ids
 */

/** 会话 id（索菲亚的不透明串）。见文件头。 */
export type SessionId = string

/** 「工作区」id（索菲亚的不透明串）。见文件头。 */
export type WorkspaceId = string
