// Site stylesheet for the Pattern XI brand system (2026-09 refresh).
// One source of truth for colour, type and component styling; build-site.mjs
// inlines it into every page with a fonts base path so both top-level and
// nested pages resolve the locally hosted Inter files.
//
// Design contract: deep blue-black surfaces, off-white text, one brand-blue
// accent; green/red/amber are reserved for settled outcomes (positive,
// negative, pending) and always accompany a text label. No neon, no glass
// blur, no large gradients; the pitch centre circle appears only as light
// hero decoration.

const FONT_WEIGHTS = [400, 500, 600, 700, 800];

export function styleSheet(fontsBase) {
  const fontFaces = FONT_WEIGHTS.map((weight) => `  @font-face {
    font-family: "Inter";
    font-style: normal;
    font-weight: ${weight};
    font-display: swap;
    src: url("${fontsBase}inter-latin-${weight}-normal.woff2") format("woff2");
  }`).join("\n");

  return `${fontFaces}

  :root {
    color-scheme: dark;
    --bg: #101820;
    --bg-deep: #0C1219;
    --panel: #17222D;
    --panel-2: #141E28;
    --text: #F4F0E6;
    --muted: #AAB7C4;
    --faint: #8CA0B3;
    --line: #314252;
    --line-strong: #3E5266;
    --blue: #2563EB;
    --blue-hover: #1D4FD8;
    --blue-light: #7DB4FF;
    --green: #65C995;
    --red: #F08A8A;
    --amber: #E7BE67;
    --shadow: 0 16px 44px rgba(4, 9, 15, .42);
    --sans: "Inter", "Segoe UI", system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
    --mono: ui-monospace, "Cascadia Mono", Consolas, "SFMono-Regular", Menlo, monospace;
  }

  * { box-sizing: border-box; }
  html { scroll-behavior: smooth; overflow-x: clip; }
  body {
    margin: 0;
    min-width: 320px;
    background: var(--bg);
    color: var(--text);
    font-family: var(--sans);
    font-size: 16px;
    line-height: 1.55;
    -webkit-text-size-adjust: 100%;
  }

  a { color: inherit; text-decoration: none; }
  a:hover { color: var(--blue-light); }
  a:focus-visible, button:focus-visible, input:focus-visible {
    outline: 3px solid rgba(125, 180, 255, .65);
    outline-offset: 3px;
    border-radius: 4px;
  }

  .wrap { width: min(1480px, calc(100% - 44px)); margin: 0 auto; }
  .mono { font-family: var(--mono); }
  .num { font-variant-numeric: tabular-nums; }
  .muted { color: var(--muted); }
  .positive { color: var(--green); }
  .negative { color: var(--red); }
  .pending { color: var(--amber); }

  .skip-link {
    position: fixed; left: 1rem; top: 1rem; z-index: 50;
    transform: translateY(-180%);
    background: var(--panel); color: var(--text);
    padding: 0.5rem 0.8rem; border: 1px solid var(--line-strong); border-radius: 7px;
    font-weight: 700;
  }
  .skip-link:focus { transform: translateY(0); }
  .sr-only {
    position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0;
    overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
  }

  /* top utility */
  .utility {
    border-bottom: 1px solid var(--line);
    background: var(--bg-deep);
  }
  .utility-inner {
    min-height: 35px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    color: var(--faint);
    text-transform: uppercase;
    font-size: .72rem;
    letter-spacing: .15em;
  }
  .utility-links { display: inline-flex; gap: 20px; }
  .utility a { color: var(--muted); font-weight: 600; }
  .utility a:hover { color: var(--blue-light); }

  /* masthead */
  .masthead {
    position: sticky;
    top: 0;
    z-index: 20;
    border-bottom: 1px solid var(--line);
    background: rgba(16, 24, 32, .97);
  }
  .masthead-inner {
    min-height: 76px;
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 34px;
  }
  .brand {
    display: inline-flex;
    align-items: center;
    gap: 12px;
    font-size: 1.5rem;
    font-weight: 800;
    letter-spacing: -.02em;
    white-space: nowrap;
    color: var(--text);
  }
  .brand svg { display: block; width: 34px; height: 34px; }
  .brand b { font-weight: 800; color: var(--blue-light); }
  .brand:hover { color: var(--text); }
  .nav {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 34px;
  }
  .nav a {
    position: relative;
    padding: 28px 0 24px;
    color: var(--muted);
    font-size: .9rem;
    font-weight: 600;
  }
  .nav a:hover { color: var(--text); }
  .nav a[aria-current="page"] { color: var(--blue-light); }
  .nav a[aria-current="page"]::after {
    content: "";
    position: absolute;
    left: 0; right: 0; bottom: 14px;
    height: 2px;
    background: var(--blue-light);
  }
  .subscribe-top {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 42px;
    padding: 0 20px;
    border: 1px solid var(--blue);
    border-radius: 999px;
    color: #FFFFFF;
    background: var(--blue);
    font-weight: 700;
  }
  .subscribe-top:hover { background: var(--blue-hover); border-color: var(--blue-hover); color: #FFFFFF; }

  /* shadow banner */
  .shadow-banner { padding: 10px 0 0; }
  .shadow-banner-inner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    min-height: 44px;
    padding: 8px 16px;
    border: 1px solid rgba(231, 190, 103, .38);
    border-radius: 7px;
    background: rgba(231, 190, 103, .07);
    color: #D9C79A;
    font-size: .86rem;
  }
  .shadow-banner strong { color: var(--amber); letter-spacing: .04em; }
  .shadow-banner a { color: var(--amber); font-weight: 700; white-space: nowrap; }
  .shadow-banner a:hover { color: #F0D194; }

  /* first screen */
  .first-screen { padding: 16px 0 18px; }
  .hero-grid {
    display: grid;
    grid-template-columns: minmax(0, 1.5fr) minmax(325px, .72fr);
    gap: 18px;
    align-items: stretch;
    /* Pitch centre circles as light hero decoration, drawn as backgrounds so
       they can never create layout overflow. */
    background-image:
      radial-gradient(circle at calc(100% + 150px) -130px, transparent 194px, rgba(125, 180, 255, .13) 195px, transparent 197px),
      radial-gradient(circle at calc(100% + 68px) -48px, transparent 111px, rgba(37, 99, 235, .38) 113px, transparent 117px);
    background-repeat: no-repeat;
  }
  .hero-copy {
    min-height: 282px;
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: 22px 12px 18px 6px;
  }
  .eyebrow {
    margin: 0 0 10px;
    color: var(--blue-light);
    text-transform: uppercase;
    letter-spacing: .17em;
    font-size: .72rem;
    font-weight: 800;
  }
  h1 {
    max-width: 820px;
    margin: 0;
    font-size: clamp(3rem, 5.4vw, 5.6rem);
    font-weight: 800;
    line-height: 1.02;
    letter-spacing: -.03em;
    color: var(--text);
  }
  .standfirst {
    max-width: 810px;
    margin: 18px 0 0;
    color: var(--muted);
    font-size: clamp(1rem, 1.35vw, 1.18rem);
    line-height: 1.55;
  }
  .cta-row { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 22px; }
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 44px;
    padding: 0 20px;
    border: 1px solid var(--line-strong);
    border-radius: 999px;
    color: var(--text);
    background: var(--panel);
    font-size: .86rem;
    font-weight: 700;
    cursor: pointer;
  }
  .btn:hover { border-color: var(--blue); color: var(--blue-light); }
  .btn.primary {
    border-color: var(--blue);
    background: var(--blue);
    color: #FFFFFF;
  }
  .btn.primary:hover { background: var(--blue-hover); border-color: var(--blue-hover); color: #FFFFFF; }

  .panel {
    min-width: 0;
    border: 1px solid var(--line);
    border-radius: 12px;
    background: var(--panel);
    box-shadow: var(--shadow);
  }
  .summary-card { padding: 18px 20px 16px; }
  .panel-title {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 12px;
  }
  .panel-title h2 { margin: 0; font-size: 1rem; font-weight: 700; letter-spacing: .01em; }
  .panel-title a { color: var(--blue-light); font-size: .8rem; font-weight: 700; }
  .summary-list { margin: 0; }
  .summary-list div {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 16px;
    padding: 4px 0;
  }
  .summary-list dt { color: var(--muted); font-size: .86rem; }
  .summary-list dd {
    margin: 0; font-weight: 700; font-size: .88rem;
    font-variant-numeric: tabular-nums;
  }
  .summary-list .rule {
    margin: 7px 0 6px;
    padding: 0;
    border-top: 1px solid var(--line);
  }
  .summary-note {
    margin: 11px 0 0;
    padding-top: 10px;
    border-top: 1px solid var(--line);
    color: var(--faint);
    font-size: .73rem;
  }

  /* KPI strip */
  .kpi-strip {
    display: grid;
    grid-template-columns: repeat(4, minmax(0,1fr));
    gap: 10px;
    margin-top: 10px;
  }
  .kpi {
    min-height: 88px;
    display: grid;
    grid-template-columns: 46px minmax(0,1fr) 98px;
    gap: 12px;
    align-items: center;
    padding: 12px 14px;
    border: 1px solid var(--line);
    border-radius: 12px;
    background: var(--panel-2);
  }
  .kpi-icon {
    width: 42px; height: 42px;
    display: grid; place-items: center;
    border-radius: 50%;
    border: 1px solid rgba(125, 180, 255, .4);
    background: rgba(37, 99, 235, .12);
    color: var(--blue-light);
    font-size: 1.05rem;
  }
  .kpi strong { display:block; font-size:1.5rem; line-height:1; font-weight:800; font-variant-numeric: tabular-nums; }
  .kpi span { display:block; margin-top:5px; color:var(--muted); font-size:.76rem; line-height:1.25; }
  .spark { width:100%; height:40px; opacity:.9; }
  .spark polyline { fill:none; stroke:var(--blue-light); stroke-width:2; vector-effect:non-scaling-stroke; }

  /* dashboard row */
  .dashboard-row {
    display: grid;
    grid-template-columns: minmax(0, 1.9fr) minmax(310px, .82fr);
    gap: 10px;
    margin-top: 10px;
  }
  .picks-panel, .curve-panel { min-height: 266px; }
  .picks-panel { padding: 14px 16px 12px; }
  .curve-panel { padding: 14px 16px 12px; }
  .table-wrap { max-width:100%; overflow-x:auto; }
  table {
    width:100%; border-collapse:collapse; font-size:.8rem;
    font-variant-numeric: tabular-nums;
  }
  th {
    padding: 8px 8px;
    border-bottom: 1px solid var(--line-strong);
    color: var(--faint);
    text-align:left;
    text-transform:uppercase;
    letter-spacing:.07em;
    font-size:.64rem;
    font-weight: 700;
    white-space:nowrap;
  }
  td {
    padding: 10px 8px;
    border-bottom: 1px solid var(--line);
    vertical-align:top;
  }
  tbody tr:last-child td { border-bottom: none; }
  .empty-row td { color: var(--muted); font-style: italic; padding: 24px 8px; }
  td.match a { font-weight: 700; }
  td.match a:hover { color: var(--blue-light); }
  td small { color: var(--faint); }
  .badge {
    display:inline-flex; align-items:center; gap:6px;
    padding:2px 8px; border-radius:999px;
    background: rgba(37, 99, 235, .16); color: var(--blue-light);
    font-weight: 700; font-size:.66rem;
  }
  .status {
    display:inline-flex; padding:2px 7px; border:1px solid rgba(125,180,255,.45); border-radius:4px;
    color: var(--blue-light); font-size:.64rem; font-weight:700;
  }
  .status.await { border-color:rgba(231,190,103,.45); color:var(--amber); }
  .pill {
    display:inline-flex; align-items:center; gap:6px;
    padding:2px 8px; border-radius:999px;
    font-weight:700; font-size:.66rem; white-space:nowrap;
  }
  .pill::before { content:""; width:.38rem; height:.38rem; border-radius:50%; background:currentColor; }
  .pill.win { background:rgba(101,201,149,.13); color:var(--green); }
  .pill.loss { background:rgba(240,138,138,.12); color:var(--red); }
  .pill.push { background:rgba(170,183,196,.12); color:var(--muted); }
  .pill.pend { background:rgba(231,190,103,.12); color:var(--amber); }
  .curve-value { color:var(--text); font-size:1.28rem; font-weight:800; font-variant-numeric: tabular-nums; }
  .chart {
    width:100%; height:174px; margin-top:8px; display:block;
  }
  .chart .grid { stroke:#2A3A4A; stroke-width:1; stroke-dasharray:3 5; }
  .chart .axis { fill:var(--faint); font-size:10px; font-family:var(--sans); }
  .chart .line { fill:none; stroke:var(--blue-light); stroke-width:2.25; }
  .chart .area { opacity:.5; }
  .curve-empty { position: relative; margin-top: 8px; }
  .curve-empty-message {
    position:absolute; inset:0;
    display:grid; place-items:center;
    color:var(--muted);
    font-size:.8rem; text-align:center;
    pointer-events:none;
  }
  .subnote { margin:8px 0 0; color:var(--faint); font-size:.68rem; }

  /* integrity strip */
  .integrity {
    margin-top: 10px;
    padding: 14px 16px 15px;
  }
  .integrity-steps {
    display:grid;
    grid-template-columns: repeat(5, minmax(0,1fr));
    gap:0;
    margin-top: 8px;
  }
  .integrity-step {
    position:relative;
    min-height:74px;
    padding:4px 22px 2px 45px;
  }
  .integrity-step:not(:last-child)::after {
    content:"›";
    position:absolute; right:4px; top:18px;
    color:var(--faint); font-size:1.55rem;
  }
  .step-icon {
    position:absolute; left:0; top:4px;
    width:34px; height:34px;
    display:grid; place-items:center;
    border:1px solid var(--line-strong);
    border-radius:8px;
    color:var(--blue-light);
    font-size:.8rem;
  }
  .integrity-step strong { display:block; font-size:.76rem; }
  .integrity-step p { margin:4px 0 0; color:var(--muted); font-size:.68rem; line-height:1.35; }

  /* lower content */
  .lower-grid {
    display:grid;
    grid-template-columns: 1.1fr .9fr;
    gap:10px;
    margin:10px 0 30px;
  }
  .newsletter, .limitations { padding:18px 20px; }
  .newsletter h2, .limitations h2 { margin:0; font-size:1.25rem; font-weight:800; letter-spacing:-.01em; }
  .newsletter p, .limitations p { color:var(--muted); font-size:.82rem; margin:8px 0 0; }
  .newsletter-form { display:flex; gap:8px; margin-top:14px; }
  .newsletter-form input[type="email"] {
    flex:1 1 auto; min-width:0;
    height:44px; padding:0 14px;
    border:1px solid var(--line-strong); border-radius:10px;
    background:var(--bg-deep); color:var(--text); font:inherit;
  }
  .newsletter-form input[type="email"]::placeholder { color:var(--faint); }
  .newsletter-form button { flex:0 0 auto; }
  .fineprint { margin:10px 0 0; color:var(--faint); font-size:.7rem; line-height:1.5; }
  .fineprint a { color:var(--blue-light); }
  .limitations ul { margin:12px 0 0; padding-left:18px; color:var(--muted); font-size:.78rem; }
  .limitations li + li { margin-top:6px; }

  footer {
    border-top:1px solid var(--line);
    color:var(--faint);
    font-size:.74rem;
  }
  .footer-inner { padding:18px 0 30px; display:flex; justify-content:space-between; gap:18px; flex-wrap:wrap; }
  .footer-name { color:var(--muted); font-weight:700; }
  .footer-links { display:inline-flex; gap:18px; }
  .footer-links a { color:var(--muted); font-weight:600; }
  .footer-links a:hover { color:var(--blue-light); }

  .mobile-nav { display:none; }

  /* secondary pages */
  .page-main { padding: 24px 0 42px; }
  .page-hero {
    position: relative;
    display:grid;
    grid-template-columns:minmax(0,1.35fr) minmax(320px,.65fr);
    gap:18px;
    align-items:stretch;
    margin-bottom:10px;
  }
  .page-hero-copy { padding:24px 10px 22px 4px; align-self:center; }
  .page-hero h1 {
    margin:0;
    max-width:850px;
    font-size:clamp(2.8rem,5vw,4.8rem);
    font-weight:800;
    line-height:1.02;
    letter-spacing:-.03em;
    color:var(--text);
  }
  .page-hero .standfirst { max-width:760px; }
  .section-gap { margin-top:10px; }
  .section-panel { padding:16px 18px; }
  .section-heading {
    display:flex; align-items:flex-end; justify-content:space-between; gap:16px;
    margin-bottom:12px;
  }
  .section-heading h2 { margin:0; font-size:1.35rem; font-weight:800; letter-spacing:-.01em; color:var(--text); }
  .section-heading p { margin:0; color:var(--faint); font-size:.75rem; }
  .section-heading a { color:var(--blue-light); font-size:.76rem; font-weight:700; }
  .record-grid {
    display:grid;
    grid-template-columns:minmax(0,1.45fr) minmax(310px,.72fr);
    gap:10px;
    margin-top:10px;
  }
  .metric-grid {
    display:grid;
    grid-template-columns:repeat(3,minmax(0,1fr));
    gap:8px;
  }
  .metric-card {
    min-height:91px;
    padding:12px 14px;
    border:1px solid var(--line);
    border-radius:12px;
    background:var(--panel-2);
  }
  .metric-card .label {
    color:var(--faint); text-transform:uppercase; letter-spacing:.08em;
    font-size:.63rem; font-weight:700;
  }
  .metric-card .value { margin-top:5px; font-size:1.62rem; font-weight:800; line-height:1.05; font-variant-numeric:tabular-nums; }
  .metric-card .sub { margin-top:5px; color:var(--faint); font-size:.68rem; }
  .outcome-chips { display:flex; flex-wrap:wrap; gap:7px; margin-top:10px; }
  .outcome-chip {
    display:inline-flex; align-items:center; gap:6px;
    padding:4px 9px; border-radius:999px; border:1px solid var(--line-strong);
    background:var(--bg-deep); color:var(--muted); font-size:.7rem;
  }
  .outcome-chip b { color:var(--text); font-variant-numeric:tabular-nums; }
  .outcome-chip.win { border-color:rgba(101,201,149,.5); color:var(--green); }
  .outcome-chip.win b { color:var(--green); }
  .outcome-chip.loss { border-color:rgba(240,138,138,.5); color:var(--red); }
  .outcome-chip.loss b { color:var(--red); }
  .outcome-chip.push { border-color:var(--line-strong); }
  .record-table { min-width:820px; }
  .record-table td.match { min-width:170px; }
  .notice-box {
    padding:16px 17px; border:1px solid rgba(231,190,103,.38); border-radius:12px;
    background:rgba(231,190,103,.07); color:#D9C79A;
  }
  .notice-box strong { color:var(--amber); }

  /* verification */
  .evidence-stack { display:grid; gap:8px; }
  .evidence-mini {
    display:grid; grid-template-columns:42px 1fr; gap:10px; align-items:start;
    padding:10px 11px; border:1px solid var(--line); border-radius:10px; background:var(--bg-deep);
  }
  .evidence-mini .n {
    width:36px; height:36px; display:grid; place-items:center;
    border-radius:8px; background:rgba(37,99,235,.14); border:1px solid rgba(125,180,255,.4);
    color:var(--blue-light); font-weight:800; font-size:.72rem;
  }
  .evidence-mini strong { display:block; font-size:.76rem; }
  .evidence-mini p { margin:3px 0 0; color:var(--muted); font-size:.68rem; line-height:1.4; }
  .verify-layout {
    display:grid; grid-template-columns:minmax(0,1.25fr) minmax(300px,.75fr); gap:10px; margin-top:10px;
  }
  .verify-steps { padding:16px 18px; }
  .verify-step {
    display:grid; grid-template-columns:48px minmax(0,1fr); gap:14px;
    padding:16px 0; border-bottom:1px solid var(--line);
  }
  .verify-step:last-child { border-bottom:none; padding-bottom:2px; }
  .verify-step > div { min-width:0; }
  .step-no {
    width:42px; height:42px; display:grid; place-items:center;
    border:1px solid rgba(125,180,255,.4); border-radius:10px; background:rgba(37,99,235,.12);
    color:var(--blue-light); font-size:1.2rem; font-weight:800;
  }
  .verify-step h3 { margin:0; font-size:.93rem; font-weight:700; }
  .verify-step p { margin:5px 0 0; color:var(--muted); font-size:.78rem; }
  pre {
    margin:9px 0 0; padding:11px 12px; overflow-x:auto;
    border:1px solid var(--line); border-radius:8px; background:var(--bg-deep);
    color:#C9D6E2; font-family:var(--mono); font-size:.71rem; line-height:1.55;
    white-space:pre;
  }
  code { font-family:var(--mono); overflow-wrap:anywhere; }
  dl.facts dd code { user-select:all; }
  .verify-side { display:grid; gap:10px; align-content:start; }
  .truth-card { padding:16px 18px; }
  .truth-card h2 { margin:0; font-size:1.2rem; font-weight:800; }
  .truth-card p { margin:9px 0 0; color:var(--muted); font-size:.78rem; }
  .truth-card ul { margin:10px 0 0; padding-left:18px; color:var(--muted); font-size:.76rem; }
  .truth-card li+li { margin-top:7px; }
  .methodology-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:8px; margin-top:10px; }
  .method-card { padding:15px 16px; }
  .method-card .k { color:var(--blue-light); font-size:.68rem; font-weight:800; letter-spacing:.1em; }
  .method-card h3 { margin:6px 0 0; font-size:1rem; font-weight:700; }
  .method-card p { margin:6px 0 0; color:var(--muted); font-size:.75rem; }

  /* pick detail */
  .back { display:inline-block; margin-top:18px; font-size:.8rem; font-weight:700; color:var(--blue-light); }
  dl.facts {
    display:grid; grid-template-columns:minmax(9rem,13rem) 1fr; gap:0;
    margin:0; font-size:.85rem;
  }
  dl.facts dt {
    padding:.5rem .6rem; border-bottom:1px solid var(--line);
    color:var(--faint); text-transform:uppercase; letter-spacing:.08em;
    font-size:.64rem; font-weight:700;
  }
  dl.facts dd { margin:0; padding:.5rem .6rem; border-bottom:1px solid var(--line); font-variant-numeric:tabular-nums; }
  dl.facts dt:last-of-type, dl.facts dd:last-of-type { border-bottom:none; }
  dl.facts dd code { word-break:break-all; font-size:.72rem; }

  @media (max-width: 1080px) {
    .wrap { width:min(100% - 30px, 1080px); }
    .masthead-inner { grid-template-columns:auto 1fr; }
    .subscribe-top { display:none; }
    .nav { gap:24px; }
    .hero-grid { grid-template-columns:1fr .72fr; }
    h1 { font-size:clamp(2.8rem, 6vw, 4.7rem); }
    .kpi-strip { grid-template-columns:repeat(2,1fr); }
    .dashboard-row { grid-template-columns:1fr; }
    .curve-panel { min-height:240px; }
    .integrity-steps { grid-template-columns:repeat(3,1fr); row-gap:14px; }
    .integrity-step:nth-child(3)::after { display:none; }
    .lower-grid { grid-template-columns:1fr; }
    .page-hero { grid-template-columns:1fr .72fr; }
    .record-grid, .verify-layout { grid-template-columns:1fr; }
  }

  @media (max-width: 760px) {
    .wrap { width:min(100% - 24px, 720px); }
    .utility-inner { font-size:.61rem; letter-spacing:.09em; min-height:31px; }
    .utility-inner span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .utility-inner a { flex:0 0 auto; }
    .utility-links { gap:12px; }
    .masthead { position:relative; }
    .masthead-inner { min-height:64px; grid-template-columns:1fr auto; gap:12px; }
    .brand { font-size:1.3rem; gap:9px; }
    .brand svg { width:28px; height:28px; }
    .nav { display:none; }
    .mobile-nav {
      display:flex;
      gap:6px;
      overflow-x:auto;
      scrollbar-width:none;
      padding:0 0 10px;
    }
    .mobile-nav::-webkit-scrollbar { display:none; }
    .mobile-nav a {
      flex:0 0 auto;
      padding:6px 10px;
      border:1px solid var(--line);
      border-radius:999px;
      color:var(--muted);
      font-size:.72rem;
      font-weight:700;
    }
    .mobile-nav a[aria-current="page"] { border-color:rgba(125,180,255,.5); color:var(--blue-light); background:rgba(37,99,235,.12); }
    .hero-grid { background-image:none; }
    .shadow-banner-inner { align-items:flex-start; font-size:.75rem; line-height:1.4; }
    .shadow-banner a { display:none; }
    .first-screen { padding-top:12px; }
    .hero-grid { grid-template-columns:1fr; gap:10px; }
    .hero-copy { min-height:0; padding:14px 2px 8px; }
    h1 { font-size:clamp(2.6rem, 13vw, 4.15rem); max-width:650px; }
    .standfirst { margin-top:14px; font-size:1rem; }
    .cta-row { margin-top:16px; }
    .summary-card { box-shadow:none; }
    .kpi-strip { grid-template-columns:repeat(2,1fr); gap:8px; }
    .kpi {
      min-height:78px;
      grid-template-columns:36px 1fr;
      gap:9px;
      padding:10px;
    }
    .kpi-icon { width:34px; height:34px; }
    .kpi strong { font-size:1.25rem; }
    .kpi .spark { display:none; }
    .dashboard-row { margin-top:8px; gap:8px; }
    .picks-panel, .curve-panel { min-height:auto; padding:12px; }
    table { min-width:700px; }
    .record-table { min-width:820px; }
    .integrity { padding:12px; }
    .integrity-steps { grid-template-columns:1fr; gap:5px; }
    .integrity-step { min-height:60px; padding-right:4px; }
    .integrity-step::after { display:none !important; }
    .lower-grid { margin-top:8px; gap:8px; }
    .newsletter, .limitations { padding:15px; }
    .newsletter-form { flex-direction:column; }
    .newsletter-form .btn { width:100%; }
    .footer-inner { display:block; }
    .footer-inner > * + * { margin-top:6px; }
    .page-main { padding-top:14px; }
    .page-hero { grid-template-columns:1fr; gap:8px; }
    .page-hero-copy { padding:14px 2px 8px; }
    .page-hero h1 { font-size:clamp(2.55rem,12vw,4rem); }
    .metric-grid { grid-template-columns:repeat(2,minmax(0,1fr)); }
    .section-panel, .verify-steps, .truth-card { padding:13px; }
    .verify-step { grid-template-columns:38px minmax(0,1fr); gap:10px; padding:13px 0; }
    .step-no { width:34px; height:34px; font-size:1rem; }
    .methodology-grid { grid-template-columns:1fr; }
    pre { font-size:.66rem; }
    dl.facts { grid-template-columns:1fr; }
    dl.facts dt { border-bottom:none; padding-bottom:0; }
    dl.facts dd { padding-top:.15rem; }
  }

  @media (max-width: 430px) {
    .utility-inner a { font-size:0; }
    .utility-inner a::after { content:"X ↗"; font-size:.61rem; }
    .utility-inner a + a::after { content:"GitHub ↗"; }
    .shadow-banner-inner { padding:8px 10px; }
    h1 { font-size:2.8rem; }
    .kpi-strip { grid-template-columns:1fr 1fr; }
    .kpi span { font-size:.7rem; }
    .summary-card { padding:15px; }
    .metric-grid { grid-template-columns:1fr 1fr; }
    .metric-card { padding:10px; min-height:84px; }
    .metric-card .value { font-size:1.4rem; }
  }
`;
}
