import type { ChallengeMode } from './challenges';

/** Deadline presets the create screen understands. */
export type DeadlineKey = 'none' | '1h' | 'tonight' | '24h' | 'weekend' | '3d' | '1w';

/**
 * One-tap pool templates: the everyday pools crews actually make.
 * `members` templates put up to `pick` friends from the crew as the options.
 * Checked against the blocked-topic list in templates.test.mjs.
 */
export interface QuickTemplate {
  key: string; emoji: string; label: string; question: string;
  mode: ChallengeMode; outcomes?: string[]; pick?: number; deadline: DeadlineKey; stake?: number;
}

export const QUICK: QuickTemplate[] = [
  { key: 'late', emoji: '⏰', label: 'who’s late?', question: 'who shows up last tonight?', mode: 'members', pick: 4, deadline: 'tonight' },
  { key: 'match', emoji: '⚽', label: 'match result', question: 'who wins the match?', mode: 'custom', outcomes: ['home', 'draw', 'away'], deadline: 'tonight' },
  { key: 'textback', emoji: '📱', label: 'texts back?', question: 'do they text back before midnight?', mode: 'yesno', deadline: 'tonight' },
  { key: 'overunder', emoji: '📈', label: 'over / under', question: 'over or under 10k steps today?', mode: 'custom', outcomes: ['over', 'under'], deadline: 'tonight' },
  { key: 'gamenight', emoji: '🎮', label: 'game night', question: 'who wins game night?', mode: 'members', pick: 4, deadline: 'tonight' },
  { key: 'caves', emoji: '🫠', label: 'who caves first?', question: 'who caves first and orders takeaway this week?', mode: 'members', pick: 3, deadline: '1w' },
  { key: 'dinner', emoji: '🍕', label: 'where we eat', question: 'where do we end up eating?', mode: 'custom', outcomes: ['pizza', 'sushi', 'burgers'], deadline: 'tonight' },
  { key: 'rain', emoji: '🌧️', label: 'weekend rain', question: 'does it rain on saturday?', mode: 'yesno', deadline: 'weekend' },
  { key: 'plans', emoji: '🗓️', label: 'plans happen?', question: 'do the weekend plans actually happen?', mode: 'yesno', deadline: 'weekend' },
];

/** 'tonight' = 23:00 today (or tomorrow if under an hour away); 'weekend' = sunday 20:00 (next one if it's past). */
export function deadlineFor(key: DeadlineKey, now = new Date()): string | undefined {
  const mins: Partial<Record<DeadlineKey, number>> = { '1h': 60, '24h': 1440, '3d': 4320, '1w': 10080 };
  if (key === 'none') return undefined;
  if (mins[key]) return new Date(now.getTime() + mins[key]! * 60000).toISOString();
  const d = new Date(now);
  if (key === 'tonight') {
    d.setHours(23, 0, 0, 0);
    if (d.getTime() - now.getTime() < 3600000) d.setDate(d.getDate() + 1);
    return d.toISOString();
  }
  // weekend
  d.setHours(20, 0, 0, 0);
  d.setDate(d.getDate() + ((7 - d.getDay()) % 7));
  if (d.getTime() - now.getTime() < 3600000) d.setDate(d.getDate() + 7);
  return d.toISOString();
}
