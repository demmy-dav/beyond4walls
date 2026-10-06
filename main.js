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

// Registration links that don't have a real URL yet shouldn't open a blank tab
document.querySelectorAll('[data-register]').forEach((link) => {
  if (link.getAttribute('href') === '#') {
    link.addEventListener('click', (e) => e.preventDefault());
  }
});

// Forms (contact, campus ambassadors). The site has no backend, so submissions
// go through FormSubmit, which emails them to our inbox. Each form's plain
// action attribute is the no-JS fallback.
const formKit = (function () {
  const INBOX = 'https://formsubmit.co/ajax/hello@beyond4wallsed.org';
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

  // Marks every required field and returns the first invalid one, if any
  function validate(form) {
    let firstInvalid = null;
    form.querySelectorAll('[required], input[type="radio"]').forEach((field) => {
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

  // Validates, sends `payload()` to the inbox, then swaps the form for a thank-you note
  function handleSubmit(form, { payload, thanks }) {
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
        firstInvalid.focus();
        return;
      }

      button.disabled = true;
      button.textContent = 'Sending…';
      status.textContent = '';
      try {
        const res = await fetch(INBOX, {
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
      } catch (err) {
        console.error('Form submission failed:', err);
        showFailure(status);
        button.disabled = false;
        button.textContent = label;
      }
    });
  }

  return { handleSubmit };
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

// Campus ambassador application
(function () {
  const form = document.getElementById('ambassador-form');
  if (!form) return;
  const meter = form.querySelector('.grit-meter');

  // G.R.I.T. letters fill as each answer grows; this many characters reads as a solid answer
  const SOLID = 200;
  const cards = Array.from(form.querySelectorAll('[data-grit]'));

  function updateCard(card) {
    const key = card.dataset.grit;
    const textarea = card.querySelector('textarea');
    const len = textarea.value.trim().length;
    let p = Math.min(len / SOLID, 1);
    // Innovative also needs a pillar picked before it counts as full
    if (key === 'i' && !form.querySelector('input[name="pillar"]:checked')) p = Math.min(p, 0.9);

    const tile = meter.querySelector(`[data-meter="${key}"]`);
    [card, tile].forEach((el) => {
      el.style.setProperty('--p', p);
      el.classList.toggle('is-full', p === 1);
    });
    card.querySelector('.counter').textContent = `${textarea.value.length} / ${textarea.maxLength}`;
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
