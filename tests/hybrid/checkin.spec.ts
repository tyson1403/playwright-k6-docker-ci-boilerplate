import { test, expect } from '../fixtures';
import { ROUTES, party, passenger } from '../utils/test-data';
import type { Booking } from '../utils/skylane-api';

test.describe('Online check-in', () => {
  test('family checks in, picks seats and gets boarding passes @smoke', async ({ api, checkin }, testInfo) => {
    const route = ROUTES.checkinFamily[testInfo.project.name as keyof typeof ROUTES.checkinFamily];
    const created = await api.book({ route, passengers: party(3) });

    await checkin.goto();
    await checkin.start(created.pnr, created.passengers[0].lastName);
    await expect(checkin.completeButton).toBeDisabled();

    const seats = await checkin.chooseAvailableSeats(3);
    for (const [i, seat] of seats.entries()) {
      await expect(checkin.selectedSeat(`P${i + 1}`)).toHaveText(seat);
    }
    await checkin.completeButton.click();

    await expect(checkin.success).toBeVisible();
    await expect(checkin.boardingPasses).toHaveCount(3);
    await expect(checkin.boardingPasses.getByTestId('bp-seat')).toHaveText(seats);
    await expect(checkin.boardingPasses.getByTestId('bp-flight').first()).toHaveText(created.flight.flightNumber);

    const saved = await api.json<Booking>(api.getBooking(created.pnr, created.passengers[0].lastName));
    expect(saved.passengers.map((p) => p.seat)).toEqual(seats);
  });

  test('unavailable seats cannot be selected', async ({ api, checkin }) => {
    const created = await api.book({ route: ROUTES.checkinUi });
    await checkin.goto();
    await checkin.start(created.pnr, created.passengers[0].lastName);

    const taken = checkin.seatmap.locator('button.seat[disabled]').first();
    await expect(taken).toHaveAttribute('aria-label', /unavailable/);
    await expect(taken).toBeDisabled();
  });

  test('a passenger can change their seat before confirming', async ({ api, checkin }) => {
    const created = await api.book({ route: ROUTES.checkinUi });
    await checkin.goto();
    await checkin.start(created.pnr, created.passengers[0].lastName);

    const [first] = await checkin.chooseAvailableSeats(1);
    const [second] = await checkin.chooseAvailableSeats(1);
    await expect(checkin.selectedSeat('P1')).toHaveText(second);
    if (first !== second) await expect(checkin.seat(first)).toHaveAttribute('aria-pressed', 'false');
  });

  test('seat taken by someone else meanwhile shows an error, then succeeds with another seat', async ({ api, checkin }) => {
    const mine = await api.book({ route: ROUTES.checkinUi });
    await checkin.goto();
    await checkin.start(mine.pnr, mine.passengers[0].lastName);
    const [seat] = await checkin.chooseAvailableSeats(1);

    // Another traveller grabs the same seat through the API before we confirm.
    const other = await api.book({ route: ROUTES.checkinUi });
    await api.json(api.checkin(other.pnr, other.passengers[0].lastName, { P1: seat }));

    await checkin.completeButton.click();
    await expect(checkin.alert).toHaveText(`Seat ${seat} is not available`);

    await checkin.chooseAvailableSeats(1);
    await checkin.completeButton.click();
    await expect(checkin.success).toBeVisible();
  });

  test('check-in is refused more than 48 hours before departure', async ({ api, checkin }) => {
    const created = await api.book({ route: ROUTES.checkinUi, daysAhead: 6, passengers: [passenger()] });
    await checkin.goto();
    await checkin.start(created.pnr, created.passengers[0].lastName);
    await expect(checkin.alert).toHaveText('Online check-in opens 48 hours before departure');
    await expect(checkin.seatmap).toBeHidden();
  });

  test('an already checked-in booking is reported, not re-processed', async ({ api, checkin, page }) => {
    const created = await api.book({ route: ROUTES.checkinUi });
    const map = await api.json<{ seats: Array<{ seat: string; available: boolean }> }>(api.seatmap(created.pnr, created.passengers[0].lastName));
    const free = map.seats.filter((s) => s.available);
    const seat = free[Math.floor(Math.random() * free.length)].seat;
    await api.json(api.checkin(created.pnr, created.passengers[0].lastName, { P1: seat }));

    await page.goto(`/checkin?pnr=${created.pnr}&lastName=${created.passengers[0].lastName}`);
    await expect(checkin.alert).toHaveText('All passengers on this booking are already checked in.');
  });
});
