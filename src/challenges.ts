import { blockedTopic } from './moderation';
import { ME, nameOf } from './social';

/**
 * Random challenge generator for friend pools.
 * Every template is checked against the same blocked-topic list as user pools (see challenges.test.mjs).
 */

export type ChallengeMode = 'yesno' | 'members' | 'custom';
export interface Challenge {
  key: string; category: string; emoji: string; question: string;
  mode: ChallengeMode; outcomes: string[]; memberIds: string[]; subjectId?: string; stake: number;
}

interface Template {
  category: keyof typeof CATEGORIES;
  /** {a} and {b} are friends from the crew, {day} a day, {city} the crew's city. */
  q: string;
  mode: ChallengeMode;
  outcomes?: string[];
  /** 'a' means the question is about friend {a}, so they must consent and can't stake. */
  about?: 'a';
  /** For 'members' mode: how many friends to put up as options. */
  pick?: number;
}

export const CATEGORIES = {
  sport: { label: 'sport', emoji: '🏓' },
  games: { label: 'games', emoji: '🎮' },
  daily: { label: 'daily life', emoji: '☕️' },
  weather: { label: 'weather', emoji: '🌦️' },
  travel: { label: 'out and about', emoji: '🚲' },
  food: { label: 'food', emoji: '🍕' },
  music: { label: 'music and tv', emoji: '🎤' },
} as const;

export const TEMPLATES: Template[] = [
  { category: 'sport', q: 'who wins the next padel match?', mode: 'members', pick: 2 },
  { category: 'sport', q: 'who finishes sunday’s 5k first?', mode: 'members', pick: 3 },
  { category: 'sport', q: 'who gets the highest score at bowling on {day}?', mode: 'members', pick: 3 },
  { category: 'sport', q: 'how many goals in ajax’s next match?', mode: 'custom', outcomes: ['0 or 1', '2 or 3', '4 or more'] },
  { category: 'sport', q: 'does {a} hit 10,000 steps every day this week?', mode: 'yesno', about: 'a' },
  { category: 'games', q: 'who wins the next mario kart night?', mode: 'members', pick: 3 },
  { category: 'games', q: 'who wins at the next pub quiz?', mode: 'custom', outcomes: ['our team', 'any other team'] },
  { category: 'games', q: 'who wins the next round of catan?', mode: 'members', pick: 3 },
  { category: 'games', q: 'does {a} beat their wordle streak this month?', mode: 'yesno', about: 'a' },
  { category: 'daily', q: 'does {a} keep their duolingo streak all week?', mode: 'yesno', about: 'a' },
  { category: 'daily', q: 'does the group chat hit 500 messages today?', mode: 'yesno' },
  { category: 'daily', q: 'who replies last in the group chat today?', mode: 'members', pick: 3 },
  { category: 'daily', q: 'does {a} wake up before 8 on {day}?', mode: 'yesno', about: 'a' },
  { category: 'daily', q: 'does {a} finish their book before the end of the month?', mode: 'yesno', about: 'a' },
  { category: 'weather', q: 'will it rain in {city} on {day}?', mode: 'yesno' },
  { category: 'weather', q: 'does it snow in {city} before december?', mode: 'yesno' },
  { category: 'weather', q: 'how warm does it get in {city} on {day}?', mode: 'custom', outcomes: ['under 10°', '10 to 15°', 'over 15°'] },
  { category: 'travel', q: 'does the 18:04 train leave on time?', mode: 'yesno' },
  { category: 'travel', q: 'who arrives last to {day}’s dinner?', mode: 'members', pick: 3 },
  { category: 'travel', q: 'first to spot a heron on the canal walk?', mode: 'members', pick: 3 },
  { category: 'food', q: 'does the pizza arrive within 30 minutes?', mode: 'yesno' },
  { category: 'food', q: 'who guesses the dinner bill closest?', mode: 'members', pick: 3 },
  { category: 'food', q: 'does {a} try the spiciest thing on the menu?', mode: 'yesno', about: 'a' },
  { category: 'music', q: 'who gets the loudest cheer at karaoke?', mode: 'members', pick: 3 },
  { category: 'music', q: 'which song gets played first at the party?', mode: 'custom', outcomes: ['something from the 2000s', 'something from this year', 'a dutch classic'] },
  { category: 'music', q: 'does the season finale beat the first episode’s ratings?', mode: 'yesno' },
];

const DAYS = ['friday', 'saturday', 'sunday'];
const STAKES = [10, 50, 100];

function shuffle<T>(xs: T[], rnd: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/**
 * Builds a challenge for a crew. Skips templates that need more friends than the crew has,
 * and never repeats `avoid` (the last key shown) so reroll always changes something.
 */
export function randomChallenge(opts: { crewMemberIds: string[]; city?: string; category?: keyof typeof CATEGORIES; avoid?: string; focusId?: string; rnd?: () => number }): Challenge {
  const rnd = opts.rnd ?? Math.random;
  const friends = opts.crewMemberIds.filter((m) => m !== ME);
  const pool = TEMPLATES
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => !opts.category || t.category === opts.category)
    .filter(({ t }) => (t.mode === 'members' ? friends.length >= (t.pick ?? 2) : !t.about || friends.length >= 1))
    // A challenge "with" someone has to be about them: they're the subject or one of the options.
    .filter(({ t }) => !opts.focusId || t.about || t.mode === 'members');
  if (!pool.length) throw new Error('add a friend to this crew to get challenges.');

  for (let tries = 0; tries < 8; tries++) {
    const { t, i } = pool[Math.floor(rnd() * pool.length)];
    const shuffled = shuffle(friends, rnd);
    const people = opts.focusId && friends.includes(opts.focusId) ? [opts.focusId, ...shuffled.filter((f) => f !== opts.focusId)] : shuffled;
    const day = DAYS[Math.floor(rnd() * DAYS.length)];
    const a = people[0];
    const question = t.q.replace('{a}', a ? nameOf(a) : 'someone').replace('{day}', day).replace('{city}', opts.city ?? 'amsterdam');
    const key = `${i}:${question}`;
    if (key === opts.avoid && pool.length > 1) continue;
    const memberIds = t.mode === 'members' ? people.slice(0, t.pick ?? 2) : [];
    const outcomes = t.mode === 'yesno' ? ['yes', 'no'] : t.mode === 'members' ? memberIds.map(nameOf) : t.outcomes ?? [];
    const c = CATEGORIES[t.category];
    return {
      key, category: c.label, emoji: c.emoji, question, mode: t.mode, outcomes, memberIds,
      subjectId: t.about ? a : undefined, stake: STAKES[Math.floor(rnd() * STAKES.length)],
    };
  }
  throw new Error('no challenge found.');
}

/** Used by the test: every template must pass moderation. */
export function blockedTemplates(): string[] {
  return TEMPLATES.filter((t) => blockedTopic(`${t.q} ${(t.outcomes ?? []).join(' ')}`)).map((t) => t.q);
}
