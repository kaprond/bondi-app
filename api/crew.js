// Link preview for a crew invite: https://<site>/c/<crew id>?i=<invite code>&from=<handle>
// WhatsApp, iMessage etc. read the og tags (crew name, size); people are sent on to the app,
// which joins them to the crew and makes them friends with whoever shared it.
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

module.exports = async (req, res) => {
  const url = new URL(req.url, `https://${req.headers.host}`);
  const id = (url.searchParams.get('id') || '').toLowerCase();
  const code = (url.searchParams.get('i') || '').toUpperCase().replace(/[^A-Z0-9-]/g, '');
  const from = (url.searchParams.get('from') || '').toLowerCase().replace(/[^a-z0-9._]/g, '');
  const site = `https://${req.headers.host}`;
  const target = `${site}/?crew=${encodeURIComponent(id)}${code ? `&i=${code}` : ''}${from ? `&from=${from}` : ''}`;

  let p = null;
  if (/^[0-9a-f-]{36}$/.test(id) && SUPABASE_URL && SUPABASE_KEY) {
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/crew_preview`, {
        method: 'POST',
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_group: id }),
      });
      if (r.ok) p = await r.json();
    } catch { /* fall back to the generic card */ }
  }

  const who = from ? `@${from}` : 'a friend';
  const title = p ? `${p.emoji || '🎉'} join ${p.name} on LetsJam` : 'join my crew on LetsJam';
  const desc = p
    ? `${who} wants you in ${p.name}${p.members > 1 ? ` (${p.members} in already)` : ''}${p.open_pools ? `, ${p.open_pools} open ${p.open_pools === 1 ? 'pool' : 'pools'} waiting` : ''}. call it with your crew: friend pools, free coins, no cash.`
    : `${who} wants you in their crew. friend pools, free coins, no cash.`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=60');
  res.end(`<!doctype html>
<html lang="en"><head>
<meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)} · LetsJam</title>
<meta name="description" content="${esc(desc)}" />
<meta property="og:type" content="website" /><meta property="og:site_name" content="LetsJam" />
<meta property="og:title" content="${esc(title)}" /><meta property="og:description" content="${esc(desc)}" />
<meta property="og:url" content="${esc(site + url.pathname)}" /><meta property="og:image" content="${p ? `${site}/api/card?crew=${encodeURIComponent(id)}${from ? `&from=${from}` : ''}&n=${p.members}` : `${site}/og.png`}" />
<meta property="og:image:width" content="1200" /><meta property="og:image:height" content="630" />
<meta name="twitter:card" content="summary_large_image" />
<meta http-equiv="refresh" content="0; url=${esc(target)}" />
<style>body{margin:0;font-family:-apple-system,system-ui,sans-serif;background:#28275F;color:#fff;display:grid;place-items:center;min-height:100vh;text-align:center;padding:24px}a{color:#FFF000}</style>
</head><body><div><h2>${esc(title)}</h2><p>${esc(desc)}</p><p><a href="${esc(target)}">open LetsJam</a></p></div>
<script>location.replace(${JSON.stringify(target)})</script></body></html>`);
};
