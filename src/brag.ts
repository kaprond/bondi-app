import { Platform } from 'react-native';
import { shareText } from './share';

/**
 * The "brag" card: a 1080x1350 image of your call, made on the device (canvas, web) and handed
 * to the share sheet with your invite link. Falls back to sharing text where images can't be shared.
 */
export interface BragInput { question: string; answer: string; net: number; crowd: number; streak: number; link: string; text: string }

function draw(b: BragInput): HTMLCanvasElement {
  const doc = (globalThis as { document?: Document }).document!;
  const cv = doc.createElement('canvas'); cv.width = 1080; cv.height = 1350;
  const g = cv.getContext('2d')!;
  const bg = g.createLinearGradient(0, 0, 0, 1350); bg.addColorStop(0, '#54B8CE'); bg.addColorStop(1, '#0095B6');
  g.fillStyle = bg; g.fillRect(0, 0, 1080, 1350);
  // soft circles
  g.fillStyle = 'rgba(255,255,255,0.08)';
  g.beginPath(); g.arc(940, 180, 260, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.arc(80, 1240, 220, 0, Math.PI * 2); g.fill();
  const D = 'Baloo2_800ExtraBold, sans-serif', Q = 'Quicksand_700Bold, sans-serif';
  g.textBaseline = 'alphabetic';
  g.fillStyle = '#fff'; g.font = `96px ${D}`; g.fillText('bondi', 80, 170);
  const w = g.measureText('bondi').width; g.fillStyle = '#FFF000'; g.beginPath(); g.arc(80 + w + 22, 146, 13, 0, Math.PI * 2); g.fill();

  g.fillStyle = '#FFF000'; g.font = `190px ${D}`; g.fillText('called it!', 70, 450);
  g.fillStyle = '#fff'; g.font = `52px ${Q}`;
  wrap(g, b.question, 80, 560, 920, 66);

  // answer pill
  g.font = `56px ${D}`;
  const label = `it was “${b.answer}”`;
  const lw = g.measureText(label).width + 80;
  round(g, 80, 700, lw, 110, 55, '#fff');
  g.fillStyle = '#0095B6'; g.fillText(label, 120, 775);

  // coins
  g.fillStyle = '#FFD639'; g.beginPath(); g.arc(150, 960, 62, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#E8B800'; g.beginPath(); g.arc(150, 960, 46, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#fff'; g.font = `60px ${D}`; g.textAlign = 'center'; g.fillText('b', 150, 982); g.textAlign = 'left';
  g.fillStyle = '#fff'; g.font = `150px ${D}`; g.fillText(`+${b.net}`, 240, 1010);

  g.font = `46px ${Q}`; g.fillStyle = '#fff';
  const line = b.crowd < 40 ? `only ${b.crowd}% saw that coming` : `${b.crowd}% of players called it`;
  g.fillText(b.streak > 1 ? `${line} · 🔥 ${b.streak} in a row` : line, 80, 1110);

  round(g, 0, 1190, 1080, 160, 0, 'rgba(0,82,100,0.35)');
  g.fillStyle = '#fff'; g.font = `44px ${D}`; g.fillText('think you can call it?', 80, 1262);
  g.font = `36px ${Q}`; g.fillStyle = '#E3F4F8'; g.fillText(b.link.replace(/^https?:\/\//, '').replace(/\?.*$/, ''), 80, 1314);
  g.fillStyle = '#FFF000'; g.font = `32px ${Q}`; g.textAlign = 'right'; g.fillText('free coins · no cash · 18+', 1000, 1314); g.textAlign = 'left';
  return cv;
}

function round(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, fill: string) {
  g.fillStyle = fill; g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); g.fill();
}
function wrap(g: CanvasRenderingContext2D, text: string, x: number, y: number, max: number, lh: number) {
  let line = '';
  for (const word of text.split(' ')) {
    const t = line ? `${line} ${word}` : word;
    if (g.measureText(t).width > max && line) { g.fillText(line, x, y); y += lh; line = word; } else line = t;
  }
  if (line) g.fillText(line, x, y);
}

/** Exposed for tests and previews. */
export function bragDataUrl(b: BragInput): string | null {
  if (Platform.OS !== 'web') return null;
  try { return draw(b).toDataURL('image/png'); } catch { return null; }
}

export async function shareBrag(b: BragInput): Promise<'shared' | 'copied' | 'saved' | 'dismissed'> {
  if (Platform.OS !== 'web') return shareText(b.text, b.link);
  const nav = (globalThis as { navigator?: Navigator }).navigator;
  try {
    const blob = await new Promise<Blob | null>((res) => draw(b).toBlob(res, 'image/png'));
    if (blob) {
      const file = new File([blob], 'bondi-called-it.png', { type: 'image/png' });
      if (nav?.canShare?.({ files: [file] })) {
        try { await nav.share({ files: [file], text: `${b.text} ${b.link}` }); return 'shared'; } catch { return 'dismissed'; }
      }
      // desktop: save the image and copy the link
      const doc = (globalThis as { document?: Document }).document!;
      const a = doc.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file.name; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      try { await nav?.clipboard?.writeText(`${b.text} ${b.link}`); } catch { /* ignore */ }
      return 'saved';
    }
  } catch { /* fall through */ }
  return shareText(b.text, b.link);
}
