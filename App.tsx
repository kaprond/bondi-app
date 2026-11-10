import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, LayoutChangeEvent, Platform, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFonts, Baloo2_600SemiBold, Baloo2_700Bold, Baloo2_800ExtraBold } from '@expo-google-fonts/baloo-2';
import { Quicksand_500Medium, Quicksand_600SemiBold, Quicksand_700Bold } from '@expo-google-fonts/quicksand';
import { api, Daily, dailyAmount } from './src/api';
import { loadSave } from './src/persist';
import { DailyReward } from './src/components/DailyReward';
import { shareText } from './src/share';
import { Dare, dareName, readDare } from './src/dare';
import { onBus } from './src/bus';
import { sfx } from './src/sfx';
import { dayKey, isDone, MISSIONS } from './src/missions';
import { markLeagueResultSeen, syncLeague, useLeague } from './src/leagueState';
import { TIERS } from './src/league';
import { MissionsSheet } from './src/components/MissionsSheet';
import { LeagueScreen } from './src/components/LeagueScreen';
import { BreakReminder } from './src/components/BreakReminder';
import { InstallSheet } from './src/components/InstallSheet';
import { installKind } from './src/install';
import { ClipCard } from './src/components/ClipCard';
import { PoolsScreen } from './src/components/PoolsScreen';
import { CreatorScreen } from './src/components/CreatorScreen';
import { refreshCreator } from './src/creatorState';
import { ProfileScreen } from './src/components/ProfileScreen';
import { FriendsScreen } from './src/components/FriendsScreen';
import { SetupProfile } from './src/components/SetupProfile';
import { befriendInviter, friendList, incomingList, inviteCode, inviteLink, syncMyStats, useSocial } from './src/social';
import { H, T } from './src/components/ui';
import { BarTone, TopBar } from './src/components/TopBar';
import { Welcome } from './src/components/Welcome';
import { recordShare, setSound, useStats } from './src/session';
import { Toast } from './src/components/Toast';
import { colors, radius } from './src/theme';
import { FeedClip, Side, Stake } from './src/types';

type Tab = 'feed' | 'pools' | 'create' | 'friends' | 'me';
const AGE_KEY = 'bondi.ageConfirmed';
const INSTALL_KEY = 'bondi.installAsked';

export default function App() {
  const [loaded] = useFonts({ Baloo2_600SemiBold, Baloo2_700Bold, Baloo2_800ExtraBold, Quicksand_500Medium, Quicksand_600SemiBold, Quicksand_700Bold });
  const [saveLoaded, setSaveLoaded] = useState(false);
  useEffect(() => { loadSave().finally(() => setSaveLoaded(true)); }, []);
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      {loaded && saveLoaded ? <Shell /> : <View style={{ flex: 1, backgroundColor: colors.brand }} />}
    </SafeAreaProvider>
  );
}

function Shell() {
  const insets = useSafeAreaInsets();
  const [ageOk, setAgeOk] = useState<boolean | null>(null);
  const [feed, setFeed] = useState<FeedClip[]>([]);
  const [balance, setBalance] = useState(0);
  const [daily, setDaily] = useState<Daily | null>(null);
  const [showDaily, setShowDaily] = useState(false);
  const [invite] = useState(readInvite);
  const [dare, setDare] = useState<Dare | null>(readDare);
  const [activeIndex, setActiveIndex] = useState(0);
  const [height, setHeight] = useState(0);
  const [tab, setTab] = useState<Tab>('feed');
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);
  const clearToast = useCallback(() => setToast(null), []);
  const listRef = useRef<FlatList<FeedClip>>(null);
  const stats = useStats();
  const { streak } = stats;
  const [setup, setSetup] = useState(false);
  const [poolIntent, setPoolIntent] = useState<{ friendId: string; n: number } | undefined>();
  const social = useSocial();
  const league = useLeague();
  const [leagueOpen, setLeagueOpen] = useState(false);
  const [missionsOpen, setMissionsOpen] = useState(false);
  const [breakOpen, setBreakOpen] = useState(false);
  const [installOpen, setInstallOpen] = useState<'prompt' | 'ios' | null>(null);
  const installAsked = useRef<boolean | null>(null);
  useEffect(() => { AsyncStorage.getItem(INSTALL_KEY).then((v) => { installAsked.current = v === '1'; }).catch(() => { installAsked.current = true; }); }, []);
  const [claimed, setClaimed] = useState<{ day: string; ids: string[] }>({ day: dayKey(), ids: [] });
  const claiming = useRef(new Set<string>());

  // toasts, league and missions can be opened from anywhere
  useEffect(() => onBus((e) => {
    if (e.kind === 'toast') { setToast({ id: Date.now(), text: e.text }); if (e.coins) sfx.coins(); }
    if (e.kind === 'league') setLeagueOpen(true);
    if (e.kind === 'missions') setMissionsOpen(true);
  }), []);

  // a finished mission pays out by itself (once a day; the server re-checks it)
  const today = stats.today?.day === dayKey() ? stats.today : null;
  useEffect(() => {
    if (!today) return;
    const ids = claimed.day === today.day ? claimed.ids : [];
    for (const m of MISSIONS) {
      if (!isDone(m, today) || ids.includes(m.id) || claiming.current.has(m.id)) continue;
      claiming.current.add(m.id);
      api.claimMission(m.id).then((r) => {
        setBalance(r.balance);
        setClaimed((c) => ({ day: today.day, ids: [...(c.day === today.day ? c.ids : []), m.id] }));
        if (r.reward > 0) { setToast({ id: Date.now(), text: `${m.emoji} mission done · +${r.reward} coins` }); sfx.coins(); }
      }).catch(() => {}).finally(() => claiming.current.delete(m.id));
    }
  }, [today, claimed]); // eslint-disable-line react-hooks/exhaustive-deps
  const missionsDone = today ? MISSIONS.filter((m) => isDone(m, today)).length : 0;

  // your league score and the friends who share your league
  useEffect(() => { syncLeague(stats.weekWon ?? 0, friendList()); }, [stats.weekWon, social]);
  useEffect(() => {
    const l = league.last;
    if (!l || l.seen) return;
    const t = TIERS[l.to];
    setToast({ id: Date.now(), text: l.to > l.from ? `last week #${l.rank}: up to ${t.name} ${t.emoji}` : l.to < l.from ? `last week #${l.rank}: down to ${t.name}. bounce back` : `last week #${l.rank}: staying in ${t.name} ${t.emoji}` });
    markLeagueResultSeen();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // the 30-minute break reminder promised on the profile
  const [breakKey, setBreakKey] = useState(0);
  useEffect(() => {
    if (ageOk !== true || setup) return;
    const t = setTimeout(() => setBreakOpen(true), 30 * 60 * 1000);
    return () => clearTimeout(t);
  }, [ageOk, setup, breakKey]);

  // commission from people calling your uploaded clips comes in while you play
  useEffect(() => {
    if (ageOk !== true) return;
    const tick = () => { refreshCreator().then(setBalance).catch(() => {}); };
    tick();
    const t = setInterval(tick, 20_000);
    return () => clearInterval(t);
  }, [ageOk]);

  useEffect(() => { syncMyStats({ calls: stats.bets, hitRate: stats.bets ? Math.round((stats.wins / stats.bets) * 100) : 0, bestStreak: stats.bestStreak }); }, [stats]);

  useEffect(() => {
    AsyncStorage.getItem(AGE_KEY).then((v) => setAgeOk(v === '1')).catch(() => setAgeOk(false));
    (async () => {
      setBalance(await api.getBalance());
      const f = await api.getFeed();
      // a dare link puts that clip first
      const dc = dare ? f.find((c) => c.id === dare.clipId) : undefined;
      setFeed(dc ? [dc, ...f.filter((c) => c !== dc)] : f);
      if (dare && !dc) setDare({ ...dare, clipId: '' });
      const d = await api.getDaily(); setDaily(d); setShowDaily(!d.claimed);
    })();
  }, []);

  // Opened from a friend's invite link while already playing: just connect you two.
  useEffect(() => {
    if (!invite || ageOk !== true || setup) return;
    clearInviteFromUrl();
    if (invite.code === inviteCode()) return;
    const p = befriendInviter(invite.from);
    setToast({ id: Date.now(), text: `you and @${p.handle} are friends now` });
  }, [invite, ageOk]); // eslint-disable-line react-hooks/exhaustive-deps

  // The dared clip is gone from your feed when you already called it.
  useEffect(() => {
    if (!dare || dare.clipId || ageOk !== true || setup) return;
    setToast({ id: Date.now(), text: `you already called the clip ${dareName(dare)} sent. here’s what’s new` });
    setDare(null);
  }, [dare, ageOk, setup]);

  // After your third call, once: offer to put bondi on the home screen (web on a phone only).
  useEffect(() => {
    if (installAsked.current !== false || stats.bets < 3 || installOpen) return;
    const kind = installKind();
    if (kind === 'none') return;
    installAsked.current = true;
    setInstallOpen(kind);
  }, [activeIndex]); // eslint-disable-line react-hooks/exhaustive-deps
  const installDone = (installed: boolean) => {
    setInstallOpen(null);
    AsyncStorage.setItem(INSTALL_KEY, '1').catch(() => {});
    if (installed) setToast({ id: Date.now(), text: 'bondi is on your home screen 🎉' });
  };

  // Desktop: arrow keys or j/k move through the feed.
  useEffect(() => {
    if (Platform.OS !== 'web' || tab !== 'feed') return;
    const doc = (globalThis as { document?: Document }).document;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;
      const dir = e.key === 'ArrowDown' || e.key === 'j' ? 1 : e.key === 'ArrowUp' || e.key === 'k' ? -1 : 0;
      if (!dir) return;
      e.preventDefault();
      const to = Math.max(0, Math.min(feed.length, activeIndex + dir));
      if (to < feed.length) listRef.current?.scrollToIndex({ index: to, animated: true });
      else listRef.current?.scrollToEnd({ animated: true });
    };
    doc?.addEventListener('keydown', onKey);
    return () => doc?.removeEventListener('keydown', onKey);
  }, [tab, feed.length, activeIndex]);

  const placeBet = useCallback(async (clipId: string, choice: Side, stake: Stake) => {
    const r = await api.placeBet(clipId, choice, stake);
    setBalance(r.balance);
    return r;
  }, []);

  const claim = async () => {
    const r = await api.claimDaily();
    setBalance(r.balance);
    setDaily({ claimed: true, dayStreak: r.dayStreak, amount: r.amount || dailyAmount(r.dayStreak) });
    setShowDaily(false);
    if (r.amount > 0) { setToast({ id: Date.now(), text: `+${r.amount} coins landed. let’s goooo` }); sfx.coins(); }
  };

  const welcomeDone = async () => {
    setSound(true); setAgeOk(true); setSetup(true); AsyncStorage.setItem(AGE_KEY, '1').catch(() => {});
    if (!invite) return;
    clearInviteFromUrl();
    if (invite.code === inviteCode()) return;
    const p = befriendInviter(invite.from);
    try {
      setBalance(await api.redeemInvite(invite.code));
      setToast({ id: Date.now(), text: `+500 from @${p.handle}’s invite. you’re friends now` });
    } catch { /* code already used: still friends */ }
  };

  const onViewable = useRef(({ viewableItems }: { viewableItems: Array<{ index?: number | null }> }) => {
    if (viewableItems[0]?.index != null) setActiveIndex(viewableItems[0].index);
  }).current;

  if (ageOk === null) return <View style={{ flex: 1, backgroundColor: colors.brand }} />;
  if (!ageOk) return <Welcome topInset={insets.top} bottomInset={insets.bottom} invitedBy={invite?.from} onAccept={welcomeDone} />;

  if (setup) return (
    <View style={{ flex: 1 }}>
      <SetupProfile topInset={insets.top} onDone={() => setSetup(false)} />
      {toast && <Toast id={toast.id} text={toast.text} top={insets.top + 12} onDone={clearToast} />}
    </View>
  );

  const renderBar = (tone: BarTone) => <TopBar tone={tone} topInset={insets.top} balance={balance} streak={streak} onCoins={() => setTab('me')}
    missions={{ done: missionsDone, total: MISSIONS.length }} onMissions={() => setMissionsOpen(true)} />;
  const next = (i: number) => { if (i + 1 < feed.length) listRef.current?.scrollToIndex({ index: i + 1 }); else setActiveIndex(feed.length); };

  return (
    <View style={styles.root}>
      <View style={{ flex: 1 }}>
        {tab === 'pools' && <PoolsScreen renderBar={renderBar} intent={poolIntent} onBalance={async () => setBalance(await api.getBalance())} />}
        {tab === 'create' && <CreatorScreen renderBar={renderBar} onBalance={setBalance} />}
        {tab === 'friends' && <FriendsScreen renderBar={renderBar} onPoolWith={(friendId) => { setPoolIntent({ friendId, n: Date.now() }); setTab('pools'); }} />}
        {tab === 'me' && <ProfileScreen renderBar={renderBar} balance={balance} daily={daily} onClaim={claim} onFriends={() => setTab('friends')} />}
        <View style={[{ flex: 1 }, tab !== 'feed' && { display: 'none' }]} onLayout={(e: LayoutChangeEvent) => setHeight(e.nativeEvent.layout.height)}>
          {height > 0 && (
            <FlatList
              ref={listRef}
              data={feed}
              keyExtractor={(c) => c.id}
              pagingEnabled
              showsVerticalScrollIndicator={false}
              onViewableItemsChanged={onViewable}
              viewabilityConfig={{ itemVisiblePercentThreshold: 80 }}
              getItemLayout={(_, index) => ({ length: height, offset: height * index, index })}
              renderItem={({ item, index }) => (
                <ClipCard clip={item} dare={dare?.clipId === item.id ? dare : undefined} active={tab === 'feed' && index === activeIndex && !showDaily && !leagueOpen && !missionsOpen && !breakOpen && !installOpen} height={height} topInset={insets.top}
                  balance={balance} placeBet={placeBet} onNext={() => next(index)} />
              )}
              ListFooterComponent={<FeedEnd height={height} onPools={() => setTab('pools')} onCreate={() => setTab('create')} onInvite={async () => {
                const r = await shareText(`come play bondi with me. guess what happens next, free coins, no cash. we both get 500 coins.`, inviteLink());
                if (r !== 'dismissed') recordShare();
                if (r === 'copied') setToast({ id: Date.now(), text: 'invite link copied' });
              }} />}
            />
          )}
        </View>

        {tab === 'feed' && <View style={styles.header} pointerEvents="box-none">{renderBar('media')}</View>}
        {showDaily && daily && !daily.claimed && <DailyReward daily={daily} onClaim={claim} onLater={() => setShowDaily(false)} />}
        {missionsOpen && <MissionsSheet claimed={claimed.day === dayKey() ? claimed.ids : []} onClose={() => setMissionsOpen(false)} />}
        {leagueOpen && <LeagueScreen topInset={insets.top} onClose={() => setLeagueOpen(false)} />}
        {installOpen && <InstallSheet kind={installOpen} onDone={installDone} />}
        {breakOpen && <BreakReminder onDone={() => { setBreakOpen(false); setBreakKey((k) => k + 1); }} />}
        {toast && <Toast key={toast.id} id={toast.id} text={toast.text} top={insets.top + 64} onDone={clearToast} />}
      </View>

      <View style={[styles.tabs, { paddingBottom: Math.max(insets.bottom, 8) }]}>
        {([['feed', 'for you', 'play-circle'], ['pools', 'pools', 'trophy'], ['create', 'post', 'add-circle'], ['friends', 'friends', 'people'], ['me', 'me', 'person-circle']] as const).map(([key, label, icon]) => {
          const on = tab === key;
          const dot = key === 'friends' ? incomingList().length : 0;
          return (
            <Pressable key={key} onPress={() => { setTab(key); if (key !== 'pools') setPoolIntent(undefined); }} style={styles.tab} accessibilityRole="tab" accessibilityState={{ selected: on }}>
              {dot > 0 && <View style={styles.dot}><T size={10} weight="bold" color={colors.white}>{dot}</T></View>}
              <Ionicons name={(on ? icon : `${icon}-outline`) as keyof typeof Ionicons.glyphMap} size={24} color={on ? colors.brand : colors.muted} />
              <T weight="bold" size={12} color={on ? colors.brand : colors.muted}>{label}</T>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function FeedEnd({ height, onPools, onCreate, onInvite }: { height: number; onPools: () => void; onCreate: () => void; onInvite: () => void }) {
  return (
    <View style={[styles.end, { height }]}>
      <T size={44}>🛵</T>
      <H size={34} color={colors.white} style={{ textAlign: 'center' }}>you called them all</H>
      <T weight="semi" color={colors.white} style={{ textAlign: 'center' }}>new clips land as players post them. until then, pull your friends in. you both get 500 coins.</T>
      <Pressable onPress={onInvite} style={[styles.endBtn, { backgroundColor: colors.yellow }]} accessibilityRole="button"><T weight="bold" color={colors.deep}>invite friends · +500 each</T></Pressable>
      <Pressable onPress={onPools} style={styles.endBtn} accessibilityRole="button"><T weight="bold" color={colors.brand}>start a friend pool</T></Pressable>
      <Pressable onPress={onCreate} style={styles.endBtn} accessibilityRole="button"><T weight="bold" color={colors.brand}>post your own clip · earn coins</T></Pressable>
    </View>
  );
}

/** ?i=BND-XXXX&from=handle from a friend's invite link (web). */
function readInvite(): { code: string; from: string } | null {
  if (Platform.OS !== 'web') return null;
  try {
    const q = new URLSearchParams((globalThis as { location?: Location }).location?.search ?? '');
    const code = (q.get('i') ?? '').toUpperCase(), from = (q.get('from') ?? '').replace(/[^a-z0-9._]/gi, '').toLowerCase();
    return /^BND-[A-Z0-9]{4}$/.test(code) && from.length >= 3 ? { code, from } : null;
  } catch { return null; }
}
function clearInviteFromUrl() {
  if (Platform.OS !== 'web') return;
  const w = globalThis as { history?: History; location?: Location };
  try { w.history?.replaceState(null, '', w.location?.pathname ?? '/'); } catch { /* ignore */ }
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.cloud },
  header: { position: 'absolute', top: 0, left: 0, right: 0 },
  tabs: { flexDirection: 'row', backgroundColor: colors.white, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 8 },
  tab: { flex: 1, alignItems: 'center', gap: 2 },
  dot: { position: 'absolute', top: -4, left: '56%', zIndex: 1, minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 4, backgroundColor: colors.orange, alignItems: 'center', justifyContent: 'center' },
  end: { backgroundColor: colors.sky, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 12 },
  endBtn: { backgroundColor: colors.white, borderRadius: radius.pill, paddingHorizontal: 22, paddingVertical: 12, marginTop: 6 },
});
