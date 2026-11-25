// Applicant portal: sign in by email code, then see the application ID and the
// status tracker (the Website Guide's five statuses).
(function () {
  const root = document.getElementById('portal-root');
  if (!root) return;
  const { el, api, lagosTime, signOut, requireSignIn } = b4w;

  const STAGES = [
    { key: 'received', label: 'Received' },
    { key: 'under_review', label: 'Under review' },
    { key: 'challenge_released', label: 'Challenge released' },
    { key: 'interview_scheduled', label: 'Interview scheduled' },
    { key: 'decision_made', label: 'Decision made' },
  ];

  function tracker(stage) {
    const index = STAGES.findIndex((s) => s.key === stage);
    const list = el('ol', 'tracker');
    list.setAttribute('aria-label', 'Application status');
    STAGES.forEach((s, i) => {
      const item = el('li', `tracker__step${i < index ? ' is-done' : ''}${i === index ? ' is-current' : ''}`);
      if (i === index) item.setAttribute('aria-current', 'step');
      const dot = el('span', 'tracker__dot', i < index ? '✓' : String(i + 1));
      dot.setAttribute('aria-hidden', 'true');
      const label = el('span', 'tracker__label', s.label);
      const sr = el('span', 'visually-hidden', i < index ? ' (done)' : i === index ? ' (current status)' : ' (to come)');
      item.append(dot, label, sr);
      list.append(item);
    });
    return list;
  }

  function stageDetail(data) {
    const { application: app, challenge, submission } = data;
    const box = el('div', 'portal-next');
    const h = el('h3', 'portal-next__title');
    const p = (text) => box.append(el('p', null, text));
    box.append(h);

    switch (app.stage) {
      case 'received':
        h.textContent = 'We have your application';
        p('Our team will start reviewing it soon. Every application is read by at least two people.');
        break;
      case 'under_review':
        h.textContent = 'Your application is under review';
        p('If you move forward, your role challenge comes next. We’ll email you when it’s released, and you’ll have 72 hours to complete it.');
        break;
      case 'challenge_released': {
        h.textContent = submission ? 'Challenge submitted' : 'Your role challenge is open';
        if (submission) {
          p(`We received your submission on ${lagosTime(submission.submittedAt)}. Our team will review it.`);
        } else if (challenge) {
          const due = Date.parse(challenge.dueAt);
          const now = Date.now() + data.clockOffset;
          p(due > now
            ? `Deadline: ${lagosTime(challenge.dueAt)}.`
            : `The deadline passed on ${lagosTime(challenge.dueAt)}, so submissions are closed.`);
        }
        const link = el('a', 'btn btn--primary', submission ? 'View your challenge' : 'Open your challenge');
        link.href = '/challenge';
        box.append(link);
        break;
      }
      case 'interview_scheduled':
        h.textContent = 'Your interview is scheduled';
        p(app.interviewAt ? `${lagosTime(app.interviewAt)}.` : 'We’ll confirm the time by email.');
        p('It’s a 15 to 20 minute online conversation with the Lead of the role and one other team member. We’ll send the meeting link by email.');
        break;
      case 'decision_made':
        if (app.decision === 'offer') {
          h.textContent = 'Congratulations!';
          p('We’re delighted to offer you a place on the team. Check your email for the commitment agreement and what happens in your first 30 days.');
        } else {
          h.textContent = 'Thank you for applying';
          p('We won’t be moving forward with your application this time. Thank you for the time and honesty you put into it; you’re always welcome to apply again.');
        }
        break;
      default:
        break;
    }
    return box;
  }

  function signOutButton() {
    const b = el('button', 'text-button', 'Sign out');
    b.type = 'button';
    b.onclick = async () => { await signOut(); location.reload(); };
    return b;
  }

  async function load() {
    root.replaceChildren(el('p', 'portal-loading', 'Loading your application…'));
    const res = await api('/api/portal');
    if (res.status === 401) {
      await signOut();
      return start();
    }
    if (!res.ok) {
      root.replaceChildren(el('p', 'apply__error', res.data.error || 'We couldn’t load your application. Please refresh to try again.'));
      return;
    }
    const data = res.data;
    data.clockOffset = Date.parse(data.serverNow) - Date.now();

    const view = el('div', 'portal');
    const top = el('div', 'portal__top');
    const heading = el('h2', 'portal__title');
    heading.tabIndex = -1;
    top.append(heading, signOutButton());
    view.append(top);

    if (!data.application) {
      heading.textContent = 'No application found';
      const p = el('p');
      const link = el('a', 'text-link', 'apply to volunteer');
      link.href = '/volunteer';
      p.append('We couldn’t find an application for this email address. You can ', link, '.');
      view.append(p);
    } else {
      const app = data.application;
      heading.textContent = `Hi ${app.name.split(' ')[0]}`;
      const meta = el('dl', 'portal__meta');
      [['Application ID', app.applicationId], ['Role', app.role + (app.secondRole ? ` (second choice: ${app.secondRole})` : '')],
        ['Applied', lagosTime(app.submittedAt)]].forEach(([k, v]) => {
        const row = el('div');
        row.append(el('dt', null, k), el('dd', k === 'Application ID' ? 'portal__id' : null, v));
        meta.append(row);
      });
      view.append(meta, tracker(app.stage), stageDetail(data));
    }
    root.replaceChildren(view);
    heading.focus();
  }

  function start() {
    requireSignIn(root, {
      next: 'portal',
      title: 'Sign in to follow your application',
      intro: 'Use the email address you applied with. We’ll email you a 6-digit code and a sign-in link; there’s no password.',
    }, load);
  }

  start();
})();
