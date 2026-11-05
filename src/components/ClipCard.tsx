import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Platform, Pressable, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useVideoPlayer, VideoView } from 'expo-video';
import { recordResult, setSound, useSound, useStats } from '../session';
import { colors, radius } from '../theme';
import { BetResult, FeedClip, Side, Stake } from '../types';
import { BetSheet } from './BetSheet';
import { ResultOverlay } from './ResultOverlay';
import { T } from './ui';
import { Avatar } from '../avatar';
import { friendCalls, nameOf } from '../social';
import { sfx } from '../sfx';

type Phase = 'teaser' | 'betting' | 'reveal' | 'done';

interface Props {
  clip: FeedClip;
  active: boolean;
  height: number;
  topInset: number;
  balance: number;
  placeBet: (clipId: string, choice: Side, stake: Stake) => Promise<BetResult>;
  onNext: () => void;
}

/**
 * Teaser plays to the pause point, then the bet sheet opens.
 * The reveal source only exists after placeBet returns, so the app cannot leak the outcome.
 */
export function ClipCard({ clip, active, height, topInset, balance, placeBet, onNext }: Props) {
  const [phase, setPhase] = useState<Phase>('teaser');
  const [result, setResult] = useState<BetResult | null>(null);
  const [pick, setPick] = useState<{ side: Side; stake: Stake } | null>(null);
  const { streak } = useStats();
  const progress = useRef(new Animated.Value(0)).current;
  const soundOn = useSound();
  const flash = useRef(new Animated.Value(0)).current;
  const dim = useRef(new Animated.Value(0)).current;
  const player = useVideoPlayer(clip.teaserUrl, (p) => { p.loop = false; p.muted = true; p.timeUpdateEventInterval = 0.1; });

  useEffect(() => { player.muted = !soundOn; }, [player, soundOn]);

  // The pause moment: a quick white flash, then the frame dims behind the bet sheet.
  useEffect(() => {
    const nd = Platform.OS !== 'web';
    if (phase === 'betting') {
      sfx.pause();
      flash.setValue(0.55);
      Animated.parallel([
        Animated.timing(flash, { toValue: 0, duration: 380, easing: Easing.out(Easing.quad), useNativeDriver: nd }),
        Animated.timing(dim, { toValue: 1, duration: 320, useNativeDriver: nd }),
      ]).start();
    } else {
      Animated.timing(dim, { toValue: phase === 'done' ? 0.6 : 0, duration: 260, useNativeDriver: nd }).start();
    }
  }, [phase, flash, dim]);

  useEffect(() => {
    const end = player.addListener('playToEnd', () => {
      setPhase((cur) => (cur === 'teaser' ? 'betting' : cur === 'reveal' ? 'done' : cur));
    });
    const time = player.addListener('timeUpdate', ({ currentTime }) => {
      const d = player.duration || 1;
      Animated.timing(progress, { toValue: Math.min(currentTime / d, 1), duration: 100, easing: Easing.linear, useNativeDriver: false }).start();
    });
    return () => { end.remove(); time.remove(); };
  }, [player, progress]);

  useEffect(() => {
    if (active && (phase === 'teaser' || phase === 'reveal')) player.play();
    else player.pause();
  }, [active, phase, player]);

  async function onPlace(choice: Side, stake: Stake) {
    const r = await placeBet(clip.id, choice, stake);
    setPick({ side: choice, stake });
    setResult(r);
    recordResult(r.won, r.payout - stake, { clipId: clip.id, title: clip.title, pick: choice === 'a' ? clip.labelA : clip.labelB, underdog: (choice === 'a' ? clip.oddsA : clip.oddsB) > (choice === 'a' ? clip.oddsB : clip.oddsA) });
    progress.setValue(0);
    await player.replaceAsync(r.revealUrl);
    setPhase('reveal');
    player.play();
  }

  function replay() {
    player.currentTime = 0;
    progress.setValue(0);
    setPhase('reveal');
  }

  const played = friendCalls(clip.id, clip.crowdA);
  const pickLabel = pick ? (pick.side === 'a' ? clip.labelA : clip.labelB) : '';
  const barColor = phase === 'teaser' ? colors.white : colors.yellow;

  return (
    <View style={{ height, backgroundColor: colors.deep }}>
      <VideoView player={player} style={styles.video} contentFit="cover" nativeControls={false} />
      <LinearGradient colors={['rgba(0,40,50,0.55)', 'transparent']} style={[styles.topFade, { height: topInset + 90 }]} pointerEvents="none" />
      <LinearGradient colors={['transparent', 'rgba(0,40,50,0.75)']} style={styles.bottomFade} pointerEvents="none" />

      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,30,40,0.38)', opacity: dim }]} pointerEvents="none" />
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: colors.white, opacity: flash }]} pointerEvents="none" />

      <Pressable onPress={() => setSound(!soundOn)} style={[styles.sound, { top: topInset + 72 }]} accessibilityRole="button" accessibilityLabel={soundOn ? 'mute' : 'unmute'} hitSlop={10}>
        <Ionicons name={soundOn ? 'volume-high' : 'volume-mute'} size={18} color={colors.white} />
      </Pressable>

      <View style={[styles.progressTrack, { top: topInset + 58 }]}>
        <Animated.View style={[styles.progressFill, { backgroundColor: barColor, width: progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }]} />
      </View>

      {phase === 'reveal' && pick && (
        <View style={[styles.pickBanner, { top: topInset + 72 }]}>
          <Ionicons name="lock-closed" size={13} color={colors.deep} />
          <T weight="bold" size={13} color={colors.deep}>your pick: {pickLabel} · {pick.stake}</T>
        </View>
      )}

      {(phase === 'teaser' || phase === 'reveal') && (
        <View style={styles.caption} pointerEvents="none">
          <T weight="bold" size={15} color={colors.white}>{clip.creator}</T>
          <T weight="semi" size={15} color={colors.white}>{clip.title}</T>
          {phase === 'teaser' && played.length > 0 && (
            <View style={styles.friends}>
              <View style={{ flexDirection: 'row' }}>{played.slice(0, 3).map((f, i) => <View key={f.id} style={{ marginLeft: i ? -7 : 0 }}><Avatar id={f.id} size={22} /></View>)}</View>
              <T weight="bold" size={13} color={colors.white}>{nameOf(played[0].id)}{played.length > 1 ? ` + ${played.length - 1} friend${played.length > 2 ? 's' : ''}` : ''} played this</T>
            </View>
          )}
          {phase === 'teaser' && (
            <View style={styles.hint}><Ionicons name="pause" size={12} color={colors.deep} /><T weight="bold" size={12} color={colors.deep}>pauses soon. get ready to call it</T></View>
          )}
        </View>
      )}

      {phase === 'betting' && <BetSheet clip={clip} balance={balance} onPlace={onPlace} />}
      {phase === 'done' && result && pick && (
        <ResultOverlay clip={clip} result={result} stake={pick.stake} streak={streak} onNext={onNext} onReplay={replay} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  video: { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' },
  topFade: { position: 'absolute', left: 0, right: 0, top: 0 },
  bottomFade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 220 },
  progressTrack: { position: 'absolute', left: 16, right: 16, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.3)', overflow: 'hidden' },
  progressFill: { height: 4, borderRadius: 2 },
  pickBanner: { position: 'absolute', alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.yellow, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 6 },
  sound: { position: 'absolute', right: 16, width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,40,50,0.45)' },
  friends: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  caption: { position: 'absolute', left: 16, right: 16, bottom: 22, gap: 4 },
  hint: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6, backgroundColor: colors.white, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4 },
});

