// Membership form: validates in the browser, posts JSON to /api/membership,
// and swaps in a welcome note on success. Nothing is stored in the browser.
(function () {
  const form = document.getElementById('membership-form');
  if (!form) return;

  const startedAt = Date.now();
  const WORD_LIMIT = 50;
  const EMAIL = 'hello@beyond4wallsed.org';
  const WHATSAPP = 'https://wa.me/2349043606531?text=' +
    encodeURIComponent('Hi Beyond 4walls, I tried to become a member on your website but the form didn’t go through.');

  const els = form.elements;
  const button = form.querySelector('.apply__submit');
  const buttonLabel = button.textContent;
  const summary = document.getElementById('member-form-error');
  const status = form.querySelector('.apply__status');

  // Field key -> element that carries aria-invalid and owns `${id}-error`
  const targets = {
    fullName: 'member-name',
    email: 'member-email',
    phone: 'member-phone',
    ageRange: 'member-age',
    state: 'member-state',
    city: 'member-city',
    role: 'member-role',
    why: 'member-why',
    goingFurther: 'member-further',
    consent: 'member-consent',
  };

  const value = (name) => String(els[name] ? els[name].value : '').trim();
  const checked = (name) => form.querySelector(`input[name="${name}"]:checked`);
  const countWords = (s) => (s.trim() ? s.trim().split(/\s+/).length : 0);

  // ---- Level or course only applies to students ---------------------------
  const levelField = document.getElementById('member-level-field');
  function syncLevel() {
    const isStudent = !!checked('role') && checked('role').value === 'Student';
    levelField.hidden = !isStudent;
    if (!isStudent) els.level.value = '';
  }
  form.addEventListener('change', (e) => { if (e.target.name === 'role') syncLevel(); });
  syncLevel();

  // ---- Word counter -------------------------------------------------------
  const why = els.why;
  const counter = document.getElementById('member-why-count');
  const live = document.getElementById('member-why-live');
  let lastAnnounced = null;
  function updateCounter() {
    const words = countWords(why.value);
    const left = WORD_LIMIT - words;
    counter.textContent = `${words} / ${WORD_LIMIT} words`;
    counter.classList.toggle('counter--over', left < 0);
    // Announce only at a few milestones so screen readers aren't flooded
    const milestone = left < 0 ? 'over' : left === 0 ? 'zero' : left <= 10 ? 'near' : null;
    if (milestone !== lastAnnounced) {
      lastAnnounced = milestone;
      if (milestone === 'over') live.textContent = `${-left} ${-left === 1 ? 'word' : 'words'} over the ${WORD_LIMIT}-word limit.`;
      else if (milestone === 'zero') live.textContent = `You’ve reached the ${WORD_LIMIT}-word limit.`;
      else if (milestone === 'near') live.textContent = `${left} words left.`;
      else live.textContent = '';
    }
  }
  why.addEventListener('input', updateCounter);
  updateCounter();

  // ---- Validation ---------------------------------------------------------
  function check(key) {
    switch (key) {
      case 'fullName': return value('fullName').length >= 2 ? '' : 'Please enter your full name.';
      case 'email': {
        const v = value('email');
        if (!v) return 'Please enter your email address.';
        return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) ? '' : 'Please enter a valid email address, like name@example.com.';
      }
      case 'phone': {
        const v = value('phone');
        if (!v) return 'Please enter your WhatsApp number.';
        const digits = v.replace(/\D/g, '').length;
        return /^\+?[\d\s()-]+$/.test(v) && digits >= 7 && digits <= 15 ? '' : 'Please enter a valid WhatsApp number, like +234 801 234 5678.';
      }
      case 'ageRange': return value('ageRange') ? '' : 'Please choose your age range.';
      case 'state': return value('state') ? '' : 'Please choose your state.';
      case 'city': return value('city') ? '' : 'Please enter your city.';
      case 'role': return checked('role') ? '' : 'Please tell us what you do.';
      case 'why': {
        const words = countWords(why.value);
        if (!words) return 'Please tell us what brings you to Beyond4walls.';
        return words > WORD_LIMIT ? `Please keep this to ${WORD_LIMIT} words or fewer.` : '';
      }
      case 'goingFurther': return checked('goingFurther') ? '' : 'Please choose how you’d like to be involved.';
      case 'consent': return els.consent.checked ? '' : 'Please agree so we can store your details and contact you.';
      default: return '';
    }
  }

  function setError(key, message) {
    const target = document.getElementById(targets[key]);
    if (!target) return;
    const error = document.getElementById(`${targets[key]}-error`);
    target.setAttribute('aria-invalid', String(!!message));
    if (error) {
      error.textContent = message;
      error.hidden = !message;
    }
  }

  function validateAll() {
    let first = null;
    Object.keys(targets).forEach((key) => {
      const message = check(key);
      setError(key, message);
      if (message && !first) first = key;
    });
    return first;
  }

  function focusField(key) {
    const target = document.getElementById(targets[key]);
    if (!target) return;
    const focusable = target.matches('fieldset') ? target.querySelector('input') : target;
    focusable.focus();
  }

  // Once a field has been flagged, re-check it as the visitor fixes it
  function recheck(e) {
    const key = Object.keys(targets).find((k) => e.target.name === k);
    if (!key) return;
    const target = document.getElementById(targets[key]);
    if (target && target.getAttribute('aria-invalid') === 'true') setError(key, check(key));
  }
  form.addEventListener('input', recheck);
  form.addEventListener('change', recheck);

  // ---- Submit -------------------------------------------------------------
  function link(href, text) {
    const a = document.createElement('a');
    a.className = 'text-link';
    a.href = href;
    a.textContent = text;
    if (href.startsWith('http')) { a.target = '_blank'; a.rel = 'noopener'; }
    return a;
  }

  function showSummary(message, withContacts) {
    const parts = [message];
    if (withContacts) {
      parts.push(' Please try again, email us at ', link(`mailto:${EMAIL}`, EMAIL), ', or ',
        link(WHATSAPP, 'message us on WhatsApp'), '.');
    }
    // Unhide first, then fill, so the role="alert" region announces the new text
    summary.hidden = false;
    summary.replaceChildren(...parts);
  }

  function payload() {
    return {
      website: value('website'),
      startedAt,
      fullName: value('fullName'),
      email: value('email'),
      phone: value('phone'),
      gender: value('gender'),
      ageRange: value('ageRange'),
      state: value('state'),
      city: value('city'),
      role: checked('role') ? checked('role').value : '',
      organisation: value('organisation'),
      level: value('level'),
      why: why.value.trim(),
      interests: Array.from(form.querySelectorAll('input[name="interests"]:checked'), (el) => el.value),
      skills: value('skills'),
      goingFurther: checked('goingFurther') ? checked('goingFurther').value : '',
      consent: els.consent.checked,
      updates: els.updates.checked,
    };
  }

  function setSending(sending) {
    button.disabled = sending;
    button.textContent = sending ? 'Sending…' : buttonLabel;
    form.setAttribute('aria-busy', String(sending));
    status.textContent = sending ? 'Sending your application…' : '';
  }

  function showWelcome(confirmationSent) {
    const done = document.createElement('div');
    done.className = 'sent';
    done.innerHTML = '<span class="sent__icon" aria-hidden="true"><svg width="28" height="28" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg></span>' +
      '<h2 class="sent__title" tabindex="-1">Welcome to the family.</h2>' +
      '<p class="sent__body">Nobody here works under anyone; we work with each other. We’ll be in touch soon.</p>';
    if (confirmationSent) {
      const note = document.createElement('p');
      note.className = 'sent__body';
      note.textContent = 'We’ve sent a welcome email to your inbox too.';
      done.appendChild(note);
    }
    form.replaceChildren(done);
    form.removeAttribute('aria-busy');
    done.querySelector('.sent__title').focus();
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    summary.hidden = true;

    const firstInvalid = validateAll();
    if (firstInvalid) {
      showSummary('Please fix the highlighted fields above.', false);
      focusField(firstInvalid);
      return;
    }

    setSending(true);
    let res;
    let result = {};
    try {
      res = await fetch('/api/membership', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload()),
      });
      result = await res.json().catch(() => ({}));
    } catch (err) {
      setSending(false);
      showSummary('We couldn’t reach our server. Check your connection.', true);
      return;
    }

    if (res.ok && result.ok) {
      showWelcome(result.confirmationSent);
      return;
    }

    // Everything the visitor typed stays in the form so they can try again
    setSending(false);
    if (res.status === 422 && result.fields) {
      let first = null;
      Object.entries(result.fields).forEach(([key, message]) => {
        setError(key, message);
        if (!first && targets[key]) first = key;
      });
      showSummary(result.error || 'Please check the highlighted fields.', false);
      if (first) focusField(first);
      return;
    }
    const retryable = res.status !== 429 && res.status !== 400;
    showSummary(result.error || 'Sorry, that didn’t go through.', retryable);
  });
})();
