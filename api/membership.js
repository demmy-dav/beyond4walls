// POST /api/membership
// Validates a membership application, emails it to the team (MEMBERSHIP_TO_EMAIL)
// and sends the applicant a confirmation, both through the Resend REST API.
// Plain Node (no framework): works as a Vercel function and with a bare http server.

const RESEND_URL = 'https://api.resend.com/emails';
const FROM = 'Beyond4walls <hello@beyond4wallsed.org>';

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
    const info = await res.json().catch(() => ({}));
    // Only the status and Resend's error name: never the key or the applicant's details
    throw new Error(`Resend ${res.status}${info.name ? ` (${info.name})` : ''}`);
  }
  return res.json().catch(() => ({}));
}

// ---- handler --------------------------------------------------------------

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return send(res, 405, { ok: false, error: 'Method not allowed.' });
  }

  const type = String(req.headers['content-type'] || '').toLowerCase();
  if (!type.startsWith('application/json')) {
    return send(res, 415, { ok: false, error: 'Please send the form as JSON.' });
  }

  // Only accept posts from our own pages (browsers always send Origin on fetch POST)
  const origin = req.headers.origin;
  if (origin) {
    let originHost = '';
    try { originHost = new URL(origin).host; } catch (_) { /* invalid origin */ }
    if (originHost !== req.headers.host) {
      return send(res, 403, { ok: false, error: 'This form can only be sent from the Beyond4walls website.' });
    }
  }

  if (rateLimited(clientIp(req))) {
    res.setHeader('Retry-After', String(Math.ceil(RATE_LIMIT.windowMs / 1000)));
    return send(res, 429, { ok: false, error: 'Too many attempts. Please wait a few minutes and try again.' });
  }

  let raw;
  try {
    raw = await readJson(req);
  } catch (err) {
    if (err.code === 'TOO_LARGE') return send(res, 413, { ok: false, error: 'That submission is too large.' });
    return send(res, 400, { ok: false, error: 'We couldn’t read that submission. Please try again.' });
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return send(res, 400, { ok: false, error: 'We couldn’t read that submission. Please try again.' });
  }
  if (JSON.stringify(raw).length > MAX_BODY_BYTES) {
    return send(res, 413, { ok: false, error: 'That submission is too large.' });
  }

  // Honeypot: real visitors never see this field. Pretend it worked so bots move on.
  if (clean(raw.website)) return send(res, 200, { ok: true });

  // Time on page: the form records when it was opened
  const startedAt = Number(raw.startedAt);
  if (!Number.isFinite(startedAt) || Date.now() - startedAt < MIN_FILL_MS) {
    return send(res, 400, { ok: false, error: 'That was quick! Please check your answers and send the form again.' });
  }

  const { data, errors } = validate(raw);
  if (Object.keys(errors).length) {
    return send(res, 422, { ok: false, error: 'Please check the highlighted fields.', fields: errors });
  }

  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.MEMBERSHIP_TO_EMAIL;
  if (!apiKey || !to) {
    console.error('Membership form is not configured: set RESEND_API_KEY and MEMBERSHIP_TO_EMAIL.');
    return send(res, 500, { ok: false, error: 'Our membership form isn’t working right now.' });
  }

  const submittedAt = lagosTime(new Date());
  const team = teamEmail(data, submittedAt);
  try {
    await sendEmail(apiKey, {
      from: FROM,
      to: [to],
      reply_to: data.email,
      subject: `New member: ${data.fullName} (${GOING_FURTHER[data.goingFurther][1]})`,
      html: team.html,
      text: team.text,
    });
  } catch (err) {
    console.error('Membership email to the team failed:', err.message);
    return send(res, 502, { ok: false, error: 'We couldn’t send your application just now.' });
  }

  // The team has it; a failed confirmation shouldn't make the applicant resend
  let confirmationSent = true;
  try {
    const welcome = confirmationEmail(data);
    await sendEmail(apiKey, {
      from: FROM,
      to: [data.email],
      subject: 'Welcome to the Beyond4walls family',
      html: welcome.html,
      text: welcome.text,
    });
  } catch (err) {
    confirmationSent = false;
    console.error('Membership confirmation email failed:', err.message);
  }

  return send(res, 200, { ok: true, confirmationSent });
};

// Exposed for local tests
module.exports._test = { validate, escapeHtml, countWords };
