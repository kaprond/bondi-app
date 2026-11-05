/**
 * Weekly leagues: you, your friends and other players, ranked by coins won since Monday.
 * Top 5 move up a tier, bottom 5 move down. In the demo the other players are simulated
 * deterministically from the week, so everyone sees the same board grow through the week.
 */
export const TIERS = [
  { name: 'bronze', emoji: '🥉', color: '#C98A4B' },
  { name: 'silver', emoji: '🥈', color: '#9FB3BC' },
  { name: 'gold', emoji: '🥇', color: '#FFD639' },
  { name: 'diamond', emoji: '💎', color: '#8FD3E3' },
] as const;
export const LEAGUE_SIZE = 20;
export const UP = 5;
export const DOWN = 5;

const pad = (n: number) => String(n).padStart(2, '0');
/** Monday 00:00 local time of the week containing d. */
export function weekStart(d = new Date()): Date {
  const s = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  s.setDate(s.getDate() - ((s.getDay() + 6) % 7));
  return s;
}
export const weekKey = (d = new Date()) => { const s = weekStart(d); return `${s.getFullYear()}-${pad(s.getMonth() + 1)}-${pad(s.getDate())}`; };
/** 0 at Monday 00:00, 1 at the end of Sunday. */
export function weekProgress(d = new Date()): number {
  const s = weekStart(d).getTime();
  return Math.min(Math.max((d.getTime() - s) / (7 * 864e5), 0), 1);
}
export function endsIn(d = new Date()): string {
  const ms = weekStart(d).getTime() + 7 * 864e5 - d.getTime();
  const days = Math.floor(ms / 864e5), hours = Math.floor((ms % 864e5) / 36e5);
  return days > 0 ? `${days}d ${hours}h` : `${hours}h ${Math.floor((ms % 36e5) / 6e4)}m`;
}

function rng(seed: string) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
}

const NAMES = ['bram', 'fenna', 'yara', 'luuk', 'sanne', 'mo', 'ilse', 'thijs', 'noa', 'jesse', 'roos', 'milan', 'zoë', 'ruben', 'evi', 'sem', 'lieke', 'daan.v', 'iris', 'kees', 'anouk', 'joep', 'femke', 'stijn', 'nina', 'tim', 'eva', 'bas'];
const EMOJI = ['🦊', '🐙', '🛵', '🌊', '🍕', '🎧', '🐸', '🦄', '🔥', '🌵', '🏄', '😎'];
const COLORS = ['#0095B6', '#FFD639', '#E16632', '#2433A0', '#8FD3E3', '#14B87A', '#FF8FB1', '#005264'];

export interface Row { id: string; name: string; emoji?: string; color?: string; won: number; you?: boolean; friend?: boolean; rank: number }

/** Final weekly total for a simulated player, scaled by tier. */
function finalFor(id: string, week: string, tier: number) {
  const r = rng(`${week}|${tier}|${id}`);
  const x = r();
  if (x < 0.2) return Math.round(300 * x); // some players barely show up this week
  return Math.round((80 + 2000 * r() ** 1.8) * [0.35, 0.8, 1.5, 2.4][tier]);
}
/** Where a simulated player is at this point of the week (slightly uneven, never down). */
const atProgress = (final: number, id: string, week: string, p: number) => {
  const lean = 0.7 + 0.6 * rng(`${week}|lean|${id}`)();
  return Math.round(final * Math.min(1, p ** lean));
};

export function standings(opts: { myWon: number; tier: number; week?: string; progress?: number; friends?: { id: string; name: string; emoji: string; color: string }[] }): Row[] {
  const week = opts.week ?? weekKey();
  const p = opts.progress ?? weekProgress();
  const friends = (opts.friends ?? []).slice(0, 6);
  const r = rng(`${week}|${opts.tier}|names`);
  const pool = [...NAMES];
  const bots = Array.from({ length: LEAGUE_SIZE - 1 - friends.length }, (_, i) => {
    const name = pool.splice(Math.floor(r() * pool.length), 1)[0] ?? `player${i}`;
    return { id: `bot:${name}`, name, emoji: EMOJI[Math.floor(r() * EMOJI.length)], color: COLORS[Math.floor(r() * COLORS.length)] };
  });
  const rows: Omit<Row, 'rank'>[] = [
    ...friends.map((f) => ({ ...f, friend: true, won: atProgress(finalFor(f.id, week, opts.tier), f.id, week, p) })),
    ...bots.map((b) => ({ ...b, won: atProgress(finalFor(b.id, week, opts.tier), b.id, week, p) })),
    { id: 'me', name: 'you', won: opts.myWon, you: true },
  ];
  // ties: you rank above others with the same coins
  rows.sort((a, b) => b.won - a.won || (a.you ? -1 : b.you ? 1 : 0));
  return rows.map((x, i) => ({ ...x, rank: i + 1 }));
}

/** Tier change after a finished week, from your final rank. */
export function nextTier(tier: number, rank: number): number {
  if (rank <= UP) return Math.min(tier + 1, TIERS.length - 1);
  if (rank > LEAGUE_SIZE - DOWN) return Math.max(tier - 1, 0);
  return tier;
}
