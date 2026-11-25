// Shared sign-in for the applicant portal, challenge page and admin page.
// Email-only (a 6-digit code or a magic link), no passwords. The session lives
// in sessionStorage, so it ends when the tab closes (safer on shared computers).
// Requires vendor/supabase-*.js, which defines the global `supabase`.
const b4w = (function () {
  let clientPromise;

  function client() {
    if (!clientPromise) {
      clientPromise = fetch('/api/config', { headers: { Accept: 'application/json' } })
        .then((res) => res.json())
        .then((cfg) => {
          if (!cfg.ok) throw new Error(cfg.error || 'Portal not configured');
          return supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
            auth: {
              storage: window.sessionStorage,
              persistSession: true,
              autoRefreshToken: true,
              detectSessionInUrl: true, // magic links land with the session in the URL
              flowType: 'implicit',
            },
          });
        });
    }
    return clientPromise;
  }

  async function session() {
    const c = await client();
    const { data } = await c.auth.getSession();
    return data.session;
  }

  // Calls our API with the signed-in user's access token
  async function api(path, { method = 'GET', body } = {}) {
    const s = await session();
    let res;
    try {
      res = await fetch(path, {
        method,
        headers: {
          Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...(s ? { Authorization: `Bearer ${s.access_token}` } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      return { status: 0, ok: false, data: { error: 'We couldn’t reach our server. Check your connection and try again.' } };
    }
    const data = await res.json().catch(() => ({}));
    return { status: res.status, ok: res.ok && data.ok === true, data };
  }

  async function signOut() {
    const c = await client();
    await c.auth.signOut({ scope: 'local' });
  }

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };

  function lagosTime(iso) {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Africa/Lagos', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true,
    }).format(new Date(iso)) + ' (Lagos time)';
  }

  // Magic links that failed (expired, already used) come back with an error in the URL
  function linkError() {
    const params = new URLSearchParams(location.hash.slice(1) || location.search.slice(1));
    const message = params.get('error_description');
    if (!message) return '';
    history.replaceState(null, '', location.pathname);
    return /expired|invalid/i.test(message)
      ? 'That sign-in link has expired or was already used. Please ask for a new code.'
      : 'That sign-in link didn’t work. Please ask for a new code.';
  }

  // Two-step sign-in form: email, then the 6-digit code from the email
  function mountSignIn(root, { next = 'portal', title = 'Sign in', intro, onSignedIn }) {
    const box = el('div', 'signin');
    const heading = el('h2', 'signin__title', title);
    heading.tabIndex = -1;
    const lead = el('p', 'signin__intro', intro);
    const form = el('form', 'signin__form');
    form.noValidate = true;
    const status = el('p', 'signin__status');
    status.setAttribute('role', 'status');
    const errorBox = el('p', 'apply__error');
    errorBox.setAttribute('role', 'alert');
    errorBox.hidden = true;
    box.append(heading, lead, errorBox, form, status);
    root.replaceChildren(box);

    let email = '';
    const showError = (msg) => { errorBox.textContent = msg; errorBox.hidden = !msg; };
    const fromLink = linkError();
    if (fromLink) showError(fromLink);

    function field(id, label, attrs) {
      const wrap = el('div', 'field');
      const l = el('label', null, label);
      l.htmlFor = id;
      const input = el('input');
      input.id = id;
      Object.assign(input, attrs);
      wrap.append(l, input);
      return { wrap, input };
    }

    function emailStep() {
      const { wrap, input } = field('signin-email', 'Email address', { type: 'email', autocomplete: 'email', required: true, value: email });
      const button = el('button', 'btn btn--primary', 'Email me a sign-in code');
      button.type = 'submit';
      form.replaceChildren(wrap, button);
      form.onsubmit = async (e) => {
        e.preventDefault();
        email = input.value.trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
          input.setAttribute('aria-invalid', 'true');
          showError('Please enter a valid email address.');
          input.focus();
          return;
        }
        input.setAttribute('aria-invalid', 'false');
        showError('');
        button.disabled = true;
        button.textContent = 'Sending…';
        const res = await api('/api/auth/otp', { method: 'POST', body: { email, next } });
        button.disabled = false;
        button.textContent = 'Email me a sign-in code';
        if (!res.ok) {
          showError(res.data.error || 'Sorry, that didn’t work. Please try again.');
          return;
        }
        codeStep(res.data.message);
      };
    }

    function codeStep(message) {
      const note = el('p', 'signin__note', message);
      const hint = el('p', 'signin__note', 'Type the 6-digit code below, or click the sign-in link in the email. Check your spam folder if it hasn’t arrived in a minute.');
      const { wrap, input } = field('signin-code', '6-digit code', {
        type: 'text', inputMode: 'numeric', autocomplete: 'one-time-code', maxLength: 6, required: true, pattern: '[0-9]{6}',
      });
      input.classList.add('signin__code');
      const button = el('button', 'btn btn--primary', 'Sign in');
      button.type = 'submit';
      const again = el('button', 'text-button', 'Use a different email');
      again.type = 'button';
      again.onclick = () => { showError(''); status.textContent = ''; emailStep(); form.querySelector('input').focus(); };
      const actions = el('div', 'signin__actions');
      actions.append(button, again);
      form.replaceChildren(note, hint, wrap, actions);
      input.focus();
      status.textContent = 'Code sent.';

      form.onsubmit = async (e) => {
        e.preventDefault();
        const token = input.value.replace(/\D/g, '');
        if (token.length !== 6) {
          input.setAttribute('aria-invalid', 'true');
          showError('Please enter the 6-digit code from the email.');
          input.focus();
          return;
        }
        showError('');
        button.disabled = true;
        button.textContent = 'Signing in…';
        try {
          const c = await client();
          const { error } = await c.auth.verifyOtp({ email, token, type: 'email' });
          if (error) throw error;
          status.textContent = 'Signed in.';
          onSignedIn();
        } catch (err) {
          button.disabled = false;
          button.textContent = 'Sign in';
          input.setAttribute('aria-invalid', 'true');
          showError(/rate|too many/i.test(err.message || '')
            ? 'Too many tries. Please wait a few minutes and ask for a new code.'
            : 'That code didn’t work. It may have expired; you can ask for a new one.');
          input.focus();
        }
      };
    }

    emailStep();
  }

  // Shows sign-in until there's a session, then calls `ready`
  async function requireSignIn(root, options, ready) {
    let s = null;
    try {
      s = await session();
    } catch (err) {
      root.replaceChildren(el('p', 'apply__error', 'The applicant portal isn’t available right now. Please try again later.'));
      return;
    }
    if (s) return ready();
    mountSignIn(root, { ...options, onSignedIn: ready });
  }

  return { client, session, api, signOut, el, lagosTime, requireSignIn };
})();
