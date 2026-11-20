import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Image, Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { wallet } from '../api';
import { onHydrate, save } from '../persist';
import { Avatar } from '../avatar';
import { CATEGORIES, Challenge, randomChallenge } from '../challenges';
import { blockedTopic, forfeitProblem } from '../moderation';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createLivePoolsStore, createPoolsStore, isClosed, LIVE, ME, nameOf, Pool, PoolOption, timeLeft } from '../pools';
import { APP_URL, Crew, crewInviteLink, crewList, inviteCode, me, startCrew, useSocial } from '../social';
import { REACTIONS, useThread } from '../thread';
import { Period, useStandings } from '../standings';
import { DeadlineKey, deadlineFor, QUICK, QuickTemplate } from '../templates';
import { useCrewTitles } from '../titles';
import { FeedItem, useCrewFeed } from '../feed';
import { track } from '../track';
import { toast } from '../bus';
import { shareText } from '../share';
import { colors, fonts, radius, shadow } from '../theme';
import { Chip, Coin, Eyebrow, FadeIn, H, PillButton, SkeletonRows, T } from './ui';
import { haptic } from '../haptics';
import { sfx } from '../sfx';
import { RenderBar } from './TopBar';
import { BlobHeader } from './Blob';
import { ReportSheet } from './ReportSheet';
import { dismissPushOffer, enablePush, shouldOfferPush } from '../push';
import { askForRatingAfterWin } from '../rate';
import { syncWidget } from '../widget';
import { pickAndAttachProof, useProof } from '../proof';

const store = LIVE ? createLivePoolsStore() : createPoolsStore(wallet.debit, wallet.credit, (pools) => save({ pools }));
/** Read-only snapshot for other screens (demo rivalries/titles). */
export const poolsSnapshot = () => store.list();
onHydrate((d) => { if (!LIVE && Array.isArray(d.pools)) store.restore(d.pools as Pool[]); });
const STAKES = [1, 2, 5, 10];
/** Re-sync pools from the server (after switching accounts). */
export const refreshPools = () => { if ('refresh' in store) (store as { refresh: () => Promise<void> }).refresh(); };
/** How many pools you're in or made (for the add-to-home-screen nudge). */
export const poolCount = () => store.list().length;
type Draft = Challenge & { crew: string; deadline?: DeadlineKey };
/** Re-render every 30s so countdowns stay fresh. */
function useClock() {
  const [, set] = useState(0);
  useEffect(() => { const t = setInterval(() => set((n) => n + 1), 30000); return () => clearInterval(t); }, []);
}
const FORFEITS = ['buys the next round 🍻', 'gets the coffees ☕', 'does the dishes 🧽', 'sings karaoke 🎤', 'cooks dinner 🍝'];
const DEADLINES: { label: string; key: DeadlineKey }[] = [
  { label: 'no deadline', key: 'none' }, { label: '1 hour', key: '1h' }, { label: 'tonight', key: 'tonight' }, { label: '24 hours', key: '24h' },
  { label: 'this weekend', key: 'weekend' }, { label: '3 days', key: '3d' }, { label: '1 week', key: '1w' },
];
const deadlineIndex = (k: DeadlineKey) => Math.max(0, DEADLINES.findIndex((d) => d.key === k));
async function shareCrew(c: Crew) {
  const r = await shareText(`${c.emoji} join ${c.name} on LetsJam. we call stuff, put free coins on it, winner gets bragging rights:`, crewInviteLink(c.id));
  if (r !== 'dismissed') track('invite_shared', { what: 'crew' });
  return r !== 'dismissed';
}

type View_ = { kind: 'list' } | { kind: 'create'; draft?: Draft } | { kind: 'detail'; id: string; fresh?: boolean } | { kind: 'crew'; id: string };

/** `intent` asks the screen to open "create" with a challenge about one friend (from their profile). */
export function PoolsScreen({ renderBar, onBalance, intent, openPool, openCrew }: { renderBar: RenderBar; onBalance: () => void; intent?: { friendId: string; n: number }; openPool?: { id: string; n: number }; openCrew?: { id: string; n: number } }) {
  useSocial();
  const [, setTick] = useState(0);
  const [view, setView] = useState<View_>({ kind: 'list' });
  const [tab, setTab] = useState<'active' | 'done'>('active');
  const refresh = () => { setTick((t) => t + 1); onBalance(); };
  useClock();
  const pools = store.list();
  useEffect(() => { syncWidget(pools); });
  const crews = crewList();
  // Live: re-render and re-read the balance whenever the server sync lands.
  useEffect(() => store.subscribe(refresh), []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!intent) return;
    const crew = crews.find((c) => c.memberIds.includes(intent.friendId)) ?? crews[0];
    try {
      const c = randomChallenge({ crewMemberIds: crew?.memberIds.includes(intent.friendId) ? crew.memberIds : [ME, intent.friendId], focusId: intent.friendId, city: me().city });
      setView({ kind: 'create', draft: { ...c, crew: crew.name } });
    } catch { setView({ kind: 'create' }); }
  }, [intent?.n]); // eslint-disable-line react-hooks/exhaustive-deps

  // Opened from a push notification or a shared pool link
  useEffect(() => { if (openPool?.id) setView({ kind: 'detail', id: openPool.id }); }, [openPool?.n]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (openCrew?.id) setView({ kind: 'crew', id: openCrew.id }); }, [openCrew?.n]); // eslint-disable-line react-hooks/exhaustive-deps

  if (view.kind === 'create') return <FadeIn key="create"><CreatePool renderBar={renderBar} draft={view.draft} onDone={(id) => { refresh(); setView(id ? { kind: 'detail', id, fresh: true } : { kind: 'list' }); }} /></FadeIn>;
  if (view.kind === 'detail') {
    const id = 'resolveId' in store ? store.resolveId(view.id) : view.id;
    const p = pools.find((x) => x.id === id);
    if (!p) { setTimeout(() => setView({ kind: 'list' })); return null; }
    return <FadeIn key={`d-${view.id}`}><PoolDetail renderBar={renderBar} pool={p} fresh={view.fresh} onBack={() => setView({ kind: 'list' })} refresh={refresh} /></FadeIn>;
  }
  if (view.kind === 'crew') {
    const c = crewList().find((x) => x.id === view.id);
    if (!c) { setTimeout(() => setView({ kind: 'list' })); return null; }
    return <FadeIn key={`c-${c.id}`}><CrewView renderBar={renderBar} crew={c} pools={store.list().filter((p) => (p.groupId ? p.groupId === c.id : p.groupName === c.name))}
      onBack={() => setView({ kind: 'list' })} onOpen={(id) => setView({ kind: 'detail', id })} onNew={() => setView({ kind: 'create', draft: { key: '', category: '', emoji: '', question: '', mode: 'yesno', outcomes: [], memberIds: [], stake: 2, crew: c.name } })} /></FadeIn>;
  }

  const settled = (p: Pool) => ['resolved', 'voided', 'rejected'].includes(p.status);
  const shown = pools.filter((p) => (tab === 'active' ? !settled(p) : settled(p)));
  return (
    <ScrollView style={styles.page} contentContainerStyle={{ paddingBottom: 32 }}>
      <BlobHeader>{renderBar('media')}
<View style={styles.band}>
        <Eyebrow label="season 2: friends" tone="white" />
        <H size={40} color={colors.white}>friend <H size={40} color={colors.yellow}>pools</H></H>
        <T weight="semi" color={colors.white} size={16}>bring in the besties. put coins on what happens next, together.</T>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.groups}>
          <Pressable style={styles.newGroup} onPress={() => setView({ kind: 'create' })} accessibilityRole="button" accessibilityLabel="new pool">
            <Ionicons name="add" size={26} color={colors.brand} />
          </Pressable>
          {crews.map((g) => (
            <Pressable key={g.id} style={styles.groupItem} onPress={() => setView({ kind: 'crew', id: g.id })} accessibilityRole="button" accessibilityLabel={`${g.name} feed and standings`}>
              <View style={styles.groupAvatar}><T size={22}>{g.emoji}</T></View>
              <T weight="bold" size={13} color={colors.white}>{g.name} · {g.memberIds.length}</T>
            </Pressable>
          ))}
        </ScrollView>
      </View></BlobHeader>

      <View style={styles.body}>
        <FirstRun crews={crews} poolCount={pools.length} onFirstPool={(crew) => {
          try { const c = randomChallenge({ crewMemberIds: crew.memberIds, city: me().city }); setView({ kind: 'create', draft: { ...c, crew: crew.name } }); }
          catch { setView({ kind: 'create' }); }
        }} />
        <PushOffer />
        {crews.length > 0 && <ChallengeCard onUse={(draft) => setView({ kind: 'create', draft })} />}

        <View style={styles.segment}>
          {(['active', 'done'] as const).map((t) => (
            <Pressable key={t} onPress={() => setTab(t)} style={[styles.segBtn, tab === t && styles.segOn]} accessibilityRole="tab" accessibilityState={{ selected: tab === t }}>
              <T weight="bold" color={tab === t ? colors.white : colors.deep}>{t === 'active' ? `active (${pools.filter((p) => !settled(p)).length})` : 'settled'}</T>
            </Pressable>
          ))}
        </View>

        {shown.map((p) => <PoolCard key={p.id} p={p} onPress={() => setView({ kind: 'detail', id: p.id })} />)}
        {shown.length === 0 && crews.length > 0 && (tab === 'active' ? (
          <View style={styles.empty}>
            <T size={34}>🦗</T>
            <H size={22} color={colors.deep} style={{ textAlign: 'center' }}>quiet in here</H>
            <T color={colors.muted} style={{ textAlign: 'center' }}>start one in two taps. your crew gets a push.</T>
            <View style={[styles.wrapRow, { justifyContent: 'center' }]}>
              {QUICK.filter((t) => t.mode !== 'members').slice(0, 4).map((t) => (
                <Chip key={t.key} label={`${t.emoji} ${t.label}`} onPress={() => setView({ kind: 'create', draft: {
                  key: `quick:${t.key}`, category: '', emoji: t.emoji, question: t.question, mode: t.mode, outcomes: t.outcomes ?? [],
                  memberIds: [], stake: t.stake ?? 2, crew: crews[0].name, deadline: t.deadline } })} />
              ))}
            </View>
          </View>
        ) : <T color={colors.muted} style={{ textAlign: 'center', marginTop: 24 }}>no settled pools yet. results land here.</T>)}

        <PillButton label="start a pool" onPress={() => setView({ kind: 'create' })} icon={<Ionicons name="add" size={18} color={colors.white} />} />
        <T size={12} color={colors.muted} style={{ textAlign: 'center' }}>pools use free coins only. coins have no cash value.</T>
      </View>
    </ScrollView>
  );
}

const FIRST_RUN_KEY = 'letsjam.firstRun';
const CREW_EMOJI = ['🎉', '🏠', '⚽', '🎓', '🍻', '🏄', '🔥', '💼'];

function Step({ n, done, title, children }: { n: number; done: boolean; title: string; children?: ReactNode }) {
  return (
    <View style={[styles.step, done && { opacity: 0.6 }]}>
      <View style={[styles.stepNum, done && { backgroundColor: colors.win }]}>
        {done ? <Ionicons name="checkmark" size={16} color={colors.white} /> : <T weight="bold" color={colors.white}>{n}</T>}
      </View>
      <View style={{ flex: 1, gap: 8 }}>
        <T weight="bold" size={16} color={colors.deep}>{title}</T>
        {!done && children}
      </View>
    </View>
  );
}

/**
 * New players: make a crew → get people in via WhatsApp → first pool. Disappears once you've done
 * all three (or skipped). Steps tick off from real state, so it also works for people who arrive
 * through a crew/pool link and already have a crew.
 */
function FirstRun({ crews, poolCount, onFirstPool }: { crews: Crew[]; poolCount: number; onFirstPool: (c: Crew) => void }) {
  const [state, setState] = useState<{ shared?: boolean; hidden?: boolean } | null>(null);
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState(CREW_EMOJI[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { AsyncStorage.getItem(FIRST_RUN_KEY).then((v) => setState(v ? JSON.parse(v) : {})).catch(() => setState({})); }, []);
  const remember = (patch: { shared?: boolean; hidden?: boolean }) => setState((s) => {
    const next = { ...s, ...patch };
    AsyncStorage.setItem(FIRST_RUN_KEY, JSON.stringify(next)).catch(() => {});
    return next;
  });

  const crew = crews[0];
  const step1 = !!crew;
  const step2 = !!state?.shared || crews.some((c) => c.memberIds.length > 1);
  const step3 = poolCount > 0;
  if (!state || state.hidden || (step1 && step2 && step3)) return null;

  async function make() {
    setBusy(true); setError(null);
    try { const c = await startCrew(name || `${me().name.split(' ')[0] || 'my'}’s crew`, emoji); track('crew_created', { first_run: true }); if (await shareCrew(c)) remember({ shared: true }); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <View style={styles.firstRun}>
      <View style={styles.between}>
        <Eyebrow label="get your crew going" />
        <Pressable onPress={() => { track('first_run_skipped', { step: !step1 ? 1 : !step2 ? 2 : 3 }); remember({ hidden: true }); }} hitSlop={10} accessibilityRole="button">
          <T size={13} weight="bold" color={colors.muted}>skip</T>
        </Pressable>
      </View>
      <Step n={1} done={step1} title={step1 ? `${crew.emoji} ${crew.name} is live` : 'name your crew'}>
        <View style={styles.wrapRow}>
          {CREW_EMOJI.map((e) => (
            <Pressable key={e} onPress={() => setEmoji(e)} style={[styles.emojiPick, emoji === e && styles.emojiOn]} accessibilityRole="button" accessibilityState={{ selected: emoji === e }}><T size={20}>{e}</T></Pressable>
          ))}
        </View>
        <TextInput style={styles.input} placeholder="house, padel boys, uni gang…" placeholderTextColor={colors.muted} value={name} onChangeText={(t) => { setName(t); setError(null); }} maxLength={24} />
        {error && <T size={13} weight="semi" color={colors.orange}>{error}</T>}
        <PillButton label="make it + invite on WhatsApp" busy={busy} onPress={make} icon={<Ionicons name="logo-whatsapp" size={18} color={colors.white} />} />
      </Step>
      <Step n={2} done={step2} title="get your people in">
        <T size={13} color={colors.muted}>whoever taps your link lands straight in {crew?.name ?? 'your crew'}. you’re friends automatically.</T>
        {crew && <PillButton label="share the link" variant="ghost" onPress={async () => { if (await shareCrew(crew)) remember({ shared: true }); }} icon={<Ionicons name="logo-whatsapp" size={18} color={colors.brand} />} />}
      </Step>
      <Step n={3} done={step3} title="start your first pool">
        <T size={13} color={colors.muted}>we’ll suggest one. tweak it or roll the dice.</T>
        {crew && <PillButton label="start a pool" onPress={() => onFirstPool(crew)} />}
      </Step>
    </View>
  );
}

/** One-time card in the app: turn on notifications for pool results and friend requests. */
function PushOffer() {
  const [show, setShow] = useState(false);
  useEffect(() => { shouldOfferPush().then(setShow); }, []);
  if (!show) return null;
  return (
    <View style={styles.pushCard}>
      <T size={26}>🔔</T>
      <View style={{ flex: 1, gap: 2 }}>
        <T weight="bold" color={colors.deep}>know when your crew calls it</T>
        <T size={13} color={colors.muted}>results, votes, who joined your pool, friend requests.</T>
      </View>
      <View style={{ gap: 6 }}>
        <Pressable onPress={async () => { await enablePush(true); setShow(false); }} style={styles.pushOn} accessibilityRole="button"><T size={13} weight="bold" color={colors.white}>turn on</T></Pressable>
        <Pressable onPress={() => { dismissPushOffer(); setShow(false); }} accessibilityRole="button"><T size={12} weight="bold" color={colors.muted} style={{ textAlign: 'center' }}>not now</T></Pressable>
      </View>
    </View>
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

const settledStatus = (p: Pool) => ['resolved', 'voided', 'rejected'].includes(p.status);

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
  const [stake, setStake] = useState(draft?.stake ?? 2);
  const [deadline, setDeadline] = useState(deadlineIndex(draft?.deadline ?? '24h'));
  const [weekly, setWeekly] = useState(false);
  const [forfeit, setForfeit] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [lastKey, setLastKey] = useState(draft?.key);
  const live = question.length > 6 ? blockedTopic(question) : null;
  const canRepeat = DEADLINES[deadline].key !== 'none' && !(mode !== 'members' && subject);
  const crew = crews.find((c) => c.name === group) ?? crews[0];
  const friends = (crew?.memberIds ?? []).filter((m) => m !== ME);

  const options: PoolOption[] = useMemo(() => {
    if (mode === 'yesno') return [{ id: 'y', label: 'yes' }, { id: 'n', label: 'no' }];
    if (mode === 'members') return picked.map((id) => ({ id, label: nameOf(id), memberId: id }));
    return custom.filter((c) => c.trim()).map((c, i) => ({ id: `c${i}`, label: c.trim() }));
  }, [mode, picked, custom]);

  function applyTemplate(t: QuickTemplate) {
    setQuestion(t.question); setMode(t.mode); setSubject(undefined); setError(null);
    if (t.mode === 'custom') setCustom([...(t.outcomes ?? ['', ''])]);
    if (t.mode === 'members') setPicked(friends.slice(0, t.pick ?? 2));
    setDeadline(deadlineIndex(t.deadline));
    if (t.stake) setStake(t.stake);
    setLastKey(`quick:${t.key}`);
    track('template_used', { key: t.key });
  }

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
      const p = store.create({ question: question.trim(), stake, options, subjectId: mode === 'members' ? undefined : subject, groupName: group, closesAt: deadlineFor(DEADLINES[deadline].key), repeat: canRepeat && weekly ? 'weekly' : undefined, forfeit: forfeit.trim() || undefined });
      haptic.success();
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

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.quickRow}>
        {QUICK.filter((t) => t.mode !== 'members' || friends.length >= 2).map((t) => (
          <Pressable key={t.key} onPress={() => { haptic.tap(); applyTemplate(t); }} accessibilityRole="button" accessibilityLabel={`template: ${t.label}`}
            style={({ pressed }) => [styles.quick, lastKey === `quick:${t.key}` && styles.quickOn, pressed && { transform: [{ scale: 0.96 }] }]}>
            <T size={24}>{t.emoji}</T>
            <T weight="bold" size={13} color={lastKey === `quick:${t.key}` ? colors.white : colors.deep}>{t.label}</T>
          </Pressable>
        ))}
      </ScrollView>

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

      <View style={styles.field}>
        <T weight="bold" color={colors.deep}>closes in</T>
        <View style={styles.wrapRow}>{DEADLINES.map((d, i) => <Chip key={d.label} label={d.label} active={deadline === i} onPress={() => setDeadline(i)} />)}</View>
        <T size={13} color={colors.muted}>{DEADLINES[deadline].key === 'none' ? 'open until you call the result.' : 'no new picks after this. we’ll nudge the crew an hour before, and you when it’s time to call it.'}</T>
        {canRepeat && (
          <Pressable onPress={() => setWeekly((w) => !w)} style={styles.toggleRow} accessibilityRole="switch" accessibilityState={{ checked: weekly }}>
            <Ionicons name={weekly ? 'checkbox' : 'square-outline'} size={22} color={colors.brand} />
            <View style={{ flex: 1 }}>
              <T weight="bold" color={colors.deep}>🔁 run it every week</T>
              <T size={13} color={colors.muted}>a new round opens when this one closes. same question, same picks. stop it any time.</T>
            </View>
          </Pressable>
        )}
      </View>

      <View style={styles.field}>
        <T weight="bold" color={colors.deep}>real-life stake <T size={13} color={colors.muted}>(optional)</T></T>
        <T size={13} color={colors.muted}>what the wrong side owes the crew. just for fun: no money, LetsJam never moves any.</T>
        <View style={styles.wrapRow}>
          {FORFEITS.map((f) => <Chip key={f} label={f} active={forfeit === f} onPress={() => setForfeit(forfeit === f ? '' : f)} />)}
        </View>
        <TextInput style={styles.input} placeholder="or write your own: wears the loser hat 🎩" placeholderTextColor={colors.muted}
          value={forfeit} onChangeText={(t) => { setForfeit(t); setError(null); }} maxLength={60} />
        {forfeit.length > 2 && forfeitProblem(forfeit) && <T size={13} weight="semi" color={colors.orange}>{forfeitProblem(forfeit)}</T>}
      </View>

      {error && <View style={styles.errorBox}><Ionicons name="alert-circle" size={18} color={colors.orange} /><T weight="semi" color={colors.orange} style={{ flex: 1 }}>{error}</T></View>}
      <PillButton label="create pool" onPress={submit} />
      <T size={12} color={colors.muted} style={{ textAlign: 'center' }}>not allowed: drinking, health or injury, dating, looks, danger or crime, self-harm.</T>
    </ScrollView>
  );
}

/** The crew timeline: chat bubbles plus pools, results, trash talk and joins as they happen. */
function CrewFeed({ crew, pools, onOpen }: { crew: Crew; pools: Pool[]; onOpen: (id: string) => void }) {
  const { items, post, remove } = useCrewFeed(crew.id, pools);
  const [text, setText] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const send = () => {
    try { post(text); setText(''); setErr(null); haptic.tap(); }
    catch (e) { setErr((e as Error).message); haptic.warn(); }
  };
  const who = (id?: string) => (!id ? 'someone' : id === ME ? 'you' : nameOf(id));
  const row = (it: FeedItem) => {
    if (it.kind === 'message') {
      const mineMsg = it.userId === ME;
      return (
        <Pressable key={it.id} onLongPress={mineMsg ? () => remove(it.id) : undefined} style={[styles.msgRow, mineMsg && { flexDirection: 'row-reverse' }]} accessibilityHint={mineMsg ? 'long-press to delete' : undefined}>
          {!mineMsg && it.userId && <Avatar id={it.userId} size={28} />}
          <View style={[styles.bubble, mineMsg ? styles.bubbleMine : styles.bubbleThem]}>
            {!mineMsg && <T size={12} weight="bold" color={colors.brand}>{who(it.userId)}</T>}
            <T color={mineMsg ? colors.white : colors.ink}>{it.body}</T>
            <T size={10} color={mineMsg ? '#DFF6FB' : colors.muted} style={{ alignSelf: 'flex-end' }}>{ago(it.at)}</T>
          </View>
        </Pressable>
      );
    }
    if (it.kind === 'joined') return <T key={it.id} size={12} weight="semi" color={colors.muted} style={styles.sys}>👋 {who(it.userId)} joined the crew · {ago(it.at)}</T>;
    const card = (emoji: string, title: string, sub?: string, tone = colors.white) => (
      <Pressable key={it.id} onPress={it.poolId ? () => onOpen(it.poolId!) : undefined} style={({ pressed }) => [styles.feedCard, { backgroundColor: tone }, pressed && { transform: [{ scale: 0.99 }] }]} accessibilityRole="button">
        <T size={22}>{emoji}</T>
        <View style={{ flex: 1, gap: 2 }}>
          <T weight="bold" color={colors.deep} numberOfLines={2}>{title}</T>
          {sub ? <T size={13} color={colors.muted} numberOfLines={2}>{sub}</T> : null}
        </View>
        <T size={11} color={colors.muted}>{ago(it.at)}</T>
      </Pressable>
    );
    if (it.kind === 'pool') {
      const live = pools.find((p) => p.id === it.poolId);
      const canCall = live && live.status === 'open' && !isClosed(live) && !live.entries.some((e) => e.userId === ME);
      return card('📣', `${who(it.userId)} started: ${it.question}`, canCall ? 'make your call 👉' : it.extra ? `🎲 wrong side ${it.extra}` : undefined, canCall ? '#FFFBD6' : colors.white);
    }
    if (it.kind === 'result') return card('🏁', `settled: ${it.question}`, it.extra ? `→ ${it.extra}` : undefined, '#E8F8F0');
    return card('💬', `${who(it.userId)}: ${it.body}`, it.question ? `on “${it.question}”` : undefined);
  };
  return (
    <View style={{ gap: 10 }}>
      {items === null && <SkeletonRows rows={4} />}
      {items && items.length === 0 && (
        <View style={styles.empty}>
          <T size={30}>💬</T>
          <T weight="bold" color={colors.deep}>nothing yet. say hi, or start a pool.</T>
        </View>
      )}
      {items?.map(row)}
      <View style={styles.feedComposer}>
        <TextInput style={styles.composerInput} value={text} onChangeText={(t) => { setText(t); setErr(null); }} placeholder={`message ${crew.name}`} placeholderTextColor={colors.muted}
          maxLength={280} onSubmitEditing={send} returnKeyType="send" blurOnSubmit={false} />
        <Pressable onPress={send} disabled={!text.trim()} style={[styles.feedSend, !text.trim() && { opacity: 0.4 }]} accessibilityRole="button" accessibilityLabel="send">
          <Ionicons name="arrow-up" size={20} color={colors.white} />
        </Pressable>
      </View>
      {err && <T size={13} weight="semi" color={colors.orange}>{err}</T>}
    </View>
  );
}

/** List card: status at a glance, your pick or a nudge to make one, who's in, the pot. */
function PoolCard({ p, onPress }: { p: Pool; onPress: () => void }) {
  const mine = p.entries.find((e) => e.userId === ME);
  const left = p.closesAt ? Date.parse(p.closesAt) - Date.now() : Infinity;
  const closed = isClosed(p);
  const tone = p.status === 'open' && !closed
    ? (left < 3600000 ? { bg: '#FFE6D9', fg: colors.orange, label: 'closing soon' } : { bg: '#DDF5EA', fg: colors.win, label: 'open' })
    : p.status === 'open' ? { bg: '#FFF4CC', fg: '#8A6D00', label: 'call it' }
    : p.status === 'proposed' ? { bg: '#E6E5FF', fg: colors.royal, label: 'voting' }
    : p.status === 'pending_consent' ? { bg: colors.tint, fg: colors.deep, label: 'waiting' }
    : { bg: '#EEF1F2', fg: colors.muted, label: p.status === 'resolved' ? 'settled' : statusLabel(p) };
  const myLabel = mine ? p.options.find((o) => o.id === mine.optionId)?.label : undefined;
  const won = p.status === 'resolved' && mine && mine.optionId === p.resolvedOptionId;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={p.question}
      style={({ pressed }) => [styles.card, { borderLeftWidth: 5, borderLeftColor: tone.fg }, pressed && { transform: [{ scale: 0.985 }] }]}>
      <View style={{ flex: 1, gap: 8 }}>
        <View style={styles.cardTop}>
          <View style={[styles.statusPill, { backgroundColor: tone.bg }]}><T size={11} weight="bold" color={tone.fg}>{tone.label.toUpperCase()}</T></View>
          <T size={12} weight="semi" color={colors.muted} numberOfLines={1} style={{ flex: 1 }}>{p.groupName}{(p.round ?? 1) > 1 || p.repeat ? ` · 🔁 ${p.round ?? 1}` : ''}</T>
          {p.closesAt && p.status === 'open' && !closed && <T size={12} weight="bold" color={left < 3600000 ? colors.orange : colors.muted}>⏰ {timeLeft(p.closesAt)}</T>}
        </View>
        <T weight="bold" size={17} color={colors.deep} numberOfLines={3}>{p.question}</T>
        {p.forfeit && p.status !== 'resolved' && <T size={12} color={colors.muted} numberOfLines={1}>🎲 wrong side {p.forfeit}</T>}
        <View style={styles.cardBottom}>
          <View style={styles.faces}>
            {p.entries.slice(0, 5).map((e, i) => <View key={e.userId} style={{ marginLeft: i ? -8 : 0 }}><Avatar id={e.userId} size={24} /></View>)}
            <T size={12} weight="bold" color={colors.muted} style={{ marginLeft: p.entries.length ? 8 : 0, alignSelf: 'center' }}>{whoIn(p)}{p.comments ? ` · 💬 ${p.comments}` : ''}</T>
          </View>
          <View style={styles.inline}><Coin size={14} /><H size={20} color={colors.deep}>{p.entries.length * p.stake}</H></View>
        </View>
        {p.status === 'open' && !closed && !mine && <View style={styles.callIt}><T weight="bold" size={13} color={colors.deep}>make your call 👉</T></View>}
        {myLabel && p.status !== 'resolved' && <T size={12} weight="bold" color={colors.brand}>your pick: {myLabel}</T>}
        {won && <T size={12} weight="bold" color={colors.win}>🏆 you called it</T>}
      </View>
    </Pressable>
  );
}

/** The "your call" moment: a quick stamp when you lock in a pick. */
function YourCall({ label, pot, onDone }: { label: string; pot: number; onDone: () => void }) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    haptic.success(); sfx.lock();
    Animated.sequence([
      Animated.spring(t, { toValue: 1, friction: 5, tension: 120, useNativeDriver: true }),
      Animated.delay(900),
      Animated.timing(t, { toValue: 0, duration: 220, useNativeDriver: true }),
    ]).start(onDone);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Modal transparent visible animationType="none" onRequestClose={onDone}>
      <Pressable style={styles.stampWrap} onPress={onDone} accessibilityRole="button" accessibilityLabel={`locked in ${label}`}>
        <Animated.View style={[styles.stamp, { opacity: t, transform: [{ scale: t.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }, { rotate: '-4deg' }] }]}>
          <T weight="bold" size={14} color={colors.deep}>LOCKED IN ✅</T>
          <H size={40} color={colors.royal} style={{ textAlign: 'center' }}>{label}</H>
          <View style={styles.inline}><Coin size={16} /><T weight="bold" color={colors.deep}>pot is now {pot}</T></View>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

/** Photo proof: the creator attaches it, the crew sees it while voting and after. Private to the crew. */
function ProofBox({ p }: { p: Pool }) {
  const canAdd = p.createdBy === ME && ['open', 'locked', 'proposed'].includes(p.status) && !p.id.startsWith('tmp-');
  const visible = ['proposed', 'resolved'].includes(p.status) || canAdd;
  const { url, reload } = useProof(p.id, visible);
  const [busy, setBusy] = useState(false);
  if (!visible || (!url && !canAdd)) return null;
  const add = async () => {
    if (busy) return;
    setBusy(true);
    try { if (await pickAndAttachProof(p.id)) { reload(); toast('proof added 📸'); } }
    catch (e) { toast((e as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <View style={styles.proof}>
      {url
        ? <Image source={{ uri: url }} style={styles.proofImg} resizeMode="cover" accessibilityLabel="proof photo" />
        : <T size={13} color={colors.muted}>add a photo so nobody can say “that didn’t happen”: the score, the receipt, the finish-line selfie.</T>}
      <View style={styles.between}>
        <T weight="bold" color={colors.deep}>{url ? '📸 proof' : '📸 no proof yet'}</T>
        {canAdd && (
          <Pressable onPress={add} hitSlop={8} accessibilityRole="button" accessibilityLabel={url ? 'replace proof photo' : 'add proof photo'}>
            <T weight="bold" color={colors.brand}>{busy ? 'uploading…' : url ? 'replace' : 'add proof'}</T>
          </Pressable>
        )}
      </View>
    </View>
  );
}

/** How many of the crew called it: "3 of 5 called it" (or "3 in" when the crew size is unknown). */
function whoIn(p: Pool) {
  const size = crewList().find((c) => (p.groupId ? c.id === p.groupId : c.name === p.groupName))?.memberIds.length ?? 0;
  const n = p.entries.length;
  return size > n ? `${n} of ${size} called it` : `${n} in`;
}
/** One tap: the pool link (with its live preview card) into the group chat. */
async function sharePool(p: Pool, via: string) {
  const link = `${APP_URL}/p/${p.id}?i=${inviteCode()}&from=${encodeURIComponent(me().handle)}`;
  const r = await shareText(`${p.question} 👀 i started a pool on LetsJam, make your call:`, link);
  if (r !== 'dismissed') track('pool_shared', { via });
  if (r === 'copied') toast('link copied. paste it in the group chat 👊');
  return r;
}

function PoolDetail({ pool: p, onBack, refresh, renderBar, fresh }: { pool: Pool; onBack: () => void; refresh: () => void; renderBar: RenderBar; fresh?: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const mine = p.entries.find((e) => e.userId === ME);
  const myVote = p.votes.find((v) => v.userId === ME);
  const act = (fn: () => void) => { try { setError(null); fn(); refresh(); } catch (e) { setError((e as Error).message); } };
  const total = Math.max(p.entries.length, 1);
  const pot = p.entries.length * p.stake;
  const winnerId = p.resolvedOptionId ?? p.proposedOptionId;
  const [reporting, setReporting] = useState<{ userId: string } | null>(null);
  const closed = isClosed(p);
  useClock();
  const saving = p.id.startsWith('tmp-');
  const [stamp, setStamp] = useState<{ label: string; pot: number } | null>(null);
  const askToShare = LIVE && ['open', 'pending_consent'].includes(p.status) && !closed && (fresh || (p.createdBy === ME && p.entries.length <= 1));
  const iWon = p.status === 'resolved' && !!mine && mine.optionId === p.resolvedOptionId;
  useEffect(() => { if (iWon) { haptic.success(); askForRatingAfterWin(); } }, [iWon]);

  return (
    <View style={{ flex: 1 }}>
    <ScrollView style={styles.page} contentContainerStyle={styles.body}>
      {stamp && <YourCall label={stamp.label} pot={stamp.pot} onDone={() => setStamp(null)} />}
      <View style={styles.inBar}>{renderBar('light')}</View>
      <BackBar label="pools" onBack={onBack} />
      <Eyebrow label={p.groupName + (p.subjectId ? ` · about ${nameOf(p.subjectId)}` : '') + ((p.round ?? 1) > 1 || p.repeat ? ` · 🔁 round ${p.round ?? 1}` : '')} />
      <H size={32}>{p.question}</H>

      <View style={styles.potCard}>
        <Coin size={28} />
        <View>
          <H size={36} color={colors.white}>{pot} coins</H>
          <T weight="semi" color={colors.white}>{p.stake} each · {whoIn(p)} · {statusLabel(p)}</T>
          {p.closesAt && p.status === 'open' && <T weight="bold" color={colors.yellow}>⏰ {closed ? 'closed for new picks' : timeLeft(p.closesAt)}</T>}
          {p.forfeit && p.status !== 'resolved' && <T weight="bold" color={colors.white}>🎲 wrong side {p.forfeit}</T>}
        </View>
      </View>

      {askToShare && (
        <View style={[styles.notice, { backgroundColor: colors.yellow }]}>
          <T weight="bold" size={16} color={colors.deep}>{p.entries.length === 0 ? 'pool’s live 🔥 now get the crew in' : 'more people = bigger pot 👀'}</T>
          <T color={colors.deep}>drop it in the group chat. they see the question and who’s in, one tap and they’re playing.</T>
          <PillButton label={saving ? 'saving…' : 'send to the group chat'} icon={<Ionicons name="logo-whatsapp" size={18} color={colors.white} />}
            onPress={() => { if (!saving) sharePool(p, fresh ? 'after_create' : 'detail'); }} />
        </View>
      )}

      {p.status === 'pending_consent' && (
        <View style={styles.notice}>
          {p.subjectId === ME ? (<>
            <T weight="semi" color={colors.deep}>this pool is about you. ok with it?</T>
            <View style={styles.wrapRow}>
              <Chip label="yes, open it" onPress={() => act(() => store.consent(p.id, true))} />
              <Chip label="no thanks" onPress={() => act(() => store.consent(p.id, false))} />
            </View>
          </>) : (<>
            <T weight="semi" color={colors.deep}>{nameOf(p.subjectId!)} needs to accept before anyone can join.</T>
            {!LIVE && <PillButton label={`demo: ${nameOf(p.subjectId!)} says ok`} variant="ghost" onPress={() => act(() => store.simulateConsent(p.id))} />}
          </>)}
        </View>
      )}

      <T weight="bold" color={colors.deep}>{mine || closed ? 'all picks' : p.status === 'open' ? `tap a pick to join for ${p.stake}` : 'all picks'}</T>
      {p.options.map((o) => {
        const n = p.entries.filter((e) => e.optionId === o.id).length;
        const isMine = mine?.optionId === o.id;
        const isWin = winnerId === o.id && (p.status === 'resolved' || p.status === 'proposed');
        return (
          <Pressable key={o.id} disabled={p.status !== 'open' || !!mine || closed}
            onPress={() => { try { setError(null); store.join(p.id, o.id); refresh(); setStamp({ label: o.label, pot: pot + p.stake }); } catch (e) { haptic.warn(); setError((e as Error).message); } }}
            style={({ pressed }) => [styles.option, isMine && styles.optionMine, isWin && styles.optionWin, pressed && { transform: [{ scale: 0.98 }] }]} accessibilityRole="button">
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
        <View style={[styles.notice, closed && { borderWidth: 2, borderColor: colors.sun }]}>
          <T weight="bold" color={colors.deep}>{closed ? 'time to call it 🏁 who won?' : 'did it happen? propose the result'}</T>
          <T size={13} color={colors.muted}>everyone in the pool gets 48 hours to confirm or dispute. no majority means everyone gets their coins back.</T>
          <View style={styles.wrapRow}>{p.options.map((o) => <Chip key={o.id} label={o.label} onPress={() => act(() => store.propose(p.id, o.id))} />)}</View>
          <ProofBox p={p} />
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
          {LIVE
            ? <T size={12} color={colors.muted}>settles automatically 48 hours after the result was proposed.</T>
            : <PillButton label="demo: skip the 48 hours" variant="ghost" onPress={() => act(() => store.finalize(p.id))} />}
          <ProofBox p={p} />
        </View>
      )}
      {p.status === 'resolved' && <View style={[styles.notice, { backgroundColor: colors.yellow }]}><T weight="bold" color={colors.deep}>settled. winners split {pot} coins.</T></View>}
      {p.status === 'resolved' && <ProofBox p={p} />}
      {p.status === 'resolved' && p.forfeit && (() => {
        const losers = p.entries.filter((e) => e.optionId !== p.resolvedOptionId).map((e) => (e.userId === ME ? 'you' : nameOf(e.userId)));
        return losers.length > 0 ? (
          <View style={styles.notice}>
            <T weight="bold" color={colors.deep}>🎲 real-life stake</T>
            <T color={colors.deep}>{losers.join(', ')} {p.forfeit}. no excuses.</T>
          </View>
        ) : null;
      })()}
      {p.status === 'resolved' && (
        <PillButton label={p.entries.some((e) => e.userId === ME && e.optionId === p.resolvedOptionId) ? 'brag about it 🏆' : 'share the result'}
          icon={<Ionicons name="share-social" size={18} color={colors.white} />}
          onPress={async () => {
            const winner = p.options.find((o) => o.id === p.resolvedOptionId)?.label ?? '';
            const link = `${APP_URL}/r/${p.id}?i=${inviteCode()}&from=${encodeURIComponent(me().handle)}`;
            const r = await shareText(`${p.question} → ${winner} 🏆`, link);
            if (r !== 'dismissed') track('result_shared');
          }} />
      )}
      {p.repeat && p.createdBy === ME && (
        <Pressable onPress={() => store.stopRepeat(p.id)} style={{ alignSelf: 'center', paddingVertical: 6 }} accessibilityRole="button">
          <T size={13} weight="bold" color={colors.muted}>stop the weekly rounds</T>
        </Pressable>
      )}
      {p.status === 'voided' && <View style={styles.notice}><T weight="semi" color={colors.deep}>no majority confirmed, so the pool was cancelled and everyone got their coins back.</T></View>}
      {error && <View style={styles.errorBox}><Ionicons name="alert-circle" size={18} color={colors.orange} /><T weight="semi" color={colors.orange} style={{ flex: 1 }}>{error}</T></View>}
      {LIVE && !settledStatus(p) && !askToShare && (
        <PillButton label="invite friends to this pool" variant="ghost" icon={<Ionicons name="logo-whatsapp" size={18} color={colors.brand} />}
          onPress={() => { if (!saving) sharePool(p, 'detail_bottom'); }} />
      )}
      <TrashTalk poolId={p.id} onReport={(userId) => setReporting({ userId })} />
      {p.createdBy !== ME && (
        <Pressable onPress={() => setReporting({ userId: p.createdBy })} style={{ alignSelf: 'center', paddingVertical: 6 }} accessibilityRole="button">
          <T size={13} weight="bold" color={colors.muted}>report this pool</T>
        </Pressable>
      )}
    </ScrollView>
    {reporting && <ReportSheet poolId={p.id} userId={reporting.userId} onClose={() => setReporting(null)} onBlocked={reporting.userId === p.createdBy ? onBack : undefined} />}
    </View>
  );
}

/** A crew: who's on top this month, streaks, invite, start a pool here. */
function CrewView({ crew, pools, renderBar, onBack, onOpen, onNew }: { crew: Crew; pools: Pool[]; renderBar: RenderBar; onBack: () => void; onOpen: (id: string) => void; onNew: () => void }) {
  const [period, setPeriod] = useState<Period>('month');
  const [pane, setPane] = useState<'feed' | 'table'>('feed');
  useEffect(() => { if (pane === 'table') track('standings_viewed'); }, [pane]);
  const rows = useStandings(crew.id, crew.memberIds, pools, period);
  const titles = useCrewTitles(crew.id, pools);
  const badges = (id: string) => titles.filter((t) => t.userId === id).map((t) => t.emoji).join('');
  const open = pools.filter((p) => p.status === 'open' || p.status === 'proposed');
  const month = new Date().toLocaleString('en', { month: 'long' }).toLowerCase();
  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.body}>
      <View style={styles.inBar}>{renderBar('light')}</View>
      <BackBar label="pools" onBack={onBack} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={styles.groupAvatar}><T size={26}>{crew.emoji}</T></View>
        <View style={{ flex: 1 }}><H size={30}>{crew.name}</H><T color={colors.muted}>{crew.memberIds.length} in the crew</T></View>
      </View>
      <View style={{ gap: 8 }}>
        <PillButton label="invite on WhatsApp" variant="ghost" onPress={() => shareCrew(crew)} icon={<Ionicons name="logo-whatsapp" size={18} color={colors.brand} />} />
        <PillButton label="new pool" onPress={onNew} icon={<Ionicons name="add" size={18} color={colors.white} />} />
      </View>

      <View style={styles.segment}>
        {(['feed', 'table'] as const).map((t) => (
          <Pressable key={t} onPress={() => { haptic.tap(); setPane(t); }} style={[styles.segBtn, pane === t && styles.segOn]} accessibilityRole="tab" accessibilityState={{ selected: pane === t }}>
            <T weight="bold" color={pane === t ? colors.white : colors.deep}>{t === 'feed' ? '💬 feed' : '🏆 standings'}</T>
          </Pressable>
        ))}
      </View>

      {pane === 'feed' ? <CrewFeed crew={crew} pools={pools} onOpen={onOpen} /> : (<>
      <Eyebrow label={period === 'month' ? `standings · ${month}` : 'standings · all time'} />
      <View style={{ flexDirection: 'row', gap: 6 }}>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          <Chip label="this month" active={period === 'month'} onPress={() => setPeriod('month')} />
          <Chip label="all time" active={period === 'all'} onPress={() => setPeriod('all')} />
        </View>
      </View>
      <View style={styles.board}>
        {rows === null && <SkeletonRows rows={3} />}
        {rows && rows.every((r) => r.played === 0) && <T color={colors.muted}>no settled pools {period === 'month' ? 'this month' : 'yet'}. call one and the table fills up.</T>}
        {rows?.filter((r) => r.played > 0).map((r, i) => (
          <View key={r.userId} style={[styles.boardRow, i === 0 && { backgroundColor: colors.tint }]}>
            <T weight="bold" size={18} color={colors.deep} style={{ width: 28 }}>{i === 0 ? '👑' : i + 1}</T>
            <Avatar id={r.userId} size={34} />
            <View style={{ flex: 1 }}>
              <T weight="bold" color={colors.deep}>{r.userId === ME ? 'you' : nameOf(r.userId)}{badges(r.userId) ? ` ${badges(r.userId)}` : ''}{r.streak >= 2 ? `  🔥${r.streak}` : ''}</T>
              <T size={13} color={colors.muted}>called {r.won} of {r.played}</T>
            </View>
            <T weight="bold" color={r.net >= 0 ? colors.win : colors.orange}>{r.net >= 0 ? '+' : ''}{r.net}</T>
          </View>
        ))}
      </View>

      <Eyebrow label="this week’s titles" />
      {titles.length === 0
        ? <T color={colors.muted}>no titles yet this week. settle a couple of pools and the crowns start flying 👑</T>
        : (
          <View style={styles.titles}>
            {titles.map((t) => (
              <View key={t.key} style={styles.titleCard}>
                <T size={26}>{t.emoji}</T>
                <View style={{ flex: 1 }}>
                  <T weight="bold" color={colors.deep}>{t.title}</T>
                  <T size={13} color={colors.muted}>{t.userId === ME ? 'you' : t.userId ? nameOf(t.userId) : '?'} · {t.why}</T>
                </View>
                {t.userId && <Avatar id={t.userId} size={30} />}
              </View>
            ))}
          </View>
        )}

      {open.length > 0 && <Eyebrow label="open in this crew" />}
      {open.map((p) => (
        <Pressable key={p.id} style={styles.card} onPress={() => onOpen(p.id)}>
          <T weight="bold" size={16} color={colors.deep}>{p.question}</T>
          <T size={13} color={colors.muted}>{statusLabel(p)}{p.closesAt && p.status === 'open' ? ` · ⏰ ${timeLeft(p.closesAt)}` : ''}</T>
        </Pressable>
      ))}
      </>)}
    </ScrollView>
  );
}

/** Comments + reactions under a pool. Crew-only; blocked people's comments are hidden server-side. */
function TrashTalk({ poolId, onReport }: { poolId: string; onReport: (userId: string) => void }) {
  const { thread, post, remove, react } = useThread(poolId);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const send = () => { try { post(text); setText(''); setError(null); } catch (e) { setError((e as Error).message); } };
  const count = (e: string) => thread.reactions.find((r) => r.emoji === e);
  return (
    <View style={styles.notice}>
      <T weight="bold" color={colors.deep}>trash talk {thread.comments.length ? `(${thread.comments.length})` : ''}</T>
      <View style={styles.wrapRow}>
        {REACTIONS.map((e) => {
          const r = count(e);
          return (
            <Pressable key={e} onPress={() => react(e)} style={[styles.react, r?.mine && styles.reactOn]} accessibilityRole="button" accessibilityLabel={`react ${e}`} accessibilityState={{ selected: !!r?.mine }}>
              <T size={16}>{e}</T>{r ? <T size={13} weight="bold" color={colors.deep}>{r.n}</T> : null}
            </Pressable>
          );
        })}
      </View>
      {thread.comments.length === 0 && <T size={13} color={colors.muted}>no chirps yet. say something.</T>}
      {thread.comments.map((c) => (
        <View key={c.id} style={styles.comment}>
          <Avatar id={c.userId} size={28} />
          <View style={{ flex: 1, gap: 2 }}>
            <T size={13} weight="bold" color={colors.deep}>{c.userId === ME ? 'you' : nameOf(c.userId)} <T size={12} color={colors.muted}>{ago(c.at)}</T></T>
            <T color={colors.ink}>{c.body}</T>
          </View>
          <Pressable onPress={() => (c.userId === ME ? remove(c.id) : onReport(c.userId))} hitSlop={10} accessibilityRole="button" accessibilityLabel={c.userId === ME ? 'delete comment' : 'report comment'}>
            <Ionicons name={c.userId === ME ? 'trash-outline' : 'flag-outline'} size={16} color={colors.muted} />
          </Pressable>
        </View>
      ))}
      <View style={styles.composer}>
        <TextInput style={[styles.input, { flex: 1, paddingVertical: 10 }]} placeholder="talk your talk…" placeholderTextColor={colors.muted}
          value={text} onChangeText={(t) => { setText(t); setError(null); }} maxLength={280} onSubmitEditing={send} returnKeyType="send" />
        <Pressable onPress={send} style={styles.sendBtn} accessibilityRole="button" accessibilityLabel="send"><Ionicons name="send" size={18} color={colors.white} /></Pressable>
      </View>
      {error && <T size={13} weight="semi" color={colors.orange}>{error}</T>}
    </View>
  );
}
function ago(iso: string) {
  const m = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 60000));
  return m < 1 ? 'now' : m < 60 ? `${m}m` : m < 1440 ? `${Math.floor(m / 60)}h` : `${Math.floor(m / 1440)}d`;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.cloud },
  inBar: { marginHorizontal: -18, marginTop: -18 },
  band: { paddingHorizontal: 18, paddingTop: 10, paddingBottom: 22, gap: 8 },
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
  msgRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  bubble: { maxWidth: '78%', borderRadius: 18, paddingHorizontal: 12, paddingVertical: 8, gap: 2 },
  bubbleMine: { backgroundColor: colors.brand, borderBottomRightRadius: 6 },
  bubbleThem: { backgroundColor: colors.white, borderBottomLeftRadius: 6, ...shadow.soft },
  sys: { textAlign: 'center', paddingVertical: 2 },
  feedCard: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: radius.card, paddingHorizontal: 14, paddingVertical: 12, ...shadow.soft },
  feedComposer: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.white, borderRadius: 999, paddingLeft: 16, paddingRight: 6, paddingVertical: 6, borderWidth: 1.5, borderColor: colors.line, marginTop: 4 },
  composerInput: { flex: 1, fontFamily: fonts.body, fontSize: 15, color: colors.ink, paddingVertical: 8 },
  feedSend: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  empty: { backgroundColor: colors.white, borderRadius: radius.card, padding: 20, gap: 8, alignItems: 'center', ...shadow.soft },
  quickRow: { gap: 10, paddingVertical: 2, paddingRight: 8 },
  quick: { width: 104, backgroundColor: colors.white, borderRadius: 18, padding: 12, gap: 6, ...shadow.soft },
  quickOn: { backgroundColor: colors.brand },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  statusPill: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  callIt: { alignSelf: 'flex-start', backgroundColor: colors.yellow, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 },
  stampWrap: { flex: 1, backgroundColor: 'rgba(5,19,32,0.35)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  stamp: { backgroundColor: colors.yellow, borderRadius: 28, paddingHorizontal: 30, paddingVertical: 22, alignItems: 'center', gap: 6, borderWidth: 4, borderColor: colors.royal, ...shadow.button },
  titles: { gap: 8 },
  titleCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.white, borderRadius: radius.card, paddingHorizontal: 14, paddingVertical: 10, ...shadow.soft },
  proof: { backgroundColor: colors.cloud, borderRadius: radius.card, padding: 12, gap: 10 },
  proofImg: { width: '100%', aspectRatio: 4 / 3, borderRadius: 14, backgroundColor: colors.tint },
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
  firstRun: { backgroundColor: colors.white, borderRadius: radius.card, padding: 16, gap: 14, borderWidth: 2, borderColor: colors.brand, ...shadow.soft },
  step: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  stepNum: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.royal, alignItems: 'center', justifyContent: 'center' },
  emojiPick: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.cloud },
  emojiOn: { backgroundColor: colors.tint, borderWidth: 2, borderColor: colors.brand },
  toggleRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', marginTop: 6 },
  board: { backgroundColor: colors.white, borderRadius: radius.card, padding: 8, gap: 2, ...shadow.soft },
  boardRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: 14 },
  react: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.cloud, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1.5, borderColor: 'transparent' },
  reactOn: { borderColor: colors.brand, backgroundColor: colors.tint },
  comment: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  composer: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  sendBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  pushCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.white, borderRadius: radius.card, padding: 14, borderWidth: 2, borderColor: colors.sun, ...shadow.soft },
  pushOn: { backgroundColor: colors.brand, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 8 },
  surprise: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.royal, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 8, ...shadow.button },
});
