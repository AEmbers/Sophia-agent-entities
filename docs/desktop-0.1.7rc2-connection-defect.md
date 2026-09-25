# 桌面版 0.1.7-rc.2 本地连接故障诊断记录

> 诊断时间：2026-09-25 19:0x–19:3x
> 对象：官方桌面版 `@deepseek-ai/dsh-desktop 0.1.7-rc.2`（本机自行编译打包的未签名安装包）
> 现象：点「登录」后界面永远转圈显示「正在打开登录…」，且主窗口停在「重新连接中…」

---

## 一、结论先行

**登录转圈不是账号问题、不是网络问题、不是 WAF 拦截、也不是插件问题。**

真正的原因是：**桌面壳（Electron 主进程 + 渲染进程）无法与它自己启动的本地宿主建立 WebSocket 通道**。

- 主窗口渲染进程反复报：`WebSocket connection to 'ws://127.0.0.1:19387/api/remote.mux' failed`，界面永久停在「重新连接中…」。
- 欢迎页的**登录状态推送走的是同一个 mux 通道**（`account/watch`），通道不通 → 阶段永远停在 `initializing` → 界面就一直转圈，**且不会报错**（因为服务端的确在正常推进或本来就只是等待）。
- 宿主本身是健康的：带令牌 Cookie 走 HTTP RPC 直接返回 `200`：

  ```json
  {"status":"signed-out","attempt":null,"links":{...}}
  ```

---

## 二、被排除的原因（逐条实证）

| 假设 | 验证方式 | 结果 |
|---|---|---|
| 登录服务器被墙 / 不可达 | Node 原生 `fetch` 复刻应用请求（同样的 header 与 body） | ✅ **HTTP 200，280 ms**，正常返回 `authorize_url` |
| WAF 拦截 | curl 复刻；对比带/不带浏览器 UA | 带 `curl` UA → 429 Request Blocked；**Node 默认 UA（`node`）→ 200**。应用走的是 Node fetch，不受影响 |
| 账号本身有问题 | 直接向宿主查 `account/getState` | `signed-out`，即"从未登录成功过"，没有异常状态 |
| 插件冲突 | 用户已禁用两个 pending 插件；重启后 boot 报错消失 | 登录问题**完全不变** → 与插件无关 |
| 宿主进程没起来 | `netstat` + 直接 RPC | 宿主在 `127.0.0.1:19387` 正常监听，HTTP 接口可用 |
| Cookie 没拿到 | 用启动令牌换 Cookie | 正常拿到 `dsh-auth-<hash>=v1.<payload>.<sig>`；带上它 RPC 就通过 |

---

## 三、故障点定位

### 3.1 宿主对本机 WebSocket 的行为

| 测试 | 结果 |
|---|---|
| `GET /api/remote.mux`（无 Cookie，普通 GET） | `401 Unauthorized` |
| `POST /api/account/getState`（无 Cookie） | `403 forbidden` |
| `POST /api/account/getState`（带 Cookie） | ✅ `200` + 正常 JSON |
| **WebSocket 升级握手**（带/不带 Cookie、浏览器同源、裸 TCP、任何 Origin） | ❌ **服务端直接断开，一个字节都不回** |

最后一行是关键：Node 的 HTTP server 若**没有注册 `upgrade` 监听器**，收到升级请求时会把连接直接销毁（无响应）——这正是 `/api/remote.mux` 的表现。

### 3.2 桌面壳侧的接缝（`apps/desktop/src/main.ts`）

```js
session.defaultSession.webRequest.onBeforeSendHeaders({ urls: ['ws://127.0.0.1/*'] }, (details, callback) => {
  if (hostUrl === undefined || hostCookie === undefined || details.webContentsId !== mainWindow?.webContents.id) {
    callback({})          // ← 不满足条件就放行，等于"不带凭据"
    return
  }
  const headers = ...
  if (headers.origin !== 'dsh-app://app') { callback({ cancel: true }); return }   // ← 不满足就取消
  callback({ requestHeaders: { ...headers, origin: target.origin, cookie: hostCookie, 'sec-fetch-site': 'same-origin' } })
})
```

这条注入规则存在两处结构性问题：

1. **只对主窗口生效**（`details.webContentsId !== mainWindow?.webContents.id` 直接放行）。欢迎页是**另一个 BrowserWindow**，天然拿不到注入。
2. **渲染进程的 WebSocket 请求里并没有出现 `cookie`**（已用 CDP `Network.webSocketWillSendHandshakeRequest` 抓到完整握手头，见附录），说明凭据注入在这条链路上没有真正落地。

而宿主签发的 Cookie 是 `SameSite=Lax`：

```
set-cookie: dsh-auth-...=v1...; Path=/; HttpOnly; SameSite=Lax
```

页面跑在自定义协议 `dsh-app://app` 上，对 `http://127.0.0.1:19387` 而言是**跨站**，因此浏览器**不会**在 WebSocket 握手里带上 Lax Cookie——必须依赖上面那条注入，而它没生效。

### 3.3 补充证据

- 已用 CDP `Network.setCookie` 手动把该 Cookie（`SameSite=None; Secure`）写进 Electron 会话，**握手依然失败**。
- 已用 `agent-browser` 从**同源** `http://127.0.0.1:19387/` 发起 WS，**握手依然失败**。
- 两种情况都**收不到任何 HTTP 响应**，与 3.1 的"服务端直接断开"一致。

因此故障点在**宿主未对外提供可用的 mux 升级端点**（或该端点的前置条件在本机不成立），而不是单纯缺 Cookie。

---

## 四、影响

- 桌面壳在本机**不可用**：主窗口无法加载会话（「重新连接中…」），欢迎页登录无法完成。
- 与本项目（`dsh-sophia-entities`）无关：我们的插件在同 profile 下**未被加载**（bundles 已被"禁用第三方插件"清空为 `dsh-base + dsh-web-app`），也未参与该故障。
- 用户原有环境（CLI/web 0.1.5 那套）不受影响，仍可正常工作。

---

## 五、可选处置方案

| 方案 | 说明 | 代价 |
|---|---|---|
| **A. 回滚桌面版** | 更新器缓存里有上一版安装包：`%LOCALAPPDATA%\dsh-plugin-desktop-updater\installer.exe`（149 MB，2026-09-20，产品名 `DSH Desktop` 2.0.13）。用户原有的插件补丁也在 `profiles/desktop/cordis.patch.yml.bak-1790334484431`（8082 字节）可还原 | 需重装 + 还原补丁 |
| **B. 暂时改用 CLI/web** | `dsh --profile desktop`（0.1.5）那一套本来就是好的 | 用不到新桌面壳 |
| **C. 修壳后重编** | 已有完整构建配方（`docs/build-official-desktop.md`）。需要先确定 mux 端点的真实前置条件，再决定改壳还是改宿主 | 需要进一步定位 + 一次重打包 |
| **D. 等官方修复** | 当前是 rc 版本，属于上游问题 | 时间不可控 |

> 建议：先用 **A 或 B** 恢复可用环境（立刻见效），同时把本记录作为上游问题反馈材料。

---

## 六、复现用探针脚本（本次产出的取证工具）

均放在工作区 `.workbuddy/tmp/`：

| 脚本 | 用途 |
|---|---|
| `cdp-probe.mjs` / `cdp-click.mjs` | 通过 `--remote-debugging-port` 驱动界面并读状态机（需带调试端口启动应用） |
| `cdp-ws.mjs` | 抓 WebSocket 握手的**完整请求头与响应**，定位"请求发出去了但没响应" |
| `cdp-cookie.mjs` | 向 Electron 会话注入 Cookie 后重载，验证是否恢复 |
| `ws-raw.mjs` | 脱离浏览器，用裸 TCP 发握手，看服务端到底回什么 |

启动带调试端口的应用（**注意必须先清掉 `ELECTRON_RUN_AS_NODE`，否则 Electron 会按 Node 模式解析参数而报 `bad option`**）：

```bash
cd "$HOME/AppData/Local/Programs/DeepSeek Harness"
env -u ELECTRON_RUN_AS_NODE "./DeepSeek Harness.exe" --remote-debugging-port=9222
```

---

## 附：渲染进程 WebSocket 握手的实测头（CDP 抓取）

```
GET ws://127.0.0.1:19387/api/remote.mux
upgrade: websocket
origin: http://127.0.0.1:19387          ← 已被壳改写过
sec-fetch-site: same-origin
sec-websocket-key: Id7GPblv6AGsrIEbNd8pdg==
sec-websocket-version: 13
user-agent: ... @deepseek-ai/dsh-desktop/0.1.7-rc.2 Chrome/152.0.7977.54 Electron/44.0.0 ...
                                            ← 注意：没有 cookie 头
```

随后事件序列恒为：`WS created` → `WS frame error`（空消息）→ `WS closed`，**从未出现 `WS handshake response`**。

*本记录所有结论均有对应命令与输出，脚本可重跑。*
