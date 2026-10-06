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

// Campus ambassador form: there is no backend, so validate and hand the
// answers to WhatsApp as a pre-filled message.
(function () {
  const form = document.getElementById('ambassador-form');
  if (!form) return;
  const error = form.querySelector('.apply__error');

  const labels = {
    name: 'Name',
    phone: 'Phone',
    email: 'Email',
    school: 'School',
    course: 'Course',
    level: 'Level',
    social: 'Social handle',
    why: 'Why I want to be an ambassador',
  };

  form.addEventListener('submit', (e) => {
    e.preventDefault();

    let firstInvalid = null;
    form.querySelectorAll('input, select, textarea').forEach((field) => {
      const valid = field.checkValidity() && (!field.required || field.value.trim() !== '');
      field.setAttribute('aria-invalid', String(!valid));
      if (!valid && !firstInvalid) firstInvalid = field;
    });
    error.hidden = !firstInvalid;
    if (firstInvalid) {
      firstInvalid.focus();
      return;
    }

    const data = new FormData(form);
    const lines = ['Hi Beyond 4walls, I would like to be a campus ambassador.', ''];
    Object.entries(labels).forEach(([key, label]) => {
      const value = String(data.get(key) || '').trim();
      if (value) lines.push(`${label}: ${value}`);
    });

    const url = 'https://wa.me/2349043606531?text=' + encodeURIComponent(lines.join('\n'));
    window.open(url, '_blank', 'noopener');
  });
})();
