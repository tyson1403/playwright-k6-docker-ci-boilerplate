import { test, expect } from '../fixtures';
import { ROUTES, dubaiDate } from '../utils/test-data';
import type { Flight } from '../utils/skylane-api';

test.describe('Flight search', () => {
  test.beforeEach(async ({ home }) => {
    await home.goto();
  });

  test('defaults to departing from Dubai with 1 passenger', async ({ home }) => {
    await expect(home.origin).toHaveValue('DXB');
    await expect(home.passengers).toHaveValue('1');
    await expect(home.date).toHaveAttribute('min', dubaiDate(0));
  });

  test('only offers destinations that are actually served', async ({ home }) => {
    expect(await home.destinationCodes()).not.toContain('DXB');

    await home.origin.selectOption('KHI');
    await expect.poll(() => home.destinationCodes()).toEqual(['DXB']);
  });

  test('requires a destination and a date', async ({ home, page }) => {
    await home.searchButton.click();
    await expect(home.destinationError).toHaveText('Please choose a destination');
    await expect(home.dateError).toHaveText('Please choose a departure date');
    await expect(home.destination).toHaveAttribute('aria-invalid', 'true');
    await expect(page).toHaveURL('/');
  });

  test('shows matching flights with prices from the API @smoke', async ({ home, results, api }) => {
    const date = dubaiDate(6);
    await home.search({ ...ROUTES.search, date, passengers: 2 });

    await expect(results.title).toHaveText('Dubai (DXB) to Muscat (MCT)');
    await expect(results.subtitle).toContainText('2 passengers');
    await results.waitForResults();

    // The UI must show exactly what the API returns.
    const { flights } = await api.json<{ flights: Flight[] }>(api.search({ ...ROUTES.search, date, passengers: 2 }));
    await expect(results.flightCards).toHaveCount(flights.length);
    for (const flight of flights) {
      await expect(results.flight(flight.id).getByTestId('flight-number')).toHaveText(flight.flightNumber);
      await expect(results.farePrice(flight.id, 'SAVER')).toHaveText(`AED ${flight.fares[0].price.toLocaleString('en-US')}`);
    }
  });

  test('results are listed in departure order', async ({ home, results }) => {
    await home.search({ ...ROUTES.search, date: dubaiDate(9) });
    await results.waitForResults();
    const times = await results.departureTimes();
    expect(times).toEqual([...times].sort());
  });

  test('shows a sold-out flight as unavailable', async ({ home, results, api }) => {
    const date = dubaiDate(25);
    const flight = await api.flightWithSeats({ ...ROUTES.inventory, date }, 0);

    await home.search({ ...ROUTES.inventory, date });
    await expect(results.flight(flight.id).getByTestId('sold-out')).toBeVisible();
    await expect(results.flight(flight.id).getByRole('link', { name: /Select/ })).toHaveCount(0);
  });

  test('warns when only a few seats are left', async ({ home, results, api }) => {
    const date = dubaiDate(26);
    const flight = await api.flightWithSeats({ ...ROUTES.inventory, date }, 4);

    await home.search({ ...ROUTES.inventory, date });
    await expect(results.flight(flight.id).getByTestId('seats-left')).toHaveText('Only 4 seats left');
  });

  test('"Modify search" brings back the previous criteria', async ({ home, results, page }) => {
    const date = dubaiDate(14);
    await home.search({ ...ROUTES.search, date, passengers: 3 });
    await results.waitForResults();
    await results.modifySearch.click();

    await expect(page).toHaveURL('/');
    await expect(home.destination).toHaveValue('MCT');
    await expect(home.date).toHaveValue(date);
    await expect(home.passengers).toHaveValue('3');
  });

  test('shows the API validation message for a past date in the URL', async ({ page, results }) => {
    await page.goto(`/flights?origin=DXB&destination=MCT&date=${dubaiDate(-2)}&passengers=1`);
    await expect(results.alert).toHaveText('Date cannot be in the past');
  });
});
