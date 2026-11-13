import { useState, type ChangeEvent } from 'react';
import { api, errorText, send } from './api';
import { ErrorNotice, Icon } from './components';

type Preview = { products: number; sources: number; warnings: string[]; applied: boolean };

export default function ConfigTransfer({ onImported }: { onImported: () => void }) {
  const [config, setConfig] = useState<unknown>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [filename, setFilename] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function download() {
    setBusy(true); setError(''); setMessage('');
    try {
      const exported = await api<unknown>('/config/export');
      const url = URL.createObjectURL(new Blob([JSON.stringify(exported, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = `monitorchange-config-${new Date().toISOString().slice(0, 10)}.json`; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage('Configuração exportada. O ficheiro contém produtos, fontes e critérios.');
    } catch (err) { setError(errorText(err)); } finally { setBusy(false); }
  }
  async function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; if (!file) return;
    setConfig(null); setPreview(null); setError(''); setMessage(''); setFilename(file.name);
    if (file.size > 2 * 1024 * 1024) { setError('O ficheiro excede o limite de 2 MiB.'); return; }
    setBusy(true);
    try {
      const parsed: unknown = JSON.parse(await file.text());
      const result = await send<Preview>('/config/import', 'POST', { config: parsed, apply: false });
      setConfig(parsed); setPreview(result);
    } catch (err) { setError(err instanceof SyntaxError ? 'O ficheiro não contém JSON válido.' : errorText(err)); } finally { setBusy(false); event.target.value = ''; }
  }
  async function apply() {
    if (!config || !preview) return;
    setBusy(true); setError('');
    try {
      const result = await send<Preview>('/config/import', 'POST', { config, apply: true });
      setMessage(`Importação concluída: ${result.products} produtos e ${result.sources} fontes. As fontes ficam em pausa.`);
      setConfig(null); setPreview(null); setFilename(''); onImported();
    } catch (err) { setError(errorText(err)); } finally { setBusy(false); }
  }
  return <section className="config-transfer"><span className="eyebrow">PORTABILIDADE</span><h3>Guardar e importar configurações</h3><p>O ficheiro inclui produtos, fontes, regiões e regras. O histórico, os eventos e as credenciais pertencem ao backup completo do servidor.</p><div className="transfer-actions"><button className="button secondary" disabled={busy} onClick={download}><Icon name="download" size={17}/>Exportar configuração</button><label className={`button secondary file-button ${busy ? 'disabled' : ''}`}><Icon name="plus" size={17}/>Escolher ficheiro para importar<input type="file" accept="application/json,.json" disabled={busy} onChange={selectFile}/></label></div>{error && <ErrorNotice message={error}/>} {message && <div className="notice" role="status"><Icon name="check"/><span>{message}</span></div>}{preview && <div className="import-preview"><strong>{filename}</strong><p>{preview.products} produtos · {preview.sources} fontes</p><p>Serão criadas cópias com novos identificadores. Todas as fontes ficam em pausa.</p>{preview.warnings.map((warning, index) => <p key={index}>{warning}</p>)}<div className="transfer-actions"><button className="button primary" disabled={busy} onClick={apply}>{busy ? 'A importar…' : 'Confirmar importação'}</button><button className="button ghost" disabled={busy} onClick={() => { setPreview(null); setConfig(null); setFilename(''); }}>Cancelar</button></div></div>}</section>;
}
