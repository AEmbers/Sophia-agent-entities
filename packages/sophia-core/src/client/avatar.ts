/**
 * 成员头像的 URL 解析 —— **实现已移到 `../avatar-paths.ts`**，此处只做转出。
 *
 * ## 为什么实现不在这里了（这是修一个真实缺陷，别挪回来）
 *
 * 这个判据有**两个**使用方，且分处插件两半：
 * - 宿主：`GET /api/sophia/avatar` 收到 `?path=` 后**必须**重跑它
 *   （`src/host-data.ts` 的 `resolveAvatarFile`）；
 * - 浏览器：`avatarUrlFor` 拼 URL 前先跑它。
 *
 * 实现放在 `src/client/` 会形成「宿主半 import 浏览器半」的依赖，而那条依赖
 * 一旦被宿主 `tsconfig.json`（`lib: ["es2024"]`，**无 DOM**）解析，该目录里
 * **任何**一处 DOM 引用都会当场把宿主类型检查打红 —— 且 `exclude: ["src/client"]`
 * **拦不住被 import 拉进来的文件**（它只管根文件扫描范围）。
 *
 * 这不是假想：本仓实测发生过 —— `src/host-data.ts` `import type` 了
 * `src/client/view-model.ts`，而后者 type-import `locales.ts`，
 * 于是 `locales.ts:245` 的 `document` 让契约命令
 * `npx tsc --noEmit -p packages/sophia-core/tsconfig.json` **exit 2**：
 *
 * ```
 * src/client/locales.ts(245,22): error TS2584: Cannot find name 'document'.
 * ```
 *
 * 现在判据只有**一份**（`../avatar-paths.ts`），宿主的 `import` 不经过本目录，
 * 「抄一份到两边」那条会让两处安全判据各自漂移的路也就堵死了。
 *
 * ⚠ 本文件保留 re-export 是为了不动既有调用点（`panel-store.ts`、各测试文件）
 * 与既有对外契约 —— 迁移对它们**零可见**。
 *
 * @module @sophia/core/client/avatar
 */

export { AVATAR_ROOT, AVATAR_ROUTE, avatarUrlFor, resolveAvatarUrl, sanitizeAvatarPath } from '../avatar-paths.ts'
