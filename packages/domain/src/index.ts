import type { Criteria, EvaluatedOffer, Evaluation, EventType, Modality, Offer, Stock } from '../../contracts/src/index.js';

const normal = (value: string) => value.normalize('NFKC').trim().toLocaleLowerCase('en').replace(/\s+/g, ' ');
const matches = (value: string, values: string[]) => values.some((candidate) => normal(candidate) === normal(value));

/** Monetary parsing is deliberately conservative: a monthly payment is not the item price. */
export function parseMoney(value: string | number | null | undefined, currency = 'EUR'): number | null {
  if (value == null || !/^[A-Z]{3}$/i.test(currency)) return null;
  let digits: number;
  try { digits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2; }
  catch { return null; }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) return null;
    const rounded = Math.round(value * 10 ** digits);
    return Number.isSafeInteger(rounded) ? rounded : null;
  }
  if (value.length > 250 || /(?:mensal|presta[çc][aã]o|presta[çc][oõ]es|monthly|per\s+month|\/\s*m[eê]s|\/\s*mo\b|\bentrada\b|\bdesde\b|\bfrom\b|\bmember|\bmembro|cart[aã]o|cashback)/i.test(value)) return null;
  if (/[-−]|\d\s*[x×]\s*\d/.test(value)) return null;
  const parts = value.replace(/[\u00a0\u202f]/g, ' ').match(/\d(?:[\d.,'’ ]*\d)?/g);
  if (!parts || parts.length !== 1) return null;
  let amount = parts[0].replace(/[ '’]/g, '');
  const dot = amount.lastIndexOf('.');
  const comma = amount.lastIndexOf(',');
  if (dot !== -1 && comma !== -1) {
    const decimal = dot > comma ? '.' : ',';
    const grouping = decimal === '.' ? ',' : '.';
    const [whole, fraction, ...extra] = amount.split(decimal);
    if (extra.length || !fraction || fraction.length > digits || !new RegExp(`^\\d{1,3}(?:\\${grouping}\\d{3})*$|^\\d+$`).test(whole)) return null;
    amount = whole.split(grouping).join('') + '.' + fraction;
  } else if (dot !== -1 || comma !== -1) {
    const separator = dot !== -1 ? '.' : ',';
    const segments = amount.split(separator);
    if (segments.length === 2 && segments[1].length <= digits && segments[1].length > 0) amount = segments.join('.');
    else if (segments.slice(1).every((segment) => segment.length === 3) && segments[0].length <= 3) amount = segments.join('');
    else return null;
  }
  if (!/^\d+(?:\.\d+)?$/.test(amount)) return null;
  const [whole, fraction = ''] = amount.split('.');
  if (fraction.length > digits) return null;
  const minor = Number(whole) * 10 ** digits + Number(fraction.padEnd(digits, '0'));
  return Number.isSafeInteger(minor) ? minor : null;
}

export const REASON_LABELS: Record<string, string> = {
  seller_unknown: 'Vendedor não identificado', seller_marketplace: 'Oferta de marketplace excluída',
  seller_excluded: 'Vendedor excluído', seller_not_allowed: 'Vendedor fora da lista permitida',
  condition_unknown: 'Condição do artigo desconhecida', condition_not_new: 'Artigo não é novo',
  variant_unknown: 'Variante não confirmada', variant_mismatch: 'Variante diferente',
  currency_unknown: 'Moeda desconhecida', currency_mismatch: 'Moeda diferente da configuração',
  price_unknown: 'Preço total do artigo desconhecido', shipping_unknown: 'Portes desconhecidos',
  price_above_limit: 'Preço acima do limite', action_unknown: 'Compra ou reserva não indicada',
  action_excluded: 'Modalidade fora dos critérios', store_unknown: 'Loja física não identificada',
  store_not_selected: 'Loja física não selecionada', stock_unknown: 'Stock indeterminado',
  out_of_stock: 'Esgotado', preorder: 'Pré-venda', backorder: 'Encomenda pendente',
  evidence_insufficient: 'Evidência insuficiente ou contraditória',
};

export function evaluateOffer(offer: Offer, criteria: Criteria): EvaluatedOffer {
  const commonExcluded: string[] = [];
  const commonUnknown: string[] = [];
  if (!offer.sellerName && (criteria.sellerPolicy === 'direct_only' || criteria.allowedSellers.length || criteria.excludedSellers.length)) commonUnknown.push('seller_unknown');
  if (criteria.sellerPolicy === 'direct_only') {
    if (offer.sellerType === 'unknown') commonUnknown.push('seller_unknown');
    if (offer.sellerType === 'marketplace') commonExcluded.push('seller_marketplace');
  }
  if (offer.sellerName && matches(offer.sellerName, criteria.excludedSellers)) commonExcluded.push('seller_excluded');
  if (criteria.allowedSellers.length && offer.sellerName && !matches(offer.sellerName, criteria.allowedSellers)) commonExcluded.push('seller_not_allowed');
  if (criteria.condition === 'new') {
    if (offer.condition === 'unknown') commonUnknown.push('condition_unknown');
    else if (offer.condition !== 'new') commonExcluded.push('condition_not_new');
  }
  if (criteria.variant) {
    if (!offer.variant) commonUnknown.push('variant_unknown');
    else if (normal(offer.variant) !== normal(criteria.variant)) commonExcluded.push('variant_mismatch');
  }
  if (criteria.currency) {
    if (!offer.currency) commonUnknown.push('currency_unknown');
    else if (offer.currency.toUpperCase() !== criteria.currency.toUpperCase()) commonExcluded.push('currency_mismatch');
  }
  if (criteria.maxPriceMinor !== null) {
    if (offer.priceMinor === null || !Number.isSafeInteger(offer.priceMinor) || offer.priceMinor < 0) commonUnknown.push('price_unknown');
    if (criteria.priceBasis === 'delivered' && offer.shippingMinor === null) commonUnknown.push('shipping_unknown');
    if (offer.priceMinor !== null && (criteria.priceBasis === 'item' || offer.shippingMinor !== null)) {
      const total = offer.priceMinor + (criteria.priceBasis === 'delivered' ? offer.shippingMinor! : 0);
      if (total > criteria.maxPriceMinor) commonExcluded.push('price_above_limit');
    }
  }
  const evaluations: Record<string, Evaluation> = Object.create(null) as Record<string, Evaluation>;
  for (const modality of offer.modalities) {
    const excluded = [...commonExcluded];
    const unknown = [...commonUnknown];
    if (modality.action === 'unknown') unknown.push('action_unknown');
    else if (!criteria.actions.includes(modality.action)) excluded.push('action_excluded');
    if (['pickup_order', 'pickup_reservation', 'store_only'].includes(modality.action)) {
      if (!modality.storeId) unknown.push('store_unknown');
      else if (!criteria.storeIds.includes(modality.storeId)) excluded.push('store_not_selected');
    }
    if (modality.stock === 'unknown') unknown.push('stock_unknown');
    else if (modality.stock !== 'in_stock') excluded.push(modality.stock);
    if (modality.quality !== 'strong') unknown.push('evidence_insufficient');
    evaluations[modality.key] = {
      status: excluded.length ? 'excluded' : unknown.length ? 'undetermined' : 'eligible',
      reasons: [...new Set([...excluded, ...unknown])],
    };
  }
  return { ...offer, evaluations };
}

export interface TrackingObservation {
  checkId: string; observedAt: string; stock: Stock; eligible: boolean;
  reasons: string[]; quality: Modality['quality'];
}
export interface TrackingState {
  baseline: boolean; initial: boolean; episode: number; lastCheckId: string | null;
  lastObservedAt: string | null; stable: TrackingObservation | null;
  candidate: { observation: TrackingObservation; since: string; signature: string } | null;
}
export interface TransitionOptions {
  now: string; confirmation: Criteria['confirmation']; notifyInitial: boolean;
  isInitialSourceObservation: boolean; minConfirmationMs?: number; maxConfirmationAgeMs?: number;
}
export interface TransitionResult {
  state: TrackingState;
  event: { type: EventType; episode: number; reasons: string[] } | null;
}

const signature = (observation: TrackingObservation) => `${observation.stock}|${observation.eligible}|${[...observation.reasons].sort().join(',')}`;
function eventType(previous: TrackingObservation | null, initial: boolean): EventType {
  if (initial) return 'initial_available';
  if (previous?.stock === 'out_of_stock') return 'restocked';
  if (previous?.stock === 'in_stock' && previous.reasons.includes('price_above_limit')) return 'price_eligible';
  return 'eligible_offer_found';
}

/** Pure reducer. Persist returned state and event atomically. Unknown reads cancel candidates only. */
export function transitionTracking(previous: TrackingState | null, observation: TrackingObservation | null, options: TransitionOptions): TransitionResult {
  const state: TrackingState = previous ? structuredClone(previous) : {
    baseline: false, initial: options.isInitialSourceObservation, episode: 0,
    lastCheckId: null, lastObservedAt: null, stable: null, candidate: null,
  };
  const now = Date.parse(options.now);
  if (!Number.isFinite(now)) throw new Error('Invalid transition timestamp');
  if (!observation || observation.quality !== 'strong' || observation.stock === 'unknown') {
    state.candidate = null;
    return { state, event: null };
  }
  const at = Date.parse(observation.observedAt);
  if (!Number.isFinite(at) || at > now || observation.checkId === state.lastCheckId || (state.lastObservedAt && at <= Date.parse(state.lastObservedAt))) return { state, event: null };
  state.lastCheckId = observation.checkId;
  state.lastObservedAt = observation.observedAt;
  if (!state.baseline) {
    state.baseline = true;
    if (!observation.eligible || (state.initial && !options.notifyInitial)) {
      state.stable = observation;
      state.initial = false;
      return { state, event: null };
    }
  }
  if (state.stable && signature(state.stable) === signature(observation)) {
    state.stable = observation;
    state.candidate = null;
    return { state, event: null };
  }
  // Changes among positive observations do not create another availability episode.
  if (state.stable?.eligible && observation.eligible) {
    state.stable = observation;
    state.candidate = null;
    return { state, event: null };
  }
  const candidateAge = state.candidate ? at - Date.parse(state.candidate.since) : Number.POSITIVE_INFINITY;
  const candidateMatches = state.candidate?.signature === signature(observation) && candidateAge <= (options.maxConfirmationAgeMs ?? 30 * 60_000);
  if (options.confirmation === 'two_checks') {
    if (!candidateMatches) {
      state.candidate = { observation, since: observation.observedAt, signature: signature(observation) };
      return { state, event: null };
    }
    if (candidateAge < (options.minConfirmationMs ?? 60_000)) return { state, event: null };
  }
  const old = state.stable;
  const initial = state.initial;
  state.stable = observation;
  state.candidate = null;
  state.initial = false;
  if (!observation.eligible || old?.eligible) return { state, event: null };
  state.episode += 1;
  return { state, event: { type: eventType(old, initial), episode: state.episode, reasons: observation.reasons } };
}

export interface SourceTrackingState {
  revision: number; baselineEstablished: boolean; lastCheckId: string | null;
  lastObservedAt: string | null; entries: Record<string, TrackingState>;
}
export interface TrackingContext {
  revision: number; checkId: string; now: string; captureOk: boolean; complete: boolean;
  criteria: Criteria; minConfirmationMs?: number; maxConfirmationAgeMs?: number;
}
export interface TrackingEvent {
  type: EventType; episode: number; reasons: string[]; dedupKey: string;
  offerKey: string; modalityKey: string;
}
export interface SourceTransitionResult { state: SourceTrackingState; events: TrackingEvent[]; }

export function observationFor(offer: EvaluatedOffer, modalityKey: string, checkId: string, observedAt: string): TrackingObservation | null {
  const modality = offer.modalities.find((candidate) => candidate.key === modalityKey);
  const evaluation = offer.evaluations[modalityKey];
  if (!modality || !evaluation || evaluation.status === 'undetermined' || modality.quality !== 'strong' || modality.stock === 'unknown') return null;
  return { checkId, observedAt, stock: modality.stock, eligible: evaluation.status === 'eligible', reasons: evaluation.reasons, quality: modality.quality };
}

export function advanceTracking(previous: SourceTrackingState | null, offers: EvaluatedOffer[], context: TrackingContext): SourceTransitionResult {
  const state: SourceTrackingState = previous && previous.revision === context.revision ? structuredClone(previous) : {
    revision: context.revision, baselineEstablished: false, lastCheckId: null, lastObservedAt: null, entries: {},
  };
  const now = Date.parse(context.now);
  if (!Number.isFinite(now)) throw new Error('Invalid tracking timestamp');
  if (state.lastCheckId === context.checkId || (state.lastObservedAt && now <= Date.parse(state.lastObservedAt))) return { state, events: [] };
  state.lastCheckId = context.checkId;
  state.lastObservedAt = context.now;
  const events: TrackingEvent[] = [];
  const observed = new Set<string>();
  let validCount = 0;
  if (context.captureOk) for (const offer of offers) for (const modality of offer.modalities) {
    const key = JSON.stringify([offer.key, modality.key]);
    if (observed.has(key)) continue;
    observed.add(key);
    const observation = observationFor(offer, modality.key, context.checkId, context.now);
    if (!observation && !state.entries[key]) continue;
    if (observation) validCount += 1;
    const result = transitionTracking(state.entries[key] ?? null, observation, {
      now: context.now, confirmation: context.criteria.confirmation, notifyInitial: context.criteria.notifyInitial,
      isInitialSourceObservation: !state.baselineEstablished,
      minConfirmationMs: context.minConfirmationMs, maxConfirmationAgeMs: context.maxConfirmationAgeMs,
    });
    state.entries[key] = result.state;
    if (result.event) events.push({ ...result.event, offerKey: offer.key, modalityKey: modality.key,
      dedupKey: JSON.stringify([context.revision, key, result.event.episode]) });
  }
  // Absence, even in a complete extraction, is not proof of stock depletion.
  for (const [key, entry] of Object.entries(state.entries)) if (!observed.has(key)) entry.candidate = null;
  if (validCount) state.baselineEstablished = true;
  return { state, events };
}
