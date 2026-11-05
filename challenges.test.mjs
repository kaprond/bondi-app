// node challenges.test.mjs  (after compiling src/ to .testbuild with tsc)
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { blockedTemplates, randomChallenge, TEMPLATES } = require('./.testbuild/challenges.js');
const { blockedTopic } = require('./.testbuild/moderation.js');
const bad = blockedTemplates();
if (bad.length) { console.error('blocked templates:', bad); process.exit(1); }
let n = 0, last;
for (let i = 0; i < 2000; i++) {
  const c = randomChallenge({ crewMemberIds: ['me', 'alex', 'sam', 'jordan'], avoid: last });
  if (c.key === last) throw new Error('reroll repeated');
  if (blockedTopic(c.question + ' ' + c.outcomes.join(' '))) throw new Error('blocked: ' + c.question);
  if (c.outcomes.length < 2) throw new Error('too few outcomes: ' + c.question);
  if (c.memberIds.includes('me') || c.subjectId === 'me') throw new Error('me in options');
  if (/\{|\}/.test(c.question)) throw new Error('unfilled slot: ' + c.question);
  last = c.key; n++;
}
const small = randomChallenge({ crewMemberIds: ['me', 'alex'] });
if (small.mode === 'members' && small.memberIds.length > 1) throw new Error('too many members for small crew');
console.log(`ok: ${TEMPLATES.length} templates pass moderation, ${n} random challenges valid`);
for (let i = 0; i < 500; i++) {
  const c = randomChallenge({ crewMemberIds: ['me', 'alex', 'sam', 'jordan'], focusId: 'jordan' });
  if (c.subjectId !== 'jordan' && !c.memberIds.includes('jordan')) throw new Error('focus missing: ' + c.question);
}
console.log('ok: focused challenges always include the friend');
