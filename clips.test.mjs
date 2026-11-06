// Every clip in the feed ships with its files, a link-preview card and an honest commit hash.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { feedClips, page } from './scripts/clip-pages.mjs';

const src = readFileSync('src/api.ts', 'utf8');
const clips = feedClips(src);
assert.ok(clips.length >= 8, 'feed parsed');
for (const c of clips) {
  for (const f of [`assets/clips/${c.id}-teaser.mp4`, `assets/clips/${c.id}-reveal.mp4`, `public/posters/${c.id}.jpg`, `public/og/${c.id}.jpg`]) assert.ok(existsSync(f), `missing ${f}`);
  const s = src.match(new RegExp(`${c.id}: secret\\('([ab])', '([^']+)'`));
  assert.ok(s, `no secret for ${c.id}`);
  const hash = src.match(new RegExp(`id: '${c.id}'.*commitHash: '([0-9a-f]{64})'`))[1];
  assert.equal(createHash('sha256').update(`${c.id}|${s[1]}|${s[2]}`).digest('hex'), hash, `${c.id} commit hash`);
  const html = page(c);
  assert.ok(html.includes(`/og/${c.id}.jpg`) && html.includes(`location.replace('/?c=${c.id}'`), `${c.id} page`);
}
assert.ok(page({ id: 'x1', title: 't', question: '<b>"hi"</b>', labelA: 'a', labelB: 'b' }).includes('&lt;b&gt;&quot;hi&quot;'), 'escapes html');
console.log(`ok: ${clips.length} clips have files, preview cards and matching commit hashes`);
