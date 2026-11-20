import { Component, ReactNode } from 'react';
import { Platform, View } from 'react-native';
import { reportError } from '../errors';
import { colors } from '../theme';
import { H, PillButton, T } from './ui';

/** If a screen crashes: report it and show a friendly way back instead of a white screen. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { broken: boolean }> {
  state = { broken: false };
  static getDerivedStateFromError() { return { broken: true }; }
  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    reportError(error, { kind: 'render', component: (info.componentStack ?? '').slice(0, 600) });
  }
  render() {
    if (!this.state.broken) return this.props.children;
    return (
      <View style={{ flex: 1, backgroundColor: colors.royal, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 14 }}>
        <T size={44}>🙈</T>
        <H size={30} color={colors.white} style={{ textAlign: 'center' }}>oops, that broke</H>
        <T weight="semi" color={colors.white} style={{ textAlign: 'center' }}>we got the error report. your coins and pools are safe.</T>
        <PillButton label="try again" variant="white" onPress={() => {
          if (Platform.OS === 'web') { try { (globalThis as { location?: Location }).location?.reload(); return; } catch { /* fall through */ } }
          this.setState({ broken: false });
        }} />
      </View>
    );
  }
}
