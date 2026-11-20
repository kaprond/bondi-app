import { HStack, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import { activityBackgroundTint, containerBackground, font, foregroundStyle, lineLimit, monospacedDigit, widgetURL } from '@expo/ui/swift-ui/modifiers';
import { createLiveActivity, createWidget, type LiveActivity, type WidgetEnvironment } from 'expo-widgets';
import type { Pool } from './pools';
import { ME } from './social';
import { track } from './track';

type Row = { q: string; crew: string; pot: number; closes?: number; id: string };
type Props = { rows: Row[]; open: number };

/**
 * "Open pools" home-screen widget: your live pools with a ticking deadline.
 * Runs inside the widget extension as a serialized function: no hooks, no outside helpers,
 * only the @expo/ui components and modifiers (they're globals there).
 */
const OpenPools = (props: Props, env: WidgetEnvironment) => {
  'widget';
  const big = env.widgetFamily === 'systemMedium' || env.widgetFamily === 'systemLarge';
  const rows = props.rows.slice(0, big ? 3 : 1);
  const bg = containerBackground('#0095B6', 'widget');
  if (rows.length === 0) {
    return (
      <VStack alignment="leading" spacing={4} modifiers={[bg, widgetURL('letsjam://pools')]}>
        <Text modifiers={[font({ size: 13, weight: 'heavy', design: 'rounded' }), foregroundStyle('#FFE14D')]}>LetsJam</Text>
        <Spacer />
        <Text modifiers={[font({ size: 16, weight: 'bold', design: 'rounded' }), foregroundStyle('#FFFFFF'), lineLimit(3)]}>no open pools. start one with the crew 🔥</Text>
      </VStack>
    );
  }
  return (
    <VStack alignment="leading" spacing={big ? 8 : 4} modifiers={[bg, widgetURL(rows.length === 1 ? 'letsjam://pool/' + rows[0].id : 'letsjam://pools')]}>
      <Text modifiers={[font({ size: 12, weight: 'heavy', design: 'rounded' }), foregroundStyle('#FFE14D')]}>{props.open + ' open ' + (props.open === 1 ? 'pool' : 'pools')}</Text>
      {rows.map((r) => (
        <VStack key={r.id} alignment="leading" spacing={1}>
          <Text modifiers={[font({ size: big ? 14 : 15, weight: 'bold', design: 'rounded' }), foregroundStyle('#FFFFFF'), lineLimit(big ? 1 : 3)]}>{r.q}</Text>
          {r.closes
            ? <Text date={new Date(r.closes)} dateStyle="relative" modifiers={[font({ size: 11, weight: 'semibold' }), foregroundStyle('#DFF6FB')]} />
            : <Text modifiers={[font({ size: 11, weight: 'semibold' }), foregroundStyle('#DFF6FB')]}>{r.crew + ' · pot ' + r.pot}</Text>}
        </VStack>
      ))}
      {big ? null : <Spacer />}
    </VStack>
  );
};

const widget = createWidget<Props>('OpenPools', OpenPools, { rows: [], open: 0 });

type Live = { q: string; start: number; closes: number; line: string; mine: string };

/** Lock screen + Dynamic Island: a pool you're in is about to close. Same rules as the widget: serialized, no outside helpers. */
const PoolCountdown = (props: Live) => {
  'widget';
  const timer = { lower: new Date(props.start), upper: new Date(props.closes) };
  return {
    banner: (
      <VStack alignment="leading" spacing={6} modifiers={[activityBackgroundTint('#0095B6')]}>
        <HStack spacing={6}>
          <Text modifiers={[font({ size: 12, weight: 'heavy', design: 'rounded' }), foregroundStyle('#FFE14D')]}>LetsJam · closing soon</Text>
          <Spacer />
          <Text timerInterval={timer} countsDown modifiers={[font({ size: 15, weight: 'heavy', design: 'rounded' }), monospacedDigit(), foregroundStyle('#FFFFFF')]} />
        </HStack>
        <Text modifiers={[font({ size: 17, weight: 'bold', design: 'rounded' }), foregroundStyle('#FFFFFF'), lineLimit(2)]}>{props.q}</Text>
        <Text modifiers={[font({ size: 13, weight: 'semibold' }), foregroundStyle('#DFF6FB'), lineLimit(1)]}>{props.mine + ' · ' + props.line}</Text>
      </VStack>
    ),
    compactLeading: <Text modifiers={[font({ size: 14 })]}>🎲</Text>,
    compactTrailing: <Text timerInterval={timer} countsDown modifiers={[font({ size: 13, weight: 'bold' }), monospacedDigit(), foregroundStyle('#FFE14D')]} />,
    minimal: <Text modifiers={[font({ size: 13 })]}>⏰</Text>,
    expandedLeading: <Text modifiers={[font({ size: 13, weight: 'heavy', design: 'rounded' }), foregroundStyle('#FFE14D')]}>closing</Text>,
    expandedTrailing: <Text timerInterval={timer} countsDown modifiers={[font({ size: 15, weight: 'heavy' }), monospacedDigit(), foregroundStyle('#FFFFFF')]} />,
    expandedBottom: (
      <VStack alignment="leading" spacing={4}>
        <Text modifiers={[font({ size: 16, weight: 'bold', design: 'rounded' }), foregroundStyle('#FFFFFF'), lineLimit(2)]}>{props.q}</Text>
        <Text modifiers={[font({ size: 13, weight: 'semibold' }), foregroundStyle('#DFF6FB'), lineLimit(1)]}>{props.mine + ' · ' + props.line}</Text>
      </VStack>
    ),
  };
};

const countdown = createLiveActivity<Live>('PoolCountdown', PoolCountdown);
const LIVE_WINDOW = 3 * 3600 * 1000; // show it for pools closing within 3 hours
let current: { poolId: string; activity: LiveActivity<Live>; json: string; start: number } | null = null;
const startedFor = new Set<string>(); // once per pool per app session: if you swipe it away, it stays away

function syncLiveActivity(pools: Pool[]) {
  const now = Date.now();
  const mineOpen = pools
    .filter((p) => p.status === 'open' && p.closesAt && p.entries.some((e) => e.userId === ME))
    .map((p) => ({ p, closes: Date.parse(p.closesAt!) }))
    .filter((x) => x.closes > now && x.closes - now <= LIVE_WINDOW)
    .sort((a, b) => a.closes - b.closes)[0];

  if (current && (!mineOpen || mineOpen.p.id !== current.poolId)) {
    current.activity.end('immediate').catch(() => {});
    current = null;
  }
  if (!mineOpen) return;
  const { p, closes } = mineOpen;
  const pick = p.options.find((o) => o.id === p.entries.find((e) => e.userId === ME)?.optionId)?.label ?? '';
  const counts = p.options.map((o) => `${o.label} ${p.entries.filter((e) => e.optionId === o.id).length}`).join(' · ');
  const props: Live = { q: p.question, start: current?.start ?? now, closes, mine: `you: ${pick}`, line: `${counts} · pot ${p.entries.length * p.stake}` };
  const json = JSON.stringify(props);
  if (current) {
    if (json !== current.json) { current.json = json; current.activity.update(props, new Date(closes)).catch(() => {}); }
    return;
  }
  if (startedFor.has(p.id)) return;
  startedFor.add(p.id);
  const activity = countdown.start(props, `letsjam://pool/${p.id}`, new Date(closes));
  current = { poolId: p.id, activity, json, start: now };
  track('live_activity_started');
}

let last = '';
/** Push your open pools to the home-screen widget (only when something changed). */
export function syncWidget(pools: Pool[]) {
  try {
    const now = Date.now();
    const open = pools
      .filter((p) => p.status === 'open' && (!p.closesAt || Date.parse(p.closesAt) > now))
      .sort((a, b) => (a.closesAt ? Date.parse(a.closesAt) : Infinity) - (b.closesAt ? Date.parse(b.closesAt) : Infinity));
    const props: Props = {
      open: open.length,
      rows: open.slice(0, 3).map((p) => ({ id: p.id, q: p.question, crew: p.groupName, pot: p.entries.length * p.stake, closes: p.closesAt ? Date.parse(p.closesAt) : undefined })),
    };
    try { syncLiveActivity(pools); } catch { /* Live Activities off or unsupported */ }
    const json = JSON.stringify(props);
    if (json === last) return;
    last = json;
    widget.updateSnapshot(props);
  } catch { /* widget missing (Expo Go / old build): ignore */ }
}
