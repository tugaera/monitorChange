import { describe, expect, it } from 'vitest';
import { DEFAULT_RULE, type ReadRule } from '../../packages/contracts/src/index.js';
import { extractOffers } from '../../packages/extractors/src/index.js';

const url = 'https://shop.example/products/example';
const rules = (overrides: Partial<ReadRule> = {}): ReadRule => ({ ...DEFAULT_RULE, ...overrides });
const product = (offers: unknown) => ({ '@type': 'Product', name: 'Artigo fictício', url, offers });
const ldOffer = (overrides: Record<string, unknown> = {}) => ({ '@type': 'Offer', seller: { name: 'Retalhista Alfa' }, price: '799.99', priceCurrency: 'EUR', availability: 'https://schema.org/InStock', itemCondition: 'https://schema.org/NewCondition', ...overrides });
const page = (body = '', json?: unknown) => `<!doctype html><html><head><title>Artigo fictício</title>${json ? `<script type="application/ld+json">${JSON.stringify(json)}</script>` : ''}</head><body><h1>Artigo fictício</h1>${body}</body></html>`;
const scopedRule = rules({ scopeSelector: '#offer', stockSelector: '.stock', priceSelector: '.price', purchaseSelector: 'button', directSeller: 'Retalhista Alfa', confirmedSellerType: 'direct', confirmedCondition: 'new', confirmedAction: 'online_order' });

describe('scoped DOM extraction', () => {
  it('reads the selected offer without adopting a banner purchase message', () => {
    const result = extractOffers(page('<aside>Disponível! Comprar agora</aside><section id="offer"><span class="stock">Esgotado</span><span class="price">799,99 €</span><button disabled>Adicionar ao carrinho</button></section>'), url, scopedRule);
    expect(result.offers).toHaveLength(1);
    expect(result.offers[0].modalities[0]).toMatchObject({ stock: 'out_of_stock', action: 'online_order', quality: 'strong' });
    expect(result.offers[0]).toMatchObject({ sellerName: 'Retalhista Alfa', sellerType: 'direct', priceMinor: 79999 });
  });
  it('detects a positive scoped stock with active action', () => {
    const result = extractOffers(page('<section id="offer"><span class="stock">Em stock</span><span class="price">799,99 €</span><button>Adicionar ao carrinho</button></section>'), url, scopedRule);
    expect(result.offers[0].modalities[0]).toMatchObject({ stock: 'in_stock', quality: 'strong', action: 'online_order' });
  });
  it('does not interpret a notification button as a purchase', () => {
    const result = extractOffers(page('<main><div data-monitor-offer><button data-purchase-action>Notifiquem-me</button></div></main>'), url, rules());
    expect(result.offers[0].modalities[0]).toMatchObject({ stock: 'unknown', action: 'unknown' });
  });
  it('does not treat disabled purchase with positive stock as strong evidence', () => {
    const result = extractOffers(page('<section id="offer"><span class="stock">Em stock</span><span class="price">799,99 €</span><button disabled>Comprar</button></section>'), url, scopedRule);
    expect(result.offers[0].modalities[0].quality).toBe('insufficient');
  });
  it('rejects selectors with zero or ambiguous scopes and invalid syntax', () => {
    expect(extractOffers(page('<main></main>'), url, rules({ scopeSelector: '#absent' })).offers).toHaveLength(0);
    expect(extractOffers(page('<div class="offer"></div><div class="offer"></div>'), url, rules({ scopeSelector: '.offer' })).offers).toHaveLength(0);
    expect(extractOffers(page('<main></main>'), url, rules({ scopeSelector: '[[[' })).complete).toBe(false);
  });
  it('cannot declare availability when a configured selector becomes ambiguous', () => {
    const result = extractOffers(page('<section id="offer"><span class="stock">Em stock</span><span class="stock">Em stock</span><span class="price">100 €</span><button>Comprar</button></section>'), url, scopedRule);
    expect(result.complete).toBe(false);
    expect(result.offers[0].modalities[0].quality).toBe('insufficient');
  });
  it('ignores hidden stock and does not confuse monthly payments with item price', () => {
    const result = extractOffers(page('<main><section data-monitor-offer><div hidden data-stock="in_stock">Em stock</div><span data-stock="outofstock">Esgotado</span><span data-price>29,99 €/mês</span></section></main>'), url, rules());
    expect(result.offers[0].priceMinor).toBeNull();
    expect(result.offers[0].modalities[0].stock).toBe('out_of_stock');
  });
  it('separates direct and marketplace DOM scopes, even on the same page', () => {
    const html = page('<main><div data-monitor-offer><span data-seller="Retalhista Alfa"></span><span data-stock="outofstock"></span><span data-price>100 €</span></div><div data-monitor-offer><span data-seller="Vendedor Beta"></span><span data-stock="instock"></span><span data-price>200 €</span></div></main>');
    const result = extractOffers(html, url, rules({ directSeller: 'Retalhista Alfa' }));
    expect(result.offers).toHaveLength(2);
    expect(result.offers[0]).toMatchObject({ sellerType: 'direct', priceMinor: 10000 });
    expect(result.offers[0].modalities[0].stock).toBe('out_of_stock');
    expect(result.offers[1]).toMatchObject({ sellerType: 'marketplace', priceMinor: 20000 });
    expect(result.offers[1].modalities[0].stock).toBe('in_stock');
  });
  it('separates delivery from physical stock at different stores', () => {
    const html = page('<main><div data-monitor-offer data-store-id="north"><span data-stock="instock"></span><button data-purchase-action="store_only">Stock em loja</button></div><div data-monitor-offer data-store-id="south"><span data-stock="outofstock"></span><button disabled data-purchase-action="pickup_order">Encomendar para recolha</button></div></main>');
    const result = extractOffers(html, url, rules());
    expect(result.offers[0].modalities.map((modality) => [modality.storeId, modality.stock])).toEqual([['north', 'in_stock'], ['south', 'out_of_stock']]);
  });
});

describe('structured offers and evidence reconciliation', () => {
  it('keeps sellers and prices separate across Offer arrays and does not assume action', () => {
    const result = extractOffers(page('', product([ldOffer({ availability: 'https://schema.org/OutOfStock' }), ldOffer({ seller: { name: 'Vendedor Beta' }, price: '950' })])), url, rules({ directSeller: 'Retalhista Alfa' }));
    expect(result.offers).toHaveLength(2);
    expect(result.offers[0]).toMatchObject({ sellerName: 'Retalhista Alfa', priceMinor: 79999, sellerType: 'direct' });
    expect(result.offers[0].modalities[0].stock).toBe('out_of_stock');
    expect(result.offers[1]).toMatchObject({ sellerName: 'Vendedor Beta', priceMinor: 95000, sellerType: 'marketplace' });
    expect(result.offers[1].modalities[0]).toMatchObject({ stock: 'in_stock', action: 'unknown', quality: 'partial' });
  });
  it('keeps unknown seller unknown instead of inferring the domain', () => {
    const result = extractOffers(page('', product(ldOffer({ seller: undefined }))), url, rules());
    expect(result.offers[0].sellerType).toBe('unknown');
    expect(result.offers[0].sellerName).toBe('');
  });
  it('selects the main product and ignores a recommended product', () => {
    const result = extractOffers(page('', [product(ldOffer({ availability: 'https://schema.org/OutOfStock' })), { '@type': 'Product', name: 'Acessório diferente', url: 'https://shop.example/other', offers: ldOffer() }]), url, rules());
    expect(result.offers).toHaveLength(1);
    expect(result.offers[0].modalities[0].stock).toBe('out_of_stock');
  });
  it('resolves graph IDs, including seller references', () => {
    const json = { '@graph': [{ '@type': 'Product', name: 'Artigo fictício', offers: { '@id': '#offer' } }, { ...ldOffer({ seller: { '@id': '#seller' } }), '@id': '#offer' }, { '@type': 'Organization', '@id': '#seller', name: 'Retalhista Alfa' }] };
    const result = extractOffers(page('', json), url, rules());
    expect(result.offers[0].sellerName).toBe('Retalhista Alfa');
    expect(result.offers[0].priceMinor).toBe(79999);
  });
  it('does not promote an AggregateOffer range to a buyable offer', () => {
    const result = extractOffers(page('', product({ '@type': 'AggregateOffer', lowPrice: 100, highPrice: 900, offerCount: 5, priceCurrency: 'EUR' })), url, rules());
    expect(result.offers).toHaveLength(0);
  });
  it('reads an AggregateOffer child list without using the range price', () => {
    const result = extractOffers(page('', product({ '@type': 'AggregateOffer', lowPrice: 100, offers: [ldOffer()] })), url, rules());
    expect(result.offers[0].priceMinor).toBe(79999);
  });
  it('makes same-offer DOM/JSON-LD stock conflict indeterminate', () => {
    const result = extractOffers(page('<section id="offer"><span class="stock">Esgotado</span><span class="price">799,99 €</span><button disabled>Comprar</button></section>', product(ldOffer())), url, scopedRule);
    expect(result.offers).toHaveLength(1);
    expect(result.offers[0].modalities[0]).toMatchObject({ stock: 'unknown', quality: 'insufficient' });
    expect(result.warnings.some((warning) => warning.includes('divergem'))).toBe(true);
  });
  it('combines consistent DOM evidence with the same structured offer', () => {
    const result = extractOffers(page('<section id="offer"><span class="stock">Em stock</span><span class="price">799,99 €</span><button>Comprar</button></section>', product(ldOffer())), url, scopedRule);
    expect(result.offers).toHaveLength(1);
    expect(result.offers[0].modalities[0]).toMatchObject({ stock: 'in_stock', quality: 'strong', action: 'online_order' });
  });
  it('reports malformed JSON-LD and oversized pages without throwing', () => {
    expect(extractOffers('<script type="application/ld+json">{broken</script>', url, rules()).warnings).toContain('JSON-LD inválido; rever a informação visível.');
    expect(extractOffers('x'.repeat(5 * 1024 * 1024 + 1), url, rules()).complete).toBe(false);
  });
  it('keeps offer identities stable when marketplace order changes', () => {
    const a = ldOffer(); const b = ldOffer({ seller: { name: 'Vendedor Beta' } });
    const first = extractOffers(page('', product([a, b])), url, rules());
    const second = extractOffers(page('', product([b, a])), url, rules());
    expect(first.offers.map((offer) => offer.key).sort()).toEqual(second.offers.map((offer) => offer.key).sort());
  });
});
