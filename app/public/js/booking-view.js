import { airportLabel, escapeHtml, fmtDate, fmtDuration, fmtMoney, fmtTime } from './common.js';

const STATUS_BADGE = {
  CONFIRMED: '<span class="badge badge-ok" data-testid="booking-status">Confirmed</span>',
  CANCELLED: '<span class="badge badge-danger" data-testid="booking-status">Cancelled</span>',
};

/** Read-only summary of a booking, shared by confirmation, manage and trips pages. */
export async function bookingSummaryHtml(booking) {
  const { flight, price } = booking;
  const [from, to] = await Promise.all([airportLabel(flight.origin), airportLabel(flight.destination)]);
  const passengers = booking.passengers
    .map(
      (p) => `<tr data-testid="passenger-row">
        <td data-testid="passenger-name">${escapeHtml(`${p.title} ${p.firstName} ${p.lastName}`)}</td>
        <td data-testid="passenger-seat">${p.seat || 'Not assigned'}</td>
        <td data-testid="passenger-checkin">${p.checkedIn ? 'Checked in' : 'Not checked in'}</td>
      </tr>`,
    )
    .join('');

  return `
    <section class="card" data-testid="booking-summary">
      <div class="route-summary">
        <div>
          <div class="flight-meta">Booking reference</div>
          <div class="pnr" data-testid="booking-pnr">${booking.pnr}</div>
        </div>
        <div>${STATUS_BADGE[booking.status] || booking.status}</div>
      </div>
      <h2 style="margin-top:16px" data-testid="booking-route">${escapeHtml(from)} → ${escapeHtml(to)}</h2>
      <p>
        <span data-testid="booking-flight">${flight.flightNumber}</span> ·
        <span data-testid="booking-date">${fmtDate(flight.date)}</span> ·
        ${fmtTime(flight.departureTime)} – ${fmtTime(flight.arrivalTime)} (${fmtDuration(flight.durationMinutes)}) ·
        <span data-testid="booking-fare">${booking.fare.charAt(0) + booking.fare.slice(1).toLowerCase()}</span> fare
        ${booking.extraBag ? ' · Extra baggage' : ''}
      </p>
      <table class="data">
        <thead><tr><th scope="col">Passenger</th><th scope="col">Seat</th><th scope="col">Check-in</th></tr></thead>
        <tbody>${passengers}</tbody>
      </table>
      <p style="margin-top:16px">Total paid: <strong data-testid="booking-total">${fmtMoney(price.total, price.currency)}</strong>
        ${booking.payment ? `(card ending ${booking.payment.cardLast4})` : ''}</p>
      ${booking.refund ? `<p data-testid="booking-refund">Refund: <strong>${fmtMoney(booking.refund.amount, booking.refund.currency)}</strong></p>` : ''}
    </section>`;
}
