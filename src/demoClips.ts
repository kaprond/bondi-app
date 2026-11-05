import { Platform } from 'react-native';

// a1–a4: AI-generated clips (ElevenLabs), owned by Bondi. c2–c8: synthetic demo clips. Real clips come from the admin pipeline.
const native: Record<string, number> = {
  'a1-teaser': require('../assets/clips/a1-teaser.mp4'), 'a1-reveal': require('../assets/clips/a1-reveal.mp4'),
  'a2-teaser': require('../assets/clips/a2-teaser.mp4'), 'a2-reveal': require('../assets/clips/a2-reveal.mp4'),
  'a3-teaser': require('../assets/clips/a3-teaser.mp4'), 'a3-reveal': require('../assets/clips/a3-reveal.mp4'),
  'a4-teaser': require('../assets/clips/a4-teaser.mp4'), 'a4-reveal': require('../assets/clips/a4-reveal.mp4'),
  'c2-teaser': require('../assets/clips/c2-teaser.mp4'), 'c2-reveal': require('../assets/clips/c2-reveal.mp4'),
  'c3-teaser': require('../assets/clips/c3-teaser.mp4'), 'c3-reveal': require('../assets/clips/c3-reveal.mp4'),
  'c4-teaser': require('../assets/clips/c4-teaser.mp4'), 'c4-reveal': require('../assets/clips/c4-reveal.mp4'),
  'c5-teaser': require('../assets/clips/c5-teaser.mp4'), 'c5-reveal': require('../assets/clips/c5-reveal.mp4'),
  'c6-teaser': require('../assets/clips/c6-teaser.mp4'), 'c6-reveal': require('../assets/clips/c6-reveal.mp4'),
  'c7-teaser': require('../assets/clips/c7-teaser.mp4'), 'c7-reveal': require('../assets/clips/c7-reveal.mp4'),
  'c8-teaser': require('../assets/clips/c8-teaser.mp4'), 'c8-reveal': require('../assets/clips/c8-reveal.mp4'),
};

/** On web the clips are served next to index.html; on native they are bundled assets. */
export const demoClip = (name: string): string | number => (Platform.OS === 'web' ? `clips/${name}.mp4` : native[name]);
