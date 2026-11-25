// Shared request/response helpers for the applicant portal API.
// Files under api/_lib are not deployed as endpoints (leading underscore).

const MAX_BODY_BYTES = 64 * 1024;

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

const fail = (res, status, error, extra = {}) => send(res, status, { ok: false, error, ...extra });

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Trim, normalise, and strip control characters (keeping newlines when allowed)
function clean(value, { multiline = false } = {}) {
  if (typeof value !== 'string') return '';
  let s = value.normalize('NFC').replace(/\r\n?/g, '\n');
  s = multiline
    ? s.replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '').replace(/\n{3,}/g, '\n\n')
    : s.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ');
  return s.trim();
}

const countWords = (s) => (s.match(/\S+/g) || []).length;

const isEmail = (s) => s.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  return (typeof fwd === 'string' && fwd.split(',')[0].trim())
    || req.headers['x-real-ip']
    || (req.socket && req.socket.remoteAddress)
    || 'unknown';
}

// Light, best-effort limiter: memory is per warm function instance, so it slows
// a single noisy client rather than guaranteeing a global cap.
const buckets = new Map();
function rateLimited(key, max, windowMs) {
  const now = Date.now();
  const recent = (buckets.get(key) || []).filter((t) => now - t < windowMs);
  const limited = recent.length >= max;
  if (!limited) recent.push(now);
  buckets.set(key, recent);
  if (buckets.size > 10000) buckets.clear();
  return limited;
}

// Browsers always send Origin on cross-site fetch POSTs; reject other sites
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; } catch (_) { return false; }
}

// Vercel pre-parses JSON into req.body; a bare http server doesn't
async function readJson(req) {
  let raw;
  if (req.body !== undefined) {
    raw = req.body;
    if (Buffer.isBuffer(raw)) raw = raw.toString('utf8');
    if (typeof raw === 'string') raw = JSON.parse(raw);
  } else {
    let size = 0;
    const chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) throw Object.assign(new Error('too large'), { code: 'TOO_LARGE' });
      chunks.push(chunk);
    }
    raw = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('not an object');
  if (JSON.stringify(raw).length > MAX_BODY_BYTES) throw Object.assign(new Error('too large'), { code: 'TOO_LARGE' });
  return raw;
}

// Common guard for JSON POST endpoints. Returns the parsed body, or null after
// sending an error response.
async function postJson(req, res, { limit } = {}) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    fail(res, 405, 'Method not allowed.');
    return null;
  }
  if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
    fail(res, 415, 'Please send JSON.');
    return null;
  }
  if (!sameOrigin(req)) {
    fail(res, 403, 'This can only be sent from the Beyond4walls website.');
    return null;
  }
  if (limit && rateLimited(`${limit.name}:${clientIp(req)}`, limit.max, limit.windowMs)) {
    res.setHeader('Retry-After', String(Math.ceil(limit.windowMs / 1000)));
    fail(res, 429, 'Too many attempts. Please wait a few minutes and try again.');
    return null;
  }
  try {
    return await readJson(req);
  } catch (err) {
    fail(res, err.code === 'TOO_LARGE' ? 413 : 400, err.code === 'TOO_LARGE'
      ? 'That is too large to send.' : 'We couldn’t read that request. Please try again.');
    return null;
  }
}

function bearerToken(req) {
  const h = String(req.headers.authorization || '');
  const m = h.match(/^Bearer\s+([A-Za-z0-9._-]{20,4096})$/);
  return m ? m[1] : null;
}

module.exports = {
  send, fail, escapeHtml, clean, countWords, isEmail, clientIp, rateLimited,
  sameOrigin, readJson, postJson, bearerToken,
};
