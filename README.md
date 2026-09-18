# Sophia-agent-entities

索菲亚的 agent 实体存放库。把上游两个独立仓库**以内容并入（git subtree）**的方式收进来，作为本仓库的两个子目录 —— 克隆一次即可拿到全部代码，无需额外 `submodule init`。

## 子目录

| 子目录 | 上游仓库 | 并入库的分支 | 并入时上游 commit |
|---|---|---|---|
| [`dsh-agent-team/`](./dsh-agent-team) | [wowyuarm/dsh-agent-team](https://github.com/wowyuarm/dsh-agent-team) | `master` | `ce61be1` |
| [`dsh-agent-teams/`](./dsh-agent-teams) | [NanmiCoder/dsh-agent-teams](https://github.com/NanmiCoder/dsh-agent-teams) | `main` | `87c95c9` |

并入时间：2026-09-18

## 为什么用 subtree 而不是 fork / submodule

- **不是 Fork**：Fork 是 GitHub 服务端的一个指针式副本，独立成一个仓库，不是"子目录"。
- **不用 submodule**：submodule 在父仓库里只存一个 commit 指针，别人克隆下来子目录是**空的**，还得再 `init` + 有上游访问权限。
- **用 subtree**：上游整棵树的内容真实落进本仓库，子目录在 clone 后立刻可用。代价是父仓库体积变大、同步时会产生合并提交。

## 同步上游更新

上游有新提交时，按下面步骤把更新拉进对应子目录。

### 一次性配置（首次同步前）

```bash
git remote add up-team  https://github.com/wowyuarm/dsh-agent-team.git
git remote add up-teams https://github.com/NanmiCoder/dsh-agent-teams.git
```

### 同步 dsh-agent-team

```bash
git fetch up-team master
git subtree pull --prefix=dsh-agent-team up-team/master --squash \
  -m "Sync wowyuarm/dsh-agent-team into dsh-agent-team/"
```

### 同步 dsh-agent-teams

```bash
git fetch up-teams main
git subtree pull --prefix=dsh-agent-teams up-teams/main --squash \
  -m "Sync NanmiCoder/dsh-agent-teams into dsh-agent-teams/"
```

> `--squash` 会把上游的一批提交压成一个，父仓库历史干净。去掉 `--squash` 则保留上游完整提交历史，但父仓库历史会变长、且首次同步后要一直保持同一模式，**不要中途切换**。

## 目录结构

```
Sophia-agent-entities/
├── dsh-agent-team/      # 上游 wowyuarm/dsh-agent-team
├── dsh-agent-teams/     # 上游 NanmiCoder/dsh-agent-teams
├── README.md
└── LICENSE
```

## 许可

两个子目录各自受其上游 `LICENSE` 约束，见 `dsh-agent-team/LICENSE` 与 `dsh-agent-teams/LICENSE`。
