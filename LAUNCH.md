# 上线记录（LAUNCH）

本文件是 2026-09-02 上线动作的存档：做了什么、实测结果如何、为什么这么配置。
将来对账本信任机制有疑问时，以本文件和 Git 历史为准。

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
| 必需状态检查 | `Ledger integrity`（严格模式） | 合并前 CI 必须通过且分支为最新：14 项测试、全量校验、PR 专属的开球前 ≥2 小时门控与追加式校验、派生文件一致性，全部不可绕过 |
| 管理员同样受保护 | ✅ 开启 | 账本所有者也无法绕过 PR 流程直接改 `main`，堵住"内部人直接改账"的路 |
| 强制推送（force push） | ❌ 禁止 | 不能重写 `main` 的历史，账本历史一经公布即不可篡改 |
| 删除分支 | ❌ 禁止 | `main` 不能被删除 |

## CI 验证结果

- **测试**：14 项全部通过（含 52 用例黄金结算数据集回归）。
- **工作流**：Check（PR/push 完整性）、Deploy site（Pages 部署）、Anchor manifest（每日锚定）最终全绿。
- **anchors 分支**：已创建并推送成功；每日 21:30 UTC（北京时间次日 05:30）自动运行 OpenTimestamps 锚定，回执写入该公开分支。
- **追加式校验**：已公布的 `picks/` 与 `results/` JSON 一旦合并，任何修改、删除、重命名都会被 CI 拒绝（提交 `9711a19` 引入 `scripts/validate-pr.mjs`）。
- **Pages 实测**：`/`、`/track-record.html`、`/verification.html` 三页均返回 HTTP 200。

## 历史完整性声明

- 首个提交 `df93957` 自上线起保持不变，未重写（rebase）或强推（force push）任何历史。
- 上线时本地与远端完全同步，工作区干净；账本从第一个 commit 起即为干净历史。

## 日常运营流程（单人模式）

1. **发推介（开球前 ≥2 小时）**：写 `picks/YYYY/<开球日期>-<队名slug>-ah.json` →
   `npm run validate` → 开分支与 PR → CI 强制两小时门控与追加式校验 →
   绿了自行合并（approval=0），即发布生效。
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
