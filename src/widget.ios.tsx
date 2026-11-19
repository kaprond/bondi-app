import { Spacer, Text, VStack } from '@expo/ui/swift-ui';
import { containerBackground, font, foregroundStyle, lineLimit, widgetURL } from '@expo/ui/swift-ui/modifiers';
import { createWidget, type WidgetEnvironment } from 'expo-widgets';
import type { Pool } from './pools';

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
    const json = JSON.stringify(props);
    if (json === last) return;
    last = json;
    widget.updateSnapshot(props);
  } catch { /* widget missing (Expo Go / old build): ignore */ }
}
