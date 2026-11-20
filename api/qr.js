// QR code PNG for a LetsJam link: /api/qr?d=<url>. Only our own links, so it can't be used as an open QR service.
const QRCode = require('qrcode');

module.exports = async (req, res) => {
  const url = new URL(req.url, `https://${req.headers.host}`);
  const d = url.searchParams.get('d') || '';
  let ok = false;
  try { const u = new URL(d); ok = /(^|\.)letsjamnow\.com$/.test(u.hostname) && u.protocol === 'https:'; } catch { ok = false; }
  if (!ok || d.length > 400) { res.statusCode = 400; return res.end('bad link'); }
  const png = await QRCode.toBuffer(d, { type: 'png', width: 600, margin: 2, errorCorrectionLevel: 'M', color: { dark: '#28275F', light: '#FFFFFF' } });
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400, immutable');
  res.end(png);
};
