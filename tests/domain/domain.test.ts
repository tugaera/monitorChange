import { describe, expect, it } from 'vitest';
import { DEFAULT_CRITERIA, type Criteria, type Offer } from '../../packages/contracts/src/index.js';
import { advanceTracking, evaluateOffer, parseMoney, type SourceTrackingState, type TrackingContext } from '../../packages/domain/src/index.js';

const criteria = (overrides: Partial<Criteria> = {}): Criteria => ({ ...structuredClone(DEFAULT_CRITERIA), ...overrides });
function offer(overrides: Partial<Offer> = {}): Offer {
  return {
    key: 'direct-variant-a', productName: 'Produto de exemplo', variant: 'azul', sellerName: 'Retalhista Alfa',
    sellerType: 'direct', condition: 'new', priceMinor: 12_500, shippingMinor: null, currency: 'EUR', evidence: [],
    modalities: [{ key: 'delivery', action: 'online_order', stock: 'in_stock', storeId: null, quality: 'strong', evidence: [] }],
    ...overrides,
  };
}
function withStock(stock: Offer['modalities'][number]['stock'], overrides: Partial<Offer> = {}): Offer {
  const result = offer(overrides); result.modalities = [{ ...result.modalities[0], stock }]; return result;
}

describe('money without floating point comparisons', () => {
  it.each([
    ['1.234,56 €', 'EUR', 123456], ['EUR 1,234.56', 'EUR', 123456], ['1\u00a0234,50', 'EUR', 123450],
    ['1.234', 'EUR', 123400], ['0,00', 'EUR', 0], ['1,234', 'JPY', 1234], ['1.234', 'KWD', 1234],
    ['129,9', 'EUR', 12990], [123.45, 'EUR', 12345],
  ])('parses %s (%s)', (input, currency, expected) => expect(parseMoney(input, currency as string)).toBe(expected));
  it.each(['12,99 €/mês', '10 x 12,99', 'Entrada 50 €', 'Desde 90 €', '100 € 120 €', '-10 €', '999999999999999999999', 'preço membro 90 €'])('rejects ambiguous/partial price %s', (input) => expect(parseMoney(input)).toBeNull());
});

describe('offer eligibility preserves independent constraints', () => {
  it('allows a known new direct offer with an online action', () => expect(evaluateOffer(offer(), criteria()).evaluations.delivery.status).toBe('eligible'));
  it('excludes marketplace while keeping observed stock', () => {
    const result = evaluateOffer(offer({ sellerType: 'marketplace' }), criteria());
    expect(result.evaluations.delivery).toEqual({ status: 'excluded', reasons: ['seller_marketplace'] });
    expect(result.modalities[0].stock).toBe('in_stock');
  });
  it('does not infer direct selling from unknown seller', () => {
    const result = evaluateOffer(offer({ sellerName: '', sellerType: 'unknown' }), criteria());
    expect(result.evaluations.delivery.status).toBe('undetermined');
    expect(result.evaluations.delivery.reasons).toContain('seller_unknown');
  });
  it('can accept a known marketplace vendor only when policy allows it', () => {
    expect(evaluateOffer(offer({ sellerType: 'marketplace' }), criteria({ sellerPolicy: 'all' })).evaluations.delivery.status).toBe('eligible');
    expect(evaluateOffer(offer(), criteria({ excludedSellers: ['retalhista alfa'] })).evaluations.delivery.reasons).toContain('seller_excluded');
  });
  it('requires known shipping when the limit covers delivered total', () => {
    expect(evaluateOffer(offer(), criteria({ maxPriceMinor: 14000, priceBasis: 'delivered' })).evaluations.delivery.status).toBe('undetermined');
    expect(evaluateOffer(offer({ shippingMinor: 2000 }), criteria({ maxPriceMinor: 14000, priceBasis: 'delivered' })).evaluations.delivery.reasons).toContain('price_above_limit');
  });
  it('does not convert a different currency or confuse missing price with zero', () => {
    expect(evaluateOffer(offer({ currency: 'USD' }), criteria()).evaluations.delivery.reasons).toContain('currency_mismatch');
    expect(evaluateOffer(offer({ priceMinor: null }), criteria({ maxPriceMinor: 15000 })).evaluations.delivery.reasons).toContain('price_unknown');
    expect(evaluateOffer(offer({ priceMinor: 0 }), criteria({ maxPriceMinor: 15000 })).evaluations.delivery.status).toBe('eligible');
  });
  it('keeps variant, condition, unknown action and preorder out of ordinary alerts', () => {
    expect(evaluateOffer(offer(), criteria({ variant: 'vermelho' })).evaluations.delivery.reasons).toContain('variant_mismatch');
    expect(evaluateOffer(offer({ condition: 'used' }), criteria()).evaluations.delivery.reasons).toContain('condition_not_new');
    expect(evaluateOffer(withStock('preorder'), criteria()).evaluations.delivery.reasons).toContain('preorder');
    const unknown = offer(); unknown.modalities[0].action = 'unknown';
    expect(evaluateOffer(unknown, criteria()).evaluations.delivery.status).toBe('undetermined');
  });
  it('requires an explicitly selected physical store and chosen action', () => {
    const physical = offer(); physical.modalities = [{ key: 'shop', stock: 'in_stock', action: 'store_only', storeId: 'shop-a', quality: 'strong', evidence: [] }];
    expect(evaluateOffer(physical, criteria()).evaluations.shop.reasons).toContain('action_excluded');
    expect(evaluateOffer(physical, criteria({ actions: ['store_only'] })).evaluations.shop.reasons).toContain('store_not_selected');
    expect(evaluateOffer(physical, criteria({ actions: ['store_only'], storeIds: ['shop-a'] })).evaluations.shop.status).toBe('eligible');
  });
});

describe('persistent source transition reducer', () => {
  const start = Date.parse('2026-01-01T00:00:00.000Z');
  function step(previous: SourceTrackingState | null, minute: number, offers: Offer[], settings: Partial<TrackingContext> = {}) {
    const activeCriteria = settings.criteria ?? criteria();
    return advanceTracking(previous, offers.map((item) => evaluateOffer(item, activeCriteria)), {
      revision: 1, checkId: `check-${minute}`, now: new Date(start + minute * 60_000).toISOString(),
      captureOk: true, complete: true, criteria: activeCriteria, ...settings,
    });
  }
  it('establishes a silent initial baseline', () => {
    const initial = step(null, 0, [offer()]);
    expect(initial.events).toHaveLength(0);
    expect(step(initial.state, 1, [offer()]).events).toHaveLength(0);
  });
  it('requires stable confirmation and emits one event across duplicate calls/restart', () => {
    const initial = step(null, 0, [withStock('out_of_stock')]);
    const candidate = step(initial.state, 1, [offer()]);
    expect(candidate.events).toHaveLength(0);
    const confirmed = step(JSON.parse(JSON.stringify(candidate.state)) as SourceTrackingState, 2, [offer()]);
    expect(confirmed.events).toHaveLength(1); expect(confirmed.events[0].type).toBe('restocked');
    expect(step(confirmed.state, 2, [offer()]).events).toHaveLength(0);
    expect(step(confirmed.state, 3, [offer()]).events).toHaveLength(0);
  });
  it('failure cancels a candidate but does not rearm confirmed availability', () => {
    let state = step(null, 0, [withStock('out_of_stock')]).state;
    state = step(state, 1, [offer()]).state;
    state = step(state, 2, [], { captureOk: false }).state;
    const afterError = step(state, 3, [offer()]); expect(afterError.events).toHaveLength(0);
    const confirmation = step(afterError.state, 4, [offer()]); expect(confirmation.events[0].type).toBe('restocked');
    state = step(confirmation.state, 5, [], { captureOk: false }).state;
    expect(step(state, 6, [offer()]).events).toHaveLength(0);
  });
  it('expires a long-lived candidate and rejects late results', () => {
    const base = step(null, 0, [withStock('out_of_stock')]);
    const pending = step(base.state, 1, [offer()]);
    const stale = step(pending.state, 50, [offer()]); expect(stale.events).toHaveLength(0);
    expect(step(stale.state, 49, [withStock('out_of_stock')]).state).toEqual(stale.state);
    expect(step(stale.state, 51, [offer()]).events).toHaveLength(1);
  });
  it('rearms only after a stable negative observation', () => {
    let state = step(null, 0, [offer()]).state;
    state = step(state, 1, [withStock('out_of_stock')]).state;
    expect(step(state, 2, [offer()]).events).toHaveLength(0);
    state = step(state, 3, [withStock('out_of_stock')]).state;
    state = step(state, 4, [withStock('out_of_stock')]).state;
    state = step(state, 5, [offer()]).state;
    expect(step(state, 6, [offer()]).events[0].type).toBe('restocked');
  });
  it('prefers a single restock event when both price and stock become eligible', () => {
    const config = criteria({ maxPriceMinor: 14000, confirmation: 'one_check' });
    const base = step(null, 0, [withStock('out_of_stock', { priceMinor: 16000 })], { criteria: config });
    const next = step(base.state, 1, [offer()], { criteria: config });
    expect(next.events.map((event) => event.type)).toEqual(['restocked']);
  });
  it('distinguishes price eligibility and never alerts a price drop while sold out', () => {
    const config = criteria({ maxPriceMinor: 14000, confirmation: 'one_check' });
    const base = step(null, 0, [offer({ priceMinor: 16000 })], { criteria: config });
    expect(step(base.state, 1, [offer()], { criteria: config }).events[0].type).toBe('price_eligible');
    const soldOut = step(null, 0, [withStock('out_of_stock', { priceMinor: 16000 })], { criteria: config });
    expect(step(soldOut.state, 1, [withStock('out_of_stock')], { criteria: config }).events).toHaveLength(0);
  });
  it('distinguishes a new seller offer from initial availability and resets on revision', () => {
    const config = criteria({ confirmation: 'one_check' });
    const base = step(null, 0, [withStock('out_of_stock')], { criteria: config });
    const newOffer = offer({ key: 'other-offer' });
    expect(step(base.state, 1, [withStock('out_of_stock'), newOffer], { criteria: config }).events[0].type).toBe('eligible_offer_found');
    expect(step(base.state, 2, [offer()], { criteria: config, revision: 2 }).events).toHaveLength(0);
  });
  it('requires confirmation for the optional initial availability alert', () => {
    const config = criteria({ notifyInitial: true });
    const pending = step(null, 0, [offer()], { criteria: config }); expect(pending.events).toHaveLength(0);
    expect(step(pending.state, 1, [offer()], { criteria: config }).events[0].type).toBe('initial_available');
  });
  it('missing observations cannot rearm an episode even with complete extraction', () => {
    const initial = step(null, 0, [offer()]);
    const missing = step(initial.state, 1, []);
    expect(step(missing.state, 2, [offer()]).events).toHaveLength(0);
  });
});
