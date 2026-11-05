import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const L = require('./.testbuild/league.js');
const M = require('./.testbuild/missions.js');

// league: 20 rows, deterministic, monotonic over the week, you're always in it
const friends = [{ id: 'alex', name: 'alex', emoji: '🦊', color: '#FFD639' }, { id: 'sam', name: 'sam', emoji: '🍕', color: '#E16632' }];
const a = L.standings({ myWon: 300, tier: 1, week: '2026-11-02', progress: 0.4, friends });
const b = L.standings({ myWon: 300, tier: 1, week: '2026-11-02', progress: 0.4, friends });
assert.equal(a.length, L.LEAGUE_SIZE);
assert.deepEqual(a, b);
assert.equal(a.filter((r) => r.you).length, 1);
assert.equal(new Set(a.map((r) => r.id)).size, L.LEAGUE_SIZE);
for (let i = 1; i < a.length; i++) assert.ok(a[i - 1].won >= a[i].won);
for (const id of a.map((r) => r.id).filter((x) => x !== 'me')) {
  let prev = -1;
  for (let p = 0; p <= 1.0001; p += 0.1) {
    const row = L.standings({ myWon: 0, tier: 1, week: '2026-11-02', progress: Math.min(p, 1), friends }).find((r) => r.id === id);
    assert.ok(row.won >= prev, `${id} went down`); prev = row.won;
  }
}
assert.equal(L.standings({ myWon: 1e9, tier: 0, week: 'w', progress: 1 })[0].you, true);
assert.equal(L.nextTier(0, 1), 1); assert.equal(L.nextTier(3, 1), 3); assert.equal(L.nextTier(2, 20), 1); assert.equal(L.nextTier(0, 20), 0); assert.equal(L.nextTier(1, 10), 1);
assert.equal(L.weekKey(new Date(2026, 10, 8, 23, 0)), '2026-11-02'); // Sunday belongs to the week starting Monday 2 Nov
assert.equal(L.weekKey(new Date(2026, 10, 9, 0, 1)), '2026-11-09');
console.log('ok: league standings are stable, ranked and only grow');

// missions
let t = M.emptyToday('d1');
t = M.afterCall(t, true, false, 'd1'); t = M.afterCall(t, true, true, 'd1'); t = M.afterCall(t, false, true, 'd1');
assert.deepEqual([t.calls, t.wins, t.run, t.bestRun, t.underdogWins], [3, 2, 0, 2, 1]);
assert.ok(M.MISSIONS.filter((m) => m.id !== 'share').every((m) => M.isDone(m, t)));
t = M.afterCall(t, true, false, 'd2');
assert.deepEqual([t.day, t.calls, t.bestRun], ['d2', 1, 1]);
console.log('ok: missions count calls, runs and underdog wins, and reset each day');
