// Volunteer application (Stages 1-3 of the Website Guide): four steps (role,
// commitment, G.R.I.T., about you). Roles come from the database, the draft is
// saved on this device as the applicant goes (so they can come back to it),
// and the finished application is sent to /api/apply, which emails back an
// application ID like B4W-2026-0001.
// Uses formKit.validate and gritKit from main.js (loaded first).
(function () {
  const form = document.getElementById('volunteer-form');
  if (!form) return;

  const startedAt = Date.now();
  const WORD_LIMIT = 150;
  const SOLID_WORDS = 50; // a G.R.I.T. letter reads as full at this many words
  const DRAFT_KEY = 'b4w-volunteer-draft';
  const EMAIL = 'hello@beyond4wallsed.org';

  const steps = Array.from(form.querySelectorAll('.apply__part[data-step]'));
  const stepper = form.querySelector('.stepper');
  const error = form.querySelector('.apply__error');
  const errorText = error.textContent;
  const status = form.querySelector('.apply__status');
  const back = form.querySelector('[data-back]');
  const next = form.querySelector('[data-next]');
  const submit = form.querySelector('[type="submit"]');
  const submitLabel = submit.textContent;
  const grid = document.getElementById('vol-roles');
  const rolesStatus = document.getElementById('vol-roles-status');
  const second = form.elements.secondRole;
  const roleQuestion = form.querySelector('[data-role-question]');
  let roles = [];
  let current = 0;

  const countWords = (text) => (text.match(/\S+/g) || []).length;
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };

  // Storage can be blocked (private windows, strict settings); the form works without it
  const draft = {
    load() { try { return JSON.parse(localStorage.getItem(DRAFT_KEY)); } catch (e) { return null; } },
    save(data) { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(data)); } catch (e) { /* not saved */ } },
    clear() { try { localStorage.removeItem(DRAFT_KEY); } catch (e) { /* nothing to clear */ } },
  };

  // ---- Roles ---------------------------------------------------------------
  function renderRoles() {
    rolesStatus.remove();
    roles.forEach((role, i) => {
      const open = role.status === 'open';
      const label = el('label', 'role-option');
      label.dataset.status = role.status;
      const input = el('input');
      Object.assign(input, { type: 'radio', name: 'role', value: role.slug, disabled: !open });
      if (i === 0) input.required = true;
      const body = el('span', 'role-option__body');
      const top = el('span', 'role-option__top');
      top.append(el('span', 'role-option__title', role.title), el('span', 'role-option__status', open ? 'Open' : 'Closed'));
      body.append(top, el('span', 'role-option__desc', role.description));
      // Hours and skills are set by each role's Lead; hidden until they are
      if (role.hours) body.append(el('span', 'role-option__meta', `Time: ${role.hours}`));
      if (role.skills) body.append(el('span', 'role-option__meta', `Skills that help: ${role.skills}`));
      label.append(input, body);
      grid.append(label);

      const option = el('option', null, role.title);
      option.value = role.slug;
      option.disabled = !open;
      second.append(option);
    });
  }

  const pickedRole = () => {
    const input = form.querySelector('input[name="role"]:checked');
    return input ? roles.find((r) => r.slug === input.value) : null;
  };

  function syncRole() {
    const picked = pickedRole();
    // The second choice can't repeat the first or be a closed role
    Array.from(second.options).forEach((option) => {
      const role = roles.find((r) => r.slug === option.value);
      option.disabled = !!role && (role.status !== 'open' || (!!picked && role.slug === picked.slug));
    });
    if (second.selectedOptions[0] && second.selectedOptions[0].disabled) second.value = '';

    // Some roles carry an extra question from their Lead
    const question = (picked && picked.lead_question) || '';
    roleQuestion.hidden = !question;
    roleQuestion.querySelector('textarea').required = !!question;
    if (question) {
      roleQuestion.querySelector('[data-role-name]').textContent = picked.title;
      roleQuestion.querySelector('[data-role-text]').textContent = question;
    }
  }

  // ---- Word counts -----------------------------------------------------------
  function updateCount(textarea) {
    const words = countWords(textarea.value);
    const over = words > WORD_LIMIT;
    textarea.setCustomValidity(over ? `Please keep each answer to ${WORD_LIMIT} words or fewer.` : '');
    const counter = document.getElementById(textarea.getAttribute('aria-describedby'));
    counter.textContent = over ? `${words} / ${WORD_LIMIT} words. Please trim it down.` : `${words} / ${WORD_LIMIT} words`;
    counter.classList.toggle('is-over', over);
  }

  // Filled-in fields that still fail get the browser's specific message; empty ones the general one
  function messageFor(field) {
    const filled = field.type !== 'radio' && field.type !== 'checkbox' && field.value.trim() !== '';
    return (filled && field.validationMessage) || errorText;
  }

  // ---- Draft -----------------------------------------------------------------
  function save() {
    const fields = {};
    new FormData(form).forEach((value, key) => {
      if (key !== 'website') fields[key] = value;
    });
    draft.save({ fields, step: current });
  }

  function restore(saved) {
    Object.entries(saved.fields || {}).forEach(([key, value]) => {
      const field = form.elements[key];
      if (!field) return;
      if (field.type === 'checkbox') field.checked = true;
      else field.value = value; // on a radio group this checks the matching option
    });
  }

  // ---- Steps -----------------------------------------------------------------
  function showStep(i, focus) {
    current = i;
    steps.forEach((step, n) => step.classList.toggle('is-current', n === i));
    stepper.querySelector('[data-step-num]').textContent = i + 1;
    stepper.querySelector('[data-step-name]').textContent = steps[i].dataset.step;
    stepper.querySelectorAll('.stepper__bar span').forEach((bar, n) => bar.classList.toggle('is-done', n <= i));
    back.hidden = i === 0;
    next.hidden = i === steps.length - 1;
    submit.hidden = i !== steps.length - 1;
    if (focus) {
      form.scrollIntoView({ behavior: 'smooth', block: 'start' });
      steps[i].querySelector('legend').focus({ preventScroll: true });
    }
    save();
  }

  function showError(message, field) {
    error.textContent = message;
    error.hidden = false;
    if (field) {
      const step = steps.findIndex((s) => s.contains(field));
      if (step !== -1 && step !== current) showStep(step, false);
      field.focus();
    }
  }

  next.addEventListener('click', () => {
    const invalid = formKit.validate(form, steps[current]);
    error.hidden = !invalid;
    if (invalid) return showError(messageFor(invalid), invalid);
    showStep(current + 1, true);
  });
  back.addEventListener('click', () => {
    error.hidden = true;
    showStep(current - 1, true);
  });

  // Enter in a field moves on a step instead of submitting early
  form.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.target.tagName !== 'INPUT' || current === steps.length - 1) return;
    e.preventDefault();
    next.click();
  });

  form.addEventListener('input', (e) => {
    if (e.target.matches('textarea[data-words]')) updateCount(e.target);
    if (e.target.closest('[aria-invalid="true"]')) e.target.closest('[aria-invalid="true"]').setAttribute('aria-invalid', 'false');
    save();
  });
  form.addEventListener('change', (e) => {
    if (e.target.name === 'role') grid.setAttribute('aria-invalid', 'false');
    syncRole();
    save();
  });

  // ---- Submit ----------------------------------------------------------------
  function payload() {
    const v = (name) => String(form.elements[name] ? form.elements[name].value : '').trim();
    const picked = pickedRole();
    return {
      website: v('website'),
      startedAt,
      role: picked ? picked.slug : '',
      secondRole: v('secondRole'),
      hours: v('hours'),
      startDate: v('startDate'),
      commitment: form.elements.commitment.checked,
      grounded: v('grounded'),
      resilient: v('resilient'),
      innovative: v('innovative'),
      teachable: v('teachable'),
      roleAnswer: picked && picked.lead_question ? v('roleAnswer') : '',
      name: v('name'),
      email: v('email'),
      phone: v('phone'),
      consent: form.elements.consent.checked,
    };
  }

  // Server field names -> form fields (to show the right step)
  const FIELD = { role: 'role', secondRole: 'secondRole', hours: 'hours', startDate: 'startDate', commitment: 'commitment',
    grounded: 'grounded', resilient: 'resilient', innovative: 'innovative', teachable: 'teachable', roleAnswer: 'roleAnswer',
    name: 'name', email: 'email', phone: 'phone', consent: 'consent' };

  function showReceived(applicationId, emailSent) {
    const done = el('div', 'sent');
    done.innerHTML = '<span class="sent__icon" aria-hidden="true"><svg width="28" height="28" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg></span>';
    const title = el('h2', 'sent__title', 'Application received. Thank you!');
    title.tabIndex = -1;
    const idLine = el('p', 'sent__body');
    idLine.append('Your application ID is ', el('strong', null, applicationId), '. Keep it handy; we’ll quote it whenever we email you about your application.');
    const nextLine = el('p', 'sent__body', emailSent
      ? 'We’ve emailed it to you too. Follow your application in the applicant portal: sign in with your email and a one-time code.'
      : 'Follow your application in the applicant portal: sign in with your email and a one-time code.');
    const cta = el('p', 'sent__body');
    const link = el('a', 'btn btn--primary', 'Open the applicant portal');
    link.href = '/portal';
    cta.append(link);
    done.append(title, idLine, nextLine, cta);
    form.replaceChildren(done);
    title.focus();
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const invalid = formKit.validate(form);
    if (invalid) return showError(messageFor(invalid), invalid);
    error.hidden = true;

    submit.disabled = true;
    submit.textContent = 'Sending…';
    status.textContent = 'Sending your application…';
    let res;
    let result = {};
    try {
      res = await fetch('/api/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload()),
      });
      result = await res.json().catch(() => ({}));
    } catch (err) {
      result = { error: 'We couldn’t reach our server. Check your connection and try again.' };
    }
    submit.disabled = false;
    submit.textContent = submitLabel;
    status.textContent = '';

    if (res && res.ok && result.ok && result.applicationId) {
      draft.clear();
      return showReceived(result.applicationId, result.emailSent);
    }

    // Everything stays in the form (and the saved draft) so they can try again
    if (res && res.status === 422 && result.fields) {
      const keys = Object.keys(result.fields);
      const field = form.elements[FIELD[keys[0]]];
      const target = field && (field.length && !field.tagName ? field[0] : field);
      if (keys[0] === 'role') grid.setAttribute('aria-invalid', 'true');
      else if (target) target.setAttribute('aria-invalid', 'true');
      return showError(result.fields[keys[0]], target);
    }
    showError(result.error || 'Sorry, that didn’t go through. Please try again.');
    if (!res || res.status >= 500) {
      const mail = el('a', 'text-link', EMAIL);
      mail.href = `mailto:${EMAIL}`;
      error.append(' If it keeps happening, email us at ', mail, '.');
    }
  });

  // ---- Start -----------------------------------------------------------------
  async function start() {
    try {
      const res = await fetch('/api/roles', { headers: { Accept: 'application/json' } });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error);
      roles = data.roles;
    } catch (err) {
      rolesStatus.textContent = 'We couldn’t load the roles just now. Please refresh the page to try again.';
      rolesStatus.classList.add('apply__error');
      return;
    }
    renderRoles();

    // Pick up where they left off
    const saved = draft.load();
    if (saved) restore(saved);

    // Links like /volunteer?role=finance pre-select an open role
    const preset = new URLSearchParams(location.search).get('role');
    const presetInput = preset && form.querySelector(`input[name="role"][value="${CSS.escape(preset)}"]:not(:disabled)`);
    if (presetInput) presetInput.checked = true;
    const checked = form.querySelector('input[name="role"]:checked');
    if (checked && checked.disabled) checked.checked = false;

    // Earliest start date is today, in local time
    const now = new Date();
    form.elements.startDate.min = new Date(now - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

    syncRole();
    form.querySelectorAll('textarea[data-words]').forEach(updateCount);
    gritKit.setup(form, {
      progress: (key, textarea) => Math.min(countWords(textarea.value) / SOLID_WORDS, 1),
    });

    form.classList.add('is-stepped');
    stepper.hidden = false;
    const savedStep = saved && Number.isInteger(saved.step) ? saved.step : 0;
    showStep(Math.min(Math.max(savedStep, 0), steps.length - 1), false);
  }

  start();
})();
