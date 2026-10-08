import {
  $, api, airportLabel, clearErrors, escapeHtml, fieldHtml, fmtDate, fmtDuration, fmtMoney, fmtTime,
  getSession, hideAlert, params, renderHeader, setFieldError, showAlert, showApiError,
} from './common.js';

renderHeader('home');

const form = $('#booking-form');
const alertEl = $('#book-alert');
const payButton = $('#pay-button');
const extraBag = $('#extra-bag');
const flightId = params.get('flightId');
const fare = params.get('fare');
const pax = Number(params.get('passengers') || 1);
// One key per page load: a double-submit or retry can never create two bookings.
// (crypto.randomUUID only exists on HTTPS/localhost; getRandomValues works everywhere.)
const idempotencyKey = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');

const TITLE_OPTIONS = '<option value="">Select</option><option value="MR">Mr</option><option value="MRS">Mrs</option><option value="MS">Ms</option>';

function renderForm() {
  $('#passenger-fields').innerHTML = Array.from({ length: pax }, (_, i) => `
    <fieldset class="passenger-block" data-testid="passenger-${i + 1}">
      <legend>Passenger ${i + 1} (adult)</legend>
      <div class="form-grid">
        ${fieldHtml({ id: `p${i}-title`, label: 'Title', field: `passengers[${i}].title`, options: TITLE_OPTIONS })}
        ${fieldHtml({ id: `p${i}-first-name`, label: 'First name', field: `passengers[${i}].firstName`, attrs: 'autocomplete="given-name"' })}
        ${fieldHtml({ id: `p${i}-last-name`, label: 'Last name', field: `passengers[${i}].lastName`, attrs: 'autocomplete="family-name"' })}
      </div>
    </fieldset>`).join('');

  $('#contact-fields').innerHTML =
    fieldHtml({ id: 'contact-email', label: 'Email', field: 'contact.email', type: 'email', attrs: 'autocomplete="email"' }) +
    fieldHtml({ id: 'contact-phone', label: 'Mobile (optional)', field: 'contact.phone', type: 'tel', attrs: 'autocomplete="tel"' });

  $('#payment-fields').innerHTML =
    fieldHtml({ id: 'card-holder', label: 'Name on card', field: 'payment.holder', attrs: 'autocomplete="cc-name"' }) +
    fieldHtml({ id: 'card-number', label: 'Card number', field: 'payment.number', attrs: 'inputmode="numeric" autocomplete="cc-number" placeholder="4111 1111 1111 1111"' }) +
    fieldHtml({ id: 'card-expiry', label: 'Expiry (MM/YY)', field: 'payment.expiry', attrs: 'autocomplete="cc-exp" placeholder="MM/YY"' }) +
    fieldHtml({ id: 'card-cvv', label: 'CVV', field: 'payment.cvv', attrs: 'inputmode="numeric" autocomplete="cc-csc" maxlength="3"' });

  const session = getSession();
  if (session) {
    $('#contact-email').value = session.user.email;
    $('#p0-first-name').value = session.user.firstName;
    $('#p0-last-name').value = session.user.lastName;
  }
}

async function refreshQuote() {
  const q = await api(`/flights/${flightId}/quote?${new URLSearchParams({ fare, passengers: pax, extraBag: extraBag.checked })}`);
  $('#extra-bag-price').textContent = `${fmtMoney(q.extraBagPrice, q.currency)} each`;
  $('#price-lines').innerHTML = `
    <dt>Fare (${pax} × ${fare.toLowerCase()})</dt><dd data-testid="price-fare">${fmtMoney(q.fare, q.currency)}</dd>
    <dt>Taxes &amp; fees</dt><dd data-testid="price-taxes">${fmtMoney(q.taxes, q.currency)}</dd>
    <dt>Extras</dt><dd data-testid="price-extras">${fmtMoney(q.extras, q.currency)}</dd>
    <dt class="total">Total</dt><dd class="total" data-testid="price-total">${fmtMoney(q.total, q.currency)}</dd>`;
}

async function renderSummary() {
  const flight = await api(`/flights/${flightId}`);
  const fareInfo = flight.fares.find((f) => f.code === fare);
  if (!fareInfo) throw new Error('Unknown fare selected');
  const [from, to] = await Promise.all([airportLabel(flight.origin), airportLabel(flight.destination)]);
  $('#trip-summary').innerHTML = `
    <p><strong data-testid="summary-route">${escapeHtml(from)} → ${escapeHtml(to)}</strong><br />
    <span data-testid="summary-date">${fmtDate(flight.date)}</span><br />
    <span data-testid="summary-times">${fmtTime(flight.departureTime)} – ${fmtTime(flight.arrivalTime)}</span> · ${fmtDuration(flight.durationMinutes)}<br />
    <span data-testid="summary-flight">${flight.flightNumber}</span> · <span data-testid="summary-fare">${fareInfo.name}</span> fare</p>
    <p class="flight-meta">${fareInfo.baggageKg}kg baggage. ${escapeHtml(fareInfo.refundPolicy)}</p>`;
  if (!flight.bookable) showAlert(alertEl, 'This flight is no longer open for booking.');
}

function collect() {
  return {
    flightId,
    fare,
    extraBag: extraBag.checked,
    passengers: Array.from({ length: pax }, (_, i) => ({
      title: $(`#p${i}-title`).value,
      firstName: $(`#p${i}-first-name`).value.trim(),
      lastName: $(`#p${i}-last-name`).value.trim(),
    })),
    contact: { email: $('#contact-email').value.trim(), phone: $('#contact-phone').value.trim() || undefined },
    payment: {
      holder: $('#card-holder').value.trim(),
      number: $('#card-number').value.replace(/\s/g, ''),
      expiry: $('#card-expiry').value.trim(),
      cvv: $('#card-cvv').value.trim(),
    },
  };
}

/** Quick client-side checks for empty fields; the API does the full validation. */
function validateRequired(body) {
  let ok = true;
  const require = (field, value, message) => {
    if (!value) {
      setFieldError(form, field, message);
      ok = false;
    }
  };
  body.passengers.forEach((p, i) => {
    require(`passengers[${i}].title`, p.title, 'Please select a title');
    require(`passengers[${i}].firstName`, p.firstName, 'First name is required');
    require(`passengers[${i}].lastName`, p.lastName, 'Last name is required');
  });
  require('contact.email', body.contact.email, 'Email is required');
  require('payment.holder', body.payment.holder, 'Name on card is required');
  require('payment.number', body.payment.number, 'Card number is required');
  require('payment.expiry', body.payment.expiry, 'Expiry date is required');
  require('payment.cvv', body.payment.cvv, 'CVV is required');
  return ok;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearErrors(form);
  hideAlert(alertEl);
  const body = collect();
  if (!validateRequired(body)) {
    showAlert(alertEl, 'Please complete the highlighted fields.');
    return;
  }

  payButton.disabled = true;
  payButton.textContent = 'Processing payment...';
  try {
    const booking = await api('/bookings', { method: 'POST', body, headers: { 'Idempotency-Key': idempotencyKey } });
    location.href = `/confirmation?${new URLSearchParams({ pnr: booking.pnr, lastName: booking.passengers[0].lastName })}`;
  } catch (err) {
    showApiError(form, alertEl, err);
    payButton.disabled = false;
    payButton.textContent = 'Pay and book';
  }
});

extraBag.addEventListener('change', () => refreshQuote().catch((err) => showAlert(alertEl, err.message)));

async function init() {
  if (!flightId || !fare) {
    showAlert(alertEl, 'No flight selected. Please search for a flight first.');
    form.classList.add('hidden');
    return;
  }
  renderForm();
  try {
    await Promise.all([renderSummary(), refreshQuote()]);
  } catch (err) {
    showAlert(alertEl, err.message);
    payButton.disabled = true;
  }
}

init();
