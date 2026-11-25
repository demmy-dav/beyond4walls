// Stage emails for volunteer applicants, sent through the Resend REST API.
// Every value from an applicant or reviewer is escaped before it goes into HTML.
const { escapeHtml } = require('./http');

const FROM = 'Beyond4walls <hello@beyond4wallsed.org>';
const REPLY_TO = 'hello@beyond4wallsed.org';

const siteUrl = () => (process.env.SITE_URL || 'https://www.beyond4wallsed.org').replace(/\/+$/, '');

function lagosTime(date) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Lagos', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(new Date(date)) + ' (Lagos time, WAT)';
}

const firstName = (name) => String(name).trim().split(/\s+/)[0];

// paragraphs: array of plain strings (escaped here) or { html } for trusted markup we build
function layout({ title, paragraphs, cta }) {
  const body = paragraphs.map((p) => `<p style="margin:0 0 16px;">${typeof p === 'string' ? escapeHtml(p) : p.html}</p>`).join('');
  const button = cta
    ? `<p style="margin:24px 0;"><a href="${escapeHtml(cta.href)}" style="display:inline-block;padding:12px 22px;background:#228B22;color:#fff;border-radius:8px;font-weight:700;text-decoration:none;">${escapeHtml(cta.label)}</a></p>`
    : '';
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#F4F8F2;font-family:Manrope,Segoe UI,Arial,sans-serif;font-size:16px;line-height:1.65;color:#1A1A1A;">
<div style="max-width:560px;margin:0 auto;padding:28px;background:#fff;border:1px solid #E6ECE4;border-radius:12px;">
<p style="margin:0 0 16px;font-family:Sora,Segoe UI,Arial,sans-serif;font-size:20px;font-weight:700;color:#0E2814;">${escapeHtml(title)}</p>
${body}${button}
<p style="margin:24px 0 0;">The Beyond4walls team</p>
</div></body></html>`;
  const text = [
    title, '',
    ...paragraphs.map((p) => (typeof p === 'string' ? p : p.text)).flatMap((p) => [p, '']),
    ...(cta ? [`${cta.label}: ${cta.href}`, ''] : []),
    'The Beyond4walls team',
  ].join('\n');
  return { html, text };
}

const idLine = (app) => ({
  html: `Your application ID is <strong>${escapeHtml(app.application_id)}</strong>. Please quote it whenever you contact us.`,
  text: `Your application ID is ${app.application_id}. Please quote it whenever you contact us.`,
});

const portal = () => ({ href: `${siteUrl()}/portal`, label: 'Open your applicant portal' });

const PRACTICE_NOTE = 'Challenges are always practice tasks. We never use an applicant’s submission as real work for Beyond4walls.';

const templates = {
  confirmation: (app, { roleTitle }) => ({
    subject: `Application received: ${app.application_id}`,
    ...layout({
      title: `Thank you, ${firstName(app.name)}. We have your application.`,
      paragraphs: [
        `You applied for ${roleTitle}.`,
        idLine(app),
        'You can follow your application in the applicant portal. Sign in with this email address; we’ll send you a one-time code, so there’s no password to remember.',
        'If you move forward, your role challenge comes next, and you’ll have 72 hours to complete it from the moment it’s released.',
      ],
      cta: portal(),
    }),
  }),

  under_review: (app) => ({
    subject: `Your application is under review: ${app.application_id}`,
    ...layout({
      title: 'Your application is under review',
      paragraphs: [
        `Hi ${firstName(app.name)}, our team has started reviewing your answers. Every application is read by at least two people.`,
        idLine(app),
      ],
      cta: portal(),
    }),
  }),

  challenge_released: (app, { challengeTitle, dueAt }) => ({
    subject: `Your role challenge is ready: ${app.application_id}`,
    ...layout({
      title: 'Your role challenge is ready',
      paragraphs: [
        `Hi ${firstName(app.name)}, well done on making it to Stage 4. Your challenge, “${challengeTitle}”, is now open in your applicant portal.`,
        {
          html: `You have 72 hours. <strong>Deadline: ${escapeHtml(lagosTime(dueAt))}</strong>. The portal locks submissions at the deadline.`,
          text: `You have 72 hours. Deadline: ${lagosTime(dueAt)}. The portal locks submissions at the deadline.`,
        },
        PRACTICE_NOTE,
        idLine(app),
      ],
      cta: { href: `${siteUrl()}/challenge`, label: 'Open your challenge' },
    }),
  }),

  submission_received: (app, { submittedAt }) => ({
    subject: `Challenge submission received: ${app.application_id}`,
    ...layout({
      title: 'We have your challenge submission',
      paragraphs: [
        `Hi ${firstName(app.name)}, your submission arrived on ${lagosTime(submittedAt)}. It’s now locked, and our team will review it.`,
        PRACTICE_NOTE,
        idLine(app),
      ],
      cta: portal(),
    }),
  }),

  interview_scheduled: (app, { interviewAt }) => ({
    subject: `Your interview is scheduled: ${app.application_id}`,
    ...layout({
      title: 'Let’s talk',
      paragraphs: [
        `Hi ${firstName(app.name)}, we’d love to meet you. Your interview is on ${lagosTime(interviewAt)}.`,
        'It’s a 15 to 20 minute online conversation with the Lead of the role and one other team member. It’s a real conversation, not an interrogation. We’ll send the meeting link before then.',
        idLine(app),
      ],
      cta: portal(),
    }),
  }),

  decision: (app, { decision }) => (decision === 'offer'
    ? {
      subject: `Welcome to Beyond4walls: ${app.application_id}`,
      ...layout({
        title: `Congratulations, ${firstName(app.name)}!`,
        paragraphs: [
          'We’re delighted to offer you a place on the team.',
          'Next, we’ll send a short commitment agreement confirming the 6 month minimum. Your first 30 days are a trial period, and at the end your Lead will hold a warm check-in to make sure it’s a good fit on both sides.',
          idLine(app),
        ],
        cta: portal(),
      }),
    }
    : {
      subject: `Your Beyond4walls application: ${app.application_id}`,
      ...layout({
        title: `Thank you, ${firstName(app.name)}`,
        paragraphs: [
          'Thank you for the time and honesty you put into your application. After careful review, we won’t be moving forward with it this time.',
          'This isn’t a judgement of your worth. You’re always welcome to stay connected with Beyond4walls and apply again in future.',
          idLine(app),
        ],
      }),
    }),
};

async function sendStageEmail(kind, app, data = {}) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY is not set');
  const { subject, html, text } = templates[kind](app, data);
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [app.email], reply_to: REPLY_TO, subject, html, text }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    const info = await res.json().catch(() => ({}));
    throw new Error(`Resend ${res.status}${info.name ? ` (${info.name})` : ''}`);
  }
}

// Emails are best-effort: the stage change has already happened. Logs only the
// kind and error, never the address or the content.
async function trySend(kind, app, data) {
  try {
    await sendStageEmail(kind, app, data);
    return true;
  } catch (err) {
    console.error(`Stage email "${kind}" failed:`, err.message);
    return false;
  }
}

module.exports = { trySend, lagosTime, siteUrl, PRACTICE_NOTE };
