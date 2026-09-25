# Sophia 前身清理方案（`@sophia/core` + `Sophia-agent-entities`）

> 主人原话：「这个是，就是我让你做的这个插件的前身，然后做烂了，然后我就让你重这个要删掉的，把它东西都清」

## ⚠️ 重要警告

**⚠️ 此操作非常危险，可能导致不可逆的数据丢失！**

**在主人逐项确认之前，索菲亚不会删除、移动或重命名任何文件。** 本文件只是清单与方案。

---

## 一、为什么这次清理相对安全

| 事实 | 证据 |
|---|---|
| 仓库**已完整推送到 GitHub** | HEAD `b5a8a28` == `origin/main` `b5a8a28`（两者 SHA 完全相同） |
| 远端地址 | `https://github.com/AEmbers/Sophia-agent-entities.git` |
| 未推送的本地内容 | 仅 1 个**未跟踪**文件 `docs/__t7_negcontrol__.md`（需单独备份） |
| 前身插件挂载面很小 | 只 2 行：`@sophia/core/host`（只读自检路由 `/api/sophia/status` + 一条提示词公告）+ `@sophia/core`（裸名行，兼作浏览器半发现锚点与领域库入口） |

结论：**源码层面可以从 GitHub 完整恢复**；真正不可恢复的是下面 §二-C 里的运行时状态与工作区。

---

## 二、待清理清单（逐项，含体积与风险）

### A. DSH 环境里的引用（3 处，必须先处理）

| 路径 | 内容 |
|---|---|
| `~/.dsh/profiles/desktop/package.json` 第 12 行 | `"@sophia/core": "link:C:/Users/Administrator/Sophia-agent-entities/packages/sophia-core"`（dependencies） |
| `~/.dsh/profiles/desktop/package.json` 第 53 行 | `"@sophia/core"`（`dsh.profile.bundles` 启用清单） |
| `~/.dsh/profiles/desktop/node_modules/@sophia/core` | 指向上述目录的符号链接 |

**⚠️ 顺序不能反**：必须**先**从 profile 摘掉这两行、删掉符号链接，**再**删仓库目录。
否则 DSH Desktop 下次启动会去找一个不存在的包，可能影响启动。

### B. 仓库本体 `C:/Users/Administrator/Sophia-agent-entities`（总计 **346 MB**）

| 子项 | 体积 | 是什么 | 索菲亚的建议 |
|---|---|---|---|
| `.git` | 132 M | 完整历史（含 5 个远端分支：origin/main、up-team/master、up-teams/main 等） | 可删（GitHub 上有） |
| `node_modules` | 76 M | 依赖，随时可重建 | 可删 |
| `成员素材.zip.001` ~ `.005` | **88 M**（5 卷） | 成员素材分卷压缩包 | ⚠️ **需主人拍板**，见 §四-1 |
| `assets` | 20 M | 素材目录 | ⚠️ 需确认是否已在 Git 里（见 §四-1） |
| `dsh-agent-teams` | 14 M | 上游 `NanmiCoder/dsh-agent-teams` 的副本 | 可删（工作区 `../dsh-agent-teams` 是活的） |
| `dsh-agent-team` | 8.1 M | 上游 `wowyuarm/dsh-agent-team` 的副本 | 可删（工作区 `../dsh-agent-team` 是活的） |
| `packages/sophia-core` | 7.3 M / 304 文件 | 前身插件源码（**已构建**，`lib/` 完整） | 可删（已推 GitHub） |
| `docs` | 2.8 M | 前身文档（含状态图、架构书） | 可删（已推 GitHub） |
| `scripts` | 112 K | 脚本 | 可删 |
| 其它 | — | `README.md`、`分卷合并说明.md`、`.github/`、`pnpm-lock.yaml` 等 | 建议随仓库一起处理 |

### C. `~/.dsh` 下的运行时残留（**这部分最不可恢复**）

| 路径 | 体积 | 内容 | 索菲亚的建议 |
|---|---|---|---|
| `~/.dsh/sophia/` | 3.1 M | `ledger.sqlite`（250 KB，**今天 13:59 还在写入**）+ `members/`（5 个成员会话目录，时间戳 12:04–13:52） | 可删（前身插件的运行时状态） |
| `~/.dsh/sophia-work/` | **未测完**（63 个顶层子目录 / 122 个顶层文件 / 含 3 处嵌套 `node_modules`） | 前身开发期的**实验工作区**：研究报告（`IMPL-REPORT.md` 80 KB、`MASTER-MESSAGES-1to1.md` 147 KB、`FLOW-SOPHIA-V14.md` 41 KB、`COEXIST-REPORT.md`…）、多版本试验目录（`ac-*`、`v25r`/`v34`/`v37`/`v39`/`v42`、`verify*`）、离线安装探针、`tgz/` | ⚠️ **需主人拍板**，见 §四-2 |
| `~/.dsh/settings.yaml.bak-before-sophialin-20260918-231856` | 21 KB | 配置备份 | 建议**保留**（极小且有历史价值） |
| `~/.dsh/settings.yaml.bak-sophia-before-revert` | 20 KB | 配置备份 | 建议**保留** |

> 注：`~/.dsh/sophia-work` 的完整体积测量**超时 9 分钟未完成**（嵌套 `node_modules` 太多），
> 所以本表不给它的总体积数字，避免编造。

---

## 三、建议的执行顺序（分三步，每步都可单独叫停）

### 第 1 步 · 停用前身插件（可逆）

1. 从 `~/.dsh/profiles/desktop/package.json` 的 `dsh.profile.bundles` 摘掉 `"@sophia/core"`
2. 从同文件 `dependencies` 摘掉 `"@sophia/core": "link:..."` 那一行
3. 删掉符号链接 `~/.dsh/profiles/desktop/node_modules/@sophia/core`
4. **重启 DSH Desktop 确认启动正常**（这一步过了才继续）

回滚：把两行加回去、重建链接即可。

### 第 2 步 · 备份小件（非破坏性）

- 复制出未跟踪文件 `Sophia-agent-entities/docs/__t7_negcontrol__.md`
- 若 §四-2 决定保留 `sophia-work` 的报告，把其中的 `*.md` / `*.json` 打包到一个安全位置
- 记录当前 HEAD `b5a8a28`（回滚靠它）

### 第 3 步 · 删除（**需再次确认**）

- **先改名而非直接删**：`Sophia-agent-entities` → `Sophia-agent-entities.trash-20260925`，
  观察几天无碍后再真正删除（这样成本极低，收益是可后悔）
- `~/.dsh/sophia/`、`~/.dsh/sophia-work/` 同理

---

## 四、需要主人拍板的 3 个问题

**1. `成员素材.zip.001-005`（88 MB）与 `assets/`（20 MB）要留吗？**
这是主人之前「拆分成员素材 / 制作团队成员素材包」的产物。
若已推 GitHub 且在 `assets/` 里，删了也能取回；若不在，就是**唯一副本**。

**2. `~/.dsh/sophia-work/` 的 11 MB 研究报告要留吗？**
里面是前身开发期的完整过程记录（流程设计、集成报告、事故复盘、多版本试验）。
索菲亚倾向**留**——这些是"为什么重做"的证据链，且体积不大。

**3. 仓库本地是否直接全删，还是留一个归档副本？**
索菲亚建议第 3 步用「改名留观」而不是立即删除。

---

## 五、回滚方法

| 对象 | 回滚方式 |
|---|---|
| 仓库源码 | `git clone https://github.com/AEmbers/Sophia-agent-entities.git`（回到 `b5a8a28`） |
| profile 引用 | 把 §二-A 的两行加回 `~/.dsh/profiles/desktop/package.json`，重建符号链接 |
| 运行时状态 | ⚠️ **不可恢复**（`ledger.sqlite` 与 `members/` 没有远端备份） |
| 工作区 | ⚠️ **不可恢复**（`sophia-work/` 未纳入任何 Git） |

---

*本方案由索菲亚在 2026-09-25 生成，所有体积与路径均为实测值。*
*配套报告：`docs/host-upgrade-compat.md`（插件兼容性梳理）。*
