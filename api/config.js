// GET /api/config: the public Supabase settings the browser needs to sign in.
// The anon key is designed to be public (row level security protects the data);
// the service role key is never sent.
const { send, fail } = require('./_lib/http');
const { env } = require('./_lib/supabase');

module.exports = function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return fail(res, 405, 'Method not allowed.');
  }
  try {
    const { url, anon } = env();
    return send(res, 200, { ok: true, supabaseUrl: url, supabaseAnonKey: anon });
  } catch (err) {
    console.error(err.message);
    return fail(res, 500, 'The applicant portal isn’t set up yet.');
  }
};
