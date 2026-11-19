/** An invite carried by a link: ?i=JAM-XXXX&from=handle, optionally a pool or crew to join. */
export type Invite = { code: string; from: string; pool?: string; crew?: string };

const uuid = (s: string) => (/^[0-9a-f-]{36}$/.test(s) ? s : undefined);

/**
 * Reads an invite from any LetsJam link:
 *   https://app.letsjamnow.com/?i=..&from=..&pool=<id>   (web, after the /p /c /r preview redirect)
 *   https://app.letsjamnow.com/p/<id>?i=..&from=..       (universal link straight into the app)
 *   https://app.letsjamnow.com/c/<id>, /r/<id>, letsjam://p/<id>?...
 * Plain string parsing on purpose: Hermes' URL support is patchy.
 */
export function parseInvite(url: string | null | undefined): Invite | null {
  if (!url) return null;
  try {
    const [beforeHash] = url.split('#');
    const qi = beforeHash.indexOf('?');
    const path = (qi >= 0 ? beforeHash.slice(0, qi) : beforeHash).replace(/^[a-z]+:\/\/[^/]*/i, '').replace(/^\/+/, '');
    const q: Record<string, string> = {};
    if (qi >= 0) for (const part of beforeHash.slice(qi + 1).split('&')) {
      const [k, v = ''] = part.split('=');
      if (k) q[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, ' '));
    }
    // letsjam://p/<id> puts "p" in the host spot; https links put it in the path
    const scheme = /^letsjam:\/\/([^/?#]+)/i.exec(beforeHash)?.[1];
    const segs = (scheme ? [scheme, ...path.split('/')] : path.split('/')).filter(Boolean);
    let pool = (q.pool ?? '').toLowerCase(), crew = (q.crew ?? '').toLowerCase();
    if ((segs[0] === 'p' || segs[0] === 'r') && segs[1]) pool = segs[1].toLowerCase();
    if (segs[0] === 'c' && segs[1]) crew = segs[1].toLowerCase();
    const code = (q.i ?? '').toUpperCase(), from = (q.from ?? '').replace(/[^a-z0-9._]/gi, '').toLowerCase();
    return /^(BND|JAM)-[A-Z0-9]{4}$/.test(code) && from.length >= 3 ? { code, from, pool: uuid(pool), crew: uuid(crew) } : null;
  } catch { return null; }
}

/** Widget taps: letsjam://pools opens the pools tab, letsjam://pool/<id> opens that pool. */
export function parseOpen(url: string | null | undefined): { poolId?: string } | null {
  const m = /^letsjam:\/\/(pools|pool)(?:\/([0-9a-f-]{36}))?/i.exec(url ?? '');
  if (!m) return null;
  return { poolId: m[2]?.toLowerCase() };
}
