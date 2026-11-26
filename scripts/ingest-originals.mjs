#!/usr/bin/env node
// Loads LetsJam originals (AI clips) into the live feed.
//
//   SUPABASE_SERVICE_ROLE_KEY=... node scripts/ingest-originals.mjs scripts/originals.json
//
// For each clip in the manifest: download the full video, cut it at `pause` into
// a teaser (public, stops before the outcome) and a reveal (private), upload both,
// then insert the clip as live with its outcome committed (sha256 of id|outcome|salt).
// Needs ffmpeg on PATH (brew install ffmpeg). Safe to re-run: clips already loaded are skipped.
import { createClient } from '@supabase/supabase-js';
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const URL = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://poklkxdpxtqinrpoizlm.supabase.co';
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!KEY) { console.error('Set SUPABASE_SERVICE_ROLE_KEY (Supabase dashboard → Project Settings → API keys → service_role / secret).'); process.exit(1); }
const manifest = JSON.parse(readFileSync(process.argv[2] || 'scripts/originals.json', 'utf8'));
try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); } catch { console.error('ffmpeg not found. Run: brew install ffmpeg'); process.exit(1); }

const sb = createClient(URL, KEY, { auth: { persistSession: false } });
// Stable id per clip key, so re-runs never duplicate.
const idFor = (key) => {
  const h = createHash('sha256').update('letsjam-original:' + key).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
const ff = (args) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args]);

let ok = 0, skipped = 0, failed = 0;
for (const c of manifest.clips) {
  const id = idFor(c.key);
  const { data: existing } = await sb.from('clips').select('id').eq('id', id).maybeSingle();
  if (existing) { console.log(`= ${c.key} already live`); skipped++; continue; }
  const dir = mkdtempSync(join(tmpdir(), 'lj-'));
  try {
    process.stdout.write(`↓ ${c.key} … `);
    const res = await fetch(c.url);
    if (!res.ok) throw new Error(`download ${res.status} (link expired? ask Claude for a fresh originals.json)`);
    const full = join(dir, 'full.mp4');
    writeFileSync(full, Buffer.from(await res.arrayBuffer()));
    const teaser = join(dir, 'teaser.mp4'), reveal = join(dir, 'reveal.mp4'), poster = join(dir, 'poster.jpg');
    // Re-encode so the cut is frame-accurate (stream copy would snap to a keyframe and could leak the outcome).
    const enc = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-c:a', 'aac', '-b:a', '96k'];
    ff(['-i', full, '-t', String(c.pause), ...enc, teaser]);
    ff(['-ss', String(c.pause), '-i', full, ...enc, reveal]);
    ff(['-ss', String(Math.max(0, c.pause - 0.15)), '-i', full, '-frames:v', '1', '-q:v', '4', poster]);
    const duration = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', full]).toString().trim());

    const tPath = `originals/${c.key}.mp4`, pPath = `originals/${c.key}.jpg`, rPath = `originals/${c.key}.mp4`;
    for (const [bucket, path, file, type] of [['teasers', tPath, teaser, 'video/mp4'], ['teasers', pPath, poster, 'image/jpeg'], ['reveals', rPath, reveal, 'video/mp4']]) {
      const up = await sb.storage.from(bucket).upload(path, readFileSync(file), { contentType: type, upsert: true });
      if (up.error) throw new Error(`${bucket}: ${up.error.message}`);
    }
    const teaserUrl = sb.storage.from('teasers').getPublicUrl(tPath).data.publicUrl;
    const salt = randomBytes(16).toString('hex');
    const commit = createHash('sha256').update(`${id}|${c.outcome}|${salt}`).digest('hex');
    const { error } = await sb.from('clips').insert({
      id, title: c.title, creator: '@letsjam.originals', question: c.question,
      label_a: c.label_a, label_b: c.label_b, odds_a: c.odds_a, odds_b: c.odds_b,
      teaser_asset_id: teaserUrl, reveal_asset_id: rPath, outcome: c.outcome, salt, commit_hash: commit,
      status: 'live', committed_at: new Date().toISOString(), pause_at: c.pause, duration,
    });
    if (error) throw new Error(error.message);
    console.log('live'); ok++;
  } catch (e) {
    console.log(`FAILED: ${e.message}`); failed++;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
console.log(`\n${ok} added, ${skipped} already live, ${failed} failed.`);
