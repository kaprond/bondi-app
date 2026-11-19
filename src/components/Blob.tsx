import { Image, StyleSheet, View, ViewStyle, StyleProp } from 'react-native';

/** The glossy LetsJam blob art (assets/brand/letsjam-art.png), cropped so no text shows. */
export const BLOB_HEADER = require('../../assets/brand/blob-header.jpg');
export const BLOB_BOTTOM = require('../../assets/brand/blob-bottom.jpg');
export const ART_HERO = require('../../assets/brand/art-hero.jpg');

const fill = { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%' } as const;

/** Header band with the blob art behind it and a soft scrim so white text stays readable. */
export function BlobHeader({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.header, style]}>
      <Image source={BLOB_HEADER} resizeMode="cover" style={fill} />
      <View style={[fill, styles.scrim]} pointerEvents="none" />
      {children}
    </View>
  );
}

/** A rounded strip of blob art, for empty and coming-soon screens. */
export function BlobBanner({ style }: { style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.banner, style]}>
      <Image source={BLOB_BOTTOM} resizeMode="cover" style={fill} />
    </View>
  );
}

const styles = StyleSheet.create({
  header: { overflow: 'hidden', borderBottomLeftRadius: 32, borderBottomRightRadius: 32, backgroundColor: '#1765A9' },
  scrim: { backgroundColor: 'rgba(5,19,32,0.22)' },
  banner: { width: '100%', maxWidth: 420, aspectRatio: 2.8, borderRadius: 28, overflow: 'hidden', backgroundColor: '#F9C500' },
});
