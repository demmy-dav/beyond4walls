// POST /api/membership
// Validates a membership application, saves it to Supabase (when configured),
// then emails it to the team (MEMBERSHIP_TO_EMAIL) and sends the applicant a
// confirmation, both through the Resend REST API. A stored application counts
// as a success even if the team email fails: the row is flagged for retry.
// Plain Node (no framework): works as a Vercel function and with a bare http server.
//
// Env vars:
//   RESEND_API_KEY, MEMBERSHIP_TO_EMAIL          email delivery
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY      durable storage (table membership_applications)
// At least one of the two groups must be complete or the form returns 500.

const RESEND_URL = 'https://api.resend.com/emails';
const FROM = 'Beyond4walls <hello@beyond4wallsed.org>';
const TABLE = 'membership_applications';

// Sites allowed to post the form. Same-host requests (vercel dev, any domain
// attached to this deployment) are also allowed; see originAllowed().
const ALLOWED_ORIGINS = new Set([
  'https://beyond4wallsed.org',
  'https://www.beyond4wallsed.org',
]);
// This project's Vercel previews only (team scope "leadwayvictorys-2639"), e.g.
// beyond4walls-3we8ahmew-leadwayvictorys-2639.vercel.app and
// beyond4walls-git-<branch>-leadwayvictorys-2639.vercel.app
const PREVIEW_HOST = /^beyond4walls(?:-[a-z0-9-]+)?-leadwayvictorys-2639\.vercel\.app$/;

const MIN_FILL_MS = 5000;          // faster than this is a bot
const MAX_BODY_BYTES = 20 * 1024;
const RATE_LIMIT = { max: 10, windowMs: 10 * 60 * 1000 }; // per IP, per warm instance (campuses share IPs)
const WHY_WORD_LIMIT = 50;

const NG_STATES = [
  'Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue', 'Borno',
  'Cross River', 'Delta', 'Ebonyi', 'Edo', 'Ekiti', 'Enugu', 'FCT (Abuja)', 'Gombe',
  'Imo', 'Jigawa', 'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Kogi', 'Kwara', 'Lagos',
  'Nasarawa', 'Niger', 'Ogun', 'Ondo', 'Osun', 'Oyo', 'Plateau', 'Rivers', 'Sokoto',
  'Taraba', 'Yobe', 'Zamfara', 'Outside Nigeria',
];
const GENDERS = ['Female', 'Male', 'Prefer not to say'];
const AGE_RANGES = ['Under 18', '18-24', '25-34', '35+'];
const ROLES = ['Student', 'Graduate or NYSC', 'Working professional', 'Entrepreneur', 'Other'];
const INTERESTS = [
  'Discover - research and new ideas',
  'Build - designing initiatives',
  'Partnerships and funding',
  'Communications and storytelling',
  'Programs and events',
  'Campus leadership',
  'Tech and digital',
];
// value -> [label in the email table, short label for the subject]
const GOING_FURTHER = {
  member: ['Just a member for now', 'Member'],
  campus_leader: ["I'd like to lead on my campus (Campus Leader)", 'Campus Leader'],
  volunteer: ["I'd like to volunteer on the team", 'Volunteer'],
  partner: ["I'd like to partner or sponsor as an organisation", 'Partner or sponsor'],
};

// ---- helpers --------------------------------------------------------------

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

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

const countWords = (s) => (s.trim() ? s.trim().split(/\s+/).length : 0);

// One JSON line per event, easy to filter in Vercel logs ("api/membership").
// Never pass secrets or applicant details in `details`.
function log(level, reason, details = {}) {
  const line = JSON.stringify({ fn: 'api/membership', level, reason, ...details });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

// Strip anything that could be an email address or API key from third-party
// error text before it is logged, and keep it short.
function redact(value) {
  return String(value == null ? '' : value)
    .replace(/[^\s@<>"'(),;:]+@[^\s@<>"'(),;:]+/g, '[email]')
    .replace(/\bre_[A-Za-z0-9_]{8,}/g, '[key]')
    .replace(/\beyJ[A-Za-z0-9._-]{20,}/g, '[token]')
    .slice(0, 500);
}

// Network/timeout errors have no HTTP status; describe them without the request
function describeError(err) {
  if (err && err.status) return { status: err.status, ...err.info };
  return {
    status: null,
    errorName: err && err.name,
    errorCode: err && err.cause && err.cause.code,
    message: redact(err && err.message),
  };
}

function originAllowed(origin, host) {
  let url;
  try { url = new URL(origin); } catch (_) { return false; }
  if (ALLOWED_ORIGINS.has(url.origin)) return true;
  if (url.protocol === 'https:' && !url.port) {
    if (PREVIEW_HOST.test(url.hostname)) return true;
    // This deployment's own URLs, set by Vercel at runtime
    if ([process.env.VERCEL_URL, process.env.VERCEL_BRANCH_URL].includes(url.hostname)) return true;
  }
  return url.host === host;
}

const missingEnv = (names) => names.filter((n) => !process.env[n]);
let storageNoticeLogged = false;

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  return (typeof fwd === 'string' && fwd.split(',')[0].trim())
    || req.headers['x-real-ip']
    || (req.socket && req.socket.remoteAddress)
    || 'unknown';
}

// Light, best-effort limit: memory is per warm function instance, so this slows
// down a single noisy client rather than guaranteeing a global cap.
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < RATE_LIMIT.windowMs);
  if (recent.length >= RATE_LIMIT.max) {
    hits.set(ip, recent);
    return true;
  }
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear(); // keep memory bounded
  return false;
}

// Vercel pre-parses JSON into req.body; a bare http server doesn't.
async function readJson(req) {
  if (req.body !== undefined) {
    if (typeof req.body === 'string') return JSON.parse(req.body);
    if (Buffer.isBuffer(req.body)) return JSON.parse(req.body.toString('utf8'));
    return req.body;
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error('too large'), { code: 'TOO_LARGE' });
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

// ---- validation -----------------------------------------------------------

function validate(raw) {
  const errors = {};
  const str = (key, opts) => clean(raw[key], opts);

  const data = {
    fullName: str('fullName'),
    email: str('email').toLowerCase(),
    phone: str('phone'),
    gender: str('gender'),
    ageRange: str('ageRange'),
    state: str('state'),
    city: str('city'),
    role: str('role'),
    organisation: str('organisation'),
    level: str('level'),
    why: str('why', { multiline: true }),
    interests: Array.isArray(raw.interests) ? raw.interests.map((v) => clean(v)) : [],
    skills: str('skills', { multiline: true }),
    goingFurther: str('goingFurther'),
    consent: raw.consent === true,
    updates: raw.updates === true,
  };

  const required = (key, label) => { if (!data[key]) errors[key] = `Please enter your ${label}.`; };
  const maxLen = (key, n) => { if (data[key].length > n) errors[key] = `Please keep this under ${n} characters.`; };
  const oneOf = (key, list, msg) => { if (data[key] && !list.includes(data[key])) errors[key] = msg; };

  required('fullName', 'full name');
  maxLen('fullName', 100);
  if (data.fullName && data.fullName.length < 2) errors.fullName = 'Please enter your full name.';

  required('email', 'email address');
  if (data.email && (data.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(data.email))) {
    errors.email = 'Please enter a valid email address, like name@example.com.';
  }

  required('phone', 'WhatsApp number');
  const digits = data.phone.replace(/\D/g, '');
  if (data.phone && (!/^\+?[\d\s()-]+$/.test(data.phone) || digits.length < 7 || digits.length > 15)) {
    errors.phone = 'Please enter a valid WhatsApp number, like +234 801 234 5678.';
  }

  oneOf('gender', GENDERS, 'Please choose an option from the list.');

  if (!data.ageRange) errors.ageRange = 'Please choose your age range.';
  oneOf('ageRange', AGE_RANGES, 'Please choose your age range.');

  if (!data.state) errors.state = 'Please choose your state.';
  oneOf('state', NG_STATES, 'Please choose your state from the list.');

  required('city', 'city');
  maxLen('city', 80);

  if (!data.role) errors.role = 'Please tell us what you do.';
  oneOf('role', ROLES, 'Please choose one of the options.');

  maxLen('organisation', 120);
  if (data.role !== 'Student') data.level = '';
  maxLen('level', 120);

  if (!data.why) errors.why = 'Please tell us what brings you to Beyond4walls.';
  else if (countWords(data.why) > WHY_WORD_LIMIT) errors.why = `Please keep this to ${WHY_WORD_LIMIT} words or fewer.`;
  else maxLen('why', 600);

  const interests = [...new Set(data.interests)];
  if (interests.some((v) => !INTERESTS.includes(v))) errors.interests = 'Please choose from the listed areas.';
  data.interests = INTERESTS.filter((v) => interests.includes(v)); // keep form order

  maxLen('skills', 1000);

  if (!GOING_FURTHER[data.goingFurther]) errors.goingFurther = 'Please choose how you’d like to be involved.';

  if (!data.consent) errors.consent = 'Please agree so we can store your details and contact you.';

  return { data, errors };
}

// ---- emails ---------------------------------------------------------------

function lagosTime(date) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Lagos', dateStyle: 'full', timeStyle: 'short',
  }).format(date) + ' (WAT)';
}

function teamEmail(d, submittedAt) {
  const rows = [
    ['Full name', d.fullName],
    ['Email', d.email],
    ['WhatsApp', d.phone],
    ['Gender', d.gender || '-'],
    ['Age range', d.ageRange],
    ['State', d.state],
    ['City', d.city],
    ['I am a', d.role],
    ['School or organisation', d.organisation || '-'],
    ...(d.role === 'Student' ? [['Level or course', d.level || '-']] : []),
    ['What brings them to Beyond4walls', d.why],
    ['Areas of interest', d.interests.length ? d.interests.join(', ') : '-'],
    ['Skills they could contribute', d.skills || '-'],
    ['Going further', GOING_FURTHER[d.goingFurther][0]],
    ['Consent to store and contact', 'Yes'],
    ['Updates by WhatsApp and email', d.updates ? 'Yes' : 'No'],
    ['Submitted', submittedAt],
  ];

  const cell = 'padding:10px 14px;border-bottom:1px solid #E6ECE4;vertical-align:top;text-align:left;';
  const htmlRows = rows.map(([k, v]) => (
    `<tr><th scope="row" style="${cell}width:38%;color:#0E2814;font-weight:600;">${escapeHtml(k)}</th>` +
    `<td style="${cell}color:#1A1A1A;white-space:pre-wrap;">${escapeHtml(v)}</td></tr>`
  )).join('');

  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#F4F8F2;font-family:Manrope,Segoe UI,Arial,sans-serif;font-size:15px;line-height:1.55;">
<div style="max-width:640px;margin:0 auto;background:#fff;border:1px solid #E6ECE4;border-radius:12px;overflow:hidden;">
<div style="padding:18px 20px;background:#228B22;color:#fff;font-family:Sora,Segoe UI,Arial,sans-serif;font-size:18px;font-weight:700;">New membership application</div>
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">${htmlRows}</table>
<p style="margin:0;padding:14px 20px;color:#555;font-size:13px;">Reply to this email to answer ${escapeHtml(d.fullName)} directly.</p>
</div></body></html>`;

  const text = rows.map(([k, v]) => `${k}: ${v}`).join('\n');
  return { html, text };
}

function confirmationEmail(d) {
  const firstName = d.fullName.split(' ')[0];
  const wantsTeam = d.goingFurther === 'volunteer' || d.goingFurther === 'campus_leader';
  // TODO: when the volunteer page (`volunteer-application` branch) is live at
  // https://www.beyond4wallsed.org/volunteer, link it here for these applicants.
  const teamLine = 'Our team will contact you about next steps.';

  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#F4F8F2;font-family:Manrope,Segoe UI,Arial,sans-serif;font-size:16px;line-height:1.65;color:#1A1A1A;">
<div style="max-width:560px;margin:0 auto;padding:28px;background:#fff;border:1px solid #E6ECE4;border-radius:12px;">
<p style="margin:0 0 16px;">Hi ${escapeHtml(firstName)},</p>
<p style="margin:0 0 16px;font-family:Sora,Segoe UI,Arial,sans-serif;font-size:20px;font-weight:700;color:#0E2814;">Welcome to the family.</p>
<p style="margin:0 0 16px;">Nobody here works under anyone; we work with each other. We'll be in touch soon.</p>
${wantsTeam ? `<p style="margin:0 0 16px;">${teamLine}</p>` : ''}
<p style="margin:24px 0 0;">The Beyond4walls team</p>
</div></body></html>`;

  const text = [
    `Hi ${firstName},`,
    '',
    'Welcome to the family. Nobody here works under anyone; we work with each other. We\'ll be in touch soon.',
    ...(wantsTeam ? ['', teamLine] : []),
    '',
    'The Beyond4walls team',
  ].join('\n');

  return { html, text };
}

async function sendEmail(apiKey, payload) {
  const res = await fetch(RESEND_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    let info = {};
    try { info = JSON.parse(body); } catch (_) { /* not JSON */ }
    // Status, Resend's error name and its message (redacted): never the key or applicant details
    throw Object.assign(new Error(`Resend ${res.status}${info.name ? ` (${info.name})` : ''}`), {
      status: res.status,
      info: { resendError: info.name || null, resendMessage: redact(info.message || body) },
    });
  }
  return res.json().catch(() => ({}));
}

// ---- storage (Supabase PostgREST, service role: server only) --------------

function storageConfig() {
  const url = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url, key } : null;
}

async function supabase(cfg, path, { method, body, prefer }) {
  const res = await fetch(`${cfg.url}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: cfg.key,
      Authorization: `Bearer ${cfg.key}`,
      'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  const text = await res.text().catch(() => '');
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_) { data = null; }
  if (!res.ok) {
    throw Object.assign(new Error(`Supabase ${res.status}`), {
      status: res.status,
      info: {
        supabaseCode: (data && data.code) || null,
        supabaseMessage: redact((data && (data.message || data.hint)) || text),
      },
    });
  }
  return data;
}

async function storeSubmission(cfg, d) {
  const rows = await supabase(cfg, `${TABLE}?select=id`, {
    method: 'POST',
    prefer: 'return=representation',
    body: {
      full_name: d.fullName,
      email: d.email,
      phone: d.phone,
      gender: d.gender || null,
      age_range: d.ageRange,
      state: d.state,
      city: d.city,
      role: d.role,
      organisation: d.organisation || null,
      level: d.level || null,
      why: d.why,
      interests: d.interests,
      skills: d.skills || null,
      going_further: d.goingFurther,
      consent: d.consent,
      updates: d.updates,
    },
  });
  return rows && rows[0] && rows[0].id;
}

async function updateSubmission(cfg, id, fields) {
  try {
    await supabase(cfg, `${TABLE}?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', body: fields });
  } catch (err) {
    log('error', 'storage_update_failed', { submissionId: id, ...describeError(err) });
  }
}

// ---- handler --------------------------------------------------------------

module.exports = async function handler(req, res) {
  const requestId = req.headers['x-vercel-id'] || undefined; // matches the Vercel log entry

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return send(res, 405, { ok: false, error: 'Method not allowed.' });
  }

  const type = String(req.headers['content-type'] || '').toLowerCase();
  if (!type.startsWith('application/json')) {
    log('warn', 'bad_content_type', { requestId, contentType: type.slice(0, 80) });
    return send(res, 415, { ok: false, error: 'Please send the form as JSON.' });
  }

  // Only accept posts from our own pages (browsers always send Origin on fetch POST)
  const origin = req.headers.origin;
  if (origin && !originAllowed(origin, req.headers.host)) {
    log('warn', 'origin_rejected', { requestId, origin: String(origin).slice(0, 200), host: req.headers.host });
    return send(res, 403, { ok: false, error: 'This form can only be sent from the Beyond4walls website.' });
  }

  if (rateLimited(clientIp(req))) {
    log('warn', 'rate_limited', { requestId, max: RATE_LIMIT.max, windowMs: RATE_LIMIT.windowMs });
    res.setHeader('Retry-After', String(Math.ceil(RATE_LIMIT.windowMs / 1000)));
    return send(res, 429, { ok: false, error: 'Too many attempts. Please wait a few minutes and try again.' });
  }

  let raw;
  try {
    raw = await readJson(req);
  } catch (err) {
    if (err.code === 'TOO_LARGE') {
      log('warn', 'body_too_large', { requestId });
      return send(res, 413, { ok: false, error: 'That submission is too large.' });
    }
    log('warn', 'body_unreadable', { requestId, errorName: err.name });
    return send(res, 400, { ok: false, error: 'We couldn’t read that submission. Please try again.' });
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    log('warn', 'body_not_object', { requestId });
    return send(res, 400, { ok: false, error: 'We couldn’t read that submission. Please try again.' });
  }
  if (JSON.stringify(raw).length > MAX_BODY_BYTES) {
    log('warn', 'body_too_large', { requestId });
    return send(res, 413, { ok: false, error: 'That submission is too large.' });
  }

  // Honeypot: real visitors never see this field. Pretend it worked so bots move on.
  if (clean(raw.website)) {
    log('info', 'honeypot_filled', { requestId });
    return send(res, 200, { ok: true });
  }

  // Time on page: the form records when it was opened
  const startedAt = Number(raw.startedAt);
  const elapsedMs = Date.now() - startedAt;
  if (!Number.isFinite(startedAt) || elapsedMs < MIN_FILL_MS) {
    log('warn', 'too_fast', { requestId, elapsedMs: Number.isFinite(elapsedMs) ? elapsedMs : null, minMs: MIN_FILL_MS });
    return send(res, 400, { ok: false, error: 'That was quick! Please check your answers and send the form again.' });
  }

  const { data, errors } = validate(raw);
  if (Object.keys(errors).length) {
    log('info', 'validation_failed', { requestId, fields: Object.keys(errors) }); // field names only
    return send(res, 422, { ok: false, error: 'Please check the highlighted fields.', fields: errors });
  }

  // ---- configuration ----
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.MEMBERSHIP_TO_EMAIL;
  const store = storageConfig();
  const emailMissing = missingEnv(['RESEND_API_KEY', 'MEMBERSHIP_TO_EMAIL']);
  const storageMissing = missingEnv(['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']);
  const vercelEnv = process.env.VERCEL_ENV || 'unknown';
  if (emailMissing.length) log('error', 'email_not_configured', { requestId, vercelEnv, missing: emailMissing });
  // Storage is optional: without it the form runs email-only. Note it once per instance.
  if (storageMissing.length && !storageNoticeLogged) {
    storageNoticeLogged = true;
    log('info', 'storage_not_configured', { requestId, vercelEnv, missing: storageMissing, mode: 'email_only' });
  }
  if (emailMissing.length && !store) {
    return send(res, 500, { ok: false, error: 'Our membership form isn’t working right now.' });
  }

  // ---- 1. save first, so a failed email never loses a member ----
  let submissionId = null;
  if (store) {
    try {
      submissionId = await storeSubmission(store, data);
      log('info', 'stored', { requestId, submissionId });
    } catch (err) {
      log('error', 'storage_failed', { requestId, ...describeError(err) });
    }
  }

  // ---- 2. email the team ----
  let teamSent = false;
  let teamFailure = null;
  if (!emailMissing.length) {
    const team = teamEmail(data, lagosTime(new Date()));
    try {
      await sendEmail(apiKey, {
        from: FROM,
        to: [to],
        reply_to: data.email,
        subject: `New member: ${data.fullName} (${GOING_FURTHER[data.goingFurther][1]})`,
        html: team.html,
        text: team.text,
      });
      teamSent = true;
    } catch (err) {
      teamFailure = describeError(err);
      log('error', 'team_email_failed', { requestId, submissionId, stored: !!submissionId, ...teamFailure });
    }
  } else {
    teamFailure = { reason: 'email_not_configured', missing: emailMissing };
  }

  if (!submissionId && !teamSent) {
    // Nothing kept anywhere: the applicant must try again
    log('error', 'submission_lost', { requestId, storageConfigured: !!store, emailConfigured: !emailMissing.length });
    return send(res, 502, { ok: false, error: 'We couldn’t send your application just now.' });
  }

  if (submissionId && !teamSent) log('warn', 'needs_retry', { requestId, submissionId });

  // ---- 3. confirmation to the applicant (failure never fails the request) ----
  let confirmationSent = false;
  if (apiKey) {
    try {
      const welcome = confirmationEmail(data);
      await sendEmail(apiKey, {
        from: FROM,
        to: [data.email],
        subject: 'Welcome to the Beyond4walls family',
        html: welcome.html,
        text: welcome.text,
      });
      confirmationSent = true;
    } catch (err) {
      log('error', 'confirmation_email_failed', { requestId, submissionId, ...describeError(err) });
    }
  }
  // One update records the outcome; rows left 'pending' (function died mid-way) are retried too
  if (submissionId) {
    await updateSubmission(store, submissionId, {
      ...(teamSent
        ? { team_email_status: 'sent', team_email_sent_at: new Date().toISOString(), team_email_attempts: 1 }
        : { team_email_status: 'failed', team_email_attempts: emailMissing.length ? 0 : 1, team_email_error: redact(JSON.stringify(teamFailure)) }),
      confirmation_sent: confirmationSent,
    });
  }

  return send(res, 200, { ok: true, confirmationSent });
};

// Exposed for local tests
module.exports._test = { validate, escapeHtml, countWords, originAllowed, redact };
