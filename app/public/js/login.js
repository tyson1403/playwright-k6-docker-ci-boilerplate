import { $, api, clearErrors, fieldHtml, hideAlert, params, renderHeader, setFieldError, setSession, showAlert } from './common.js';

renderHeader('login');

const form = $('#login-form');
const alertEl = $('#login-alert');

$('#login-fields').innerHTML =
  fieldHtml({ id: 'email', label: 'Email', field: 'email', type: 'email', attrs: 'autocomplete="email"' }) +
  fieldHtml({ id: 'password', label: 'Password', field: 'password', type: 'password', attrs: 'autocomplete="current-password"' });

const REASONS = {
  idle: 'For your security, you were signed out after a period of inactivity. Please log in again.',
  expired: 'Your session has expired. Please log in again.',
};
if (REASONS[params.get('reason')]) showAlert(alertEl, REASONS[params.get('reason')], 'info');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearErrors(form);
  hideAlert(alertEl);
  const email = $('#email').value.trim();
  const password = $('#password').value;
  if (!email) setFieldError(form, 'email', 'Email is required');
  if (!password) setFieldError(form, 'password', 'Password is required');
  if (!email || !password) return;

  try {
    const { user, ...session } = await api('/auth/login', { method: 'POST', body: { email, password } });
    setSession({ user, ...session });
    const next = params.get('next');
    location.href = next && next.startsWith('/') && !next.startsWith('//') ? next : '/trips';
  } catch (err) {
    showAlert(alertEl, err.message);
  }
});
