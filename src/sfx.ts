import { Platform } from 'react-native';
import { soundIsOn } from './session';

/**
 * Small synthesized sound effects (Web Audio, no files). Web only for now and only when
 * sound is on. Native keeps using haptics.
 */
type Ctx = AudioContext;
let ctx: Ctx | null = null;
function ac(): Ctx | null {
  if (Platform.OS !== 'web' || !soundIsOn()) return null;
  const W = globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  const C = W.AudioContext ?? W.webkitAudioContext;
  if (!C) return null;
  try { ctx = ctx ?? new C(); if (ctx.state === 'suspended') ctx.resume(); return ctx; } catch { return null; }
}

function tone(c: Ctx, freq: number, at: number, dur: number, opts: { type?: OscillatorType; gain?: number; to?: number } = {}) {
  const o = c.createOscillator(), g = c.createGain();
  o.type = opts.type ?? 'sine';
  o.frequency.setValueAtTime(freq, c.currentTime + at);
  if (opts.to) o.frequency.exponentialRampToValueAtTime(opts.to, c.currentTime + at + dur);
  const v = opts.gain ?? 0.12;
  g.gain.setValueAtTime(0.0001, c.currentTime + at);
  g.gain.exponentialRampToValueAtTime(v, c.currentTime + at + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + at + dur);
  o.connect(g).connect(c.destination);
  o.start(c.currentTime + at); o.stop(c.currentTime + at + dur + 0.02);
}

export const sfx = {
  /** the clip freezes */
  pause() { const c = ac(); if (!c) return; tone(c, 880, 0, 0.09, { type: 'triangle' }); tone(c, 660, 0.07, 0.16, { type: 'triangle' }); },
  /** picking a side or a stake */
  tick() { const c = ac(); if (!c) return; tone(c, 1400, 0, 0.04, { type: 'square', gain: 0.04 }); },
  /** lock it in */
  lock() { const c = ac(); if (!c) return; tone(c, 300, 0, 0.12, { type: 'sawtooth', gain: 0.05, to: 600 }); },
  win() { const c = ac(); if (!c) return; [523, 659, 784, 1047].forEach((f, i) => tone(c, f, i * 0.08, 0.22, { type: 'triangle', gain: 0.1 })); },
  lose() { const c = ac(); if (!c) return; tone(c, 392, 0, 0.2, { type: 'triangle', gain: 0.09 }); tone(c, 311, 0.16, 0.34, { type: 'triangle', gain: 0.09, to: 260 }); },
  coins() { const c = ac(); if (!c) return; [1319, 1568, 2093].forEach((f, i) => tone(c, f, i * 0.06, 0.12, { type: 'sine', gain: 0.07 })); },
};
