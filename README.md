# Pattern XI 公开推介账本

一个公开、前瞻、可审计的足球亚盘推介记录账本。
没有数据库、没有后台、没有签名服务器——**Git 历史就是账本，第三方时间戳就是公证人**。

## 信任故事

每一条推介都要回答同一个怀疑：「你怎么证明结果是出来之前就发了？」本账本用三重独立锚定回答：

1. **Git commit（GitHub 服务器时间戳）**——推介在开球前至少 2 小时以 commit 形式公布，推送时刻由 GitHub 记录，本地无法回填；
2. **每日 manifest + OpenTimestamps**——CI 每天把当日所有推介文件的 SHA-256 清单锚定到比特币区块链（`ots verify` 永久可验，无需信任任何运营方）；回执保存在公开 `anchors` 分支，清单之间首尾哈希相连形成链；
3. **追加式修正链**——结果文件只追加、永不覆盖；修正文件必须携带被修正文件的 SHA-256（`corrects` 字段），任何改动在 Git 历史里可见。

结算分类和净收益**永远由程序计算**（52 用例黄金数据集回归保护），结果文件只能录入事实（比分、状态），写不了结论。

## 五分钟自行验证

```bash
git clone <本仓库地址> && cd pattern-xi-ledger

# 1. 任选一条推介，查看首次提交时间（GitHub 服务器时间戳）
git log --diff-filter=A -- picks/2026/<推介文件>.json

# 2. 切到公开锚定分支，核对文件哈希与当日清单一致
git switch anchors
sha256sum picks/2026/<推介文件>.json && cat manifests/<日期>.txt

# 3. 验证清单的比特币时间戳（pip install opentimestamps-client 后）
ots verify manifests/<日期>.txt.ots

# 4. 从原始数据重建全部战绩，应无任何差异
node scripts/settle.mjs && node scripts/standings.mjs && git diff --exit-code
```

## 目录结构

```text
picks/YYYY/<id>.json        推介（开球前提交；id 以开球 UTC 日期开头）
results/YYYY/<id>.json      结果（终场后追加；修正为 <id>.rN.json + corrects 链）
settlements/YYYY/<id>.json  派生文件：结算明细（程序生成，提交备查，CI 强制保持最新）
manifests/YYYY-MM-DD.txt    anchors 分支：每日推介哈希 + 前次清单哈希（哈希链）
manifests/*.ots             anchors 分支：OpenTimestamps 比特币锚定回执
standings/standings.json    派生文件：战绩投影（程序生成，可随时删除重建）
src/settlement/             结算引擎（自 Pattern XI Task 6 逐字移植，52 用例黄金数据集保护）
src/performance/            战绩投影（自 Pattern XI Task 7 移植，精确十进制、零起点最大回撤）
scripts/                    validate / settle / standings / manifest / build-site
tests/                      黄金数据集回归 + 账本规则测试
site-dist/                  静态站构建产物（gitignore，部署时生成）
```

## 常用命令（Node ≥ 24，零依赖）

```bash
npm test                    # 52 用例黄金数据集 + 账本规则测试
npm run validate            # 校验全部数据与修正链（CI 对新推介强制 ≥2 小时规则）
npm run settle              # 从推介+结果重算结算（派生文件）
npm run standings           # 重建战绩投影（派生文件）
npm run manifest            # 生成今日清单（无当日推介则跳过）
npm run build               # 生成静态站 site-dist/
```

## 运营流程

**发推介（开球前 ≥2 小时）**：写 `picks/YYYY/<开球日期>-<主客队名>-ah.json` →
`npm run validate` → PR 合并。CI 用 GitHub 服务器时钟强制 2 小时规则，并拒绝修改或删除已公布的 pick/result JSON。

**记结果（终场后）**：写 `results/YYYY/<id>.json`（只写比分/状态等事实）→
`npm run validate && npm run settle && npm run standings` → 把派生的
`settlements/`、`standings/` 变更一起提交进同一个 PR，评审人能在 diff 里直接看到程序算出的结论。

**修正（发现错误时）**：新增 `<id>.r2.json`，`corrects` 填被修正文件的 SHA-256，
绝不改动旧文件。四类修正语义与证据要求见 [CONVENTIONS.md](CONVENTIONS.md)。

## 上线操作清单（对外动作，一次性）

> ✅ 已于 2026-09-02 执行完毕（单人维护，必需批准数调整为 0，其余保护全量生效），
> 实测记录见 [LAUNCH.md](LAUNCH.md)。

```bash
# 1. 创建公开仓库并推送（账本必须从第一个 commit 起就是干净历史）
gh repo create pattern-xi-ledger --public --source=. --push

# 2. 启用 GitHub Pages（Settings → Pages → Source: GitHub Actions）

# 3. 分支保护（Settings → Branches → main）：
#    - Require a pull request before merging
#    - Require 1 approval（必须由另一位有权限的协作者批准）
#    - 勾选包括 Require status checks: Check / Ledger integrity
```

之后 CI 全自动：PR 校验、每日锚定到公开 `anchors` 分支、站点部署。`main` 只接受通过评审和必需检查的 PR；自动锚定不会绕过它。

## 诚实的局限

账本证明的是「推介内容在开球前已存在」。**赔率是运营者申报的**（来源字段必填），
建议对赔率页面另存第三方快照（如 archive.org Save Page Now）作旁证。
这两个问题没有免费的完美解，任何系统（包括更复杂的系统）都一样。

## 与 Pattern XI 原项目的关系

原仓库（`E:\PatternXI`）保留为设计档案，本项目的架构决策与移植清单见
[DESIGN.md](DESIGN.md)，运营规则见 [CONVENTIONS.md](CONVENTIONS.md)。
