# DESIGN — Three-layer evidence model

**日期：** 2026-09-02  
**状态：** 冻结候选；原 Pattern XI 平台保留为搁置档案（`E:\PatternXI`）

## 1. 目标与边界

Pattern XI Ledger 要回答一个窄问题：某个最终 pick 内容是否在开球前至少两小时公开，并且之后的正式记录是否容易复核和发现异常改动。

它不证明运营者录入的比分或赔率本身来自哪个第三方页面。比分与赔率继续由运营者按现有 schema 和工作流录入。本轮不引入数据库、后台、Relay、赔率快照、比分证据服务、第三方 API、消息渠道或签名体系。

## 2. Three-layer evidence model

### 2.1 Public publication witness

推介先出现在公开 GitHub PR。`Ledger integrity` 只对该 PR 的精确 head SHA 运行；workflow 显式 checkout 该 SHA，并核对 GitHub Actions run 的 `head_sha`。publication time 定义为该精确 SHA 首次成功检查之 job attempt 的 GitHub 服务器侧 `startedAt`，门控脚本以这个事件时间检查 `kickoff_utc - startedAt >= 2h`。

pick 后续发生任何字节变化都会产生新 SHA，并触发新检查。最终 merge 的具体版本必须就是曾通过检查的版本；merge 只执行正式入账，不承担首次 publication 的定义。普通 Git author/committer timestamp 可以本地设置、amend 或 rebase，只是 Git 元数据，不是 GitHub 服务器时间，也不参与前瞻发布证明。

### 2.2 Independent cryptographic timestamp

每日 manifest 是一个完整 ledger-state 快照，而不是“当天新增 pick”清单。每份 v2 manifest 包含：

- manifest version；
- snapshot date；
- 对应的 `main` commit SHA；
- 前一份 manifest 精确字节的 SHA-256；
- 该 `main` 状态中全部正式 pick 文件的路径与 SHA-256。

OpenTimestamps 将 manifest 锚定到 Bitcoin。它主要证明某个完整 ledger state 在 Bitcoin 时间锚之前已经存在，并为独立检测后续历史改动提供密码学记录。某天 cron 漏跑不会漏掉旧 pick，因为下一份 manifest 仍重新覆盖完整 pick ledger。OTS 不是每条 pick 的主要两小时发布证明；第一层公开 PR + Actions 才是。

### 2.3 Append-only correction provenance

CI 拒绝修改、删除或重命名已经发布的 pick/result 文件。修正只新增 `.rN.json`；`corrects` 必须引用上一版本精确字节的 SHA-256；链必须线性、无分叉、连续编号并实际改变事实。settlement 和 standings 由原始事实确定性重建，CI 检查派生文件没有漂移。

Published history is designed to make retrospective alteration detectable. Bitcoin-anchored manifests provide an independent cryptographic record of previously published ledger states.

## 3. 信任边界

| 需要说明的事实 | 机制 | 不作出的承诺 |
|---|---|---|
| 精确 pick 在开球前公开 | 公开 PR + 精确 head SHA + 成功 `Ledger integrity` job 的服务器侧 `startedAt` + 两小时门控 | 不使用 Git commit timestamp；不要求开球前 merge |
| 完整账本状态曾经存在 | 全量 pick manifest + main SHA + 前序 manifest SHA-256 + OpenTimestamps/Bitcoin | OTS 不替代逐条 pick 的两小时 PR 见证 |
| 修正过程可追踪 | append-only diff gate + `.rN.json` + `corrects` 精确字节哈希 | 不宣称仓库 owner 在理论上无法改变 GitHub 设置或历史 |
| 结算可复核 | 冻结引擎 + 52 用例黄金数据集 + deterministic rebuild | 不对运营者录入的比分或赔率做第三方核验 |

GitHub history、branch protection、公开 PR 和追加式 validation 显著提高事后改动的成本与可见性，但仓库 owner 理论上仍控制账户和仓库配置。独立于 GitHub history 的密码学证据来自已锚定的 manifest。系统没有数据库、动态后台或服务器私钥，因此 **greatly reduced the operational attack surface**；它仍依赖 GitHub account、Actions、Pages 与 OpenTimestamps。

## 4. 数据流

```text
production export
      │
      ▼
public PR: exact head SHA + pick bytes
      │
      ▼
GitHub-hosted Ledger integrity job
public repository + head_sha match + server-side startedAt + ≥2h
      │
      ▼
merge same checked version → formal main ledger → static Pages
      │
      ├── nightly full-state manifest(main SHA + all pick hashes + previous manifest hash)
      │                                      │
      │                                      ▼
      │                          OpenTimestamps → Bitcoin
      │
      └── operator-entered result facts → settle → standings → site build
```

## 5. 冻结的结算资产

| 资产 | 位置 | 约束 |
|---|---|---|
| Settlement Rules v1 engine | `src/settlement/` | 精确十进制、48/168 小时边界、半赢半输拆分 |
| 黄金数据集 | `fixtures/golden/settlement-v1.json` | 52 用例，SHA-256 基线前缀 `2a752573…b855` |
| Performance projection | `src/performance/` | N、ROI、累计收益、最大回撤可重建 |
| Ledger validation | `scripts/lib.mjs`、`scripts/validate-pr.mjs` | schema、两小时门控、追加式修正链 |

## 6. 架构冻结

完成真实 GitHub PR、required check、merge、manifest/OTS workflow、settlement、standings 与 Pages 部署验证后，本架构进入 90 天公开验证准备阶段。冻结期间不增加比分来源验证、赔率证据、动态服务、消息渠道或多运营者签名；发现 bug 时只做保持三层定义一致的必要修复。

原项目 `E:\PatternXI` 继续保持原样作为历史设计档案。本账本的公开事实与规则以本仓库为准。
