/**
 * Daily missions. Progress resets at midnight; each reward pays once a day.
 * Server-side twin: claim_mission() in supabase/migrations/0006_missions.sql checks the same rules against bets.
 */
export interface Today { day: string; calls: number; wins: number; run: number; bestRun: number; underdogWins: number; shared: number }
export interface Mission { id: string; emoji: string; label: string; goal: number; reward: number; value: (t: Today) => number }

export const MISSIONS: Mission[] = [
  { id: 'calls3', emoji: '🎯', label: 'make 3 calls', goal: 3, reward: 150, value: (t) => t.calls },
  { id: 'run2', emoji: '🔥', label: 'call 2 in a row', goal: 2, reward: 200, value: (t) => t.bestRun },
  { id: 'underdog', emoji: '🐺', label: 'win on the underdog (the higher odds)', goal: 1, reward: 250, value: (t) => t.underdogWins },
  { id: 'share', emoji: '📣', label: 'brag about a win or invite a friend', goal: 1, reward: 100, value: (t) => t.shared },
];

const pad = (n: number) => String(n).padStart(2, '0');
export const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const emptyToday = (day = dayKey()): Today => ({ day, calls: 0, wins: 0, run: 0, bestRun: 0, underdogWins: 0, shared: 0 });

/** Today's counters after one call. A new day starts from zero. */
export function afterCall(t: Today, won: boolean, underdog: boolean, day = dayKey()): Today {
  const base = t.day === day ? t : emptyToday(day);
  const run = won ? base.run + 1 : 0;
  return { ...base, calls: base.calls + 1, wins: base.wins + (won ? 1 : 0), run, bestRun: Math.max(base.bestRun, run), underdogWins: base.underdogWins + (won && underdog ? 1 : 0) };
}

export const progress = (m: Mission, t: Today) => Math.min(m.value(t), m.goal);
export const isDone = (m: Mission, t: Today) => m.value(t) >= m.goal;
