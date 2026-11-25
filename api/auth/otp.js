// POST /api/auth/otp: email a one-time sign-in code and magic link.
// Rate-limited per IP and per address. The reply is the same whether or not the
// address has an application, so it can't be used to discover who applied.
const { send, fail, clean, isEmail, postJson, rateLimited } = require('../_lib/http');
const { sendSignInEmail } = require('../_lib/supabase');
const { siteUrl } = require('../_lib/email');

const PAGES = { portal: '/portal', challenge: '/challenge', admin: '/admin' };

module.exports = async function handler(req, res) {
  const raw = await postJson(req, res, { limit: { name: 'otp-ip', max: 10, windowMs: 10 * 60 * 1000 } });
  if (!raw) return;

  const email = clean(raw.email).toLowerCase();
  if (!isEmail(email)) return fail(res, 422, 'Please enter a valid email address.', { fields: { email: 'Please enter a valid email address.' } });

  if (rateLimited(`otp-email:${email}`, 3, 10 * 60 * 1000)) {
    return fail(res, 429, 'We’ve already sent a few codes to this address. Please wait 10 minutes and try again.');
  }

  const next = PAGES[clean(raw.next)] || PAGES.portal;
  try {
    await sendSignInEmail(email, `${siteUrl()}${next}`);
  } catch (err) {
    if (err.status === 429) return fail(res, 429, 'Too many sign-in emails. Please wait a few minutes and try again.');
    // Unknown address (sign-ups are off) or a delivery problem: same reply either way
    if (err.status >= 500 || err.code === 'CONFIG') console.error('Sign-in email failed:', err.message);
  }
  return send(res, 200, {
    ok: true,
    message: 'If that email has an application with us, we’ve sent it a 6-digit code and a sign-in link.',
  });
};
