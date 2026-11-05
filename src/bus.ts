/** App-wide signals that any screen can send: a toast, or opening the league or missions. */
type Ev = { kind: 'toast'; text: string; coins?: boolean } | { kind: 'league' } | { kind: 'missions' };
const subs = new Set<(e: Ev) => void>();
export const onBus = (fn: (e: Ev) => void) => { subs.add(fn); return () => { subs.delete(fn); }; };
const send = (e: Ev) => subs.forEach((s) => s(e));
export const toast = (text: string, coins = false) => send({ kind: 'toast', text, coins });
export const openLeague = () => send({ kind: 'league' });
export const openMissions = () => send({ kind: 'missions' });
