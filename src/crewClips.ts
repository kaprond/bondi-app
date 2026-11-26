import { useCallback, useEffect, useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import { LIVE, ensureSession, rpc, sb } from './backend';
import { track } from './track';

/**
 * Crew clips (0024_clips_live.sql): a pool can carry a setup video, filmed up to the moment,
 * and later a reveal video. Private bucket: only the crew sees them. The reveal stays hidden
 * from the crew until calls close, so nobody calls after seeing how it ended.
 */
const BUCKET = 'pool-clips';
const MAX_MB = 50;
export type ClipKind = 'setup' | 'reveal';
type Clips = { setup: string | null; reveal: string | null; hasReveal: boolean };
const demo = new Map<string, Clips>(); // demo mode: local video uris per pool

export function useCrewClips(poolId: string, enabled: boolean) {
  const [clips, setClips] = useState<Clips>({ setup: null, reveal: null, hasReveal: false });
  const [bump, setBump] = useState(0);
  useEffect(() => {
    if (!enabled || poolId.startsWith('tmp-')) return;
    let alive = true;
    (async () => {
      if (!LIVE || !sb) { if (alive) setClips(demo.get(poolId) ?? { setup: null, reveal: null, hasReveal: false }); return; }
      try {
        const r = await rpc<{ setup: string | null; reveal: string | null; has_reveal: boolean } | null>('pool_clips', { p_pool: poolId });
        if (!r) return;
        const sign = async (path: string | null) => (path ? (await sb!.storage.from(BUCKET).createSignedUrl(path, 3600)).data?.signedUrl ?? null : null);
        const [setup, reveal] = await Promise.all([sign(r.setup), sign(r.reveal)]);
        if (alive) setClips({ setup, reveal, hasReveal: !!r.has_reveal });
      } catch { /* not visible */ }
    })();
    return () => { alive = false; };
  }, [poolId, enabled, bump]);
  return { ...clips, reload: useCallback(() => setBump((b) => b + 1), []) };
}

/** Pick a video from the library (or film one) and attach it. Returns false if cancelled. */
export async function pickAndAttachClip(poolId: string, kind: ClipKind, film = false): Promise<boolean> {
  if (poolId.startsWith('tmp-')) throw new Error('your pool is still saving. try again in a second.');
  const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['videos'], allowsMultipleSelection: false, videoMaxDuration: 60, quality: 0.7 };
  let r: ImagePicker.ImagePickerResult;
  if (film) {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) throw new Error('camera access is off. turn it on in settings, or pick a video instead.');
    r = await ImagePicker.launchCameraAsync(opts);
  } else {
    r = await ImagePicker.launchImageLibraryAsync(opts);
  }
  if (r.canceled || !r.assets?.[0]) return false;
  const a = r.assets[0];
  if (a.fileSize && a.fileSize > MAX_MB * 1024 * 1024) throw new Error(`that video is too big (max ${MAX_MB} MB). trim it to the important bit.`);
  if (!LIVE || !sb) {
    const cur = demo.get(poolId) ?? { setup: null, reveal: null, hasReveal: false };
    demo.set(poolId, kind === 'setup' ? { ...cur, setup: a.uri } : { ...cur, reveal: a.uri, hasReveal: true });
    track(kind === 'setup' ? 'clip_setup_added' : 'clip_reveal_added');
    return true;
  }
  await ensureSession();
  const mime = a.mimeType && /^video\/(mp4|quicktime|webm)$/.test(a.mimeType) ? a.mimeType : 'video/mp4';
  const ext = mime === 'video/quicktime' ? 'mov' : mime.split('/')[1];
  const path = `${poolId}/${kind}-${Date.now()}.${ext}`;
  const body = await (await fetch(a.uri)).blob();
  const up = await sb.storage.from(BUCKET).upload(path, body, { contentType: mime, upsert: false });
  if (up.error) throw new Error(up.error.message.includes('row-level') ? 'only the pool’s creator can add the clip.' : up.error.message);
  await rpc('set_pool_clip', { p_pool: poolId, p_kind: kind, p_path: path });
  track(kind === 'setup' ? 'clip_setup_added' : 'clip_reveal_added');
  return true;
}
