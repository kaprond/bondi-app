import { useState } from 'react';
import { Image, Modal, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { APP_URL, Crew, crewInviteLink, me, startCrew } from '../social';
import { shareText } from '../share';
import { track } from '../track';
import { haptic } from '../haptics';
import { colors, fonts, radius, shadow } from '../theme';
import { H, PillButton, T } from './ui';

export const CREW_EMOJI = ['🎉', '🏠', '⚽', '🎓', '🍻', '🏄', '🔥', '💼'];

/** Shares a crew link into WhatsApp / any chat. The preview shows the crew card (api/card?crew=). */
export async function shareCrew(c: Crew) {
  const r = await shareText(`${c.emoji} join ${c.name} on LetsJam. we call stuff, put free coins on it, winner gets bragging rights:`, crewInviteLink(c.id));
  if (r !== 'dismissed') track('invite_shared', { what: 'crew' });
  return r !== 'dismissed';
}

function Sheet({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <Modal transparent visible animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="close" />
      <View style={styles.sheet}>
        <View style={styles.grab} />
        {children}
      </View>
    </Modal>
  );
}

/** Invite people to a crew: WhatsApp, copy, or a QR code to scan across the table. */
export function InviteSheet({ crew, onClose, onShared }: { crew: Crew; onClose: () => void; onShared?: () => void }) {
  const [qr, setQr] = useState(false);
  const link = crewInviteLink(crew.id);
  return (
    <Sheet onClose={onClose}>
      <H size={28}>get people into {crew.emoji} {crew.name}</H>
      <T color={colors.muted}>whoever opens your link lands straight in the crew, and you’re friends automatically. +10 each, and +20 for you when they play their first pool.</T>
      <PillButton label="send to the group chat" icon={<Ionicons name="logo-whatsapp" size={18} color={colors.white} />}
        onPress={async () => { if (await shareCrew(crew)) { onShared?.(); onClose(); } }} />
      {!qr ? (
        <PillButton label="show QR code" variant="ghost" icon={<Ionicons name="qr-code" size={18} color={colors.deep} />}
          onPress={() => { haptic.tap(); setQr(true); track('crew_qr_shown'); }} />
      ) : (
        <View style={styles.qrBox}>
          <Image source={{ uri: `${APP_URL}/api/qr?d=${encodeURIComponent(link)}` }} style={styles.qr} accessibilityLabel={`QR code to join ${crew.name}`} />
          <T weight="bold" color={colors.inkFixed}>scan to join {crew.name}</T>
          <T size={12} color={colors.mutedFixed}>point the camera at it. works on any phone.</T>
        </View>
      )}
    </Sheet>
  );
}

/** Start another crew (house, padel boys, work…) and invite it in one go. */
export function NewCrewSheet({ onClose, onMade }: { onClose: () => void; onMade: (c: Crew) => void }) {
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState(CREW_EMOJI[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const make = async () => {
    setBusy(true); setError(null);
    try {
      const c = await startCrew(name.trim() || `${me().name.split(' ')[0] || 'my'}’s crew`, emoji);
      track('crew_created', { first_run: false });
      haptic.success();
      onMade(c);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <Sheet onClose={onClose}>
      <H size={28}>new crew</H>
      <View style={styles.emojiRow}>
        {CREW_EMOJI.map((e) => (
          <Pressable key={e} onPress={() => { haptic.tap(); setEmoji(e); }} style={[styles.emoji, emoji === e && styles.emojiOn]} accessibilityRole="button" accessibilityState={{ selected: emoji === e }}>
            <T size={22}>{e}</T>
          </Pressable>
        ))}
      </View>
      <TextInput style={styles.input} placeholder="house, padel boys, uni gang…" placeholderTextColor={colors.muted} value={name}
        onChangeText={(t) => { setName(t); setError(null); }} maxLength={24} autoFocus />
      {error && <T size={13} weight="semi" color={colors.orange}>{error}</T>}
      <PillButton label="make it" busy={busy} onPress={make} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: colors.scrim },
  sheet: { backgroundColor: colors.card, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, padding: 20, paddingBottom: 36, gap: 14, ...shadow.soft },
  grab: { alignSelf: 'center', width: 44, height: 5, borderRadius: 3, backgroundColor: colors.line },
  qrBox: { alignItems: 'center', gap: 6, backgroundColor: '#FFFFFF', borderRadius: radius.card, padding: 16 },
  qr: { width: 220, height: 220 },
  emojiRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  emoji: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.tint },
  emojiOn: { borderWidth: 2.5, borderColor: colors.brand },
  input: { borderWidth: 1.5, borderColor: colors.line, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 12, fontFamily: fonts.bodySemi, fontSize: 16, color: colors.ink, backgroundColor: colors.card },
});
