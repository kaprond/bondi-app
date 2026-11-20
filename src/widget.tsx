import type { Pool } from './pools';

/** Home-screen widget sync. iOS only (see widget.ios.tsx); a no-op on web and Android. */
export function syncWidget(_pools: Pool[]) {}
