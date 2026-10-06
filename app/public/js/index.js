import { $, api, clearErrors, loadAirports, renderHeader, setFieldError, showAlert, todayInDubai, escapeHtml } from './common.js';

renderHeader('home');

const form = $('#search-form');
const origin = $('#origin');
const destination = $('#destination');
const date = $('#date');
const passengers = $('#passengers');
const alertEl = $('#search-alert');

const option = (a) => `<option value="${a.code}">${escapeHtml(a.city)} (${a.code})</option>`;

async function populateDestinations(selected) {
  const { destinations } = await api(`/airports/${origin.value}/destinations`);
  destination.innerHTML = `<option value="">Select destination</option>${destinations.map(option).join('')}`;
  if (destinations.some((d) => d.code === selected)) destination.value = selected;
}

async function init() {
  try {
    const airports = await loadAirports();
    origin.innerHTML = airports.map(option).join('');
    passengers.innerHTML = Array.from({ length: 9 }, (_, i) => `<option value="${i + 1}">${i + 1} ${i ? 'passengers' : 'passenger'}</option>`).join('');

    // Restore the previous search when coming back via "Modify search".
    const last = JSON.parse(sessionStorage.getItem('skylane.lastSearch') || 'null');
    origin.value = last?.origin || 'DXB';
    passengers.value = last?.passengers || '1';
    date.min = todayInDubai();
    date.value = last?.date && last.date >= date.min ? last.date : '';
    await populateDestinations(last?.destination);
  } catch {
    showAlert(alertEl, 'We could not load airports. Please refresh the page.');
  }
}

origin.addEventListener('change', () => populateDestinations(destination.value));

form.addEventListener('submit', (event) => {
  event.preventDefault();
  clearErrors(form);
  const errors = [];
  if (!destination.value) errors.push(['destination', 'Please choose a destination']);
  if (!date.value) errors.push(['date', 'Please choose a departure date']);
  else if (date.value < date.min) errors.push(['date', 'Departure date cannot be in the past']);
  if (errors.length) {
    errors.forEach(([field, message]) => setFieldError(form, field, message));
    return;
  }

  const search = { origin: origin.value, destination: destination.value, date: date.value, passengers: passengers.value };
  sessionStorage.setItem('skylane.lastSearch', JSON.stringify(search));
  location.href = `/flights?${new URLSearchParams(search)}`;
});

init();
