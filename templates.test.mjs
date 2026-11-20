// node templates.test.mjs  (after compiling src/ to .testbuild with tsc)
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { QUICK, MATCH, deadlineFor } = require('./.testbuild/templates.js');
const { blockedTopic } = require('./.testbuild/moderation.js');
for (const t of [...QUICK, ...MATCH]) {
  const hit = blockedTopic(`${t.question} ${(t.outcomes ?? []).join(' ')}`);
  if (hit) throw new Error(`template "${t.key}" hits blocked topic: ${hit}`);
  if (t.mode === 'custom' && (t.outcomes ?? []).length < 2) throw new Error(`template "${t.key}" needs 2+ outcomes`);
}
// tonight: 23:00 same day, or next day when under an hour away
const at = (s) => new Date(s);
const tn = at(deadlineFor('tonight', at('2026-11-20T15:00:00')));
if (tn.getHours() !== 23 || tn.getDate() !== 20) throw new Error('tonight wrong: ' + tn);
const late = at(deadlineFor('tonight', at('2026-11-20T22:30:00')));
if (late.getDate() !== 21) throw new Error('late tonight should roll over: ' + late);
// weekend: sunday 20:00
const wk = at(deadlineFor('weekend', at('2026-11-20T15:00:00'))); // friday
if (wk.getDay() !== 0 || wk.getHours() !== 20 || wk.getDate() !== 22) throw new Error('weekend wrong: ' + wk);
const sunLate = at(deadlineFor('weekend', at('2026-11-22T19:30:00')));
if (sunLate.getDate() !== 29) throw new Error('sunday evening should roll to next week: ' + sunLate);
if (deadlineFor('none') !== undefined) throw new Error('none should be undefined');
const five = Date.parse(deadlineFor('5m', at('2026-11-20T15:00:00'))) - at('2026-11-20T15:00:00').getTime();
if (five !== 300000) throw new Error('5m wrong: ' + five);
console.log(`ok: ${QUICK.length + MATCH.length} quick templates pass moderation, deadlines right`);
