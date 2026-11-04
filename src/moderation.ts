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
