// Minimal Supabase REST client (PostgREST, Auth, Storage) using fetch, so the
// functions need no npm dependencies. The service role key never leaves the server.

const BUCKET = 'challenge-uploads';

function env() {
  const url = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const anon = process.env.SUPABASE_ANON_KEY;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anon || !service) {
    throw Object.assign(new Error('Supabase is not configured: set SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY.'), { code: 'CONFIG' });
  }
  return { url, anon, service };
}

class SupabaseError extends Error {
  constructor(status, info) {
    // Only status and error codes: never request bodies, keys or personal data
    super(`Supabase ${status}${info && info.code ? ` (${info.code})` : ''}`);
    this.status = status;
    this.info = info || {};
  }
}

async function call(path, { method = 'GET', body, token, service = false, headers = {}, raw = false } = {}) {
  const { url, anon, service: serviceKey } = env();
  const key = service ? serviceKey : anon;
  const res = await fetch(`${url}${path}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${token || key}`,
      ...(body !== undefined && !Buffer.isBuffer(body) ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : (Buffer.isBuffer(body) ? body : JSON.stringify(body)),
    signal: AbortSignal.timeout(10000),
  });
  if (raw) return res;
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_) { data = text; }
  if (!res.ok) throw new SupabaseError(res.status, typeof data === 'object' ? data : null);
  return data;
}

// PostgREST. `as` is a user's access token (RLS applies) or 'service' (bypasses RLS).
function db(table, query = '', { as, method = 'GET', body, prefer } = {}) {
  const service = as === 'service';
  return call(`/rest/v1/${table}${query ? `?${query}` : ''}`, {
    method,
    body,
    service,
    token: service ? undefined : as,
    headers: prefer ? { Prefer: prefer } : {},
  });
}

function rpc(fn, args, { as = 'service' } = {}) {
  const service = as === 'service';
  return call(`/rest/v1/rpc/${fn}`, { method: 'POST', body: args, service, token: service ? undefined : as });
}

// Returns the signed-in user for an access token, or null if it's invalid/expired
async function userFromToken(token) {
  if (!token) return null;
  try {
    const user = await call('/auth/v1/user', { token });
    return user && user.id ? user : null;
  } catch (err) {
    if (err.status === 401 || err.status === 403) return null;
    throw err;
  }
}

// Finds or creates the auth user for an applicant (email already confirmed:
// they prove ownership each time they sign in with a code or link)
async function ensureUser(email) {
  const existing = await rpc('auth_user_id_by_email', { p_email: email });
  if (existing) return existing;
  try {
    const user = await call('/auth/v1/admin/users', { method: 'POST', service: true, body: { email, email_confirm: true } });
    return user.id;
  } catch (err) {
    // Created by a parallel request in the meantime
    if (err.status === 422) {
      const again = await rpc('auth_user_id_by_email', { p_email: email });
      if (again) return again;
    }
    throw err;
  }
}

// Sends the sign-in email (6-digit code + magic link) through Supabase Auth.
// Never creates users: only applicants and staff can sign in.
async function sendSignInEmail(email, redirectTo) {
  const q = redirectTo ? `?redirect_to=${encodeURIComponent(redirectTo)}` : '';
  return call(`/auth/v1/otp${q}`, { method: 'POST', body: { email, create_user: false } });
}

const encPath = (p) => p.split('/').map(encodeURIComponent).join('/');

// Signed URL the browser can PUT a file to (valid for 2 hours)
async function signedUploadUrl(path) {
  const { url } = env();
  const data = await call(`/storage/v1/object/upload/sign/${BUCKET}/${encPath(path)}`, { method: 'POST', service: true, body: {} });
  return `${url}/storage/v1${data.url}`;
}

// Short-lived signed download URL
async function signedDownloadUrl(path, expiresIn = 600) {
  const { url } = env();
  const data = await call(`/storage/v1/object/sign/${BUCKET}/${encPath(path)}`, { method: 'POST', service: true, body: { expiresIn } });
  return `${url}/storage/v1${data.signedURL}`;
}

// Downloads an uploaded object (service role); null if it doesn't exist
async function downloadObject(path) {
  const res = await call(`/storage/v1/object/${BUCKET}/${encPath(path)}`, { service: true, raw: true });
  if (res.status === 400 || res.status === 404) return null;
  if (!res.ok) throw new SupabaseError(res.status, null);
  return { type: res.headers.get('content-type') || '', bytes: Buffer.from(await res.arrayBuffer()) };
}

async function deleteObject(path) {
  return call(`/storage/v1/object/${BUCKET}`, { method: 'DELETE', service: true, body: { prefixes: [path] } });
}

module.exports = {
  env, SupabaseError, db, rpc, userFromToken, ensureUser, sendSignInEmail,
  signedUploadUrl, signedDownloadUrl, downloadObject, deleteObject, BUCKET,
};
