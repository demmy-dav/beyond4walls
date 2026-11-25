// Admin view (team only): applicants by role and stage, their answers and
// challenge submission, and buttons to move them to the next stage. Each move
// emails the applicant. Admins act on every role, Leads on their own role,
// reviewers can view only. Scoring isn't built yet (the scores table is ready).
(function () {
  const root = document.getElementById('admin-root');
  if (!root) return;
  const { el, api, lagosTime, signOut, requireSignIn } = b4w;

  const STAGES = {
    received: 'Received', under_review: 'Under review', challenge_released: 'Challenge released',
    interview_scheduled: 'Interview scheduled', decision_made: 'Decision made',
  };
  const ANSWERS = [
    ['grounded', 'G · Grounded'], ['resilient', 'R · Resilient'],
    ['innovative', 'I · Innovative'], ['teachable', 'T · Teachable'],
  ];
  const filters = { role: '', stage: '' };

  function select(id, label, options, value, onChange) {
    const wrap = el('div', 'field');
    const l = el('label', null, label);
    l.htmlFor = id;
    const s = el('select');
    s.id = id;
    options.forEach(([v, t]) => {
      const o = el('option', null, t);
      o.value = v;
      s.append(o);
    });
    s.value = value;
    s.onchange = () => onChange(s.value);
    wrap.append(l, s);
    return wrap;
  }

  function detailRow(list, label, value) {
    if (!value) return;
    list.append(el('dt', null, label), el('dd', 'admin-app__value', value));
  }

  function actions(app, onChanged) {
    const box = el('div', 'admin-actions');
    const message = el('p', 'admin-actions__msg');
    message.setAttribute('role', 'status');

    async function run(button, body, confirmText) {
      if (confirmText && !window.confirm(confirmText)) return;
      button.disabled = true;
      message.textContent = 'Saving…';
      const res = await api('/api/admin/advance', { method: 'POST', body: { id: app.id, ...body } });
      button.disabled = false;
      if (!res.ok) {
        message.textContent = res.data.error || 'That didn’t work. Please try again.';
        return;
      }
      message.textContent = res.data.emailSent ? 'Done. The applicant has been emailed.' : 'Done, but the email to the applicant failed. Please contact them directly.';
      onChanged(message.textContent);
    }
    const button = (text, body, confirmText, primary) => {
      const b = el('button', primary ? 'btn btn--primary btn--sm' : 'btn btn--outline btn--sm', text);
      b.type = 'button';
      b.onclick = () => run(b, body, confirmText);
      return b;
    };

    const row = el('div', 'admin-actions__row');
    if (app.stage === 'received') row.append(button('Mark under review', { action: 'under_review' }, null, true));
    if (['received', 'under_review'].includes(app.stage)) {
      row.append(button('Release challenge', { action: 'release_challenge' },
        `Release the ${app.role.title} challenge to ${app.name}? Their 72 hours start now.`, app.stage === 'under_review'));
    }
    if (['under_review', 'challenge_released', 'interview_scheduled'].includes(app.stage)) {
      const id = `interview-${app.id}`;
      const wrap = el('div', 'field admin-actions__interview');
      const l = el('label', null, 'Interview (your local time)');
      l.htmlFor = id;
      const input = el('input');
      Object.assign(input, { id, type: 'datetime-local' });
      const b = el('button', 'btn btn--outline btn--sm', app.stage === 'interview_scheduled' ? 'Reschedule interview' : 'Schedule interview');
      b.type = 'button';
      b.onclick = () => {
        if (!input.value) { message.textContent = 'Choose the interview date and time first.'; input.focus(); return; }
        const at = new Date(input.value);
        run(b, { action: 'schedule_interview', interviewAt: at.toISOString() }, `Schedule the interview for ${lagosTime(at.toISOString())}?`);
      };
      wrap.append(l, input, b);
      box.append(wrap);
    }
    if (app.stage !== 'decision_made') {
      row.append(button('Offer a place', { action: 'decision', decision: 'offer' }, `Offer ${app.name} a place? They’ll be emailed now.`));
      row.append(button('Not selected', { action: 'decision', decision: 'not_selected' }, `Tell ${app.name} they weren’t selected? They’ll be emailed now.`));
    }
    box.prepend(row);
    box.append(message);
    return box;
  }

  function card(app, canActNote, reload) {
    const item = el('li', 'admin-app');
    const details = el('details');
    const summary = el('summary', 'admin-app__summary');
    const name = el('span', 'admin-app__name', app.name);
    const meta = el('span', 'admin-app__meta', `${app.application_id} · ${app.role.title}`);
    const stage = el('span', `admin-app__stage admin-app__stage--${app.stage}`, STAGES[app.stage] +
      (app.decision ? `: ${app.decision === 'offer' ? 'offer' : 'not selected'}` : ''));
    summary.append(name, meta, stage);
    details.append(summary);

    const body = el('div', 'admin-app__body');
    const info = el('dl', 'admin-app__list');
    detailRow(info, 'Email', app.email);
    detailRow(info, 'WhatsApp', app.phone);
    detailRow(info, 'Second choice', app.second_role && app.second_role.title);
    detailRow(info, 'Hours per week', app.hours_per_week);
    detailRow(info, 'Can start', app.start_date);
    detailRow(info, 'Applied', lagosTime(app.created_at));
    detailRow(info, 'Interview', app.interview_at && lagosTime(app.interview_at));
    body.append(info);

    const answers = el('dl', 'admin-app__list');
    ANSWERS.forEach(([k, label]) => detailRow(answers, label, app.answers[k]));
    if (app.answers.role_question) detailRow(answers, `Lead question: ${app.answers.role_question}`, app.answers.role_answer);
    body.append(el('h3', 'admin-app__heading', 'G.R.I.T. answers'), answers);

    if (app.release) {
      const ch = el('dl', 'admin-app__list');
      detailRow(ch, 'Challenge', app.release.challenge && app.release.challenge.title);
      detailRow(ch, 'Released', lagosTime(app.release.released_at));
      detailRow(ch, 'Due', lagosTime(app.release.due_at));
      if (app.submission) {
        detailRow(ch, 'Submitted', lagosTime(app.submission.submittedAt));
        detailRow(ch, 'Written answer', app.submission.text);
        if (app.submission.file) {
          ch.append(el('dt', null, 'File'));
          const dd = el('dd');
          const a = el('a', 'text-link', app.submission.file.name);
          a.href = app.submission.file.url;
          a.target = '_blank';
          a.rel = 'noopener';
          dd.append(a);
          ch.append(dd);
        }
      } else {
        detailRow(ch, 'Submitted', 'Not yet');
      }
      body.append(el('h3', 'admin-app__heading', 'Role challenge'), ch);
    }

    if (app.canAct) body.append(actions(app, reload));
    else body.append(el('p', 'admin-actions__msg', canActNote));
    details.append(body);
    item.append(details);
    return item;
  }

  async function load(note) {
    const params = new URLSearchParams(Object.entries(filters).filter(([, v]) => v));
    const res = await api(`/api/admin/applications${params.toString() ? `?${params}` : ''}`);
    if (res.status === 401) { await signOut(); return start(); }
    if (!res.ok) {
      root.replaceChildren(el('p', 'apply__error', res.data.error || 'We couldn’t load applications.'));
      return;
    }
    const { me, roles, applications } = res.data;
    const view = el('div', 'admin');
    const top = el('div', 'portal__top');
    const heading = el('h2', 'portal__title', `${applications.length} application${applications.length === 1 ? '' : 's'}`);
    heading.tabIndex = -1;
    const out = el('button', 'text-button', 'Sign out');
    out.type = 'button';
    out.onclick = async () => { await signOut(); location.reload(); };
    top.append(heading, out);

    const bar = el('div', 'admin-filters');
    bar.append(
      select('f-role', 'Role', [['', 'All roles'], ...roles.map((r) => [r.slug, r.title])], filters.role, (v) => { filters.role = v; load(); }),
      select('f-stage', 'Stage', [['', 'All stages'], ...Object.entries(STAGES)], filters.stage, (v) => { filters.stage = v; load(); }),
    );
    view.append(top, el('p', 'admin-me', `Signed in as ${me.name || 'team member'} (${me.role}).`), bar);
    if (note) {
      const n = el('p', 'apply__status', note);
      n.setAttribute('role', 'status');
      view.append(n);
    }

    const list = el('ul', 'admin-list');
    const canActNote = me.role === 'reviewer' ? 'Reviewers can view applications; an admin or the role’s Lead moves them forward.' : 'Only this role’s Lead or an admin can move this application forward.';
    applications.forEach((app) => list.append(card(app, canActNote, load)));
    if (!applications.length) list.append(el('li', 'admin-empty', 'No applications match these filters.'));
    view.append(list);
    root.replaceChildren(view);
    if (!note) heading.focus();
  }

  function start() {
    requireSignIn(root, {
      next: 'admin',
      title: 'Team sign-in',
      intro: 'For Beyond4walls admins, Leads and reviewers. We’ll email you a 6-digit code and a sign-in link.',
    }, () => load());
  }

  start();
})();
