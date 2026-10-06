// Shared helpers for every page: API client, session, header, formatting.
const SESSION_KEY = 'skylane.session';

export class ApiRequestError extends Error {
  constructor(status, body) {
    super(body?.error?.message || `Request failed (${status})`);
    this.status = status;
    this.code = body?.error?.code;
    this.details = body?.error?.details || [];
  }
}

export function getSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY));
  } catch {
    return null;
  }
}

export function setSession(session) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

/** Sends the customer to log in again, then back to where they were. */
export function redirectToLogin(reason) {
  if (location.pathname === '/login') return;
  const next = `${location.pathname}${location.search}`;
  location.href = `/login?${new URLSearchParams({ reason, next })}`;
}

export async function api(path, { method = 'GET', body, headers = {} } = {}) {
  const session = getSession();
  const res = await fetch(`/api${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(session?.token ? { Authorization: `Bearer ${session.token}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const error = new ApiRequestError(res.status, data);
    // A logged-in request was rejected: the session timed out or was revoked.
    if (res.status === 401 && session) {
      clearSession();
      redirectToLogin('expired');
    }
    throw error;
  }
  return data;
}

export const params = new URLSearchParams(location.search);
export const $ = (selector, root = document) => root.querySelector(selector);

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

const NAV = [
  { href: '/', label: 'Book', page: 'home' },
  { href: '/manage', label: 'Manage booking', page: 'manage' },
  { href: '/checkin', label: 'Check-in', page: 'checkin' },
];

export function renderHeader(activePage) {
  const session = getSession();
  const links = NAV.map(
    (n) => `<a href="${n.href}" data-testid="nav-${n.page}" ${n.page === activePage ? 'aria-current="page"' : ''}>${n.label}</a>`,
  ).join('');
  const account = session
    ? `<a href="/trips" data-testid="nav-trips" ${activePage === 'trips' ? 'aria-current="page"' : ''}>My trips</a>
       <span class="user-chip" data-testid="user-greeting">Hi, ${escapeHtml(session.user.firstName)}</span>
       <button type="button" data-testid="logout-button" id="logout-button">Log out</button>`
    : `<a href="/login" data-testid="nav-login" ${activePage === 'login' ? 'aria-current="page"' : ''}>Log in</a>
       <a href="/register" data-testid="nav-register" ${activePage === 'register' ? 'aria-current="page"' : ''}>Sign up</a>`;

  document.querySelector('header.site-header').innerHTML = `
    <a class="skip-link" href="#main">Skip to content</a>
    <div class="container inner">
      <a class="brand" href="/" data-testid="brand">SkyLane<span>Air</span></a>
      <nav class="site-nav" aria-label="Main">${links}${account}</nav>
    </div>`;

  $('#logout-button')?.addEventListener('click', () => logout('/'));
  if (session) watchSession(session, activePage);
}

export async function logout(destination) {
  try {
    await fetch('/api/auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${getSession()?.token}` } });
  } catch {
    /* the session may already be gone on the server */
  }
  clearSession();
  location.href = destination;
}

// ---------- session timeout ----------
// The server ends a session after a period of inactivity (sliding) and after an
// absolute lifetime. The browser mirrors that: activity sends a keep-alive, a
// warning appears shortly before the idle limit, and the customer is signed out
// when it is reached.
const WARNING_MS = 60_000;
const KEEPALIVE_MS = 30_000;

let watching = false;

async function watchSession(session, activePage) {
  if (watching) return;
  watching = true;

  // Confirm the session is still valid (this also counts as activity on the server).
  const res = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${session.token}` } }).catch(() => null);
  if (res?.status === 401) {
    clearSession();
    renderHeader(activePage);
    showSessionNotice('Your session has expired. Please log in again.');
    return;
  }
  if (res?.ok) {
    const { session: times } = await res.json();
    session = { ...session, ...times };
    setSession(session);
  }

  const idleMs = (session.idleTimeoutSeconds || 900) * 1000;
  const absoluteEnd = session.expiresAt ? Date.parse(session.expiresAt) : Infinity;
  let lastActivity = Date.now();
  let lastKeepAlive = Date.now();
  const dialog = sessionDialog();

  const keepAlive = () => {
    lastKeepAlive = Date.now();
    return api('/auth/me');
  };

  const onActivity = () => {
    if (dialog.open) return; // while warned, only "Stay signed in" extends the session
    lastActivity = Date.now();
    if (Date.now() - lastKeepAlive > KEEPALIVE_MS) keepAlive().catch(() => {});
  };
  for (const type of ['click', 'keydown', 'scroll', 'touchstart']) addEventListener(type, onActivity, { passive: true });

  $('#stay-signed-in', dialog).addEventListener('click', async () => {
    try {
      await keepAlive();
      lastActivity = Date.now();
      dialog.close();
    } catch {
      /* api() redirects to login if the session already expired */
    }
  });
  $('#session-logout', dialog).addEventListener('click', () => logout('/'));

  const timer = setInterval(() => {
    const now = Date.now();
    const deadline = Math.min(lastActivity + idleMs, absoluteEnd);
    const remaining = deadline - now;
    if (remaining <= 0) {
      clearInterval(timer);
      const reason = now >= absoluteEnd ? 'expired' : 'idle';
      logout(`/login?${new URLSearchParams({ reason, next: `${location.pathname}${location.search}` })}`);
      return;
    }
    if (remaining <= WARNING_MS) {
      $('#session-countdown', dialog).textContent = String(Math.ceil(remaining / 1000));
      if (!dialog.open) dialog.showModal();
    }
  }, 1000);
  document.body.dataset.sessionWatch = 'active'; // lets tests know the timer is running
}

function sessionDialog() {
  let dialog = $('#session-dialog');
  if (dialog) return dialog;
  dialog = document.createElement('dialog');
  dialog.id = 'session-dialog';
  dialog.dataset.testid = 'session-dialog';
  dialog.setAttribute('aria-labelledby', 'session-dialog-title');
  dialog.setAttribute('aria-describedby', 'session-dialog-text');
  dialog.innerHTML = `
    <h2 id="session-dialog-title">Are you still there?</h2>
    <p id="session-dialog-text">For your security, you will be signed out in
      <strong><span id="session-countdown" data-testid="session-countdown">60</span> seconds</strong> due to inactivity.</p>
    <div class="actions">
      <button class="btn" type="button" id="stay-signed-in" data-testid="stay-signed-in">Stay signed in</button>
      <button class="btn btn-secondary" type="button" id="session-logout" data-testid="session-logout">Log out now</button>
    </div>`;
  // Escape would otherwise close the dialog without extending the session.
  dialog.addEventListener('cancel', (e) => e.preventDefault());
  document.body.append(dialog);
  return dialog;
}

function showSessionNotice(message) {
  const main = $('main');
  if (!main || $('[data-testid="session-notice"]')) return;
  const notice = document.createElement('div');
  notice.className = 'alert alert-info';
  notice.setAttribute('role', 'status');
  notice.dataset.testid = 'session-notice';
  notice.innerHTML = `${escapeHtml(message)} <a href="/login?next=${encodeURIComponent(location.pathname + location.search)}">Log in</a>`;
  main.prepend(notice);
}

// ---------- formatting ----------
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Times are returned as local ISO strings ("2026-10-07T16:55:00+04:00"); show them as-is. */
export const fmtTime = (localIso) => localIso.slice(11, 16);

export function fmtDate(isoDate) {
  const [y, m, d] = isoDate.slice(0, 10).split('-').map(Number);
  const weekday = DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${weekday}, ${d} ${MONTHS[m - 1]} ${y}`;
}

export const fmtDuration = (minutes) => `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;

export const fmtMoney = (amount, currency = 'AED') => `${currency} ${Number(amount).toLocaleString('en-US')}`;

export function dayOffset(departureIso, arrivalIso) {
  const diff = (Date.parse(arrivalIso.slice(0, 10)) - Date.parse(departureIso.slice(0, 10))) / 86_400_000;
  return diff > 0 ? `+${diff}` : '';
}

// ---------- airports ----------
let airportsPromise;
export function loadAirports() {
  airportsPromise ??= api('/airports').then((r) => r.airports);
  return airportsPromise;
}

export async function airportLabel(code) {
  const airport = (await loadAirports()).find((a) => a.code === code);
  return airport ? `${airport.city} (${airport.code})` : code;
}

// ---------- form feedback ----------
export function clearErrors(root) {
  root.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
  root.querySelectorAll('.field-error').forEach((el) => (el.textContent = ''));
}

/** Shows an error under a field. `name` matches the input's data-field attribute. */
export function setFieldError(root, name, message) {
  const input = root.querySelector(`[data-field="${name}"]`);
  if (!input) return false;
  input.setAttribute('aria-invalid', 'true');
  const error = document.getElementById(input.getAttribute('aria-describedby'));
  if (error) error.textContent = message;
  return true;
}

export function showAlert(target, message, type = 'error') {
  target.className = `alert alert-${type}`;
  target.textContent = message;
  target.setAttribute('role', type === 'error' ? 'alert' : 'status');
  target.classList.remove('hidden');
}

export function hideAlert(target) {
  target.classList.add('hidden');
  target.textContent = '';
}

/** Renders a server error: field-level details next to inputs, the rest in the alert. */
export function showApiError(form, alertEl, err) {
  const unmatched = (err.details || []).filter((d) => !setFieldError(form, d.field, d.message));
  const extra = unmatched.map((d) => d.message).join(' ');
  showAlert(alertEl, extra ? `${err.message}: ${extra}` : err.message);
}

export function fieldHtml({ id, label, field, type = 'text', attrs = '', options }) {
  const control = options
    ? `<select id="${id}" name="${id}" data-field="${field}" data-testid="${id}" aria-describedby="${id}-error" ${attrs}>${options}</select>`
    : `<input id="${id}" name="${id}" type="${type}" data-field="${field}" data-testid="${id}" aria-describedby="${id}-error" ${attrs} />`;
  return `<div class="field"><label for="${id}">${label}</label>${control}<span class="field-error" id="${id}-error" data-testid="${id}-error"></span></div>`;
}

/** Local date (YYYY-MM-DD) in Dubai time, the hub's time zone. */
export function todayInDubai() {
  return new Date(Date.now() + 4 * 3_600_000).toISOString().slice(0, 10);
}
