# 2026-09-25 DSH 环境清理记录

> 目的：把本机清成**纯净环境**，以便重装官方 DeepSeek Harness 桌面版后能正常登录。
> 原则：**先备份 → 再停用 → 再删除**；只保留主人指定要留的东西。

---

## 一、备份（先做，已完成）

落点：**`D:\dsh-backup-20260925`**（40 MB / 1167 个文件）

| 子目录 | 内容 |
|---|---|
| `credentials/` | `.credentials.yaml`（+`.bak`）、`.trae-auth.json`、**`.env`**、`.anonymous-user-id`、嵌套 `.dsh/` |
| `settings/` | `settings.yaml.imported`、`cordis.patch.yml`、`AGENTS.md`、15 份 `settings.yaml.bak-*`、**`.agent-presets/`（含主人的 `sophia` 预设）**、`skills/`（11 个） |
| `plugin-pool/` | `plugins/`（插件池 8 项） |
| `our-profile/` | `profiles/sophia-entities/`（我们插件的 profile 配置，不是插件源码） |
| `storages/` | 插件状态库（含 `agent_team.sqlite`） |
| `extra/` | 用量统计与账本、设备清单、皮肤、`task-board/`、`tunnel/`、`telemetry/`、`sentinel.jsonl` |
| `reference/` | 四个 profile 的启用清单 `*-package.json`（含 `desktop`，方便日后照原样恢复插件列表） |

**恢复方式**：直接把需要的文件拷回 `~/.dsh` 对应位置即可；`.agent-presets/` 放回 `~/.dsh/.agent-presets/`，profile 清单放回 `~/.dsh/profiles/<名字>/package.json`。

---

## 二、已删除

### C 盘
| 目标 | 体积 | 结果 |
|---|---|---|
| `AppData\Roaming\DSH Desktop\` | 387 MB | ✅ |
| `AppData\Local\dsh-plugin-desktop-updater\`（更新器缓存 + 上一版安装包） | 149 MB | ✅ |
| `AppData\Roaming\dsh-plugin-desktop\` | 5 KB | ✅ |
| `AppData\Roaming\npm\dsh`、`dsh.cmd`、`dsh.ps1` + 2 个 `.dshpurge.bak` | — | ✅ |
| `~/.dsh`（原 2.3 GB） | 2.3 GB | ✅ 129 项中 125 项删除，另加 `profiles/`、`skills/` 全清；**现仅剩 1.2 MB** |

`~/.dsh` 已清掉的大件：`attachments` 509M、`sessions` 426M、`profiles` 325M、`aa-server.tar`+`.gz`+`aa-base.tar.gz` ≈ 700M、`plugin-audit` 146M、`core-0.1.5-rc.1` 34M、`web-login` 32M、`remote` 22M、`skin-center` 15M、`agy-accounts` 24M 等。

### D 盘
`/d/dshmut`、`/d/dshprobe3`、`/d/dshprobe4`、`/d/dshprobe5`、`/d/project/dsh-pluging`、`/d/agy-cf-proxy/restart-harness.cmd` —— 全部 ✅

### 工作区（5.5 GB）
| 目标 | 体积 | 结果 |
|---|---|---|
| `deepseek-harness/`（构建我们插件用的官方源码检出） | **5.5 GB** | ✅ |
| `dsh-agent-team/` | 19 MB | ✅ |
| `dsh-agent-teams/` | 35 MB | ✅ |

工作区现在只剩：**`dsh-sophia-entities/`（我们的插件，保留）+ `_archive-predecessor-20260925/`（前身归档）**

---

## 三、明确保留（未触碰）

| 目标 | 原因 |
|---|---|
| `dsh-sophia-entities/` | 主人指定保留的插件本体（源码 + 已构建的 `lib/` 产物都在） |
| `_archive-predecessor-20260925/` | 前身仓库的 git bundle，是旧历史的唯一副本（主人未明确，故按"留"处理） |
| `~/.dsh/sophia-work/`（1.1 MB） | **不是 DSH**：是游戏私服的保活脚本目录，且 Windows 计划任务 `SophiaUnifiedSupervisor` 依赖它 |
| `D:\sophia(world)模型项目`（29 GB）、`D:\sophia-backup`、`D:\sophia-rollback` | 主人的游戏/模型项目，与 DSH 无关 |
| `~/.workbuddy/skills/dsh-plugin-host-compat` | 我们自己沉淀的技能，不是 DSH 安装物 |

---

## 四、清理中挖出的关键原因（解释"登录为什么转圈"）

**`~/.dsh/.env` 里配置了全局代理**：

```
HTTPS_PROXY=http://127.0.0.1:10810
HTTP_PROXY=http://127.0.0.1:10810
NO_PROXY=localhost,127.0.0.1,::1,.linopt.pro
```

DSH 主机在启动时读取 `~/.dsh/.env`，其 HTTP 栈会走这个代理。登录请求打往 `platform.deepseek.com` 时若该代理不可用/不稳定，`auth_init` 就会一直挂着——界面表现正是"**一直转圈、且不报错**"。

佐证有两条：
1. **主人自己写的 `restart-harness.cmd`（已删）里就写着**："Harness reads `~/.dsh/.env` ONLY at startup. This restart makes HTTPS_PROXY=… take effect for the plugin HTTP stack (**that is what broke the sign-in**)."
2. 索菲亚用**全新的空 `DSH_HOME`** 启动同一个桌面版（没有这份 `.env`）时，登录状态机**正常推进**（`initializing` → `waiting-browser`，出现"复制登录链接"）。而用主人的 home 时卡在 `initializing`。

⇒ 所以"登录转圈"是**主人这套历史配置造成的**，不是上游缺陷。索菲亚早前给出的"上游问题"结论是错的，特此更正。

---

## 五、重装官方版时的注意事项

1. **不要立刻恢复 `.env` 里的代理**。先让官方版在无代理环境下登录成功；确需代理时再单独加，并且只给真正需要的域名。
2. 首次启动会**自动重建 `~/.dsh`**（profiles/sessions/storages 等），这是正常的。
3. 插件**先别急着装回去**。要恢复时，照 `D:\dsh-backup-20260925\reference\desktop-package.json` 的清单**逐个**加，每加一个重启验证一次——之前那次 `@dsh-external/dsh-sentinel`（等 `betterSidebar`）与 `dsh-workbuddy-xdpool`（等 `settingsScope`）就是让整棵树无法就绪的元凶。
4. 我们自己的插件 `dsh-sophia-entities` 若要**重新构建**，需要先重新获取构建工具链（`deepseek-harness` 已随本次清理删除）——步骤见 `docs/build-official-desktop.md`。

---

## 六、回收站说明

删除通过平台提供的回收站机制（`genie-trash`）完成；对超大目录它会 **fail-closed 整体拒绝**（不会半删）。已改按条目光删，最终仍有三类因机制问题**未能进回收站**：

| 项 | 体积 | 说明 |
|---|---|---|
| `~/.dsh/storages/`（3 个 sqlite） | 108 KB | 已备份到 D 盘 |
| `%APPDATA%\npm\node_modules\@deepseek-ai` | 267 MB | 全局 dsh CLI，可随时 `npm i -g` 装回 |
| `%LOCALAPPDATA%\Temp\dsh-*` 等 | 1572 个目录（几乎全为 0 字节） | 旧测试残留 |

这三类需要**永久删除（不进回收站）**才能清掉，索菲亚在动手前会单独征求主人同意。

*记录生成于 2026-09-25，所有体积均为实测值。*
