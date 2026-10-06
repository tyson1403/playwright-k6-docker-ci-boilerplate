import { $, api, escapeHtml, params, renderHeader } from './common.js';
import { bookingSummaryHtml } from './booking-view.js';

renderHeader('home');

const container = $('#confirmation');
const pnr = params.get('pnr');
const lastName = params.get('lastName');

async function init() {
  try {
    const booking = await api(`/bookings/${encodeURIComponent(pnr)}?lastName=${encodeURIComponent(lastName)}`);
    container.innerHTML = `
      <div class="alert alert-success" role="status" data-testid="confirmation-message">
        Your booking is confirmed. A confirmation has been sent to <strong>${escapeHtml(booking.contact.email)}</strong>.
      </div>
      ${await bookingSummaryHtml(booking)}
      <div class="actions">
        <a class="btn btn-secondary" href="/manage?${new URLSearchParams({ pnr: booking.pnr, lastName })}" data-testid="manage-link">Manage booking</a>
        <a class="btn btn-secondary" href="/" data-testid="book-another">Book another flight</a>
      </div>`;
  } catch (err) {
    container.innerHTML = `<div class="alert alert-error" role="alert" data-testid="confirmation-error">${escapeHtml(err.message)}</div>`;
  }
}

init();
