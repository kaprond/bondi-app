import { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  appleAvailable, finishLogin, finishSaveEmail, loginWithApple, logOut, saveWithApple, startLogin, startSaveEmail, useAccount,
} from '../account';
import { toast } from '../bus';
import { colors, fonts, radius, shadow } from '../theme';
import { Eyebrow, H, PillButton, T } from './ui';

type Step =
  | { kind: 'idle' }
  | { kind: 'email'; mode: 'save' | 'login' }
  | { kind: 'code'; mode: 'save' | 'login'; email: string };

/** Me tab: save the account (email code or Apple), log in on another phone, log out. */
export function AccountCard() {
  const acc = useAccount();
  const [step, setStep] = useState<Step>({ kind: 'idle' });
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [apple, setApple] = useState(false);
  useEffect(() => { appleAvailable().then(setApple); }, []);

  if (acc.kind === 'demo') return null;
  const run = async (fn: () => Promise<void>) => { setBusy(true); setError(null); try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } };
  const reset = () => { setStep({ kind: 'idle' }); setValue(''); setError(null); };

  if (acc.kind === 'saved' && step.kind === 'idle') return (
    <View style={styles.card}>
      <Eyebrow label="your account" />
      <View style={styles.row}>
        <Ionicons name={acc.apple ? 'logo-apple' : 'mail'} size={20} color={colors.brand} />
        <T weight="semi" color={colors.deep} style={{ flex: 1 }}>{acc.email ?? 'saved with Apple'}</T>
        <Ionicons name="checkmark-circle" size={20} color={colors.win} />
      </View>
      <T size={13} color={colors.muted}>log in with this on any phone to get your coins, friends and pools back.</T>
      <Pressable onPress={() => run(async () => { await logOut(); toast('logged out'); })} disabled={busy} style={{ alignSelf: 'flex-start' }} accessibilityRole="button">
        <T size={13} weight="bold" color={colors.muted}>log out</T>
      </Pressable>
    </View>
  );

  if (step.kind === 'idle') return (
    <View style={[styles.card, styles.warn]}>
      <Eyebrow label="save your account" />
      <H size={22} color={colors.deep}>don’t lose your coins</H>
      <T weight="semi" color={colors.deep}>right now your account only lives on this phone. save it so you can log in again if you switch phones or delete the app.</T>
      {apple && <PillButton label="save with Apple" icon={<Ionicons name="logo-apple" size={18} color={colors.white} />} busy={busy}
        onPress={() => run(async () => {
          const r = await saveWithApple();
          if (r === 'saved') toast('account saved 🙌');
          if (r === 'exists') setError('that Apple ID already has a LetsJam account. use “log in” below to switch to it.');
        })} />}
      <PillButton label="save with email" variant={apple ? 'ghost' : 'brand'} icon={<Ionicons name="mail" size={18} color={apple ? colors.brand : colors.white} />} onPress={() => setStep({ kind: 'email', mode: 'save' })} />
      <Pressable onPress={() => setStep({ kind: 'email', mode: 'login' })} style={{ alignSelf: 'center' }} accessibilityRole="button">
        <T size={13} weight="bold" color={colors.brand}>already have an account? log in</T>
      </Pressable>
      {error && <T size={13} weight="semi" color={colors.orange}>{error}</T>}
    </View>
  );

  const login = step.mode === 'login';
  return (
    <View style={styles.card}>
      <Eyebrow label={login ? 'log in' : 'save your account'} />
      {login && step.kind === 'email' && (
        <T size={13} color={colors.muted}>switching to your other account leaves this guest account behind on this phone.</T>
      )}
      {step.kind === 'email' ? (
        <>
          <TextInput style={styles.input} placeholder="you@email.com" placeholderTextColor={colors.muted} value={value} onChangeText={setValue}
            autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="emailAddress" autoFocus />
          <PillButton label="send me a code" busy={busy} disabled={!value.trim()} onPress={() => run(async () => {
            const email = login ? await startLogin(value) : await startSaveEmail(value);
            setStep({ kind: 'code', mode: step.mode, email }); setValue('');
          })} />
          {login && apple && <PillButton label="log in with Apple" variant="ghost" icon={<Ionicons name="logo-apple" size={18} color={colors.brand} />} busy={busy}
            onPress={() => run(async () => { if (await loginWithApple()) toast('welcome back 👋'); })} />}
        </>
      ) : (
        <>
          <T weight="semi" color={colors.deep}>we sent a 6-digit code to {step.email}.</T>
          <TextInput style={[styles.input, styles.code]} placeholder="123456" placeholderTextColor={colors.muted} value={value}
            onChangeText={(t) => setValue(t.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" textContentType="oneTimeCode" autoComplete={Platform.OS === 'web' ? 'one-time-code' : 'sms-otp'} autoFocus />
          <PillButton label={login ? 'log in' : 'save my account'} busy={busy} disabled={value.length !== 6} onPress={() => run(async () => {
            if (login) { await finishLogin(step.email, value); toast('welcome back 👋'); }
            else { await finishSaveEmail(step.email, value); toast('account saved 🙌'); }
            reset();
          })} />
        </>
      )}
      {error && <T size={13} weight="semi" color={colors.orange}>{error}</T>}
      <Pressable onPress={reset} style={{ alignSelf: 'center' }} accessibilityRole="button"><T size={13} weight="bold" color={colors.muted}>cancel</T></Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: radius.card, padding: 16, gap: 10, ...shadow.soft },
  warn: { borderWidth: 2, borderColor: colors.sun },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  input: { backgroundColor: colors.cloud, borderWidth: 1.5, borderColor: colors.line, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 13, color: colors.ink, fontSize: 16, fontFamily: fonts.bodySemi },
  code: { fontSize: 24, letterSpacing: 8, textAlign: 'center' },
});
