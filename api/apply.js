// POST /api/apply: Stages 1-3 of the volunteer application.
// Validates everything, stores the application in Supabase (service role),
// creates the applicant's sign-in account, and emails their application ID.
const { send, fail, clean, countWords, isEmail, postJson, rateLimited } = require('./_lib/http');
const { db, ensureUser } = require('./_lib/supabase');
const { trySend } = require('./_lib/email');

const WORD_LIMIT = 150;
const MIN_FILL_MS = 3000;
const HOURS = ['1 to 2 hours', '3 to 5 hours', '6 to 8 hours', '9 to 12 hours', 'More than 12 hours'];
const GRIT = ['grounded', 'resilient', 'innovative', 'teachable'];

// Today's date in Lagos as YYYY-MM-DD
const lagosToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' }).format(new Date());

function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function validate(raw, rolesBySlug) {
  const errors = {};
  const s = (k, o) => clean(raw[k], o);

  const role = rolesBySlug.get(s('role'));
  if (!role) errors.role = 'Please choose a role.';
  else if (role.status !== 'open') errors.role = 'That role is closed right now. Please choose an open role.';

  let second = null;
  if (s('secondRole')) {
    second = rolesBySlug.get(s('secondRole'));
    if (!second || second.status !== 'open') errors.secondRole = 'Please choose an open role as your second choice.';
    else if (role && second.id === role.id) errors.secondRole = 'Your second choice can’t be the same as your first.';
  }

  const hours = s('hours');
  if (!HOURS.includes(hours)) errors.hours = 'Please choose how many hours you can commit each week.';

  const startDate = s('startDate');
  const today = lagosToday();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || Number.isNaN(Date.parse(`${startDate}T00:00:00Z`))) {
    errors.startDate = 'Please choose a start date.';
  } else if (startDate < addDays(today, -1)) {
    errors.startDate = 'Please choose a start date from today onwards.';
  } else if (startDate > addDays(today, 366)) {
    errors.startDate = 'Please choose a start date within the next year.';
  }

  if (raw.commitment !== true) errors.commitment = 'Please confirm the 6 month commitment.';

  const answers = {};
  GRIT.forEach((key) => {
    const v = s(key, { multiline: true });
    if (!v) errors[key] = 'Please answer this question.';
    else if (countWords(v) > WORD_LIMIT) errors[key] = `Please keep this to ${WORD_LIMIT} words or fewer.`;
    else if (v.length > 1500) errors[key] = 'Please keep this under 1,500 characters.';
    answers[key] = v;
  });
  if (role && role.lead_question) {
    const v = s('roleAnswer', { multiline: true });
    if (!v) errors.roleAnswer = 'Please answer the question from the Lead.';
    else if (countWords(v) > WORD_LIMIT) errors.roleAnswer = `Please keep this to ${WORD_LIMIT} words or fewer.`;
    else if (v.length > 1500) errors.roleAnswer = 'Please keep this under 1,500 characters.';
    answers.role_question = role.lead_question;
    answers.role_answer = v;
  }

  const name = s('name');
  if (name.length < 2 || name.length > 100) errors.name = 'Please enter your full name.';

  const email = s('email').toLowerCase();
  if (!isEmail(email)) errors.email = 'Please enter a valid email address.';

  const phone = s('phone');
  const digits = phone.replace(/\D/g, '').length;
  if (!/^\+?[\d\s()-]+$/.test(phone) || digits < 7 || digits > 15) errors.phone = 'Please enter a valid WhatsApp number.';

  if (raw.consent !== true) errors.consent = 'Please agree so we can keep your application.';

  return {
    errors,
    row: {
      email, name, phone,
      role_id: role && role.id,
      second_role_id: second ? second.id : null,
      hours_per_week: hours,
      start_date: startDate,
      commitment_ack: raw.commitment === true,
      consent: raw.consent === true,
      answers,
    },
    role,
  };
}

module.exports = async function handler(req, res) {
  const raw = await postJson(req, res, { limit: { name: 'apply', max: 10, windowMs: 10 * 60 * 1000 } });
  if (!raw) return;

  // Honeypot: pretend it worked so bots move on
  if (clean(raw.website)) return send(res, 200, { ok: true });
  const startedAt = Number(raw.startedAt);
  if (!Number.isFinite(startedAt) || Date.now() - startedAt < MIN_FILL_MS) {
    return fail(res, 400, 'That was quick! Please check your answers and send the form again.');
  }

  try {
    const roles = await db('roles', 'select=id,slug,title,status,lead_question', { as: 'service' });
    const { errors, row, role } = validate(raw, new Map(roles.map((r) => [r.slug, r])));
    if (Object.keys(errors).length) return fail(res, 422, 'Please check the highlighted answers.', { fields: errors });

    if (rateLimited(`apply-email:${row.email}`, 3, 60 * 60 * 1000)) {
      return fail(res, 429, 'Too many attempts. Please wait a while and try again.');
    }

    // One application in progress per email address
    const open = await db('applications',
      `select=id&email=eq.${encodeURIComponent(row.email)}&stage=neq.decision_made&limit=1`, { as: 'service' });
    if (open.length) {
      return fail(res, 409, 'There’s already an application in progress for this email address. Sign in to the applicant portal to follow it.');
    }

    const userId = await ensureUser(row.email);
    const [app] = await db('applications', 'select=id,application_id,name,email', {
      as: 'service', method: 'POST', body: { ...row, user_id: userId }, prefer: 'return=representation',
    });

    const emailSent = await trySend('confirmation', app, { roleTitle: role.title });
    return send(res, 200, { ok: true, applicationId: app.application_id, emailSent });
  } catch (err) {
    console.error('Volunteer application failed:', err.message);
    if (err.code === 'CONFIG') return fail(res, 500, 'Applications aren’t open on the website yet.');
    return fail(res, 502, 'We couldn’t save your application just now. Your answers are still here; please try again.');
  }
};
