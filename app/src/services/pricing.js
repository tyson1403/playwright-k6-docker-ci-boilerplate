export const CURRENCY = 'AED';
export const TAXES_PER_PASSENGER = 85;
export const EXTRA_BAG_PRICE = 95; // +10kg per passenger
export const STANDARD_CANCEL_FEE = 200; // per passenger

export const FARES = {
  SAVER: {
    code: 'SAVER',
    name: 'Saver',
    multiplier: 1,
    baggageKg: 7,
    refundPolicy: 'Non-refundable. Airport taxes are refunded on cancellation.',
  },
  STANDARD: {
    code: 'STANDARD',
    name: 'Standard',
    multiplier: 1.4,
    baggageKg: 27,
    refundPolicy: `Refundable less a ${CURRENCY} ${STANDARD_CANCEL_FEE} fee per passenger.`,
  },
  FLEX: {
    code: 'FLEX',
    name: 'Flex',
    multiplier: 1.9,
    baggageKg: 37,
    refundPolicy: 'Fully refundable.',
  },
};

export function farePrice(basePrice, fareCode) {
  const fare = FARES[fareCode];
  if (!fare) throw new Error(`Unknown fare ${fareCode}`);
  return Math.round(basePrice * fare.multiplier);
}

/** Fare options for a flight, as shown on the results page. */
export function fareOptions(basePrice) {
  return Object.values(FARES).map((f) => ({
    code: f.code,
    name: f.name,
    price: farePrice(basePrice, f.code),
    baggageKg: f.baggageKg,
    refundPolicy: f.refundPolicy,
  }));
}

export function quote({ basePrice, fareCode, passengers, extraBag = false }) {
  const fare = farePrice(basePrice, fareCode);
  const bag = extraBag ? EXTRA_BAG_PRICE : 0;
  const perPassenger = fare + TAXES_PER_PASSENGER + bag;
  return {
    currency: CURRENCY,
    fare: fare * passengers,
    taxes: TAXES_PER_PASSENGER * passengers,
    extras: bag * passengers,
    total: perPassenger * passengers,
  };
}

export function refundAmount(booking) {
  const { price, fare, passengers } = booking;
  const pax = passengers.length;
  switch (fare) {
    case 'FLEX':
      return price.total;
    case 'STANDARD':
      return Math.max(price.taxes, price.total - STANDARD_CANCEL_FEE * pax);
    default:
      return price.taxes;
  }
}
