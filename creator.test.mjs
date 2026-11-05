import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const C = require('./.testbuild/creator.js');

// commission: 5% of the stake, at least 1 coin
assert.deepEqual([10, 20, 50, 100].map(C.commissionFor), [1, 1, 2, 5]);
assert.equal(C.underCap(0, 5), 5);
assert.equal(C.underCap(1998, 5), 2);
assert.equal(C.underCap(2000, 5), 0);
assert.equal(C.underCap(2500, 5), 0);
console.log('ok: commission is 5% of the stake, min 1, capped at 2,000 a day');

// drafts: a full one passes; every missing piece is called out
const good = { title: 'bottle flip off the bridge', question: 'does it land?', labelA: 'lands it', labelB: 'tips over', outcome: 'a', pauseAt: 6, duration: 9, rights: true };
assert.deepEqual(C.draftProblems(good), []);
const bad = (p) => C.draftProblems({ ...good, ...p });
assert.ok(bad({ outcome: null }).some((x) => x.includes('really happens')));
assert.ok(bad({ rights: false }).some((x) => x.includes('everyone in it agreed')));
assert.ok(bad({ duration: 0 }).some((x) => x.includes('pick a video')));
assert.ok(bad({ duration: 75 }).some((x) => x.includes('60 seconds')));
assert.ok(bad({ pauseAt: 1 }).some((x) => x.includes('setup')));
assert.ok(bad({ pauseAt: 8.5 }).some((x) => x.includes('reveal')));
assert.ok(bad({ labelB: 'Lands it' }).some((x) => x.includes('different')));
assert.ok(bad({ question: 'does he get drunk?' }).some((x) => x.includes('drinking')));
console.log('ok: drafts need an outcome, rights, a valid pause point and an allowed topic');

// demo simulation: deterministic, only grows, commission matches the stakes
let prev = 0;
for (let m = 0; m <= 600; m += 7) { const p = C.simulatedPlays('u1', m); assert.ok(p >= prev); prev = p; }
assert.equal(C.simulatedPlays('u1', 30), C.simulatedPlays('u1', 30));
assert.equal(C.simulatedPlays('u1', 0), 0);
const t = C.simulatedTake('u1', 200);
assert.deepEqual(t, C.simulatedTake('u1', 200));
assert.ok(t.earned >= 200 && t.earned <= 1000 && t.staked >= 2000);
const t2 = C.simulatedTake('u1', 201);
assert.ok(t2.earned > t.earned && t2.staked > t.staked);
console.log('ok: simulated plays are stable and only grow');
