// Writes one tiny page per feed clip at <out>/c/<id>.html. Link previews (WhatsApp, iMessage, X)
// read its tags and show the paused frame with the question; people are sent straight on to
// the app, which opens that clip first.   node scripts/clip-pages.mjs dist
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://bondi-app-one.vercel.app';

export function feedClips(src = readFileSync(join(root, 'src/api.ts'), 'utf8')) {
  const get = (line, k) => line.match(new RegExp(`${k}: '((?:[^'\\\\]|\\\\.)*)'`))?.[1].replace(/\\'/g, "'");
  return src.split('\n').filter((l) => l.trim().startsWith("{ id: '"))
    .map((l) => ({ id: get(l, 'id'), title: get(l, 'title'), question: get(l, 'question'), labelA: get(l, 'labelA'), labelB: get(l, 'labelB') }));
}

const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function page(c) {
  const title = esc(`can you call it? ${c.question}`);
  const desc = esc(`${c.labelA} or ${c.labelB}? the clip pauses right before the moment. free coins, no cash.`);
  const img = `${SITE}/og/${c.id}.jpg`, url = `${SITE}/c/${c.id}`;
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title} · bondi</title>
<meta name="description" content="${desc}" />
<meta property="og:type" content="website" /><meta property="og:site_name" content="bondi" />
<meta property="og:title" content="${title}" /><meta property="og:description" content="${desc}" />
<meta property="og:url" content="${url}" /><meta property="og:image" content="${img}" />
<meta property="og:image:width" content="1200" /><meta property="og:image:height" content="630" />
<meta name="twitter:card" content="summary_large_image" /><meta name="twitter:title" content="${title}" />
<meta name="twitter:description" content="${desc}" /><meta name="twitter:image" content="${img}" />
<meta name="theme-color" content="#0095B6" />
<style>body{margin:0;height:100vh;display:grid;place-items:center;background:#0095B6;color:#fff;font:700 18px system-ui,sans-serif}a{color:#fff}</style>
<script>location.replace('/?c=${c.id}' + (location.search ? '&' + location.search.slice(1) : ''));</script>
</head><body><a href="/?c=${c.id}">open the clip on bondi</a></body></html>
`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = join(process.argv[2] ?? 'dist', 'c');
  mkdirSync(out, { recursive: true });
  for (const c of feedClips()) writeFileSync(join(out, `${c.id}.html`), page(c));
  console.log(`clip pages: ${feedClips().length} written to ${out}`);
}
