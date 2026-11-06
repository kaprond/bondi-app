import { useSyncExternalStore } from 'react';
import { api } from './api';
import { toast } from './bus';
import { ClipDraft, CreatorClip } from './creator';
import { onHydrate, save } from './persist';

/** Your uploaded clips, refreshed from the backend. Tells you when new commission came in. */
let clips: CreatorClip[] = [];
let seenEarned = -1; // total commission you've been told about; -1 until the first refresh
let seenStatus: Record<string, string> = {}; // last status you were told about, per clip
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

onHydrate((d) => {
  if (typeof d.seenEarned === 'number') seenEarned = d.seenEarned;
  if (d.seenStatus) seenStatus = d.seenStatus as typeof seenStatus;
});

export async function refreshCreator(): Promise<number> {
  const r = await api.getMyClips();
  clips = r.clips;
  const total = clips.reduce((n, c) => n + c.earned, 0);
  if (seenEarned >= 0 && total > seenEarned) toast(`+${total - seenEarned} coins · people called your clips`, true);
  const changed = clips.filter((c) => seenStatus[c.id] && seenStatus[c.id] !== c.status);
  for (const c of changed) {
    if (c.status === 'live') toast(`“${c.title}” passed review. it’s live`);
    if (c.status === 'rejected') toast(`“${c.title}” wasn’t approved${c.reason ? `: ${c.reason}` : ''}`);
  }
  const status = Object.fromEntries(clips.map((c) => [c.id, c.status]));
  if (JSON.stringify(status) !== JSON.stringify(seenStatus)) { seenStatus = status; save({ seenStatus }); }
  if (total !== seenEarned) { seenEarned = total; save({ seenEarned }); }
  emit();
  return r.balance;
}

export async function submitClip(draft: ClipDraft, video: { uri: string; mimeType?: string }) {
  const c = await api.submitClip(draft, video);
  clips = [c, ...clips.filter((x) => x.id !== c.id)];
  seenStatus = { ...seenStatus, [c.id]: c.status }; save({ seenStatus });
  if (seenEarned < 0) { seenEarned = 0; save({ seenEarned }); }
  emit();
  return c;
}

export function useCreatorClips(): CreatorClip[] {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => clips, () => clips);
}
