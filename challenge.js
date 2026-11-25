// Role challenge (Stage 4): the brief appears only once it's released, with a
// 72-hour countdown from due_at (using the server's clock, not the device's).
// Text and/or one file (5 MB; pdf, doc, docx, png, jpg, txt). The form locks
// at the deadline here, and the API refuses late submissions regardless.
(function () {
  const root = document.getElementById('challenge-root');
  if (!root) return;
  const { el, api, lagosTime, requireSignIn } = b4w;

  const MAX_BYTES = 5 * 1024 * 1024;
  const MAX_TEXT = 10000;
  const TYPES = {
    pdf: 'application/pdf', doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', txt: 'text/plain',
  };
  const PRACTICE = 'Challenges are always practice tasks. We never use an applicant’s submission as real work for Beyond4walls.';
  let timer = null;

  const extOf = (name) => (/\.([a-z0-9]{1,5})$/i.exec(name) || [])[1]?.toLowerCase() || '';
  const sizeText = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

  function practiceNote() {
    const note = el('p', 'practice-note');
    note.append(el('strong', null, 'Practice task. '), PRACTICE);
    return note;
  }

  function remainingText(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return `${h}h ${String(m).padStart(2, '0')}m ${String(sec).padStart(2, '0')}s`;
  }

  function submittedView(sub) {
    const box = el('div', 'challenge-done');
    box.append(el('h3', 'portal-next__title', 'Submitted'));
    box.append(el('p', null, `We received your submission on ${lagosTime(sub.submittedAt)}. It’s locked now, and our team will review it.`));
    if (sub.text) {
      box.append(el('h4', 'challenge-sub__label', 'Your written answer'));
      box.append(el('p', 'challenge-sub__text', sub.text));
    }
    if (sub.file) {
      const p = el('p');
      const a = el('a', 'text-link', `${sub.file.name} (${sizeText(sub.file.size)})`);
      a.href = sub.file.url;
      a.rel = 'noopener';
      a.target = '_blank';
      p.append('Your file: ', a);
      box.append(p);
    }
    return box;
  }

  function closedView(dueAt) {
    const box = el('div', 'challenge-closed');
    box.append(el('h3', 'portal-next__title', 'Submissions are closed'));
    box.append(el('p', null, `The 72-hour deadline passed on ${lagosTime(dueAt)}, so this challenge can no longer be submitted.`));
    return box;
  }

  function submitForm(challenge, offset, onDone) {
    const form = el('form', 'challenge-form');
    form.noValidate = true;
    form.append(el('h3', 'portal-next__title', 'Your submission'));
    form.append(el('p', 'part-intro', 'Write your answer, upload a file, or both. You can submit once; it locks as soon as you send it.'));

    const textField = el('div', 'field');
    const tl = el('label', null, 'Written answer');
    tl.htmlFor = 'ch-text';
    const textarea = el('textarea');
    Object.assign(textarea, { id: 'ch-text', rows: 10, maxLength: MAX_TEXT });
    const count = el('span', 'counter', `0 / ${MAX_TEXT.toLocaleString('en')} characters`);
    count.id = 'ch-text-count';
    textarea.setAttribute('aria-describedby', 'ch-text-count');
    textarea.addEventListener('input', () => { count.textContent = `${textarea.value.length.toLocaleString('en')} / ${MAX_TEXT.toLocaleString('en')} characters`; });
    textField.append(tl, textarea, count);

    const fileField = el('div', 'field');
    const fl = el('label', null, 'Upload a file ');
    fl.append(el('span', 'field__optional', '(optional: PDF, Word, PNG, JPG or text, up to 5 MB)'));
    fl.htmlFor = 'ch-file';
    const file = el('input');
    Object.assign(file, { id: 'ch-file', type: 'file', accept: '.pdf,.doc,.docx,.png,.jpg,.jpeg,.txt' });
    fileField.append(fl, file);

    const error = el('p', 'apply__error');
    error.setAttribute('role', 'alert');
    error.hidden = true;
    const status = el('p', 'apply__status');
    status.setAttribute('role', 'status');
    const button = el('button', 'btn btn--primary', 'Submit challenge');
    button.type = 'submit';
    const foot = el('div', 'apply__foot');
    foot.append(error, status, button);
    form.append(textField, fileField, foot);

    const showError = (msg) => { error.textContent = msg; error.hidden = !msg; };
    // At the deadline the form is disabled and hidden; the closed notice replaces it
    const lock = () => { [textarea, file, button].forEach((c) => { c.disabled = true; }); form.hidden = true; };
    form.lock = lock;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      showError('');
      if (Date.now() + offset >= Date.parse(challenge.dueAt)) {
        lock();
        form.replaceWith(closedView(challenge.dueAt));
        return;
      }
      const text = textarea.value.trim();
      const picked = file.files[0];
      if (!text && !picked) {
        showError('Please write your answer or upload a file.');
        textarea.focus();
        return;
      }
      if (picked) {
        const ext = extOf(picked.name);
        if (!TYPES[ext]) { showError('Please upload a PDF, Word document (.doc or .docx), PNG, JPG or text file.'); file.focus(); return; }
        if (picked.size > MAX_BYTES) { showError('Files can be up to 5 MB. Please make it smaller and try again.'); file.focus(); return; }
        if (picked.size === 0) { showError('That file looks empty.'); file.focus(); return; }
      }

      button.disabled = true;
      button.textContent = 'Sending…';
      const restore = () => { button.disabled = false; button.textContent = 'Submit challenge'; status.textContent = ''; };
      let filePath = '';
      if (picked) {
        status.textContent = 'Uploading your file…';
        const type = TYPES[extOf(picked.name)];
        const up = await api('/api/challenge/upload-url', { method: 'POST', body: { fileName: picked.name, fileType: type, fileSize: picked.size } });
        if (!up.ok) { restore(); showError(up.data.error || 'We couldn’t upload your file. Please try again.'); return; }
        try {
          const put = await fetch(up.data.uploadUrl, { method: 'PUT', headers: { 'Content-Type': up.data.contentType }, body: picked });
          if (!put.ok) throw new Error(String(put.status));
        } catch (err) {
          restore();
          showError('Your file didn’t upload. Please check your connection and try again.');
          return;
        }
        filePath = up.data.path;
      }
      status.textContent = 'Submitting…';
      const res = await api('/api/challenge/submit', { method: 'POST', body: { text, filePath, fileName: picked ? picked.name : '' } });
      if (!res.ok) {
        restore();
        if (res.data.code === 'deadline_passed') {
          lock();
          form.replaceWith(closedView(challenge.dueAt));
          return;
        }
        showError(res.data.error || 'We couldn’t save your submission. Please try again.');
        return;
      }
      onDone();
    });
    return form;
  }

  async function load() {
    clearInterval(timer);
    root.replaceChildren(el('p', 'portal-loading', 'Loading your challenge…'));
    const res = await api('/api/portal');
    if (res.status === 401) { await b4w.signOut(); return start(); }
    if (!res.ok) {
      root.replaceChildren(practiceNote(), el('p', 'apply__error', res.data.error || 'We couldn’t load your challenge. Please refresh to try again.'));
      return;
    }
    const { challenge, submission, application } = res.data;
    const offset = Date.parse(res.data.serverNow) - Date.now();
    const view = el('div', 'challenge');
    const heading = el('h2', 'portal__title');
    heading.tabIndex = -1;
    view.append(heading, practiceNote());

    if (!application || !challenge) {
      heading.textContent = 'Your challenge hasn’t been released yet';
      const p = el('p');
      const link = el('a', 'text-link', 'applicant portal');
      link.href = '/portal';
      p.append('We’ll email you when it is. You can follow your application in the ', link, '.');
      view.append(p);
      root.replaceChildren(view);
      heading.focus();
      return;
    }

    heading.textContent = challenge.title;
    const brief = el('div', 'challenge-brief');
    brief.append(el('p', 'challenge-brief__text', challenge.brief));
    if (challenge.resources) {
      brief.append(el('h3', 'challenge-sub__label', 'Resources'), el('p', 'challenge-brief__text', challenge.resources));
    }
    view.append(brief);

    const due = Date.parse(challenge.dueAt);
    const clock = el('div', 'countdown');
    const clockLabel = el('p', 'countdown__label', 'Time left');
    const clockValue = el('p', 'countdown__value');
    clockValue.setAttribute('aria-hidden', 'true'); // ticking every second would flood screen readers
    const clockDue = el('p', 'countdown__due', `Deadline: ${lagosTime(challenge.dueAt)}`);
    clock.append(clockLabel, clockValue, clockDue);

    if (submission) {
      view.append(submittedView(submission));
    } else if (Date.now() + offset >= due) {
      view.append(closedView(challenge.dueAt));
    } else {
      view.append(clock);
      const form = submitForm(challenge, offset, load);
      view.append(form);
      const tick = () => {
        const left = due - (Date.now() + offset);
        clockValue.textContent = remainingText(left);
        clock.classList.toggle('is-urgent', left < 6 * 3600 * 1000);
        if (left <= 0) {
          clearInterval(timer);
          form.lock();
          clock.replaceWith(closedView(challenge.dueAt));
        }
      };
      tick();
      timer = setInterval(tick, 1000);
    }
    root.replaceChildren(view);
    heading.focus();
  }

  function start() {
    requireSignIn(root, {
      next: 'challenge',
      title: 'Sign in to open your challenge',
      intro: 'Use the email address you applied with. We’ll email you a 6-digit code and a sign-in link.',
    }, load);
  }

  start();
})();
