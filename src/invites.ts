import { useEffect, useState } from 'react';
import { LIVE, rpc } from './backend';
import { toLocal } from './social';

/** Invite rewards (0023: my_invites): +10 each when they join, +20 for you when they play their first pool. */
export interface InviteStats { joined: number; played: number; earned: number; founder: boolean; board: { userId: string; joined: number; played: number }[] }

export function useMyInvites() {
  const [stats, setStats] = useState<InviteStats | null>(null);
  useEffect(() => {
    if (!LIVE) { setStats({ joined: 0, played: 0, earned: 0, founder: false, board: [] }); return; }
    let alive = true;
    rpc<{ joined: number; played: number; earned: number; founder: boolean; board: { user: string; joined: number; played: number }[] }>('my_invites')
      .then((d) => { if (alive && d) setStats({ joined: Number(d.joined), played: Number(d.played), earned: Number(d.earned), founder: !!d.founder,
        board: (d.board ?? []).map((r) => ({ userId: toLocal(r.user) ?? r.user, joined: Number(r.joined), played: Number(r.played) })) }); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  return stats;
}
