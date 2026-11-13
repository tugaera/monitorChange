export type Stock = 'in_stock' | 'out_of_stock' | 'preorder' | 'backorder' | 'unknown';
export type Action = 'online_order' | 'pickup_order' | 'pickup_reservation' | 'store_only' | 'unknown';
export type SellerType = 'direct' | 'marketplace' | 'unknown';
export type CaptureStatus = 'ok' | 'timeout' | 'http_error' | 'blocked' | 'login_required' | 'limit_exceeded' | 'capture_error';
export interface Criteria {
  sellerPolicy: 'direct_only' | 'all';
  allowedSellers: string[];
  excludedSellers: string[];
  condition: 'new' | 'any';
  variant: string;
  currency: string;
  maxPriceMinor: number | null;
  priceBasis: 'item' | 'delivered';
  actions: Action[];
  storeIds: string[];
  notifyInitial: boolean;
  confirmation: 'two_checks' | 'one_check';
}
export const DEFAULT_CRITERIA: Criteria = {
  sellerPolicy: 'direct_only', allowedSellers: [], excludedSellers: [], condition: 'new',
  variant: '', currency: 'EUR', maxPriceMinor: null, priceBasis: 'item',
  actions: ['online_order'], storeIds: [], notifyInitial: false, confirmation: 'two_checks',
};
export interface Region { country: string; locale: string; currency: string; postalCode: string; }
export const DEFAULT_REGION: Region = { country: 'PT', locale: 'pt-PT', currency: 'EUR', postalCode: '' };
export interface ReadRule {
  scopeSelector: string;
  stockSelector: string;
  availableText: string;
  unavailableText: string;
  priceSelector: string;
  purchaseSelector: string;
  sellerSelector: string;
  directSeller: string;
  /** Explicit mapping of this scoped offer; never inferred from the hostname. */
  confirmedSellerType: SellerType;
  confirmedCondition: 'new' | 'used' | 'refurbished' | 'unknown';
  confirmedAction: Action;
  variant: string;
  storeId: string;
}
export const DEFAULT_RULE: ReadRule = {
  scopeSelector: '', stockSelector: '', availableText: '', unavailableText: '', priceSelector: '',
  purchaseSelector: '', sellerSelector: '', directSeller: '', confirmedSellerType: 'unknown',
  confirmedCondition: 'unknown', confirmedAction: 'unknown', variant: '', storeId: '',
};
export interface Evidence { kind: 'dom' | 'jsonld' | 'rule'; text: string; path: string; }
export interface Modality {
  key: string; action: Action; stock: Stock; storeId: string | null;
  quality: 'strong' | 'partial' | 'insufficient'; evidence: Evidence[];
}
export interface Offer {
  key: string; productName: string; variant: string; sellerName: string;
  sellerType: SellerType; condition: 'new' | 'used' | 'refurbished' | 'unknown';
  priceMinor: number | null; shippingMinor: number | null; currency: string;
  modalities: Modality[]; evidence: Evidence[];
}
export interface Evaluation { status: 'eligible' | 'excluded' | 'undetermined'; reasons: string[]; }
export interface EvaluatedOffer extends Offer { evaluations: Record<string, Evaluation>; }
export interface Extraction { title: string; offers: Offer[]; warnings: string[]; complete: boolean; }
export interface CaptureRequest { url: string; method: 'auto' | 'http' | 'browser'; locale: string; screenshot?: boolean; }
export interface ElementCandidate { id: string; tag: string; text: string; selector: string; x: number; y: number; width: number; height: number; }
export interface CaptureResult {
  status: CaptureStatus; method: 'http' | 'browser'; finalUrl: string; httpStatus: number | null;
  html: string; capturedAt: string; error: string | null; retryAfterSeconds?: number;
  screenshot?: string; elements?: ElementCandidate[]; captureId?: string;
}
export interface Product { id: string; name: string; criteria: Criteria; archived: boolean; createdAt: string; updatedAt: string; }
export interface Source {
  id: string; productId: string; name: string; url: string; active: boolean; revision: number;
  intervalSeconds: number; method: 'auto' | 'http' | 'browser'; region: Region; rule: ReadRule;
  criteria: Criteria | null; createdAt: string; updatedAt: string; nextCheckAt: string | null;
  lastAttemptAt: string | null; lastSuccessAt: string | null; lastStatus: CaptureStatus | null;
  lastError: string | null; failureCount: number;
}
export interface Check {
  id: string; sourceId: string; revision: number; startedAt: string; finishedAt: string;
  status: CaptureStatus; method: 'http' | 'browser'; error: string | null;
  offers: EvaluatedOffer[]; warnings: string[]; obsolete: boolean;
}
export type EventType = 'restocked' | 'eligible_offer_found' | 'price_eligible' | 'initial_available' | 'diagnostic';
export interface MonitorEvent {
  id: string; productId: string; sourceId: string; sourceName: string; productName: string;
  type: EventType; title: string; message: string; createdAt: string; readAt: string | null;
  archivedAt: string | null; url: string;
}
export interface SourceDetail extends Source { checks: Check[]; }
export interface AppSummary { products: number; sources: number; activeSources: number; unreadEvents: number; }
