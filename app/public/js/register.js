import { $, api, clearErrors, fieldHtml, hideAlert, renderHeader, setSession, showApiError } from './common.js';

renderHeader('register');

const form = $('#register-form');
const alertEl = $('#register-alert');

$('#register-fields').innerHTML =
  fieldHtml({ id: 'first-name', label: 'First name', field: 'firstName', attrs: 'autocomplete="given-name"' }) +
  fieldHtml({ id: 'last-name', label: 'Last name', field: 'lastName', attrs: 'autocomplete="family-name"' }) +
  fieldHtml({ id: 'email', label: 'Email', field: 'email', type: 'email', attrs: 'autocomplete="email"' }) +
  fieldHtml({ id: 'password', label: 'Password', field: 'password', type: 'password', attrs: 'autocomplete="new-password"' });

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearErrors(form);
  hideAlert(alertEl);
  const body = {
    firstName: $('#first-name').value.trim(),
    lastName: $('#last-name').value.trim(),
    email: $('#email').value.trim(),
    password: $('#password').value,
  };
  try {
    const { token, user } = await api('/auth/register', { method: 'POST', body });
    setSession({ token, user });
    location.href = '/trips';
  } catch (err) {
    showApiError(form, alertEl, err);
  }
});
