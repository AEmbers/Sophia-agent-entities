# 安装 / 更新 / 卸载 索菲亚插件（`@sophia/core`）

本文是**唯一**的安装说明。目标读者是**别人**（不是作者本人这台机器）：
照着走一遍，就能把它装进自己的 DSH，装不上就是本文的问题。

---

## 0. 前置

| 需要 | 判据（自己跑一遍） |
|---|---|
| Node | `node --version` ⇒ **≥ 24**（本包 `engines.node` 是 `>=24.0.0`；账本用 `node:sqlite`，低版本没有这个内建模块） |
| pnpm | `pnpm --version` 能出版本号 |
| DSH | `dsh --version` 能出版本号（安装动作由 `dsh plugin` 转发给 pnpm） |
| 一个 profile 名 | 看 `~/.dsh/profiles/` 下有哪些目录；本文以 **`desktop`** 为例 |

---

## 1. 为什么不能一条 `github:` 命令装完（**请先读这段，能省你半小时**）

本包在**monorepo 的子目录**里（`packages/sophia-core`），而 **npm / pnpm 的 git 依赖不支持
「装仓库里的某个子目录包」** —— `pnpm add github:AEmbers/Sophia-agent-entities` 会去装
**仓库根**，而仓库根不是这个包。

所以正确的形态是**三步**：**克隆 → 本地构建 → 按路径安装**。
`dsh plugin add <路径>` 会把包 pnpm 装进 profile，并把它对进该 profile 的
`dsh.profile.bundles` 列表；DSH 启动时读 profile 的 patch 链装载。

> 本包**保留** `"private": true`：它防的是误 `npm publish`（发布到公共 registry 是不可撤销的），
> **不拦**下面这种按路径安装。

---

## 2. 安装

```bash
# ① 克隆
git clone https://github.com/AEmbers/Sophia-agent-entities.git
cd Sophia-agent-entities

# ② 装依赖并构建（构建产物在 packages/sophia-core/lib/，这是 DSH 真正加载的东西）
pnpm install
pnpm -C packages/sophia-core build          # 也可用 npm run build

# ③ 装进 DSH 的某个 profile（把 <ABSOLUTE_PATH> 换成上一步那个仓库的绝对路径）
dsh plugin --profile desktop add <ABSOLUTE_PATH>/packages/sophia-core
```

Windows 下第 ③ 步的路径写法示例：

```powershell
dsh plugin --profile desktop add C:\path\to\Sophia-agent-entities\packages\sophia-core
```

**别跳过第 ② 步。** DSH 加载的是 `lib/`（`package.json` 的 `main` 是 `lib/plugin.js`），
克隆下来的是**源码**，`lib/` 是构建产物、不在仓库里。

---

## 3. 验证（三条，都要过）

```bash
# ① 路由在：应返回 JSON，含 ok 字段。
#   把 <PORT> 换成你自己 DSH 的端口 —— 本包不假定端口，也不替你猜。
curl http://127.0.0.1:<PORT>/api/sophia/status
```

```bash
# ② 插件真的被 profile 认了：应能看到 @sophia/core。
#   ⚠ `dsh plugin` 是 **pnpm 的转发**（实测 `dsh plugin --help` 打出来的是 pnpm 的帮助），
#   所以这条的输出是 **pnpm 的依赖树**，不是 DSH 自己的插件清单 —— 别把它当契约。
dsh plugin --profile desktop list
```

```bash
# ③ 界面上有入口：重启 DSH 后，侧边栏出现「索菲亚」，点开是团队面板
```

第 ③ 条是**唯一能证明"装好了"的那一条**（前两条只说明包在盘上）。
如果侧边栏没有入口，先看 DSH 启动日志里 `@sophia/core` 那一行有没有报错 ——
`cordis.patch.yml` 的注释里记了一个真实陷阱：**宿主半边 import 失败的行，会连浏览器半
一起不被发现**（`dsh-client-modules` 会跳过 `entry.fiber === undefined` 的行）。

---

## 4. 更新

```bash
cd Sophia-agent-entities
git pull
pnpm -C packages/sophia-core build
dsh plugin --profile desktop add <ABSOLUTE_PATH>/packages/sophia-core   # 重装一次，指向同一路径
```

然后**重启 DSH**（插件在启动时装载，热替换不在本包的支持范围内）。

---

## 5. 卸载

```bash
dsh plugin --profile desktop remove @sophia/core
```

然后重启 DSH。**数据不会跟着删**：账本在 profile 的 `data/` 下（**追加式**，
本包没有任何"删除事件"的路径）。要清数据得自己动手，并且清楚后果。

---

## 6. 装出来的包里有什么（可自查）

```bash
cd packages/sophia-core
npm pack --dry-run
```

期望看到：`cordis.patch.yml` + `lib/plugin.js` + `lib/host.js` + `lib/client.js`
（`files` 字段只放行 `lib` 与 `cordis.patch.yml`，所以源码与测试**不会**被打进包）。
