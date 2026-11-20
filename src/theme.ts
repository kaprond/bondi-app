import { Appearance } from 'react-native';

/** LetsJam brand tokens. Brand palette: #051320 #0095B6 #FFFFFF #FFF000 #1765A9 #28275F #E16632 #F9C500 #224C89.
 *  Everything else here (soft/sky/deep/cloud/tint/line/muted/win) is a tint or a functional colour derived from it. */
const light = {
  brand: '#0095B6',      // main
  brandSoft: '#33AAC5',  // headings, secondary buttons on the site
  sky: '#54B8CE',        // full-width section background
  deep: '#005264',       // heading text on teal
  ink: '#051320',        // palette: near-black navy
  muted: '#6B7C82',
  cloud: '#F1F9FB',      // page background (teal-tinted white)
  tint: '#E3F4F8',       // selected surfaces
  line: '#D5ECF2',
  white: '#FFFFFF',
  yellow: '#FFF000',     // highlight word
  sun: '#F9C500',        // palette: gold (coins)
  orange: '#E16632',     // promo / loss
  royal: '#28275F',      // palette: indigo (challenge card)
  blue: '#1765A9',       // palette
  navy: '#224C89',       // palette
  win: '#14B87A',
  scrim: 'rgba(0, 30, 38, 0.55)',
  card: '#FFFFFF',       // surfaces (cards, sheets, inputs)
  inkFixed: '#051320',   // text on always-light surfaces (yellow, white QR box)
  deepFixed: '#005264',
  mutedFixed: '#6B7C82',
};

/** Dark mode: follows the phone setting when the app starts. Brand colours stay; surfaces and text flip. */
const dark: typeof light = {
  ...light,
  deep: '#D9F2F8',       // headings
  ink: '#E8F5F8',        // body text
  muted: '#93ABB2',
  cloud: '#07171E',      // page background
  tint: '#16343F',
  line: '#24434E',
  card: '#11262F',
  scrim: 'rgba(0, 0, 0, 0.62)',
};

export const isDark = (() => { try { return Appearance.getColorScheme() === 'dark'; } catch { return false; } })();
export const colors = isDark ? dark : light;

export const fonts = {
  display: 'Baloo2_700Bold',
  displaySemi: 'Baloo2_600SemiBold',
  displayHeavy: 'Baloo2_800ExtraBold',
  body: 'Quicksand_500Medium',
  bodySemi: 'Quicksand_600SemiBold',
  bodyBold: 'Quicksand_700Bold',
};

export const radius = { card: 22, sheet: 30, pill: 999 };

export const shadow = {
  soft: { shadowColor: '#00495A', shadowOpacity: 0.12, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 4 },
  button: { shadowColor: '#006A82', shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 5 }, elevation: 6 },
};
