import { load } from 'cheerio';
import type { Action, Evidence, Extraction, Modality, Offer, ReadRule, Stock } from '../../contracts/src/index.js';
import { parseMoney } from '../../domain/src/index.js';

type ObjectValue = Record<string, unknown>;
type Selection = ReturnType<ReturnType<typeof load>>;
const MAX_OFFERS = 100;
const norm = (value: string) => value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
const clean = (value: string) => value.replace(/\s+/g, ' ').trim().slice(0, 1_000);
const asObject = (value: unknown): ObjectValue | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as ObjectValue : null;
const text = (value: unknown): string => typeof value === 'string' || typeof value === 'number' ? clean(String(value)) : '';
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : value == null ? [] : [value];
const typeIs = (value: ObjectValue, type: string) => list(value['@type']).some((entry) => text(entry).split(/[/#]/).pop() === type);
const term = (value: unknown) => text(value).split(/[/#]/).pop()?.toLowerCase() ?? '';
function keyOf(parts: string[]): string { return JSON.stringify(parts.map(norm)); }

function currencyOf(value: string): string {
  const code = value.match(/\b(EUR|USD|GBP|JPY|CHF|CAD|AUD|BRL|CNY|KRW|KWD|BHD|TND)\b/i)?.[1];
  if (code) return code.toUpperCase();
  if (value.includes('€')) return 'EUR';
  if (value.includes('£')) return 'GBP';
  // "$" and "¥" are shared by several currencies: do not guess a region.
  return '';
}
function availability(value: unknown): Stock {
  switch (term(value)) {
    case 'instock': case 'in_stock': case 'limitedavailability': return 'in_stock';
    case 'outofstock': case 'out_of_stock': case 'soldout': case 'discontinued': return 'out_of_stock';
    case 'preorder': case 'presale': return 'preorder';
    case 'backorder': return 'backorder';
    default: return 'unknown';
  }
}
function conditionOf(value: unknown): Offer['condition'] {
  switch (term(value)) {
    case 'newcondition': case 'new': case 'novo': return 'new';
    case 'usedcondition': case 'used': case 'usado': return 'used';
    case 'refurbishedcondition': case 'refurbished': case 'recondicionado': return 'refurbished';
    default: return 'unknown';
  }
}
function actionOf(value: string): Action {
  if (/^(online_order|pickup_order|pickup_reservation|store_only)$/.test(value)) return value as Action;
  if (/reserv(?:ar|e).*(?:loja|store|levant|pickup)|(?:loja|store|pickup).*reserv/i.test(value)) return 'pickup_reservation';
  if (/(?:comprar|encomendar|order).*(?:levant|recolh|pickup|collect)/i.test(value)) return 'pickup_order';
  if (/^(?:adicionar ao carrinho|adicionar [aà] cesta|comprar|comprar agora|add to (?:cart|basket)|buy now|buy)$/i.test(clean(value))) return 'online_order';
  return 'unknown';
}
function stockFromText(value: string, rule: ReadRule): { stock: Stock; conflict: boolean; explicit: boolean } {
  const valueNorm = norm(value);
  const positive = rule.availableText ? valueNorm.includes(norm(rule.availableText)) : /(?:^|\b)(?:em stock|in stock|dispon[ií]vel|available)(?:\b|$)/i.test(valueNorm);
  const negative = rule.unavailableText ? valueNorm.includes(norm(rule.unavailableText)) : /(?:esgotad[oa]s?|sem stock|indispon[ií]vel|n[aã]o dispon[ií]vel|out of stock|sold out|unavailable|not available)/i.test(valueNorm);
  // Negated generic words cannot count as an independent positive signal.
  const independentPositive = positive && (Boolean(rule.availableText) || !negative);
  const preorder = /pr[eé][ -]venda|pre[ -]?order|pre[ -]?sale/i.test(valueNorm);
  const backorder = /back[ -]?order|encomenda pendente/i.test(valueNorm);
  if ((independentPositive && negative) || ((preorder || backorder) && negative)) return { stock: 'unknown', conflict: true, explicit: true };
  if (negative) return { stock: 'out_of_stock', conflict: false, explicit: true };
  if (preorder) return { stock: 'preorder', conflict: false, explicit: true };
  if (backorder) return { stock: 'backorder', conflict: false, explicit: true };
  if (positive) return { stock: 'in_stock', conflict: false, explicit: true };
  return { stock: 'unknown', conflict: false, explicit: false };
}

/** Generic, bounded extraction. All returned evidence remains inert text. */
export function extractOffers(html: string, url: string, rule: ReadRule): Extraction {
  const warnings: string[] = [];
  if (html.length > 5 * 1024 * 1024) return { title: '', offers: [], warnings: ['Conteúdo excede o limite de análise.'], complete: false };
  const $ = load(html);
  const title = clean($('h1').first().text() || $('title').first().text());
  let complete = true;
  function warning(message: string): void { if (!warnings.includes(message)) warnings.push(message); complete = false; }
  const objects: ObjectValue[] = [];
  const byId = new Map<string, ObjectValue>();
  let jsonBytes = 0;
  function walk(value: unknown, depth = 0): void {
    if (depth > 30 || objects.length > 10_000) { warning('Dados estruturados demasiado complexos.'); return; }
    if (Array.isArray(value)) { for (const item of value.slice(0, 1_000)) walk(item, depth + 1); return; }
    const object = asObject(value);
    if (!object) return;
    objects.push(object);
    if (typeof object['@id'] === 'string' && Object.keys(object).length > 1) byId.set(object['@id'], object);
    for (const child of Object.values(object)) if (child && typeof child === 'object') walk(child, depth + 1);
  }
  $('script[type="application/ld+json"]').slice(0, 30).each((_index, element) => {
    const raw = $(element).text(); jsonBytes += raw.length;
    if (raw.length > 512 * 1024 || jsonBytes > 1024 * 1024) { warning('Dados estruturados excedem o limite.'); return; }
    try { walk(JSON.parse(raw)); } catch { warning('JSON-LD inválido; rever a informação visível.'); }
  });
  function resolve(value: unknown): ObjectValue | null {
    const object = asObject(value);
    if (!object) return null;
    const referenced = typeof object['@id'] === 'string' ? byId.get(object['@id']) : null;
    return referenced ? { ...referenced, ...object } : object;
  }
  function pageMatches(value: unknown): boolean {
    const candidate = text(value) || text(asObject(value)?.['@id']);
    if (!candidate) return false;
    try { const actual = new URL(candidate, url); const expected = new URL(url); actual.hash = ''; expected.hash = ''; return actual.href === expected.href; } catch { return false; }
  }
  const products = objects.filter((object) => typeIs(object, 'Product') || typeIs(object, 'IndividualProduct'));
  let selectedProducts = products.filter((product) => pageMatches(product.url) || pageMatches(product.mainEntityOfPage));
  if (!selectedProducts.length && title) selectedProducts = products.filter((product) => norm(text(product.name)) === norm(title));
  if (!selectedProducts.length && products.length === 1 && !title) selectedProducts = products;
  if (selectedProducts.length > 1) {
    const identities = new Set(selectedProducts.map((product) => keyOf([text(product.name), text(product.sku), text(product['@id'])])));
    if (identities.size > 1) { warning('Vários produtos estruturados correspondem à página; selecionar uma oferta.'); selectedProducts = []; }
    else selectedProducts = [selectedProducts[0]];
  }
  if (products.length && !selectedProducts.length) warning('Não foi possível associar os dados estruturados ao produto principal.');

  // Scripts, hidden blocks and navigation must never provide DOM stock evidence.
  $('script, style, noscript, template, nav, header, footer, [hidden], [aria-hidden="true"], [inert]').remove();
  $('[style]').each((_index, element) => { if (/(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test($(element).attr('style') ?? '')) $(element).remove(); });

  function select(scope: Selection, selector: string, label: string, allowMultiple = false): Selection {
    if (!selector) return $([]);
    if (selector.length > 1_000) { warning(`Seletor de ${label} demasiado longo.`); return $([]); }
    try {
      const result = scope.find(selector).add(scope.filter(selector));
      if (result.length > 1 && !allowMultiple) { warning(`Seletor de ${label} ambíguo; encontrou ${result.length} elementos.`); return $([]); }
      if (!result.length) warning(`Seletor de ${label} não encontrou elementos.`);
      return result;
    } catch { warning(`Seletor de ${label} inválido.`); return $([]); }
  }
  function valueOf(selection: Selection): string { return clean(selection.attr('content') ?? selection.attr('value') ?? selection.text()); }

  let scopes: Selection;
  if (rule.scopeSelector) {
    try { scopes = $(rule.scopeSelector); } catch { return { title, offers: [], warnings: ['Seletor da oferta inválido.'], complete: false }; }
    if (scopes.length !== 1) return { title, offers: [], warnings: ['O âmbito configurado deve identificar exatamente uma oferta.'], complete: false };
  } else {
    scopes = $('[data-monitor-offer], [itemtype$="/Offer"], [itemtype$="#Offer"]');
    if (!scopes.length) {
      const productScopes = $('[itemtype$="/Product"], [itemtype$="#Product"]');
      scopes = productScopes.length === 1 ? productScopes : $('main, [role="main"]').first();
    }
  }
  if (scopes.length > MAX_OFFERS) warning('Número de ofertas excede o limite da análise.');
  const domOffers: Offer[] = [];
  const safeManualMapping = Boolean(rule.scopeSelector) || scopes.length === 1;
  scopes.slice(0, MAX_OFFERS).each((_index, element) => {
    const scope = $(element);
    const warningsBefore = warnings.length;
    const stockNode = rule.stockSelector ? select(scope, rule.stockSelector, 'stock') : scope.find('[data-stock], [itemprop="availability"]').first();
    const sellerNode = rule.sellerSelector ? select(scope, rule.sellerSelector, 'vendedor') : scope.find('[itemprop="seller"], [data-seller]').first();
    const priceNode = rule.priceSelector ? select(scope, rule.priceSelector, 'preço') : scope.find('[itemprop="price"], [data-price]').first();
    const purchaseNode = rule.purchaseSelector ? select(scope, rule.purchaseSelector, 'ação de compra') : scope.find('[data-purchase-action], [itemprop="potentialAction"]').first();
    const rawStock = clean(stockNode.attr('data-stock') || stockNode.attr('content') || stockNode.attr('href') || stockNode.text());
    const stockEvidence = stockFromText(rawStock, rule);
    const structuredStock = availability(rawStock);
    let stock = structuredStock === 'unknown' ? stockEvidence.stock : structuredStock;
    let action = actionOf(purchaseNode.attr('data-purchase-action') ?? valueOf(purchaseNode));
    const disabled = purchaseNode.is('[disabled], [aria-disabled="true"]') || purchaseNode.closest('[inert]').length > 0;
    if (action !== 'unknown' && !disabled && stock === 'unknown' && !stockEvidence.conflict) stock = 'in_stock';
    let conflict = stockEvidence.conflict;
    if (action !== 'unknown' && stock === 'out_of_stock' && !disabled) conflict = true;
    if (conflict) { stock = 'unknown'; warning('Sinais de disponibilidade contraditórios na mesma oferta.'); }
    if (action === 'unknown' && safeManualMapping && rule.confirmedAction !== 'unknown') action = rule.confirmedAction;
    const rawPrice = valueOf(priceNode) || text(scope.attr('data-price'));
    const currency = clean(scope.find('[itemprop="priceCurrency"]').first().attr('content') ?? scope.find('[itemprop="priceCurrency"]').first().text()).toUpperCase() || currencyOf(rawPrice);
    const sellerName = clean(sellerNode.attr('data-seller') || valueOf(sellerNode)) || (safeManualMapping ? rule.directSeller : '');
    const mappedDirect = Boolean(rule.directSeller && sellerName && norm(rule.directSeller) === norm(sellerName));
    let sellerType: Offer['sellerType'] = mappedDirect ? 'direct' : 'unknown';
    if (safeManualMapping && rule.confirmedSellerType !== 'unknown' && (!rule.directSeller || mappedDirect || rule.confirmedSellerType === 'marketplace')) sellerType = rule.confirmedSellerType;
    if (rule.directSeller && sellerName && !mappedDirect) sellerType = 'marketplace';
    const observedVariant = clean(scope.attr('data-variant') ?? scope.find('[itemprop="color"], [itemprop="size"]').first().text());
    const variant = observedVariant || (safeManualMapping ? rule.variant : '');
    const observedCondition = conditionOf(scope.attr('data-condition') ?? scope.find('[itemprop="itemCondition"]').first().attr('content') ?? scope.find('[itemprop="itemCondition"]').first().attr('href'));
    const condition = observedCondition === 'unknown' && safeManualMapping ? rule.confirmedCondition : observedCondition;
    const productName = clean(scope.find('[itemprop="name"], h1').first().text()) || title;
    const storeId = (scope.attr('data-store-id') ?? (safeManualMapping ? rule.storeId : '')) || null;
    const evidence: Evidence[] = [];
    if (rawStock) evidence.push({ kind: 'dom', text: rawStock, path: rule.stockSelector || '[data-stock], [itemprop="availability"]' });
    if (purchaseNode.length) evidence.push({ kind: 'dom', text: valueOf(purchaseNode) + (disabled ? ' [desativado]' : ''), path: rule.purchaseSelector || '[data-purchase-action]' });
    if (safeManualMapping && (rule.confirmedAction !== 'unknown' || rule.confirmedSellerType !== 'unknown')) evidence.push({ kind: 'rule', text: 'Mapeamento de âmbito confirmado pelo utilizador', path: rule.scopeSelector || 'âmbito único' });
    if (rawPrice) evidence.push({ kind: 'dom', text: rawPrice, path: rule.priceSelector || '[itemprop="price"]' });
    const quality: Modality['quality'] = conflict || warnings.length > warningsBefore || (disabled && stock === 'in_stock') ? 'insufficient' : stock === 'unknown' ? 'partial' : 'strong';
    // A title alone is not an observed commercial offer.
    if (!evidence.length && !sellerName && !rawPrice) return;
    domOffers.push({
      key: keyOf(['offer', productName, sellerName, variant, condition]), productName, variant, sellerName, sellerType,
      condition, priceMinor: parseMoney(rawPrice, currency), shippingMinor: null, currency,
      modalities: [{ key: keyOf(['modality', action, storeId ?? '']), action, stock, storeId, quality, evidence: evidence.filter((item) => item.kind !== 'dom' || item.text !== rawPrice) }],
      evidence,
    });
  });

  const structuredOffers: Offer[] = [];
  const visited = new Set<ObjectValue>();
  function collectOffer(value: unknown, product: ObjectValue, depth = 0): void {
    const object = resolve(value);
    if (!object || depth > 10 || structuredOffers.length >= MAX_OFFERS) return;
    const identity = byId.get(text(object['@id'])) ?? asObject(value) ?? object;
    if (visited.has(identity)) return;
    visited.add(identity);
    if (typeIs(object, 'AggregateOffer') || object.offers) {
      for (const child of list(object.offers)) collectOffer(child, product, depth + 1);
      if (typeIs(object, 'AggregateOffer')) return; // A range/aggregate does not identify a seller's buyable offer.
    }
    if (!typeIs(object, 'Offer') && object.price === undefined && object.availability === undefined) return;
    const seller = resolve(object.seller) ?? resolve(object.offeredBy);
    const sellerName = typeof object.seller === 'string' ? text(object.seller) : text(seller?.name);
    const item = resolve(object.itemOffered) ?? product;
    const variant = text(item.color) || text(item.size) || text(object.sku) || text(item.sku);
    const productName = text(item.name) || text(product.name) || title;
    const currency = text(object.priceCurrency).toUpperCase();
    const stock = availability(object.availability);
    const condition = conditionOf(object.itemCondition ?? item.itemCondition);
    const potential = list(object.potentialAction).map(resolve).filter((entry): entry is ObjectValue => entry !== null);
    const action: Action = potential.some((entry) => typeIs(entry, 'BuyAction')) ? 'online_order' : 'unknown';
    const evidence: Evidence[] = [{ kind: 'jsonld', text: `Disponibilidade: ${text(object.availability) || 'desconhecida'}; vendedor: ${sellerName || 'desconhecido'}`, path: text(object['@id']) || 'Product.offers' }];
    let shippingMinor: number | null = null;
    const shipping = list(object.shippingDetails).map(resolve).filter((entry): entry is ObjectValue => entry !== null);
    if (shipping.length === 1) {
      const rate = resolve(shipping[0].shippingRate);
      if (rate && text(rate.currency).toUpperCase() === currency) shippingMinor = parseMoney(text(rate.value), currency);
    }
    structuredOffers.push({
      key: keyOf(['offer', productName, sellerName, variant, condition]), productName, variant, sellerName,
      sellerType: rule.directSeller && sellerName ? (norm(rule.directSeller) === norm(sellerName) ? 'direct' : 'marketplace') : 'unknown',
      condition, priceMinor: parseMoney(typeof object.price === 'number' ? object.price : text(object.price), currency),
      shippingMinor, currency, evidence,
      modalities: [{ key: keyOf(['modality', action, '']), action, stock, storeId: null, quality: stock === 'unknown' ? 'insufficient' : 'partial', evidence }],
    });
  }
  for (const product of selectedProducts) for (const offer of list(product.offers)) collectOffer(offer, product);
  if (structuredOffers.length === MAX_OFFERS) warning('A análise atingiu o limite de ofertas estruturadas.');

  const offers: Offer[] = [...structuredOffers];
  for (const dom of domOffers) {
    const compatible = offers.filter((offer) =>
      norm(offer.productName) === norm(dom.productName) &&
      (!offer.sellerName || !dom.sellerName || norm(offer.sellerName) === norm(dom.sellerName)) &&
      (!offer.variant || !dom.variant || norm(offer.variant) === norm(dom.variant)) &&
      (offer.condition === 'unknown' || dom.condition === 'unknown' || offer.condition === dom.condition));
    // A DOM scope with an unnamed seller cannot borrow one seller's stock from a multi-offer page.
    const match = compatible.length === 1 && (Boolean(dom.sellerName) || structuredOffers.length === 1) ? compatible[0] : null;
    if (!match) { offers.push(dom); continue; }
    const domModality = dom.modalities[0];
    const ldModality = match.modalities[0];
    const stockConflict = domModality.stock !== 'unknown' && ldModality.stock !== 'unknown' && domModality.stock !== ldModality.stock;
    const priceConflict = dom.priceMinor !== null && match.priceMinor !== null && (dom.priceMinor !== match.priceMinor || dom.currency !== match.currency);
    const evidenceConflict = domModality.quality === 'insufficient';
    if (stockConflict || priceConflict) warning('Informação visível e dados estruturados divergem para a mesma oferta.');
    match.sellerName ||= dom.sellerName;
    if (dom.sellerType !== 'unknown') match.sellerType = dom.sellerType;
    if (match.condition === 'unknown') match.condition = dom.condition;
    match.variant ||= dom.variant;
    if (dom.priceMinor !== null) { match.priceMinor = priceConflict ? null : dom.priceMinor; match.currency = dom.currency; }
    const action = domModality.action !== 'unknown' ? domModality.action : ldModality.action;
    match.modalities = [{
      key: keyOf(['modality', action, domModality.storeId ?? '']), action, storeId: domModality.storeId,
      stock: stockConflict || evidenceConflict ? 'unknown' : domModality.stock !== 'unknown' ? domModality.stock : ldModality.stock,
      quality: stockConflict || evidenceConflict || priceConflict ? 'insufficient' : domModality.quality,
      evidence: [...ldModality.evidence, ...domModality.evidence],
    }];
    match.evidence = [...match.evidence, ...dom.evidence];
    match.key = keyOf(['offer', match.productName, match.sellerName, match.variant, match.condition]);
  }
  const keyed = new Map<string, Offer>();
  for (const offer of offers) {
    const previous = keyed.get(offer.key);
    if (!previous) { keyed.set(offer.key, offer); continue; }
    for (const modality of offer.modalities) {
      const existing = previous.modalities.find((item) => item.key === modality.key);
      if (!existing) previous.modalities.push(modality);
      else if (existing.stock !== modality.stock || previous.priceMinor !== offer.priceMinor || previous.currency !== offer.currency) {
        existing.stock = 'unknown'; existing.quality = 'insufficient';
        warning('Ofertas duplicadas apresentam sinais diferentes; rever a regra.');
      }
    }
    previous.evidence.push(...offer.evidence);
  }
  if (!keyed.size) warning('Não foram identificadas ofertas. Configurar o âmbito e os sinais de stock.');
  return { title, offers: [...keyed.values()].slice(0, MAX_OFFERS), warnings, complete };
}
