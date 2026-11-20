import { useCallback, useEffect, useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import { LIVE, ensureSession, rpc, sb } from './backend';
import { track } from './track';

/** Photo proof for settling a pool (0020_proof_titles.sql). Private bucket: only the crew can see it. */
const BUCKET = 'pool-proofs';
const demo = new Map<string, string>(); // demo mode: local image uri per pool

/** Signed URL of a pool's proof photo, or null. Re-fetches when `bump` changes. */
export function useProof(poolId: string, enabled: boolean) {
  const [url, setUrl] = useState<string | null>(null);
  const [bump, setBump] = useState(0);
  useEffect(() => {
    if (!enabled || poolId.startsWith('tmp-')) return;
    let alive = true;
    (async () => {
      if (!LIVE || !sb) { if (alive) setUrl(demo.get(poolId) ?? null); return; }
      try {
        const path = await rpc<string | null>('pool_proof', { p_pool: poolId });
        if (!path) { if (alive) setUrl(null); return; }
        const { data } = await sb.storage.from(BUCKET).createSignedUrl(path, 3600);
        if (alive) setUrl(data?.signedUrl ?? null);
      } catch { /* no proof visible */ }
    })();
    return () => { alive = false; };
  }, [poolId, enabled, bump]);
  return { url, reload: useCallback(() => setBump((b) => b + 1), []) };
}

/** Pick a photo (screenshot of the score, the receipt, the selfie at the finish) and attach it. Returns false if cancelled. */
export async function pickAndAttachProof(poolId: string): Promise<boolean> {
  if (poolId.startsWith('tmp-')) throw new Error('your pool is still saving. try again in a second.');
  const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: false, quality: 0.6, exif: false });
  if (r.canceled || !r.assets?.[0]) return false;
  const a = r.assets[0];
  if (a.fileSize && a.fileSize > 5 * 1024 * 1024) throw new Error('that photo is too big (max 5 MB). try a screenshot.');
  if (!LIVE || !sb) { demo.set(poolId, a.uri); track('proof_added'); return true; }
  await ensureSession();
  const mime = a.mimeType && /^image\/(jpeg|png|webp|heic)$/.test(a.mimeType) ? a.mimeType : 'image/jpeg';
  const ext = mime.split('/')[1].replace('jpeg', 'jpg');
  const path = `${poolId}/${Date.now()}.${ext}`;
  const body = await (await fetch(a.uri)).blob();
  const up = await sb.storage.from(BUCKET).upload(path, body, { contentType: mime, upsert: false });
  if (up.error) throw new Error(up.error.message.includes('row-level') ? 'only the pool’s creator can add proof.' : up.error.message);
  await rpc('set_proof', { p_pool: poolId, p_path: path });
  track('proof_added');
  return true;
}
