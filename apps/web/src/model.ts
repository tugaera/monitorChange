export * from '../../../packages/contracts/src/index';
export { REASON_LABELS } from '../../../packages/domain/src/index';
import type { Action, CaptureStatus, Criteria, Stock } from '../../../packages/contracts/src/index';

export const actionLabels: Record<Action, string> = {
  online_order: 'Compra online · entrega', pickup_order: 'Compra para levantamento',
  pickup_reservation: 'Reserva para levantamento', store_only: 'Stock físico informativo', unknown: 'Modalidade por confirmar',
};
export const stockLabels: Record<Stock, string> = {
  in_stock: 'Disponível', out_of_stock: 'Esgotado', preorder: 'Pré-venda', backorder: 'Por encomenda', unknown: 'Stock por confirmar',
};
export const accessLabels: Record<CaptureStatus, string> = {
  ok: 'Leitura concluída', timeout: 'Tempo de espera excedido', http_error: 'Erro HTTP', blocked: 'Acesso bloqueado',
  login_required: 'Login necessário', limit_exceeded: 'Limite excedido', capture_error: 'Erro de captura',
};
export const dateTime = (value: string | null) => value ? new Intl.DateTimeFormat('pt-PT', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value)) : 'Ainda sem leitura';
export function relativeTime(value: string | null): string {
  if (!value) return 'Ainda sem leitura';
  const seconds = Math.round((new Date(value).getTime() - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat('pt-PT', { numeric: 'auto' });
  if (Math.abs(seconds) < 60) return formatter.format(seconds, 'second');
  if (Math.abs(seconds) < 3600) return formatter.format(Math.round(seconds / 60), 'minute');
  if (Math.abs(seconds) < 86400) return formatter.format(Math.round(seconds / 3600), 'hour');
  return formatter.format(Math.round(seconds / 86400), 'day');
}
export function money(value: number | null, currency: string): string {
  if (value === null) return 'Preço desconhecido';
  try { const format = new Intl.NumberFormat('pt-PT', { style: 'currency', currency }); return format.format(value / (10 ** (format.resolvedOptions().maximumFractionDigits ?? 2))); }
  catch { return `${value} unidades mínimas · ${currency}`; }
}
export function currencyDigits(currency: string): number {
  try { return new Intl.NumberFormat('pt-PT', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2; } catch { return 2; }
}
export function priceToInput(criteria: Criteria): string {
  return criteria.maxPriceMinor === null ? '' : (criteria.maxPriceMinor / (10 ** currencyDigits(criteria.currency))).toFixed(currencyDigits(criteria.currency));
}
export function parsePrice(value: string, currency: string): number | null {
  if (!value.trim()) return null;
  const digits = currencyDigits(currency);
  const pattern = new RegExp(`^\\d+(?:[.,]\\d{1,${Math.max(1, digits)}})?$`);
  if (!pattern.test(value.trim()) || (digits === 0 && /[.,]/.test(value))) throw new Error('Introduza um preço válido, sem separadores de milhares.');
  const [whole, decimals = ''] = value.trim().replace(',', '.').split('.');
  const result = Number(whole) * 10 ** digits + Number(decimals.padEnd(digits, '0'));
  if (!Number.isSafeInteger(result)) throw new Error('O preço indicado é demasiado elevado.');
  return result;
}
export const hostName = (value: string) => { try { return new URL(value).hostname.replace(/^www\./, ''); } catch { return value; } };
export const splitList = (value: string) => value.split(',').map(item => item.trim()).filter(Boolean);
export function safeExternalUrl(value: string): string | undefined {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : undefined; } catch { return undefined; }
}
