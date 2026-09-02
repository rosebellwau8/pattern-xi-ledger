#!/usr/bin/env node
// Builds the static public site into site-dist/. Pure Node, no framework, no
// client JavaScript, no network. Output is deterministic: the same ledger
// state always produces byte-identical pages, which is what lets CI enforce
// that the committed site is current.

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { isMainScript, REPO_ROOT } from "./lib.mjs";
import { buildSettlements } from "./settle.mjs";
import { buildStandings } from "./standings.mjs";
import { sha256File } from "./lib.mjs";

const CLASSIFICATION_ZH = {
  WIN: "赢",
  HALF_WIN: "半赢",
  PUSH: "走盘",
  HALF_LOSS: "半输",
  LOSS: "输",
  VOID: "无效",
};

const STYLE = `
  :root { color-scheme: light dark; }
  body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; margin: 0; background: #f6f7f9; color: #1a1d21; }
  main { max-width: 60rem; margin: 0 auto; padding: 1rem 1.25rem 4rem; }
  a { color: #0b62d6; text-decoration: none; } a:hover { text-decoration: underline; }
  header.site { background: #10233f; color: #fff; padding: 1.1rem 1.25rem; }
  header.site h1 { margin: 0; font-size: 1.25rem; }
  header.site nav { margin-top: .35rem; display: flex; gap: 1rem; flex-wrap: wrap; }
  header.site nav a { color: #cfe0ff; }
  .banner { background: #b35c00; color: #fff; padding: .6rem 1.25rem; font-weight: 600; }
  .card { background: #fff; border: 1px solid #d9dee5; border-radius: .5rem; padding: 1rem 1.25rem; margin-top: 1.25rem; }
  table { border-collapse: collapse; width: 100%; font-size: .95rem; }
  th, td { text-align: left; padding: .45rem .6rem; border-bottom: 1px solid #e4e8ee; vertical-align: top; }
  th { color: #5a6472; font-weight: 600; white-space: nowrap; }
  code, pre { font-family: ui-monospace, Consolas, monospace; font-size: .85rem; }
  pre { background: #f0f2f5; border: 1px solid #d9dee5; border-radius: .4rem; padding: .8rem; overflow-x: auto; }
  .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .tag { display: inline-block; border-radius: .3rem; padding: .05rem .4rem; font-size: .8rem; }
  .win { background: #dff5e1; } .loss { background: #fbe0e0; } .push { background: #eceff3; }
  .pending { background: #fff3cd; } .void { background: #eceff3; }
  h2 { font-size: 1.05rem; margin: 0 0 .6rem; }
  p { line-height: 1.55; }
  dl.metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr)); gap: .6rem; margin: 0; }
  dl.metrics div { background: #f0f2f5; border-radius: .4rem; padding: .5rem .7rem; }
  dl.metrics dt { font-size: .75rem; color: #5a6472; margin: 0; }
  dl.metrics dd { margin: .15rem 0 0; font-size: 1.05rem; font-variant-numeric: tabular-nums; font-weight: 600; }
  @media (prefers-color-scheme: dark) {
    body { background: #14171a; color: #e8eaed; }
    .card { background: #1d2126; border-color: #343a42; }
    th { color: #9aa4b1; } th, td { border-bottom-color: #2c3238; }
    pre { background: #23282e; border-color: #343a42; }
    dl.metrics div { background: #23282e; } dl.metrics dt { color: #9aa4b1; }
  }
`;

function tagFor(recordState, classification) {
  if (recordState === "PENDING") return `<span class="tag pending">待定</span>`;
  const zh = CLASSIFICATION_ZH[classification] ?? classification;
  const cls = classification === "WIN" || classification === "HALF_WIN" ? "win"
    : classification === "LOSS" || classification === "HALF_LOSS" ? "loss"
    : classification === "VOID" ? "void" : "push";
  return `<span class="tag ${cls}">${zh}</span>`;
}

function esc(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function page(title, body) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · Pattern XI 账本</title>
<style>${STYLE}</style>
</head>
<body>
<header class="site">
  <h1>Pattern XI 公开推介账本</h1>
  <nav>
    <a href="index.html">首页</a>
    <a href="track-record.html">完整记录</a>
    <a href="verification.html">验证方法</a>
  </nav>
</header>
<div class="banner">SHADOW RUN 试运行阶段 — 本账本不计入正式 90 天公开验证</div>
<main>
${body}
</main>
</body>
</html>
`;
}

function metricsGrid(standings) {
  const roi = standings.roi_percent === null ? "—" : `${standings.roi_percent}%`;
  const avg = standings.average_decimal_price === null ? "—" : standings.average_decimal_price;
  return `<dl class="metrics">
  <div><dt>已结算 N（不含无效）</dt><dd>${standings.n}</dd></div>
  <div><dt>净收益（单位注）</dt><dd>${esc(standings.total_net_return)}</dd></div>
  <div><dt>ROI</dt><dd>${esc(roi)}</dd></div>
  <div><dt>平均赔率</dt><dd>${esc(avg)}</dd></div>
  <div><dt>最大回撤</dt><dd>${esc(standings.maximum_drawdown)}</dd></div>
  <div><dt>待定 / 无效</dt><dd>${standings.pending_count} / ${standings.void_count}</dd></div>
</dl>`;
}

function pickRow(pick, settlement) {
  const current = settlement?.current;
  return `  <tr>
    <td><a href="picks/${esc(pick.id)}.html">${esc(pick.id)}</a></td>
    <td>${esc(pick.data.match)}<br><small>${esc(pick.data.competition)}</small></td>
    <td>${esc(pick.frozen.selection === "HOME" ? "主" : "客")} ${esc(pick.frozen.line)} @ ${esc(pick.frozen.normalized_decimal_price)}</td>
    <td>${esc(pick.kickoffUtc)}</td>
    <td>${current === undefined ? '<span class="tag pending">无结果</span>' : tagFor(current.record_state, current.classification)}</td>
    <td class="num">${current === undefined || current.net_return === null ? "—" : esc(current.net_return)}</td>
  </tr>`;
}

export function buildSite(root) {
  const { picks, settlements } = buildSettlements(root);
  const standings = buildStandings(root);
  const orderedPicks = [...picks.values()].sort((left, right) =>
    left.kickoffEpoch - right.kickoffEpoch || left.id.localeCompare(right.id));

  const dist = join(root, "site-dist");
  rmSync(dist, { recursive: true, force: true });
  mkdirSync(join(dist, "picks"), { recursive: true });

  const latest = orderedPicks.slice(-10).reverse();
  const latestTable = latest.length === 0
    ? "<p>账本尚无推介。所有推介都会在开球前至少 2 小时以 Git commit 形式公布在此仓库。</p>"
    : `<table>
  <tr><th>推介</th><th>比赛</th><th>选择</th><th>开球 (UTC)</th><th>结算</th><th class="num">净收益</th></tr>
${latest.map((pick) => pickRow(pick, settlements.get(pick.id))).join("\n")}
</table>`;

  writeFileSync(join(dist, "index.html"), page("首页", `
<div class="card">
  <h2>战绩总览（可独立重建）</h2>
  ${metricsGrid(standings)}
  <p style="margin-bottom:0"><small>统计口径：单位注 1，净收益按精确十进制累加；无效盘不计入 N。
  详见<a href="verification.html">验证方法</a>。全部数字由 <code>scripts/standings.mjs</code> 从结算记录重建，无人工输入。</small></p>
</div>
<div class="card">
  <h2>最新推介</h2>
  ${latestTable}
</div>
`));

  const fullTable = orderedPicks.length === 0
    ? "<p>账本尚无推介。</p>"
    : `<table>
  <tr><th>推介</th><th>比赛</th><th>选择</th><th>开球 (UTC)</th><th>结算</th><th class="num">净收益</th></tr>
${orderedPicks.map((pick) => pickRow(pick, settlements.get(pick.id))).join("\n")}
</table>`;

  writeFileSync(join(dist, "track-record.html"), page("完整记录", `
<div class="card">
  <h2>全部推介（含输盘，永不删除）</h2>
  ${fullTable}
</div>
`));

  for (const pick of orderedPicks) {
    const settlement = settlements.get(pick.id);
    const chain = settlement?.revisions ?? [];
    const chainRows = chain.length === 0
      ? "<p>尚无结果记录。</p>"
      : `<table>
  <tr><th>版本</th><th>结果文件</th><th>SHA-256</th><th>结论</th><th class="num">净收益</th></tr>
${chain.map((revision) => `  <tr>
    <td>r${revision.revision}</td>
    <td><code>${esc(revision.result_file)}</code></td>
    <td><code>${esc(revision.result_file_sha256.slice(0, 16))}…</code></td>
    <td>${tagFor(revision.result.record_state, revision.result.classification)}</td>
    <td class="num">${revision.result.net_return === null ? "—" : esc(revision.result.net_return)}</td>
  </tr>`).join("\n")}
</table>`;
    const components = settlement === undefined || settlement.current.record_state === "PENDING"
      ? ""
      : `<pre>${esc(JSON.stringify(
        settlement.revisions[settlement.revisions.length - 1].result.components, null, 2,
      ))}</pre>`;
    writeFileSync(join(dist, "picks", `${pick.id}.html`), page(pick.id, `
<div class="card">
  <h2>${esc(pick.data.match)}</h2>
  <table>
    <tr><th>推介 ID</th><td><code>${esc(pick.id)}</code></td></tr>
    <tr><th>开球时间 (UTC)</th><td>${esc(pick.kickoffUtc)}</td></tr>
    <tr><th>选择</th><td>${esc(pick.frozen.selection === "HOME" ? "主队" : "客队")} ${esc(pick.frozen.line)}</td></tr>
    <tr><th>公布赔率</th><td>${esc(pick.data.published_price)} (${esc(pick.data.published_price_format)}) → ${esc(pick.frozen.normalized_decimal_price)} 十进制</td></tr>
    <tr><th>赔率来源</th><td>${esc(pick.data.price_source)}</td></tr>
    <tr><th>推介文件</th><td><code>${esc(pick.path)}</code>（SHA-256 <code>${esc(sha256File(pick.absolutePath).slice(0, 16))}…</code>）</td></tr>
  </table>
</div>
<div class="card">
  <h2>结果与修正链（只追加，永不覆盖）</h2>
  ${chainRows}
</div>
<div class="card">
  <h2>盘口组件结算</h2>
  ${components || "<p>结算完成后显示盘口拆分。</p>"}
</div>
`));
  }

  writeFileSync(join(dist, "verification.html"), page("验证方法", `
<div class="card">
  <h2>为什么可以相信这个账本</h2>
  <p>本站没有数据库、没有后台。它只是一个由 Git 仓库自动生成的静态页面：
  每一条推介都在<strong>开球前至少 2 小时</strong>以 commit 形式公布，推送时刻由 GitHub
  服务器记录，无法回填；每日清单（manifest）通过 OpenTimestamps 锚定到比特币区块链；
  结果文件只追加、永不覆盖，任何修正都在 Git 历史里可见。</p>
</div>
<div class="card">
  <h2>五分钟自行验证</h2>
  <pre>git clone &lt;本仓库地址&gt;
cd pattern-xi-ledger

# 1. 任选一条推介，查看它的首次提交时间（GitHub 服务器时间戳）
git log --diff-filter=A -- picks/2026/&lt;推介文件&gt;

# 2. 核对文件哈希与当日清单一致
sha256sum picks/2026/&lt;推介文件&gt;
cat manifests/&lt;日期&gt;.txt

# 3. 验证清单的比特币时间戳（安装 opentimestamps-client 后）
ots verify manifests/&lt;日期&gt;.txt.ots

# 4. 从原始数据重建全部战绩，应与站点数字一致
node scripts/settle.mjs &amp;&amp; node scripts/standings.mjs &amp;&amp; git diff --exit-code</pre>
</div>
<div class="card">
  <h2>诚实的局限声明</h2>
  <p>账本证明的是「推介内容在开球前已存在」。赔率由运营者申报并注明来源；
  建议同时保存赔率页面的第三方快照（如 archive.org）作为旁证。结算规则冻结自
  Settlement Rules v1（52 用例黄金数据集，CI 强制回归），比分以官方结果为准，
  修正必须引用被修正文件的 SHA-256 并保留原记录。</p>
</div>
`));

  console.log(`site built: ${orderedPicks.length} picks, ${standings.n} counted`);
}

if (isMainScript(import.meta.url)) buildSite(REPO_ROOT);
