import { $, api, escapeHtml, getSession, renderHeader } from './common.js';
import { bookingSummaryHtml } from './booking-view.js';

renderHeader('trips');

const container = $('#trips');

async function init() {
  if (!getSession()) {
    location.href = '/login?next=/trips';
    return;
  }
  try {
    const { bookings } = await api('/bookings');
    if (!bookings.length) {
      container.innerHTML = '<div class="card" data-testid="no-trips"><h2>No trips yet</h2><p>When you book while logged in, your trips appear here.</p><a class="btn" href="/">Book a flight</a></div>';
      return;
    }
    const cards = await Promise.all(bookings.map(bookingSummaryHtml));
    container.innerHTML = cards.join('');
  } catch (err) {
    if (err.status === 401) return; // api() is already sending the customer to log in
    container.innerHTML = `<div class="alert alert-error" role="alert">${escapeHtml(err.message)}</div>`;
  }
}

init();
