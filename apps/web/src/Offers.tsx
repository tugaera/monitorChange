import { REASON_LABELS, actionLabels, money, stockLabels, type EvaluatedOffer } from './model';
import { Badge, Empty, Icon } from './components';

export default function Offers({ offers }: { offers: EvaluatedOffer[] }) {
  if (!offers.length) return <Empty icon="eye" title="Nenhuma oferta identificada" description="A página pode precisar de uma regra de leitura ou do modo navegador. A ausência de ofertas não significa que o produto esteja esgotado."/>;
  return <div className="offer-list">{offers.map((offer, index) => <article className="offer-card" key={`${offer.key}-${index}`}>
    <div className="offer-top"><div><span className="eyebrow">{offer.sellerType === 'direct' ? 'RETALHISTA DIRETO' : offer.sellerType === 'marketplace' ? 'MARKETPLACE' : 'VENDEDOR POR CONFIRMAR'}</span><h4>{offer.sellerName || 'Vendedor não identificado'}</h4><p>{offer.productName || 'Produto observado'}{offer.variant ? ` · ${offer.variant}` : ''}</p></div><div className="offer-price">{money(offer.priceMinor, offer.currency)}<small>{offer.shippingMinor === null ? 'Portes desconhecidos' : `Portes: ${money(offer.shippingMinor, offer.currency)}`}</small></div></div>
    <div className="offer-modalities">{offer.modalities.map(modality => {
      const evaluation = offer.evaluations[modality.key];
      return <div className="modality" key={modality.key}><div className="modality-line"><div><span className="modality-title">{actionLabels[modality.action]}</span>{modality.storeId && <small>Loja: {modality.storeId}</small>}</div><div className="badge-row"><Badge tone={modality.stock === 'in_stock' ? 'green' : modality.stock === 'out_of_stock' ? 'neutral' : 'amber'}>{stockLabels[modality.stock]}</Badge><Badge tone={evaluation?.status === 'eligible' ? 'green' : evaluation?.status === 'excluded' ? 'neutral' : 'amber'}>{evaluation?.status === 'eligible' ? 'Cumpre critérios' : evaluation?.status === 'excluded' ? 'Fora dos critérios' : 'Informação insuficiente'}</Badge></div></div>{evaluation?.reasons.length ? <ul className="reason-list">{evaluation.reasons.map((reason, reasonIndex) => <li key={reasonIndex}>{REASON_LABELS[reason] || reason}</li>)}</ul> : null}</div>;
    })}</div>
    <details className="evidence"><summary><Icon name="eye" size={16}/> Ver evidência da leitura</summary><div className="evidence-items">{[...offer.evidence, ...offer.modalities.flatMap(modality => modality.evidence)].map((item, evidenceIndex) => <div key={evidenceIndex}><span className="eyebrow">{item.kind}</span><blockquote>{item.text}</blockquote>{item.path && <code>{item.path}</code>}</div>)}</div></details>
  </article>)}</div>;
}
