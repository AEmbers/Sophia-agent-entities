# 编译官方 DSH 桌面版（Windows x64）

> 目标：从官方仓库源码编译出可安装的 `DeepSeek Harness` 桌面版安装程序。
> 首次成功：**2026-09-25**，产物 `deepseek-harness-0.1.7-rc.2-win-x64-unsigned.exe`（274 MB）。

## 0. 前置事实（省时间）

| 事实 | 说明 |
|---|---|
| 桌面版在 `apps/desktop/` | Electron 应用（electron 44.0.0 + electron-builder 26.15.3） |
| **master 与 `dsh-v0.1.7-rc.2` 当时同一提交** | 2026-09-25 实测两者 HEAD 都是 `477b4f42`，master 的根 `package.json` 版本号也是 `0.1.7-rc.2`。所以本地那份 harness 检出**可以直接用来编桌面版**，不用另外克隆 |
| 构建机需要 | Node（满足 `^22.19.0 \|\| >=24`）、pnpm 11.7.0、Python、Visual Studio（原生模块）、网络 |

## 1. 编译应用本体

```bash
cd <repo>/deepseek-harness
pnpm run build:desktop            # = tsc -b + tsdown + vite（渲染 welcome 页）
```

产物落在 `apps/desktop/lib/`：`main.js`（约 463 KB）+ 5 个 `preload-*.cjs` + `welcome/`。

## 2. 打包安装程序（未签名）

```bash
cd <repo>/deepseek-harness
CODEBUDDY_SAFE_DELETE_ENABLED=0 \
TAR_OPTIONS="--force-local" \
ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/" \
ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/" \
pnpm run package:desktop:win:x64:unsigned
```

产物：`apps/desktop/.desktop-build/targets/win-x64/unsigned-artifacts/`
- `deepseek-harness-<version>-win-x64-unsigned.exe`（NSIS 安装程序）
- `*.exe.blockmap`
- `win-unpacked/`（免安装版，可直接跑 `DeepSeek Harness.exe`）

## 3. 四个必须知道的坑

### 坑 1 · 必须自己写 `apps/desktop/.env.windows`

模板是 `.env.windows.example`。**未签名构建会在校验时提前返回**，但
`resolveDesktopPolicyEnvironment()` 是**无条件调用**的，所以"强制更新策略服务源"仍必填：

```dotenv
DSH_DESKTOP_APP_ID=com.deepseek.harness
DSH_DESKTOP_AUTO_UPDATE_ENV=production
DSH_DESKTOP_MANDATORY_UPDATE_PROD_ORIGIN=https://policy.dsh.invalid
```

- 选 `production` 而不是 `test`：`test` 会要求 `allowedAuthOrigins`，且客户端会**要求飞书登录**才肯检查更新要求。
- 策略源**故意用 `https://policy.dsh.invalid`**（RFC 2606 保留域名，永不解析）。
  理由：`src/mandatory-update-policy.ts` 里策略状态只在**服务端明确下发**时才升级为 `blocking`，
  传输/解析失败一律保持 `blocking: false`。填真域名反而有被下发"必须更新"阻断决策的风险。
- 该文件被 git 忽略，且不会被打进产物。

### 坑 2 · `prepare:runtime` 会重新下载 electron zip，直连 GitHub 常失败

症状：`TypeError: fetch failed` / `read ECONNRESET`，事件里是 `download:electron`。

解法（**不必知道缓存键算法**，同名搬运即命中）：

```bash
mkdir -p apps/desktop/.desktop-build/downloads
cp -r "$LOCALAPPDATA/electron/Cache/." apps/desktop/.desktop-build/downloads/
```

`BUILD_PATHS.downloads` = `<repo>/apps/desktop/.desktop-build/downloads`，
缓存布局是 `<cacheRoot>/<哈希>/<文件名>`，与 `%LOCALAPPDATA%\electron\Cache` 同构。
若本地还没有那个 zip，先跑一次
`node apps/desktop/node_modules/electron/install.js` 把它下下来。

### 坑 3 · `TAR_OPTIONS=--force-local`（Windows 必加）

症状：

```
tar (child): Cannot connect to C: resolve failed
tar: Error is not recoverable: exiting now
```

原因：PATH 上的 `tar` 是 **GNU tar**（MSYS 的 `/usr/bin/tar`），它把 `C:\...` 的 `C:`
当成 **rsh 远程主机名**。官方脚本传的是 Windows 绝对路径，于是必炸。

解法：给 GNU tar 加 `--force-local`（通过 `TAR_OPTIONS` 环境变量传，不必改上游代码）：

```bash
TAR_OPTIONS="--force-local" pnpm run package:desktop:win:x64:unsigned
```

（系统自带的 `C:\Windows\System32\tar.exe` 是 bsdtar，没有这个问题，但换 PATH 会连带影响别的命令，不如用 `TAR_OPTIONS`。）

### 坑 4 · 构建目录太深 → **打包后冒烟测试**会误报失败

症状（在安装程序已经生成之后才发生）：

```
ImportError: DLL load failed while importing _elementpath: 文件名或扩展名太长
```

原因：`BUILD_ROOT` 硬编码为 `apps/desktop/.desktop-build`（**无环境变量可改**）。
若仓库放在很深的路径下，打包产物里的 Python 路径会顶到 Windows MAX_PATH 限制，
`lxml` 的扩展模块加载失败。

**这不代表产物有问题**——已实测证明：

| 同一份文件 | `from lxml import etree` |
|---|---|
| 原长路径（248 字符） | ❌ `文件名或扩展名太长` |
| `subst X: <artifacts>` 短路径（118 字符） | ✅ 正常 |

安装到 `C:\Program Files\DeepSeek Harness\` 后路径大幅变短，功能正常。
**想要一次全绿**，把仓库放到短根目录（如 `C:\dsh\`）再打一次。

> 另外 `prepare:runtime` 阶段本身已经输出过
> `Office runtime versions and document round trips passed.`，
> 说明 Office 往返能力在正常路径下是通的。

## 4. 安装注意事项

- 这是 **未签名** 构建，Windows SmartScreen 会提示「未知发布者」——选「仍要运行」。
- `appId` 用的是官方 `com.deepseek.harness`，所以它会**就地升级**已有的 DeepSeek Harness，
  不会并排装第二份。
- 版本是 **0.1.7-rc.2**：从 0.1.5 升上来会**断开 0.1.5 时代编译的插件**
  （详见 `docs/host-upgrade-compat.md`）。装之前先看那份报告。
