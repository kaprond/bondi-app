/**
 * First-pass topic filter for friend pools. The server runs a classifier too;
 * this gives instant feedback in the create form.
 */
const BLOCKED: { topic: string; words: RegExp }[] = [
  { topic: 'drinking or drugs', words: /\b(pass(es|ed)? out|blackout|drunk|wasted|vomit|puke|shots?|hangover|high|stoned|overdose)\b/i },
  { topic: 'health or injury', words: /\b(hospital|injur\w*|break (a|his|her) |sick|die|dies|death|hurt)\b/i },
  { topic: 'sex or dating', words: /\b(girlfriend|boyfriend|hook ?up|sleep with|sex|dating|date with|ex\b|kiss)\b/i },
  { topic: 'appearance', words: /\b(fat|ugly|weight|blonde|brunette|hot|looks)\b/i },
  { topic: 'crime or danger', words: /\b(arrest\w*|police|steal|fight|crash|jump off)\b/i },
  { topic: 'self-harm', words: /\b(self.?harm|suicid\w*|cut (him|her)self)\b/i },
];

export function blockedTopic(text: string): string | null {
  for (const b of BLOCKED) if (b.words.test(text)) return b.topic;
  return null;
}

/** Same rule as forfeit_problem() in 0018_irl_stakes.sql: a real-life stake is text only, never money. */
export function forfeitProblem(text: string | undefined): string | null {
  const t = (text ?? '').trim();
  if (!t) return null;
  if (t.length < 3) return 'make the real-life stake a bit longer.';
  if (t.length > 60) return 'keep the real-life stake under 60 characters.';
  if (/[€$£]|\b(eur|euro|euros|cash|money|geld|tikkie|bunq|paypal|revolut|venmo|iban|pay|pays|paid|payment|betaal\w*|transfer|overmaken|bet|bets|wager)\b/i.test(t))
    return 'no money in real-life stakes. keep it to things like buying a round or doing the dishes.';
  const topic = blockedTopic(t);
  return topic ? `real-life stakes about ${topic} aren’t allowed.` : null;
}
