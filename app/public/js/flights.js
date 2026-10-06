import { $, api, airportLabel, dayOffset, escapeHtml, fmtDate, fmtDuration, fmtMoney, fmtTime, params, renderHeader, showAlert } from './common.js';

renderHeader('home');

const results = $('#results');
const alertEl = $('#results-alert');
const search = Object.fromEntries(['origin', 'destination', 'date', 'passengers'].map((k) => [k, params.get(k) || '']));

function seatsBadge(flight, pax) {
  if (!flight.available) return '<span class="badge badge-danger" data-testid="sold-out">Sold out</span>';
  if (flight.seatsAvailable <= 9) return `<span class="badge badge-warn" data-testid="seats-left">Only ${flight.seatsAvailable} seats left</span>`;
  return '';
}

function flightCard(flight, pax) {
  const fares = flight.fares
    .map(
      (fare) => `
      <div class="fare" data-testid="fare-${fare.code}">
        <span class="fare-name">${fare.name}</span>
        <span class="fare-price" data-testid="fare-price">${fmtMoney(fare.price, flight.currency)}</span>
        <span class="fare-bag">${fare.baggageKg}kg total baggage</span>
        <a class="btn" data-testid="select-fare" ${flight.available ? `href="/book?${new URLSearchParams({ flightId: flight.id, fare: fare.code, passengers: pax })}"` : 'aria-disabled="true"'}
           aria-label="Select ${fare.name} fare on ${flight.flightNumber}">Select</a>
      </div>`,
    )
    .join('');

  return `
    <article class="card flight-card" data-testid="flight-card" data-flight-id="${flight.id}" aria-label="Flight ${flight.flightNumber}">
      <div>
        <div class="flight-times">
          <div><div class="time" data-testid="departure-time">${fmtTime(flight.departureTime)}</div><div class="code">${flight.origin}</div></div>
          <div class="line"><div class="duration" data-testid="duration">${fmtDuration(flight.durationMinutes)}</div></div>
          <div><div class="time" data-testid="arrival-time">${fmtTime(flight.arrivalTime)}<sup>${dayOffset(flight.departureTime, flight.arrivalTime)}</sup></div><div class="code">${flight.destination}</div></div>
        </div>
        <div class="flight-meta"><strong data-testid="flight-number">${flight.flightNumber}</strong> · Direct · ${escapeHtml(flight.aircraft)} ${seatsBadge(flight, pax)}</div>
      </div>
      <div class="fares">${flight.available ? fares : '<p>This flight has no seats left for your party. Try another flight or date.</p>'}</div>
    </article>`;
}

async function init() {
  try {
    const [from, to] = await Promise.all([airportLabel(search.origin), airportLabel(search.destination)]);
    $('#route-title').textContent = `${from} to ${to}`;
    if (search.date) {
      $('#route-subtitle').textContent = `${fmtDate(search.date)} · ${search.passengers} ${search.passengers === '1' ? 'passenger' : 'passengers'}`;
    }
    document.title = `${search.origin} to ${search.destination} | SkyLane Air`;

    const data = await api(`/flights/search?${new URLSearchParams(search)}`);
    if (!data.flights.length) {
      results.innerHTML = `<div class="card" data-testid="no-flights"><h2>No flights available</h2><p>There are no flights on this route for the selected date. Please try another date.</p></div>`;
      return;
    }
    results.innerHTML = data.flights.map((f) => flightCard(f, data.passengers)).join('');
  } catch (err) {
    results.innerHTML = '';
    const detail = err.details?.map((d) => d.message).join('. ');
    showAlert(alertEl, detail || err.message);
  }
}

init();
