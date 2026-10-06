import { $, api, clearErrors, fieldHtml, hideAlert, params, renderHeader, setFieldError, setSession, showAlert } from './common.js';

renderHeader('login');

const form = $('#login-form');
const alertEl = $('#login-alert');

$('#login-fields').innerHTML =
  fieldHtml({ id: 'email', label: 'Email', field: 'email', type: 'email', attrs: 'autocomplete="email"' }) +
  fieldHtml({ id: 'password', label: 'Password', field: 'password', type: 'password', attrs: 'autocomplete="current-password"' });

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
    const { token, user } = await api('/auth/login', { method: 'POST', body: { email, password } });
    setSession({ token, user });
    const next = params.get('next');
    location.href = next && next.startsWith('/') && !next.startsWith('//') ? next : '/trips';
  } catch (err) {
    showAlert(alertEl, err.message);
  }
});
