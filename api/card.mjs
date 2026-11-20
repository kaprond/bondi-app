// Card images, 1200×630 PNG:
//   /api/card?id=<pool id>    result card for a settled pool (og:image on /r/<id>, the preview *is* the brag)
//   /api/card?pool=<pool id>  live pool card: question, options with who's in, pot, deadline (og:image on /p/<id>)
import { ImageResponse } from '@vercel/og';
import { readFileSync } from 'node:fs';

export const FONTS = [
  { name: 'Baloo', data: readFileSync(new URL('./_fonts/Baloo2_600SemiBold.ttf', import.meta.url)), weight: 600, style: 'normal' },
  { name: 'Baloo', data: readFileSync(new URL('./_fonts/Baloo2_800ExtraBold.ttf', import.meta.url)), weight: 800, style: 'normal' },
];

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

async function rpcPublic(fn, id) {
  if (!/^[0-9a-f-]{36}$/.test(id) || !SUPABASE_URL || !SUPABASE_KEY) return null;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_pool: id }),
    });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

export async function loadResult(id) {
  if (!/^[0-9a-f-]{36}$/.test(id) || !SUPABASE_URL || !SUPABASE_KEY) return null;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/result_preview`, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_pool: id }),
    });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

const h = (type, style, ...children) => ({ type, props: { style: { display: 'flex', ...style }, children: children.length === 1 ? children[0] : children } });
const noEmoji = (s) => String(s).replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, '').trim();
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

export function card(r) {
  const names = (r?.called_it ?? []).filter(Boolean).map((n) => '@' + n);
  const who = names.length === 0 ? 'nobody' : names.length <= 2 ? names.join(' & ') : `${names.slice(0, 2).join(', ')} +${names.length - 2}`;
  const each = r && names.length ? Math.floor(r.pot / names.length) : 0;
  return h('div', { width: 1200, height: 630, flexDirection: 'column', justifyContent: 'space-between', padding: '56px 64px', background: 'linear-gradient(135deg, #28275F 0%, #1765A9 60%, #0095B6 100%)', color: '#fff', fontFamily: 'Baloo', fontWeight: 600 },
    h('div', { alignItems: 'center', justifyContent: 'space-between' },
      h('div', { fontSize: 34, fontWeight: 800, color: '#FFF000', letterSpacing: 2 }, r ? `${clip(r.crew, 24).toUpperCase()}${r.round > 1 ? ` · ROUND ${r.round}` : ''}` : 'LETSJAM'),
      r ? h('div', { fontSize: 30, fontWeight: 800, background: '#fff', color: '#28275F', padding: '6px 26px', borderRadius: 999 }, 'settled') : h('div', {}, '')),
    h('div', { flexDirection: 'column' },
      h('div', { fontSize: 40, color: 'rgba(255,255,255,0.8)', marginBottom: 18 }, r ? clip(r.question, 70) : 'friend pools with free coins'),
      h('div', { fontSize: 92, fontWeight: 800, lineHeight: 1 }, r ? clip(r.winner ?? '', 28) : 'call it with your crew'),
      h('div', { fontSize: 44, fontWeight: 800, color: '#F9C500', marginTop: 20 }, r ? `${clip(who, 40)} called it` : ''),
      r?.forfeit ? h('div', { fontSize: 32, color: '#fff', marginTop: 10 }, `wrong side ${clip(noEmoji(r.forfeit), 50)}`) : h('div', {}, ''),
      r?.proof ? h('div', { fontSize: 26, color: '#F9C500', marginTop: 8 }, 'photo proof attached') : h('div', {}, '')),
    h('div', { alignItems: 'flex-end', justifyContent: 'space-between' },
      h('div', { fontSize: 32, color: 'rgba(255,255,255,0.85)' }, r ? `${r.players} played · ${r.pot} coins in the pot${each ? ` · ${each} each` : ''}` : ''),
      h('div', { fontSize: 56, fontWeight: 800, color: '#fff' }, 'letsjam')));
}

function left(iso) {
  const ms = Date.parse(iso) - Date.now();
  if (!(ms > 0)) return 'closing now';
  const h = Math.floor(ms / 3600000);
  return h >= 48 ? `closes in ${Math.floor(h / 24)} days` : h >= 1 ? `closes in ${h}h` : `closes in ${Math.max(1, Math.floor(ms / 60000))} min`;
}

export function poolCard(p) {
  const opts = (p?.options ?? []).slice(0, 4);
  const players = p?.players ?? 0;
  const who = p ? (p.crew_size > players ? `${players} of ${p.crew_size} called it` : `${players} in`) : '';
  return h('div', { width: 1200, height: 630, flexDirection: 'column', justifyContent: 'space-between', padding: '52px 64px', background: 'linear-gradient(135deg, #28275F 0%, #1765A9 60%, #0095B6 100%)', color: '#fff', fontFamily: 'Baloo', fontWeight: 600 },
    h('div', { alignItems: 'center', justifyContent: 'space-between' },
      h('div', { fontSize: 32, fontWeight: 800, color: '#FFF000', letterSpacing: 2 }, p ? clip(noEmoji(p.crew), 26).toUpperCase() : 'LETSJAM'),
      p ? h('div', { fontSize: 28, fontWeight: 800, background: '#FFF000', color: '#28275F', padding: '6px 24px', borderRadius: 999 }, p.closes_at ? left(p.closes_at) : 'make your call') : h('div', {}, '')),
    h('div', { flexDirection: 'column' },
      h('div', { fontSize: 64, fontWeight: 800, lineHeight: 1.05, marginBottom: 22 }, p ? clip(noEmoji(p.question), 80) : 'call it with your crew'),
      h('div', { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
        ...(opts.length ? opts : [{ label: 'yes', n: 0 }, { label: 'no', n: 0 }]).map((o) =>
          h('div', { alignItems: 'center', gap: 12, background: 'rgba(255,255,255,0.14)', border: '2px solid rgba(255,255,255,0.35)', borderRadius: 999, padding: '8px 26px', fontSize: 34, fontWeight: 800 },
            clip(noEmoji(o.label), 22), h('div', { fontSize: 28, color: '#F9C500' }, o.n ? `${o.n}` : ''))))),
    h('div', { alignItems: 'flex-end', justifyContent: 'space-between' },
      h('div', { flexDirection: 'column', fontSize: 32, color: 'rgba(255,255,255,0.9)' },
        h('div', {}, p ? `${who} · ${p.pot} coins in the pot` : 'free coins, no cash'),
        p?.forfeit ? h('div', { fontSize: 28, color: '#fff' }, `wrong side ${clip(noEmoji(p.forfeit), 48)}`) : h('div', {}, '')),
      h('div', { fontSize: 56, fontWeight: 800, color: '#fff' }, 'letsjam')));
}

export async function GET(req) {
  const q = new URL(req.url, 'https://x').searchParams;
  const poolId = (q.get('pool') || '').toLowerCase();
  if (poolId) {
    const p = await rpcPublic('pool_preview', poolId);
    return new ImageResponse(poolCard(p), { width: 1200, height: 630, fonts: FONTS, headers: { 'Cache-Control': 'public, max-age=300, s-maxage=300' } });
  }
  const id = (q.get('id') || '').toLowerCase();
  const r = await loadResult(id);
  return new ImageResponse(card(r), {
    width: 1200, height: 630, fonts: FONTS,
    headers: { 'Cache-Control': r ? 'public, max-age=86400, s-maxage=86400, immutable' : 'public, max-age=60' },
  });
}
