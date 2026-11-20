import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Avatar } from '../avatar';
import { haptic } from '../haptics';
import { blockedTopic } from '../moderation';
import { ME, nameOf, timeLeft } from '../pools';
import { createPoll, deletePoll, Poll, pollClosed, votePoll } from '../polls';
import { crewList, useSocial } from '../social';
import { DeadlineKey, deadlineFor } from '../templates';
import { colors, fonts, radius, shadow } from '../theme';
import { Chip, H, PillButton, T } from './ui';

const POLL_DEADLINES: { label: string; key: DeadlineKey }[] = [
  { label: 'no deadline', key: 'none' }, { label: '1 hour', key: '1h' }, { label: 'tonight', key: 'tonight' }, { label: '24 hours', key: '24h' }, { label: 'this weekend', key: 'weekend' },
];
const QUICK_POLLS: { q: string; options: string[] }[] = [
  { q: 'where do we eat?', options: ['pizza', 'sushi', 'burgers'] },
  { q: 'what time do we meet?', options: ['19:00', '20:00', '21:00'] },
  { q: 'movie or games tonight?', options: ['movie', 'games'] },
  { q: 'who’s in for saturday?', options: ['in', 'out', 'maybe'] },
];

/** A poll with inline voting: tap to vote, tap another option to change it. */
export function PollCard({ p, compact }: { p: Poll; compact?: boolean }) {
  const [err, setErr] = useState<string | null>(null);
  const closed = pollClosed(p);
  const total = Math.max(1, p.counts.reduce((a, b) => a + b, 0));
  const top = Math.max(...p.counts);
  const votes = p.counts.reduce((a, b) => a + b, 0);
  return (
    <View style={[styles.card, compact && { padding: 14 }]}>
      <View style={styles.top}>
        <View style={styles.pill}><T size={11} weight="bold" color={colors.royal}>📊 POLL</T></View>
        <T size={12} weight="semi" color={colors.muted} style={{ flex: 1 }} numberOfLines={1}>{p.groupName}{p.createdBy ? ` · ${p.createdBy === ME ? 'you' : nameOf(p.createdBy)}` : ''}</T>
        <T size={12} weight="bold" color={closed ? colors.muted : colors.brand}>{closed ? 'closed' : p.closesAt ? `⏰ ${timeLeft(p.closesAt)}` : 'open'}</T>
      </View>
      <T weight="bold" size={17} color={colors.deep}>{p.question}</T>
      {p.options.map((o, i) => {
        const n = p.counts[i] ?? 0;
        const mine = p.mine === i;
        const winning = closed && n === top && n > 0;
        return (
          <Pressable key={i} disabled={closed} onPress={() => { try { setErr(null); votePoll(p.id, i); haptic.tap(); } catch (e) { setErr((e as Error).message); } }}
            style={({ pressed }) => [styles.opt, mine && styles.optMine, pressed && { transform: [{ scale: 0.98 }] }]} accessibilityRole="button" accessibilityState={{ selected: mine }}>
            <View style={[styles.fill, { width: `${(n / total) * 100}%` }, winning && { backgroundColor: 'rgba(20,184,122,0.25)' }]} />
            <T weight="bold" color={colors.deep} style={{ flex: 1 }}>{winning ? '🏆 ' : ''}{o}{mine ? '  ✓' : ''}</T>
            <T size={13} weight="bold" color={colors.muted}>{p.mine !== undefined || closed ? `${Math.round((n / total) * 100)}%` : ''}</T>
          </Pressable>
        );
      })}
      <View style={styles.bottom}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          {p.voters.slice(0, 5).map((v, i) => <View key={v} style={{ marginLeft: i ? -8 : 0 }}><Avatar id={v} size={22} /></View>)}
          <T size={12} weight="bold" color={colors.muted} style={{ marginLeft: p.voters.length ? 8 : 0 }}>{votes} {votes === 1 ? 'vote' : 'votes'}{p.mine === undefined && !closed ? ' · tap to vote' : ''}</T>
        </View>
        {p.createdBy === ME && (
          <Pressable onPress={() => deletePoll(p.id)} hitSlop={8} accessibilityRole="button" accessibilityLabel="delete poll">
            <Ionicons name="trash-outline" size={16} color={colors.muted} />
          </Pressable>
        )}
      </View>
      {err && <T size={13} weight="semi" color={colors.orange}>{err}</T>}
    </View>
  );
}

/** Create a quick poll: question, 2–6 options, optional deadline. Two taps with the presets. */
export function CreatePoll({ crewName, onDone }: { crewName?: string; onDone: () => void }) {
  useSocial();
  const crews = crewList();
  const [group, setGroup] = useState(crewName ?? crews[0]?.name ?? '');
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [deadline, setDeadline] = useState<DeadlineKey>('tonight');
  const [error, setError] = useState<string | null>(null);
  const live = question.length > 4 ? blockedTopic(question) : null;
  const submit = () => {
    try { createPoll({ crewName: group, question, options, closesAt: deadlineFor(deadline) }); haptic.success(); onDone(); }
    catch (e) { setError((e as Error).message); haptic.warn(); }
  };
  return (
    <View style={{ gap: 14 }}>
      <T color={colors.muted}>no coins, no settling. the crew just votes. perfect for plans.</T>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {QUICK_POLLS.map((t) => <Chip key={t.q} label={t.q} onPress={() => { setQuestion(t.q); setOptions([...t.options]); setError(null); }} />)}
      </ScrollView>
      <View style={styles.field}>
        <T weight="bold" color={colors.deep}>crew</T>
        <View style={styles.wrap}>{crews.map((g) => <Chip key={g.id} label={`${g.emoji} ${g.name}`} active={group === g.name} onPress={() => setGroup(g.name)} />)}</View>
      </View>
      <View style={styles.field}>
        <T weight="bold" color={colors.deep}>the question</T>
        <TextInput style={[styles.input, (live || error) && { borderColor: colors.orange }]} value={question} onChangeText={(t) => { setQuestion(t); setError(null); }}
          placeholder="where do we eat?" placeholderTextColor={colors.muted} maxLength={100} />
        {live && <T size={13} weight="semi" color={colors.orange}>polls about {live} aren’t allowed</T>}
      </View>
      <View style={styles.field}>
        <T weight="bold" color={colors.deep}>options</T>
        {options.map((o, i) => (
          <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <TextInput style={[styles.input, { flex: 1 }]} value={o} onChangeText={(t) => setOptions((arr) => arr.map((x, j) => (j === i ? t : x)))}
              placeholder={`option ${i + 1}`} placeholderTextColor={colors.muted} maxLength={40} />
            {options.length > 2 && (
              <Pressable onPress={() => setOptions((arr) => arr.filter((_, j) => j !== i))} hitSlop={8} accessibilityLabel={`remove option ${i + 1}`}>
                <Ionicons name="close-circle" size={22} color={colors.muted} />
              </Pressable>
            )}
          </View>
        ))}
        {options.length < 6 && <Pressable onPress={() => setOptions((o) => [...o, ''])}><T weight="bold" color={colors.brand}>+ add option</T></Pressable>}
      </View>
      <View style={styles.field}>
        <T weight="bold" color={colors.deep}>closes</T>
        <View style={styles.wrap}>{POLL_DEADLINES.map((d) => <Chip key={d.key} label={d.label} active={deadline === d.key} onPress={() => setDeadline(d.key)} />)}</View>
      </View>
      {error && <T weight="semi" color={colors.orange}>{error}</T>}
      <PillButton label="send the poll 📊" onPress={submit} />
    </View>
  );
}

export function PollsHeader({ title }: { title: string }) {
  return <H size={22} color={colors.deep}>{title}</H>;
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: radius.card, padding: 16, gap: 10, borderLeftWidth: 5, borderLeftColor: colors.royal, ...shadow.soft },
  top: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pill: { backgroundColor: 'rgba(40,39,95,0.12)', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  opt: { flexDirection: 'row', alignItems: 'center', borderRadius: 14, borderWidth: 1.5, borderColor: colors.line, paddingHorizontal: 14, paddingVertical: 11, overflow: 'hidden' },
  optMine: { borderColor: colors.brand, borderWidth: 2 },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: 'rgba(0,149,182,0.14)' },
  bottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  field: { gap: 8 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  input: { borderWidth: 1.5, borderColor: colors.line, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 12, fontFamily: fonts.bodySemi, fontSize: 16, color: colors.ink, backgroundColor: colors.card },
});
