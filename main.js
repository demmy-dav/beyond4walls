// Mobile nav toggle
(function () {
  const toggle = document.querySelector('.nav__toggle');
  const menu = document.getElementById('nav-menu');
  if (!toggle || !menu) return;

  function setOpen(open) {
    toggle.setAttribute('aria-expanded', String(open));
    menu.classList.toggle('is-open', open);
  }

  toggle.addEventListener('click', () => {
    setOpen(toggle.getAttribute('aria-expanded') !== 'true');
  });

  // Close after choosing a link, on Escape, or when resizing up to desktop
  menu.addEventListener('click', (e) => {
    if (e.target.closest('a')) setOpen(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && menu.classList.contains('is-open')) {
      setOpen(false);
      toggle.focus();
    }
  });
  window.matchMedia('(min-width: 861px)').addEventListener('change', (e) => {
    if (e.matches) setOpen(false);
  });
})();

// Reveal-on-scroll for elements that animate in once (e.g. the strategy steps)
(function () {
  const targets = document.querySelectorAll('.steps');
  if (!targets.length) return;
  const show = (el) => el.classList.add('is-visible');

  if (!('IntersectionObserver' in window) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    targets.forEach(show);
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      show(entry.target);
      observer.unobserve(entry.target);
    });
  }, { threshold: 0.2 });

  targets.forEach((el) => observer.observe(el));
})();

// Impact counters: count from 0 when scrolled into view.
// Final values are in the HTML, so no-JS and reduced-motion users see them as-is.
(function () {
  const counters = document.querySelectorAll('.stat__value[data-count]');
  if (!counters.length || !('IntersectionObserver' in window)) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const DURATION = 1800;
  const format = (n, suffix) => n.toLocaleString('en-US') + suffix;
  const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

  function run(el) {
    const target = Number(el.dataset.count);
    const suffix = el.dataset.suffix || '';
    const start = performance.now();

    function tick(now) {
      const t = Math.min((now - start) / DURATION, 1);
      el.textContent = format(Math.round(target * easeOutCubic(t)), t === 1 ? suffix : '');
      if (t < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  counters.forEach((el) => {
    // Screen readers get the final value, not every intermediate frame
    const sr = document.createElement('span');
    sr.className = 'visually-hidden';
    sr.textContent = el.textContent;
    el.after(sr);
    el.setAttribute('aria-hidden', 'true');
    el.textContent = '0';
  });

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      run(entry.target);
      observer.unobserve(entry.target);
    });
  }, { threshold: 0.6 });

  counters.forEach((el) => observer.observe(el));
})();

// Speakers marquee: continuous auto-scroll that eases to a stop on hover,
// can be dragged with mouse/touch, nudged with a horizontal wheel, and paused.
(function () {
  const root = document.querySelector('[data-marquee]');
  if (!root) return;
  const track = root.querySelector('.marquee__track');
  const toggle = document.querySelector('.marquee-toggle');
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (reduce) {
    root.classList.add('is-static');
    if (toggle) toggle.hidden = true;
    return;
  }

  // Duplicate the cards once so the loop is seamless
  Array.from(track.children).forEach((item) => {
    const clone = item.cloneNode(true);
    clone.setAttribute('aria-hidden', 'true');
    track.appendChild(clone);
  });

  const BASE_SPEED = 0.045; // px per ms
  let loopWidth = track.scrollWidth / 2;
  let offset = 0;
  let speed = BASE_SPEED;
  let targetSpeed = BASE_SPEED;
  let paused = false;
  let hovering = false;
  let dragging = false;
  let dragStartX = 0;
  let dragStartOffset = 0;
  let inView = false;
  let last = performance.now();

  const wrap = () => {
    if (offset <= -loopWidth) offset += loopWidth;
    if (offset > 0) offset -= loopWidth;
  };
  const updateTarget = () => {
    targetSpeed = paused || hovering || dragging ? 0 : BASE_SPEED;
  };

  function frame(now) {
    const dt = Math.min(now - last, 50);
    last = now;
    if (!dragging) {
      speed += (targetSpeed - speed) * 0.08;
      offset -= speed * dt;
    }
    wrap();
    track.style.transform = `translate3d(${offset}px, 0, 0)`;
    if (inView) requestAnimationFrame(frame);
  }

  new IntersectionObserver(([entry]) => {
    const was = inView;
    inView = entry.isIntersecting;
    if (inView && !was) { last = performance.now(); requestAnimationFrame(frame); }
  }).observe(root);

  window.addEventListener('resize', () => { loopWidth = track.scrollWidth / 2; });

  // Hover / keyboard focus slows it to a stop
  root.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') { hovering = true; updateTarget(); } });
  root.addEventListener('pointerleave', () => { hovering = false; updateTarget(); });
  root.addEventListener('focusin', () => { hovering = true; updateTarget(); });
  root.addEventListener('focusout', () => { hovering = false; updateTarget(); });

  // Drag to scrub
  root.addEventListener('pointerdown', (e) => {
    dragging = true;
    dragStartX = e.clientX;
    dragStartOffset = offset;
    root.setPointerCapture(e.pointerId);
    root.classList.add('is-dragging');
    updateTarget();
  });
  root.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    offset = dragStartOffset + (e.clientX - dragStartX);
  });
  const endDrag = () => {
    if (!dragging) return;
    dragging = false;
    root.classList.remove('is-dragging');
    updateTarget();
  };
  root.addEventListener('pointerup', endDrag);
  root.addEventListener('pointercancel', endDrag);
  root.addEventListener('dragstart', (e) => e.preventDefault());

  // Horizontal trackpad swipes / shift+wheel move the strip
  root.addEventListener('wheel', (e) => {
    const dx = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : (e.shiftKey ? e.deltaY : 0);
    if (!dx) return;
    e.preventDefault();
    offset -= dx;
  }, { passive: false });

  // User-controlled pause (WCAG 2.2.2)
  if (toggle) {
    toggle.addEventListener('click', () => {
      paused = !paused;
      toggle.setAttribute('aria-pressed', String(paused));
      toggle.querySelector('.marquee-toggle__text').textContent = paused ? 'Play' : 'Pause';
      updateTarget();
    });
  }

  // Cards tilt towards the cursor
  if (window.matchMedia('(hover: hover)').matches) {
    track.addEventListener('pointermove', (e) => {
      const card = e.target.closest('.speaker');
      if (!card || dragging) return;
      const r = card.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5;
      const py = (e.clientY - r.top) / r.height - 0.5;
      card.style.setProperty('--ry', `${px * 10}deg`);
      card.style.setProperty('--rx', `${py * -10}deg`);
    });
    track.addEventListener('pointerout', (e) => {
      const card = e.target.closest('.speaker');
      if (card && !card.contains(e.relatedTarget)) {
        card.style.removeProperty('--rx');
        card.style.removeProperty('--ry');
      }
    });
  }
})();

// Sections on the Programs page that ship hidden; set a flag to true to show
// that section (gallery once photos are in).
const SHOW_GALLERY = false;
(function () {
  const flags = { gallery: SHOW_GALLERY };
  document.querySelectorAll('[data-flag]').forEach((el) => {
    if (flags[el.dataset.flag]) el.hidden = false;
  });
})();

// Forms (contact, campus ambassadors, volunteers). The site has no backend, so submissions
// go through FormSubmit, which emails them to our inbox. Each form's plain
// action attribute is the no-JS fallback.
const formKit = (function () {
  const EMAIL = 'hello@beyond4wallsed.org';
  const WHATSAPP = 'https://wa.me/2349043606531?text=' +
    encodeURIComponent('Hi Beyond 4walls, I tried to send a message on your website but it didn’t go through.');

  function link(href, text) {
    const a = document.createElement('a');
    a.className = 'text-link';
    a.href = href;
    a.textContent = text;
    if (href.startsWith('http')) { a.target = '_blank'; a.rel = 'noopener'; }
    return a;
  }

  // Friendly message with ways to reach us that don't depend on the form
  function showFailure(status) {
    status.replaceChildren(
      'Sorry, that didn’t go through. Please try again, email us at ',
      link(`mailto:${EMAIL}`, EMAIL),
      ', or ',
      link(WHATSAPP, 'message us on WhatsApp'),
      '.'
    );
  }

  function isValid(form, field) {
    if (field.type === 'radio') return !!form.querySelector(`input[name="${field.name}"]:checked`);
    return field.checkValidity() && (!field.required || field.value.trim() !== '');
  }
  function markField(field, valid) {
    const target = field.type === 'radio' ? field.closest('.choice') : field;
    target.setAttribute('aria-invalid', String(!valid));
  }

  // Marks every required field in `scope` (the whole form by default) and returns the first invalid one, if any
  function validate(form, scope = form) {
    let firstInvalid = null;
    scope.querySelectorAll('[required], input[type="radio"]').forEach((field) => {
      const valid = isValid(form, field);
      markField(field, valid);
      if (!valid && !firstInvalid) firstInvalid = field;
    });
    return firstInvalid;
  }

  // Clear the error state as soon as a flagged field is fixed
  function liveValidation(form) {
    form.addEventListener('input', (e) => {
      if (e.target.closest('[aria-invalid="true"]')) markField(e.target, isValid(form, e.target));
    });
    form.addEventListener('change', (e) => {
      if (e.target.type === 'radio') markField(e.target, true);
    });
  }

  // Validates, sends `payload()` to `inbox()` (hello@ by default), then swaps the form for a thank-you note.
  // `onInvalid` runs before focusing the first invalid field; `onSent` runs once the note is showing.
  function handleSubmit(form, { payload, thanks, inbox = () => EMAIL, onInvalid = () => {}, onSent = () => {} }) {
    const error = form.querySelector('.apply__error');
    const status = form.querySelector('.apply__status');
    const button = form.querySelector('[type="submit"]');
    const label = button.textContent;
    liveValidation(form);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const firstInvalid = validate(form);
      error.hidden = !firstInvalid;
      if (firstInvalid) {
        status.textContent = '';
        onInvalid(firstInvalid);
        firstInvalid.focus();
        return;
      }

      button.disabled = true;
      button.textContent = 'Sending…';
      status.textContent = '';
      try {
        const res = await fetch(`https://formsubmit.co/ajax/${inbox()}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            _template: 'table',
            _honey: form.elements._honey ? form.elements._honey.value : '',
            ...payload(new FormData(form)),
          }),
        });
        // FormSubmit can answer 200 with success "false" (e.g. the inbox hasn't activated the form yet)
        const result = await res.json().catch(() => ({}));
        if (!res.ok || String(result.success) !== 'true') {
          throw new Error(`FormSubmit ${res.status}: ${result.message || 'no message'}`);
        }

        const done = document.createElement('div');
        done.className = 'sent';
        done.innerHTML = `<span class="sent__icon" aria-hidden="true"><svg width="28" height="28" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg></span><h2 class="sent__title" tabindex="-1">${thanks.title}</h2><p class="sent__body">${thanks.body}</p>`;
        form.replaceChildren(done);
        done.querySelector('.sent__title').focus();
        form.scrollIntoView({ behavior: 'smooth', block: 'start' });
        onSent();
      } catch (err) {
        console.error('Form submission failed:', err);
        showFailure(status);
        button.disabled = false;
        button.textContent = label;
      }
    });
  }

  return { handleSubmit, validate };
})();

// Contact form
(function () {
  const form = document.getElementById('contact-form');
  if (!form) return;

  // Links like /contact?topic=partner pre-select a topic
  const topic = new URLSearchParams(location.search).get('topic');
  const preset = topic && form.querySelector(`input[data-topic="${CSS.escape(topic)}"]`);
  if (preset) preset.checked = true;

  formKit.handleSubmit(form, {
    // Partnership and sponsorship topics name their own inbox in contact.html
    inbox: () => {
      const picked = form.querySelector('input[name="topic"]:checked');
      return (picked && picked.dataset.inbox) || 'hello@beyond4wallsed.org';
    },
    payload: (data) => ({
      _subject: `Website message: ${data.get('topic')} (from ${data.get('name')})`,
      _replyto: data.get('email'),
      Topic: data.get('topic'),
      Name: data.get('name'),
      Email: data.get('email'),
      Phone: data.get('phone') || '-',
      'Organization or school': data.get('organization') || '-',
      Message: data.get('message'),
    }),
    thanks: {
      title: 'Message sent. Thank you!',
      body: 'We’ve got it and will reply to your email soon.',
    },
  });
})();

// G.R.I.T. question cards (campus ambassadors, volunteers): each big letter and its meter
// tile fill as the answer grows. `progress(key, textarea)` returns 0 to 1; `counter`, if
// given, returns the text shown under each answer.
const gritKit = (function () {
  function setup(form, { progress, counter }) {
    const meter = form.querySelector('.grit-meter');
    const cards = Array.from(form.querySelectorAll('[data-grit]'));

    function updateCard(card) {
      const key = card.dataset.grit;
      const textarea = card.querySelector('textarea');
      const p = progress(key, textarea);

      const tile = meter.querySelector(`[data-meter="${key}"]`);
      [card, tile].forEach((el) => {
        el.style.setProperty('--p', p);
        el.classList.toggle('is-full', p === 1);
      });
      if (counter) card.querySelector('.counter').textContent = counter(textarea);
      meter.classList.toggle('is-complete', cards.every((c) => c.classList.contains('is-full')));
    }

    cards.forEach((card) => {
      card.addEventListener('input', () => updateCard(card));
      card.addEventListener('change', () => updateCard(card));
      updateCard(card);
    });

    // Meter letters jump to their question
    meter.querySelectorAll('[data-meter]').forEach((tile) => {
      tile.addEventListener('click', (e) => {
        e.preventDefault();
        const textarea = document.getElementById(`grit-${tile.dataset.meter}`).querySelector('textarea');
        textarea.scrollIntoView({ behavior: 'smooth', block: 'center' });
        textarea.focus({ preventScroll: true });
      });
    });

    // Cards rise in as they scroll into view
    if ('IntersectionObserver' in window) {
      const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        });
      }, { threshold: 0.15 });
      cards.forEach((card) => observer.observe(card));
    } else {
      cards.forEach((card) => card.classList.add('is-visible'));
    }
  }

  return { setup };
})();

// Campus ambassador application
(function () {
  const form = document.getElementById('ambassador-form');
  if (!form) return;

  // G.R.I.T. letters fill as each answer grows; this many characters reads as a solid answer
  const SOLID = 200;
  gritKit.setup(form, {
    progress: (key, textarea) => {
      const p = Math.min(textarea.value.trim().length / SOLID, 1);
      // Innovative also needs a pillar picked before it counts as full
      return key === 'i' && !form.querySelector('input[name="pillar"]:checked') ? Math.min(p, 0.9) : p;
    },
    counter: (textarea) => `${textarea.value.length} / ${textarea.maxLength}`,
  });

  // Email layout, in the same order as the form
  const fields = [
    ['name', 'Name'], ['email', 'Email'], ['phone', 'WhatsApp'],
    ['university', 'University'], ['campus', 'Campus'], ['department', 'Faculty/department'],
    ['level', 'Level'], ['graduation', 'Expected graduation'],
    ['instagram', 'Instagram'], ['x', 'X'], ['linkedin', 'LinkedIn'],
    ['overlap', 'Someone already leading something similar on campus'], ['overlapDetails', 'Who / what'],
    ['grounded', 'G · Grounded: Why I want to lead'],
    ['resilient', 'R · Resilient: A time it fell apart'],
    ['pillar', 'I · Innovative: Pillar'],
    ['innovative', 'I · Innovative: First-month activity'],
    ['teachable', 'T · Teachable: Feedback that changed me'],
    ['reach', 'Network I can mobilize'], ['network', 'Where it comes from'],
    ['largest', 'Largest group gathered'], ['leadership', 'Past leadership'],
    ['partnership', 'Secured a sponsor/partner before'], ['partnershipDetails', 'Sponsor/partner details'],
    ['reporting', 'Written an event/impact report'],
    ['commitment', 'One activity a month + 2-day onboarding'], ['hours', 'Hours per week'],
    ['team', 'How I would build my team'],
  ];

  formKit.handleSubmit(form, {
    payload: (data) => {
      const out = {
        _subject: `Campus Ambassador application: ${data.get('name')} (${data.get('university')})`,
        _replyto: data.get('email'),
      };
      fields.forEach(([key, label]) => {
        out[label] = String(data.get(key) || '').trim() || '-';
      });
      return out;
    },
    thanks: {
      title: 'Application received. Thank you!',
      body: 'Your G.R.I.T. is on its way to our team. We’ll review every application and be in touch.',
    },
  });
})();

// Volunteer application: four steps (role, commitment, G.R.I.T., about you), saved on this
// device as the applicant goes, with an application ID to quote in every email about it.
// Without JS every step shows at once and the form posts straight to FormSubmit.
(function () {
  const form = document.getElementById('volunteer-form');
  if (!form) return;

  const WORD_LIMIT = 150;
  // A G.R.I.T. letter reads as full at this many words
  const SOLID_WORDS = 50;
  const DRAFT_KEY = 'b4w-volunteer-draft';

  const steps = Array.from(form.querySelectorAll('.apply__part[data-step]'));
  const stepper = form.querySelector('.stepper');
  const error = form.querySelector('.apply__error');
  const errorText = error.textContent;
  const back = form.querySelector('[data-back]');
  const next = form.querySelector('[data-next]');
  const submit = form.querySelector('[type="submit"]');
  const roles = Array.from(form.querySelectorAll('input[name="role"]'));
  const second = form.elements.secondRole;
  const roleQuestion = form.querySelector('[data-role-question]');
  let current = 0;

  const countWords = (text) => (text.match(/\S+/g) || []).length;

  // Storage can be blocked (private windows, strict settings); the form works without it
  const draft = {
    load() { try { return JSON.parse(localStorage.getItem(DRAFT_KEY)); } catch (e) { return null; } },
    save(data) { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(data)); } catch (e) { /* not saved */ } },
    clear() { try { localStorage.removeItem(DRAFT_KEY); } catch (e) { /* nothing to clear */ } },
  };

  // e.g. B4W-V-261031-7K3Q: the date plus four random characters (no 0/O or 1/I to misread)
  function newApplicationId() {
    const d = new Date();
    const date = [d.getFullYear() % 100, d.getMonth() + 1, d.getDate()].map((n) => String(n).padStart(2, '0')).join('');
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const rand = Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => chars[b % chars.length]).join('');
    return `B4W-V-${date}-${rand}`;
  }

  // Roles marked data-status="closed" stay on show but can't be a first or second choice
  const closed = new Set();
  roles.forEach((input) => {
    const card = input.closest('.role-option');
    if (card.dataset.status !== 'closed') return;
    input.disabled = true;
    card.querySelector('.role-option__status').textContent = 'Closed';
    closed.add(input.value);
  });

  function syncRole() {
    let picked = roles.find((input) => input.checked);
    if (picked && picked.disabled) { picked.checked = false; picked = null; }

    // The second choice can't repeat the first
    Array.from(second.options).forEach((option) => {
      option.disabled = option.value !== '' && (closed.has(option.value) || (!!picked && option.value === picked.value));
    });
    if (second.selectedOptions[0].disabled) second.value = '';

    // Some roles carry an extra question from their Lead
    const question = (picked && picked.dataset.question) || '';
    roleQuestion.hidden = !question;
    roleQuestion.querySelector('textarea').required = !!question;
    form.elements.roleQuestion.value = question;
    if (question) {
      roleQuestion.querySelector('[data-role-name]').textContent = picked.value;
      roleQuestion.querySelector('[data-role-text]').textContent = question;
    }
  }

  // 150-word limit, with a live count under every long answer
  function updateCount(textarea) {
    const words = countWords(textarea.value);
    const over = words > WORD_LIMIT;
    textarea.setCustomValidity(over ? `Please keep each answer to ${WORD_LIMIT} words or fewer.` : '');
    const counter = document.getElementById(textarea.getAttribute('aria-describedby'));
    counter.textContent = over ? `${words} / ${WORD_LIMIT} words. Please trim it down.` : `${words} / ${WORD_LIMIT} words`;
    counter.classList.toggle('is-over', over);
  }

  // Filled-in fields that still fail (too many words, a past start date, a mistyped email)
  // get the browser's specific message; empty ones get the general one
  function messageFor(field) {
    const filled = field.type !== 'radio' && field.type !== 'checkbox' && field.value.trim() !== '';
    return (filled && field.validationMessage) || errorText;
  }

  function save() {
    const fields = {};
    new FormData(form).forEach((value, key) => {
      if (!key.startsWith('_')) fields[key] = value;
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

  next.addEventListener('click', () => {
    const invalid = formKit.validate(form, steps[current]);
    error.textContent = invalid ? messageFor(invalid) : errorText;
    error.hidden = !invalid;
    if (invalid) {
      invalid.focus();
      return;
    }
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
    save();
  });
  form.addEventListener('change', () => {
    syncRole();
    save();
  });

  // Pick up where they left off, keeping the same application ID
  const saved = draft.load();
  if (saved) restore(saved);
  if (!form.elements.applicationId.value) form.elements.applicationId.value = newApplicationId();

  // Links like /volunteer?role=finance pre-select a role
  const preset = new URLSearchParams(location.search).get('role');
  const presetInput = preset && roles.find((input) => input.dataset.role === preset && !input.disabled);
  if (presetInput) presetInput.checked = true;

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

  // Email layout, in the same order as the form
  const fields = [
    ['applicationId', 'Application ID'],
    ['role', 'First choice'], ['secondRole', 'Second choice'],
    ['hours', 'Hours per week'], ['startDate', 'Can start'],
    ['commitment', 'Accepts the 6 month minimum'],
    ['grounded', 'G · Grounded: Kept showing up'],
    ['resilient', 'R · Resilient: When it got difficult'],
    ['innovative', 'I · Innovative: An untried idea for the role'],
    ['teachable', 'T · Teachable: Responding to tough feedback'],
    ['roleQuestion', 'Role question'], ['roleAnswer', 'Role answer'],
    ['name', 'Name'], ['email', 'Email'], ['phone', 'WhatsApp'],
    ['consent', 'Agrees to data being kept'],
  ];

  formKit.handleSubmit(form, {
    payload: (data) => {
      const out = {
        _subject: `Volunteer application ${data.get('applicationId')}: ${data.get('role')} (${data.get('name')})`,
        _replyto: data.get('email'),
      };
      fields.forEach(([key, label]) => {
        out[label] = String(data.get(key) || '').trim() || '-';
      });
      return out;
    },
    thanks: {
      title: 'Application received. Thank you!',
      get body() {
        return `Your application ID is <strong>${form.elements.applicationId.value}</strong>. Keep it handy; we’ll quote it whenever we email you about your application. If you move forward, your role challenge comes next, and you’ll have 72 hours to complete it.`;
      },
    },
    // A field that fails on submit may sit on another step: show that step first
    onInvalid: (field) => {
      const step = steps.findIndex((s) => s.contains(field));
      if (step !== -1 && step !== current) showStep(step, false);
      error.textContent = messageFor(field);
    },
    onSent: () => draft.clear(),
  });
})();
