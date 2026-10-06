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
    if (res.status === 401 && session) clearSession();
    throw new ApiRequestError(res.status, data);
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

  $('#logout-button')?.addEventListener('click', async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } catch {
      /* session may already be gone */
    }
    clearSession();
    location.href = '/';
  });
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
