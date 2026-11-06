import { useEffect, useRef, useState } from 'react';
import { GestureResponderEvent, LayoutChangeEvent, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useVideoPlayer, VideoView } from 'expo-video';
import * as ImagePicker from 'expo-image-picker';
import { COMMISSION_RATE, ClipDraft, CreatorClip, DAILY_COMMISSION_CAP, draftProblems, MAX_SECONDS, MIN_TEASER_SECONDS } from '../creator';
import { refreshCreator, submitClip, useCreatorClips } from '../creatorState';
import { toast } from '../bus';
import { colors, fonts, radius, shadow } from '../theme';
import { Side } from '../types';
import { Chip, Coin, Eyebrow, H, PillButton, T } from './ui';
import { RenderBar } from './TopBar';

const pct = Math.round(COMMISSION_RATE * 100);

/** Upload your own clips and earn coins every time someone calls one. */
export function CreatorScreen({ renderBar, onBalance }: { renderBar: RenderBar; onBalance: (n: number) => void }) {
  const clips = useCreatorClips();
  const [uploading, setUploading] = useState(false);
  useEffect(() => { refreshCreator().then(onBalance).catch(() => {}); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (uploading) return <Upload renderBar={renderBar} onDone={() => setUploading(false)} />;

  const earned = clips.reduce((n, c) => n + c.earned, 0);
  const plays = clips.reduce((n, c) => n + c.plays, 0);
  const live = clips.filter((c) => c.status === 'live').length;

  return (
    <ScrollView style={styles.page} contentContainerStyle={{ paddingBottom: 32 }}>
      <View style={{ backgroundColor: colors.sky }}>{renderBar('media')}</View>
      <View style={styles.band}>
        <Eyebrow label="creator studio" tone="white" />
        <H size={34} color={colors.white}>post a clip, earn on every call</H>
        <T weight="semi" color={colors.white}>you get {pct}% of every stake people put on your clip, win or lose. paid in coins.</T>
        <View style={styles.stats}>
          <Stat label="earned" value={earned.toLocaleString('en')} coin />
          <Stat label="calls on your clips" value={plays.toLocaleString('en')} />
          <Stat label="live" value={`${live}`} />
        </View>
        <PillButton label="upload a clip" variant="white" icon={<Ionicons name="cloud-upload" size={20} color={colors.brand} />} onPress={() => setUploading(true)} />
      </View>

      <View style={styles.body}>
        <View style={styles.card}>
          <Eyebrow label="your clips" />
          {clips.length === 0 && <T color={colors.muted}>nothing yet. film something with a moment people can call, like a trick shot, a race, or a “will it hold”.</T>}
          {clips.map((c) => <ClipRow key={c.id} clip={c} />)}
        </View>

        <View style={styles.card}>
          <Eyebrow label="how it works" />
          <Rule icon="film-outline" text={`upload a clip up to ${MAX_SECONDS} seconds and pick the moment it pauses`} />
          <Rule icon="lock-closed-outline" text="tell us what really happens. it’s locked and hashed the second you send it, so nobody can change it later" />
          <Rule icon="eye-outline" text="a reviewer watches the whole clip. if the outcome you declared is wrong, it doesn’t go live" />
          <Rule icon="hand-left-outline" text="you can’t call your own clips, and they never show in your feed" />
          <Rule icon="cash-outline" text={`${pct}% of every stake, at least 1 coin per call, up to ${DAILY_COMMISSION_CAP.toLocaleString('en')} coins a day. coins have no cash value`} />
        </View>
      </View>
    </ScrollView>
  );
}

function Stat({ label, value, coin }: { label: string; value: string; coin?: boolean }) {
  return (
    <View style={styles.stat}>
      <View style={styles.inline}>{coin && <Coin size={18} />}<H size={26} color={colors.deep}>{value}</H></View>
      <T size={12} weight="semi" color={colors.muted}>{label}</T>
    </View>
  );
}

function Rule({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  return <View style={styles.rule}><Ionicons name={icon} size={18} color={colors.brand} /><T weight="semi" color={colors.deep} style={{ flex: 1 }}>{text}</T></View>;
}

function ClipRow({ clip }: { clip: CreatorClip }) {
  const pill = clip.status === 'live' ? { bg: colors.win, label: 'live' } : clip.status === 'rejected' ? { bg: colors.orange, label: 'not approved' } : { bg: colors.sun, label: 'in review' };
  return (
    <View style={styles.clip}>
      <View style={styles.thumb}><T size={24}>{clip.status === 'live' ? '🎬' : clip.status === 'rejected' ? '🚫' : '⏳'}</T></View>
      <View style={{ flex: 1, gap: 2 }}>
        <View style={styles.inline}>
          <T weight="bold" color={colors.deep} numberOfLines={1} style={{ flexShrink: 1 }}>{clip.title}</T>
          <View style={[styles.pill, { backgroundColor: pill.bg }]}><T size={11} weight="bold" color={clip.status === 'review' ? colors.deep : colors.white}>{pill.label}</T></View>
        </View>
        <T size={13} color={colors.muted} numberOfLines={1}>{clip.question} · you said “{clip.outcome === 'a' ? clip.labelA : clip.labelB}”</T>
        {clip.status === 'rejected' && clip.reason && <T size={13} weight="semi" color={colors.orange}>{clip.reason}</T>}
        {clip.status === 'review' && <T size={13} color={colors.muted}>a reviewer is checking your outcome</T>}
      </View>
      {clip.status === 'live' && (
        <View style={{ alignItems: 'flex-end' }}>
          <View style={styles.inline}><Coin size={14} /><H size={20} color={colors.win}>+{clip.earned}</H></View>
          <T size={12} color={colors.muted}>{clip.plays} calls</T>
        </View>
      )}
    </View>
  );
}

const empty: ClipDraft = { title: '', question: '', labelA: '', labelB: '', outcome: null, pauseAt: 0, duration: 0, rights: false };

function Upload({ renderBar, onDone }: { renderBar: RenderBar; onDone: () => void }) {
  const [video, setVideo] = useState<{ uri: string; mimeType?: string } | null>(null);
  const [d, setD] = useState<ClipDraft>(empty);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const set = (p: Partial<ClipDraft>) => { setD((x) => ({ ...x, ...p })); setError(null); };
  const problems = draftProblems(d);

  async function pick() {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['videos'], videoMaxDuration: MAX_SECONDS, allowsMultipleSelection: false });
    if (r.canceled || !r.assets?.[0]) return;
    const a = r.assets[0];
    setVideo({ uri: a.uri, mimeType: a.mimeType ?? undefined });
    set({ duration: 0, pauseAt: 0 });
  }

  async function send() {
    setTried(true);
    if (problems.length || !video) { setError(problems[0] ?? 'pick a video first'); return; }
    setBusy(true);
    try {
      await submitClip(d, video);
      toast('sent for review. we’ll tell you when it’s live');
      onDone();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <ScrollView style={styles.page} contentContainerStyle={[styles.body, { paddingTop: 0 }]} keyboardShouldPersistTaps="handled">
      <View style={{ marginHorizontal: -18 }}>{renderBar('light')}</View>
      <Pressable onPress={onDone} style={styles.back} accessibilityRole="button"><Ionicons name="chevron-back" size={20} color={colors.brand} /><T weight="bold" color={colors.brand}>creator studio</T></Pressable>
      <H size={34}>upload a clip</H>

      <Step n={1} title="pick your video">
        {video ? (
          <PausePicker key={video.uri} uri={video.uri} pauseAt={d.pauseAt} duration={d.duration}
            onLoad={(duration) => set({ duration, pauseAt: Math.max(MIN_TEASER_SECONDS, Math.round(duration * 0.7 * 10) / 10) })}
            onPause={(pauseAt) => set({ pauseAt })} />
        ) : (
          <Pressable onPress={pick} style={styles.drop} accessibilityRole="button" accessibilityLabel="pick a video">
            <Ionicons name="videocam" size={34} color={colors.brand} />
            <T weight="bold" color={colors.deep}>choose a video</T>
            <T size={13} color={colors.muted}>vertical, up to {MAX_SECONDS} seconds</T>
          </Pressable>
        )}
        {video && <Pressable onPress={pick}><T weight="bold" color={colors.brand}>pick another video</T></Pressable>}
      </Step>

      <Step n={2} title="ask the question">
        <TextInput style={styles.input} placeholder="title, e.g. bottle flip off the bridge" placeholderTextColor={colors.muted} value={d.title} onChangeText={(title) => set({ title })} maxLength={60} />
        <TextInput style={styles.input} placeholder="what happens next? e.g. does it land?" placeholderTextColor={colors.muted} value={d.question} onChangeText={(question) => set({ question })} maxLength={60} />
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TextInput style={[styles.input, { flex: 1, minWidth: 0 }]} placeholder="answer A" placeholderTextColor={colors.muted} value={d.labelA} onChangeText={(labelA) => set({ labelA })} maxLength={30} />
          <TextInput style={[styles.input, { flex: 1, minWidth: 0 }]} placeholder="answer B" placeholderTextColor={colors.muted} value={d.labelB} onChangeText={(labelB) => set({ labelB })} maxLength={30} />
        </View>
      </Step>

      <Step n={3} title="what really happens?">
        <T size={13} color={colors.muted}>only you and the reviewer see this. it’s locked the moment you send it.</T>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {(['a', 'b'] as Side[]).map((s) => {
            const label = (s === 'a' ? d.labelA : d.labelB).trim() || `answer ${s.toUpperCase()}`;
            return <Chip key={s} label={label} active={d.outcome === s} onPress={() => set({ outcome: s })} />;
          })}
        </View>
      </Step>

      <Step n={4} title="the fine print">
        <Pressable onPress={() => set({ rights: !d.rights })} style={styles.check} accessibilityRole="checkbox" accessibilityState={{ checked: d.rights }}>
          <View style={[styles.box, d.rights && styles.boxOn]}>{d.rights && <Ionicons name="checkmark" size={16} color={colors.white} />}</View>
          <T weight="semi" color={colors.deep} style={{ flex: 1 }}>I filmed this or have the rights to it, everyone in it agreed to be posted, and nobody gets hurt.</T>
        </Pressable>
        <T size={13} color={colors.muted}>you can’t call your own clip. a wrong outcome gets it removed, and doing it again closes your creator studio. you earn {pct}% of every stake on it in coins, which have no cash value.</T>
      </Step>

      {error && <T weight="semi" color={colors.orange}>{error}</T>}
      {!error && tried && problems.length > 0 && <T weight="semi" color={colors.orange}>{problems[0]}</T>}
      <PillButton label="send for review" busy={busy} disabled={!video} onPress={send} icon={<Ionicons name="paper-plane" size={18} color={colors.white} />} />
    </ScrollView>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <View style={styles.card}>
      <View style={styles.inline}><View style={styles.n}><T size={13} weight="bold" color={colors.white}>{n}</T></View><T weight="bold" size={17} color={colors.deep}>{title}</T></View>
      {children}
    </View>
  );
}

/** Preview the video and drag to choose where it pauses for the call. */
function PausePicker({ uri, pauseAt, duration, onLoad, onPause }: { uri: string; pauseAt: number; duration: number; onLoad: (d: number) => void; onPause: (t: number) => void }) {
  const player = useVideoPlayer(uri, (p) => { p.loop = false; p.muted = true; p.timeUpdateEventInterval = 0.05; });
  const [width, setWidth] = useState(0);
  const [preview, setPreview] = useState(false);
  const pauseRef = useRef(pauseAt);
  pauseRef.current = pauseAt;
  const loaded = useRef(false);

  useEffect(() => {
    const load = (dur: number) => { if (!loaded.current && dur > 0) { loaded.current = true; onLoad(Math.round(dur * 10) / 10); } };
    const a = player.addListener('sourceLoad', ({ duration: dur }) => load(dur));
    const b = player.addListener('statusChange', ({ status }) => { if (status === 'readyToPlay') load(player.duration); });
    const c = player.addListener('timeUpdate', ({ currentTime }) => {
      if (currentTime >= pauseRef.current && player.playing) { player.pause(); setPreview(false); }
    });
    return () => { a.remove(); b.remove(); c.remove(); };
  }, [player]); // eslint-disable-line react-hooks/exhaustive-deps

  const seek = (e: GestureResponderEvent) => {
    if (!width || !duration) return;
    const t = Math.round(Math.min(Math.max(e.nativeEvent.locationX / width, 0), 1) * duration * 10) / 10;
    onPause(t);
    player.pause(); setPreview(false);
    player.currentTime = t;
  };
  const playTeaser = () => { player.currentTime = 0; setPreview(true); player.play(); };
  const f = duration ? pauseAt / duration : 0;

  return (
    <View style={{ gap: 10 }}>
      <View style={styles.preview}>
        <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} />
        <Pressable onPress={playTeaser} style={styles.play} accessibilityRole="button" accessibilityLabel="play until the pause">
          {!preview && <View style={styles.playBtn}><Ionicons name="play" size={22} color={colors.deep} /><T size={13} weight="bold" color={colors.deep}>play to the pause</T></View>}
        </Pressable>
      </View>
      <T weight="bold" color={colors.deep}>pauses at {pauseAt.toFixed(1)}s of {duration ? duration.toFixed(1) : '…'}s</T>
      <View style={styles.track} onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
        onStartShouldSetResponder={() => true} onMoveShouldSetResponder={() => true} onResponderGrant={seek} onResponderMove={seek}
        accessibilityRole="adjustable" accessibilityLabel="pause point" accessibilityValue={{ min: 0, max: Math.round(duration), now: Math.round(pauseAt) }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => onPause(Math.min(Math.max(pauseAt + (e.nativeEvent.actionName === 'increment' ? 0.5 : -0.5), 0), duration))}>
        <View pointerEvents="none" style={[styles.teaser, { width: `${f * 100}%` }]} />
        <View pointerEvents="none" style={[styles.knob, { left: `${f * 100}%` }]} />
      </View>
      <View style={styles.between} pointerEvents="none">
        <T size={12} weight="semi" color={colors.brand}>everyone sees this part</T>
        <T size={12} weight="semi" color={colors.muted}>hidden until they call it</T>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.cloud },
  band: { backgroundColor: colors.sky, paddingHorizontal: 18, paddingTop: 8, paddingBottom: 22, gap: 12, borderBottomLeftRadius: 32, borderBottomRightRadius: 32 },
  body: { padding: 18, gap: 16 },
  stats: { flexDirection: 'row', gap: 8 },
  stat: { flex: 1, backgroundColor: colors.white, borderRadius: 18, padding: 12, gap: 2 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  card: { backgroundColor: colors.white, borderRadius: radius.card, padding: 16, gap: 12, ...shadow.soft },
  rule: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  clip: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 },
  thumb: { width: 48, height: 48, borderRadius: 14, backgroundColor: colors.tint, alignItems: 'center', justifyContent: 'center' },
  pill: { borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 1 },
  back: { flexDirection: 'row', alignItems: 'center', gap: 2, alignSelf: 'flex-start' },
  n: { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  drop: { borderWidth: 2, borderStyle: 'dashed', borderColor: colors.line, borderRadius: radius.card, paddingVertical: 34, alignItems: 'center', gap: 6, backgroundColor: colors.cloud },
  input: { backgroundColor: colors.white, borderWidth: 1.5, borderColor: colors.line, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 13, color: colors.ink, fontSize: 16, fontFamily: fonts.bodySemi },
  preview: { alignSelf: 'center', width: 200, aspectRatio: 9 / 16, borderRadius: 18, overflow: 'hidden', backgroundColor: colors.deep },
  play: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 14 },
  playBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.white, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 6 },
  track: { height: 34, borderRadius: 17, backgroundColor: colors.tint, justifyContent: 'center', overflow: 'visible' },
  teaser: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 17, backgroundColor: colors.brandSoft },
  knob: { position: 'absolute', width: 8, height: 44, marginLeft: -4, borderRadius: 4, backgroundColor: colors.yellow, borderWidth: 2, borderColor: colors.deep },
  check: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  box: { width: 24, height: 24, borderRadius: 7, borderWidth: 2, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  boxOn: { backgroundColor: colors.brand, borderColor: colors.brand },
});
