import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Avatar } from '../avatar';
import { useStats } from '../session';
import { shareText } from '../share';
import { AVATAR_COLORS, AVATAR_EMOJI, crewList, friendList, INVITE_CODE, inviteLink, me, updateProfile, useSocial } from '../social';
import { colors, fonts, radius, shadow } from '../theme';
import { Coin, Eyebrow, H, PillButton, T } from './ui';
import { RenderBar } from './TopBar';

interface Props { renderBar: RenderBar; balance: number; dailyClaimed: boolean; onClaim: () => void; onFriends: () => void }

export function ProfileScreen({ renderBar, balance, dailyClaimed, onClaim, onFriends }: Props) {
  useSocial();
  const s = useStats();
  const p = me();
  const [editing, setEditing] = useState(false);
  const rate = s.bets ? Math.round((s.wins / s.bets) * 100) : 0;
  const nFriends = friendList().length;
  const tiles: [string, string][] = [['calls made', `${s.bets}`], ['hit rate', s.bets ? `${rate}%` : '–'], ['best streak', `${s.bestStreak}`], ['coins won', `${s.coinsWon}`]];
  const badges = [
    { emoji: '🎯', name: 'first call', got: s.bets >= 1, hint: 'make your first call' },
    { emoji: '🔥', name: 'on fire', got: s.bestStreak >= 3, hint: '3 right in a row' },
    { emoji: '🧠', name: 'sharp', got: s.bets >= 5 && rate >= 60, hint: '60% over 5 calls' },
    { emoji: '🦋', name: 'social butterfly', got: nFriends >= 5, hint: 'have 5 friends' },
    { emoji: '👑', name: 'crew boss', got: crewList().length > 3, hint: 'start your own crew' },
    { emoji: '💯', name: 'centurion', got: s.bets >= 100, hint: 'make 100 calls' },
  ];
  const got = badges.filter((b) => b.got).length;

  if (editing) return <EditProfile renderBar={renderBar} onDone={() => setEditing(false)} />;

  return (
    <ScrollView style={styles.page} contentContainerStyle={{ paddingBottom: 32 }}>
      <View style={{ backgroundColor: colors.sky }}>{renderBar('media')}</View>
      <View style={styles.band}>
        <View style={styles.me}>
          <Avatar id="me" size={88} ring={colors.white} />
          <View style={{ flex: 1, gap: 2 }}>
            <H size={32} color={colors.white}>{p.name}</H>
            <T weight="semi" color={colors.white}>@{p.handle} · {p.city}</T>
            <Pressable onPress={() => setEditing(true)} style={styles.edit} accessibilityRole="button">
              <Ionicons name="create-outline" size={15} color={colors.deep} /><T size={13} weight="bold" color={colors.deep}>edit profile</T>
            </Pressable>
          </View>
        </View>
        {!!p.bio && <T weight="semi" color={colors.white}>“{p.bio}”</T>}
        <Pressable onPress={onFriends} style={styles.social} accessibilityRole="button">
          <T weight="bold" color={colors.white}>{nFriends} friends</T><T color={colors.white}>·</T>
          <T weight="bold" color={colors.white}>{crewList().length} crews</T><T color={colors.white}>·</T>
          <T weight="bold" color={colors.yellow}>{got}/{badges.length} badges</T>
        </Pressable>
      </View>

      <View style={styles.body}>
        <View style={styles.balance}>
          <View style={styles.between}>
            <T weight="bold" color={colors.white}>your coins</T>
            <T size={12} weight="semi" color={colors.white}>no cash value</T>
          </View>
          <View style={styles.inline}><Coin size={30} /><H size={48} color={colors.white}>{balance}</H></View>
          <PillButton label={dailyClaimed ? 'come back tomorrow for 500 more' : 'claim today’s 500 free coins'} variant="white" disabled={dailyClaimed} onPress={onClaim} />
        </View>

        <View style={styles.grid}>
          {tiles.map(([k, v]) => (
            <View key={k} style={styles.tile}><H size={30} color={colors.deep}>{v}</H><T weight="semi" size={13} color={colors.muted}>{k}</T></View>
          ))}
        </View>

        <View style={styles.card}>
          <View style={styles.between}><Eyebrow label="badges" /><T size={13} color={colors.muted}>{got} of {badges.length}</T></View>
          <View style={styles.badges}>
            {badges.map((b) => (
              <View key={b.name} style={[styles.badge, !b.got && { opacity: 0.4 }]}>
                <View style={[styles.badgeIcon, b.got && { backgroundColor: colors.yellow }]}><T size={26}>{b.got ? b.emoji : '🔒'}</T></View>
                <T size={12} weight="bold" color={colors.deep} style={{ textAlign: 'center' }}>{b.name}</T>
                {!b.got && <T size={11} color={colors.muted} style={{ textAlign: 'center' }}>{b.hint}</T>}
              </View>
            ))}
          </View>
        </View>

        <View style={styles.card}>
          <Eyebrow label="recent calls" />
          {s.history.length === 0 && <T color={colors.muted}>your calls show up here. go call one on the feed.</T>}
          {s.history.slice(0, 6).map((c) => (
            <View key={c.at} style={styles.call}>
              <View style={[styles.callDot, { backgroundColor: c.won ? colors.win : colors.orange }]}>
                <Ionicons name={c.won ? 'checkmark' : 'close'} size={14} color={colors.white} />
              </View>
              <View style={{ flex: 1 }}>
                <T weight="bold" color={colors.deep} numberOfLines={1}>{c.title}</T>
                <T size={13} color={colors.muted}>you said “{c.pick}”</T>
              </View>
              <H size={20} color={c.won ? colors.win : colors.orange}>{c.net >= 0 ? `+${c.net}` : c.net}</H>
            </View>
          ))}
        </View>

        <Pressable onPress={() => shareText(`come play bondi with me. use my code ${INVITE_CODE} and we both get 500 coins.`, inviteLink)} style={styles.invite} accessibilityRole="button">
          <T size={30}>💌</T>
          <View style={{ flex: 1 }}>
            <T weight="bold" color={colors.white}>invite friends, get 500 coins each</T>
            <T size={13} color={colors.white}>your code {INVITE_CODE}</T>
          </View>
          <Ionicons name="share-outline" size={22} color={colors.white} />
        </Pressable>

        <View style={styles.card}>
          <Eyebrow label="play it cool" />
          <T weight="semi" color={colors.deep}>bondi is free to play. coins can’t be bought or cashed out, and there are no prizes with money value.</T>
          <View style={styles.row}><Ionicons name="time-outline" size={18} color={colors.brand} /><T weight="semi" color={colors.deep}>take a break reminder after 30 minutes</T></View>
          <View style={styles.row}><Ionicons name="shield-checkmark-outline" size={18} color={colors.brand} /><T weight="semi" color={colors.deep}>every outcome is locked and hashed before a clip goes live</T></View>
        </View>
        <T size={12} color={colors.muted} style={{ textAlign: 'center' }}>made with 💙 by bondi</T>
      </View>
    </ScrollView>
  );
}

/** Pick a look: emoji, colour, name, handle, city, bio. Also used in onboarding. */
export function ProfileEditor({ onSave, saveLabel }: { onSave: () => void; saveLabel: string }) {
  useSocial();
  const p = me();
  const [emoji, setEmoji] = useState(p.emoji);
  const [color, setColor] = useState(p.color);
  const [name, setName] = useState(p.name === 'you' ? '' : p.name);
  const [handle, setHandle] = useState(p.handle === 'you' ? '' : p.handle);
  const [city, setCity] = useState(p.city);
  const [bio, setBio] = useState(p.bio);
  const [error, setError] = useState<string | null>(null);
  function save() {
    try { updateProfile({ emoji, color, name: name || 'you', handle: handle || p.handle, city: city.trim().toLowerCase(), bio: bio.trim() }); onSave(); }
    catch (e) { setError((e as Error).message); }
  }
  return (
    <View style={{ gap: 16 }}>
      <View style={{ alignItems: 'center' }}>
        <View style={[styles.preview, { backgroundColor: color }]}><T size={64} style={{ lineHeight: 80 }}>{emoji}</T></View>
      </View>
      <View style={styles.emojiGrid}>
        {AVATAR_EMOJI.map((e) => (
          <Pressable key={e} onPress={() => setEmoji(e)} style={[styles.emojiBtn, emoji === e && styles.emojiOn]} accessibilityRole="button" accessibilityLabel={`avatar ${e}`} accessibilityState={{ selected: emoji === e }}>
            <T size={22}>{e}</T>
          </Pressable>
        ))}
      </View>
      <View style={styles.colorRow}>
        {AVATAR_COLORS.map((c) => (
          <Pressable key={c} onPress={() => setColor(c)} style={[styles.swatch, { backgroundColor: c }, color === c && styles.swatchOn]} accessibilityRole="button" accessibilityLabel={`colour ${c}`} accessibilityState={{ selected: color === c }} />
        ))}
      </View>
      <Field label="name"><TextInput value={name} onChangeText={setName} placeholder="what friends call you" placeholderTextColor={colors.muted} maxLength={20} style={styles.input} /></Field>
      <Field label="handle">
        <View style={[styles.input, styles.handle]}>
          <T weight="bold" color={colors.muted} size={16}>@</T>
          <TextInput value={handle} onChangeText={(t) => { setHandle(t.toLowerCase()); setError(null); }} placeholder="yourname" placeholderTextColor={colors.muted}
            autoCapitalize="none" autoCorrect={false} maxLength={20} style={styles.handleInput} />
        </View>
      </Field>
      <Field label="city"><TextInput value={city} onChangeText={setCity} placeholder="amsterdam" placeholderTextColor={colors.muted} maxLength={24} style={styles.input} /></Field>
      <Field label={`bio (${bio.length}/80)`}><TextInput value={bio} onChangeText={setBio} placeholder="calling it since day one" placeholderTextColor={colors.muted} maxLength={80} style={styles.input} /></Field>
      {error && <T weight="semi" color={colors.orange}>{error}</T>}
      <PillButton label={saveLabel} onPress={save} />
    </View>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <View style={{ gap: 6 }}><T weight="bold" color={colors.deep}>{label}</T>{children}</View>;
}

function EditProfile({ renderBar, onDone }: { renderBar: RenderBar; onDone: () => void }) {
  return (
    <ScrollView style={styles.page} contentContainerStyle={[styles.body, { paddingTop: 0 }]} keyboardShouldPersistTaps="handled">
      <View style={{ marginHorizontal: -18 }}>{renderBar('light')}</View>
      <Pressable onPress={onDone} style={styles.back} accessibilityRole="button"><Ionicons name="chevron-back" size={20} color={colors.brand} /><T weight="bold" color={colors.brand}>profile</T></Pressable>
      <H size={34}>edit profile</H>
      <ProfileEditor onSave={onDone} saveLabel="save" />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.cloud },
  band: { backgroundColor: colors.sky, paddingHorizontal: 18, paddingTop: 8, paddingBottom: 22, gap: 12, borderBottomLeftRadius: 32, borderBottomRightRadius: 32 },
  body: { padding: 18, gap: 16 },
  me: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  edit: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: colors.white, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 5, marginTop: 6 },
  social: { flexDirection: 'row', gap: 6, alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.18)', alignSelf: 'flex-start', borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 6 },
  balance: { backgroundColor: colors.brand, borderRadius: radius.card, padding: 18, gap: 10, ...shadow.soft },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  tile: { flexBasis: '47%', flexGrow: 1, backgroundColor: colors.white, borderRadius: radius.card, padding: 16, gap: 2, ...shadow.soft },
  card: { backgroundColor: colors.white, borderRadius: radius.card, padding: 16, gap: 12, ...shadow.soft },
  badges: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 14 },
  badge: { width: '33.33%', alignItems: 'center', gap: 4, paddingHorizontal: 4 },
  badgeIcon: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.tint, alignItems: 'center', justifyContent: 'center' },
  call: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  callDot: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  invite: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.orange, borderRadius: radius.card, padding: 16, ...shadow.soft },
  row: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  back: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  preview: { width: 120, height: 120, borderRadius: 60, alignItems: 'center', justifyContent: 'center', borderWidth: 4, borderColor: colors.white, ...shadow.soft },
  emojiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' },
  emojiBtn: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.line },
  emojiOn: { borderColor: colors.brand, backgroundColor: colors.tint },
  colorRow: { flexDirection: 'row', gap: 8, justifyContent: 'center', flexWrap: 'wrap' },
  swatch: { width: 30, height: 30, borderRadius: 15, borderWidth: 3, borderColor: colors.white, ...shadow.soft },
  swatchOn: { borderColor: colors.deep },
  input: { backgroundColor: colors.white, borderWidth: 1.5, borderColor: colors.line, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 13, color: colors.ink, fontSize: 16, fontFamily: fonts.bodySemi },
  handle: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingVertical: 0 },
  handleInput: { flex: 1, paddingVertical: 13, color: colors.ink, fontSize: 16, fontFamily: fonts.bodySemi },
});
