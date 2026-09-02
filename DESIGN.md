# DESIGN — 从信任区架构到 Git 账本

**日期：** 2026-09-02
**状态：** 已接受；原 Pattern XI 平台转为搁置档案（`E:\PatternXI`，保持不动）

## 1. 背景

Pattern XI 原项目用模块化单体（Next.js + PostgreSQL + 独立 Git 证据仓库 +
Ed25519 签名传输边界）实现「公开、前瞻、可审计」。10/11 实施切片已完成并通过
Owner 评审，剩余工作全部卡在部署证明类事务上（Gate C-L 真实账户与运维隔离、
Task 9 运维与清单、Task 10 Assume-Breach + Shadow Run）。

根本性的反思：**原架构防的是「私有生产系统与公开平台之间的对抗性边界」**
（Assume-Breach 威胁模型、零生产痕迹、物理终端隔离）。而单人推介记录面对的
真实问题小得多也清晰得多：

> 证明「某条推介、以某个赔率、在开球前存在」。

这个问题不需要私有/公开信任区，不需要数据库状态机，只需要**别人服务器的时间戳**
和**密码学锚定**。原项目在这一点上其实也没有做得更好——签名包里的赔率同样是
运营者申报的。

## 2. 信任模型

| 需要证明 | 本账本的机制 | 原项目的机制 |
|---|---|---|
| 推介在开球前存在 | Git commit（GitHub 服务器时间戳）+ PR CI 服务器时钟执行 ≥2h 规则 + OTS 比特币锚定 | 签名包 + 上传接收（部署后仍需信任平台自身时钟与运维） |
| 记录未被事后篡改 | Git 历史 + 追加式修正链（`corrects` = 被改文件 SHA-256） | PostgreSQL 不可变记录 + 修正 API |
| 结算不偏袒 | 冻结引擎 + 52 用例黄金数据集 CI 回归；结果文件无结论字段 | 同一套引擎（本账本逐字移植） |
| 战绩可复核 | `settle && standings && git diff --exit-code`，任何人一条命令重建 | rebuildable projection（同一套数学） |
| 防抵赖强度的天花板 | 比特币区块时间（约小时级） | 平台自身基础设施的正确部署 |

关键洞察：原项目最贵的部分（Gate C-L/Task 9/Task 10）都在防「平台被攻破后
泄密或作恶」，而静态账本把这个攻击面**整体消灭**了——没有服务器、没有私钥、
没有数据库可攻破。剩下的信任锚（GitHub、比特币链）都是第三方且可独立验证。

## 3. 架构

```text
写推介 ──► PR（validate --gate: CI 服务器时钟强制 ≥2h）──► merge = 公布
                                                              │
                     ┌────────────────────────────────────────┘
                     ▼
      GitHub 服务器时间戳（推送时刻，不可回填）
                     │
                     ▼  每日 CI
      manifest.mjs：当日推介 SHA-256 + 前日清单哈希（哈希链）
                     │
                     ▼
      ots stamp → OpenTimestamps → 比特币区块（回执写入公开 anchors 分支）
                     │
终场后记结果 ────────┤
（只录事实）         ▼
      settle.mjs：冻结引擎算分类与净收益（人工写不了结论）
                     ▼
      standings.mjs：精确十进制投影（N/ROI/回撤，可重建）
                     ▼
      build-site.mjs：静态 HTML → GitHub Pages（无后端）
```

## 4. 移植资产（原项目 → 本账本）

| 原文件 | 新位置 | 改动 |
|---|---|---|
| `apps/platform/src/modules/settlement/settlement-engine.ts` | `src/settlement/` | 仅导入扩展名 `.js`→`.ts`（Node 原生 TS） |
| `apps/platform/src/modules/settlement/exact-decimal.ts` | `src/settlement/` | 参数属性改为显式字段（可擦除语法要求）；补 `zero()`/`compare()` |
| `apps/platform/src/modules/settlement/settlement-correction.ts` | `src/settlement/` | 仅导入扩展名 |
| `fixtures/golden/settlement-v1.json` | `fixtures/golden/` | 逐字节复制（SHA-256 `2a752573…b855` 前缀一致） |
| `apps/platform/tests/unit/settlement-engine.test.ts` | `tests/golden-settlement.test.ts` | 见下方「045 用例」说明 |
| `apps/platform/src/modules/performance/performance-projection.ts` | `src/performance/` | 命名适配（`public_pick_id`→`pick_id` 等），数学逐字保留 |

黄金数据集契约不变：52 用例、`NORMATIVE_OWNER_REVIEWED_PASS`、
精确十进制、48/168 小时边界、半赢半输拆分，全部 CI 强制回归。

## 5. 什么被什么替代了

- **Ed25519 + RFC 8785 签名边界** → Git commit + OTS。签名解决「哪个运营者
  发的」，账本场景只有一个运营者，问题不存在；锚定解决「何时发的」，强度更高。
- **PostgreSQL 状态机 + 操作员 Review/Confirm 工作流** → PR 流程。
  黄金数据集 045 号用例（确认前修正使旧 preview 失效、评审绑定新 preview 哈希）
  在账本里由 PR 语义天然覆盖：未合并的结果可以被后续 commit 替换，评审永远
  看的是合并瞬间的最终内容，`settlements/` 派生文件进 diff 让结论可审。
- **Gate C-L 部署隔离、Task 9 运维、Task 10 Assume-Breach** → 不适用。
  无服务器则无部署隔离、无日志抑制、无备份恢复问题；账本本身永久存在于 Git。
- **90 天验证时钟（fail-closed SHADOW_RUN）** → 站点横幅 + 账本规则页。
  正式期开始的声明本身作为一次 commit 入账即可。
- **备份/PITR** → GitHub + 任意远端镜像（`git clone` 即完整备份）。

## 6. 明确不做

Ed25519 签名、数据库、账户体系、订阅、X/Twitter 自动化、移动端、
Pattern Explorer、除亚盘外的市场。原 backlog 的大部分项与本账本无关。

## 7. 后续可选增强（均不阻塞上线）

1. **Telegram 频道镜像**：每条推介合并后自动转发哈希+摘要，增加人类证人层；
2. **赔率页 Wayback 快照**：`web.archive.org/save/<赔率页URL>` 作为赔率旁证；
3. **OTS 回执升级提醒**：weekly `ots upgrade` 已在 stamp.yml 内，无需额外工作；
4. **多运营者**：若未来有第二人发布，再引入署名（per-author GPG 签名 commit），
   当前单人场景明确不做。

## 8. 原项目处置

`E:\PatternXI` 保持原样作为设计档案与历史基线（其标签
`stage-1-pass-2026-08-23-r1`、`publication-core-owner-reviewed-pass-2026-08-24` 等
继续有效）。本账本如未来需要更强的平台能力（账户、API、实时页面），可在
账本数据之上另建呈现层——账本格式保持稳定，展示层随时可以重写。
