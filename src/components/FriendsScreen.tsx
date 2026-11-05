import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Avatar } from '../avatar';
import { shareText } from '../share';
import { recordShare } from '../session';
import { openLeague } from '../bus';
import { LeagueCard } from './LeagueScreen';
import {
  AVATAR_EMOJI, cancelRequest, createCrew, crewList, friendList, incomingList, inviteCode, inviteLink, me, ME, nameOf,
  Person, relation, respond, search, sendRequest, suggestions, useSocial,
} from '../social';
import { colors, fonts, radius, shadow } from '../theme';
import { Chip, Eyebrow, H, PillButton, T } from './ui';
import { RenderBar } from './TopBar';
import { PersonSheet } from './PersonSheet';

export function FriendsScreen({ renderBar, onPoolWith }: { renderBar: RenderBar; onPoolWith: (friendId: string) => void }) {
  useSocial();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [newCrew, setNewCrew] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const results = search(q);
  const requests = incomingList();
  const friends = friendList();
  const board = [...friends, me()].sort((a, b) => b.stats.hitRate - a.stats.hitRate || b.stats.calls - a.stats.calls);

  async function invite() {
    const r = await shareText(`come play bondi with me. guess what happens next, free coins, no cash. use my code ${inviteCode()} and we both get 500 coins.`, inviteLink());
    setCopied(r === 'copied' ? 'link copied' : r === 'shared' ? 'sent!' : null);
    if (r !== 'dismissed') recordShare();
    if (r !== 'dismissed') setTimeout(() => setCopied(null), 2000);
  }

  if (newCrew) return <CreateCrew renderBar={renderBar} onDone={() => setNewCrew(false)} />;

  return (
    <View style={{ flex: 1 }}>
      <ScrollView style={styles.page} contentContainerStyle={{ paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
        <View style={{ backgroundColor: colors.sky }}>{renderBar('media')}</View>
        <View style={styles.band}>
          <Eyebrow label={`${friends.length} friends`} tone="white" />
          <H size={40} color={colors.white}>your <H size={40} color={colors.yellow}>people</H></H>
          <T weight="semi" color={colors.white} size={16}>bondi is better with the besties. invite them and you both get 500 coins.</T>
          <View style={styles.inviteRow}>
            <View style={styles.code}>
              <T size={12} weight="bold" color={colors.muted}>your code</T>
              <H size={22} color={colors.deep} style={{ letterSpacing: 1 }}>{inviteCode()}</H>
            </View>
            <PillButton label={copied ?? 'invite friends'} variant="white" onPress={invite} style={{ flex: 1 }}
              icon={<Ionicons name={copied ? 'checkmark' : 'paper-plane'} size={18} color={colors.brand} />} />
          </View>
        </View>

        <View style={styles.body}>
          <LeagueCard onPress={openLeague} />
          <View style={styles.searchBox}>
            <Ionicons name="search" size={18} color={colors.muted} />
            <TextInput value={q} onChangeText={setQ} placeholder="find people by @handle" placeholderTextColor={colors.muted}
              style={styles.searchInput} autoCapitalize="none" autoCorrect={false} accessibilityLabel="search people" />
            {!!q && <Pressable onPress={() => setQ('')} hitSlop={10} accessibilityLabel="clear"><Ionicons name="close-circle" size={18} color={colors.muted} /></Pressable>}
          </View>

          {q.trim().length >= 2 && (
            <Section title="results">
              {results.length === 0 && <T color={colors.muted}>no one called “{q.trim()}” yet. send them your invite link.</T>}
              {results.map((p) => <PersonRow key={p.id} p={p} onPress={() => setOpen(p.id)} />)}
            </Section>
          )}

          {requests.length > 0 && (
            <Section title={`friend requests (${requests.length})`}>
              {requests.map((p) => (
                <View key={p.id} style={styles.row}>
                  <Pressable onPress={() => setOpen(p.id)} style={styles.rowMain}>
                    <Avatar id={p.id} size={44} />
                    <View style={{ flex: 1 }}>
                      <T weight="bold" color={colors.deep}>{p.name}</T>
                      <T size={13} color={colors.muted}>@{p.handle} wants to be friends</T>
                    </View>
                  </Pressable>
                  <Pressable onPress={() => respond(p.id, true)} style={[styles.small, styles.smallOn]} accessibilityRole="button" accessibilityLabel={`accept ${p.name}`}>
                    <Ionicons name="checkmark" size={18} color={colors.white} />
                  </Pressable>
                  <Pressable onPress={() => respond(p.id, false)} style={styles.small} accessibilityRole="button" accessibilityLabel={`decline ${p.name}`}>
                    <Ionicons name="close" size={18} color={colors.deep} />
                  </Pressable>
                </View>
              ))}
            </Section>
          )}

          <Section title="sharpest callers" right={<T size={13} color={colors.muted}>hit rate</T>}>
            {board.slice(0, 5).map((p, i) => (
              <Pressable key={p.id} onPress={() => p.id !== ME && setOpen(p.id)} style={[styles.boardRow, p.id === ME && styles.boardMe]}>
                <View style={[styles.rank, i === 0 && { backgroundColor: colors.yellow }]}><T weight="bold" size={13} color={colors.deep}>{i + 1}</T></View>
                <Avatar id={p.id} size={34} />
                <T weight="bold" color={colors.deep} style={{ flex: 1 }}>{p.id === ME ? 'you' : p.name}</T>
                <T size={13} color={colors.muted}>{p.stats.calls} calls</T>
                <H size={20} color={colors.deep}>{p.stats.calls ? `${p.stats.hitRate}%` : '–'}</H>
              </Pressable>
            ))}
          </Section>

          <Section title="crews" right={<Pressable onPress={() => setNewCrew(true)} accessibilityRole="button"><T weight="bold" color={colors.brand}>+ new crew</T></Pressable>}>
            {crewList().map((c) => (
              <View key={c.id} style={styles.row}>
                <View style={styles.crewIcon}><T size={22}>{c.emoji}</T></View>
                <View style={{ flex: 1, gap: 4 }}>
                  <T weight="bold" color={colors.deep}>{c.name}</T>
                  <View style={{ flexDirection: 'row' }}>
                    {c.memberIds.slice(0, 6).map((m, i) => <View key={m} style={{ marginLeft: i ? -8 : 0 }}><Avatar id={m} size={24} /></View>)}
                  </View>
                </View>
                <T size={13} color={colors.muted}>{c.memberIds.length} people</T>
              </View>
            ))}
          </Section>

          <Section title={`friends (${friends.length})`}>
            {friends.length === 0 && <T color={colors.muted}>no friends yet. invite your besties above.</T>}
            {friends.map((p) => <PersonRow key={p.id} p={p} onPress={() => setOpen(p.id)} />)}
          </Section>

          {suggestions().length > 0 && (
            <Section title="people you might know">
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingVertical: 4 }}>
                {suggestions().map((p) => <SuggestCard key={p.id} p={p} onPress={() => setOpen(p.id)} />)}
              </ScrollView>
            </Section>
          )}
        </View>
      </ScrollView>
      {open && <PersonSheet id={open} onClose={() => setOpen(null)} onPoolWith={(id) => { setOpen(null); onPoolWith(id); }} />}
    </View>
  );
}

function Section({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}><T weight="bold" size={16} color={colors.deep}>{title}</T>{right}</View>
      <View style={styles.card}>{children}</View>
    </View>
  );
}

export function RelationButton({ id, compact }: { id: string; compact?: boolean }) {
  useSocial();
  const r = relation(id);
  if (r === 'self') return null;
  const conf = {
    friend: { label: 'friends', icon: 'checkmark-circle', on: false, act: undefined },
    outgoing: { label: 'requested', icon: 'time-outline', on: false, act: () => cancelRequest(id) },
    incoming: { label: 'accept', icon: 'person-add', on: true, act: () => respond(id, true) },
    none: { label: 'add', icon: 'person-add', on: true, act: () => sendRequest(id) },
  }[r];
  return (
    <Pressable onPress={conf.act} disabled={!conf.act} accessibilityRole="button" accessibilityLabel={`${conf.label} ${nameOf(id)}`}
      style={[styles.relBtn, conf.on ? styles.relOn : styles.relOff, compact && { paddingHorizontal: 10 }]}>
      <Ionicons name={conf.icon as keyof typeof Ionicons.glyphMap} size={15} color={conf.on ? colors.white : colors.brand} />
      <T weight="bold" size={13} color={conf.on ? colors.white : colors.brand}>{conf.label}</T>
    </Pressable>
  );
}

function PersonRow({ p, onPress }: { p: Person; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]} accessibilityRole="button">
      <Avatar id={p.id} size={44} />
      <View style={{ flex: 1 }}>
        <T weight="bold" color={colors.deep}>{p.name}</T>
        <T size={13} color={colors.muted}>@{p.handle} · {p.city}</T>
      </View>
      <RelationButton id={p.id} compact />
    </Pressable>
  );
}

function SuggestCard({ p, onPress }: { p: Person; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.suggest} accessibilityRole="button">
      <Avatar id={p.id} size={56} />
      <T weight="bold" color={colors.deep}>{p.name}</T>
      <T size={12} color={colors.muted} numberOfLines={1}>@{p.handle}</T>
      <RelationButton id={p.id} compact />
    </Pressable>
  );
}

function CreateCrew({ renderBar, onDone }: { renderBar: RenderBar; onDone: () => void }) {
  useSocial();
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('🎉');
  const [picked, setPicked] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const friends = friendList();
  const save = () => { try { createCrew(name, emoji, picked); onDone(); } catch (e) { setError((e as Error).message); } };
  return (
    <ScrollView style={styles.page} contentContainerStyle={[styles.body, { paddingTop: 0 }]} keyboardShouldPersistTaps="handled">
      <View style={{ marginHorizontal: -18 }}>{renderBar('light')}</View>
      <Pressable onPress={onDone} style={styles.back} accessibilityRole="button"><Ionicons name="chevron-back" size={20} color={colors.brand} /><T weight="bold" color={colors.brand}>friends</T></Pressable>
      <H size={34}>new crew</H>
      <View style={{ gap: 8 }}>
        <T weight="bold" color={colors.deep}>name</T>
        <TextInput value={name} onChangeText={(t) => { setName(t); setError(null); }} placeholder="padel gang" placeholderTextColor={colors.muted} maxLength={24} style={styles.input} />
      </View>
      <View style={{ gap: 8 }}>
        <T weight="bold" color={colors.deep}>icon</T>
        <View style={styles.emojiRow}>
          {['🎉', '🏠', '🎓', '🏓', '⚽️', '🎮', '🍕', '🚲', ...AVATAR_EMOJI.slice(0, 4)].map((e) => (
            <Pressable key={e} onPress={() => setEmoji(e)} style={[styles.emojiBtn, emoji === e && styles.emojiOn]} accessibilityRole="button" accessibilityState={{ selected: emoji === e }}>
              <T size={24}>{e}</T>
            </Pressable>
          ))}
        </View>
      </View>
      <View style={{ gap: 8 }}>
        <T weight="bold" color={colors.deep}>who’s in? ({picked.length})</T>
        {friends.map((f) => {
          const on = picked.includes(f.id);
          return (
            <Pressable key={f.id} onPress={() => setPicked((p) => (on ? p.filter((x) => x !== f.id) : [...p, f.id]))}
              style={[styles.row, styles.pickRow, on && styles.pickOn]} accessibilityRole="checkbox" accessibilityState={{ checked: on }}>
              <Avatar id={f.id} size={40} />
              <T weight="bold" color={colors.deep} style={{ flex: 1 }}>{f.name}</T>
              <Ionicons name={on ? 'checkmark-circle' : 'ellipse-outline'} size={24} color={on ? colors.brand : colors.line} />
            </Pressable>
          );
        })}
      </View>
      {error && <T weight="semi" color={colors.orange}>{error}</T>}
      <PillButton label={`create ${emoji} ${name.trim() || 'crew'}`} onPress={save} disabled={!name.trim() || !picked.length} />
      <View style={styles.wrapRow}><Chip label="cancel" onPress={onDone} /></View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.cloud },
  band: { backgroundColor: colors.sky, paddingHorizontal: 18, paddingTop: 10, paddingBottom: 22, gap: 10, borderBottomLeftRadius: 32, borderBottomRightRadius: 32 },
  inviteRow: { flexDirection: 'row', gap: 10, alignItems: 'center', marginTop: 4 },
  code: { backgroundColor: colors.white, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 6, borderWidth: 2, borderStyle: 'dashed', borderColor: colors.line },
  body: { padding: 18, gap: 18 },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.white, borderRadius: radius.pill, paddingHorizontal: 16, borderWidth: 1.5, borderColor: colors.line },
  searchInput: { flex: 1, paddingVertical: 12, fontSize: 16, fontFamily: fonts.bodySemi, color: colors.ink },
  section: { gap: 8 },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 4 },
  card: { backgroundColor: colors.white, borderRadius: radius.card, padding: 8, gap: 2, ...shadow.soft },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 8, borderRadius: 16 },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  small: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.tint },
  smallOn: { backgroundColor: colors.brand },
  boardRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 8, borderRadius: 16 },
  boardMe: { backgroundColor: colors.tint },
  rank: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.cloud, alignItems: 'center', justifyContent: 'center' },
  crewIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.tint, alignItems: 'center', justifyContent: 'center' },
  relBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 7 },
  relOn: { backgroundColor: colors.brand },
  relOff: { backgroundColor: colors.tint },
  suggest: { width: 128, alignItems: 'center', gap: 4, backgroundColor: colors.cloud, borderRadius: 20, padding: 12 },
  back: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  input: { backgroundColor: colors.white, borderWidth: 1.5, borderColor: colors.line, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 13, color: colors.ink, fontSize: 16, fontFamily: fonts.bodySemi },
  emojiRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  emojiBtn: { width: 50, height: 50, borderRadius: 25, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.line },
  emojiOn: { borderColor: colors.brand, backgroundColor: colors.tint },
  pickRow: { backgroundColor: colors.white, borderWidth: 2, borderColor: 'transparent', ...shadow.soft },
  pickOn: { borderColor: colors.brand },
  wrapRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
