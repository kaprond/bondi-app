import { useCallback, useEffect, useRef, useState } from 'react';
import { Invite, parseInvite, parseOpen } from './src/deeplink';
import { FlatList, LayoutChangeEvent, Linking, Platform, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
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
import { poolCount, PoolsScreen, refreshPools } from './src/components/PoolsScreen';
import { wirePush } from './src/push';
import { CreatorScreen } from './src/components/CreatorScreen';
import { refreshCreator } from './src/creatorState';
import { ProfileScreen } from './src/components/ProfileScreen';
import { FriendsScreen } from './src/components/FriendsScreen';
import { SetupProfile } from './src/components/SetupProfile';
import { LIVE, rpc } from './src/backend';
import { befriendInviter, refreshSocial, friendList, incomingList, inviteCode, inviteLink, syncMyStats, useSocial } from './src/social';
import { H, T } from './src/components/ui';
import { BlobBanner } from './src/components/Blob';
import { BarTone, TopBar } from './src/components/TopBar';
import { Welcome } from './src/components/Welcome';
import { WarmUp } from './src/components/WarmUp';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { setScreen } from './src/errors';
import { track } from './src/track';
import { recordShare, setSound, useStats } from './src/session';
import { Toast } from './src/components/Toast';
import { colors, radius } from './src/theme';
import { FeedClip, Side, Stake } from './src/types';

type Tab = 'feed' | 'pools' | 'create' | 'friends' | 'me';
/** Launch: friend pools first. Flip to true to bring back the clip feed, posting and missions. */
export const CLIPS_LIVE = false;
const TABS: readonly (readonly [Tab, string, string])[] = CLIPS_LIVE
  ? [['feed', 'for you', 'play-circle'], ['pools', 'pools', 'trophy'], ['create', 'post', 'add-circle'], ['friends', 'friends', 'people'], ['me', 'me', 'person-circle']]
  : [['pools', 'pools', 'trophy'], ['friends', 'friends', 'people'], ['feed', 'clips', 'play-circle'], ['me', 'me', 'person-circle']];
const AGE_KEY = 'bondi.ageConfirmed';
const INSTALL_KEY = 'bondi.installAsked';

export default function App() {
  return <ErrorBoundary><AppInner /></ErrorBoundary>;
}

function AppInner() {
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
  const [invite, setInvite] = useState(readInvite);
  // App: links (universal links / letsjam://) open straight in here, cold start or while running
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const handle = (u: string | null | undefined) => {
      const i = parseInvite(u); if (i) { setInvite(i); return; }
      const o = parseOpen(u); if (o) { setTab('pools'); if (o.poolId) setOpenPool({ id: o.poolId, n: Date.now() }); }
    };
    Linking.getInitialURL().then(handle).catch(() => {});
    const sub = Linking.addEventListener('url', ({ url }) => handle(url));
    return () => sub.remove();
  }, []);
  const [dare, setDare] = useState<Dare | null>(() => (CLIPS_LIVE ? readDare() : null));
  const [activeIndex, setActiveIndex] = useState(0);
  const [height, setHeight] = useState(0);
  const [tab, setTab] = useState<Tab>(CLIPS_LIVE ? 'feed' : 'pools');
  useEffect(() => { setScreen(tab); }, [tab]);
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);
  const clearToast = useCallback(() => setToast(null), []);
  const listRef = useRef<FlatList<FeedClip>>(null);
  const stats = useStats();
  const { streak } = stats;
  const [setup, setSetup] = useState(false);
  const [warmup, setWarmup] = useState(false);
  const [poolIntent, setPoolIntent] = useState<{ friendId: string; n: number } | undefined>();
  const [openPool, setOpenPool] = useState<{ id: string; n: number } | undefined>();
  const [openCrew, setOpenCrew] = useState<{ id: string; n: number } | undefined>();
  const { width: winW } = useWindowDimensions();
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
    if (e.kind === 'go') { setTab(e.to); if (e.poolId) setOpenPool({ id: e.poolId, n: Date.now() }); if (e.crewId) setOpenCrew({ id: e.crewId, n: Date.now() }); }
    if (e.kind === 'reload') {
      // switched accounts: start over with the new account's data
      if (Platform.OS === 'web') { try { (globalThis as { location?: Location }).location?.reload(); return; } catch { /* fall through */ } }
      refreshSocial(); refreshPools(); api.getBalance().then(setBalance).catch(() => {}); setTab('pools');
    }
  }), []);

  // push notifications (app only): show them in-app and open the right screen when tapped
  useEffect(() => (ageOk ? wirePush() : undefined), [ageOk]);

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

  useEffect(() => { if (ageOk) track('app_open'); }, [ageOk]);

  // Opened from a crew invite link: join the crew, become friends with whoever shared it.
  const joinedCrew = useRef<string | null>(null);
  useEffect(() => {
    if (!invite?.crew || joinedCrew.current === invite.crew || ageOk !== true || setup || !LIVE) return;
    joinedCrew.current = invite.crew;
    track('crew_link_opened');
    rpc('join_crew_link', { p_group: invite.crew, p_code: invite.code })
      .then(async () => { await refreshSocial(); refreshPools(); setTab('pools'); setToast({ id: Date.now(), text: `you’re in @${invite.from}’s crew. start a pool or jump into one 🔥` }); })
      .catch((e: Error) => setToast({ id: Date.now(), text: e.message }));
  }, [invite, ageOk, setup]); // eslint-disable-line react-hooks/exhaustive-deps

  // Opened from a shared pool link: join that pool's crew and open the pool.
  const joinedPool = useRef<string | null>(null);
  useEffect(() => {
    if (!invite?.pool || joinedPool.current === invite.pool || ageOk !== true || setup || !LIVE) return;
    joinedPool.current = invite.pool;
    track('pool_link_opened');
    rpc('join_pool_link', { p_pool: invite.pool, p_code: invite.code })
      .then(async () => { await refreshSocial(); refreshPools(); setTab('pools'); setOpenPool({ id: invite.pool!, n: Date.now() }); setToast({ id: Date.now(), text: `you’re in @${invite.from}’s crew now. make your call` }); })
      .catch((e: Error) => setToast({ id: Date.now(), text: e.message }));
  }, [invite, ageOk, setup]); // eslint-disable-line react-hooks/exhaustive-deps

  // Opened from a friend's invite link while already playing: just connect you two.
  useEffect(() => {
    if (!invite || ageOk !== true || setup) return;
    clearInviteFromUrl();
    if (invite.code === inviteCode() || invite.crew || invite.pool) return; // crew/pool links connect you themselves
    const p = befriendInviter(invite.from, { request: true });
    setToast({ id: Date.now(), text: LIVE ? `friend request sent to @${p.handle}` : `you and @${p.handle} are friends now` });
  }, [invite, ageOk]); // eslint-disable-line react-hooks/exhaustive-deps

  // The dared clip is gone from your feed when you already called it.
  useEffect(() => {
    if (!dare || dare.clipId || ageOk !== true || setup) return;
    setToast({ id: Date.now(), text: `you already called the clip ${dareName(dare)} sent. here’s what’s new` });
    setDare(null);
  }, [dare, ageOk, setup]);

  // After your third call, once: offer to put LetsJam on the home screen (web on a phone only).
  useEffect(() => {
    if (installAsked.current !== false || installOpen) return;
    if (stats.bets < 3 && poolCount() < 1) return;
    const kind = installKind();
    if (kind === 'none') return;
    installAsked.current = true;
    setInstallOpen(kind);
  }, [activeIndex, tab]); // eslint-disable-line react-hooks/exhaustive-deps
  const installDone = (installed: boolean) => {
    setInstallOpen(null);
    AsyncStorage.setItem(INSTALL_KEY, '1').catch(() => {});
    if (installed) setToast({ id: Date.now(), text: 'LetsJam is on your home screen 🎉' });
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
    // first minute: play a practice pool before anything else (invited people go straight to their real pool/crew)
    if (!invite?.pool && !invite?.crew) setWarmup(true);
    track('welcome_done', { invited: !!invite, via: invite?.crew ? 'crew' : invite?.pool ? 'pool' : invite ? 'friend' : 'none' });
    if (!invite) return;
    clearInviteFromUrl();
    if (invite.code === inviteCode()) return;
    const p = befriendInviter(invite.from);
    try {
      setBalance(await api.redeemInvite(invite.code));
      setToast({ id: Date.now(), text: `+10 from @${p.handle}’s invite. you’re friends now` });
    } catch { /* code already used: still friends */ }
  };

  // After deleting: the web reloads into a fresh welcome screen; the native app asks to be reopened
  // (all in-memory caches belong to the old account).
  const [deleted, setDeleted] = useState(false);
  const accountDeleted = () => {
    if (Platform.OS === 'web') { try { (globalThis as { location?: Location }).location?.replace('/'); return; } catch { /* fall through */ } }
    setDeleted(true);
  };

  const onViewable = useRef(({ viewableItems }: { viewableItems: Array<{ index?: number | null }> }) => {
    if (viewableItems[0]?.index != null) setActiveIndex(viewableItems[0].index);
  }).current;

  if (deleted) return (
    <View style={[styles.end, { flex: 1 }]}>
      <T size={44}>👋</T>
      <H size={34} color={colors.white} style={{ textAlign: 'center' }}>your account is gone</H>
      <T weight="semi" color={colors.white} style={{ textAlign: 'center' }}>everything’s deleted. close LetsJam and open it again if you ever want to start fresh.</T>
    </View>
  );
  if (ageOk === null) return <View style={{ flex: 1, backgroundColor: colors.brand }} />;
  if (!ageOk) return <Welcome topInset={insets.top} bottomInset={insets.bottom} invitedBy={invite?.from} onAccept={welcomeDone} />;

  if (setup && warmup) return <WarmUp topInset={insets.top} bottomInset={insets.bottom} onDone={() => setWarmup(false)} />;

  if (setup) return (
    <View style={{ flex: 1 }}>
      <SetupProfile topInset={insets.top} onDone={() => { track('profile_done'); setSetup(false); }} />
      {toast && <Toast id={toast.id} text={toast.text} top={insets.top + 12} onDone={clearToast} />}
    </View>
  );

  const renderBar = (tone: BarTone) => <TopBar tone={tone} topInset={insets.top} balance={balance} streak={streak} onCoins={() => setTab('me')}
    missions={CLIPS_LIVE ? { done: missionsDone, total: MISSIONS.length } : undefined} onMissions={() => setMissionsOpen(true)} />;
  const next = (i: number) => { if (i + 1 < feed.length) listRef.current?.scrollToIndex({ index: i + 1 }); else setActiveIndex(feed.length); };

  const wide = Platform.OS !== 'web' && winW > 700;
  return (
    <View style={[styles.root, wide && styles.wideRoot]}>
    <View style={[{ flex: 1 }, wide && styles.wideCol]}>
      <View style={{ flex: 1 }}>
        {tab === 'pools' && <PoolsScreen renderBar={renderBar} intent={poolIntent} openPool={openPool} openCrew={openCrew} onBalance={async () => setBalance(await api.getBalance())} />}
        {tab === 'create' && <CreatorScreen renderBar={renderBar} onBalance={setBalance} />}
        {tab === 'friends' && <FriendsScreen renderBar={renderBar} onPoolWith={(friendId) => { setPoolIntent({ friendId, n: Date.now() }); setTab('pools'); }} />}
        {tab === 'me' && <ProfileScreen renderBar={renderBar} balance={balance} daily={daily} onClaim={claim} onFriends={() => setTab('friends')} onDeleted={accountDeleted} />}
        {!CLIPS_LIVE && tab === 'feed' && <ClipsSoon topInset={insets.top} onPools={() => setTab('pools')} onInvite={async () => {
          const r = await shareText(`come play LetsJam with me. friend pools with free coins, no cash. we both get 10 coins.`, inviteLink());
          if (r !== 'dismissed') recordShare();
          if (r === 'copied') setToast({ id: Date.now(), text: 'invite link copied' });
        }} />}
        <View style={[{ flex: 1 }, (tab !== 'feed' || !CLIPS_LIVE) && { display: 'none' }]} onLayout={(e: LayoutChangeEvent) => setHeight(e.nativeEvent.layout.height)}>
          {CLIPS_LIVE && height > 0 && (
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
                const r = await shareText(`come play LetsJam with me. guess what happens next, free coins, no cash. we both get 10 coins.`, inviteLink());
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
        {TABS.map(([key, label, icon]) => {
          const on = tab === key;
          const dot = key === 'friends' ? incomingList().length : 0;
          const soon = !CLIPS_LIVE && key === 'feed';
          return (
            <Pressable key={key} onPress={() => { setTab(key); if (key !== 'pools') setPoolIntent(undefined); }} style={styles.tab} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={soon ? 'clips, coming soon' : undefined}>
              {dot > 0 && <View style={styles.dot}><T size={10} weight="bold" color={colors.white}>{dot}</T></View>}
              {soon && <View style={styles.soon}><T size={9} weight="bold" color={colors.deepFixed}>soon</T></View>}
              <Ionicons name={(on ? icon : `${icon}-outline`) as keyof typeof Ionicons.glyphMap} size={24} color={on ? colors.brand : colors.muted} />
              <T weight="bold" size={12} color={on ? colors.brand : colors.muted}>{label}</T>
            </Pressable>
          );
        })}
      </View>
    </View>
    </View>
  );
}

function FeedEnd({ height, onPools, onCreate, onInvite }: { height: number; onPools: () => void; onCreate: () => void; onInvite: () => void }) {
  return (
    <View style={[styles.end, { height }]}>
      <T size={44}>🛵</T>
      <H size={34} color={colors.white} style={{ textAlign: 'center' }}>you called them all</H>
      <T weight="semi" color={colors.white} style={{ textAlign: 'center' }}>new clips land as players post them. until then, pull your friends in. you both get 10 coins.</T>
      <Pressable onPress={onInvite} style={[styles.endBtn, { backgroundColor: colors.yellow }]} accessibilityRole="button"><T weight="bold" color={colors.deepFixed}>invite friends · +10 each</T></Pressable>
      <Pressable onPress={onPools} style={styles.endBtn} accessibilityRole="button"><T weight="bold" color={colors.brand}>start a friend pool</T></Pressable>
      <Pressable onPress={onCreate} style={styles.endBtn} accessibilityRole="button"><T weight="bold" color={colors.brand}>post your own clip · earn coins</T></Pressable>
    </View>
  );
}

function ClipsSoon({ topInset, onPools, onInvite }: { topInset: number; onPools: () => void; onInvite: () => void }) {
  return (
    <View style={[styles.end, { flex: 1, paddingTop: topInset + 72, backgroundColor: colors.royal }]}>
      <BlobBanner />
      <View style={styles.soonPill}><T size={13} weight="bold" color={colors.deepFixed}>coming soon</T></View>
      <H size={34} color={colors.white} style={{ textAlign: 'center' }}>guess what happens next</H>
      <T weight="semi" color={colors.white} style={{ textAlign: 'center' }}>short clips that pause right before the moment. call it with free coins. dropping soon.</T>
      <T weight="semi" color={colors.white} style={{ textAlign: 'center' }}>for now: start a pool with your friends.</T>
      <Pressable onPress={onPools} style={[styles.endBtn, { backgroundColor: colors.yellow }]} accessibilityRole="button"><T weight="bold" color={colors.deepFixed}>start a friend pool</T></Pressable>
      <Pressable onPress={onInvite} style={styles.endBtn} accessibilityRole="button"><T weight="bold" color={colors.brand}>invite friends · +10 each</T></Pressable>
    </View>
  );
}

/** ?i=JAM-XXXX&from=handle from a friend's invite link (web; the app reads links in Shell). */
function readInvite(): Invite | null {
  if (Platform.OS !== 'web') return null;
  try { return parseInvite((globalThis as { location?: Location }).location?.href); } catch { return null; }
}
function clearInviteFromUrl() {
  if (Platform.OS !== 'web') return;
  const w = globalThis as { history?: History; location?: Location };
  try { w.history?.replaceState(null, '', w.location?.pathname ?? '/'); } catch { /* ignore */ }
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.cloud },
  wideRoot: { backgroundColor: colors.royal, alignItems: 'center' },
  wideCol: { width: '100%', maxWidth: 680, backgroundColor: colors.cloud },
  header: { position: 'absolute', top: 0, left: 0, right: 0 },
  tabs: { flexDirection: 'row', backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 8 },
  tab: { flex: 1, alignItems: 'center', gap: 2 },
  dot: { position: 'absolute', top: -4, left: '56%', zIndex: 1, minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 4, backgroundColor: colors.orange, alignItems: 'center', justifyContent: 'center' },
  soon: { position: 'absolute', top: -6, left: '54%', zIndex: 1, backgroundColor: colors.yellow, borderRadius: 8, paddingHorizontal: 5, paddingVertical: 1 },
  soonPill: { backgroundColor: colors.yellow, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 5 },
  end: { backgroundColor: colors.sky, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 12 },
  endBtn: { backgroundColor: colors.card, borderRadius: radius.pill, paddingHorizontal: 22, paddingVertical: 12, marginTop: 6 },
});
