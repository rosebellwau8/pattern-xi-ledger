# 上线记录（LAUNCH）

本文件是 2026-09-02 上线动作的存档：做了什么、实测结果如何、为什么这么配置。
将来对账本运行记录有疑问时，以本文件、公开 PR/Actions 事件和已锚定 manifest 共同复核；
普通 Git commit 时间不作为服务器时间见证。

## 地址

- 公开仓库：<https://github.com/rosebellwau8/pattern-xi-ledger>
- 公开账本站点（GitHub Pages）：<https://rosebellwau8.github.io/pattern-xi-ledger/>

## 上线时间线（2026-09-02，时间取自 GitHub 实测，UTC）

| 时间 | 事件 |
|---|---|
| 07:34 | 创建公开仓库并推送 `main`（提交 `df93957` + `9711a19`），Check 首跑通过 |
| 07:36 | Deploy site 首次部署成功，Pages 站点上线 |
| 07:48 | Anchor manifest 锚定演练**首次运行失败**：当天无推介时清单脚本未正确跳过 |
| 07:51 | 提交 `c953c19`（fix: skip stamping when daily manifest is empty）修复空清单跳过逻辑，Check + Deploy site 通过 |
| 07:52 | Anchor manifest 二次演练**成功**：正确跳过清单生成，公开 `anchors` 分支创建完成 |

如实记录：锚定链路经历过一次真实的"失败 → 修复 → 验证"，修复本身在 Git 历史可见（`c953c19`）。

## main 分支保护（2026-09-02 定稿配置，经 GitHub API 实测核对）

| 配置项 | 值 | 这意味着什么 |
|---|---|---|
| 必须通过 PR | ✅ 开启 | 任何变更（包括文档）都不能直接 push 到 `main`，必须开 PR |
| 必需人工批准数 | **0** | 单人维护：PR 评审由运营者自己把关；机器检查仍然全量强制（见下行） |
| 必需状态检查 | `Ledger integrity`（严格模式） | 最终 PR head SHA 必须通过全量测试、服务器事件时间两小时门控、追加式校验和派生一致性检查 |
| 管理员同样受保护 | ✅ 开启 | 当前配置下 owner 也受 PR 流程约束；owner 理论上仍控制仓库配置 |
| 强制推送（force push） | ❌ 禁止 | 当前规则禁止重写 `main`；这提高成本和可见性，但不等同密码学不可篡改 |
| 删除分支 | ❌ 禁止 | `main` 不能被删除 |

## CI 验证结果

- **测试**：上线时 14 项全部通过；后续已扩展至覆盖 52 用例黄金结算数据集、生产导入/发布、完整状态 manifest 和站点回归。
- **工作流**：Check（PR/push 完整性）、Deploy site（Pages 部署）、Anchor manifest（每日锚定）最终全绿。
- **anchors 分支**：已创建并推送成功。当前工作流每日 00:15 UTC 对 `origin/main` 的完整 pick ledger state 生成 manifest 并执行 OpenTimestamps；每份快照含 main SHA、全部 pick 哈希和前序 manifest 哈希。
- **追加式校验**：已公布的 `picks/` 与 `results/` JSON 一旦合并，任何修改、删除、重命名都会被 CI 拒绝（提交 `9711a19` 引入 `scripts/validate-pr.mjs`）。
- **Pages 实测**：`/`、`/track-record.html`、`/verification.html` 三页均返回 HTTP 200。

## 历史运行记录

- 截至记录时，首个提交 `df93957` 未经历已知的 rebase 或 force push。这是公开运行记录，
  不是 GitHub 历史在密码学上绝对不可改的声明。
- 上线时本地与远端完全同步，工作区干净；账本从第一个 commit 起即为干净历史。

## 日常运营流程（单人模式）

1. **发推介**：生产端导出 JSON → `npm run publish -- export.json` → 脚本自动建分支、导入、
   校验、推送和开公开 PR。精确 PR head SHA 首次成功的 `Ledger integrity.startedAt` 定义
   publication time，必须距 kickoff ≥2 小时。通过后自动 merge（approval=0）只是将同一版本正式入账。
2. **记结果（终场后）**：写 `results/YYYY/<id>.json`（只录比分/状态等事实）→
   `npm run validate && npm run settle && npm run standings` →
   派生的 `settlements/`、`standings/` 变更随同一个 PR 提交，评审时在 diff 里直接看到程序算出的结论。
3. **修正错误**：新增 `<id>.rN.json` 并在 `corrects` 字段填被修正文件的 SHA-256，绝不改动旧文件。

## 单人模式的取舍与将来收紧点

- **approval=0 是单人的现实取舍**：GitHub 规则不允许 PR 作者批准自己的 PR，
  因此在只有一位维护者的情况下无法启用"1 人批准"。当前人工评审由运营者自审 PR diff；
  机器强制（两小时门控、追加式、必需检查、管理员受保护、禁强推）不受影响。
- **将来若有第二位协作者**：应将必需批准数改为 1（Settings → Branches → main →
  Require 1 approval），恢复 README「上线操作清单」原建议的互相评审强度。
- **试运行 → 正式期**：站点当前展示 SHADOW RUN 试运行横幅；正式期开始只需一次声明
  commit（见 DESIGN.md），90 天公开验证时钟自该声明起算。

## 当前证据模型

本项目采用 **Three-layer evidence model**：公开 PR + GitHub-hosted Actions 对精确 SHA 的
服务器事件是第一层 publication witness；完整 ledger-state manifest + OpenTimestamps/Bitcoin
是第二层独立密码学时间戳；追加式修正链与确定性重建是第三层 provenance。

Published history is designed to make retrospective alteration detectable. Bitcoin-anchored manifests
provide an independent cryptographic record of previously published ledger states. 静态架构 greatly
reduced the operational attack surface，但仍依赖 GitHub account、Actions、Pages 和 OpenTimestamps。

## 架构冻结记录（2026-09-02，UTC）

三层证据模型实现合并并完成冻结前验收后，**架构冻结**：不再新增功能，进入正式 90 天
公开验证的准备阶段；正式窗口自未来的声明 commit 起算（见 DESIGN.md）。

冻结前验收证据（均为公开可复核的 GitHub 实测）：

| 项目 | 证据 |
|---|---|
| 实现合并 | [PR #4](https://github.com/rosebellwau8/pattern-xi-ledger/pull/4)（merge commit `bd63909`），`Ledger integrity` 在精确 head SHA 上通过 |
| 真实发布见证 | [Check run 33628156164](https://github.com/rosebellwau8/pattern-xi-ledger/actions/runs/33628156164/job/100240744760)：head `b13803a45c35e` 的 `Ledger integrity` job 服务器侧 `startedAt` = `2026-09-02T12:06:55Z`，仓库可见性、run head SHA、job 时间均经 API 核对 |
| 锚定演练 | [Anchor manifest run 33628289788](https://github.com/rosebellwau8/pattern-xi-ledger/actions/runs/33628289788)：`anchors` 分支生成首份 v2 完整快照 `manifests/2026-09-02.txt`（`main_commit_sha bd63909de1e5`、`previous_manifest_sha256 NONE`、`pick_count 0`），`.ots` 回执已生成；比特币确认按 OpenTimestamps 设计为异步，由周度 `ots upgrade` 补全 |
| 本地验证 | 33 项测试、typecheck、`validate`、派生文件确定性重建（no-op）、站点确定性构建全部通过；过强表述清扫无残留 |
| 分支保护复核 | 经 GitHub API 实测：必需检查 `Ledger integrity`（严格模式）、管理员同样受保护、禁 force push、禁删除、PR + 0 批准，与上表定稿一致 |
| 站点部署 | Pages 部署 `bd63909` 成功，<https://rosebellwau8.github.io/pattern-xi-ledger/> 实测返回英文三层模型内容，HTTPS 强制 |
