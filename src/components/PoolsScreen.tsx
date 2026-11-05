import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { wallet } from '../api';
import { Avatar } from '../avatar';
import { CATEGORIES, Challenge, randomChallenge } from '../challenges';
import { blockedTopic } from '../moderation';
import { createPoolsStore, ME, nameOf, Pool, PoolOption } from '../pools';
import { crewList, me, useSocial } from '../social';
import { colors, fonts, radius, shadow } from '../theme';
import { Chip, Coin, Eyebrow, H, PillButton, T } from './ui';
import { RenderBar } from './TopBar';

const store = createPoolsStore(wallet.debit, wallet.credit);
const STAKES = [10, 50, 100, 250];
type Draft = Challenge & { crew: string };
type View_ = { kind: 'list' } | { kind: 'create'; draft?: Draft } | { kind: 'detail'; id: string };

/** `intent` asks the screen to open "create" with a challenge about one friend (from their profile). */
export function PoolsScreen({ renderBar, onBalance, intent }: { renderBar: RenderBar; onBalance: () => void; intent?: { friendId: string; n: number } }) {
  useSocial();
  const [, setTick] = useState(0);
  const [view, setView] = useState<View_>({ kind: 'list' });
  const [tab, setTab] = useState<'active' | 'done'>('active');
  const refresh = () => { setTick((t) => t + 1); onBalance(); };
  const pools = store.list();
  const crews = crewList();

  useEffect(() => {
    if (!intent) return;
    const crew = crews.find((c) => c.memberIds.includes(intent.friendId)) ?? crews[0];
    try {
      const c = randomChallenge({ crewMemberIds: crew?.memberIds.includes(intent.friendId) ? crew.memberIds : [ME, intent.friendId], focusId: intent.friendId, city: me().city });
      setView({ kind: 'create', draft: { ...c, crew: crew.name } });
    } catch { setView({ kind: 'create' }); }
  }, [intent?.n]); // eslint-disable-line react-hooks/exhaustive-deps

  if (view.kind === 'create') return <CreatePool renderBar={renderBar} draft={view.draft} onDone={(id) => { refresh(); setView(id ? { kind: 'detail', id } : { kind: 'list' }); }} />;
  if (view.kind === 'detail') {
    const p = pools.find((x) => x.id === view.id)!;
    return <PoolDetail renderBar={renderBar} pool={p} onBack={() => setView({ kind: 'list' })} refresh={refresh} />;
  }

  const settled = (p: Pool) => ['resolved', 'voided', 'rejected'].includes(p.status);
  const shown = pools.filter((p) => (tab === 'active' ? !settled(p) : settled(p)));
  return (
    <ScrollView style={styles.page} contentContainerStyle={{ paddingBottom: 32 }}>
      <View style={styles.bandWrap}>{renderBar('media')}</View>
      <View style={styles.band}>
        <Eyebrow label="season 2: friends" tone="white" />
        <H size={40} color={colors.white}>friend <H size={40} color={colors.yellow}>pools</H></H>
        <T weight="semi" color={colors.white} size={16}>bring in the besties. put coins on what happens next, together.</T>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.groups}>
          <Pressable style={styles.newGroup} onPress={() => setView({ kind: 'create' })} accessibilityRole="button" accessibilityLabel="new pool">
            <Ionicons name="add" size={26} color={colors.brand} />
          </Pressable>
          {crews.map((g) => (
            <View key={g.id} style={styles.groupItem}>
              <View style={styles.groupAvatar}><T size={22}>{g.emoji}</T></View>
              <T weight="bold" size={13} color={colors.white}>{g.name}</T>
            </View>
          ))}
        </ScrollView>
      </View>

      <View style={styles.body}>
        <ChallengeCard onUse={(draft) => setView({ kind: 'create', draft })} />

        <View style={styles.segment}>
          {(['active', 'done'] as const).map((t) => (
            <Pressable key={t} onPress={() => setTab(t)} style={[styles.segBtn, tab === t && styles.segOn]} accessibilityRole="tab" accessibilityState={{ selected: tab === t }}>
              <T weight="bold" color={tab === t ? colors.white : colors.deep}>{t === 'active' ? `active (${pools.filter((p) => !settled(p)).length})` : 'settled'}</T>
            </Pressable>
          ))}
        </View>

        {shown.map((p) => (
          <Pressable key={p.id} style={({ pressed }) => [styles.card, pressed && { transform: [{ scale: 0.99 }] }]} onPress={() => setView({ kind: 'detail', id: p.id })}>
            <View style={{ flex: 1, gap: 6 }}>
              <T weight="bold" size={16} color={colors.deep}>{p.question}</T>
              <T size={13} color={colors.muted}>{p.groupName} · {statusLabel(p)}</T>
              <View style={styles.faces}>
                {p.entries.slice(0, 5).map((e, i) => <View key={e.userId} style={{ marginLeft: i ? -8 : 0 }}><Avatar id={e.userId} size={26} /></View>)}
              </View>
            </View>
            <View style={styles.pot}>
              <View style={styles.inline}><Coin size={14} /><H size={22} color={colors.deep}>{p.entries.length * p.stake}</H></View>
              <T size={12} color={colors.muted}>pot</T>
            </View>
          </Pressable>
        ))}
        {shown.length === 0 && <T color={colors.muted} style={{ textAlign: 'center', marginTop: 24 }}>nothing here yet.</T>}

        <PillButton label="start a pool" onPress={() => setView({ kind: 'create' })} icon={<Ionicons name="add" size={18} color={colors.white} />} />
        <T size={12} color={colors.muted} style={{ textAlign: 'center' }}>pools use free coins only. coins have no cash value.</T>
      </View>
    </ScrollView>
  );
}

/** The random challenge generator: pick a crew and a vibe, roll the dice. */
function ChallengeCard({ onUse }: { onUse: (d: Draft) => void }) {
  const crews = crewList();
  const [crewName, setCrewName] = useState(crews[0]?.name ?? '');
  const [cat, setCat] = useState<keyof typeof CATEGORIES | undefined>();
  const crew = crews.find((c) => c.name === crewName) ?? crews[0];
  const roll = (avoid?: string) => { try { return randomChallenge({ crewMemberIds: crew?.memberIds ?? [ME], city: me().city, category: cat, avoid }); } catch { return null; } };
  const [c, setC] = useState<Challenge | null>(() => roll());
  const spin = useRef(new Animated.Value(0)).current;
  const pop = useRef(new Animated.Value(1)).current;

  useEffect(() => { setC(roll()); }, [crewName, cat]); // eslint-disable-line react-hooks/exhaustive-deps

  function reroll() {
    const nd = Platform.OS !== 'web';
    spin.setValue(0); pop.setValue(0.92);
    Animated.parallel([
      Animated.timing(spin, { toValue: 1, duration: 450, easing: Easing.out(Easing.back(1.5)), useNativeDriver: nd }),
      Animated.spring(pop, { toValue: 1, useNativeDriver: nd, damping: 10, stiffness: 220 }),
    ]).start();
    setC(roll(c?.key));
  }

  return (
    <View style={styles.challenge}>
      <View style={styles.between}>
        <Eyebrow label="random challenge" tone="white" />
        <T size={13} weight="semi" color={colors.white}>no ideas? roll the dice</T>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {crews.map((g) => (
          <Pressable key={g.id} onPress={() => setCrewName(g.name)} style={[styles.miniChip, g.name === crewName && styles.miniChipOn]} accessibilityRole="button" accessibilityState={{ selected: g.name === crewName }}>
            <T size={13} weight="bold" color={g.name === crewName ? colors.royal : colors.white}>{g.emoji} {g.name}</T>
          </Pressable>
        ))}
      </ScrollView>
      <Animated.View style={[styles.challengeBody, { transform: [{ scale: pop }] }]}>
        {c ? (
          <>
            <T size={13} weight="bold" color={colors.brand}>{c.emoji} {c.category}</T>
            <H size={26} color={colors.deep}>{c.question}</H>
            <View style={styles.wrapRow}>
              {c.outcomes.map((o, i) => (
                <View key={o} style={styles.outcome}>
                  {c.memberIds[i] && <Avatar id={c.memberIds[i]} size={20} />}
                  <T size={13} weight="bold" color={colors.deep}>{o}</T>
                </View>
              ))}
            </View>
            {c.subjectId && <T size={12} color={colors.muted}>{nameOf(c.subjectId)} has to say ok first.</T>}
          </>
        ) : <T weight="semi" color={colors.deep}>add friends to this crew to get challenges.</T>}
      </Animated.View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        <Pressable onPress={() => setCat(undefined)} style={[styles.miniChip, !cat && styles.miniChipOn]}><T size={13} weight="bold" color={!cat ? colors.royal : colors.white}>✨ anything</T></Pressable>
        {(Object.keys(CATEGORIES) as (keyof typeof CATEGORIES)[]).map((k) => (
          <Pressable key={k} onPress={() => setCat(k)} style={[styles.miniChip, cat === k && styles.miniChipOn]} accessibilityRole="button" accessibilityState={{ selected: cat === k }}>
            <T size={13} weight="bold" color={cat === k ? colors.royal : colors.white}>{CATEGORIES[k].emoji} {CATEGORIES[k].label}</T>
          </Pressable>
        ))}
      </ScrollView>
      <View style={styles.challengeActions}>
        <Pressable onPress={reroll} style={styles.dice} accessibilityRole="button" accessibilityLabel="roll a new challenge">
          <Animated.View style={{ transform: [{ rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }] }}>
            <T size={26}>🎲</T>
          </Animated.View>
        </Pressable>
        <PillButton label="start this pool" variant="white" disabled={!c} onPress={() => c && crew && onUse({ ...c, crew: crew.name })} style={{ flex: 1 }} />
      </View>
    </View>
  );
}

function statusLabel(p: Pool) {
  return { pending_consent: `waiting for ${nameOf(p.subjectId ?? '')} to say ok`, open: 'open', proposed: 'result proposed, voting', resolved: 'settled', voided: 'cancelled, coins returned', rejected: 'subject said no' }[p.status];
}

function BackBar({ label, onBack }: { label: string; onBack: () => void }) {
  return (
    <Pressable onPress={onBack} style={styles.back} accessibilityRole="button">
      <Ionicons name="chevron-back" size={20} color={colors.brand} /><T weight="bold" color={colors.brand}>{label}</T>
    </Pressable>
  );
}

function CreatePool({ onDone, renderBar, draft }: { onDone: (id?: string) => void; renderBar: RenderBar; draft?: Draft }) {
  useSocial();
  const crews = crewList();
  const [question, setQuestion] = useState(draft?.question ?? '');
  const [mode, setMode] = useState<'yesno' | 'members' | 'custom'>(draft?.mode ?? 'yesno');
  const [custom, setCustom] = useState(draft?.mode === 'custom' ? draft.outcomes : ['', '']);
  const [picked, setPicked] = useState<string[]>(draft?.memberIds ?? []);
  const [subject, setSubject] = useState<string | undefined>(draft?.subjectId);
  const [group, setGroup] = useState(draft?.crew ?? crews[0]?.name ?? 'house');
  const [stake, setStake] = useState(draft?.stake ?? 50);
  const [error, setError] = useState<string | null>(null);
  const [lastKey, setLastKey] = useState(draft?.key);
  const live = question.length > 6 ? blockedTopic(question) : null;
  const crew = crews.find((c) => c.name === group) ?? crews[0];
  const friends = (crew?.memberIds ?? []).filter((m) => m !== ME);

  const options: PoolOption[] = useMemo(() => {
    if (mode === 'yesno') return [{ id: 'y', label: 'yes' }, { id: 'n', label: 'no' }];
    if (mode === 'members') return picked.map((id) => ({ id, label: nameOf(id), memberId: id }));
    return custom.filter((c) => c.trim()).map((c, i) => ({ id: `c${i}`, label: c.trim() }));
  }, [mode, picked, custom]);

  function surprise() {
    try {
      const c = randomChallenge({ crewMemberIds: crew?.memberIds ?? [ME], city: me().city, avoid: lastKey });
      setLastKey(c.key); setQuestion(c.question); setMode(c.mode); setPicked(c.memberIds); setSubject(c.subjectId);
      if (c.mode === 'custom') setCustom(c.outcomes);
      setStake(c.stake); setError(null);
    } catch (e) { setError((e as Error).message); }
  }

  function submit() {
    try {
      if (!question.trim()) throw new Error('write a question first.');
      const p = store.create({ question: question.trim(), stake, options, subjectId: mode === 'members' ? undefined : subject, groupName: group });
      onDone(p.id);
    } catch (e) { setError((e as Error).message); }
  }

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
      <View style={styles.inBar}>{renderBar('light')}</View>
      <BackBar label="pools" onBack={() => onDone()} />
      <View style={styles.between}>
        <H size={34}>start a pool</H>
        <Pressable onPress={surprise} style={styles.surprise} accessibilityRole="button" accessibilityLabel="surprise me">
          <T size={18}>🎲</T><T weight="bold" color={colors.white}>surprise me</T>
        </Pressable>
      </View>

      <View style={styles.field}>
        <T weight="bold" color={colors.deep}>crew</T>
        <View style={styles.wrapRow}>{crews.map((g) => <Chip key={g.id} label={`${g.emoji} ${g.name}`} active={group === g.name} onPress={() => { setGroup(g.name); setPicked([]); setSubject(undefined); }} />)}</View>
      </View>

      <View style={styles.field}>
        <T weight="bold" color={colors.deep}>the question</T>
        <TextInput style={[styles.input, (live || error) && { borderColor: colors.orange }]} placeholder="who wins friday’s padel match?" placeholderTextColor={colors.muted}
          value={question} onChangeText={(t) => { setQuestion(t); setError(null); }} maxLength={100} />
        <View style={styles.between}>
          {live ? <T size={13} color={colors.orange} weight="semi">pools about {live} aren’t allowed</T> : <T size={13} color={colors.muted}>keep it fun for everyone</T>}
          <T size={13} color={colors.muted}>{question.length}/100</T>
        </View>
      </View>

      <View style={styles.field}>
        <T weight="bold" color={colors.deep}>outcomes</T>
        <View style={styles.wrapRow}>
          {(['yesno', 'members', 'custom'] as const).map((m) => (
            <Chip key={m} label={{ yesno: 'yes or no', members: 'pick a friend', custom: 'custom' }[m]} active={mode === m} onPress={() => setMode(m)} />
          ))}
        </View>
        {mode === 'members' && (
          <>
            <View style={styles.wrapRow}>
              {friends.map((f) => (
                <Pressable key={f} onPress={() => setPicked((p) => (p.includes(f) ? p.filter((x) => x !== f) : [...p, f]))}
                  style={[styles.person, picked.includes(f) && styles.personOn]} accessibilityRole="checkbox" accessibilityState={{ checked: picked.includes(f) }}>
                  <Avatar id={f} size={28} /><T weight="bold" color={colors.deep}>{nameOf(f)}</T>
                </Pressable>
              ))}
            </View>
            <T size={13} color={colors.muted}>friends you pick can’t stake on their own pool.</T>
          </>
        )}
        {mode === 'custom' && custom.map((c, i) => (
          <TextInput key={i} style={styles.input} placeholder={`outcome ${i + 1}`} placeholderTextColor={colors.muted}
            value={c} onChangeText={(t) => setCustom((arr) => arr.map((x, j) => (j === i ? t : x)))} />
        ))}
        {mode === 'custom' && <Pressable onPress={() => setCustom((c) => [...c, ''])}><T weight="bold" color={colors.brand}>+ add outcome</T></Pressable>}
      </View>

      {mode !== 'members' && (
        <View style={styles.field}>
          <T weight="bold" color={colors.deep}>about one friend?</T>
          <T size={13} color={colors.muted}>they have to say ok first, and they can’t stake.</T>
          <View style={styles.wrapRow}>
            <Chip label="no one" active={!subject} onPress={() => setSubject(undefined)} />
            {friends.map((f) => <Chip key={f} label={nameOf(f)} active={subject === f} onPress={() => setSubject(f)} />)}
          </View>
        </View>
      )}

      <View style={styles.field}>
        <T weight="bold" color={colors.deep}>coins per person</T>
        <View style={styles.wrapRow}>{STAKES.map((s) => <Chip key={s} label={`${s}`} active={stake === s} onPress={() => setStake(s)} />)}</View>
      </View>

      {error && <View style={styles.errorBox}><Ionicons name="alert-circle" size={18} color={colors.orange} /><T weight="semi" color={colors.orange} style={{ flex: 1 }}>{error}</T></View>}
      <PillButton label="create pool" onPress={submit} />
      <T size={12} color={colors.muted} style={{ textAlign: 'center' }}>not allowed: drinking, health or injury, dating, looks, danger or crime, self-harm.</T>
    </ScrollView>
  );
}

function PoolDetail({ pool: p, onBack, refresh, renderBar }: { pool: Pool; onBack: () => void; refresh: () => void; renderBar: RenderBar }) {
  const [error, setError] = useState<string | null>(null);
  const mine = p.entries.find((e) => e.userId === ME);
  const myVote = p.votes.find((v) => v.userId === ME);
  const act = (fn: () => void) => { try { setError(null); fn(); refresh(); } catch (e) { setError((e as Error).message); } };
  const total = Math.max(p.entries.length, 1);
  const pot = p.entries.length * p.stake;
  const winnerId = p.resolvedOptionId ?? p.proposedOptionId;

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.body}>
      <View style={styles.inBar}>{renderBar('light')}</View>
      <BackBar label="pools" onBack={onBack} />
      <Eyebrow label={p.groupName + (p.subjectId ? ` · about ${nameOf(p.subjectId)}` : '')} />
      <H size={32}>{p.question}</H>

      <View style={styles.potCard}>
        <Coin size={28} />
        <View>
          <H size={36} color={colors.white}>{pot} coins</H>
          <T weight="semi" color={colors.white}>{p.stake} each · {p.entries.length} in · {statusLabel(p)}</T>
        </View>
      </View>

      {p.status === 'pending_consent' && (
        <View style={styles.notice}>
          <T weight="semi" color={colors.deep}>{nameOf(p.subjectId!)} needs to accept before anyone can join.</T>
          <PillButton label={`demo: ${nameOf(p.subjectId!)} says ok`} variant="ghost" onPress={() => act(() => store.simulateConsent(p.id))} />
        </View>
      )}

      <T weight="bold" color={colors.deep}>{mine ? 'all picks' : p.status === 'open' ? `tap a pick to join for ${p.stake}` : 'all picks'}</T>
      {p.options.map((o) => {
        const n = p.entries.filter((e) => e.optionId === o.id).length;
        const isMine = mine?.optionId === o.id;
        const isWin = winnerId === o.id && (p.status === 'resolved' || p.status === 'proposed');
        return (
          <Pressable key={o.id} disabled={p.status !== 'open' || !!mine} onPress={() => act(() => store.join(p.id, o.id))}
            style={[styles.option, isMine && styles.optionMine, isWin && styles.optionWin]} accessibilityRole="button">
            <View style={styles.optionTop}>
              {o.memberId && <Avatar id={o.memberId} size={28} />}
              <T weight="bold" size={16} color={colors.deep} style={{ flex: 1 }}>{o.label}{isMine ? '  · your pick' : ''}</T>
              {isWin && <Ionicons name={p.status === 'resolved' ? 'trophy' : 'time'} size={18} color={colors.deep} />}
              <T weight="semi" size={13} color={colors.muted}>{n} ({Math.round((n / total) * 100)}%)</T>
            </View>
            <View style={styles.barTrack}><View style={[styles.barFill, { width: `${(n / total) * 100}%` }]} /></View>
          </Pressable>
        );
      })}

      {p.status === 'open' && p.createdBy === ME && p.entries.length > 1 && (
        <View style={styles.notice}>
          <T weight="bold" color={colors.deep}>did it happen? propose the result</T>
          <T size={13} color={colors.muted}>everyone in the pool gets 48 hours to confirm or dispute. no majority means everyone gets their coins back.</T>
          <View style={styles.wrapRow}>{p.options.map((o) => <Chip key={o.id} label={o.label} onPress={() => act(() => store.propose(p.id, o.id))} />)}</View>
        </View>
      )}

      {p.status === 'proposed' && (
        <View style={styles.notice}>
          <T weight="bold" color={colors.deep}>proposed: {p.options.find((o) => o.id === p.proposedOptionId)?.label}</T>
          {mine && (
            <View style={styles.wrapRow}>
              <Chip label={myVote?.confirm === true ? '✓ confirmed' : 'confirm'} active={myVote?.confirm === true} onPress={() => act(() => store.vote(p.id, true))} />
              <Chip label={myVote?.confirm === false ? '✗ disputed' : 'dispute'} active={myVote?.confirm === false} onPress={() => act(() => store.vote(p.id, false))} />
            </View>
          )}
          <PillButton label="demo: skip the 48 hours" variant="ghost" onPress={() => act(() => store.finalize(p.id))} />
        </View>
      )}
      {p.status === 'resolved' && <View style={[styles.notice, { backgroundColor: colors.yellow }]}><T weight="bold" color={colors.deep}>settled. winners split {pot} coins.</T></View>}
      {p.status === 'voided' && <View style={styles.notice}><T weight="semi" color={colors.deep}>no majority confirmed, so the pool was cancelled and everyone got their coins back.</T></View>}
      {error && <View style={styles.errorBox}><Ionicons name="alert-circle" size={18} color={colors.orange} /><T weight="semi" color={colors.orange} style={{ flex: 1 }}>{error}</T></View>}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.cloud },
  bandWrap: { backgroundColor: colors.sky },
  inBar: { marginHorizontal: -18, marginTop: -18 },
  band: { backgroundColor: colors.sky, paddingHorizontal: 18, paddingTop: 10, paddingBottom: 22, gap: 8, borderBottomLeftRadius: 32, borderBottomRightRadius: 32 },
  groups: { gap: 14, paddingTop: 10 },
  newGroup: { width: 58, height: 58, borderRadius: 29, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center', ...shadow.soft },
  groupItem: { alignItems: 'center', gap: 4 },
  groupAvatar: { width: 58, height: 58, borderRadius: 29, backgroundColor: 'rgba(255,255,255,0.25)', borderWidth: 2, borderColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  body: { padding: 18, gap: 14 },
  segment: { flexDirection: 'row', backgroundColor: colors.white, borderRadius: radius.pill, padding: 4, ...shadow.soft },
  segBtn: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: radius.pill },
  segOn: { backgroundColor: colors.brand },
  card: { flexDirection: 'row', gap: 12, alignItems: 'center', backgroundColor: colors.white, borderRadius: radius.card, padding: 16, ...shadow.soft },
  faces: { flexDirection: 'row', marginTop: 2 },
  pot: { alignItems: 'flex-end' },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  back: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  field: { gap: 8 },
  input: { backgroundColor: colors.white, borderWidth: 1.5, borderColor: colors.line, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 13, color: colors.ink, fontSize: 16, fontFamily: fonts.bodySemi },
  between: { flexDirection: 'row', justifyContent: 'space-between' },
  wrapRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  person: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.white, borderWidth: 1.5, borderColor: colors.line, borderRadius: radius.pill, paddingVertical: 5, paddingLeft: 5, paddingRight: 14 },
  personOn: { borderColor: colors.brand, backgroundColor: colors.tint },
  errorBox: { flexDirection: 'row', gap: 8, alignItems: 'center', backgroundColor: '#FDEEE7', borderRadius: 14, padding: 12 },
  potCard: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: colors.brand, borderRadius: radius.card, padding: 18, ...shadow.soft },
  notice: { backgroundColor: colors.white, borderRadius: radius.card, padding: 16, gap: 10, ...shadow.soft },
  option: { backgroundColor: colors.white, borderRadius: 18, padding: 14, gap: 10, borderWidth: 2, borderColor: 'transparent', ...shadow.soft },
  optionMine: { borderColor: colors.brand },
  optionWin: { backgroundColor: '#FFFBC2' },
  optionTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  barTrack: { height: 6, borderRadius: 3, backgroundColor: colors.tint, overflow: 'hidden' },
  barFill: { height: 6, borderRadius: 3, backgroundColor: colors.brandSoft },
  challenge: { backgroundColor: colors.royal, borderRadius: radius.card, padding: 16, gap: 12, ...shadow.soft },
  challengeBody: { backgroundColor: colors.white, borderRadius: 18, padding: 16, gap: 8, minHeight: 130 },
  challengeActions: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  dice: { width: 54, height: 54, borderRadius: 27, backgroundColor: colors.yellow, alignItems: 'center', justifyContent: 'center', ...shadow.button },
  miniChip: { borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.45)' },
  miniChipOn: { backgroundColor: colors.white, borderColor: colors.white },
  outcome: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.tint, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 5 },
  surprise: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.royal, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 8, ...shadow.button },
});
