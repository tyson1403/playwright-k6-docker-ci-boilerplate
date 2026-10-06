import { expect, type APIRequestContext, type APIResponse } from '@playwright/test';
import { CARDS, dubaiDate, passenger, type Card, type FareCode, type Passenger } from './test-data';

export interface Fare {
  code: FareCode;
  name: string;
  price: number;
  baggageKg: number;
  refundPolicy: string;
}

export interface Flight {
  id: string;
  flightNumber: string;
  origin: string;
  destination: string;
  date: string;
  departureTime: string;
  arrivalTime: string;
  departureUtc: string;
  arrivalUtc: string;
  durationMinutes: number;
  basePrice: number;
  seatsAvailable: number;
  available: boolean;
  currency: string;
  fares: Fare[];
}

export interface Booking {
  pnr: string;
  status: 'CONFIRMED' | 'CANCELLED';
  fare: FareCode;
  flight: Flight;
  passengers: Array<Passenger & { id: string; seat: string | null; checkedIn: boolean }>;
  contact: { email: string; phone: string | null };
  extraBag: boolean;
  price: { currency: string; fare: number; taxes: number; extras: number; total: number };
  payment: { cardLast4: string; authCode: string };
  refund?: { amount: number; currency: string };
  checkin?: { opensAt: string; closesAt: string; open: boolean };
}

export interface BookingRequest {
  flightId: string;
  fare: FareCode;
  passengers: Passenger[];
  contact: { email: string; phone?: string };
  extraBag?: boolean;
  payment: Card;
}

export interface SearchParams {
  origin: string;
  destination: string;
  date: string;
  passengers?: number;
}

/**
 * Thin typed client for the SkyLane Air REST API. Raw methods return the
 * APIResponse so negative tests can assert on status codes; the helpers
 * at the bottom assert success and return parsed bodies for test setup.
 */
export class SkyLaneApi {
  private token?: string;

  constructor(private readonly request: APIRequestContext) {}

  private get headers(): Record<string, string> {
    return this.token ? { Authorization: `Bearer ${this.token}` } : {};
  }

  withToken(token?: string) {
    this.token = token;
    return this;
  }

  // ---- raw endpoints ----
  health = () => this.request.get('/api/health');
  airports = () => this.request.get('/api/airports');
  destinations = (origin: string) => this.request.get(`/api/airports/${origin}/destinations`);
  search = (p: Partial<SearchParams> | Record<string, unknown>) =>
    this.request.get('/api/flights/search', { params: p as Record<string, string | number> });
  flight = (id: string) => this.request.get(`/api/flights/${id}`);
  quote = (id: string, params: { fare: string; passengers?: number; extraBag?: boolean }) =>
    this.request.get(`/api/flights/${id}/quote`, { params: { passengers: 1, ...params } });

  register = (data: { email: string; password: string; firstName: string; lastName: string }) =>
    this.request.post('/api/auth/register', { data });
  login = (email: string, password: string) => this.request.post('/api/auth/login', { data: { email, password } });
  me = () => this.request.get('/api/auth/me', { headers: this.headers });
  logout = () => this.request.post('/api/auth/logout', { headers: this.headers });

  createBooking = (data: BookingRequest | Record<string, unknown>, idempotencyKey?: string) =>
    this.request.post('/api/bookings', {
      data,
      headers: { ...this.headers, ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) },
    });
  getBooking = (pnr: string, lastName?: string) =>
    this.request.get(`/api/bookings/${pnr}`, { params: lastName ? { lastName } : {}, headers: this.headers });
  myBookings = () => this.request.get('/api/bookings', { headers: this.headers });
  cancelBooking = (pnr: string, lastName: string) => this.request.post(`/api/bookings/${pnr}/cancel`, { data: { lastName } });
  seatmap = (pnr: string, lastName: string) => this.request.get(`/api/bookings/${pnr}/seatmap`, { params: { lastName } });
  checkin = (pnr: string, lastName: string, seats: Record<string, string>) =>
    this.request.post(`/api/bookings/${pnr}/checkin`, { data: { lastName, seats } });

  setInventory = (flightId: string, seatsAvailable: number) =>
    this.request.put(`/api/test/flights/${flightId}/inventory`, { data: { seatsAvailable } });

  // ---- helpers for test setup ----
  async json<T>(response: Promise<APIResponse> | APIResponse, status = 200): Promise<T> {
    const res = await response;
    expect(res.status(), `${res.url()} -> ${await res.text()}`).toBe(status);
    return res.json() as Promise<T>;
  }

  async loginAs(email: string, password: string): Promise<string> {
    const { token } = await this.json<{ token: string }>(this.login(email, password));
    this.token = token;
    return token;
  }

  /** First flight on the route that still has seats for the party. */
  async findFlight(params: SearchParams): Promise<Flight> {
    const { flights } = await this.json<{ flights: Flight[] }>(this.search({ passengers: 1, ...params }));
    const flight = flights.find((f) => f.available);
    if (!flight) throw new Error(`No available flight for ${JSON.stringify(params)}`);
    return flight;
  }

  /**
   * First scheduled flight on the route, sold out or not, with its inventory set
   * to a known value. For tests that assert exact seat counts.
   */
  async flightWithSeats(params: SearchParams, seatsAvailable: number): Promise<Flight> {
    const { flights } = await this.json<{ flights: Flight[] }>(this.search(params));
    if (!flights.length) throw new Error(`No scheduled flight for ${JSON.stringify(params)}`);
    await this.json(this.setInventory(flights[0].id, seatsAvailable));
    return { ...flights[0], seatsAvailable, available: seatsAvailable >= (params.passengers ?? 1) };
  }

  /** Books a flight end-to-end and returns the confirmed booking. */
  async book(options: {
    route: { origin: string; destination: string };
    daysAhead?: number;
    fare?: FareCode;
    passengers?: Passenger[];
    extraBag?: boolean;
  }): Promise<Booking> {
    const passengers = options.passengers ?? [passenger()];
    const flight = await this.findFlight({ ...options.route, date: dubaiDate(options.daysAhead ?? 1), passengers: passengers.length });
    return this.json<Booking>(
      this.createBooking({
        flightId: flight.id,
        fare: options.fare ?? 'STANDARD',
        passengers,
        contact: { email: 'traveller@example.com' },
        extraBag: options.extraBag ?? false,
        payment: CARDS.valid(),
      }),
      201,
    );
  }
}
