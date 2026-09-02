# 账本规则（CONVENTIONS）

本文件是账本的「游戏规则」。规则一旦发布，修改本身也走 PR 并在 Git 历史可见。
规则违反 = CI 拒绝合并（fail-closed），不存在警告级违规。

## 1. 发布规则

- 每条推介在**开球前至少 2 小时**以 PR 合并进 `main`；CI 用 GitHub Actions
  服务器时钟对新推介文件强制执行（`validate.mjs --gate`）。
- **全量公布义务**：所有实际下注或推荐的推介都必须入账，不允许选择性公布。
  这是账本可信的前提，也是唯一无法用代码强制、只能靠规则和声誉约束的一条。
- 单位注固定为 1，不记录滚动注、串关或仓位管理。
- 市场范围：仅整场亚洲让球盘（`market: "asian_handicap"`），只支持 HOME/AWAY 选择。

## 2. 推介文件规则

- 文件名与内容强绑定：`picks/<年>/<开球UTC日期>-<队名slug>-ah.json`，
  `id` 必须以开球 UTC 日期开头。
- 赔率必填两个字段：`published_price`（公布口径）与 `published_price_format`
  （`DECIMAL_ODDS` 或 `HONG_KONG_ODDS`）；`normalized_decimal_price` 由脚本核对
  （港赔 + 1 = 十进制），杜绝口径漂移。
- `price_source` 必填（如 "Pinnacle pre-match"）。这是申报字段——账本证明你
  在何时发布了什么，不能证明赔率页面当时长什么样；建议另存第三方快照作旁证。
- 未知字段直接拒绝（allowlist），不给「顺手加个字段」留口子。

## 3. 结果录入规则（只录事实，不写结论）

结果文件**只能包含事实字段**：比分、状态、时间戳、中断处置。分类（赢/半赢/走/
半输/输/无效）与净收益由 `settle.mjs` 调用冻结的结算引擎计算，人工写了也会被
忽略——因为根本没有那个字段。

状态映射（对应 Settlement Rules v1）：

| status | 必填 | 引擎行为 |
|---|---|---|
| `PLAYED` | `home_score`、`away_score` | 正常结算；若 `actual_kickoff_at` 比冻结开球时间晚超 48h 判 VOID |
| `POSTPONED` | 有新开球：`actual_kickoff_at`（+完赛比分则结算）；无新开球：`status_determined_at` | 超 48h VOID，否则 PENDING |
| `CANCELLED` | — | 直接 VOID |
| `ABANDONED` | `interruption_disposition`；`RESUMED_SAME_FIXTURE` 需 `regulation_completed_at`；`UNKNOWN` 需 `status_determined_at` | 同场 48h 内完赛可结算；重赛/弃赛 VOID；UNKNOWN 超 168h VOID |

## 4. 修正规则（追加式，永不覆盖）

- 结果只追加：修正写入新文件 `results/<年>/<id>.rN.json`（N 顺延），
  `corrects` 字段填**被修正文件的精确 SHA-256**；脚本拒绝断链、分叉、空修正。
- 修正必须注明理由（`note`），并符合四类语义之一（沿袭 Settlement Rules v1）：
  1. `SOURCE_DATA_ERROR` — 比分源录错（需更权威来源的比分，附证据说明）；
  2. `SETTLEMENT_LOGIC_ERROR` — 引擎/规则应用错误（需给出正确比分重算）；
  3. `OFFICIAL_RESULT_CORRECTION` — 官方改判比分（证据等级：
     竞赛主办方 > 官方指定数据商 > 俱乐部官方，普通比分网站不算权威）；
  4. `ADMINISTRATIVE_RESULT_CHANGE` — 行政性改判，维持原竞技结算。
- 推介文件（pick）合并后不得修改——推介是不可变的报价记录；写错了就用一个
  新推介声明作废并说明，旧记录保留。

## 5. 结算规则版本

- 结算语义冻结自 Settlement Rules v1（52 用例黄金数据集，
  `fixtures/golden/settlement-v1.json`，原 Owner 评审基线，SHA-256 见 DESIGN.md）。
- 黄金数据集是 CI 强制回归：任何使 52 用例之一变化的代码改动都会被拒绝。
  修改结算规则 = 换新版本号 + 新黄金数据集 + 显式 PR 声明，历史记录不回溯重算
  （投影按结算时点的规则版本冻结）。

## 6. 派生文件纪律

`settlements/` 与 `standings/` 是派生文件：必须与原始数据保持一致
（CI 重建后 `git diff --exit-code`），记录结果的 PR 必须把派生变更一并提交，
让评审人在 diff 里直接看到程序算出的结论。怀疑数字有问题？删掉重跑即可。
