import { $, api, clearErrors, escapeHtml, fieldHtml, fmtDate, fmtTime, hideAlert, params, renderHeader, setFieldError, showAlert } from './common.js';

renderHeader('checkin');

const form = $('#checkin-form');
const alertEl = $('#checkin-alert');
const step = $('#checkin-step');

$('#checkin-fields').innerHTML =
  fieldHtml({ id: 'pnr', label: 'Booking reference', field: 'pnr', attrs: 'maxlength="6" autocomplete="off" style="text-transform:uppercase"' }) +
  fieldHtml({ id: 'last-name', label: 'Last name', field: 'lastName', attrs: 'autocomplete="family-name"' });

const state = { booking: null, seatmap: null, lastName: '', active: 0, selection: {} };

function renderSeatSelection() {
  const { booking, seatmap } = state;
  const taken = new Set(Object.values(state.selection));
  const tabs = booking.passengers
    .map(
      (p, i) => `<button type="button" class="btn btn-secondary" role="tab" aria-selected="${i === state.active}" data-index="${i}" data-testid="passenger-tab-${p.id}">
        ${escapeHtml(`${p.firstName} ${p.lastName}`)}: <span data-testid="selected-seat-${p.id}">${state.selection[p.id] || 'no seat'}</span>
      </button>`,
    )
    .join('');

  let grid = '';
  for (let row = 1; row <= seatmap.rows; row++) {
    grid += `<span class="row-label">${row}</span>`;
    seatmap.letters.forEach((letter, i) => {
      if (i === 3) grid += '<span></span>';
      const seat = `${row}${letter}`;
      const info = seatmap.seats.find((s) => s.seat === seat);
      const mine = state.selection[booking.passengers[state.active].id] === seat;
      const takenByParty = taken.has(seat) && !mine;
      grid += `<button type="button" class="seat" data-seat="${seat}" data-testid="seat-${seat}"
        aria-label="Seat ${seat}${info.available ? '' : ', unavailable'}" aria-pressed="${mine || takenByParty}"
        ${info.available && !takenByParty ? '' : 'disabled'}>${seat}</button>`;
    });
  }

  const allChosen = booking.passengers.every((p) => state.selection[p.id]);
  step.innerHTML = `
    <section class="card">
      <h2>Choose seats: ${booking.flight.flightNumber}, ${fmtDate(booking.flight.date)}</h2>
      <div class="passenger-tabs" role="tablist" aria-label="Passengers">${tabs}</div>
      <div class="seat-legend"><span>White: available</span><span>Grey: unavailable</span><span>Green: selected</span></div>
      <div class="seatmap" data-testid="seatmap">${grid}</div>
      <div class="actions">
        <button class="btn" type="button" id="complete-checkin" data-testid="complete-checkin" ${allChosen ? '' : 'disabled'}>Confirm seats and check in</button>
      </div>
    </section>`;

  step.querySelectorAll('[role="tab"]').forEach((tab) =>
    tab.addEventListener('click', () => {
      state.active = Number(tab.dataset.index);
      renderSeatSelection();
    }),
  );
  step.querySelectorAll('.seat:not([disabled])').forEach((btn) =>
    btn.addEventListener('click', () => {
      const passenger = booking.passengers[state.active];
      state.selection[passenger.id] = btn.dataset.seat;
      // Move on to the next passenger without a seat, if any.
      const next = booking.passengers.findIndex((p) => !state.selection[p.id]);
      if (next !== -1) state.active = next;
      renderSeatSelection();
      step.querySelector(`[data-seat="${btn.dataset.seat}"]`)?.focus();
    }),
  );
  $('#complete-checkin').addEventListener('click', completeCheckin);
}

function renderBoardingPasses(passes) {
  step.innerHTML = `
    <div class="alert alert-success" role="status" data-testid="checkin-success">You're checked in! Your boarding passes are below.</div>
    ${passes
      .map(
        (bp) => `
      <article class="boarding-pass" data-testid="boarding-pass" aria-label="Boarding pass for ${escapeHtml(bp.passengerName)}">
        <div class="main">
          <div class="label">Passenger</div>
          <div class="value" data-testid="bp-passenger">${escapeHtml(bp.passengerName)}</div>
          <div class="bp-grid">
            <div><div class="label">Flight</div><div class="value" data-testid="bp-flight">${bp.flightNumber}</div></div>
            <div><div class="label">From → To</div><div class="value">${bp.origin} → ${bp.destination}</div></div>
            <div><div class="label">Boarding</div><div class="value" data-testid="bp-boarding">${fmtTime(bp.boardingTime)}</div></div>
            <div><div class="label">Departs</div><div class="value">${fmtTime(bp.departureTime)}</div></div>
          </div>
        </div>
        <div class="stub">
          <div><div class="label">Seat</div><div class="value" data-testid="bp-seat">${bp.seat}</div></div>
          <div><div class="label">Gate</div><div class="value" data-testid="bp-gate">${bp.gate}</div></div>
          <div><div class="label">PNR</div><div class="value">${bp.pnr}</div></div>
        </div>
      </article>`,
      )
      .join('')}`;
}

async function completeCheckin() {
  const button = $('#complete-checkin');
  button.disabled = true;
  hideAlert(alertEl);
  try {
    const result = await api(`/bookings/${state.booking.pnr}/checkin`, {
      method: 'POST',
      body: { lastName: state.lastName, seats: state.selection },
    });
    $('#checkin-retrieve-card').classList.add('hidden');
    renderBoardingPasses(result.boardingPasses);
  } catch (err) {
    const detail = err.details?.map((d) => d.message).join('. ');
    showAlert(alertEl, detail || err.message);
    button.disabled = false;
    alertEl.scrollIntoView({ block: 'center' });
  }
}

async function start(pnr, lastName) {
  clearErrors(form);
  hideAlert(alertEl);
  step.innerHTML = '';
  if (!pnr || !lastName) {
    if (!pnr) setFieldError(form, 'pnr', 'Booking reference is required');
    if (!lastName) setFieldError(form, 'lastName', 'Last name is required');
    return;
  }
  try {
    const query = `lastName=${encodeURIComponent(lastName)}`;
    const booking = await api(`/bookings/${encodeURIComponent(pnr.toUpperCase())}?${query}`);
    if (booking.passengers.every((p) => p.checkedIn)) {
      showAlert(alertEl, 'All passengers on this booking are already checked in.', 'info');
      return;
    }
    const seatmap = await api(`/bookings/${booking.pnr}/seatmap?${query}`);
    Object.assign(state, { booking, seatmap, lastName, active: 0, selection: {} });
    renderSeatSelection();
  } catch (err) {
    showAlert(alertEl, err.status === 404 ? 'We could not find a booking with those details. Please check and try again.' : err.message);
  }
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  start($('#pnr').value.trim(), $('#last-name').value.trim());
});

if (params.get('pnr') && params.get('lastName')) {
  $('#pnr').value = params.get('pnr');
  $('#last-name').value = params.get('lastName');
  start(params.get('pnr'), params.get('lastName'));
}
