// Funnel dashboard: https://app.letsjamnow.com/admin?k=<key>&d=<days>
// Counts only (no personal data). The key lives in public.app_secrets (server-side), see 0019_growth.sql.
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const STEPS = [
  ['visited', 'opened the app', 'every new (anonymous) session, bots and link previews included'],
  ['saw_welcome', 'saw the welcome screen', 'the app actually rendered for them'],
  ['said_yes', 'tapped “i’m 18+ · let’s go”', 'the age gate'],
  ['made_profile', 'picked a name', ''],
  ['in_crew', 'in a crew', 'made one or joined via a link'],
  ['played', 'played a pool', 'made or joined one'],
  ['shared', 'shared something', 'invite, pool or result link'],
  ['push_on', 'push on', 'app only'],
  ['came_back', 'came back another day', ''],
];

function page(body, title = 'LetsJam funnel') {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(title)}</title>
<style>
:root{--brand:#0095B6;--deep:#28275F;--yellow:#FFE14D;--muted:#6B7280;--line:#E5E7EB}
*{box-sizing:border-box}body{margin:0;font-family:-apple-system,system-ui,"Segoe UI",sans-serif;background:#F4F7FA;color:var(--deep)}
main{max-width:880px;margin:0 auto;padding:28px 18px 60px}h1{margin:0 0 4px;font-size:28px}h2{font-size:17px;margin:30px 0 10px}
.sub{color:var(--muted);font-size:14px}.card{background:#fff;border-radius:16px;padding:18px;box-shadow:0 1px 2px rgba(0,0,0,.05)}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-top:18px}
.kpi b{display:block;font-size:30px}.kpi span{color:var(--muted);font-size:13px}
.step{display:grid;grid-template-columns:200px 1fr 120px;gap:12px;align-items:center;padding:8px 0;border-bottom:1px solid var(--line)}
.step:last-child{border:0}.step small{display:block;color:var(--muted);font-size:12px}
.bar{height:22px;background:#EAF6FA;border-radius:6px;overflow:hidden}.bar i{display:block;height:100%;background:var(--brand);border-radius:6px}
.num{text-align:right;font-variant-numeric:tabular-nums}.num em{display:block;font-style:normal;font-size:12px;color:var(--muted)}
.drop{color:#C2410C;font-weight:600}
table{width:100%;border-collapse:collapse;font-size:14px;font-variant-numeric:tabular-nums}th,td{padding:6px 8px;text-align:right;border-bottom:1px solid var(--line)}th:first-child,td:first-child{text-align:left}
.chips{display:flex;flex-wrap:wrap;gap:8px}.chip{background:#fff;border:1px solid var(--line);border-radius:999px;padding:6px 12px;font-size:13px}
nav a{color:var(--brand);margin-right:12px;font-weight:600;text-decoration:none}
@media(max-width:600px){.step{grid-template-columns:1fr 90px}.step .bar{grid-column:1/3;grid-row:2}}
</style></head><body><main>${body}</main></body></html>`;
}

module.exports = async (req, res) => {
  const url = new URL(req.url, `https://${req.headers.host}`);
  const key = (url.searchParams.get('k') || '').replace(/[^a-f0-9]/gi, '');
  const days = Math.min(Math.max(parseInt(url.searchParams.get('d') || '14', 10) || 14, 1), 365);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');

  let data = null;
  if (key && SUPABASE_URL && SUPABASE_KEY) {
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/funnel_report`, {
        method: 'POST',
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_key: key, p_days: days }),
      });
      if (r.ok) data = await r.json();
    } catch { /* fall through */ }
  }
  if (!data) { res.statusCode = 404; return res.end(page('<h1>not found</h1>', 'not found')); }

  const s = data.steps || {};
  const top = Math.max(s.visited || 0, 1);
  let prev = null;
  const stepsHtml = STEPS.map(([k, label, hint]) => {
    const n = s[k] || 0;
    const ofPrev = prev === null ? 100 : prev ? Math.round((n / prev) * 100) : 0;
    const html = `<div class="step"><div>${esc(label)}${hint ? `<small>${esc(hint)}</small>` : ''}</div>
      <div class="bar"><i style="width:${Math.max((n / top) * 100, n ? 1.5 : 0)}%"></i></div>
      <div class="num"><b>${n}</b><em class="${prev !== null && ofPrev < 40 ? 'drop' : ''}">${prev === null ? '' : `${ofPrev}% of previous`}</em></div></div>`;
    if (k !== 'push_on') prev = n; // push is app-only: don't chain the next step to it
    return html;
  }).join('');

  const t = data.totals || {};
  const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '–');
  const daysRows = (data.days || []).slice().reverse().map((d) =>
    `<tr><td>${esc(d.day)}</td><td>${d.visited}</td><td>${d.said_yes}</td><td>${d.played}</td></tr>`).join('');
  const chips = (obj) => Object.entries(obj || {}).map(([k, v]) => `<span class="chip">${esc(k)} · <b>${v}</b></span>`).join('') || '<span class="sub">none yet</span>';
  const link = (d) => `/admin?k=${esc(key)}&d=${d}`;

  res.end(page(`
    <h1>LetsJam funnel</h1>
    <div class="sub">new sessions in the last ${days} days · since ${esc(String(data.since).slice(0, 10))}</div>
    <nav style="margin-top:10px"><a href="${link(1)}">24h</a><a href="${link(7)}">7d</a><a href="${link(14)}">14d</a><a href="${link(30)}">30d</a><a href="${link(90)}">90d</a></nav>
    <div class="kpis">
      <div class="card kpi"><b>${s.visited || 0}</b><span>sessions</span></div>
      <div class="card kpi"><b>${pct(s.said_yes || 0, s.saw_welcome || s.visited || 0)}</b><span>pass the welcome screen</span></div>
      <div class="card kpi"><b>${pct(s.played || 0, s.said_yes || 0)}</b><span>of those play a pool</span></div>
      <div class="card kpi"><b>${t.crews || 0} / ${t.pools || 0}</b><span>crews / pools (all time)</span></div>
    </div>
    <h2>Funnel</h2><div class="card">${stepsHtml}</div>
    <h2>Platforms (saw welcome)</h2><div class="chips">${chips(data.platforms)}</div>
    <h2>Push nudges sent, last 7 days</h2><div class="chips">${chips(data.nudges)}</div>
    <h2>Push opened, last 7 days</h2><div class="chips">${chips(data.push_opened)}</div>
    <h2>Per day</h2><div class="card"><table><thead><tr><th>day</th><th>sessions</th><th>passed welcome</th><th>played</th></tr></thead><tbody>${daysRows}</tbody></table></div>
    <p class="sub" style="margin-top:24px">“welcome screen” tracking starts with this release, so older sessions show 0 there. open pools now: ${t.open_pools || 0} · people with push: ${t.push_users || 0}</p>
  `));
};
