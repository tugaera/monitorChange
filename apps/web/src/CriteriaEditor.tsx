import { useState } from 'react';
import { actionLabels, parsePrice, priceToInput, splitList, type Action, type Criteria } from './model';
import { Field } from './components';

function ListField({ label, value, onChange, hint }: { label: string; value: string[]; onChange: (value: string[]) => void; hint?: string }) {
  const [text, setText] = useState(value.join(', '));
  return <Field label={label} hint={hint || 'Separe os valores por vírgulas.'}><input value={text} maxLength={1000} onChange={event => { setText(event.target.value); onChange(splitList(event.target.value)); }}/></Field>;
}

export default function CriteriaEditor({ value, onChange }: { value: Criteria; onChange: (value: Criteria) => void }) {
  const [price, setPrice] = useState(priceToInput(value));
  const [priceError, setPriceError] = useState('');
  const update = <K extends keyof Criteria>(key: K, next: Criteria[K]) => onChange({ ...value, [key]: next });
  return <div className="criteria-editor">
    <div className="field-grid">
      <Field label="Quem pode vender?"><select value={value.sellerPolicy} onChange={event => update('sellerPolicy', event.target.value as Criteria['sellerPolicy'])}><option value="direct_only">Apenas a loja · excluir marketplace</option><option value="all">Loja e vendedores de marketplace</option></select></Field>
      <Field label="Condição do produto"><select value={value.condition} onChange={event => update('condition', event.target.value as Criteria['condition'])}><option value="new">Apenas novo</option><option value="any">Qualquer condição</option></select></Field>
      <Field label="Variante pretendida" hint="Opcional. Cor, capacidade, tamanho ou outra identificação exata."><input value={value.variant} maxLength={500} placeholder="Qualquer variante" onChange={event => update('variant', event.target.value)}/></Field>
      <Field label="Moeda"><input value={value.currency} required pattern="[A-Z]{3}" maxLength={3} placeholder="EUR" onChange={event => { const next = event.target.value.toUpperCase(); try { onChange({ ...value, currency: next, maxPriceMinor: parsePrice(price, next) }); setPriceError(''); } catch (error) { setPriceError(String(error)); update('currency', next); } }}/></Field>
      <Field label="Preço máximo" hint={priceError || 'Opcional. Deixe vazio para não limitar o preço.'}><input value={price} inputMode="decimal" placeholder="Sem limite" aria-invalid={Boolean(priceError)} onChange={event => { const next = event.target.value; setPrice(next); try { update('maxPriceMinor', parsePrice(next, value.currency)); setPriceError(''); event.target.setCustomValidity(''); } catch { const message = 'Use um valor positivo sem separadores de milhares.'; setPriceError(message); event.target.setCustomValidity(message); } }}/></Field>
      <Field label="O limite de preço inclui"><select value={value.priceBasis} onChange={event => update('priceBasis', event.target.value as Criteria['priceBasis'])}><option value="item">Apenas o artigo</option><option value="delivered">Artigo e portes conhecidos</option></select></Field>
    </div>
    <fieldset className="choice-group"><legend>Modalidades que lhe interessam</legend>{(['online_order', 'pickup_order', 'pickup_reservation', 'store_only'] as Action[]).map(action => <label className="check-label" key={action}><input type="checkbox" checked={value.actions.includes(action)} onChange={event => update('actions', event.target.checked ? [...value.actions, action] : value.actions.filter(item => item !== action))}/><span>{actionLabels[action]}</span></label>)}<p className="field-hint">Stock físico é apenas informativo. Para levantamento, indique abaixo as lojas aceites.</p></fieldset>
    <details className="advanced"><summary>Vendedores, lojas e confirmação de alertas</summary><div className="field-grid">
      <ListField label="Vendedores permitidos" value={value.allowedSellers} onChange={next => update('allowedSellers', next)} hint="Opcional. Identificações tal como aparecem na oferta."/>
      <ListField label="Vendedores excluídos" value={value.excludedSellers} onChange={next => update('excludedSellers', next)}/>
      <ListField label="Lojas físicas aceites" value={value.storeIds} onChange={next => update('storeIds', next)} hint="Identificadores das lojas. Não é calculada distância pelo código postal."/>
      <Field label="Confirmação de disponibilidade"><select value={value.confirmation} onChange={event => update('confirmation', event.target.value as Criteria['confirmation'])}><option value="two_checks">Duas leituras válidas · recomendado</option><option value="one_check">Uma leitura · maior risco de falso alerta</option></select></Field>
    </div><label className="check-label"><input type="checkbox" checked={value.notifyInitial} onChange={event => update('notifyInitial', event.target.checked)}/><span>Avisar também se já estiver disponível na primeira leitura</span></label></details>
  </div>;
}
