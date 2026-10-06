import { $, api, clearErrors, fieldHtml, fmtMoney, hideAlert, params, renderHeader, setFieldError, showAlert } from './common.js';
import { bookingSummaryHtml } from './booking-view.js';

renderHeader('manage');

const form = $('#retrieve-form');
const alertEl = $('#retrieve-alert');
const details = $('#booking-details');
const dialog = $('#cancel-dialog');

$('#retrieve-fields').innerHTML =
  fieldHtml({ id: 'pnr', label: 'Booking reference', field: 'pnr', attrs: 'maxlength="6" autocomplete="off" style="text-transform:uppercase"' }) +
  fieldHtml({ id: 'last-name', label: 'Last name', field: 'lastName', attrs: 'autocomplete="family-name"' });

let current = null;

const REFUND_TEXT = {
  SAVER: 'Saver fares are non-refundable; only airport taxes will be refunded.',
  STANDARD: 'Standard fares are refunded less a cancellation fee per passenger.',
  FLEX: 'Flex fares are fully refundable.',
};

async function render(booking) {
  current = booking;
  const canCancel = booking.status === 'CONFIRMED' && !booking.passengers.some((p) => p.checkedIn);
  const query = new URLSearchParams({ pnr: booking.pnr, lastName: $('#last-name').value.trim() });
  details.innerHTML = `
    ${await bookingSummaryHtml(booking)}
    <div class="actions">
      ${booking.checkin?.open && !booking.passengers.every((p) => p.checkedIn) ? `<a class="btn" href="/checkin?${query}" data-testid="checkin-link">Check in now</a>` : ''}
      ${canCancel ? '<button class="btn btn-danger" type="button" id="cancel-button" data-testid="cancel-button">Cancel booking</button>' : ''}
    </div>`;
  $('#cancel-button')?.addEventListener('click', () => {
    $('#cancel-dialog-text').textContent = `${REFUND_TEXT[booking.fare]} This cannot be undone.`;
    dialog.showModal();
  });
}

async function retrieve(pnr, lastName) {
  clearErrors(form);
  hideAlert(alertEl);
  details.innerHTML = '';
  let invalid = false;
  if (!/^[A-Z0-9]{6}$/i.test(pnr)) {
    setFieldError(form, 'pnr', 'Booking reference must be 6 letters or numbers');
    invalid = true;
  }
  if (!lastName) {
    setFieldError(form, 'lastName', 'Last name is required');
    invalid = true;
  }
  if (invalid) return;
  try {
    await render(await api(`/bookings/${encodeURIComponent(pnr.toUpperCase())}?lastName=${encodeURIComponent(lastName)}`));
  } catch (err) {
    showAlert(alertEl, err.status === 404 ? 'We could not find a booking with those details. Please check and try again.' : err.message);
  }
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  retrieve($('#pnr').value.trim(), $('#last-name').value.trim());
});

$('#dismiss-cancel').addEventListener('click', () => dialog.close());

$('#confirm-cancel').addEventListener('click', async () => {
  const button = $('#confirm-cancel');
  button.disabled = true;
  try {
    const booking = await api(`/bookings/${current.pnr}/cancel`, { method: 'POST', body: { lastName: $('#last-name').value.trim() } });
    dialog.close();
    await render(booking);
    showAlert(alertEl, `Your booking has been cancelled. ${fmtMoney(booking.refund.amount, booking.refund.currency)} will be refunded to your card.`, 'success');
  } catch (err) {
    dialog.close();
    showAlert(alertEl, err.message);
  } finally {
    button.disabled = false;
  }
});

if (params.get('pnr') && params.get('lastName')) {
  $('#pnr').value = params.get('pnr');
  $('#last-name').value = params.get('lastName');
  retrieve(params.get('pnr'), params.get('lastName'));
}
