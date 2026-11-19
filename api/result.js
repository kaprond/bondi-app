// Shared result of a settled pool: https://<site>/r/<pool id>?i=<invite code>&from=<handle>
// The preview image is the result card (api/card.mjs). Tapping goes to the app, where the sharer's
// invite code drops new people into the crew.
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

module.exports = async (req, res) => {
  const url = new URL(req.url, `https://${req.headers.host}`);
  const id = (url.searchParams.get('id') || '').toLowerCase();
  const code = (url.searchParams.get('i') || '').toUpperCase().replace(/[^A-Z0-9-]/g, '');
  const from = (url.searchParams.get('from') || '').toLowerCase().replace(/[^a-z0-9._]/g, '');
  const site = `https://${req.headers.host}`;
  const target = `${site}/?pool=${encodeURIComponent(id)}${code ? `&i=${code}` : ''}${from ? `&from=${from}` : ''}`;

  let p = null;
  if (/^[0-9a-f-]{36}$/.test(id) && SUPABASE_URL && SUPABASE_KEY) {
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/result_preview`, {
        method: 'POST',
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_pool: id }),
      });
      if (r.ok) p = await r.json();
    } catch { /* fall back to the generic card */ }
  }

  const who = (p?.called_it ?? []).map((n) => '@' + n);
  const title = p ? `${p.winner} 🏆 ${who.length ? who.slice(0, 3).join(', ') + ' called it' : 'nobody called it'}` : 'a pool on LetsJam';
  const desc = p
    ? `${p.question} · ${p.crew} · ${p.players} played, ${p.pot} coins in the pot.${p.forfeit ? ` wrong side ${p.forfeit}.` : ''} start your own pool: free coins, no cash.`
    : 'friend pools with free coins. call it with your crew.';

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=60');
  res.end(`<!doctype html>
<html lang="en"><head>
<meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)} · LetsJam</title>
<meta name="description" content="${esc(desc)}" />
<meta property="og:type" content="website" /><meta property="og:site_name" content="LetsJam" />
<meta property="og:title" content="${esc(title)}" /><meta property="og:description" content="${esc(desc)}" />
<meta property="og:url" content="${esc(site + url.pathname)}" /><meta property="og:image" content="${site}/api/card?id=${encodeURIComponent(id)}" />
<meta property="og:image:width" content="1200" /><meta property="og:image:height" content="630" />
<meta name="twitter:card" content="summary_large_image" />
<meta http-equiv="refresh" content="0; url=${esc(target)}" />
<style>body{margin:0;font-family:-apple-system,system-ui,sans-serif;background:#28275F;color:#fff;display:grid;place-items:center;min-height:100vh;text-align:center;padding:24px}a{color:#FFF000}</style>
</head><body><div><h2>${esc(title)}</h2><p>${esc(desc)}</p><p><a href="${esc(target)}">open LetsJam</a></p></div>
<script>location.replace(${JSON.stringify(target)})</script></body></html>`);
};
